'use client';

import { useMemo, useRef, useState } from 'react';
import { cn } from '../primitives/cn';

export interface LineSeries {
  id: string;
  label: string;
  /** Values aligned to `labels`, oldest first. Null means the period is missing. */
  values: Array<number | null>;
}

/** Fixed slot order. Colour follows the series, never its rank in the data. */
const SERIES_COLORS = [
  'var(--viz-series-1)',
  'var(--viz-series-2)',
  'var(--viz-series-3)',
  'var(--viz-series-4)',
];

interface Point {
  x: number;
  y: number;
  value: number;
  index: number;
}

/**
 * Performance over time.
 *
 * One vertical scale only: series that cannot share a scale belong in separate
 * charts. A crosshair with a tooltip is standard rather than optional, because
 * the question a trend line raises is always "what was it in that period?".
 */
export function LineChart({
  labels,
  series,
  height = 220,
  yLabel,
  referenceValue,
  referenceLabel,
  valueSuffix = '',
  className,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  yLabel?: string;
  /** Optional horizontal reference, e.g. the on-track threshold. */
  referenceValue?: number | null;
  referenceLabel?: string;
  valueSuffix?: string;
  className?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const padding = { top: 12, right: 14, bottom: 26, left: 38 };
  const width = 720;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const { min, max, ticks } = useMemo(() => {
    const observed = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    if (referenceValue !== null && referenceValue !== undefined) observed.push(referenceValue);
    if (observed.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };

    // Round the axis to a step a reader can do arithmetic on. An axis labelled
    // 70 / 73.8 / 77.5 is technically correct and useless for comparison.
    const rawMin = Math.min(...observed);
    const rawMax = Math.max(...observed);
    const span = Math.max(rawMax - rawMin, 1);
    const rough = span / 3;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
    const lower = Math.max(0, Math.floor(rawMin / step) * step - (rawMin % step === 0 ? step : 0));
    const upper = Math.ceil(rawMax / step) * step;
    const count = Math.max(2, Math.round((upper - lower) / step));
    return {
      min: lower,
      max: upper,
      ticks: Array.from({ length: count + 1 }, (_, i) => Math.round((lower + step * i) * 100) / 100),
    };
  }, [series, referenceValue]);

  const scaleX = (index: number) =>
    padding.left + (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
  const scaleY = (value: number) =>
    padding.top + plotHeight * (1 - (value - min) / Math.max(1e-9, max - min));

  const paths = useMemo(
    () =>
      series.map((entry) => {
        const points: Array<Point | null> = entry.values.map((value, index) =>
          value === null ? null : { x: scaleX(index), y: scaleY(value), value, index },
        );
        const segments: string[] = [];
        let current: string[] = [];
        for (const point of points) {
          if (point === null) {
            if (current.length > 1) segments.push(current.join(' '));
            current = [];
            continue;
          }
          current.push(`${current.length === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`);
        }
        if (current.length > 1) segments.push(current.join(' '));
        return { entry, segments, points };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, min, max, labels.length, height],
  );

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || labels.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const ratio = ((event.clientX - rect.left) / rect.width) * width;
    const index = Math.round(((ratio - padding.left) / plotWidth) * (labels.length - 1));
    setHoverIndex(Math.max(0, Math.min(labels.length - 1, index)));
  };

  // Only the first, last and middle x labels are drawn: a label under every
  // period collides at this width and adds nothing the tooltip does not give.
  const labelIndices = new Set(
    labels.length <= 4
      ? labels.map((_, index) => index)
      : [0, Math.floor((labels.length - 1) / 2), labels.length - 1],
  );

  const activeIndex = hoverIndex;

  return (
    <figure className={cn('relative m-0', className)}>
      {series.length > 1 ? (
        <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((entry, index) => (
            <span key={entry.id} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
              />
              {entry.label}
            </span>
          ))}
        </figcaption>
      ) : null}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${yLabel ?? 'Values'} over ${labels.length} periods${
          series.length > 1 ? ` for ${series.map((s) => s.label).join(', ')}` : ''
        }`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={scaleY(tick)}
              y2={scaleY(tick)}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
            <text
              x={padding.left - 8}
              y={scaleY(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="numeric"
              fontSize={10}
              fill="var(--text-tertiary)"
            >
              {tick}
            </text>
          </g>
        ))}

        {referenceValue !== null && referenceValue !== undefined ? (
          <g>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={scaleY(referenceValue)}
              y2={scaleY(referenceValue)}
              stroke="var(--text-tertiary)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            {referenceLabel ? (
              <text
                x={width - padding.right}
                y={scaleY(referenceValue) - 4}
                textAnchor="end"
                fontSize={10}
                fill="var(--text-tertiary)"
              >
                {referenceLabel}
              </text>
            ) : null}
          </g>
        ) : null}

        {labels.map((label, index) =>
          labelIndices.has(index) ? (
            <text
              key={label + index}
              x={scaleX(index)}
              y={height - 8}
              textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'}
              fontSize={10}
              fill="var(--text-tertiary)"
            >
              {label}
            </text>
          ) : null,
        )}

        {activeIndex !== null ? (
          <line
            x1={scaleX(activeIndex)}
            x2={scaleX(activeIndex)}
            y1={padding.top}
            y2={padding.top + plotHeight}
            stroke="var(--border-strong)"
            strokeWidth={1}
          />
        ) : null}

        {paths.map(({ entry, segments, points }, seriesIndex) => {
          const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
          const active = activeIndex === null ? null : points[activeIndex];
          return (
            <g key={entry.id}>
              {segments.map((segment) => (
                <path
                  key={segment}
                  d={segment}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {active ? (
                <circle
                  cx={active.x}
                  cy={active.y}
                  r={4.5}
                  fill={color}
                  stroke="var(--viz-surface)"
                  strokeWidth={2}
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      {activeIndex !== null ? (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[128px] rounded-[var(--radius-md)] border bg-[var(--surface-raised)] px-2.5 py-2 shadow-[var(--shadow-md)]"
          style={{
            left: `${Math.min(78, Math.max(2, ((scaleX(activeIndex) - padding.left) / plotWidth) * 100))}%`,
          }}
        >
          <p className="mb-1 text-[11px] font-medium text-[var(--text-secondary)]">{labels[activeIndex]}</p>
          {series.map((entry, index) => {
            const value = entry.values[activeIndex];
            return (
              <p key={entry.id} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                  {series.length > 1 ? (
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
                    />
                  ) : null}
                  {series.length > 1 ? entry.label : (yLabel ?? entry.label)}
                </span>
                <span className="numeric font-medium text-[var(--text-primary)]">
                  {value === null ? 'No data' : `${value}${valueSuffix}`}
                </span>
              </p>
            );
          })}
        </div>
      ) : null}
    </figure>
  );
}
