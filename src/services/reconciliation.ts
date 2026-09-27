/**
 * Reconciles ASPIRE's stored figures against DHIS2's own.
 *
 * For a sample of indicators, org units (federal, state, LGA, ward, facility)
 * and quarters, compares the value ASPIRE holds after a sync with the value
 * DHIS2 analytics returns for the same indicator, unit and period, fetched
 * live. Calculated indicators are rebuilt from DHIS2's raw data element
 * values, and the federal tier, which DHIS2 does not serve to the service
 * account, is rebuilt from the two states' numerators and denominators.
 *
 * Used by Admin → Data validation and by `npm run reconcile`.
 */
import type { IndicatorDefinition } from '@/core/registry/types';
import { isMapped } from '@/core/registry/mapping';
import { query } from '@/data/db/client';
import { getSetting, setSetting } from '@/data/repositories/settings';
import { listIndicators } from '@/data/repositories/registry';
import { Dhis2Client, readDhis2Config } from '@/data/sources/dhis2/client';

const PERIODS = ['2025Q2', '2025Q4'];
/** ASPIRE stores DHIS2's unrounded values, so only floating-point noise is allowed. */
const TOLERANCE = 0.01;

interface Unit {
  id: string;
  name: string;
  level: string;
  path: string;
}

export interface Comparison {
  indicatorId: string;
  indicatorName: string;
  method: 'DHIS2 indicator or data element' | 'Calculated from data elements' | 'Federal: combined from states';
  orgUnitId: string;
  orgUnitName: string;
  level: string;
  periodId: string;
  aspire: number | null;
  dhis2: number | null;
  difference: number | null;
  result: 'MATCH' | 'MISMATCH' | 'BOTH_EMPTY' | 'ONLY_ASPIRE' | 'ONLY_DHIS2';
}

function components(expression: string | null): string[] {
  return (expression ?? '').split('+').map((part) => part.trim()).filter(Boolean);
}

function unitFactor(unit: IndicatorDefinition['unit']): number {
  if (unit === 'PERCENT') return 100;
  if (unit === 'RATE_PER_1000') return 1000;
  if (unit === 'RATE_PER_100000') return 100000;
  return 1;
}

/** A deterministic sample: federal, each state, and two LGAs, one ward and two facilities per state. */
async function sampleUnits(): Promise<Unit[]> {
  const units = await query<Unit>(
    `SELECT id, name, level, path FROM org_units WHERE active AND level IN ('COUNTRY', 'STATE') ORDER BY level, name`,
  );
  const states = units.filter((unit) => unit.level === 'STATE');
  for (const state of states) {
    for (const [level, count] of [['LGA', 2], ['WARD', 1], ['FACILITY', 2]] as const) {
      // Units with data in the latest sampled period, so the comparison tests values, not absences.
      const picked = await query<Unit>(
        `SELECT u.id, u.name, u.level, u.path FROM org_units u
          WHERE u.active AND u.level = $1 AND u.path LIKE $2
            AND EXISTS (SELECT 1 FROM observations o WHERE o.org_unit_id = u.id AND o.period_id = $3 AND o.disaggregation = '')
          ORDER BY md5(u.id) LIMIT $4`,
        [level, `%/${state.id}/%`, PERIODS[PERIODS.length - 1], count],
      );
      units.push(...picked);
    }
  }
  return units;
}

export interface ReconciliationResult {
  reconciledAt: string;
  source: string;
  periods: string[];
  durationMs: number;
  summary: {
    indicators: number;
    orgUnits: number;
    compared: number;
    matched: number;
    mismatched: number;
    onlyDhis2: number;
    onlyAspire: number;
    bothEmpty: number;
    maxDifference: number;
  };
  comparisons: Comparison[];
}

export async function runReconciliation(): Promise<ReconciliationResult> {
  const config = readDhis2Config();
  if (!config) throw new Error('DHIS2 is not configured: set DHIS2_BASE_URL and DHIS2_TOKEN.');
  const started = Date.now();
  const client = new Dhis2Client(config);
  const indicators = (await listIndicators()).filter(isMapped);
  const units = await sampleUnits();
  const federal = units.find((unit) => unit.level === 'COUNTRY');
  const states = units.filter((unit) => unit.level === 'STATE');
  const queried = units.filter((unit) => unit.level !== 'COUNTRY');

  // Everything DHIS2 needs to answer, in one request per period.
  const dx = [
    ...new Set(
      indicators.flatMap((indicator) =>
        indicator.source.dx
          ? [indicator.source.dx]
          : [...components(indicator.source.numeratorDx), ...components(indicator.source.denominatorDx)],
      ),
    ),
  ];
  const dhis2 = new Map<string, { value: number; numerator: number | null; denominator: number | null }>();
  for (const periodId of PERIODS) {
    const response = await client.analytics({
      dx,
      pe: [periodId],
      ou: queried.map((unit) => unit.id),
      includeNumDen: true,
    });
    const col = new Map(response.headers.map((header, index) => [header.name, index]));
    const num = (cell: string | undefined) => (cell === undefined || cell.trim() === '' ? null : Number(cell));
    for (const row of response.rows) {
      dhis2.set(`${row[col.get('dx')!]}|${row[col.get('ou')!]}|${row[col.get('pe')!]}`, {
        value: Number(row[col.get('value')!]),
        numerator: num(row[col.get('numerator')!]),
        denominator: num(row[col.get('denominator')!]),
      });
    }
  }

  /** DHIS2's figure for an indicator at a unit, rebuilt from components where calculated. */
  const expected = (indicator: IndicatorDefinition, unitId: string, periodId: string) => {
    if (indicator.source.dx) return dhis2.get(`${indicator.source.dx}|${unitId}|${periodId}`) ?? null;
    const parts = (expression: string | null) =>
      components(expression).map((uid) => dhis2.get(`${uid}|${unitId}|${periodId}`)?.value);
    const numerators = parts(indicator.source.numeratorDx);
    if (numerators.every((value) => value === undefined)) return null;
    const numerator = numerators.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const denominator = parts(indicator.source.denominatorDx).reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (denominator <= 0) return null;
    return { value: (numerator / denominator) * unitFactor(indicator.unit), numerator, denominator };
  };

  const stored = await query<{ indicator_id: string; org_unit_id: string; period_id: string; value: number }>(
    `SELECT indicator_id, org_unit_id, period_id, value FROM observations
      WHERE disaggregation = '' AND period_id = ANY($1) AND org_unit_id = ANY($2)`,
    [PERIODS, units.map((unit) => unit.id)],
  );
  const aspire = new Map(stored.map((row) => [`${row.indicator_id}|${row.org_unit_id}|${row.period_id}`, Number(row.value)]));

  const comparisons: Comparison[] = [];
  for (const indicator of indicators) {
    for (const unit of units) {
      for (const periodId of PERIODS) {
        let reference: number | null = null;
        let method: Comparison['method'] = indicator.source.dx
          ? 'DHIS2 indicator or data element'
          : 'Calculated from data elements';
        if (unit === federal) {
          // DHIS2 will not serve the federal unit to this account; rebuild it
          // from the states exactly as documented: ratios from summed
          // numerators and denominators, counts summed, only if both states report.
          method = 'Federal: combined from states';
          const parts = states.map((state) => expected(indicator, state.id, periodId));
          if (parts.every((part) => part !== null)) {
            const all = parts as Array<{ value: number; numerator: number | null; denominator: number | null }>;
            if (all.every((part) => part.numerator !== null && part.denominator !== null)) {
              const n = all.reduce((sum, part) => sum + part.numerator!, 0);
              const d = all.reduce((sum, part) => sum + part.denominator!, 0);
              const sample = all.find((part) => part.numerator && part.denominator);
              const factor = sample ? (sample.value * sample.denominator!) / sample.numerator! : unitFactor(indicator.unit);
              reference = d > 0 ? (factor * n) / d : null;
            } else if (all.every((part) => part.numerator === null && part.denominator === null)) {
              reference = all.reduce((sum, part) => sum + part.value, 0);
            }
          }
        } else {
          reference = expected(indicator, unit.id, periodId)?.value ?? null;
        }
        const ours = aspire.get(`${indicator.id}|${unit.id}|${periodId}`) ?? null;
        const difference = ours !== null && reference !== null ? Math.abs(ours - reference) : null;
        comparisons.push({
          indicatorId: indicator.id,
          indicatorName: indicator.name,
          method,
          orgUnitId: unit.id,
          orgUnitName: unit.name,
          level: unit.level,
          periodId,
          aspire: ours,
          dhis2: reference,
          difference,
          result:
            ours === null && reference === null
              ? 'BOTH_EMPTY'
              : ours === null
                ? 'ONLY_DHIS2'
                : reference === null
                  ? 'ONLY_ASPIRE'
                  : difference! <= TOLERANCE
                    ? 'MATCH'
                    : 'MISMATCH',
        });
      }
    }
  }

  const count = (result: Comparison['result']) => comparisons.filter((c) => c.result === result).length;
  return {
    reconciledAt: new Date().toISOString(),
    source: config.baseUrl,
    periods: PERIODS,
    durationMs: Date.now() - started,
    summary: {
      indicators: indicators.length,
      orgUnits: units.length,
      compared: comparisons.length - count('BOTH_EMPTY'),
      matched: count('MATCH'),
      mismatched: count('MISMATCH'),
      onlyDhis2: count('ONLY_DHIS2'),
      onlyAspire: count('ONLY_ASPIRE'),
      bothEmpty: count('BOTH_EMPTY'),
      maxDifference: Math.max(0, ...comparisons.map((c) => c.difference ?? 0)),
    },
    comparisons,
  };
}

const LAST_RESULT = 'validation.reconciliation';

/** Stores a result as the latest, for Admin → Data validation. */
export async function saveReconciliation(result: ReconciliationResult): Promise<void> {
  await setSetting(LAST_RESULT, JSON.stringify(result));
}

export async function getLastReconciliation(): Promise<ReconciliationResult | null> {
  const raw = await getSetting(LAST_RESULT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReconciliationResult;
  } catch {
    return null;
  }
}
