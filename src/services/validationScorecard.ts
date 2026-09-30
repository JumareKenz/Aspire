import { isInScope } from '@/auth/rbac';
import { execute, query, queryOne } from '@/data/db/client';
import type { User } from '@/data/repositories/users';
import { getOrgUnit, getRootOrgUnit } from '@/data/repositories/orgUnits';
import { listIndicators } from '@/data/repositories/registry';
import { Dhis2Client, Dhis2Error, readDhis2Config } from '@/data/sources/dhis2/client';
import { ApiError } from '@/lib/api';
import { defaultPeriodId } from './scorecards';

/**
 * The facility validation scorecard.
 *
 * DHIS2's validation rules (e.g. "ANC 4th visits ≤ total ANC attendance") are
 * run for every facility and month through the read-only per-facility route,
 * because the service account cannot trigger DHIS2's bulk analysis and the
 * results DHIS2 has stored are too patchy to tell "passed" from "not checked".
 *
 * Every facility-month checked is recorded, with whether the facility
 * submitted its form that month: an unreported month has nothing to validate,
 * and would otherwise read as a clean pass.
 *
 * The work is resumable. `runValidationBatch` checks whatever is still
 * outstanding until its time budget runs out, so it can be driven by a script,
 * a nightly cron or a button without any of them needing to finish in one go.
 */

/** Months covered, ending with the last month of the platform's default period. */
const WINDOW_MONTHS = 12;
const CONCURRENCY = 6;
const RECHECK_MONTHS = 2;

export interface ScorecardWindow {
  datasetId: string;
  /** Monthly periods, YYYYMM, oldest first. */
  months: string[];
}

export function monthsEnding(lastMonth: string, count: number): string[] {
  let year = Number(lastMonth.slice(0, 4));
  let month = Number(lastMonth.slice(4));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.unshift(`${year}${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

export function monthBounds(month: string): { start: string; end: string } {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(4));
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { start: `${year}-${month.slice(4)}-01`, end: `${year}-${month.slice(4)}-${String(last).padStart(2, '0')}` };
}

/** The form whose rules are run (the one the registry's indicators are reported through) and the months covered. */
export async function scorecardWindow(): Promise<ScorecardWindow | null> {
  const counts = new Map<string, number>();
  for (const indicator of await listIndicators()) {
    const id = indicator.source.datasetId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const datasetId = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!datasetId) return null;

  const period = await defaultPeriodId();
  const quarter = /^(\d{4})Q([1-4])$/.exec(period);
  const lastMonth = quarter ? `${quarter[1]}${String(Number(quarter[2]) * 3).padStart(2, '0')}` : period.slice(0, 6);
  return { datasetId, months: monthsEnding(lastMonth, WINDOW_MONTHS) };
}

/**
 * Facilities expected to submit the form: those the last sync recorded
 * reporting rows for, which is DHIS2's own assignment of the form to units.
 */
const EXPECTED = `
  SELECT DISTINCT u.id, u.path
    FROM reporting r JOIN org_units u ON u.id = r.org_unit_id
   WHERE r.dataset_id = $1 AND u.active AND u.level = 'FACILITY'`;

export interface Coverage {
  datasetId: string;
  months: string[];
  facilities: number;
  total: number;
  checked: number;
  remaining: number;
  lastCheckedAt: string | null;
}

export async function getCoverage(): Promise<Coverage | null> {
  const window = await scorecardWindow();
  if (!window) return null;
  const row = await queryOne<{ facilities: string; checked: string; last: string | null }>(
    `WITH expected AS (${EXPECTED})
     SELECT (SELECT COUNT(*) FROM expected) AS facilities,
            (SELECT COUNT(*) FROM validation_checks c JOIN expected e ON e.id = c.org_unit_id
              WHERE c.dataset_id = $1 AND c.period_id = ANY($2)) AS checked,
            (SELECT MAX(checked_at)::text FROM validation_checks WHERE dataset_id = $1) AS last`,
    [window.datasetId, window.months],
  );
  const facilities = Number(row?.facilities ?? 0);
  const total = facilities * window.months.length;
  const checked = Number(row?.checked ?? 0);
  return { ...window, facilities, total, checked, remaining: Math.max(0, total - checked), lastCheckedAt: row?.last ?? null };
}

export interface BatchResult extends Coverage {
  /** Facility-months checked in this batch. */
  done: number;
  /** Facility-months DHIS2 failed to answer; left for the next batch. */
  failed: number;
}

/**
 * Checks outstanding facility-months, latest month first, until the time
 * budget is spent or nothing is left.
 */
export async function runValidationBatch(options: { budgetMs: number; limit?: number }): Promise<BatchResult> {
  const config = readDhis2Config();
  if (!config) throw new ApiError('No DHIS2 instance is connected.', 409);
  const window = await scorecardWindow();
  if (!window) throw new ApiError('No indicator names a form to validate.', 409);
  const client = new Dhis2Client(config);
  const deadline = Date.now() + options.budgetMs;

  const pending = await query<{ id: string; month: string }>(
    `WITH expected AS (${EXPECTED})
     SELECT e.id, m.month
       FROM expected e CROSS JOIN unnest($2::text[]) AS m(month)
       LEFT JOIN validation_checks c ON c.org_unit_id = e.id AND c.dataset_id = $1 AND c.period_id = m.month
      WHERE c.org_unit_id IS NULL
         OR (m.month = ANY($4) AND c.checked_at < NOW() - INTERVAL '7 days')
      ORDER BY (c.org_unit_id IS NULL) DESC, m.month DESC, e.id
      LIMIT $3`,
    // Late and corrected reports change the answer, so the latest months are
    // checked again each week; older months are settled.
    [window.datasetId, window.months, options.limit ?? 6000, window.months.slice(-RECHECK_MONTHS)],
  );

  // Rule details, and who submitted the form each month, are looked up once.
  const rules = new Map((pending.length > 0 ? await client.validationRules() : []).map((rule) => [rule.id, rule]));
  const states = (await query<{ id: string }>("SELECT id FROM org_units WHERE level = 'STATE' AND active")).map((row) => row.id);
  const submitted = new Map<string, Promise<Set<string>>>();
  const submittedIn = (month: string) => {
    if (!submitted.has(month)) {
      const { start, end } = monthBounds(month);
      submitted.set(
        month,
        client
          .completeDataSetRegistrations({ dataSet: [window.datasetId], startDate: start, endDate: end, orgUnit: states, children: true })
          .then(
            (response) =>
              new Set(
                (response.completeDataSetRegistrations ?? [])
                  .filter((registration) => registration.completed !== false && registration.period === month)
                  .map((registration) => registration.organisationUnit),
              ),
          ),
      );
    }
    return submitted.get(month)!;
  };

  let next = 0;
  let done = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  const worker = async () => {
    while (next < pending.length && Date.now() < deadline && consecutiveFailures < 12) {
      const item = pending[next];
      next += 1;
      try {
        const [reported, response] = await Promise.all([
          submittedIn(item.month),
          client.validateDataSet(window.datasetId, item.month, item.id),
        ]);
        const violations = response.validationRuleViolations ?? [];
        const byRule = new Map(violations.map((violation) => [violation.validationRule?.id ?? '', violation]));
        byRule.delete('');
        await execute(
          'DELETE FROM validation_violations WHERE org_unit_id = $1 AND dataset_id = $2 AND period_id = $3',
          [item.id, window.datasetId, item.month],
        );
        for (const [ruleId, violation] of byRule) {
          const rule = rules.get(ruleId);
          await execute(
            `INSERT INTO validation_violations
               (org_unit_id, dataset_id, period_id, rule_id, rule_name, importance, operator, left_desc, left_value, right_desc, right_value)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (org_unit_id, dataset_id, period_id, rule_id) DO UPDATE SET
               left_value = EXCLUDED.left_value, right_value = EXCLUDED.right_value`,
            [
              item.id, window.datasetId, item.month, ruleId,
              rule?.displayName ?? violation.validationRule?.displayName ?? violation.validationRule?.name ?? 'Unnamed rule',
              rule?.importance ?? null, rule?.operator ?? null,
              rule?.leftSide?.description ?? null, violation.leftsideValue ?? null,
              rule?.rightSide?.description ?? null, violation.rightsideValue ?? null,
            ],
          );
        }
        await execute(
          `INSERT INTO validation_checks (org_unit_id, dataset_id, period_id, reported, violations, checked_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (org_unit_id, dataset_id, period_id) DO UPDATE SET
             reported = EXCLUDED.reported, violations = EXCLUDED.violations, checked_at = EXCLUDED.checked_at`,
          // Data entered without the form being marked complete is still a
          // report: a rule cannot fail on nothing.
          [item.id, window.datasetId, item.month, reported.has(item.id) || byRule.size > 0, byRule.size],
        );
        done += 1;
        consecutiveFailures = 0;
      } catch (error) {
        if (!(error instanceof Dhis2Error)) throw error;
        failed += 1;
        consecutiveFailures += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

  const coverage = (await getCoverage())!;
  return { ...coverage, done, failed };
}

export interface FacilityScorecard {
  scope: { id: string; name: string; level: string };
  coverage: Coverage;
  summary: {
    checked: number;
    reported: number;
    noReport: number;
    clean: number;
    withViolations: number;
    violations: number;
    /** Reported facility-months with no rule broken, as a percentage of those reported. */
    passRate: number | null;
  };
  byMonth: Array<{ month: string; reported: number; clean: number; passRate: number | null; violations: number }>;
  byArea: Array<{ id: string; name: string; kind: 'LGA' | 'FACILITY'; facilities: number; reported: number; clean: number; passRate: number | null; violations: number }>;
  byRule: Array<{ rule: string; importance: string | null; operator: string | null; left: string | null; right: string | null; violations: number; facilities: number }>;
  worst: Array<{ id: string; name: string; lga: string; violations: number; monthsFailed: number; monthsReported: number }>;
}

const rate = (clean: number, reported: number) => (reported > 0 ? Math.round((clean / reported) * 1000) / 10 : null);

/** The scorecard for an area the user may see (their root when none is given). */
export async function getFacilityScorecard(user: User, orgUnitId: string | null): Promise<FacilityScorecard | null> {
  const coverage = await getCoverage();
  if (!coverage) return null;
  // Without a chosen area, a scoped user starts at their own area, not the root.
  const startId = orgUnitId ?? user.scope[0] ?? null;
  const scope = startId ? await getOrgUnit(startId) : await getRootOrgUnit();
  if (!scope) return null;
  if (!isInScope(user.scope, scope.path)) throw new ApiError('That area is outside your access.', 403);

  const params = [coverage.datasetId, coverage.months, `%/${scope.id}/%`, scope.id];
  const SCOPED = `
    SELECT c.org_unit_id, c.period_id, c.reported, c.violations, u.name, u.path
      FROM validation_checks c JOIN org_units u ON u.id = c.org_unit_id
     WHERE c.dataset_id = $1 AND c.period_id = ANY($2) AND u.active AND (u.path LIKE $3 OR u.id = $4)`;
  const byFacility = scope.level === 'LGA' || scope.level === 'WARD';

  const [summary, months, areas, rules, worst] = await Promise.all([
    queryOne<Record<string, string>>(
      `WITH s AS (${SCOPED})
       SELECT COUNT(*) AS checked, COUNT(*) FILTER (WHERE reported) AS reported,
              COUNT(*) FILTER (WHERE reported AND violations = 0) AS clean,
              COUNT(*) FILTER (WHERE reported AND violations > 0) AS failing,
              COALESCE(SUM(violations) FILTER (WHERE reported), 0) AS violations FROM s`,
      params,
    ),
    query<Record<string, string>>(
      `WITH s AS (${SCOPED})
       SELECT period_id AS month, COUNT(*) FILTER (WHERE reported) AS reported,
              COUNT(*) FILTER (WHERE reported AND violations = 0) AS clean,
              COALESCE(SUM(violations) FILTER (WHERE reported), 0) AS violations
         FROM s GROUP BY period_id ORDER BY period_id`,
      params,
    ),
    byFacility
      ? query<Record<string, string>>(
          `WITH s AS (${SCOPED})
           SELECT org_unit_id AS id, name, 1 AS facilities, COUNT(*) FILTER (WHERE reported) AS reported,
                  COUNT(*) FILTER (WHERE reported AND violations = 0) AS clean,
                  COALESCE(SUM(violations) FILTER (WHERE reported), 0) AS violations
             FROM s GROUP BY org_unit_id, name`,
          params,
        )
      : query<Record<string, string>>(
          `WITH s AS (${SCOPED})
           SELECT l.id, l.name, COUNT(DISTINCT s.org_unit_id) AS facilities, COUNT(*) FILTER (WHERE s.reported) AS reported,
                  COUNT(*) FILTER (WHERE s.reported AND s.violations = 0) AS clean,
                  COALESCE(SUM(s.violations) FILTER (WHERE s.reported), 0) AS violations
             FROM s JOIN org_units l ON l.level = 'LGA' AND l.active AND s.path LIKE '%/' || l.id || '/%'
            GROUP BY l.id, l.name`,
          params,
        ),
    query<Record<string, string>>(
      `SELECT v.rule_name AS rule, MAX(v.importance) AS importance, MAX(v.operator) AS operator,
              MAX(v.left_desc) AS left, MAX(v.right_desc) AS right,
              COUNT(*) AS violations, COUNT(DISTINCT v.org_unit_id) AS facilities
         FROM validation_violations v JOIN org_units u ON u.id = v.org_unit_id
        WHERE v.dataset_id = $1 AND v.period_id = ANY($2) AND u.active AND (u.path LIKE $3 OR u.id = $4)
        GROUP BY v.rule_name ORDER BY COUNT(*) DESC LIMIT 40`,
      params,
    ),
    query<Record<string, string>>(
      `WITH s AS (${SCOPED})
       SELECT s.org_unit_id AS id, s.name,
              COALESCE((SELECT l.name FROM org_units l WHERE l.level = 'LGA' AND s.path LIKE '%/' || l.id || '/%' LIMIT 1), '') AS lga,
              SUM(s.violations) AS violations, COUNT(*) FILTER (WHERE s.violations > 0) AS failed,
              COUNT(*) FILTER (WHERE s.reported) AS reported
         FROM s WHERE s.reported GROUP BY s.org_unit_id, s.name, s.path
        HAVING SUM(s.violations) > 0 ORDER BY SUM(s.violations) DESC LIMIT 25`,
      params,
    ),
  ]);

  const n = (value: string | undefined) => Number(value ?? 0);
  const short = (name: string) => name.replace(/ Local Government Area$/, '');
  return {
    scope: { id: scope.id, name: scope.name, level: scope.level },
    coverage,
    summary: {
      checked: n(summary?.checked),
      reported: n(summary?.reported),
      noReport: n(summary?.checked) - n(summary?.reported),
      clean: n(summary?.clean),
      withViolations: n(summary?.failing),
      violations: n(summary?.violations),
      passRate: rate(n(summary?.clean), n(summary?.reported)),
    },
    byMonth: months.map((row) => ({
      month: row.month,
      reported: n(row.reported),
      clean: n(row.clean),
      passRate: rate(n(row.clean), n(row.reported)),
      violations: n(row.violations),
    })),
    byArea: areas
      .map((row) => ({
        id: row.id,
        name: short(row.name),
        kind: (byFacility ? 'FACILITY' : 'LGA') as 'LGA' | 'FACILITY',
        facilities: n(row.facilities),
        reported: n(row.reported),
        clean: n(row.clean),
        passRate: rate(n(row.clean), n(row.reported)),
        violations: n(row.violations),
      }))
      .sort((a, b) => (a.passRate ?? 101) - (b.passRate ?? 101) || b.violations - a.violations),
    byRule: rules.map((row) => ({
      rule: row.rule,
      importance: row.importance ?? null,
      operator: row.operator ?? null,
      left: row.left ?? null,
      right: row.right ?? null,
      violations: n(row.violations),
      facilities: n(row.facilities),
    })),
    worst: worst.map((row) => ({
      id: row.id,
      name: row.name,
      lga: short(row.lga),
      violations: n(row.violations),
      monthsFailed: n(row.failed),
      monthsReported: n(row.reported),
    })),
  };
}
