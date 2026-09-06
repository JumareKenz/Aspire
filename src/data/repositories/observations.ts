import { getDb } from '../db/client';
import type { Observation, Period, ReportingRecord, Target } from '@/core/model/types';

export function upsertObservations(observations: Observation[]): void {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO observations (indicator_id, org_unit_id, period_id, disaggregation, value, numerator, denominator)
     VALUES (@indicator_id, @org_unit_id, @period_id, @disaggregation, @value, @numerator, @denominator)
     ON CONFLICT(indicator_id, org_unit_id, period_id, disaggregation) DO UPDATE SET
       value = excluded.value, numerator = excluded.numerator, denominator = excluded.denominator`,
  );
  const run = db.transaction((rows: Observation[]) => {
    for (const row of rows) {
      statement.run({
        indicator_id: row.indicatorId,
        org_unit_id: row.orgUnitId,
        period_id: row.periodId,
        disaggregation: row.disaggregation ?? '',
        value: row.value,
        numerator: row.numerator,
        denominator: row.denominator,
      });
    }
  });
  run(observations);
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

function placeholders(count: number): string {
  return new Array(count).fill('?').join(',');
}

/** Total (non-disaggregated) observations for a set of org units and periods. */
export function getObservations(orgUnitIds: string[], periodIds: string[]): Observation[] {
  if (orgUnitIds.length === 0 || periodIds.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT * FROM observations
       WHERE disaggregation = ''
         AND org_unit_id IN (${placeholders(orgUnitIds.length)})
         AND period_id IN (${placeholders(periodIds.length)})`,
    )
    .all(...orgUnitIds, ...periodIds) as ObsRow[];
  return rows.map(toObservation);
}

/**
 * Value series per indicator for one org unit, aligned to `periods` and oldest
 * first. Absent periods are null rather than dropped, so the scoring engine's
 * missing-data rule sees the gaps.
 */
export function getSeries(
  orgUnitId: string,
  periods: Period[],
  indicatorIds: string[],
): Record<string, Array<number | null>> {
  const result: Record<string, Array<number | null>> = {};
  for (const indicatorId of indicatorIds) {
    result[indicatorId] = new Array<number | null>(periods.length).fill(null);
  }
  if (periods.length === 0 || indicatorIds.length === 0) return result;

  const index = new Map(periods.map((period, i) => [period.id, i]));
  const rows = getDb()
    .prepare(
      `SELECT * FROM observations
       WHERE disaggregation = '' AND org_unit_id = ?
         AND period_id IN (${placeholders(periods.length)})
         AND indicator_id IN (${placeholders(indicatorIds.length)})`,
    )
    .all(orgUnitId, ...periods.map((p) => p.id), ...indicatorIds) as ObsRow[];

  for (const row of rows) {
    const position = index.get(row.period_id);
    if (position === undefined) continue;
    const series = result[row.indicator_id];
    if (series) series[position] = row.value;
  }
  return result;
}

/** Series for many org units at once, keyed by org unit then indicator. */
export function getSeriesForUnits(
  orgUnitIds: string[],
  periods: Period[],
  indicatorIds: string[],
): Map<string, Record<string, Array<number | null>>> {
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
  const rows = getDb()
    .prepare(
      `SELECT * FROM observations
       WHERE disaggregation = ''
         AND org_unit_id IN (${placeholders(orgUnitIds.length)})
         AND period_id IN (${placeholders(periods.length)})
         AND indicator_id IN (${placeholders(indicatorIds.length)})`,
    )
    .all(...orgUnitIds, ...periods.map((p) => p.id), ...indicatorIds) as ObsRow[];

  for (const row of rows) {
    const position = index.get(row.period_id);
    const unit = result.get(row.org_unit_id);
    if (position === undefined || !unit) continue;
    const series = unit[row.indicator_id];
    if (series) series[position] = row.value;
  }
  return result;
}

export function upsertPeriods(periods: Period[]): void {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO periods (id, type, start_date, end_date, label) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  const run = db.transaction((rows: Period[]) => {
    for (const period of rows) {
      statement.run(period.id, period.type, period.startDate, period.endDate, period.label);
    }
  });
  run(periods);
}

export function upsertReporting(records: ReportingRecord[]): void {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO reporting (org_unit_id, dataset_id, period_id, expected, reported, submitted_at, due_date)
     VALUES (@org_unit_id, @dataset_id, @period_id, @expected, @reported, @submitted_at, @due_date)
     ON CONFLICT(org_unit_id, dataset_id, period_id) DO UPDATE SET
       expected = excluded.expected, reported = excluded.reported,
       submitted_at = excluded.submitted_at, due_date = excluded.due_date`,
  );
  const run = db.transaction((rows: ReportingRecord[]) => {
    for (const record of rows) {
      statement.run({
        org_unit_id: record.orgUnitId,
        dataset_id: record.datasetId,
        period_id: record.periodId,
        expected: record.expected ? 1 : 0,
        reported: record.reported ? 1 : 0,
        submitted_at: record.submittedAt,
        due_date: record.dueDate,
      });
    }
  });
  run(records);
}

interface ReportingRow {
  org_unit_id: string;
  dataset_id: string;
  period_id: string;
  expected: number;
  reported: number;
  submitted_at: string | null;
  due_date: string;
}

export function getReporting(orgUnitIds: string[], periodIds: string[]): ReportingRecord[] {
  if (orgUnitIds.length === 0 || periodIds.length === 0) return [];
  const rows = getDb()
    .prepare(
      `SELECT * FROM reporting
       WHERE org_unit_id IN (${placeholders(orgUnitIds.length)})
         AND period_id IN (${placeholders(periodIds.length)})`,
    )
    .all(...orgUnitIds, ...periodIds) as ReportingRow[];
  return rows.map((row) => ({
    orgUnitId: row.org_unit_id,
    datasetId: row.dataset_id,
    periodId: row.period_id,
    expected: row.expected === 1,
    reported: row.reported === 1,
    submittedAt: row.submitted_at,
    dueDate: row.due_date,
  }));
}

export function upsertTargets(targets: Target[]): void {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO targets (indicator_id, org_unit_id, period_id, value) VALUES (?, ?, ?, ?)
     ON CONFLICT(indicator_id, org_unit_id, period_id) DO UPDATE SET value = excluded.value`,
  );
  const run = db.transaction((rows: Target[]) => {
    for (const target of rows) {
      statement.run(target.indicatorId, target.orgUnitId ?? '', target.periodId ?? '', target.value);
    }
  });
  run(targets);
}

/**
 * Effective targets for an org unit and period. Specificity wins: an org- and
 * period-specific target overrides an org-specific one, which overrides the
 * global default.
 */
export function getEffectiveTargets(orgUnitId: string, periodId: string): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT indicator_id, org_unit_id, period_id, value FROM targets
       WHERE (org_unit_id = ? OR org_unit_id = '') AND (period_id = ? OR period_id = '')`,
    )
    .all(orgUnitId, periodId) as Array<{
    indicator_id: string;
    org_unit_id: string;
    period_id: string;
    value: number;
  }>;

  const scored = new Map<string, { value: number; specificity: number }>();
  for (const row of rows) {
    const specificity = (row.org_unit_id === '' ? 0 : 2) + (row.period_id === '' ? 0 : 1);
    const existing = scored.get(row.indicator_id);
    if (!existing || specificity > existing.specificity) {
      scored.set(row.indicator_id, { value: row.value, specificity });
    }
  }
  return Object.fromEntries([...scored].map(([id, entry]) => [id, entry.value]));
}
