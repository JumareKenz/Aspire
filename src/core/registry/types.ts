import type { OrgLevel, PeriodType } from '../model/types';

/** Which direction of movement is good for this indicator. */
export type Directionality = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';

export type IndicatorUnit = 'PERCENT' | 'RATE_PER_1000' | 'RATE_PER_100000' | 'COUNT' | 'RATIO';

/**
 * Validity bounds and consistency expectations used by the data-quality engine.
 * Kept on the indicator so rules are configuration, not code.
 */
export interface IndicatorQualityRules {
  /** Values below this are impossible for this indicator. */
  min: number | null;
  /** Values above this are impossible for this indicator. */
  max: number | null;
  /** If true, a numerator greater than its denominator is a consistency error. */
  numeratorMustNotExceedDenominator: boolean;
  /**
   * Period-on-period absolute percentage change beyond which a value is
   * flagged as a statistical outlier candidate. Null disables the check.
   */
  maxPeriodChangePct: number | null;
}

/** How a raw indicator value converts into a 0..100 score. */
export type ScoringRule =
  | {
      /** score = clamp(value / target * 100) for HIGHER_IS_BETTER, inverted otherwise. */
      kind: 'TARGET_RATIO';
      /** Score ceiling, so heavy overperformance cannot mask weakness elsewhere. */
      cap: number;
    }
  | {
      /** Piecewise bands. First band whose `upTo` is not exceeded wins. */
      kind: 'BANDS';
      bands: Array<{ upTo: number; score: number }>;
      /** Score used when the value exceeds every band's `upTo`. */
      above: number;
    }
  | {
      /** Linear interpolation between a floor (score 0) and a ceiling (score 100). */
      kind: 'LINEAR';
      floor: number;
      ceiling: number;
    };

export interface IndicatorDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  /** Programme domain this indicator rolls up into. */
  domainId: string;
  unit: IndicatorUnit;
  directionality: Directionality;
  frequency: PeriodType;
  /** Lowest org level at which this indicator is meaningful. */
  lowestLevel: OrgLevel;
  /** Supported disaggregation dimensions, e.g. ['age', 'sex']. */
  disaggregations: string[];
  /** Default target when no org- or period-specific target is configured. */
  defaultTarget: number;
  scoring: ScoringRule;
  quality: IndicatorQualityRules;
  /** Mapping back to the authoritative source. */
  source: {
    system: 'DHIS2' | 'DEMO';
    /** DHIS2 indicator or data-element UID. */
    dx: string | null;
    /** DHIS2 dataset UID that carries this indicator, for completeness checks. */
    datasetId: string | null;
    /**
     * For an indicator DHIS2 does not define usably: data element UIDs whose
     * values give the numerator and denominator, each one or more UIDs joined
     * with "+". Used only when `dx` is null; the value is numerator ÷
     * denominator scaled by the unit (×100 for PERCENT, ×1000 per thousand).
     */
    numeratorDx: string | null;
    denominatorDx: string | null;
  };
  active: boolean;
}

export interface DomainDefinition {
  id: string;
  name: string;
  description: string;
  /** Display order in scorecards and reports. */
  order: number;
}
