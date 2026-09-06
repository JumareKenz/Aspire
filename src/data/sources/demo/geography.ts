import type { OrgUnit } from '@/core/model/types';
import { hashSeed, mulberry32 } from './random';

/**
 * Demo geography.
 *
 * The names here are deliberately fictional. Attaching synthetic figures to
 * real Nigerian states, LGAs or facilities would create a document that reads
 * as real reporting about real places, which is exactly the confusion the
 * product must avoid. Real org units arrive through the DHIS2 adapter.
 */
export const DEMO_STATE = { id: 'demo-state', name: 'Kandara State (demo)' };

const LGA_NAMES = [
  'Ambara',
  'Bindiga',
  'Chalawa',
  'Dutsen Rimi',
  'Eguma',
  'Fankama',
  'Gwarzo North',
  'Hadeja West',
  'Ilesan',
  'Jalingo Central',
  'Kwatarkwashi',
  'Lamurde',
  'Makera',
  'Nasarawan Doya',
];

const FACILITY_KINDS = [
  'General Hospital',
  'Primary Health Centre',
  'Comprehensive Health Centre',
  'Maternity Centre',
  'Health Post',
  'Cottage Hospital',
];

const FACILITY_PREFIXES = [
  'Central',
  'North',
  'South',
  'Riverside',
  'Market',
  'Old Town',
  'Station',
  'Hillside',
  'Junction',
];

export interface DemoGeography {
  state: OrgUnit;
  lgas: OrgUnit[];
  facilities: OrgUnit[];
  all: OrgUnit[];
}

/**
 * Builds the demo hierarchy. Centroids are laid out on a deterministic grid
 * inside a bounding box: they position units relative to one another for the
 * schematic map and are not claimed to be real coordinates.
 */
export function buildDemoGeography(): DemoGeography {
  const rng = mulberry32(hashSeed('kandara-geography'));

  // The demo hierarchy is rooted at the state. ASPIRE-GAC operates at state
  // level, and inserting a national tier above a single state would add a
  // navigation step whose only child is the state itself.
  const state: OrgUnit = {
    id: DEMO_STATE.id,
    code: 'KND',
    name: DEMO_STATE.name,
    level: 'STATE',
    parentId: null,
    path: [DEMO_STATE.id],
    centroid: { lon: 8.6, lat: 11.2 },
    active: true,
  };

  const columns = 4;
  const lgas: OrgUnit[] = LGA_NAMES.map((name, index) => {
    const id = `lga-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id,
      code: `KND-${String(index + 1).padStart(2, '0')}`,
      name,
      level: 'LGA' as const,
      parentId: state.id,
      path: [state.id, id],
      centroid: {
        lon: 7.9 + column * 0.45 + (rng() - 0.5) * 0.08,
        lat: 11.9 - row * 0.42 + (rng() - 0.5) * 0.08,
      },
      active: true,
    };
  });

  const facilities: OrgUnit[] = [];
  for (const lga of lgas) {
    const lgaRng = mulberry32(hashSeed(`facilities:${lga.id}`));
    const count = 6 + Math.floor(lgaRng() * 4);
    for (let i = 0; i < count; i += 1) {
      const prefix = FACILITY_PREFIXES[Math.floor(lgaRng() * FACILITY_PREFIXES.length)];
      const kind = FACILITY_KINDS[Math.floor(lgaRng() * FACILITY_KINDS.length)];
      const name = `${lga.name} ${prefix} ${kind}`;
      const id = `fac-${lga.id.replace('lga-', '')}-${i + 1}`;
      facilities.push({
        id,
        code: `${lga.code}-F${String(i + 1).padStart(2, '0')}`,
        name,
        level: 'FACILITY',
        parentId: lga.id,
        path: [state.id, lga.id, id],
        centroid: {
          lon: (lga.centroid?.lon ?? 8.6) + (lgaRng() - 0.5) * 0.28,
          lat: (lga.centroid?.lat ?? 11.2) + (lgaRng() - 0.5) * 0.26,
        },
        active: true,
      });
    }
  }

  return { state, lgas, facilities, all: [state, ...lgas, ...facilities] };
}
