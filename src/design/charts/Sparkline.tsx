import { cn } from '../primitives/cn';

/**
 * A sparkline shows shape, not values. It carries no axes and no labels
 * because it lives inside a table row that already names the figure; the row's
 * own hover and the accessible summary carry the detail.
 */
export function Sparkline({
  values,
  width = 84,
  height = 22,
  tone = 'neutral',
  label,
  className,
}: {
  values: Array<number | null>;
  width?: number;
  height?: number;
  tone?: 'neutral' | 'positive' | 'concern';
  label: string;
  className?: string;
}) {
  const observed = values.filter((v): v is number => v !== null);
  if (observed.length < 2) {
    return (
      <span className={cn('text-[11px] text-[var(--text-tertiary)]', className)} title="Not enough history">
        —
      </span>
    );
  }

  const min = Math.min(...observed);
  const max = Math.max(...observed);
  const span = max - min || 1;
  const padding = 2;
  const stepX = (width - padding * 2) / (values.length - 1);

  const points: Array<{ x: number; y: number } | null> = values.map((value, index) => {
    if (value === null) return null;
    return {
      x: padding + index * stepX,
      y: padding + (height - padding * 2) * (1 - (value - min) / span),
    };
  });

  // Gaps in reporting break the line rather than being interpolated across,
  // so a missing period is visible as a missing period.
  const segments: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    if (point === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      continue;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  }
  if (current.length > 1) segments.push(current.join(' '));

  const stroke =
    tone === 'positive'
      ? 'var(--positive-600)'
      : tone === 'concern'
        ? 'var(--concern-600)'
        : 'var(--viz-series-1)';

  const last = [...points].reverse().find((point) => point !== null);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={label}
    >
      {segments.map((segment) => (
        <path
          key={segment}
          d={segment}
          fill="none"
          stroke={stroke}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {last ? <circle cx={last.x} cy={last.y} r={2.25} fill={stroke} /> : null}
    </svg>
  );
}
