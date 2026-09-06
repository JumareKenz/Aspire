import type { IndicatorDefinition } from '../registry/types';
import type { Observation, OrgUnit, Period, ReportingRecord } from '../model/types';
import { linearFit, median, medianAbsoluteDeviation, round, stdDev } from '../analytics/stats';
import type { QualityFinding, Severity } from './types';

export interface DetectorContext {
  orgUnits: Map<string, OrgUnit>;
  indicators: Map<string, IndicatorDefinition>;
  periods: Period[];
  /** ISO datetime stamped on every finding produced in this run. */
  now: string;
}

/** Thresholds are configuration, not magic numbers scattered through the code. */
export interface DetectorThresholds {
  /** Robust z-score beyond which a value is a statistical outlier. */
  outlierZ: number;
  /** Robust z-score beyond which an outlier is treated as HIGH severity. */
  severeOutlierZ: number;
  /** Consecutive identical values that suggest copy-forward reporting. */
  repeatedRunLength: number;
  /** Minimum series length before statistical detectors will run at all. */
  minSeriesForStatistics: number;
  /** Completeness below this proportion is a HIGH severity finding. */
  severeCompleteness: number;
  /** Completeness below this proportion is reported at all. */
  reportableCompleteness: number;
}

export const DEFAULT_THRESHOLDS: DetectorThresholds = {
  outlierZ: 3.5,
  severeOutlierZ: 5,
  repeatedRunLength: 4,
  minSeriesForStatistics: 6,
  severeCompleteness: 0.7,
  reportableCompleteness: 0.95,
};

function id(parts: Array<string | null>): string {
  return parts.filter(Boolean).join(':');
}

function fmt(value: number): string {
  return String(round(value, 2));
}

/** Missing or incomplete reporting submissions, per org unit and period. */
export function detectCompleteness(
  records: ReportingRecord[],
  ctx: DetectorContext,
  thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
): QualityFinding[] {
  const grouped = new Map<string, ReportingRecord[]>();
  for (const record of records) {
    if (!record.expected) continue;
    const key = `${record.orgUnitId}|${record.periodId}`;
    const list = grouped.get(key) ?? [];
    list.push(record);
    grouped.set(key, list);
  }

  const findings: QualityFinding[] = [];
  for (const [key, group] of grouped) {
    const [orgUnitId, periodId] = key.split('|');
    const expected = group.length;
    const reported = group.filter((r) => r.reported).length;
    const ratio = expected === 0 ? 1 : reported / expected;
    if (ratio >= thresholds.reportableCompleteness) continue;
    const orgUnit = ctx.orgUnits.get(orgUnitId);
    const severity: Severity = ratio < thresholds.severeCompleteness ? 'HIGH' : 'MEDIUM';
    findings.push({
      id: id(['completeness', orgUnitId, periodId]),
      dimension: 'COMPLETENESS',
      severity,
      orgUnitId,
      orgUnitName: orgUnit?.name ?? orgUnitId,
      indicatorId: null,
      indicatorName: null,
      periodId,
      title: `${Math.round((1 - ratio) * 100)}% of expected reports missing`,
      reason: `${reported} of ${expected} expected dataset submissions were received for this period.`,
      evidence: [
        { label: 'Expected submissions', value: String(expected) },
        { label: 'Received submissions', value: String(reported) },
        { label: 'Reports missing', value: `${Math.round((1 - ratio) * 100)}%` },
        { label: 'Completeness', value: `${Math.round(ratio * 100)}%` },
      ],
      status: 'OPEN',
      detectedAt: ctx.now,
    });
  }
  return findings;
}

/** Submissions received after their due date. */
export function detectTimeliness(
  records: ReportingRecord[],
  ctx: DetectorContext,
): QualityFinding[] {
  const grouped = new Map<string, { late: number; total: number; maxDays: number }>();
  for (const record of records) {
    if (!record.expected || !record.reported || !record.submittedAt) continue;
    const key = `${record.orgUnitId}|${record.periodId}`;
    const entry = grouped.get(key) ?? { late: 0, total: 0, maxDays: 0 };
    entry.total += 1;
    const days = Math.round(
      (new Date(record.submittedAt).getTime() - new Date(record.dueDate).getTime()) / 86_400_000,
    );
    if (days > 0) {
      entry.late += 1;
      entry.maxDays = Math.max(entry.maxDays, days);
    }
    grouped.set(key, entry);
  }

  const findings: QualityFinding[] = [];
  for (const [key, entry] of grouped) {
    if (entry.late === 0) continue;
    const [orgUnitId, periodId] = key.split('|');
    const lateRatio = entry.late / entry.total;
    if (lateRatio < 0.25) continue;
    findings.push({
      id: id(['timeliness', orgUnitId, periodId]),
      dimension: 'TIMELINESS',
      severity: lateRatio > 0.6 || entry.maxDays > 30 ? 'MEDIUM' : 'LOW',
      orgUnitId,
      orgUnitName: ctx.orgUnits.get(orgUnitId)?.name ?? orgUnitId,
      indicatorId: null,
      indicatorName: null,
      periodId,
      title: `${entry.late} of ${entry.total} submissions were late`,
      reason: `Submissions arrived after the reporting deadline, delaying availability of this period's data.`,
      evidence: [
        { label: 'Late submissions', value: `${entry.late} of ${entry.total}` },
        { label: 'Longest delay', value: `${entry.maxDays} days` },
      ],
      status: 'OPEN',
      detectedAt: ctx.now,
    });
  }
  return findings;
}

/** Values outside the indicator's configured possible range. */
export function detectValidity(
  observations: Observation[],
  ctx: DetectorContext,
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const observation of observations) {
    const indicator = ctx.indicators.get(observation.indicatorId);
    if (!indicator) continue;
    const { min, max } = indicator.quality;
    const belowMin = min !== null && observation.value < min;
    const aboveMax = max !== null && observation.value > max;
    if (!belowMin && !aboveMax) continue;
    const bound = belowMin ? `below the minimum of ${min}` : `above the maximum of ${max}`;
    findings.push({
      id: id(['validity', observation.orgUnitId, observation.indicatorId, observation.periodId]),
      dimension: 'VALIDITY',
      severity: 'HIGH',
      orgUnitId: observation.orgUnitId,
      orgUnitName: ctx.orgUnits.get(observation.orgUnitId)?.name ?? observation.orgUnitId,
      indicatorId: indicator.id,
      indicatorName: indicator.name,
      periodId: observation.periodId,
      title: `Impossible value recorded for ${indicator.shortName}`,
      reason: `The reported value of ${fmt(observation.value)} is ${bound}, so it cannot be correct as recorded.`,
      evidence: [
        { label: 'Reported value', value: fmt(observation.value) },
        { label: 'Permitted range', value: `${min ?? '−∞'} to ${max ?? '∞'}` },
      ],
      status: 'OPEN',
      detectedAt: ctx.now,
    });
  }
  return findings;
}

/** Internally contradictory figures, principally numerator exceeding denominator. */
export function detectConsistency(
  observations: Observation[],
  ctx: DetectorContext,
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const observation of observations) {
    const indicator = ctx.indicators.get(observation.indicatorId);
    if (!indicator || !indicator.quality.numeratorMustNotExceedDenominator) continue;
    const { numerator, denominator } = observation;
    if (numerator === null || denominator === null) continue;
    if (numerator <= denominator) continue;
    findings.push({
      id: id(['consistency', observation.orgUnitId, observation.indicatorId, observation.periodId]),
      dimension: 'CONSISTENCY',
      severity: 'HIGH',
      orgUnitId: observation.orgUnitId,
      orgUnitName: ctx.orgUnits.get(observation.orgUnitId)?.name ?? observation.orgUnitId,
      indicatorId: indicator.id,
      indicatorName: indicator.name,
      periodId: observation.periodId,
      title: `Numerator exceeds denominator for ${indicator.shortName}`,
      reason: `${fmt(numerator)} cases were reported against a population of ${fmt(denominator)}, which is not possible.`,
      evidence: [
        { label: 'Numerator', value: fmt(numerator) },
        { label: 'Denominator', value: fmt(denominator) },
      ],
      status: 'OPEN',
      detectedAt: ctx.now,
    });
  }
  return findings;
}

export interface SeriesKey {
  orgUnitId: string;
  indicatorId: string;
}

export interface SeriesInput extends SeriesKey {
  /** Values aligned to `ctx.periods`, oldest first. */
  values: Array<number | null>;
}

/**
 * Spikes and drops that are extreme relative to the unit's own history.
 *
 * The series is detrended before the test. A unit in sustained decline is not
 * reporting anomalous data — it has a performance problem, which the trend and
 * scoring engines already describe. Testing the raw value against a historical
 * median would flag every declining unit as a data-quality incident and bury
 * the genuine spikes. What is tested here is the residual: how far the latest
 * point sits from where the unit's own trajectory said it would be.
 */
export function detectStatisticalAnomalies(
  series: SeriesInput[],
  ctx: DetectorContext,
  thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const entry of series) {
    const indicator = ctx.indicators.get(entry.indicatorId);
    if (!indicator) continue;
    const observed = entry.values
      .map((value, index) => ({ value, index }))
      .filter((point): point is { value: number; index: number } => point.value !== null);
    if (observed.length < thresholds.minSeriesForStatistics) continue;

    const values = observed.map((p) => p.value);
    // Only the most recent point is reported, so the same historical spike is
    // not re-raised as a new finding every period.
    const latest = observed[observed.length - 1];
    const baseline = values.slice(0, -1);

    const fit = linearFit(baseline);
    const expected = fit.intercept + fit.slope * baseline.length;
    const residuals = baseline.map((value, index) => value - (fit.intercept + fit.slope * index));
    const spread = Math.max(medianAbsoluteDeviation(residuals), stdDev(residuals));
    // A near-constant series makes any deviation look infinite; require a
    // deviation that is also material in absolute terms before reporting.
    const scale = Math.max(Math.abs(median(baseline)), 1);
    if (spread < scale * 0.01) continue;

    const deviation = latest.value - expected;
    const z = deviation / spread;
    if (Math.abs(z) < thresholds.outlierZ) continue;
    if (Math.abs(deviation) < scale * 0.15) continue;

    findings.push({
      id: id(['statistical', entry.orgUnitId, entry.indicatorId, ctx.periods[latest.index]?.id ?? '']),
      dimension: 'STATISTICAL',
      severity: Math.abs(z) >= thresholds.severeOutlierZ ? 'HIGH' : 'MEDIUM',
      orgUnitId: entry.orgUnitId,
      orgUnitName: ctx.orgUnits.get(entry.orgUnitId)?.name ?? entry.orgUnitId,
      indicatorId: indicator.id,
      indicatorName: indicator.name,
      periodId: ctx.periods[latest.index]?.id ?? '',
      title: `Unusual ${z > 0 ? 'spike' : 'drop'} in ${indicator.shortName}`,
      reason: `The latest value departs sharply from where this unit's own recent trajectory pointed, beyond what its normal period-to-period variation would explain.`,
      evidence: [
        { label: 'Latest value', value: fmt(latest.value) },
        { label: 'Expected from trend', value: fmt(expected) },
        { label: 'Deviation', value: `${fmt(Math.abs(z))}× typical variation` },
      ],
      status: 'OPEN',
      detectedAt: ctx.now,
    });
  }
  return findings;
}

/** A sustained shift in level, distinct from a one-period spike. */
export function detectTemporalAnomalies(
  series: SeriesInput[],
  ctx: DetectorContext,
  thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const entry of series) {
    const indicator = ctx.indicators.get(entry.indicatorId);
    if (!indicator) continue;
    const values = entry.values.filter((v): v is number => v !== null);
    if (values.length < thresholds.minSeriesForStatistics) continue;

    const splitAt = Math.floor(values.length / 2);
    const before = values.slice(0, splitAt);
    const after = values.slice(splitAt);
    const beforeMedian = median(before);
    const afterMedian = median(after);
    if (Math.abs(beforeMedian) < 1e-9) continue;
    const shiftPct = ((afterMedian - beforeMedian) / Math.abs(beforeMedian)) * 100;
    const spread = stdDev(before);
    // Require both a large relative shift and a shift that is large compared
    // with the series' own historical variability.
    if (Math.abs(shiftPct) < 40) continue;
    if (spread > 1e-9 && Math.abs(afterMedian - beforeMedian) < 2 * spread) continue;

    findings.push({
      id: id(['temporal', entry.orgUnitId, entry.indicatorId]),
      dimension: 'TEMPORAL',
      severity: Math.abs(shiftPct) > 70 ? 'MEDIUM' : 'LOW',
      orgUnitId: entry.orgUnitId,
      orgUnitName: ctx.orgUnits.get(entry.orgUnitId)?.name ?? entry.orgUnitId,
      indicatorId: indicator.id,
      indicatorName: indicator.name,
      periodId: ctx.periods[ctx.periods.length - 1]?.id ?? '',
      title: `Reporting pattern changed for ${indicator.shortName}`,
      reason: `The typical reported level shifted by ${Math.round(shiftPct)}% partway through the period range, which may reflect a change in practice rather than in service delivery.`,
      evidence: [
        { label: 'Earlier median', value: fmt(beforeMedian) },
        { label: 'Recent median', value: fmt(afterMedian) },
        { label: 'Shift', value: `${round(shiftPct, 1)}%` },
      ],
      status: 'OPEN',
      detectedAt: ctx.now,
    });
  }
  return findings;
}

/** Identical values repeated for implausibly many consecutive periods. */
export function detectRepeatedValues(
  series: SeriesInput[],
  ctx: DetectorContext,
  thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const entry of series) {
    const indicator = ctx.indicators.get(entry.indicatorId);
    if (!indicator) continue;
    let run = 1;
    let bestRun = 1;
    let bestValue: number | null = null;
    for (let i = 1; i < entry.values.length; i += 1) {
      const previous = entry.values[i - 1];
      const currentValue = entry.values[i];
      if (previous !== null && currentValue !== null && Math.abs(previous - currentValue) < 1e-9) {
        run += 1;
        if (run > bestRun) {
          bestRun = run;
          bestValue = currentValue;
        }
      } else {
        run = 1;
      }
    }
    // Zero can legitimately repeat in low-volume facilities; only non-zero
    // repetition is treated as suspicious.
    if (bestRun < thresholds.repeatedRunLength || bestValue === null || bestValue === 0) continue;

    findings.push({
      id: id(['repeated', entry.orgUnitId, entry.indicatorId]),
      dimension: 'REPEATED_VALUE',
      severity: bestRun >= thresholds.repeatedRunLength + 2 ? 'MEDIUM' : 'LOW',
      orgUnitId: entry.orgUnitId,
      orgUnitName: ctx.orgUnits.get(entry.orgUnitId)?.name ?? entry.orgUnitId,
      indicatorId: indicator.id,
      indicatorName: indicator.name,
      periodId: ctx.periods[ctx.periods.length - 1]?.id ?? '',
      title: `${indicator.shortName} reported identically for ${bestRun} periods`,
      reason: `The same value was submitted in ${bestRun} consecutive periods, which often indicates a figure being carried forward rather than remeasured.`,
      evidence: [
        { label: 'Repeated value', value: fmt(bestValue) },
        { label: 'Consecutive periods', value: String(bestRun) },
      ],
      status: 'OPEN',
      detectedAt: ctx.now,
    });
  }
  return findings;
}

export interface QualityScanInput {
  observations: Observation[];
  reporting: ReportingRecord[];
  series: SeriesInput[];
}

/** Runs every detector and returns findings ordered by severity. */
export function runQualityScan(
  input: QualityScanInput,
  ctx: DetectorContext,
  thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
): QualityFinding[] {
  const findings = [
    ...detectCompleteness(input.reporting, ctx, thresholds),
    ...detectTimeliness(input.reporting, ctx),
    ...detectValidity(input.observations, ctx),
    ...detectConsistency(input.observations, ctx),
    ...detectStatisticalAnomalies(input.series, ctx, thresholds),
    ...detectTemporalAnomalies(input.series, ctx, thresholds),
    ...detectRepeatedValues(input.series, ctx, thresholds),
  ];
  const order: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
