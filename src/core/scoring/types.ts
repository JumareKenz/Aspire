import type { OrgLevel } from '../model/types';
import type { TargetScope } from '../targets/resolve';

/**
 * A named, versioned scoring methodology.
 *
 * The official ASPIRE-GAC methodology has not been supplied. The engine is
 * therefore driven entirely by this record: indicators, weights, thresholds,
 * aggregation and missing-data behaviour are all configuration. Publishing the
 * official methodology means adding a new record with `status: "official"`,
 * not editing engine or UI code.
 */
export interface ScorecardMethodology {
  id: string;
  /** Semantic-ish version string surfaced on every scorecard and report. */
  version: string;
  label: string;
  /**
   * PROVISIONAL methodologies are development placeholders. Every score derived
   * from one is badged as provisional in the UI and in exports.
   */
  status: 'PROVISIONAL' | 'OFFICIAL' | 'RETIRED';
  description: string;
  effectiveFrom: string;
  /** Relative weights per domain. Normalised at evaluation time. */
  domainWeights: Record<string, number>;
  /** Relative weights per indicator within its domain. Normalised per domain. */
  indicatorWeights: Record<string, number>;
  /** Score thresholds that map a 0..100 score onto a status band. */
  statusBands: {
    /** score >= onTrack => ON_TRACK */
    onTrack: number;
    /** score >= watch => WATCH, else NEEDS_ATTENTION */
    watch: number;
  };
  aggregation: {
    /** How indicator scores combine into a domain score. */
    domain: 'WEIGHTED_MEAN';
    /** How domain scores combine into an overall score. */
    overall: 'WEIGHTED_MEAN';
    /**
     * How child org units combine when computing a parent's raw indicator
     * value. POPULATION_WEIGHTED uses denominators where available.
     */
    geography: 'POPULATION_WEIGHTED' | 'SIMPLE_MEAN';
  };
  missingData: {
    /**
     * EXCLUDE  — drop the indicator and renormalise sibling weights.
     * ZERO     — treat missing as a zero score (punitive).
     * CARRY    — reuse the most recent prior value within `carryMaxPeriods`.
     */
    rule: 'EXCLUDE' | 'ZERO' | 'CARRY';
    carryMaxPeriods: number;
    /**
     * Minimum proportion (0..1) of weighted indicators that must have data for
     * a domain or overall score to be published at all.
     */
    minCoverage: number;
  };
  /** Minimum number of historical periods required before a trend is reported. */
  minPeriodsForTrend: number;
}

export type PerformanceStatus = 'ON_TRACK' | 'WATCH' | 'NEEDS_ATTENTION' | 'NO_DATA';
export type TrendDirection = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';

export interface Trend {
  direction: TrendDirection;
  /** Percentage change across the compared window. Null when unknown. */
  changePct: number | null;
  /** Absolute change in scored points. Null when unknown. */
  changePoints: number | null;
  /** Number of periods the trend was computed over. */
  periods: number;
}

export interface IndicatorScore {
  indicatorId: string;
  name: string;
  domainId: string;
  /** Raw measured value in the indicator's own unit. Null when absent. */
  value: number | null;
  /** Null when no target applies to this area and period. */
  target: number | null;
  /** Where the target came from; null when there is none. */
  targetScope: TargetScope | null;
  /** value/target as a percentage, direction-aware. Null when absent. */
  achievementPct: number | null;
  /** 0..100 after applying the methodology's scoring rule. Null when absent. */
  score: number | null;
  status: PerformanceStatus;
  trend: Trend;
  /** Normalised weight actually applied within the domain. */
  effectiveWeight: number;
  /** True when the value was carried forward under the CARRY missing-data rule. */
  carriedForward: boolean;
  unit: string;
  directionality: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
  /** False when the indicator has no data source, as distinct from no value this period. */
  mapped: boolean;
  /** True while the target is a placeholder awaiting the programme's confirmation. */
  targetProvisional: boolean;
}

export interface DomainScore {
  domainId: string;
  name: string;
  score: number | null;
  target: number;
  status: PerformanceStatus;
  trend: Trend;
  effectiveWeight: number;
  /** Proportion 0..1 of weighted indicators in this domain that had data. */
  coverage: number;
  indicators: IndicatorScore[];
}

/**
 * Data confidence is deliberately separate from performance. A score of 64
 * with 94% confidence and a score of 64 with 41% confidence are different
 * findings, and the product must never let the second masquerade as the first.
 */
export interface DataConfidence {
  /** 0..100. */
  score: number;
  band: 'HIGH' | 'MODERATE' | 'LOW';
  components: {
    /** Null when the source holds no reporting records to measure it from. */
    completeness: number | null;
    /** Null when there are no received submissions to time. */
    timeliness: number | null;
    validity: number;
    consistency: number;
    stability: number;
  };
  /** Plain-language reasons the confidence is not higher. */
  reasons: string[];
}

export interface Scorecard {
  orgUnitId: string;
  orgUnitName: string;
  orgUnitLevel: OrgLevel;
  periodId: string;
  periodLabel: string;
  methodologyId: string;
  methodologyVersion: string;
  methodologyStatus: ScorecardMethodology['status'];
  /** Null when coverage fell below the methodology minimum. */
  overallScore: number | null;
  status: PerformanceStatus;
  trend: Trend;
  coverage: number;
  dataConfidence: DataConfidence;
  domains: DomainScore[];
  /**
   * Overall score at every period in the analysis window, oldest first.
   *
   * Computed as a by-product of the trend calculation, which already has to
   * score each historical period. Exposing it means a sparkline or trend line
   * costs nothing extra and can never disagree with the headline figure.
   */
  overallSeries: Array<number | null>;
  periodLabels: string[];
}
