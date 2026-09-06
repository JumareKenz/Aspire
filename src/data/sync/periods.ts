import type { Period } from '@/core/model/types';
import { parsePeriod, periodRange } from '@/core/model/periods';

/** Number of quarters retained and analysed. */
export const HISTORY_PERIODS = 12;

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

export function periodOrThrow(id: string): Period {
  return parsePeriod(id);
}
