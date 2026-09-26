import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dhis2Adapter } from '@/data/sources/dhis2/adapter';
import { Dhis2Error, type Dhis2Config } from '@/data/sources/dhis2/client';
import { INDICATORS } from '@/config/indicators';
import { periodRange } from '@/core/model/periods';
import type { OrgUnit } from '@/core/model/types';

const config: Dhis2Config = {
  baseUrl: 'https://dhis2.example.org',
  token: 'test-token',
  timeoutMs: 5_000,
};

const orgUnits: OrgUnit[] = [
  { id: 'root', code: null, name: 'Root', level: 'COUNTRY', parentId: null, path: ['root'], centroid: null, active: true },
  { id: 'ou-lga', code: null, name: 'LGA', level: 'LGA', parentId: 'root', path: ['root', 'ou-lga'], centroid: null, active: true },
];

function mockFetch(handler: (url: string) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = String(input);
      const body = handler(url);
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Dhis2Adapter', () => {
  it('reports a reachable instance and its version', async () => {
    mockFetch(() => ({ version: '2.42.1', contextPath: 'https://dhis2.example.org' }));
    const result = await new Dhis2Adapter(config).testConnection();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('2.42.1');
  });

  it('turns an unreachable instance into a message, not an exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503, statusText: 'Unavailable' })));
    const result = await new Dhis2Adapter(config).testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('503');
  });

  it('authenticates with a token rather than putting credentials in the URL', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string, init?: RequestInit) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({ version: '2.42.1' }), { status: 200 });
      }),
    );
    await new Dhis2Adapter(config).testConnection();
    expect(calls[0].headers.get('Authorization')).toBe('ApiToken test-token');
    expect(calls[0].url).not.toContain('test-token');
  });

  it('imports the scoped states beneath the federal tier, not the whole country', async () => {
    const requested: string[] = [];
    mockFetch((raw) => {
      const url = decodeURIComponent(raw);
      requested.push(url);
      if (url.includes('/api/me')) {
        return { dataViewOrganisationUnits: [{ id: 'ou-ba' }, { id: 'ou-so' }] };
      }
      if (url.includes('path:like:ou-ba')) {
        return {
          organisationUnits: [
            { id: 'ou-ba', displayName: 'ba Bauchi State', level: 2, parent: { id: 'ng' }, path: '/ng/ou-ba' },
            { id: 'ba-lga', displayName: 'ba Alkaleri Local Government Area', level: 3, parent: { id: 'ou-ba' }, path: '/ng/ou-ba/ba-lga' },
            { id: 'ba-ward', displayName: 'ba Pali Ward', level: 4, parent: { id: 'ba-lga' }, path: '/ng/ou-ba/ba-lga/ba-ward' },
            {
              id: 'ba-fac',
              displayName: 'ba Pali PHC',
              level: 5,
              parent: { id: 'ba-ward' },
              path: '/ng/ou-ba/ba-lga/ba-ward/ba-fac',
              geometry: { type: 'Point', coordinates: [10.3, 9.9] },
            },
          ],
        };
      }
      if (url.includes('path:like:ou-so')) {
        return {
          organisationUnits: [
            { id: 'ou-so', displayName: 'so Sokoto State', level: 2, parent: { id: 'ng' }, path: '/ng/ou-so' },
          ],
        };
      }
      return { organisationUnits: [{ id: 'ng', displayName: 'ng Federal Government', level: 1, path: '/ng' }] };
    });

    const units = await new Dhis2Adapter(config).fetchOrgUnits();
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    expect(byId.get('ng')).toMatchObject({ level: 'COUNTRY', name: 'Federal Government', parentId: null });
    expect(byId.get('ou-ba')).toMatchObject({ level: 'STATE', name: 'Bauchi State', parentId: 'ng' });
    expect(byId.get('ba-lga')).toMatchObject({ level: 'LGA', parentId: 'ou-ba' });
    expect(byId.get('ba-ward')).toMatchObject({ level: 'WARD', parentId: 'ba-lga' });
    expect(byId.get('ba-fac')).toMatchObject({
      level: 'FACILITY',
      parentId: 'ba-ward',
      path: ['ng', 'ou-ba', 'ba-lga', 'ba-ward', 'ba-fac'],
      centroid: { lon: 10.3, lat: 9.9 },
    });
    // Subtrees are requested by path; the whole instance never is.
    expect(requested.filter((url) => url.includes('/api/organisationUnits')).every((url) => url.includes('filter='))).toBe(true);
  });

  it('skips levels left out of the map and attaches their children to the nearest mapped ancestor', async () => {
    vi.stubEnv('DHIS2_LEVEL_MAP', '1:STATE,2:LGA,3:WARD,5:FACILITY');
    vi.stubEnv('DHIS2_ROOT_ORG_UNITS', 'ou-state');
    mockFetch(() => ({
      organisationUnits: [
        { id: 'ou-state', displayName: 'Gombe State', level: 1, path: '/ou-state' },
        { id: 'ou-lga', displayName: 'Akko', level: 2, path: '/ou-state/ou-lga' },
        { id: 'ou-ward', displayName: 'A Ward', level: 3, path: '/ou-state/ou-lga/ou-ward' },
        { id: 'ou-comm', displayName: 'A Community', level: 4, path: '/ou-state/ou-lga/ou-ward/ou-comm' },
        { id: 'ou-fac', displayName: 'A Facility', level: 5, path: '/ou-state/ou-lga/ou-ward/ou-comm/ou-fac' },
      ],
    }));

    const units = await new Dhis2Adapter(config).fetchOrgUnits();
    expect(units.map((unit) => unit.level)).toEqual(['STATE', 'LGA', 'WARD', 'FACILITY']);
    expect(units.some((unit) => unit.id === 'ou-comm')).toBe(false);
    expect(units[3]).toMatchObject({ parentId: 'ou-ward', path: ['ou-state', 'ou-lga', 'ou-ward', 'ou-fac'] });
  });

  it('rejects a malformed level map rather than importing a wrong hierarchy', async () => {
    vi.stubEnv('DHIS2_LEVEL_MAP', '1:PROVINCE');
    vi.stubEnv('DHIS2_ROOT_ORG_UNITS', 'root');
    mockFetch(() => ({ organisationUnits: [] }));
    await expect(new Dhis2Adapter(config).fetchOrgUnits()).rejects.toThrow(/DHIS2_LEVEL_MAP/);
  });

  it('refuses to synchronise when no indicator is mapped, instead of returning nothing', async () => {
    mockFetch(() => ({}));
    const adapter = new Dhis2Adapter(config);
    const unmapped = INDICATORS.map((indicator) => ({
      ...indicator,
      source: { ...indicator.source, dx: null },
    }));
    await expect(
      adapter.fetchObservations({ orgUnits, indicators: unmapped, periods: periodRange('2026Q2', 2) }),
    ).rejects.toBeInstanceOf(Dhis2Error);
  });

  const analyticsHeaders = [
    { name: 'dx', column: 'Data', valueType: 'TEXT' },
    { name: 'pe', column: 'Period', valueType: 'TEXT' },
    { name: 'ou', column: 'Organisation unit', valueType: 'TEXT' },
    { name: 'value', column: 'Value', valueType: 'NUMBER' },
    { name: 'numerator', column: 'Numerator', valueType: 'NUMBER' },
    { name: 'denominator', column: 'Denominator', valueType: 'NUMBER' },
  ];

  /** Only the named indicators mapped, to the given dx. */
  function mappedOnly(dxById: Record<string, string>) {
    return INDICATORS.map((indicator) => ({
      ...indicator,
      source: { ...indicator.source, dx: dxById[indicator.id] ?? null, breakdown: undefined },
    }));
  }

  it('asks DHIS2 to aggregate, rather than downloading raw values', async () => {
    vi.stubEnv('DHIS2_ROOT_ORG_UNITS', 'root');
    const requested: string[] = [];
    mockFetch((url) => {
      requested.push(url);
      return { headers: analyticsHeaders, rows: [['dx-anc4', '2026Q2', 'ou-lga', '64.5', '645', '1000']] };
    });

    const observations = await new Dhis2Adapter(config).fetchObservations({
      orgUnits,
      indicators: mappedOnly({ 'anc4-coverage': 'dx-anc4' }),
      periods: periodRange('2026Q2', 1),
    });

    // One request per org level beneath the root, not one per org unit.
    expect(requested).toHaveLength(2);
    expect(requested.every((url) => url.includes('/api/analytics'))).toBe(true);
    // Level dimensions, not enumerated org unit ids, is what keeps the query small.
    expect(requested.every((url) => url.includes('LEVEL-'))).toBe(true);
    expect(observations).toContainEqual({
      indicatorId: 'anc4-coverage',
      orgUnitId: 'ou-lga',
      periodId: '2026Q2',
      value: 64.5,
      numerator: 645,
      denominator: 1000,
      disaggregation: null,
    });
  });

  it('builds the federal figure from both states, weighting ratios by their denominators', async () => {
    vi.stubEnv('DHIS2_ROOT_ORG_UNITS', 'ou-ba,ou-so');
    const national: OrgUnit[] = [
      { id: 'ng', code: null, name: 'Federal Government', level: 'COUNTRY', parentId: null, path: ['ng'], centroid: null, active: true },
      { id: 'ou-ba', code: null, name: 'Bauchi State', level: 'STATE', parentId: 'ng', path: ['ng', 'ou-ba'], centroid: null, active: true },
      { id: 'ou-so', code: null, name: 'Sokoto State', level: 'STATE', parentId: 'ng', path: ['ng', 'ou-so'], centroid: null, active: true },
    ];
    const requested: string[] = [];
    mockFetch((url) => {
      requested.push(decodeURIComponent(url));
      return {
        headers: analyticsHeaders,
        rows: [
          // A percentage: 50% of 100 and 80% of 300.
          ['dx-sba', '2026Q1', 'ou-ba', '50', '50', '100'],
          ['dx-sba', '2026Q1', 'ou-so', '80', '240', '300'],
          // A count, which has no numerator or denominator.
          ['dx-fp', '2026Q1', 'ou-ba', '120', '', ''],
          ['dx-fp', '2026Q1', 'ou-so', '80', '', ''],
          // Only one state reported: no federal figure.
          ['dx-sba', '2026Q2', 'ou-ba', '60', '60', '100'],
        ],
      };
    });

    const observations = await new Dhis2Adapter(config).fetchObservations({
      orgUnits: national,
      indicators: mappedOnly({ 'skilled-birth-attendance': 'dx-sba', 'fp-new-acceptors': 'dx-fp' }),
      periods: periodRange('2026Q2', 2),
    });

    // The federal tier is never queried: the service user cannot view it.
    expect(requested.every((url) => url.includes('LEVEL-2'))).toBe(true);
    const federal = observations.filter((observation) => observation.orgUnitId === 'ng');
    expect(federal).toHaveLength(2);
    expect(federal.find((observation) => observation.indicatorId === 'skilled-birth-attendance')).toMatchObject({
      periodId: '2026Q1',
      value: 72.5,
      numerator: 290,
      denominator: 400,
    });
    expect(federal.find((observation) => observation.indicatorId === 'fp-new-acceptors')).toMatchObject({
      periodId: '2026Q1',
      value: 200,
    });
  });

  it('calculates a rate from data elements where DHIS2 has no usable indicator', async () => {
    vi.stubEnv('DHIS2_ROOT_ORG_UNITS', 'root');
    const requested: string[] = [];
    mockFetch((url) => {
      requested.push(decodeURIComponent(url));
      return {
        headers: analyticsHeaders,
        rows: url.includes('LEVEL-3')
          ? [
              // 30 still births and 1,470 live births: 20 per 1,000 total births.
              ['de-still', '2026Q1', 'ou-lga', '30', '', ''],
              ['de-live', '2026Q1', 'ou-lga', '1470', '', ''],
              // Live births with no still-birth report: no value, rather than zero.
              ['de-live', '2025Q4', 'ou-lga', '1500', '', ''],
            ]
          : [],
      };
    });
    const indicators = INDICATORS.map((indicator) => ({
      ...indicator,
      source:
        indicator.id === 'still-birth-rate'
          ? { ...indicator.source, dx: null, numeratorDx: 'de-still', denominatorDx: 'de-live+de-still', breakdown: undefined }
          : { ...indicator.source, dx: null, numeratorDx: null, denominatorDx: null, breakdown: undefined },
    }));

    const observations = await new Dhis2Adapter(config).fetchObservations({
      orgUnits,
      indicators,
      periods: periodRange('2026Q1', 2),
    });

    // The components are requested, not a DHIS2 indicator.
    expect(requested.every((url) => url.includes('dx:de-still;de-live') || url.includes('dx:de-live;de-still'))).toBe(true);
    expect(observations).toEqual([
      {
        indicatorId: 'still-birth-rate',
        orgUnitId: 'ou-lga',
        periodId: '2026Q1',
        value: 20,
        numerator: 30,
        denominator: 1500,
        disaggregation: null,
      },
    ]);
  });

  it('splits a count by a category and sums each option up to the federal tier', async () => {
    vi.stubEnv('DHIS2_ROOT_ORG_UNITS', 'ou-ba,ou-so');
    const national: OrgUnit[] = [
      { id: 'ng', code: null, name: 'Federal Government', level: 'COUNTRY', parentId: null, path: ['ng'], centroid: null, active: true },
      { id: 'ou-ba', code: null, name: 'Bauchi State', level: 'STATE', parentId: 'ng', path: ['ng', 'ou-ba'], centroid: null, active: true },
      { id: 'ou-so', code: null, name: 'Sokoto State', level: 'STATE', parentId: 'ng', path: ['ng', 'ou-so'], centroid: null, active: true },
    ];
    mockFetch((raw) => {
      const url = decodeURIComponent(raw);
      if (!url.includes('dimension=cat-sex')) return { headers: analyticsHeaders, rows: [] };
      return {
        headers: [
          { name: 'dx', column: 'Data', valueType: 'TEXT' },
          { name: 'cat-sex', column: 'Sex', valueType: 'TEXT' },
          { name: 'pe', column: 'Period', valueType: 'TEXT' },
          { name: 'ou', column: 'Organisation unit', valueType: 'TEXT' },
          { name: 'value', column: 'Value', valueType: 'NUMBER' },
        ],
        rows: [
          ['de-fp', 'opt-f', '2026Q1', 'ou-ba', '900'],
          ['de-fp', 'opt-m', '2026Q1', 'ou-ba', '100'],
          ['de-fp', 'opt-f', '2026Q1', 'ou-so', '600'],
        ],
        metaData: { items: { 'opt-f': { name: 'Female' }, 'opt-m': { name: 'Male' } } },
      };
    });
    const indicators = INDICATORS.map((indicator) => ({
      ...indicator,
      source:
        indicator.id === 'fp-new-acceptors'
          ? { ...indicator.source, dx: 'de-fp', breakdown: { dx: 'de-fp', category: 'cat-sex', label: 'Sex', counts: 'new FP acceptors' } }
          : { ...indicator.source, dx: null, numeratorDx: null, denominatorDx: null, breakdown: undefined },
    }));

    const observations = await new Dhis2Adapter(config).fetchObservations({
      orgUnits: national,
      indicators,
      periods: periodRange('2026Q1', 1),
    });
    const split = (unit: string, key: string) =>
      observations.find((o) => o.orgUnitId === unit && o.disaggregation === key)?.value;

    expect(split('ou-ba', 'Sex:Female')).toBe(900);
    expect(split('ou-ba', 'Sex:Male')).toBe(100);
    // Female is reported in both states, so it sums; Male only in one, so no federal figure.
    expect(split('ng', 'Sex:Female')).toBe(1500);
    expect(split('ng', 'Sex:Male')).toBeUndefined();
  });

  it('skips analytics rows whose value is not a number', async () => {
    vi.stubEnv('DHIS2_ROOT_ORG_UNITS', 'root');
    mockFetch((url) => ({
      headers: analyticsHeaders.slice(0, 4),
      rows: url.includes('LEVEL-3')
        ? [
            ['dx-anc4', '2026Q2', 'ou-lga', ''],
            ['dx-anc4', '2026Q2', 'ou-lga', '12'],
          ]
        : [],
    }));
    const observations = await new Dhis2Adapter(config).fetchObservations({
      orgUnits,
      indicators: mappedOnly({ 'anc4-coverage': 'dx-anc4' }),
      periods: periodRange('2026Q2', 1),
    });
    expect(observations).toHaveLength(1);
    expect(observations[0].value).toBe(12);
  });

  it('counts a monthly data set as reported for a quarter only when all three months were', async () => {
    vi.stubEnv('DHIS2_ROOT_ORG_UNITS', 'root');
    mockFetch((url) => {
      if (url.includes('/api/organisationUnits')) {
        return { organisationUnits: [{ id: 'fac-a' }, { id: 'fac-b' }] };
      }
      return {
        completeDataSetRegistrations: [
          { period: '202604', organisationUnit: 'fac-a', dataSet: 'ds-1', date: '2026-05-10T00:00:00.000' },
          { period: '202605', organisationUnit: 'fac-a', dataSet: 'ds-1', date: '2026-06-10T00:00:00.000' },
          { period: '202606', organisationUnit: 'fac-a', dataSet: 'ds-1', date: '2026-07-10T00:00:00.000' },
          { period: '202604', organisationUnit: 'fac-b', dataSet: 'ds-1', date: '2026-05-10T00:00:00.000' },
        ],
      };
    });

    const facilities: OrgUnit[] = [
      { id: 'fac-a', code: null, name: 'A', level: 'FACILITY', parentId: 'ou-lga', path: ['root', 'ou-lga', 'fac-a'], centroid: null, active: true },
      { id: 'fac-b', code: null, name: 'B', level: 'FACILITY', parentId: 'ou-lga', path: ['root', 'ou-lga', 'fac-b'], centroid: null, active: true },
    ];

    const records = await new Dhis2Adapter(config).fetchReporting({
      orgUnits: [orgUnits[0], ...facilities],
      indicators: INDICATORS.map((indicator) => ({ ...indicator, source: { ...indicator.source, datasetId: 'ds-1' } })),
      periods: periodRange('2026Q2', 1),
      datasets: [
        { id: 'ds-1', name: 'Dataset', periodType: 'MONTHLY', dueDays: 15 },
        // Not referenced by any indicator, so not expected of anyone.
        { id: 'ds-other', name: 'Other', periodType: 'MONTHLY', dueDays: 15 },
      ],
    });

    expect(records).toHaveLength(2);
    expect(records.find((record) => record.orgUnitId === 'fac-a')).toMatchObject({
      reported: true,
      submittedAt: '2026-07-10T00:00:00.000',
    });
    expect(records.find((record) => record.orgUnitId === 'fac-b')!.reported).toBe(false);
    expect(records.every((record) => record.expected && record.datasetId === 'ds-1')).toBe(true);
  });
});

describe('bundled geography', () => {
  it('ships both states\u2019 boundaries wound the way d3-geo needs', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { geoMercator, geoPath } = await import('d3-geo');

    const collection = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/geo/lgas.geojson'), 'utf8'),
    );
    expect(collection.features).toHaveLength(43);
    const states = new Set<string>(
      collection.features.map((feature: { properties: { state: string } }) => feature.properties.state),
    );
    expect([...states].sort()).toEqual(['Bauchi', 'Sokoto']);

    // d3-geo reads polygons spherically and expects clockwise exterior rings —
    // the opposite of the GeoJSON specification. Data wound the other way
    // describes the whole globe minus the intended area, which collapses the
    // fitted scale to world level. A realistic scale is the check that the
    // shapes will actually render.
    //
    // The two states are ~700km apart, so the programme-wide extent is fitted
    // at a smaller scale than a single state would be; each state is checked at
    // its own extent below, which is how the map actually draws them.
    const canvas: [[number, number], [number, number]] = [
      [16, 16],
      [704, 504],
    ];
    const whole = geoMercator().fitExtent(canvas, collection);
    expect(whole.scale()).toBeGreaterThan(1500);

    for (const state of states) {
      const features = collection.features.filter(
        (feature: { properties: { state: string } }) => feature.properties.state === state,
      );
      const subset = { type: 'FeatureCollection' as const, features };
      const projection = geoMercator().fitExtent(canvas, subset);
      expect(projection.scale()).toBeGreaterThan(5000);

      const path = geoPath(projection);
      for (const feature of features) {
        const [[x0, y0], [x1, y1]] = path.bounds(feature);
        // No single LGA may span the whole canvas.
        expect(x1 - x0).toBeLessThan(600);
        expect(y1 - y0).toBeLessThan(480);
        expect(x1 - x0).toBeGreaterThan(5);
        expect(y1).toBeGreaterThan(y0);
        expect(path(feature)).toBeTruthy();
      }
    }
  });

  it('gives every boundary the org unit id and state the application joins on', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const collection = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/geo/lgas.geojson'), 'utf8'),
    ) as {
      features: Array<{
        properties: { orgUnitId: string; name: string; state: string; lon: number; lat: number };
      }>;
    };
    const ids = new Set<string>();
    for (const feature of collection.features) {
      const { orgUnitId, name, state, lon, lat } = feature.properties;
      expect(orgUnitId).toMatch(/^lga-(bauchi|sokoto)-/);
      expect(orgUnitId.startsWith(`lga-${state.toLowerCase()}-`)).toBe(true);
      expect(name.length).toBeGreaterThan(1);
      // Nigeria's bounding box, so a swapped lon/lat pair fails here.
      expect(lon).toBeGreaterThan(2.5);
      expect(lon).toBeLessThan(15);
      expect(lat).toBeGreaterThan(4);
      expect(lat).toBeLessThan(14);
      expect(ids.has(orgUnitId)).toBe(false);
      ids.add(orgUnitId);
    }
    expect(ids.size).toBe(43);
  });
});
