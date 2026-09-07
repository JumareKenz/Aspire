'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { Select } from '../primitives/Field';
import type { OrgLevel } from '@/core/model/types';

export interface ScopeOption {
  id: string;
  name: string;
  level: OrgLevel;
  depth: number;
}

export interface PeriodOption {
  id: string;
  label: string;
}

const LEVEL_LABEL: Record<OrgLevel, string> = {
  // The top of the hierarchy is the programme, not the country: ASPIRE-GAC
  // covers two states, and calling that level "national" would claim national
  // coverage the data does not have.
  COUNTRY: 'Programme',
  STATE: 'State',
  LGA: 'LGA',
  FACILITY: 'Facility',
};

/**
 * Scope selection.
 *
 * The selected geography and period live in the URL rather than in component
 * state, so any view a user is looking at can be sent to a colleague and opens
 * exactly as they left it. Changing a selection is a transition, so the page
 * stays interactive while the server recomputes.
 */
export function ScopeBar({
  orgUnits,
  periods,
  orgUnitId,
  periodId,
  children,
}: {
  orgUnits: ScopeOption[];
  periods: PeriodOption[];
  orgUnitId: string;
  periodId: string;
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

  return (
    <div
      className="flex flex-wrap items-end gap-3"
      data-pending={pending ? '' : undefined}
      style={{ opacity: pending ? 0.72 : 1, transition: 'opacity 150ms' }}
    >
      <Select
        label="Geography"
        value={orgUnitId}
        onChange={(event) => update('orgUnit', event.target.value)}
        className="w-[220px]"
      >
        {orgUnits.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {' '.repeat(Math.max(0, unit.depth) * 2)}
            {unit.name}
            {unit.depth === 0 ? ` · ${LEVEL_LABEL[unit.level]}` : ''}
          </option>
        ))}
      </Select>

      <Select
        label="Reporting period"
        value={periodId}
        onChange={(event) => update('period', event.target.value)}
        className="w-[150px]"
      >
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {period.label}
          </option>
        ))}
      </Select>

      {children}
    </div>
  );
}
