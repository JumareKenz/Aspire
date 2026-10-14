import { chunk, execute, query, valuesClause } from '../db/client';
import type { Observation, Period, ReportingRecord, Target } from '@/core/model/types';

export async function upsertObservations(observations: Observation[]): Promise<void> {
  if (observations.length === 0) return;
  for (const batch of chunk(observations, 7)) {
    const { text, params } = valuesClause(
      batch.map((row) => [
        row.indicatorId,
        row.orgUnitId,
        row.periodId,
        row.disaggregation ?? '',
        row.value,
        row.numerator,
        row.denominator,
      ]),
    );
    await execute(
      `INSERT INTO observations (indicator_id, org_unit_id, period_id, disaggregation, value, numerator, denominator)
       VALUES ${text}
       ON CONFLICT (indicator_id, org_unit_id, period_id, disaggregation) DO UPDATE SET
         value = EXCLUDED.value, numerator = EXCLUDED.numerator, denominator = EXCLUDED.denominator`,
      params,
    );
  }
}

interface ObsRow {
  indicator_id: string;
  org_unit_id: string;
  period_id: string;
  disaggregation: string;
  value: number;
  numerator: number | null;
  denominator: number | null;
}

function toObservation(row: ObsRow): Observation {
  return {
    indicatorId: row.indicator_id,
    orgUnitId: row.org_unit_id,
    periodId: row.period_id,
    disaggregation: row.disaggregation === '' ? null : row.disaggregation,
    value: row.value,
    numerator: row.numerator,
    denominator: row.denominator,
  };
}

/** Total (non-disaggregated) observations for a set of org units and periods. */
export async function getObservations(
  orgUnitIds: string[],
  periodIds: string[],
): Promise<Observation[]> {
  if (orgUnitIds.length === 0 || periodIds.length === 0) return [];
  const rows = await query<ObsRow>(
    `SELECT * FROM observations
     WHERE disaggregation = '' AND org_unit_id = ANY($1) AND period_id = ANY($2)`,
    [orgUnitIds, periodIds],
  );
  return rows.map(toObservation);
}

/** Breakdown rows ("<label>:<option>" → count) for one indicator, unit and period. */
export async function getBreakdown(
  indicatorId: string,
  orgUnitId: string,
  periodId: string,
): Promise<Array<{ key: string; value: number }>> {
  const rows = await query<{ disaggregation: string; value: number }>(
    `SELECT disaggregation, value FROM observations
     WHERE indicator_id = $1 AND org_unit_id = $2 AND period_id = $3 AND disaggregation <> ''`,
    [indicatorId, orgUnitId, periodId],
  );
  return rows.map((row) => ({ key: row.disaggregation, value: Number(row.value) }));
}

/**
 * Value series per indicator for one org unit, aligned to `periods` and oldest
 * first. Absent periods are null rather than dropped, so the scoring engine's
 * missing-data rule sees the gaps.
 */
export async function getSeries(
  orgUnitId: string,
  periods: Period[],
  indicatorIds: string[],
): Promise<Record<string, Array<number | null>>> {
  const byUnit = await getSeriesForUnits([orgUnitId], periods, indicatorIds);
  return byUnit.get(orgUnitId) ?? {};
}

/** Series for many org units at once, keyed by org unit then indicator. */
export async function getSeriesForUnits(
  orgUnitIds: string[],
  periods: Period[],
  indicatorIds: string[],
): Promise<Map<string, Record<string, Array<number | null>>>> {
  const result = new Map<string, Record<string, Array<number | null>>>();
  for (const orgUnitId of orgUnitIds) {
    const empty: Record<string, Array<number | null>> = {};
    for (const indicatorId of indicatorIds) {
      empty[indicatorId] = new Array<number | null>(periods.length).fill(null);
    }
    result.set(orgUnitId, empty);
  }
  if (orgUnitIds.length === 0 || periods.length === 0 || indicatorIds.length === 0) return result;

  const index = new Map(periods.map((period, i) => [period.id, i]));
  const rows = await query<ObsRow>(
    `SELECT * FROM observations
     WHERE disaggregation = ''
       AND org_unit_id = ANY($1) AND period_id = ANY($2) AND indicator_id = ANY($3)`,
    [orgUnitIds, periods.map((p) => p.id), indicatorIds],
  );

  for (const row of rows) {
    const position = index.get(row.period_id);
    const unit = result.get(row.org_unit_id);
    if (position === undefined || !unit) continue;
    const series = unit[row.indicator_id];
    if (series) series[position] = row.value;
  }
  return result;
}

export async function upsertPeriods(periods: Period[]): Promise<void> {
  if (periods.length === 0) return;
  const { text, params } = valuesClause(
    periods.map((period) => [period.id, period.type, period.startDate, period.endDate, period.label]),
  );
  await execute(
    `INSERT INTO periods (id, type, start_date, end_date, label) VALUES ${text}
     ON CONFLICT (id) DO NOTHING`,
    params,
  );
}

export async function upsertReporting(records: ReportingRecord[]): Promise<void> {
  if (records.length === 0) return;
  for (const batch of chunk(records, 7)) {
    const { text, params } = valuesClause(
      batch.map((record) => [
        record.orgUnitId,
        record.datasetId,
        record.periodId,
        record.expected,
        record.reported,
        record.submittedAt,
        record.dueDate,
      ]),
    );
    await execute(
      `INSERT INTO reporting (org_unit_id, dataset_id, period_id, expected, reported, submitted_at, due_date)
       VALUES ${text}
       ON CONFLICT (org_unit_id, dataset_id, period_id) DO UPDATE SET
         expected = EXCLUDED.expected, reported = EXCLUDED.reported,
         submitted_at = EXCLUDED.submitted_at, due_date = EXCLUDED.due_date`,
      params,
    );
  }
}

interface ReportingRow {
  org_unit_id: string;
  dataset_id: string;
  period_id: string;
  expected: boolean;
  reported: boolean;
  submitted_at: Date | null;
  due_date: Date;
}

/** Dates come back from pg as Date objects; the canonical model uses ISO strings. */
function isoDate(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function isoDateTime(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

export async function getReporting(
  orgUnitIds: string[],
  periodIds: string[],
): Promise<ReportingRecord[]> {
  if (orgUnitIds.length === 0 || periodIds.length === 0) return [];
  const rows = await query<ReportingRow>(
    'SELECT * FROM reporting WHERE org_unit_id = ANY($1) AND period_id = ANY($2)',
    [orgUnitIds, periodIds],
  );
  return rows.map((row) => ({
    orgUnitId: row.org_unit_id,
    datasetId: row.dataset_id,
    periodId: row.period_id,
    expected: row.expected,
    reported: row.reported,
    submittedAt: isoDateTime(row.submitted_at),
    dueDate: isoDate(row.due_date),
  }));
}

export async function upsertTargets(targets: Target[]): Promise<void> {
  if (targets.length === 0) return;
  for (const batch of chunk(targets, 4)) {
    const { text, params } = valuesClause(
      batch.map((target) => [
        target.indicatorId,
        target.orgUnitId ?? '',
        target.periodId ?? '',
        target.value,
      ]),
    );
    await execute(
      `INSERT INTO targets (indicator_id, org_unit_id, period_id, value) VALUES ${text}
       ON CONFLICT (indicator_id, org_unit_id, period_id) DO UPDATE SET value = EXCLUDED.value`,
      params,
    );
  }
}

/** Ids of the stored periods of one type, oldest first: the months a sync has actually imported. */
export async function listStoredPeriodIds(type: Period['type']): Promise<string[]> {
  const rows = await query<{ id: string }>('SELECT id FROM periods WHERE type = $1 ORDER BY start_date', [type]);
  return rows.map((row) => row.id);
}
