'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { Select } from '../primitives/Field';
import type { OrgLevel, PeriodType } from '@/core/model/types';
import { OrgUnitSelector } from './OrgUnitSelector';
import { cn } from '../primitives/cn';

export interface ScopeOption {
  id: string;
  name: string;
  level: OrgLevel;
  depth: number;
  parentId: string | null;
}

export interface PeriodOption {
  id: string;
  label: string;
  type: PeriodType;
}

/** The quarter a month falls in, and the months of a quarter, on period ids. */
function quarterOfMonth(id: string): string {
  return `${id.slice(0, 4)}Q${Math.floor((Number(id.slice(4)) - 1) / 3) + 1}`;
}
function lastMonthOf(quarterId: string): string {
  return `${quarterId.slice(0, 4)}${String(Number(quarterId.slice(5)) * 3).padStart(2, '0')}`;
}

/**
 * Scope selection.
 *
 * The selected geography and period live in the URL rather than in component
 * state, so any view a user is looking at can be sent to a colleague and opens
 * exactly as they left it — and so the map, the selector and every card read
 * one source of truth. Changing a selection is a transition, so the page stays
 * interactive while the server recomputes.
 */
export function ScopeBar({
  orgUnits,
  periods,
  orgUnitId,
  periodId,
  orgUnitPath,
  deepestLevel = 'LGA',
  children,
}: {
  orgUnits: ScopeOption[];
  periods: PeriodOption[];
  orgUnitId: string;
  periodId: string;
  /** The selected unit's ancestry, for the selector's label and breadcrumb. */
  orgUnitPath?: Array<{ id: string; name: string; level: OrgLevel }>;
  deepestLevel?: OrgLevel;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      // Changing geography invalidates a facility-level selection below it.
      if (key === 'orgUnit') params.delete('facility');
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const current = periods.find((period) => period.id === periodId);
  const type: PeriodType = current?.type ?? 'QUARTERLY';
  const months = periods.filter((period) => period.type === 'MONTHLY');
  const quarters = periods.filter((period) => period.type === 'QUARTERLY');
  const listed = type === 'MONTHLY' ? months : quarters;

  // Switching summary keeps the user in the same stretch of time: a quarter
  // becomes its last month (or the latest month held), a month its quarter.
  const switchTo = (next: PeriodType) => {
    if (next === type) return;
    if (next === 'QUARTERLY') {
      const quarter = quarterOfMonth(periodId);
      update('period', quarters.some((period) => period.id === quarter) ? quarter : (quarters[0]?.id ?? periodId));
    } else {
      const month = lastMonthOf(periodId);
      update('period', months.some((period) => period.id === month) ? month : (months[0]?.id ?? periodId));
    }
  };

  const path = orgUnitPath ?? (() => {
    const unit = orgUnits.find((option) => option.id === orgUnitId);
    return unit ? [{ id: unit.id, name: unit.name, level: unit.level }] : [];
  })();

  return (
    <div
      className="flex flex-wrap items-end gap-3"
      data-pending={pending ? '' : undefined}
      aria-busy={pending}
      style={{ opacity: pending ? 0.72 : 1, transition: 'opacity 150ms' }}
    >
      <OrgUnitSelector
        units={orgUnits.map(({ id, name, level, parentId }) => ({ id, name, level, parentId }))}
        path={path}
        value={orgUnitId}
        deepestLevel={deepestLevel}
        onSelect={(id) => update('orgUnit', id)}
      />

      {months.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-[var(--text-tertiary)]" id="summary-type-label">
            Summary
          </span>
          <div
            role="radiogroup"
            aria-labelledby="summary-type-label"
            className="flex h-8 rounded-[var(--radius-md)] border bg-[var(--surface)] p-0.5"
          >
            {(['MONTHLY', 'QUARTERLY'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={type === option}
                onClick={() => switchTo(option)}
                className={cn(
                  'rounded-[6px] px-2.5 text-[12px] font-medium transition-colors',
                  type === option
                    ? 'bg-[var(--brand-action)] text-[var(--brand-action-fg)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]',
                )}
              >
                {option === 'MONTHLY' ? 'Monthly' : 'Quarterly'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Select
        label={type === 'MONTHLY' ? 'Month' : 'Quarter'}
        value={periodId}
        onChange={(event) => update('period', event.target.value)}
        className="w-[180px]"
      >
        {listed.map((period) => (
          <option key={period.id} value={period.id}>
            {period.label}
          </option>
        ))}
      </Select>

      {children}
    </div>
  );
}
