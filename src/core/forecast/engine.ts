import { clamp, linearFit, mean, round, stdDev } from '../analytics/stats';

/** Identifies the method and revision behind every published forecast. */
export const FORECAST_MODEL_ID = 'ols-trend';
export const FORECAST_MODEL_VERSION = '1.0.0';

/** Below this many observed periods the platform refuses to forecast. */
export const MIN_PERIODS_FOR_FORECAST = 6;

export type ForecastResult = InsufficientForecast | Forecast;

export interface InsufficientForecast {
  available: false;
  /** Plain-language explanation shown directly to the user. */
  reason: string;
  observedPeriods: number;
  requiredPeriods: number;
}

export interface ForecastPoint {
  periodId: string;
  value: number;
  lower: number;
  upper: number;
}

export interface Forecast {
  available: true;
  modelId: string;
  modelVersion: string;
  observedPeriods: number;
  /** Forecast horizon, oldest first. */
  points: ForecastPoint[];
  /** 0..1 fit quality of the underlying trend. */
  fitQuality: number;
  /** 0..1 overall confidence, discounted for short history and poor fit. */
  confidence: number;
  /** Direction the model expects, expressed for a HIGHER_IS_BETTER reading. */
  direction: 'RISING' | 'FLAT' | 'FALLING';
  /** Ranked factors behind the projection, most influential first. */
  drivers: string[];
  /** Probability 0..1 the target is missed at the end of the horizon. */
  targetMissProbability: number | null;
}

/** Abramowitz & Stegun 7.1.26 error-function approximation. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 1e-9) return x >= mu ? 1 : 0;
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

export interface ForecastInput {
  /** Observed values aligned to `periodIds`, oldest first. Nulls are skipped. */
  values: Array<number | null>;
  /** Identifiers for the forecast horizon, oldest first. */
  horizonPeriodIds: string[];
  target?: number | null;
  directionality?: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
  /** Human labels for what is driving the series, ranked. */
  drivers?: string[];
}

/**
 * Ordinary least-squares trend extrapolation with residual-based prediction
 * intervals.
 *
 * The model is deliberately simple and its limits are explicit: with fewer than
 * `MIN_PERIODS_FOR_FORECAST` observations it returns an unavailable result
 * rather than a number. The platform never fabricates a forecast.
 */
export function forecast(input: ForecastInput): ForecastResult {
  const observed = input.values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (observed.length < MIN_PERIODS_FOR_FORECAST) {
    return {
      available: false,
      reason: `Insufficient historical data for a reliable prediction. ${observed.length} reporting ${
        observed.length === 1 ? 'period is' : 'periods are'
      } available and at least ${MIN_PERIODS_FOR_FORECAST} are required.`,
      observedPeriods: observed.length,
      requiredPeriods: MIN_PERIODS_FOR_FORECAST,
    };
  }

  const fit = linearFit(observed);
  const residuals = observed.map((value, index) => value - (fit.intercept + fit.slope * index));
  const residualSd = stdDev(residuals);
  const lastIndex = observed.length - 1;

  const points: ForecastPoint[] = input.horizonPeriodIds.map((periodId, offset) => {
    const x = lastIndex + offset + 1;
    const predicted = fit.intercept + fit.slope * x;
    // Uncertainty widens with distance from the observed range.
    const spread = 1.96 * residualSd * Math.sqrt(1 + (offset + 1) / observed.length);
    return {
      periodId,
      value: round(Math.max(0, predicted), 1),
      lower: round(Math.max(0, predicted - spread), 1),
      upper: round(Math.max(0, predicted + spread), 1),
    };
  });

  // Short histories and weak fits both reduce how much the projection is worth.
  const historyFactor = clamp(observed.length / (MIN_PERIODS_FOR_FORECAST * 2), 0, 1);
  const confidence = round(clamp(0.25 + 0.5 * fit.r2 + 0.25 * historyFactor, 0, 0.95), 2);

  const relativeSlope = Math.abs(mean(observed)) > 1e-9 ? fit.slope / Math.abs(mean(observed)) : 0;
  const direction = Math.abs(relativeSlope) < 0.01 ? 'FLAT' : fit.slope > 0 ? 'RISING' : 'FALLING';

  let targetMissProbability: number | null = null;
  const target = input.target ?? null;
  if (target !== null && Number.isFinite(target) && points.length > 0) {
    const final = points[points.length - 1];
    const sigma = Math.max(residualSd, 1e-6);
    const probBelow = normalCdf(target, final.value, sigma);
    targetMissProbability =
      input.directionality === 'LOWER_IS_BETTER' ? round(1 - probBelow, 2) : round(probBelow, 2);
  }

  return {
    available: true,
    modelId: FORECAST_MODEL_ID,
    modelVersion: FORECAST_MODEL_VERSION,
    observedPeriods: observed.length,
    points,
    fitQuality: round(fit.r2, 2),
    confidence,
    direction,
    drivers: input.drivers ?? [],
    targetMissProbability,
  };
}
