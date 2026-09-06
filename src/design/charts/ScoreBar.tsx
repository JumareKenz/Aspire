import { cn } from '../primitives/cn';
import type { PerformanceStatus } from '@/core/scoring/types';

const STATUS_FILL: Record<PerformanceStatus, string> = {
  ON_TRACK: 'var(--status-fill-positive)',
  WATCH: 'var(--status-fill-warning)',
  NEEDS_ATTENTION: 'var(--status-fill-concern)',
  NO_DATA: 'var(--status-fill-none)',
};

/**
 * A score against its threshold, as a single bar with a target marker.
 *
 * The bar answers "how far along" and the tick answers "far enough?" in the
 * same glance. Status colour is reinforced by the marker's position and by the
 * written status shown alongside it in every context this is used.
 */
export function ScoreBar({
  score,
  target,
  status,
  className,
  height = 6,
}: {
  score: number | null;
  target: number;
  status: PerformanceStatus;
  className?: string;
  height?: number;
}) {
  const width = score === null ? 0 : Math.max(0, Math.min(100, score));
  const targetPosition = Math.max(0, Math.min(100, target));

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-full bg-[var(--ink-100)]', className)}
      style={{ height }}
      role="img"
      aria-label={
        score === null
          ? 'No score available'
          : `Score ${score} out of 100 against a threshold of ${target}`
      }
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${width}%`, backgroundColor: STATUS_FILL[status] }}
      />
      <div
        className="absolute top-0 h-full w-px bg-[var(--text-secondary)]"
        style={{ left: `${targetPosition}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
