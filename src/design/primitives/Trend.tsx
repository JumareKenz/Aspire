import type { Trend as TrendValue } from '@/core/scoring/types';
import { cn } from './cn';

const DIRECTION_META = {
  IMPROVING: { glyph: '↑', label: 'Improving', className: 'text-[var(--positive-600)]' },
  DECLINING: { glyph: '↓', label: 'Declining', className: 'text-[var(--concern-600)]' },
  STABLE: { glyph: '→', label: 'Stable', className: 'text-[var(--text-tertiary)]' },
  UNKNOWN: { glyph: '·', label: 'Not enough history', className: 'text-[var(--text-tertiary)]' },
} as const;

/**
 * A trend is shown as arrow, figure and accessible label together. The arrow
 * alone would be ambiguous for a lower-is-better indicator, so the direction
 * has already been resolved into "improving" or "declining" upstream.
 */
export function TrendIndicator({
  trend,
  showLabel = false,
  className,
}: {
  trend: TrendValue;
  showLabel?: boolean;
  className?: string;
}) {
  const meta = DIRECTION_META[trend.direction];
  const figure =
    trend.direction === 'UNKNOWN'
      ? '—'
      : trend.changePct === null
        ? `${trend.changePoints ?? 0} pts`
        : `${trend.changePct > 0 ? '+' : ''}${trend.changePct}%`;

  return (
    <span
      className={cn('numeric inline-flex items-center gap-1 text-[12px] font-medium', meta.className, className)}
      title={
        trend.direction === 'UNKNOWN'
          ? 'Not enough reporting history to establish a trend'
          : `${meta.label} over ${trend.periods} periods`
      }
    >
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{figure}</span>
      <span className="sr-only">
        {meta.label}
        {trend.direction === 'UNKNOWN' ? '' : ` over ${trend.periods} periods`}
      </span>
      {showLabel ? <span className="font-normal text-[var(--text-tertiary)]">{meta.label}</span> : null}
    </span>
  );
}
