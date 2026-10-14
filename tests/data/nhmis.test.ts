import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dhis2Adapter } from '@/data/sources/dhis2/adapter';
import type { Dhis2Config } from '@/data/sources/dhis2/client';
import { verifyProvenance, dataElementRefs } from '@/data/sync/governance';
import { INDICATORS } from '@/config/indicators';
import { periodRange } from '@/core/model/periods';
import type { OrgUnit } from '@/core/model/types';

/**
 * The governed DHIS2 path: what the source says is on the approved NHMIS form
 * decides what may be reported, and data element values respect DHIS2's own
 * aggregation types.
 */
const config: Dhis2Config = { baseUrl: 'https://dhis2.example.org', token: 't', timeoutMs: 5_000 };
const FORM = 'O82o1WlMisO';

function mockFetch(handler: (url: URL) => unknown) {
  const requested: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      requested.push(url);
      return new Response(JSON.stringify(handler(url)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return requested;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const element = (id: string, name: string, aggregationType = 'SUM') => ({
  dataElement: { id, displayName: name, valueType: 'INTEGER_ZERO_OR_POSITIVE', aggregationType, domainType: 'AGGREGATE' },
});

describe('provenance from DHIS2 metadata', () => {
  it('verifies against the form DHIS2 describes, and excludes what is not on it', async () => {
    const requested = mockFetch((url) => {
      if (url.pathname.endsWith('/dataSets')) {
        expect(url.searchParams.get('filter')).toBe(`id:in:[${FORM},lyVV9bPLlVy]`);
        return {
          dataSets: [
            {
              id: FORM,
              displayName: 'NHMIS Monthly Summary Form (Version 2019)',
              periodType: 'Monthly',
              dataSetElements: [
                element('FHmQPDbgyYZ', 'Still births'),
                element('YjZiHDKMWCJ', 'Live Births'),
                element('aNcFirstVis', 'ANC 1st visit'),
                element('aNcBefore20', 'ANC 1st visit before 20 weeks'),
                // A tracker element on the form is not aggregate NHMIS data.
                { dataElement: { id: 'trackerDe01', displayName: 'Tracker', domainType: 'TRACKER' } },
              ],
            },
          ],
        };
      }
      if (url.pathname.endsWith('/indicators')) {
        return {
          indicators: [
            { id: 'xIvjr5gGVpp', displayName: 'ANC <20 weeks', numerator: '#{aNcBefore20}', denominator: '#{aNcFirstVis}' },
            // Named like NHMIS, drawing on a population estimate.
            { id: 'M8XUQAbJ3us', displayName: 'NHMIS mCPR', numerator: '#{HDmaff9ZJls}', denominator: '#{PopWomn1549}' },
          ],
        };
      }
      if (url.pathname.endsWith('/categoryOptionCombos')) return { categoryOptionCombos: [] };
      throw new Error(`Unexpected ${url}`);
    });

    const adapter = new Dhis2Adapter(config);
    const result = await verifyProvenance(adapter, INDICATORS);
    const status = (id: string) => result.provenance.find((entry) => entry.indicatorId === id)!.status;

    expect(status('still-birth-rate')).toBe('VERIFIED');
    expect(status('anc4-coverage')).toBe('VERIFIED');
    expect(status('mcpr')).toBe('UNVERIFIED');
    expect(status('youth-friendly-services')).toBe('UNMAPPED');
    // Elements not on the mocked form (deliveries, FP, GBV…) keep their indicators out.
    expect(status('fp-new-acceptors')).toBe('UNVERIFIED');
    expect(result.reportable.map((indicator) => indicator.id).sort()).toEqual(['anc4-coverage', 'low-birth-weight', 'still-birth-rate']);
    expect(result.metadata.dataElements.map((entry) => entry.id)).not.toContain('trackerDe01');
    // The NHMIS 2025 form, not approved, was never even asked for.
    expect(requested.some((url) => url.pathname.endsWith('/dataSets') && url.search.includes('dTyJ3IK8vbz'))).toBe(false);

    const refs = dataElementRefs(result.provenance, new Set(result.reportable.map((indicator) => indicator.id)), []);
    // Element totals, plus the single options an indicator uses.
    expect(refs).toEqual([
      'FHmQPDbgyYZ',
      'YjZiHDKMWCJ',
      'YjZiHDKMWCJ.hE0EYluYY9M',
      'YjZiHDKMWCJ.rYT1B3NrGPP',
      'aNcBefore20',
      'aNcFirstVis',
    ]);
  });

  it('verifies nothing when the approved form is not at the source', async () => {
    mockFetch((url) => {
      if (url.pathname.endsWith('/dataSets')) return { dataSets: [] };
      if (url.pathname.endsWith('/indicators')) return { indicators: [] };
      return { categoryOptionCombos: [] };
    });
    const result = await verifyProvenance(new Dhis2Adapter(config), INDICATORS);
    expect(result.forms).toEqual([]);
    expect(result.reportable).toEqual([]);
  });
});

describe('data element values', () => {
  const national: OrgUnit[] = [
    { id: 'ng', code: null, name: 'Federal', level: 'COUNTRY', parentId: null, path: ['ng'], centroid: null, active: true },
    { id: 'ou-ba', code: null, name: 'Bauchi', level: 'STATE', parentId: 'ng', path: ['ng', 'ou-ba'], centroid: null, active: true },
    { id: 'ou-so', code: null, name: 'Sokoto', level: 'STATE', parentId: 'ng', path: ['ng', 'ou-so'], centroid: null, active: true },
  ];

  it('asks DHIS2 for months as months, and sums only additive elements above the states', async () => {
    vi.stubEnv('DHIS2_ROOT_ORG_UNITS', 'ou-ba,ou-so');
    const requested = mockFetch(() => ({
      headers: [{ name: 'dx' }, { name: 'pe' }, { name: 'ou' }, { name: 'value' }],
      rows: [
        ['sumElement1', '202512', 'ou-ba', '120'],
        ['sumElement1', '202512', 'ou-so', '80'],
        ['avgElement1', '202512', 'ou-ba', '10'],
        ['avgElement1', '202512', 'ou-so', '30'],
        // Only one state: no federal figure.
        ['sumElement1', '202511', 'ou-ba', '50'],
        // A blank cell is absent, not zero.
        ['sumElement1', '202510', 'ou-so', ''],
      ],
    }));
    const values = await new Dhis2Adapter(config).fetchDataElementValues({
      dx: ['sumElement1', 'avgElement1'],
      orgUnits: national,
      periods: periodRange('202512', 3),
      aggregationTypes: { sumElement1: 'SUM', avgElement1: 'AVERAGE' },
    });
    expect(requested.every((url) => url.searchParams.getAll('dimension').some((d) => d.includes('202512') && !d.includes('Q')))).toBe(true);
    const federal = values.filter((entry) => entry.orgUnitId === 'ng');
    expect(federal).toEqual([{ dx: 'sumElement1', orgUnitId: 'ng', periodId: '202512', value: 200 }]);
    expect(values.some((entry) => entry.periodId === '202510')).toBe(false);
  });
});

describe('an unreliable gateway', () => {
  it('retries a 504 once, and does not retry other failures', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? new Response('busy', { status: 504, statusText: 'Gateway Time-out' })
          : new Response(JSON.stringify({ version: '2.40.11' }), { status: 200 });
      }),
    );
    expect((await new Dhis2Adapter(config).testConnection()).ok).toBe(true);
    expect(calls).toBe(2);

    calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls += 1; return new Response('no', { status: 401, statusText: 'Unauthorized' }); }));
    expect((await new Dhis2Adapter(config).testConnection()).ok).toBe(false);
    expect(calls).toBe(1);
  });
});
