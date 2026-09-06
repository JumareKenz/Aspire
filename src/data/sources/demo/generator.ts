import type {
  Dataset,
  Observation,
  OrgUnit,
  Period,
  ReportingRecord,
} from '@/core/model/types';
import type { IndicatorDefinition } from '@/core/registry/types';
import { clamp } from '@/core/analytics/stats';
import { gaussian, hashSeed, mulberry32 } from './random';
import { buildDemoGeography } from './geography';

/**
 * Demo dataset generator.
 *
 * Everything produced here is synthetic and is labelled DEMO throughout the
 * platform. It exists so the product can be built, reviewed and tested before a
 * DHIS2 instance is available — never to stand in for real reporting.
 *
 * The dataset is internally consistent by construction: facility numerators and
 * denominators are generated first, and every higher level is aggregated from
 * them, so an LGA figure is genuinely the sum of its facilities.
 *
 * Signals are planted deliberately so that the analytical engines and the AI
 * evaluation set have known-correct answers to find. They are documented in
 * `docs/DATA_MODEL.md`.
 */

/** LGAs given a sustained decline in adolescent SRHR indicators. */
export const DECLINING_LGAS = ['lga-eguma', 'lga-fankama', 'lga-ilesan', 'lga-lamurde'];
/** LGA given badly incomplete reporting, so data confidence is low there. */
export const LOW_REPORTING_LGA = 'lga-hadeja-west';
/** LGA given a strong sustained improvement. */
export const IMPROVING_LGA = 'lga-chalawa';

const ADOLESCENT_INDICATORS = ['adolescent-fp-uptake', 'youth-friendly-services', 'adolescent-anc1'];

interface FacilityProfile {
  /** Multiplier on the indicator's target that sets this facility's level. */
  capability: number;
  /** Catchment size, used as the denominator base. */
  catchment: number;
  /** Probability that a due report is actually submitted. */
  reportingRate: number;
}

function facilityProfile(facility: OrgUnit, lgaQuality: number): FacilityProfile {
  const rng = mulberry32(hashSeed(`profile:${facility.id}`));
  return {
    capability: clamp(0.6 + rng() * 0.55, 0.45, 1.15),
    catchment: Math.round(900 + rng() * 4200),
    reportingRate: clamp(lgaQuality + (rng() - 0.5) * 0.12, 0.25, 0.995),
  };
}

function lgaProfile(lga: OrgUnit) {
  const rng = mulberry32(hashSeed(`lga:${lga.id}`));
  // Struggling LGAs start from a lower base as well as declining, which is what
  // makes them appear near the bottom of the ranking rather than mid-table.
  const penalty = DECLINING_LGAS.includes(lga.id) ? 0.86 : 1;
  return {
    capability: clamp((0.72 + rng() * 0.46) * penalty, 0.5, 1.12),
    reportingQuality: lga.id === LOW_REPORTING_LGA ? 0.48 : clamp(0.9 + rng() * 0.1, 0.85, 0.995),
  };
}

/**
 * Trend multiplier applied to a facility's level at period `index` of `total`.
 * Planted declines and improvements are concentrated in the most recent third
 * of the series so that period-on-period comparisons have something real to find.
 */
function trendFactor(
  lgaId: string,
  indicatorId: string,
  index: number,
  total: number,
): number {
  const progress = index / Math.max(1, total - 1);
  const recent = clamp((progress - 0.5) / 0.5, 0, 1);

  if (DECLINING_LGAS.includes(lgaId)) {
    if (ADOLESCENT_INDICATORS.includes(indicatorId)) return 1 - 0.55 * recent;
    if (indicatorId === 'pnc-48h') return 1 - 0.28 * recent;
  }
  if (lgaId === IMPROVING_LGA) {
    return 1 + 0.22 * progress;
  }
  // Background national drift: slow, small, and different per indicator.
  const drift = ((hashSeed(indicatorId) % 100) / 100 - 0.5) * 0.12;
  return 1 + drift * progress;
}

interface PlantedAnomaly {
  facilityIndex: number;
  indicatorId: string;
  kind: 'IMPOSSIBLE_VALUE' | 'NUMERATOR_EXCEEDS_DENOMINATOR' | 'REPEATED' | 'SPIKE';
}

const PLANTED: PlantedAnomaly[] = [
  { facilityIndex: 3, indicatorId: 'anc4-coverage', kind: 'IMPOSSIBLE_VALUE' },
  { facilityIndex: 17, indicatorId: 'skilled-birth-attendance', kind: 'NUMERATOR_EXCEEDS_DENOMINATOR' },
  { facilityIndex: 42, indicatorId: 'mcpr', kind: 'REPEATED' },
  { facilityIndex: 61, indicatorId: 'fp-new-acceptors', kind: 'SPIKE' },
];

export interface DemoDataset {
  orgUnits: OrgUnit[];
  observations: Observation[];
  reporting: ReportingRecord[];
}

/** Generates facility-level values, then aggregates upward. */
export function generateDemoData(
  indicators: IndicatorDefinition[],
  periods: Period[],
  datasets: Dataset[],
): DemoDataset {
  const geography = buildDemoGeography();
  const observations: Observation[] = [];
  const reporting: ReportingRecord[] = [];

  const lgaProfiles = new Map(geography.lgas.map((lga) => [lga.id, lgaProfile(lga)]));
  const facilitiesByLga = new Map<string, OrgUnit[]>();
  for (const facility of geography.facilities) {
    const list = facilitiesByLga.get(facility.parentId ?? '') ?? [];
    list.push(facility);
    facilitiesByLga.set(facility.parentId ?? '', list);
  }

  const plantedByFacility = new Map<string, PlantedAnomaly[]>();
  for (const anomaly of PLANTED) {
    const facility = geography.facilities[anomaly.facilityIndex % geography.facilities.length];
    const list = plantedByFacility.get(facility.id) ?? [];
    list.push(anomaly);
    plantedByFacility.set(facility.id, list);
  }

  // Facility level.
  for (const facility of geography.facilities) {
    const lga = lgaProfiles.get(facility.parentId ?? '');
    if (!lga) continue;
    const profile = facilityProfile(facility, lga.reportingQuality);
    const planted = plantedByFacility.get(facility.id) ?? [];

    for (const indicator of indicators) {
      const rng = mulberry32(hashSeed(`${facility.id}:${indicator.id}`));
      // Seasonality is real in service data, but it is not in phase everywhere.
      // Giving each facility/indicator pair its own phase and amplitude stops
      // every series in the product from sharing one silhouette.
      const seasonalPhase = rng() * Math.PI * 2;
      const seasonalAmplitude = 0.015 + rng() * 0.03;
      const isCount = indicator.unit === 'COUNT';
      // Percentage indicators are held below a soft ceiling so that strong
      // units do not sit pinned at 100 every period. Saturation would produce a
      // flat series, which the quality detectors would correctly — but
      // uselessly — report as repeated values and zero-variance outliers.
      const rawBase = indicator.defaultTarget * profile.capability * lga.capability;
      const base = indicator.unit === 'PERCENT' ? Math.min(rawBase, 88) : rawBase;
      let repeatedValue: number | null = null;

      periods.forEach((period, index) => {
        const trend = trendFactor(facility.parentId ?? '', indicator.id, index, periods.length);
        const seasonal = 1 + seasonalAmplitude * Math.sin((index / 4) * Math.PI * 2 + seasonalPhase);
        const noise = 1 + gaussian(rng) * 0.055;
        let value = base * trend * seasonal * noise;

        if (indicator.directionality === 'LOWER_IS_BETTER') {
          // Invert the capability relationship: a stronger facility has fewer stock-outs.
          value = indicator.defaultTarget * (2 - profile.capability) * (2 - lga.capability) * trend * noise;
        }

        let numerator: number | null;
        let denominator: number | null;
        const catchment = Math.round(profile.catchment * (0.94 + rng() * 0.12));

        if (isCount) {
          value = Math.max(0, Math.round((value * catchment) / 3000));
          numerator = value;
          denominator = null;
        } else {
          value = clamp(value, 0, 100);
          denominator = catchment;
          numerator = Math.round((value / 100) * denominator);
        }

        for (const anomaly of planted) {
          if (anomaly.indicatorId !== indicator.id) continue;
          if (anomaly.kind === 'IMPOSSIBLE_VALUE' && index === periods.length - 2) {
            value = 128.4;
            numerator = denominator === null ? null : Math.round((value / 100) * denominator);
          }
          if (anomaly.kind === 'NUMERATOR_EXCEEDS_DENOMINATOR' && index === periods.length - 1 && denominator !== null) {
            numerator = Math.round(denominator * 1.18);
          }
          if (anomaly.kind === 'SPIKE' && index === periods.length - 1) {
            value = Math.round(value * 7.5);
            numerator = value;
          }
          if (anomaly.kind === 'REPEATED' && index >= periods.length - 5) {
            if (repeatedValue === null) repeatedValue = value;
            value = repeatedValue;
            numerator = denominator === null ? value : Math.round((value / 100) * denominator);
          }
        }

        observations.push({
          indicatorId: indicator.id,
          orgUnitId: facility.id,
          periodId: period.id,
          value: Number(value.toFixed(2)),
          numerator,
          denominator,
          disaggregation: null,
        });
      });
    }

    // Reporting expectations, one record per dataset per period.
    for (const dataset of datasets) {
      periods.forEach((period, index) => {
        const rng = mulberry32(hashSeed(`${facility.id}:${dataset.id}:${period.id}`));
        // Reporting in the weak LGA degrades further over the recent periods.
        const decay =
          facility.parentId === LOW_REPORTING_LGA && index >= periods.length - 4 ? 0.6 : 1;
        const reported = rng() < profile.reportingRate * decay;
        const due = new Date(`${period.endDate}T00:00:00Z`);
        due.setUTCDate(due.getUTCDate() + dataset.dueDays);
        const dueDate = due.toISOString().slice(0, 10);
        let submittedAt: string | null = null;
        if (reported) {
          const lateness = rng() < 0.18 ? Math.round(rng() * 26) + 1 : -Math.round(rng() * 8);
          const submitted = new Date(due);
          submitted.setUTCDate(submitted.getUTCDate() + lateness);
          submittedAt = submitted.toISOString();
        }
        reporting.push({
          orgUnitId: facility.id,
          datasetId: dataset.id,
          periodId: period.id,
          expected: true,
          reported,
          submittedAt,
          dueDate,
        });
      });
    }
  }

  // Aggregate facility values to LGA, then LGA to state. Percentages
  // are recomputed from summed numerators and denominators rather than averaged,
  // which is what makes the hierarchy internally consistent.
  const aggregate = (parent: OrgUnit, children: OrgUnit[]) => {
    const childIds = new Set(children.map((c) => c.id));
    for (const indicator of indicators) {
      for (const period of periods) {
        const rows = observations.filter(
          (o) =>
            o.indicatorId === indicator.id && o.periodId === period.id && childIds.has(o.orgUnitId),
        );
        if (rows.length === 0) continue;
        if (indicator.unit === 'COUNT') {
          const total = rows.reduce((acc, row) => acc + row.value, 0);
          observations.push({
            indicatorId: indicator.id,
            orgUnitId: parent.id,
            periodId: period.id,
            value: Number(total.toFixed(2)),
            numerator: total,
            denominator: null,
            disaggregation: null,
          });
          continue;
        }
        const numerator = rows.reduce((acc, row) => acc + (row.numerator ?? 0), 0);
        const denominator = rows.reduce((acc, row) => acc + (row.denominator ?? 0), 0);
        if (denominator <= 0) continue;
        observations.push({
          indicatorId: indicator.id,
          orgUnitId: parent.id,
          periodId: period.id,
          value: Number(((numerator / denominator) * 100).toFixed(2)),
          numerator,
          denominator,
          disaggregation: null,
        });
      }
    }
  };

  for (const lga of geography.lgas) {
    aggregate(lga, facilitiesByLga.get(lga.id) ?? []);
  }
  aggregate(geography.state, geography.lgas);

  return { orgUnits: geography.all, observations, reporting };
}
