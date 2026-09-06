import type { Period } from './types';

/** Zero-padded month. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Builds a Period record from a DHIS2 ISO period identifier. */
export function parsePeriod(id: string): Period {
  const quarterly = /^(\d{4})Q([1-4])$/.exec(id);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const quarter = Number(quarterly[2]);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      id,
      type: 'QUARTERLY',
      startDate: `${year}-${pad(startMonth)}-01`,
      endDate: `${year}-${pad(endMonth)}-${pad(lastDayOfMonth(year, endMonth))}`,
      label: `Q${quarter} ${year}`,
    };
  }

  const monthly = /^(\d{4})(\d{2})$/.exec(id);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]);
    const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-GB', {
      month: 'long',
      timeZone: 'UTC',
    });
    return {
      id,
      type: 'MONTHLY',
      startDate: `${year}-${pad(month)}-01`,
      endDate: `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`,
      label: `${monthName} ${year}`,
    };
  }

  const yearly = /^(\d{4})$/.exec(id);
  if (yearly) {
    return {
      id,
      type: 'YEARLY',
      startDate: `${id}-01-01`,
      endDate: `${id}-12-31`,
      label: id,
    };
  }

  throw new Error(`Unrecognised period identifier: ${id}`);
}

/** The period immediately before `id`, in the same period type. */
export function previousPeriodId(id: string): string {
  const period = parsePeriod(id);
  if (period.type === 'QUARTERLY') {
    const [year, quarter] = [Number(id.slice(0, 4)), Number(id.slice(5))];
    return quarter === 1 ? `${year - 1}Q4` : `${year}Q${quarter - 1}`;
  }
  if (period.type === 'MONTHLY') {
    const [year, month] = [Number(id.slice(0, 4)), Number(id.slice(4))];
    return month === 1 ? `${year - 1}12` : `${year}${pad(month - 1)}`;
  }
  return String(Number(id) - 1);
}

/** The period immediately after `id`, in the same period type. */
export function nextPeriodId(id: string): string {
  const period = parsePeriod(id);
  if (period.type === 'QUARTERLY') {
    const [year, quarter] = [Number(id.slice(0, 4)), Number(id.slice(5))];
    return quarter === 4 ? `${year + 1}Q1` : `${year}Q${quarter + 1}`;
  }
  if (period.type === 'MONTHLY') {
    const [year, month] = [Number(id.slice(0, 4)), Number(id.slice(4))];
    return month === 12 ? `${year + 1}01` : `${year}${pad(month + 1)}`;
  }
  return String(Number(id) + 1);
}

/** `count` consecutive periods ending at `endId`, oldest first. */
export function periodRange(endId: string, count: number): Period[] {
  const ids: string[] = [endId];
  for (let i = 1; i < count; i += 1) {
    ids.unshift(previousPeriodId(ids[0]));
  }
  return ids.map(parsePeriod);
}

/** `count` consecutive periods starting after `startId`, oldest first. */
export function futurePeriods(startId: string, count: number): Period[] {
  const result: Period[] = [];
  let cursor = startId;
  for (let i = 0; i < count; i += 1) {
    cursor = nextPeriodId(cursor);
    result.push(parsePeriod(cursor));
  }
  return result;
}
