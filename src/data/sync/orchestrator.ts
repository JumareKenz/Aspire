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
import { analysisMonths, analysisPeriods } from './periods';
import { dataElementRefs, verifyProvenance } from './governance';
import { listCatalogue, replaceCatalogue, saveProvenance, upsertDataElementValues } from '../repositories/nhmis';

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
  const months = analysisMonths();
  const registry = await listIndicators(true);

  // Time per phase, recorded on the run: the sync must fit one function call.
  const phases: string[] = [];
  let mark = Date.now();
  const phase = (label: string) => {
    phases.push(`${label} ${Math.round((Date.now() - mark) / 1000)}s`);
    mark = Date.now();
  };

  try {
    const orgUnits = await adapter.fetchOrgUnits();
    const datasets = await adapter.fetchDatasets();

    // Governance first: only indicators verified against the approved NHMIS
    // forms are fetched at all, so unverified figures never enter the store.
    phase('hierarchy');
    const governance = await verifyProvenance(adapter, registry);
    // Provenance is recorded as soon as it is known, before the slow analytics
    // requests: if those fail, the stored figures of verified indicators stay
    // reportable rather than every page going blank.
    if ((await getDataMode()) === adapter.mode) {
      await replaceCatalogue(governance.forms, approvedElements(governance), adapter.mode === 'DEMO');
      await saveProvenance(governance.provenance);
    }
    phase('metadata');
    const indicators = governance.reportable;
    if (indicators.length === 0) {
      const unverified = governance.provenance.filter((entry) => entry.status === 'UNVERIFIED').length;
      throw new Error(
        governance.forms.length === 0
          ? 'None of the approved NHMIS forms was found at the source, so no indicator could be verified. Nothing was imported.'
          : `No active indicator could be verified against the approved NHMIS forms (${unverified} unverified). Nothing was imported; see Admin → Indicators.`,
      );
    }
    const request = { orgUnits, indicators, periods };

    const observations = await adapter.fetchObservations(request);
    // DHIS2 analytics can answer with an empty table rather than an error.
    // A sync that imported nothing is a failure, not a success: recording it
    // as one hid a week of empty nightly runs.
    if (!observations.some((observation) => !observation.disaggregation)) {
      throw new Error('The source returned no values for any verified indicator in the analysis window. Nothing was imported; the stored data is unchanged.');
    }
    phase('quarters');
    const reporting = await adapter.fetchReporting({ ...request, datasets });
    phase('reporting');

    // Monthly values are requested as months from the source, which aggregates
    // each by its own rules; nothing monthly is derived from a quarter.
    const monthlyRequest = { orgUnits, indicators, periods: months, includeBreakdowns: false };
    const monthlyObservations = months.length > 0 ? await adapter.fetchObservations(monthlyRequest) : [];
    phase('months');
    const monthlyReporting = months.length > 0 ? await adapter.fetchReporting({ ...monthlyRequest, datasets }) : [];
    phase('monthly reporting');

    const elementIds = new Set(governance.metadata.dataElements.map((element) => element.id));
    const configured = (await listCatalogue())
      .filter((element) => element.config?.active && element.config.domainId && elementIds.has(element.id))
      .map((element) => element.id);
    const refs = dataElementRefs(governance.provenance, new Set(indicators.map((indicator) => indicator.id)), configured);
    const elementValues = await adapter.fetchDataElementValues({
      dx: refs,
      orgUnits,
      periods: [...periods, ...months],
      aggregationTypes: Object.fromEntries(
        governance.metadata.dataElements.map((element) => [element.id, element.aggregationType]),
      ),
    });
    phase('data elements');

    // Switching source replaces the geography outright; see replaceGeography.
    let note = '';
    if ((await getDataMode()) !== adapter.mode) {
      const { unmatchedUsers } = await replaceGeography(orgUnits);
      if (unmatchedUsers.length > 0) {
        note = ` Scopes not found in the new hierarchy for: ${unmatchedUsers.join(', ')}. Review them in Admin → Users.`;
      }
    }

    await upsertPeriods([...periods, ...months]);
    await upsertOrgUnits(orgUnits);
    await deactivateMissingOrgUnits(orgUnits.map((unit) => unit.id));
    await replaceCatalogue(governance.forms, approvedElements(governance), adapter.mode === 'DEMO');
    await saveProvenance(governance.provenance);
    await upsertObservations([...observations, ...monthlyObservations]);
    await upsertReporting([...reporting, ...monthlyReporting]);
    await upsertDataElementValues(elementValues);
    await upsertTargets(
      registry.map((indicator) => ({
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
    phase('store and quality scan');

    const excluded = governance.provenance.filter((entry) => entry.status === 'UNVERIFIED' || entry.status === 'UNMAPPED');
    const governanceNote =
      adapter.mode === 'DEMO'
        ? 'Demo data is synthetic and not governed as NHMIS data.'
        : `${indicators.length} indicators verified against the approved NHMIS forms; ${excluded.length} excluded from reporting.`;

    await setDataMode(adapter.mode);
    await setLastSyncAt(new Date().toISOString());
    const latest = latestPeriodWithData(orgUnits, totals, periods);
    if (latest) await setLatestDataPeriod(latest);
    await finishSyncRun(runId, {
      status: 'SUCCESS',
      orgUnits: orgUnits.length,
      observations: observations.length,
      findings: findings.length,
      message: `Synchronised ${periods.length} quarters and ${months.length} months from ${adapter.label}. ${governanceNote}${note} Timings: ${phases.join(', ')}.`,
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

/** The source's data elements, limited to the approved forms that carry them. */
function approvedElements(governance: Awaited<ReturnType<typeof verifyProvenance>>) {
  const approved = new Set(governance.forms.map((form) => form.id));
  return governance.metadata.dataElements
    .map((element) => ({ ...element, formIds: element.formIds.filter((id) => approved.has(id)) }))
    .filter((element) => element.formIds.length > 0);
}
