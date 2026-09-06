'use client';

import { useState } from 'react';
import { cn } from '../primitives/cn';
import type { PerformanceStatus } from '@/core/scoring/types';

export interface RankingDatum {
  id: string;
  label: string;
  value: number | null;
  status: PerformanceStatus;
  /** Secondary figure shown in the tooltip, e.g. data confidence. */
  secondary?: string;
}

const STATUS_FILL: Record<PerformanceStatus, string> = {
  ON_TRACK: 'var(--status-fill-positive)',
  WATCH: 'var(--status-fill-warning)',
  NEEDS_ATTENTION: 'var(--status-fill-concern)',
  NO_DATA: 'var(--status-fill-none)',
};

/**
 * Ranked comparison across places.
 *
 * Horizontal bars because the labels are place names and read left to right.
 * The value is direct-labelled on every bar — with this few rows there is no
 * collision risk and it removes a round trip to the axis.
 */
export function RankingBars({
  data,
  threshold,
  onSelect,
  selectedId,
  max = 100,
  className,
}: {
  data: RankingDatum[];
  /** On-track threshold, drawn as a reference line. */
  threshold?: number;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  max?: number;
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className={cn('space-y-px', className)}>
      {data.map((datum) => {
        const width = datum.value === null ? 0 : Math.max(0, Math.min(100, (datum.value / max) * 100));
        const active = hovered === datum.id || selectedId === datum.id;
        const Wrapper = onSelect ? 'button' : 'div';
        return (
          <Wrapper
            key={datum.id}
            {...(onSelect
              ? {
                  type: 'button' as const,
                  onClick: () => onSelect(datum.id),
                  'aria-pressed': selectedId === datum.id,
                }
              : {})}
            onMouseEnter={() => setHovered(datum.id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(datum.id)}
            onBlur={() => setHovered(null)}
            className={cn(
              'group grid w-full grid-cols-[minmax(90px,132px)_1fr_auto] items-center gap-3 rounded-[var(--radius-sm)] px-1.5 py-1 text-left transition-colors duration-100',
              onSelect && 'hover:bg-[var(--ink-050)]',
              selectedId === datum.id && 'bg-[var(--brand-050)]',
            )}
            title={
              datum.value === null
                ? `${datum.label}: no score available`
                : `${datum.label}: ${datum.value} out of 100${datum.secondary ? ` · ${datum.secondary}` : ''}`
            }
          >
            <span className="truncate text-[12px] text-[var(--text-secondary)]">{datum.label}</span>
            <span className="relative block h-2.5 w-full overflow-hidden rounded-full bg-[var(--ink-100)]">
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width,opacity] duration-500 ease-out"
                style={{
                  width: `${width}%`,
                  backgroundColor: STATUS_FILL[datum.status],
                  opacity: active ? 1 : 0.9,
                }}
              />
              {threshold !== undefined ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 w-px bg-[var(--text-secondary)]/60"
                  style={{ left: `${(threshold / max) * 100}%` }}
                />
              ) : null}
            </span>
            <span className="numeric w-9 text-right text-[12px] font-medium text-[var(--text-primary)]">
              {datum.value === null ? '—' : datum.value}
            </span>
          </Wrapper>
        );
      })}
    </div>
  );
}
