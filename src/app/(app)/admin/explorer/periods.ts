/** Period choices for the explorer, in DHIS2's ISO period format. */

export type PeriodType = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface PeriodOption {
  id: string;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Recent periods of a type, newest first, ending at the current period. */
export function recentPeriods(type: PeriodType, now = new Date()): PeriodOption[] {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const out: PeriodOption[] = [];
  if (type === 'MONTHLY') {
    for (let i = 0; i < 36; i += 1) {
      const d = new Date(year, month - i, 1);
      out.push({
        id: `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      });
    }
  } else if (type === 'QUARTERLY') {
    const quarter = Math.floor(month / 3);
    for (let i = 0; i < 16; i += 1) {
      const q = quarter - i;
      const y = year + Math.floor(q / 4);
      const n = ((q % 4) + 4) % 4 + 1;
      out.push({ id: `${y}Q${n}`, label: `Q${n} ${y}` });
    }
  } else {
    for (let i = 0; i < 8; i += 1) out.push({ id: String(year - i), label: String(year - i) });
  }
  return out;
}

/** DHIS2 relative periods, resolved by DHIS2 at query time. */
export const RELATIVE: PeriodOption[] = [
  { id: 'LAST_4_QUARTERS', label: 'Last 4 quarters' },
  { id: 'LAST_12_MONTHS', label: 'Last 12 months' },
  { id: 'LAST_6_MONTHS', label: 'Last 6 months' },
  { id: 'THIS_YEAR', label: 'This year' },
  { id: 'LAST_YEAR', label: 'Last year' },
];

/** A readable label for any period id the explorer may hold. */
export function periodLabel(id: string): string {
  const relative = RELATIVE.find((option) => option.id === id);
  if (relative) return relative.label;
  const month = /^(\d{4})(\d{2})$/.exec(id);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const quarter = /^(\d{4})Q([1-4])$/.exec(id);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;
  return id;
}
