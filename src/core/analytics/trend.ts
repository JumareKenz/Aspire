import type { Trend, TrendDirection } from '../scoring/types';
import { linearFit, percentChange, round } from './stats';

/**
 * A trend is only reported when there is enough history to justify one, and the
 * movement is large enough to be meaningful. Anything else is STABLE or UNKNOWN
 * — the platform does not narrate noise as a trend.
 */
export interface TrendOptions {
  /** Minimum number of observed periods before a direction is asserted. */
  minPeriods: number;
  /**
   * Absolute percentage change below which movement is reported as STABLE.
   * Guards against presenting rounding noise as a decline.
   */
  stableBandPct: number;
  /** True when a falling series is an improvement (e.g. maternal deaths). */
  lowerIsBetter: boolean;
}

export const DEFAULT_TREND_OPTIONS: TrendOptions = {
  minPeriods: 3,
  stableBandPct: 2,
  lowerIsBetter: false,
};

export const UNKNOWN_TREND: Trend = {
  direction: 'UNKNOWN',
  changePct: null,
  changePoints: null,
  periods: 0,
};

/**
 * Computes a trend from an ordered series (oldest first). Uses the endpoints
 * for the reported change and the regression slope to decide direction, so a
 * single noisy final period cannot flip the narrative on its own.
 */
export function computeTrend(series: Array<number | null>, options: Partial<TrendOptions> = {}): Trend {
  const opts = { ...DEFAULT_TREND_OPTIONS, ...options };
  const observed = series.filter((v): v is number => v !== null && Number.isFinite(v));
  if (observed.length < opts.minPeriods) {
    return { ...UNKNOWN_TREND, periods: observed.length };
  }

  const first = observed[0];
  const last = observed[observed.length - 1];
  const changePct = percentChange(first, last);
  const changePoints = round(last - first, 2);
  const { slope } = linearFit(observed);

  let direction: TrendDirection;
  const magnitude = changePct === null ? Math.abs(changePoints) : Math.abs(changePct);
  if (magnitude < opts.stableBandPct) {
    direction = 'STABLE';
  } else {
    const rising = slope > 0;
    const good = opts.lowerIsBetter ? !rising : rising;
    direction = good ? 'IMPROVING' : 'DECLINING';
  }

  return {
    direction,
    changePct: changePct === null ? null : round(changePct, 1),
    changePoints,
    periods: observed.length,
  };
}
