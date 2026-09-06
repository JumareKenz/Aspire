'use client';

import { cn } from '../primitives/cn';
import type { Contribution } from '@/core/analytics/attribution';

/**
 * What moved the headline figure.
 *
 * Diverging about a zero baseline: position left or right of zero carries the
 * polarity, the signed number states it in text, and colour only reinforces
 * what those two have already said. That layering is what makes the chart
 * readable in greyscale and with colour-vision deficiency.
 */
export function ContributionBars({
  contributions,
  className,
  onSelect,
}: {
  contributions: Contribution[];
  className?: string;
  onSelect?: (id: string) => void;
}) {
  const magnitude = Math.max(
    0.5,
    ...contributions.map((entry) => Math.abs(entry.contributionPoints)),
  );

  return (
    <div className={cn('space-y-1', className)}>
      {contributions.map((entry) => {
        const share = (Math.abs(entry.contributionPoints) / magnitude) * 50;
        const positive = entry.contributionPoints >= 0;
        // A domain that did not move is a real and useful finding — it says the
        // change came from somewhere else — but drawing it as a stub bar
        // labelled "+0" reads as a rendering fault. It gets words instead.
        const unmoved = Math.abs(entry.contributionPoints) < 0.05;
        const Wrapper = onSelect ? 'button' : 'div';
        return (
          <Wrapper
            key={entry.id}
            {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(entry.id) } : {})}
            className={cn(
              'grid w-full grid-cols-[minmax(96px,150px)_1fr_auto] items-center gap-3 rounded-[var(--radius-sm)] px-1.5 py-1 text-left',
              onSelect && 'transition-colors duration-100 hover:bg-[var(--ink-050)]',
            )}
            title={
              unmoved
                ? `${entry.name}: no material contribution to the overall change`
                : `${entry.name}: ${positive ? '+' : ''}${entry.contributionPoints} points of the overall change, ${Math.round(entry.share * 100)}% of the total movement`
            }
          >
            <span className="truncate text-[12px] text-[var(--text-secondary)]">{entry.name}</span>
            <span className="relative block h-3 w-full">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-1/2 w-px bg-[var(--viz-diverge-neutral)]"
              />
              {unmoved ? null : (
                <span
                  className="absolute top-0.5 bottom-0.5 rounded-[2px] transition-[width] duration-500 ease-out"
                  style={{
                    left: positive ? '50%' : `${50 - share}%`,
                    width: `${share}%`,
                    backgroundColor: positive
                      ? 'var(--viz-diverge-positive)'
                      : 'var(--viz-diverge-negative)',
                  }}
                />
              )}
            </span>
            {unmoved ? (
              <span className="w-16 text-right text-[11px] text-[var(--text-tertiary)]">no change</span>
            ) : (
              <span className="numeric w-16 text-right text-[12px] font-medium text-[var(--text-primary)]">
                {positive ? '+' : ''}
                {entry.contributionPoints}
              </span>
            )}
          </Wrapper>
        );
      })}
    </div>
  );
}
