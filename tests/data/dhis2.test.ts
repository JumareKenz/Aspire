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

  it('maps a state-rooted hierarchy onto canonical levels by default', async () => {
    // The target instance is rooted at the state: State → LGA → Ward →
    // Community → Facility. Wards and communities have no canonical tier and
    // fold into the reporting level below the LGA.
    mockFetch(() => ({
      organisationUnits: [
        { id: 'ou-state', displayName: 'Gombe State', level: 1, path: '/ou-state' },
        { id: 'ou-lga', displayName: 'Akko', level: 2, parent: { id: 'ou-state' }, path: '/ou-state/ou-lga' },
        {
          id: 'ou-ward',
          displayName: 'A Ward',
          level: 3,
          parent: { id: 'ou-lga' },
          path: '/ou-state/ou-lga/ou-ward',
          geometry: { type: 'Point', coordinates: [11.08, 10.1] },
        },
        { id: 'ou-fac', displayName: 'A Facility', level: 5, parent: { id: 'ou-ward' }, path: '/x/ou-fac' },
      ],
    }));

    const units = await new Dhis2Adapter(config).fetchOrgUnits();
    expect(units.map((unit) => unit.level)).toEqual(['STATE', 'LGA', 'FACILITY', 'FACILITY']);
    expect(units[1].parentId).toBe('ou-state');
    expect(units[2].centroid).toEqual({ lon: 11.08, lat: 10.1 });
  });

  it('honours an explicit level map for a differently-shaped instance', async () => {
    vi.stubEnv('DHIS2_LEVEL_MAP', '1:COUNTRY,2:STATE,3:LGA,4:FACILITY');
    mockFetch(() => ({
      organisationUnits: [
        { id: 'root', displayName: 'Nigeria', level: 1, path: '/root' },
        { id: 'ou-state', displayName: 'A State', level: 2, parent: { id: 'root' }, path: '/root/ou-state' },
        { id: 'ou-lga', displayName: 'An LGA', level: 3, parent: { id: 'ou-state' }, path: '/a/ou-lga' },
        { id: 'too-deep', displayName: 'Sub-unit', level: 5, path: '/a/b/c/too-deep' },
      ],
    }));

    const units = await new Dhis2Adapter(config).fetchOrgUnits();
    expect(units.map((unit) => unit.level)).toEqual(['COUNTRY', 'STATE', 'LGA']);
    // Level 5 is beyond the configured map and is not imported as a guess.
    expect(units.some((unit) => unit.id === 'too-deep')).toBe(false);
  });

  it('rejects a malformed level map rather than importing a wrong hierarchy', async () => {
    vi.stubEnv('DHIS2_LEVEL_MAP', '1:PROVINCE');
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

  it('asks DHIS2 to aggregate, rather than downloading raw values', async () => {
    const requested: string[] = [];
    mockFetch((url) => {
      requested.push(url);
      return {
        headers: [
          { name: 'dx', column: 'Data', valueType: 'TEXT' },
          { name: 'pe', column: 'Period', valueType: 'TEXT' },
          { name: 'ou', column: 'Organisation unit', valueType: 'TEXT' },
          { name: 'value', column: 'Value', valueType: 'NUMBER' },
          { name: 'numerator', column: 'Numerator', valueType: 'NUMBER' },
          { name: 'denominator', column: 'Denominator', valueType: 'NUMBER' },
        ],
        rows: [['dx-anc4', '2026Q2', 'ou-lga', '64.5', '645', '1000']],
      };
    });

    const mapped = INDICATORS.map((indicator) =>
      indicator.id === 'anc4-coverage'
        ? { ...indicator, source: { ...indicator.source, dx: 'dx-anc4' } }
        : indicator,
    );

    const observations = await new Dhis2Adapter(config).fetchObservations({
      orgUnits: [orgUnits[1]],
      indicators: mapped,
      periods: periodRange('2026Q2', 1),
    });

    // One request per org level, not one per org unit.
    expect(requested).toHaveLength(1);
    expect(requested.every((url) => url.includes('/api/analytics'))).toBe(true);
    // Level dimensions, not enumerated org unit ids, is what keeps the query small.
    expect(requested.some((url) => url.includes('LEVEL-'))).toBe(true);
    expect(observations).toEqual([
      {
        indicatorId: 'anc4-coverage',
        orgUnitId: 'ou-lga',
        periodId: '2026Q2',
        value: 64.5,
        numerator: 645,
        denominator: 1000,
        disaggregation: null,
      },
    ]);
  });

  it('skips analytics rows whose value is not a number', async () => {
    mockFetch(() => ({
      headers: [
        { name: 'dx', column: 'Data', valueType: 'TEXT' },
        { name: 'pe', column: 'Period', valueType: 'TEXT' },
        { name: 'ou', column: 'Organisation unit', valueType: 'TEXT' },
        { name: 'value', column: 'Value', valueType: 'NUMBER' },
      ],
      rows: [
        ['dx-anc4', '2026Q2', 'ou-lga', ''],
        ['dx-anc4', '2026Q2', 'ou-lga', '12'],
      ],
    }));
    const mapped = INDICATORS.map((indicator) =>
      indicator.id === 'anc4-coverage'
        ? { ...indicator, source: { ...indicator.source, dx: 'dx-anc4' } }
        : indicator,
    );
    const observations = await new Dhis2Adapter(config).fetchObservations({
      orgUnits: [orgUnits[1]],
      indicators: mapped,
      periods: periodRange('2026Q2', 1),
    });
    expect(observations).toHaveLength(1);
    expect(observations[0].value).toBe(12);
  });

  it('treats an absent completeness registration as a missing report', async () => {
    mockFetch(() => ({
      completeDataSetRegistrations: [
        { period: '2026Q2', organisationUnit: 'fac-a', dataSet: 'ds-1', date: '2026-07-10T00:00:00.000Z' },
      ],
    }));

    const facilities: OrgUnit[] = [
      { id: 'fac-a', code: null, name: 'A', level: 'FACILITY', parentId: 'ou-lga', path: ['root', 'ou-lga', 'fac-a'], centroid: null, active: true },
      { id: 'fac-b', code: null, name: 'B', level: 'FACILITY', parentId: 'ou-lga', path: ['root', 'ou-lga', 'fac-b'], centroid: null, active: true },
    ];

    const records = await new Dhis2Adapter(config).fetchReporting({
      orgUnits: [orgUnits[0], ...facilities],
      indicators: INDICATORS,
      periods: periodRange('2026Q2', 1),
      datasets: [{ id: 'ds-1', name: 'Dataset', periodType: 'QUARTERLY', dueDays: 15 }],
    });

    expect(records).toHaveLength(2);
    expect(records.find((record) => record.orgUnitId === 'fac-a')!.reported).toBe(true);
    expect(records.find((record) => record.orgUnitId === 'fac-b')!.reported).toBe(false);
    expect(records.every((record) => record.expected)).toBe(true);
  });
});

describe('bundled geography', () => {
  it('ships Gombe State boundaries wound the way d3-geo needs', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { geoMercator, geoPath } = await import('d3-geo');

    const collection = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/geo/gombe-lgas.geojson'), 'utf8'),
    );
    expect(collection.features).toHaveLength(11);

    // d3-geo reads polygons spherically and expects clockwise exterior rings —
    // the opposite of the GeoJSON specification. Data wound the other way
    // describes the whole globe minus the intended area, which collapses the
    // fitted scale to world level. A realistic scale is the check that the
    // shapes will actually render.
    const projection = geoMercator().fitExtent(
      [
        [16, 16],
        [704, 504],
      ],
      collection,
    );
    expect(projection.scale()).toBeGreaterThan(5000);

    const path = geoPath(projection);
    for (const feature of collection.features) {
      const [[x0, y0], [x1, y1]] = path.bounds(feature);
      // No single LGA may span the whole canvas.
      expect(x1 - x0).toBeLessThan(600);
      expect(y1 - y0).toBeLessThan(480);
      expect(x1 - x0).toBeGreaterThan(5);
      expect(y1).toBeGreaterThan(y0);
      expect(path(feature)).toBeTruthy();
    }
  });
});
