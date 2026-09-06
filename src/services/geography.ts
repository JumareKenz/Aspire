import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { geoMercator, geoPath } from 'd3-geo';
import type { GeoPermissibleObjects } from 'd3-geo';
import { listChildren } from '@/data/repositories/orgUnits';
import { listFindings } from '@/data/repositories/findings';
import { getChildScorecards } from './scorecards';
import { previousPeriodId } from '@/core/model/periods';
import { round } from '@/core/analytics/stats';

/**
 * Boundary source.
 *
 * No official Nigerian or state LGA boundary file was supplied, and drawing
 * invented polygons would present synthetic shapes as administrative geography.
 * The map therefore has two modes:
 *
 *  - GEOJSON, when a boundary file is configured. Real polygons, projected.
 *  - SCHEMATIC, otherwise. Positioned marks that show relative arrangement and
 *    are labelled as schematic wherever they appear.
 *
 * Configuring `ASPIRE_BOUNDARIES_PATH` — a GeoJSON FeatureCollection whose
 * features carry an `orgUnitId` (or `id`) property — switches the map to true
 * geography with no change to any component.
 */
export type BoundaryMode = 'GEOJSON' | 'SCHEMATIC';

export interface MapUnit {
  orgUnitId: string;
  name: string;
  score: number | null;
  status: 'ON_TRACK' | 'WATCH' | 'NEEDS_ATTENTION' | 'NO_DATA';
  changePoints: number | null;
  dataConfidence: number;
  openFindings: number;
  /** SVG path when boundaries are available, otherwise null. */
  path: string | null;
  /** Projected centre in SVG coordinates. */
  cx: number;
  cy: number;
}

export interface MapData {
  mode: BoundaryMode;
  width: number;
  height: number;
  units: MapUnit[];
  /** Explains what the reader is looking at. Rendered on the map itself. */
  note: string;
}

interface BoundaryFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: GeoPermissibleObjects;
}

/**
 * Boundary files are read once per process and cached.
 *
 * A national boundary set is a large document and it does not change between
 * requests, so re-reading and re-parsing it on every map render would be pure
 * waste. A parse failure is cached too, so a malformed file does not cause a
 * disk read on every request.
 */
let boundaryCache: { features: BoundaryFeature[] | null } | null = null;

function loadBoundaries(): BoundaryFeature[] | null {
  if (boundaryCache) return boundaryCache.features;

  const configured = process.env.ASPIRE_BOUNDARIES_PATH;
  if (!configured) {
    boundaryCache = { features: null };
    return null;
  }

  const path = resolve(process.cwd(), configured);
  if (!existsSync(path)) {
    console.warn(`[geography] ASPIRE_BOUNDARIES_PATH is set but ${path} does not exist. Using the schematic layout.`);
    boundaryCache = { features: null };
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { features?: BoundaryFeature[] };
    boundaryCache = { features: parsed.features ?? null };
  } catch (error) {
    console.warn(
      `[geography] Could not read boundaries from ${path}: ${
        error instanceof Error ? error.message : 'unknown error'
      }. Using the schematic layout.`,
    );
    boundaryCache = { features: null };
  }
  return boundaryCache.features;
}

const WIDTH = 720;
const HEIGHT = 520;

export function getMapData(orgUnitId: string, periodId: string): MapData {
  const children = listChildren(orgUnitId);
  const cards = getChildScorecards(orgUnitId, periodId);
  const previous = new Map(
    getChildScorecards(orgUnitId, previousPeriodId(periodId)).map((card) => [card.orgUnitId, card]),
  );
  const cardById = new Map(cards.map((card) => [card.orgUnitId, card]));
  const findingCounts = new Map<string, number>();
  for (const finding of listFindings({
    orgUnitIds: children.map((child) => child.id),
    status: 'OPEN',
  })) {
    findingCounts.set(finding.orgUnitId, (findingCounts.get(finding.orgUnitId) ?? 0) + 1);
  }

  const boundaries = loadBoundaries();
  const positioned = children.filter((child) => child.centroid !== null);

  const build = (child: (typeof children)[number], cx: number, cy: number, path: string | null): MapUnit => {
    const card = cardById.get(child.id);
    const prior = previous.get(child.id);
    const changePoints =
      card?.overallScore != null && prior?.overallScore != null
        ? round(card.overallScore - prior.overallScore, 1)
        : null;
    return {
      orgUnitId: child.id,
      name: child.name,
      score: card?.overallScore ?? null,
      status: card?.status ?? 'NO_DATA',
      changePoints,
      dataConfidence: card?.dataConfidence.score ?? 0,
      openFindings: findingCounts.get(child.id) ?? 0,
      path,
      cx,
      cy,
    };
  };

  if (boundaries && boundaries.length > 0) {
    const byOrgUnit = new Map(
      boundaries.map((feature) => [
        String(feature.properties.orgUnitId ?? feature.properties.id ?? ''),
        feature,
      ]),
    );
    const relevant = children
      .map((child) => ({ child, feature: byOrgUnit.get(child.id) }))
      .filter((entry): entry is { child: (typeof children)[number]; feature: BoundaryFeature } =>
        Boolean(entry.feature),
      );

    if (relevant.length > 0) {
      const collection = {
        type: 'FeatureCollection' as const,
        features: relevant.map((entry) => entry.feature),
      };
      const projection = geoMercator().fitExtent(
        [
          [16, 16],
          [WIDTH - 16, HEIGHT - 16],
        ],
        collection as unknown as GeoPermissibleObjects,
      );
      const pathBuilder = geoPath(projection);
      return {
        mode: 'GEOJSON',
        width: WIDTH,
        height: HEIGHT,
        units: relevant.map((entry) => {
          const [cx, cy] = pathBuilder.centroid(entry.feature as unknown as GeoPermissibleObjects);
          return build(entry.child, cx, cy, pathBuilder(entry.feature as unknown as GeoPermissibleObjects));
        }),
        note: 'Administrative boundaries as configured for this installation.',
      };
    }
  }

  // Schematic fallback: project the recorded points and lay them out. Positions
  // are relative and are labelled as such; they are not boundaries.
  const points = {
    type: 'FeatureCollection' as const,
    features: positioned.map((child) => ({
      type: 'Feature' as const,
      properties: { id: child.id },
      geometry: { type: 'Point' as const, coordinates: [child.centroid!.lon, child.centroid!.lat] },
    })),
  };

  if (points.features.length === 0) {
    return { mode: 'SCHEMATIC', width: WIDTH, height: HEIGHT, units: [], note: 'No positions are recorded for these areas.' };
  }

  const projection = geoMercator().fitExtent(
    [
      [64, 56],
      [WIDTH - 64, HEIGHT - 56],
    ],
    points as unknown as GeoPermissibleObjects,
  );

  return {
    mode: 'SCHEMATIC',
    width: WIDTH,
    height: HEIGHT,
    units: positioned.map((child) => {
      const projected = projection([child.centroid!.lon, child.centroid!.lat]) ?? [WIDTH / 2, HEIGHT / 2];
      return build(child, projected[0], projected[1], null);
    }),
    note: 'Schematic layout. Positions show how areas sit relative to one another; they are not administrative boundaries.',
  };
}
