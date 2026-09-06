import type { PerformanceStatus } from '@/core/scoring/types';
import { cn } from './cn';

/**
 * The headline figure.
 *
 * A score is rendered as a number out of 100 with its status stated in words.
 * The number is large because it is the one thing a senior reader must be able
 * to take in immediately — not because large type is decorative.
 */
export function ScoreDisplay({
  score,
  size = 'lg',
  status,
  className,
}: {
  score: number | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  status?: PerformanceStatus;
  className?: string;
}) {
  const sizes = {
    sm: 'text-[18px]',
    md: 'text-[24px]',
    lg: 'text-[36px]',
    xl: 'text-[52px]',
  } as const;
  const denominatorSizes = {
    sm: 'text-[11px]',
    md: 'text-[13px]',
    lg: 'text-[15px]',
    xl: 'text-[18px]',
  } as const;

  if (score === null) {
    return (
      <span className={cn('text-[var(--text-tertiary)]', sizes[size], className)}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">Score not available</span>
      </span>
    );
  }

  return (
    <span className={cn('numeric inline-flex items-baseline gap-1', className)}>
      <span
        className={cn('font-semibold leading-none tracking-[-0.02em] text-[var(--text-primary)]', sizes[size])}
      >
        {score}
      </span>
      <span className={cn('font-normal text-[var(--text-tertiary)]', denominatorSizes[size])}>/ 100</span>
      {status ? <span className="sr-only">, status {status.toLowerCase().replace('_', ' ')}</span> : null}
    </span>
  );
}

/**
 * Data confidence, always presented as a separate figure from performance.
 *
 * The product's central distinction is that "64 out of 100 at 94% confidence"
 * and "64 out of 100 at 41% confidence" are different findings. Rendering them
 * with different typography and an explicit band label keeps them from being
 * read as the same kind of number.
 */
export function ConfidenceDisplay({
  score,
  band,
  size = 'md',
  className,
  hideLabel,
}: {
  score: number;
  band: 'HIGH' | 'MODERATE' | 'LOW';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Drops the written band in dense tables, where the column header supplies it.
   *  The dot glyph and the accessible label still carry the meaning. */
  hideLabel?: boolean;
}) {
  const bandMeta = {
    HIGH: { label: 'High confidence', color: 'var(--positive-600)', glyph: '●●●' },
    MODERATE: { label: 'Moderate confidence', color: 'var(--warning-600)', glyph: '●●○' },
    LOW: { label: 'Low confidence', color: 'var(--concern-600)', glyph: '●○○' },
  }[band];

  const sizes = { sm: 'text-[14px]', md: 'text-[18px]', lg: 'text-[24px]' } as const;

  return (
    <span className={cn('inline-flex items-baseline gap-2', className)}>
      <span className={cn('numeric font-semibold text-[var(--text-primary)]', sizes[size])}>{score}%</span>
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium"
        style={{ color: bandMeta.color }}
      >
        <span aria-hidden="true" className="tracking-[-1px]">
          {bandMeta.glyph}
        </span>
        <span className={hideLabel ? 'sr-only' : undefined}>{bandMeta.label}</span>
      </span>
    </span>
  );
}
