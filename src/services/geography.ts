import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { geoMercator, geoPath } from 'd3-geo';
import type { GeoPermissibleObjects } from 'd3-geo';
import { listChildren } from '@/data/repositories/orgUnits';
import { listFindings } from '@/data/repositories/findings';
import { getChildScorecards } from './scorecards';
import { previousPeriodId } from '@/core/model/periods';
import { round } from '@/core/analytics/stats';
import { env, envOr } from '@/lib/env';

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

/**
 * Boundaries bundled with the platform: the eleven LGAs of Gombe State, from
 * geoBoundaries gbOpen NGA ADM2 (source GRID3), CC BY 4.0.
 */
const DEFAULT_BOUNDARIES = 'public/geo/gombe-lgas.geojson';

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
  /**
   * Rendered area of the shape in square pixels. The map uses it to decide
   * whether a label fits inside its own polygon; small units get a leader line
   * rather than text spilling across their neighbours.
   */
  area: number;
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

/**
 * Ensures rings wind the way d3-geo expects.
 *
 * RFC 7946 specifies counter-clockwise exterior rings; d3-geo reads polygons
 * spherically and expects them clockwise. Specification-compliant data
 * therefore renders in d3 as the whole globe *minus* the intended area — the
 * shape floods the canvas and collapses the fitted projection scale.
 *
 * The bundled file is already stored in d3's order, so this normally changes
 * nothing. It runs anyway because an operator supplying their own boundaries
 * through ASPIRE_BOUNDARIES_PATH should not have to know this trap exists.
 */
function ringArea(ring: number[][]): number {
  let total = 0;
  for (let i = 0, n = ring.length; i < n; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    total += x1 * y2 - x2 * y1;
  }
  return total / 2;
}

function rewindRings(rings: number[][][]): number[][][] {
  return rings.map((ring, index) => {
    // Exterior ring clockwise (negative planar area); holes counter-clockwise.
    const wantNegative = index === 0;
    return (ringArea(ring) < 0) === wantNegative ? ring : [...ring].reverse();
  });
}

function normaliseWinding(features: BoundaryFeature[]): BoundaryFeature[] {
  for (const feature of features) {
    const geometry = feature.geometry as unknown as {
      type: string;
      coordinates: number[][][] | number[][][][];
    };
    if (geometry.type === 'Polygon') {
      geometry.coordinates = rewindRings(geometry.coordinates as number[][][]);
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates = (geometry.coordinates as number[][][][]).map(rewindRings);
    }
  }
  return features;
}

function loadBoundaries(): BoundaryFeature[] | null {
  if (boundaryCache) return boundaryCache.features;

  // Gombe State LGA boundaries ship with the platform, so the map draws real
  // geography out of the box. ASPIRE_BOUNDARIES_PATH overrides this for another
  // state or a national deployment.
  const configured = envOr('ASPIRE_BOUNDARIES_PATH', DEFAULT_BOUNDARIES);
  const path = resolve(process.cwd(), configured);
  if (!existsSync(path)) {
    if (env('ASPIRE_BOUNDARIES_PATH')) {
      console.warn(
        `[geography] ASPIRE_BOUNDARIES_PATH is set but ${path} does not exist. Using the schematic layout.`,
      );
    }
    boundaryCache = { features: null };
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { features?: BoundaryFeature[] };
    boundaryCache = { features: parsed.features ? normaliseWinding(parsed.features) : null };
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

export async function getMapData(orgUnitId: string, periodId: string): Promise<MapData> {
  const [children, cards, previousCards] = await Promise.all([
    listChildren(orgUnitId),
    getChildScorecards(orgUnitId, periodId),
    getChildScorecards(orgUnitId, previousPeriodId(periodId)),
  ]);
  const previous = new Map(previousCards.map((card) => [card.orgUnitId, card]));
  const cardById = new Map(cards.map((card) => [card.orgUnitId, card]));
  const findingCounts = new Map<string, number>();
  const openFindings = await listFindings({
    orgUnitIds: children.map((child) => child.id),
    status: 'OPEN',
  });
  for (const finding of openFindings) {
    findingCounts.set(finding.orgUnitId, (findingCounts.get(finding.orgUnitId) ?? 0) + 1);
  }

  const boundaries = loadBoundaries();
  const positioned = children.filter((child) => child.centroid !== null);

  const build = (
    child: (typeof children)[number],
    cx: number,
    cy: number,
    path: string | null,
    area = 0,
  ): MapUnit => {
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
      area,
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
          const shape = entry.feature as unknown as GeoPermissibleObjects;
          const [cx, cy] = pathBuilder.centroid(shape);
          return build(entry.child, cx, cy, pathBuilder(shape), pathBuilder.area(shape));
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
