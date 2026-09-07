import type { OrgUnit } from '@/core/model/types';
import { hashSeed, mulberry32 } from './random';

/**
 * Demo geography — the real administrative shape of the two programme states.
 *
 * ASPIRE-GAC covers **Bauchi** and **Sokoto**. Both hang off a single
 * programme root so that one hierarchy serves everyone:
 *
 *   Programme → State → LGA → Facility
 *
 * The root exists so a global user has a genuine aggregate to read and a
 * single place to compare the two states from, rather than the application
 * having to special-case "two disconnected trees". A state-scoped user is
 * simply scoped to their state node and never sees the sibling.
 *
 * Boundaries for all 43 LGAs ship in `public/geo/lgas.geojson`
 * (geoBoundaries gbOpen NGA ADM2 / GRID3, CC BY 4.0) and the ids here match
 * its `orgUnitId` values exactly.
 *
 * The *figures* attached to these places are synthetic and labelled DEMO
 * throughout. Facility names are constructed rather than real: naming an
 * actual service point and attaching an invented score to it would make a
 * claim about an identifiable place.
 */
/**
 * The root is named for the programme rather than for the states beneath it.
 * A root called "Bauchi and Sokoto" would answer to a question naming either
 * state, and the intelligence pipeline matches geographies by name.
 */
export const PROGRAMME_ROOT = { id: 'aspire-programme', name: 'ASPIRE-GAC Programme' };
export const BAUCHI = { id: 'state-bauchi', name: 'Bauchi State', code: 'BA' };
export const SOKOTO = { id: 'state-sokoto', name: 'Sokoto State', code: 'SO' };

interface LgaSeed {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

/** The twenty LGAs of Bauchi State. */
const BAUCHI_LGAS: LgaSeed[] = [
  { id: 'lga-bauchi-alkaleri', name: "Alkaleri", lon: 10.3555, lat: 9.9805 },
  { id: 'lga-bauchi-bauchi', name: "Bauchi", lon: 9.9133, lat: 10.271 },
  { id: 'lga-bauchi-bogoro', name: "Bogoro", lon: 9.5903, lat: 9.6439 },
  { id: 'lga-bauchi-dambam', name: "Dambam", lon: 10.7288, lat: 11.6526 },
  { id: 'lga-bauchi-darazo', name: "Darazo", lon: 10.5878, lat: 11.1679 },
  { id: 'lga-bauchi-dass', name: "Dass", lon: 9.5009, lat: 9.9956 },
  { id: 'lga-bauchi-gamawa', name: "Gamawa", lon: 10.5751, lat: 12.0221 },
  { id: 'lga-bauchi-ganjuwa', name: "Ganjuwa", lon: 10.0275, lat: 10.7715 },
  { id: 'lga-bauchi-giade', name: "Giade", lon: 10.2659, lat: 11.4284 },
  { id: 'lga-bauchi-itas-gadau', name: "Itas/Gadau", lon: 10.0446, lat: 11.9045 },
  { id: 'lga-bauchi-jama-are', name: "Jama'Are", lon: 9.9229, lat: 11.6547 },
  { id: 'lga-bauchi-katagum', name: "Katagum", lon: 10.3443, lat: 11.6444 },
  { id: 'lga-bauchi-kirfi', name: "Kirfi", lon: 10.4754, lat: 10.3945 },
  { id: 'lga-bauchi-misau', name: "Misau", lon: 10.4881, lat: 11.3946 },
  { id: 'lga-bauchi-ningi', name: "Ningi", lon: 9.2426, lat: 11.0758 },
  { id: 'lga-bauchi-shira', name: "Shira", lon: 10.03, lat: 11.4775 },
  { id: 'lga-bauchi-tafawa-balewa', name: "Tafawa-Balewa", lon: 9.5737, lat: 9.8012 },
  { id: 'lga-bauchi-toro', name: "Toro", lon: 9.2527, lat: 10.3266 },
  { id: 'lga-bauchi-warji', name: "Warji", lon: 9.7354, lat: 11.173 },
  { id: 'lga-bauchi-zaki', name: "Zaki", lon: 10.3656, lat: 12.1936 },
];

/** The twenty-three LGAs of Sokoto State. */
const SOKOTO_LGAS: LgaSeed[] = [
  { id: 'lga-sokoto-binji', name: "Binji", lon: 4.8198, lat: 13.1877 },
  { id: 'lga-sokoto-bodinga', name: "Bodinga", lon: 5.1782, lat: 12.8513 },
  { id: 'lga-sokoto-dange-shuni', name: "Dange Shuni", lon: 5.4318, lat: 12.8298 },
  { id: 'lga-sokoto-gada', name: "Gada", lon: 5.6663, lat: 13.6535 },
  { id: 'lga-sokoto-goronyo', name: "Goronyo", lon: 5.737, lat: 13.3879 },
  { id: 'lga-sokoto-gudu', name: "Gudu", lon: 4.4929, lat: 13.4274 },
  { id: 'lga-sokoto-gwadabawa', name: "Gwadabawa", lon: 5.3117, lat: 13.423 },
  { id: 'lga-sokoto-illela', name: "Illela", lon: 5.3782, lat: 13.6154 },
  { id: 'lga-sokoto-isa', name: "Isa", lon: 6.4054, lat: 13.1838 },
  { id: 'lga-sokoto-kebbe', name: "Kebbe", lon: 4.6888, lat: 11.7851 },
  { id: 'lga-sokoto-kware', name: "Kware", lon: 5.3071, lat: 13.1507 },
  { id: 'lga-sokoto-rabah', name: "Rabah", lon: 5.6101, lat: 13.0145 },
  { id: 'lga-sokoto-sabon-birni', name: "Sabon Birni", lon: 6.2246, lat: 13.4748 },
  { id: 'lga-sokoto-shagari', name: "Shagari", lon: 5.0814, lat: 12.5461 },
  { id: 'lga-sokoto-silame', name: "Silame", lon: 4.8, lat: 13.0004 },
  { id: 'lga-sokoto-sokoto-north', name: "Sokoto North", lon: 5.2319, lat: 13.0722 },
  { id: 'lga-sokoto-sokoto-south', name: "Sokoto South", lon: 5.2533, lat: 13.0422 },
  { id: 'lga-sokoto-tambuwal', name: "Tambuwal", lon: 4.8029, lat: 12.4056 },
  { id: 'lga-sokoto-tangaza', name: "Tangaza", lon: 5.0087, lat: 13.4058 },
  { id: 'lga-sokoto-tureta', name: "Tureta", lon: 5.491, lat: 12.5389 },
  { id: 'lga-sokoto-wamakko', name: "Wamakko", lon: 5.1585, lat: 13.0655 },
  { id: 'lga-sokoto-wurno', name: "Wurno", lon: 5.4988, lat: 13.2172 },
  { id: 'lga-sokoto-yabo', name: "Yabo", lon: 4.9627, lat: 12.7622 },
];

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
  root: OrgUnit;
  states: OrgUnit[];
  lgas: OrgUnit[];
  facilities: OrgUnit[];
  all: OrgUnit[];
}

export function buildDemoGeography(): DemoGeography {
  const root: OrgUnit = {
    id: PROGRAMME_ROOT.id,
    code: 'ASPIRE',
    name: PROGRAMME_ROOT.name,
    level: 'COUNTRY',
    parentId: null,
    path: [PROGRAMME_ROOT.id],
    centroid: { lon: 7.8, lat: 11.8 },
    active: true,
  };

  const stateSeeds = [
    { seed: BAUCHI, lgas: BAUCHI_LGAS, lon: 10.0, lat: 10.8 },
    { seed: SOKOTO, lgas: SOKOTO_LGAS, lon: 5.2, lat: 13.0 },
  ];

  const states: OrgUnit[] = stateSeeds.map((entry) => ({
    id: entry.seed.id,
    code: entry.seed.code,
    name: entry.seed.name,
    level: 'STATE' as const,
    parentId: root.id,
    path: [root.id, entry.seed.id],
    centroid: { lon: entry.lon, lat: entry.lat },
    active: true,
  }));

  const lgas: OrgUnit[] = [];
  const facilities: OrgUnit[] = [];

  for (const { seed, lgas: seeds } of stateSeeds) {
    seeds.forEach((entry, index) => {
      const lga: OrgUnit = {
        id: entry.id,
        code: `${seed.code}-${String(index + 1).padStart(2, '0')}`,
        name: entry.name,
        level: 'LGA',
        parentId: seed.id,
        path: [root.id, seed.id, entry.id],
        centroid: { lon: entry.lon, lat: entry.lat },
        active: true,
      };
      lgas.push(lga);

      const rng = mulberry32(hashSeed(`facilities:${lga.id}`));
      const count = 5 + Math.floor(rng() * 4);
      for (let i = 0; i < count; i += 1) {
        const prefix = FACILITY_PREFIXES[Math.floor(rng() * FACILITY_PREFIXES.length)];
        const kind = FACILITY_KINDS[Math.floor(rng() * FACILITY_KINDS.length)];
        const id = `fac-${entry.id.replace('lga-', '')}-${i + 1}`;
        facilities.push({
          id,
          code: `${lga.code}-F${String(i + 1).padStart(2, '0')}`,
          name: `${entry.name} ${prefix} ${kind}`,
          level: 'FACILITY',
          parentId: lga.id,
          path: [root.id, seed.id, entry.id, id],
          centroid: {
            lon: entry.lon + (rng() - 0.5) * 0.18,
            lat: entry.lat + (rng() - 0.5) * 0.16,
          },
          active: true,
        });
      }
    });
  }

  return { root, states, lgas, facilities, all: [root, ...states, ...lgas, ...facilities] };
}
