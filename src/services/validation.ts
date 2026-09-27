import type { OrgLevel } from '@/core/model/types';
import { isInScope } from '@/auth/rbac';
import { query } from '@/data/db/client';
import type { User } from '@/data/repositories/users';
import { getOrgUnit, listChildren } from '@/data/repositories/orgUnits';
import { listSyncRuns, type SyncRun } from '@/data/repositories/syncRuns';
import { getDataMode } from '@/data/repositories/settings';
import { Dhis2Client, Dhis2Error, readDhis2Config } from '@/data/sources/dhis2/client';
import { ApiError } from '@/lib/api';
import { getLastReconciliation, type ReconciliationResult } from './reconciliation';

/**
 * Admin → Data validation: the evidence that the platform's figures can be
 * trusted, in one place. ASPIRE's own checks (sync runs, reconciliation against
 * DHIS2, the quality scan) sit beside DHIS2's (outlier detection and a form's
 * validation rules), and every DHIS2 check runs server-side with the service
 * account, limited to the user's areas.
 */

function client(): Dhis2Client {
  const config = readDhis2Config();
  if (!config) throw new ApiError('No DHIS2 instance is connected.', 409);
  return new Dhis2Client(config);
}

const cleanName = (name: string) => name.replace(/^[a-z]{2}\s+(?=[A-Z0-9])/, '').trim();

export interface ValidationOverview {
  source: { mode: 'DEMO' | 'DHIS2'; url: string | null };
  runs: SyncRun[];
  reconciliation: ReconciliationResult | null;
  reporting: { records: number };
  findings: {
    open: number;
    bySeverity: Record<'HIGH' | 'MEDIUM' | 'LOW', number>;
    byDimension: Array<{ dimension: string; count: number }>;
    byIndicator: Array<{ indicator: string; count: number; high: number }>;
    byPeriod: Array<{ periodId: string; count: number }>;
    byLevel: Array<{ level: OrgLevel; count: number }>;
  };
}

/** Everything the overview needs, in a handful of aggregate queries. */
export async function getValidationOverview(): Promise<ValidationOverview> {
  const [mode, runs, reconciliation, reporting, severity, dimension, indicator, period, level] = await Promise.all([
    getDataMode(),
    listSyncRuns(8),
    getLastReconciliation(),
    query<{ n: string }>('SELECT COUNT(*) AS n FROM reporting'),
    query<{ severity: string; n: string }>(
      "SELECT severity, COUNT(*) AS n FROM quality_findings WHERE status = 'OPEN' GROUP BY severity",
    ),
    query<{ dimension: string; n: string }>(
      "SELECT dimension, COUNT(*) AS n FROM quality_findings WHERE status = 'OPEN' GROUP BY dimension ORDER BY 2 DESC",
    ),
    query<{ indicator: string; n: string; high: string }>(
      `SELECT indicator_name AS indicator, COUNT(*) AS n, COUNT(*) FILTER (WHERE severity = 'HIGH') AS high
         FROM quality_findings WHERE status = 'OPEN' AND indicator_name IS NOT NULL
        GROUP BY indicator_name ORDER BY 2 DESC LIMIT 12`,
    ),
    query<{ period_id: string; n: string }>(
      "SELECT period_id, COUNT(*) AS n FROM quality_findings WHERE status = 'OPEN' GROUP BY period_id ORDER BY period_id",
    ),
    query<{ level: string; n: string }>(
      `SELECT u.level, COUNT(*) AS n FROM quality_findings f JOIN org_units u ON u.id = f.org_unit_id
        WHERE f.status = 'OPEN' GROUP BY u.level`,
    ),
  ]);
  const bySeverity = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of severity) bySeverity[row.severity as keyof typeof bySeverity] = Number(row.n);
  const order: OrgLevel[] = ['COUNTRY', 'STATE', 'LGA', 'WARD', 'FACILITY'];
  return {
    source: { mode, url: readDhis2Config()?.baseUrl ?? null },
    runs,
    reconciliation,
    reporting: { records: Number(reporting[0]?.n ?? 0) },
    findings: {
      open: bySeverity.HIGH + bySeverity.MEDIUM + bySeverity.LOW,
      bySeverity,
      byDimension: dimension.map((row) => ({ dimension: row.dimension, count: Number(row.n) })),
      byIndicator: indicator.map((row) => ({ indicator: row.indicator, count: Number(row.n), high: Number(row.high) })),
      byPeriod: period.map((row) => ({ periodId: row.period_id, count: Number(row.n) })),
      byLevel: level
        .map((row) => ({ level: row.level as OrgLevel, count: Number(row.n) }))
        .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)),
    },
  };
}

/** The DHIS2 org units a check may run on: the unit itself, or the states beneath the federal tier. */
async function scopedUnits(user: User, orgUnitId: string): Promise<string[]> {
  const unit = await getOrgUnit(orgUnitId);
  if (!unit || !unit.active || !isInScope(user.scope, unit.path)) {
    throw new ApiError('That area is outside your access.', 403);
  }
  if (unit.level === 'COUNTRY') return (await listChildren(unit.id)).map((child) => child.id);
  return [unit.id];
}

const UID = /^[A-Za-z0-9]{11}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface OutlierRow {
  dataElement: string;
  facility: string;
  period: string;
  category: string | null;
  value: number;
  median: number | null;
  mean: number | null;
  lower: number | null;
  upper: number | null;
  zScore: number | null;
}

/**
 * DHIS2's outlier detection for chosen data elements under one area. It works
 * on raw facility-level values, so it finds the single facility-month that an
 * aggregate would hide.
 */
export async function runOutlierCheck(
  user: User,
  input: {
    dataElements: string[];
    orgUnit: string;
    startDate: string;
    endDate: string;
    algorithm: 'Z_SCORE' | 'MOD_Z_SCORE' | 'MIN_MAX';
    threshold: number | null;
  },
): Promise<{ rows: OutlierRow[]; truncated: boolean }> {
  if (input.dataElements.length === 0 || input.dataElements.length > 20 || !input.dataElements.every((id) => UID.test(id))) {
    throw new ApiError('Choose between one and 20 data elements.', 400);
  }
  if (!DATE.test(input.startDate) || !DATE.test(input.endDate) || input.startDate > input.endDate) {
    throw new ApiError('Choose a valid date range.', 400);
  }
  // DHIS2 scans every raw facility value beneath the area. A whole state is
  // more than its gateway allows (about 60 s), so the check runs per LGA.
  const unit = await getOrgUnit(input.orgUnit);
  if (unit && (unit.level === 'COUNTRY' || unit.level === 'STATE')) {
    throw new ApiError('Choose an LGA or smaller area. DHIS2 cannot scan a whole state within its time limit.', 400);
  }
  const orgUnits = await scopedUnits(user, input.orgUnit);
  const maxResults = 500;
  try {
    const response = await client().outliers({
      dataElements: input.dataElements,
      orgUnits,
      startDate: input.startDate,
      endDate: input.endDate,
      algorithm: input.algorithm,
      threshold: input.threshold ?? undefined,
      maxResults,
    });
    const rows = (response.outlierValues ?? []).map((row) => ({
      dataElement: row.deName,
      facility: cleanName(row.ouName),
      period: row.pe,
      category: row.cocName && row.cocName !== 'default' ? row.cocName : null,
      value: row.value,
      median: row.median ?? null,
      mean: row.mean ?? null,
      lower: row.lowerBound ?? null,
      upper: row.upperBound ?? null,
      zScore: row.zScore ?? null,
    }));
    return { rows, truncated: rows.length >= maxResults };
  } catch (error) {
    if (error instanceof Dhis2Error) {
      throw new ApiError(
        error.status === 504 || /aborted/i.test(error.message)
          ? 'DHIS2 took too long to scan this. Choose a smaller area, a shorter date range or fewer data elements.'
          : `DHIS2 could not run outlier detection: ${error.message}.`,
        502,
      );
    }
    throw error;
  }
}

declare global {
  var __aspireValidationRules:
    | { at: number; rules: Map<string, Awaited<ReturnType<Dhis2Client['validationRules']>>[number]> }
    | undefined;
}

export interface RuleViolation {
  rule: string;
  importance: string | null;
  left: { description: string | null; value: number | null };
  operator: string | null;
  right: { description: string | null; value: number | null };
  instruction: string | null;
}

/** The forms the service account can read, for choosing which rules to run. */
export async function listCheckableForms(): Promise<Array<{ id: string; name: string }>> {
  const sets = await client().dataSets();
  return sets.map((set) => ({ id: set.id, name: set.displayName })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Runs one form's validation rules for one area and month. DHIS2 validates a
 * form one unit and period at a time through its read-only route; the bulk
 * analysis needs write access the service account does not have.
 */
export async function runRuleCheck(
  user: User,
  input: { dataSet: string; orgUnit: string; period: string },
): Promise<{ violations: RuleViolation[]; unit: string }> {
  if (!UID.test(input.dataSet)) throw new ApiError('Choose a form.', 400);
  if (!/^\d{6}$/.test(input.period)) throw new ApiError('Choose a month.', 400);
  const [orgUnit] = await scopedUnits(user, input.orgUnit);
  const unit = await getOrgUnit(orgUnit);

  const dhis2 = client();
  const cached = globalThis.__aspireValidationRules;
  let rules = cached && Date.now() - cached.at < 60 * 60 * 1000 ? cached.rules : null;
  if (!rules) {
    rules = new Map((await dhis2.validationRules()).map((rule) => [rule.id, rule]));
    globalThis.__aspireValidationRules = { at: Date.now(), rules };
  }

  try {
    const response = await dhis2.validateDataSet(input.dataSet, input.period, orgUnit);
    const violations = (response.validationRuleViolations ?? []).map((violation) => {
      const rule = violation.validationRule ? rules!.get(violation.validationRule.id) : undefined;
      return {
        rule: rule?.displayName ?? violation.validationRule?.displayName ?? violation.validationRule?.name ?? 'Unnamed rule',
        importance: rule?.importance ?? null,
        left: { description: rule?.leftSide?.description ?? null, value: violation.leftsideValue ?? null },
        operator: rule?.operator ?? null,
        right: { description: rule?.rightSide?.description ?? null, value: violation.rightsideValue ?? null },
        instruction: rule?.instruction ?? null,
      };
    });
    return { violations, unit: unit?.name ?? orgUnit };
  } catch (error) {
    if (error instanceof Dhis2Error) throw new ApiError(`DHIS2 could not validate this form: ${error.message}.`, 502);
    throw error;
  }
}
