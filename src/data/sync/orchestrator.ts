import type { Observation, OrgUnit } from '@/core/model/types';
import type { IndicatorDefinition } from '@/core/registry/types';
import { runQualityScan, type DetectorContext, type SeriesInput } from '@/core/quality/detectors';
import { listIndicators, seedRegistryIfEmpty } from '../repositories/registry';
import { deactivateMissingOrgUnits, replaceGeography, upsertOrgUnits } from '../repositories/orgUnits';
import {
  upsertObservations,
  upsertPeriods,
  upsertReporting,
  upsertTargets,
} from '../repositories/observations';
import { replaceFindings } from '../repositories/findings';
import { finishSyncRun, startSyncRun } from '../repositories/syncRuns';
import { getDataMode, setDataMode, setLastSyncAt, setLatestDataPeriod } from '../repositories/settings';
import { getSourceAdapter } from '../sources';
import { analysisPeriods } from './periods';

export interface SyncResult {
  ok: boolean;
  mode: 'DEMO' | 'DHIS2';
  orgUnits: number;
  observations: number;
  findings: number;
  message: string;
}

/**
 * Pulls the analysis window from the active source into the canonical store and
 * re-runs the data-quality scan over it.
 *
 * The whole operation is wrapped in a sync run record so that the Admin console
 * can show what happened and when, including failures.
 */
export async function runSync(): Promise<SyncResult> {
  await seedRegistryIfEmpty();
  const adapter = getSourceAdapter();
  const runId = await startSyncRun(adapter.mode);
  const periods = analysisPeriods();
  const indicators = await listIndicators();

  try {
    const orgUnits = await adapter.fetchOrgUnits();
    const datasets = await adapter.fetchDatasets();
    const request = { orgUnits, indicators, periods };

    const observations = await adapter.fetchObservations(request);
    const reporting = await adapter.fetchReporting({ ...request, datasets });

    // Switching source replaces the geography outright; see replaceGeography.
    let note = '';
    if ((await getDataMode()) !== adapter.mode) {
      const { unmatchedUsers } = await replaceGeography(orgUnits);
      if (unmatchedUsers.length > 0) {
        note = ` Scopes not found in the new hierarchy for: ${unmatchedUsers.join(', ')}. Review them in Admin → Users.`;
      }
    }

    await upsertPeriods(periods);
    await upsertOrgUnits(orgUnits);
    await deactivateMissingOrgUnits(orgUnits.map((unit) => unit.id));
    await upsertObservations(observations);
    await upsertReporting(reporting);
    await upsertTargets(
      indicators.map((indicator) => ({
        indicatorId: indicator.id,
        orgUnitId: null,
        periodId: null,
        value: indicator.defaultTarget,
      })),
    );

    // Breakdown rows are counts, not indicator values, so validity rules
    // (a percentage's 0-100 range, say) do not apply to them.
    const totals = observations.filter((observation) => !observation.disaggregation);
    const findings = scanQuality(orgUnits, totals, reporting, periods, indicators);
    await replaceFindings(findings);

    await setDataMode(adapter.mode);
    await setLastSyncAt(new Date().toISOString());
    const latest = latestPeriodWithData(orgUnits, totals, periods);
    if (latest) await setLatestDataPeriod(latest);
    await finishSyncRun(runId, {
      status: 'SUCCESS',
      orgUnits: orgUnits.length,
      observations: observations.length,
      findings: findings.length,
      message: `Synchronised ${periods.length} periods from ${adapter.label}.${note}`,
    });

    return {
      ok: true,
      mode: adapter.mode,
      orgUnits: orgUnits.length,
      observations: observations.length,
      findings: findings.length,
      message: `Synchronised ${observations.length.toLocaleString('en-GB')} values across ${orgUnits.length} organisation units.${note}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation failed.';
    await finishSyncRun(runId, { status: 'FAILED', message });
    return { ok: false, mode: adapter.mode, orgUnits: 0, observations: 0, findings: 0, message };
  }
}

/** Recent periods scanned for reporting problems, so findings stay actionable. */
const COMPLETENESS_SCAN_PERIODS = 4;

function scanQuality(
  orgUnits: OrgUnit[],
  observations: Observation[],
  reporting: Parameters<typeof upsertReporting>[0],
  periods: ReturnType<typeof analysisPeriods>,
  indicators: IndicatorDefinition[],
) {
  const ctx: DetectorContext = {
    orgUnits: new Map(orgUnits.map((unit) => [unit.id, unit])),
    indicators: new Map(indicators.map((indicator) => [indicator.id, indicator])),
    periods,
    now: new Date().toISOString(),
  };

  // Completeness and timeliness are reported at LGA level for the recent
  // periods. Raising one finding per facility per period would produce hundreds
  // of rows that say the same thing; the LGA is where reporting is managed, and
  // facility detail remains available on drill-down.
  // Found through the path, not the parent: a facility's parent is its ward.
  const lgaIds = new Set(orgUnits.filter((unit) => unit.level === 'LGA').map((unit) => unit.id));
  const facilityToLga = new Map(
    orgUnits
      .filter((unit) => unit.level === 'FACILITY')
      .map((unit) => [unit.id, unit.path.find((id) => lgaIds.has(id)) ?? unit.parentId ?? unit.id]),
  );
  const recentPeriodIds = new Set(periods.slice(-COMPLETENESS_SCAN_PERIODS).map((period) => period.id));
  const aggregatedReporting = reporting
    .filter((record) => recentPeriodIds.has(record.periodId))
    .map((record) => ({
      ...record,
      orgUnitId: facilityToLga.get(record.orgUnitId) ?? record.orgUnitId,
      // Keyed per facility so multiple facilities in one LGA are not collapsed.
      datasetId: `${record.datasetId}:${record.orgUnitId}`,
    }));

  // Value-level detectors run at both LGA and facility level: an LGA aggregate
  // can look ordinary while one facility inside it reports something impossible.
  const scanUnitIds = orgUnits
    .filter((unit) => unit.level === 'LGA' || unit.level === 'FACILITY')
    .map((unit) => unit.id);
  const seriesByUnit = getSeriesForUnitsFrom(observations, scanUnitIds, periods, indicators.map((i) => i.id));

  const series: SeriesInput[] = [];
  for (const [orgUnitId, byIndicator] of seriesByUnit) {
    for (const [indicatorId, values] of Object.entries(byIndicator)) {
      series.push({ orgUnitId, indicatorId, values });
    }
  }

  return runQualityScan({ observations, reporting: aggregatedReporting, series }, ctx);
}

/**
 * Builds aligned series from an in-memory observation set. Used during sync so
 * the scan does not have to round-trip through the database it is still writing.
 */
function getSeriesForUnitsFrom(
  observations: Observation[],
  orgUnitIds: string[],
  periods: ReturnType<typeof analysisPeriods>,
  indicatorIds: string[],
): Map<string, Record<string, Array<number | null>>> {
  const wanted = new Set(orgUnitIds);
  const index = new Map(periods.map((period, i) => [period.id, i]));
  const result = new Map<string, Record<string, Array<number | null>>>();
  for (const orgUnitId of orgUnitIds) {
    const empty: Record<string, Array<number | null>> = {};
    for (const indicatorId of indicatorIds) {
      empty[indicatorId] = new Array<number | null>(periods.length).fill(null);
    }
    result.set(orgUnitId, empty);
  }
  for (const observation of observations) {
    if (!wanted.has(observation.orgUnitId) || observation.disaggregation) continue;
    const position = index.get(observation.periodId);
    if (position === undefined) continue;
    const unit = result.get(observation.orgUnitId);
    const series = unit?.[observation.indicatorId];
    if (series) series[position] = observation.value;
  }
  return result;
}

/**
 * The latest period the top of the hierarchy has any value for. Pages open on
 * it by default, so a source that lags the calendar does not open every page
 * on an empty quarter.
 */
function latestPeriodWithData(
  orgUnits: OrgUnit[],
  observations: Observation[],
  periods: ReturnType<typeof analysisPeriods>,
): string | null {
  const root = orgUnits.find((unit) => unit.parentId === null);
  if (!root) return null;
  const withData = new Set(
    observations.filter((observation) => observation.orgUnitId === root.id).map((observation) => observation.periodId),
  );
  for (let i = periods.length - 1; i >= 0; i -= 1) {
    if (withData.has(periods[i].id)) return periods[i].id;
  }
  return null;
}
