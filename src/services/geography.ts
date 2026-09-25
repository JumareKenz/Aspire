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
 * Boundaries bundled with the platform: the 43 LGAs of Bauchi and Sokoto, from
 * geoBoundaries gbOpen NGA ADM2 (source GRID3), CC BY 4.0.
 */
const DEFAULT_BOUNDARIES = 'public/geo/lgas.geojson';

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
  /**
   * The parent this unit sits under, when the map is drawn a level below the
   * selected geography. Null when the units are the direct children.
   */
  groupName: string | null;
}

export interface MapData {
  mode: BoundaryMode;
  width: number;
  height: number;
  units: MapUnit[];
  /** Explains what the reader is looking at. Rendered on the map itself. */
  note: string;
  /**
   * The level the shapes represent, which is not always the level directly
   * below the selection — see `getMapData`.
   */
  drawnLevel: 'STATE' | 'LGA' | 'WARD' | 'FACILITY' | null;
  /**
   * Panels the canvas is divided into, when the map draws more than one
   * geography that does not adjoin the others. Empty for a single-panel map.
   */
  panels: Array<{ name: string; x: number; width: number }>;
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

  // LGA boundaries for both programme states ship with the platform, so the
  // map draws real geography out of the box. ASPIRE_BOUNDARIES_PATH overrides this for another
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

/**
 * Name key for matching a unit to a boundary feature. Ignores case,
 * punctuation, an "LGA"/"Local Government Area" suffix and doubled letters, so
 * DHIS2's "Dange-Shuni Local Government Area" meets the boundary file's
 * "Dange Shuni" and "Wamako" meets "Wamakko".
 */
function boundaryNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(local government area|lga)$/, '')
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const WIDTH = 720;
const HEIGHT = 520;

/**
 * Builds the map for a geography.
 *
 * The map normally draws the units directly beneath the selection. The
 * programme root is the exception: its children are the two states, and no
 * state-level boundary file ships with the platform, so drawing them would
 * give a global user two dots several hundred kilometres apart — technically
 * accurate and useless. Where the direct children have no boundaries but their
 * own children do, the map descends one level and draws those instead,
 * labelling each shape with the state it belongs to. That is what makes the
 * root map a genuine cross-state view rather than a schematic placeholder.
 *
 * Descending is a *presentational* choice and is not a way around scope or
 * depth: the caller has already resolved `orgUnitId` against the user's scope,
 * and everything drawn is a descendant of it. A user who cannot see a state
 * never selects a geography above it, so its LGAs are never drawn for them.
 */
export async function getMapData(orgUnitId: string, periodId: string): Promise<MapData> {
  const direct = await listChildren(orgUnitId);
  const boundaries = loadBoundaries();
  const byId = new Map(
    (boundaries ?? []).map((feature) => [
      String(feature.properties.orgUnitId ?? feature.properties.id ?? ''),
      feature,
    ]),
  );
  // DHIS2 identifies units by its own ids, which a boundary file prepared
  // elsewhere does not carry, so features are also matched by name.
  const byName = new Map(
    (boundaries ?? [])
      .filter((feature) => typeof feature.properties.name === 'string')
      .map((feature) => [boundaryNameKey(feature.properties.name as string), feature]),
  );
  const featureFor = (unit: { id: string; name: string }) =>
    byId.get(unit.id) ?? byName.get(boundaryNameKey(unit.name));

  let units = direct;
  /** Parent name per unit, set only when the map has descended a level. */
  let groups = new Map<string, string>();
  let descended = false;

  if (boundaries && direct.length > 0 && !direct.some((child) => featureFor(child))) {
    const grandchildren = await Promise.all(
      direct.map(async (child) => ({ parent: child, children: await listChildren(child.id) })),
    );
    const flattened = grandchildren.flatMap((entry) =>
      entry.children.map((child) => ({ child, parent: entry.parent })),
    );
    if (flattened.some((entry) => featureFor(entry.child))) {
      units = flattened.map((entry) => entry.child);
      groups = new Map(flattened.map((entry) => [entry.child.id, entry.parent.name]));
      descended = true;
    }
  }

  const parentIds = descended ? direct.map((child) => child.id) : [orgUnitId];
  const [cardSets, previousSets, openFindings] = await Promise.all([
    Promise.all(parentIds.map((id) => getChildScorecards(id, periodId))),
    Promise.all(parentIds.map((id) => getChildScorecards(id, previousPeriodId(periodId)))),
    listFindings({ orgUnitIds: units.map((unit) => unit.id), status: 'OPEN' }),
  ]);
  const cardById = new Map(cardSets.flat().map((card) => [card.orgUnitId, card]));
  const previous = new Map(previousSets.flat().map((card) => [card.orgUnitId, card]));
  const findingCounts = new Map<string, number>();
  for (const finding of openFindings) {
    findingCounts.set(finding.orgUnitId, (findingCounts.get(finding.orgUnitId) ?? 0) + 1);
  }

  const drawnLevel = (units[0]?.level ?? null) as MapData['drawnLevel'];
  const positioned = units.filter((unit) => unit.centroid !== null);

  const build = (
    child: (typeof units)[number],
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
      groupName: groups.get(child.id) ?? null,
    };
  };

  if (boundaries && boundaries.length > 0) {
    const relevant = units
      .map((child) => ({ child, feature: featureFor(child) }))
      .filter((entry): entry is { child: (typeof units)[number]; feature: BoundaryFeature } =>
        Boolean(entry.feature),
      );

    if (relevant.length > 0) {
      // Where the map has descended, the groups are separate states hundreds
      // of kilometres apart. One projection across all of them wastes most of
      // the canvas on the gap between them and shrinks both states until their
      // labels collide. Each group is fitted into its own panel instead — the
      // same choice a printed atlas makes, and the one that lets the two
      // states actually be compared.
      const groupNames = descended
        ? [...new Set(relevant.map((entry) => groups.get(entry.child.id)!).filter(Boolean))]
        : [];
      const panelCount = Math.max(1, groupNames.length);
      const panelWidth = WIDTH / panelCount;
      const TOP = groupNames.length > 1 ? 34 : 16;

      const drawn: MapUnit[] = [];
      const panels: MapData['panels'] = [];

      for (let index = 0; index < panelCount; index += 1) {
        const name = groupNames[index] ?? null;
        const members = name
          ? relevant.filter((entry) => groups.get(entry.child.id) === name)
          : relevant;
        if (members.length === 0) continue;

        const x0 = index * panelWidth;
        const projection = geoMercator().fitExtent(
          [
            [x0 + 14, TOP],
            [x0 + panelWidth - 14, HEIGHT - 16],
          ],
          {
            type: 'FeatureCollection' as const,
            features: members.map((entry) => entry.feature),
          } as unknown as GeoPermissibleObjects,
        );
        const pathBuilder = geoPath(projection);
        for (const entry of members) {
          const shape = entry.feature as unknown as GeoPermissibleObjects;
          const [cx, cy] = pathBuilder.centroid(shape);
          drawn.push(build(entry.child, cx, cy, pathBuilder(shape), pathBuilder.area(shape)));
        }
        if (name) panels.push({ name, x: x0, width: panelWidth });
      }

      return {
        mode: 'GEOJSON',
        width: WIDTH,
        height: HEIGHT,
        drawnLevel,
        panels,
        units: drawn,
        note: descended
          ? `Administrative boundaries. Drawn one level down, across ${groupNames.join(' and ')}, because no boundaries are configured for the level directly below. Each state is fitted to its own panel, so the panels are not to a common scale.`
          : 'Administrative boundaries as configured for this installation.',
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
    return {
      mode: 'SCHEMATIC',
      width: WIDTH,
      height: HEIGHT,
      drawnLevel,
      panels: [],
      units: [],
      note: 'No positions are recorded for these areas.',
    };
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
    drawnLevel,
    panels: [],
    units: positioned.map((child) => {
      const projected = projection([child.centroid!.lon, child.centroid!.lat]) ?? [WIDTH / 2, HEIGHT / 2];
      return build(child, projected[0], projected[1], null);
    }),
    note: 'Schematic layout. Positions show how areas sit relative to one another; they are not administrative boundaries.',
  };
}
