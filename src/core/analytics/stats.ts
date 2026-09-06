/** Numerical primitives shared by every analytical engine. Pure, no I/O. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Sample standard deviation. Returns 0 for fewer than two values. */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Median absolute deviation, scaled to be comparable with a standard deviation. */
export function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const med = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - med)));
}

/**
 * Robust z-score using median and MAD, which does not get dragged around by the
 * very outlier it is trying to detect. Falls back to a classical z-score when
 * the MAD is zero (all values identical or near-identical).
 */
export function robustZScore(value: number, values: number[]): number {
  const mad = medianAbsoluteDeviation(values);
  if (mad > 1e-9) return (value - median(values)) / mad;
  const sd = stdDev(values);
  if (sd > 1e-9) return (value - mean(values)) / sd;
  return 0;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Coefficient of determination, 0..1. */
  r2: number;
}

/** Ordinary least squares fit of y against its own index. */
export function linearFit(values: number[]): LinearFit {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? values[0] : 0, r2: 0 };
  const xs = values.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (values[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = intercept + slope * xs[i];
    ssRes += (values[i] - predicted) ** 2;
    ssTot += (values[i] - my) ** 2;
  }
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : clamp(1 - ssRes / ssTot, 0, 1);
  return { slope, intercept, r2 };
}

/** Percentage change from `from` to `to`. Null when `from` is zero or absent. */
export function percentChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (Math.abs(from) < 1e-9) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

/** Round to a fixed number of decimals without exponent surprises. */
export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
