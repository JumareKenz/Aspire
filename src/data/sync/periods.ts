import type { Period } from '@/core/model/types';
import { monthsOf, parsePeriod, periodRange } from '@/core/model/periods';
import { envNumber } from '@/lib/env';

/** Number of quarters retained and analysed. */
export const HISTORY_PERIODS = 12;

/**
 * Number of months retained for the monthly summary, ending with the last
 * month of the latest complete quarter. Monthly values are fetched from the
 * source as monthly values — DHIS2 aggregates each month by the data element's
 * own aggregation type — and are never derived from quarterly figures.
 *
 * `ASPIRE_MONTHLY_HISTORY` overrides it; 0 turns monthly synchronisation off,
 * which is the safety valve if a sync starts to run close to its time limit.
 */
export function monthlyHistoryPeriods(): number {
  return Math.max(0, Math.min(36, Math.floor(envNumber('ASPIRE_MONTHLY_HISTORY', 12))));
}

/** The most recent quarter that has fully elapsed. */
export function latestCompletePeriodId(now = new Date()): string {
  const year = now.getUTCFullYear();
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  return quarter === 1 ? `${year - 1}Q4` : `${year}Q${quarter - 1}`;
}

/** The analysis window, oldest first, ending at the latest complete quarter. */
export function analysisPeriods(now = new Date()): Period[] {
  return periodRange(latestCompletePeriodId(now), HISTORY_PERIODS);
}

/** The monthly window, oldest first, ending with the last month of the latest complete quarter. */
export function analysisMonths(now = new Date()): Period[] {
  const count = monthlyHistoryPeriods();
  if (count === 0) return [];
  const lastMonth = monthsOf(latestCompletePeriodId(now))[2];
  return periodRange(lastMonth, count);
}

export function periodOrThrow(id: string): Period {
  return parsePeriod(id);
}
