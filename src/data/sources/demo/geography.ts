import type { OrgUnit } from '@/core/model/types';
import { hashSeed, mulberry32 } from './random';

/**
 * Demo geography — the real administrative shape of Gombe State.
 *
 * The platform's deployment target is Gombe State, whose DHIS2 hierarchy is
 * State → LGA → Ward → Community → Facility. The demo dataset therefore uses
 * the state's eleven real LGAs and their real boundaries (see
 * `public/geo/gombe-lgas.geojson`), so that the map, the hierarchy and the
 * drill-down behave exactly as they will against live data.
 *
 * The *figures* attached to these places remain entirely synthetic, and are
 * labelled DEMO at the data layer, in the API, in the shell, and on every
 * report and export. Real geography with clearly-marked synthetic values is
 * more useful — and no less honest — than fictional geography, because the
 * labelling is what prevents the confusion, not the place names.
 *
 * Facility names are constructed rather than real: naming individual health
 * facilities and attaching invented performance figures to them would make
 * claims about identifiable service points.
 */
export const DEMO_STATE = { id: 'state-gombe', name: 'Gombe State' };

/**
 * The eleven LGAs of Gombe State, with centroids from the boundary file.
 * Ids match the `orgUnitId` in `public/geo/gombe-lgas.geojson`.
 */
const LGAS: Array<{ id: string; name: string; code: string; lon: number; lat: number }> = [
  { id: 'lga-akko', name: 'Akko', code: 'GO-AKK', lon: 11.08, lat: 10.1 },
  { id: 'lga-balanga', name: 'Balanga', code: 'GO-BAL', lon: 11.62, lat: 9.84 },
  { id: 'lga-billiri', name: 'Billiri', code: 'GO-BIL', lon: 11.12, lat: 9.86 },
  { id: 'lga-dukku', name: 'Dukku', code: 'GO-DUK', lon: 10.81, lat: 10.78 },
  { id: 'lga-funakaye', name: 'Funakaye', code: 'GO-FUN', lon: 11.39, lat: 10.83 },
  { id: 'lga-gombe', name: 'Gombe', code: 'GO-GOM', lon: 11.19, lat: 10.3 },
  { id: 'lga-kaltungo', name: 'Kaltungo', code: 'GO-KAL', lon: 11.42, lat: 9.86 },
  { id: 'lga-kwami', name: 'Kwami', code: 'GO-KWA', lon: 11.22, lat: 10.48 },
  { id: 'lga-nafada', name: 'Nafada', code: 'GO-NAF', lon: 11.25, lat: 11.02 },
  { id: 'lga-shongom', name: 'Shongom', code: 'GO-SHO', lon: 11.2, lat: 9.69 },
  { id: 'lga-yamaltu-deba', name: 'Yamaltu/Deba', code: 'GO-YAM', lon: 11.5, lat: 10.27 },
];

/** Facility types as they appear in Nigerian primary health care. */
const FACILITY_KINDS = [
  'General Hospital',
  'Primary Health Centre',
  'Comprehensive Health Centre',
  'Maternity Centre',
  'Health Post',
  'Cottage Hospital',
];

/** Neutral locality descriptors, so no real settlement is named. */
const FACILITY_PREFIXES = [
  'Central',
  'North',
  'South',
  'East',
  'West',
  'Township',
  'Market',
  'Junction',
  'Riverside',
];

export interface DemoGeography {
  state: OrgUnit;
  lgas: OrgUnit[];
  facilities: OrgUnit[];
  all: OrgUnit[];
}

/**
 * Builds the demo hierarchy: one state, eleven real LGAs, and a deterministic
 * set of reporting facilities beneath each.
 */
export function buildDemoGeography(): DemoGeography {
  const state: OrgUnit = {
    id: DEMO_STATE.id,
    code: 'GO',
    name: DEMO_STATE.name,
    level: 'STATE',
    parentId: null,
    path: [DEMO_STATE.id],
    centroid: { lon: 11.2, lat: 10.4 },
    active: true,
  };

  const lgas: OrgUnit[] = LGAS.map((entry) => ({
    id: entry.id,
    code: entry.code,
    name: entry.name,
    level: 'LGA' as const,
    parentId: state.id,
    path: [state.id, entry.id],
    centroid: { lon: entry.lon, lat: entry.lat },
    active: true,
  }));

  const facilities: OrgUnit[] = [];
  for (const lga of lgas) {
    const rng = mulberry32(hashSeed(`facilities:${lga.id}`));
    const count = 7 + Math.floor(rng() * 5);
    for (let i = 0; i < count; i += 1) {
      const prefix = FACILITY_PREFIXES[Math.floor(rng() * FACILITY_PREFIXES.length)];
      const kind = FACILITY_KINDS[Math.floor(rng() * FACILITY_KINDS.length)];
      const id = `fac-${lga.id.replace('lga-', '')}-${i + 1}`;
      facilities.push({
        id,
        code: `${lga.code}-F${String(i + 1).padStart(2, '0')}`,
        name: `${lga.name} ${prefix} ${kind}`,
        level: 'FACILITY',
        parentId: lga.id,
        path: [state.id, lga.id, id],
        // Scattered within the LGA so facility points sit inside their own
        // boundary on the map.
        centroid: {
          lon: (lga.centroid?.lon ?? 11.2) + (rng() - 0.5) * 0.18,
          lat: (lga.centroid?.lat ?? 10.4) + (rng() - 0.5) * 0.16,
        },
        active: true,
      });
    }
  }

  return { state, lgas, facilities, all: [state, ...lgas, ...facilities] };
}
