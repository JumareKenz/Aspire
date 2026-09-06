'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { MapData, MapUnit } from '@/services/geography';
import { Badge } from '@/design/primitives/Badge';
import { StatusPill } from '@/design/primitives/StatusPill';
import { ConfidenceDisplay } from '@/design/primitives/Score';
import { Select } from '@/design/primitives/Field';
import { cn } from '@/design/primitives/cn';

export type MapMetric = 'PERFORMANCE' | 'CHANGE' | 'CONFIDENCE' | 'FINDINGS';

const METRIC_LABELS: Record<MapMetric, string> = {
  PERFORMANCE: 'Overall performance',
  CHANGE: 'Change on previous period',
  CONFIDENCE: 'Data confidence',
  FINDINGS: 'Open data-quality findings',
};

/** Sequential ramp: one hue, light to dark, for magnitude. */
const SEQUENTIAL = [
  'var(--viz-seq-1)',
  'var(--viz-seq-2)',
  'var(--viz-seq-3)',
  'var(--viz-seq-4)',
  'var(--viz-seq-5)',
  'var(--viz-seq-6)',
];

const STATUS_FILL: Record<MapUnit['status'], string> = {
  ON_TRACK: 'var(--status-fill-positive)',
  WATCH: 'var(--status-fill-warning)',
  NEEDS_ATTENTION: 'var(--status-fill-concern)',
  NO_DATA: 'var(--status-fill-none)',
};

function valueFor(unit: MapUnit, metric: MapMetric): number | null {
  switch (metric) {
    case 'PERFORMANCE':
      return unit.score;
    case 'CHANGE':
      return unit.changePoints;
    case 'CONFIDENCE':
      return unit.dataConfidence;
    case 'FINDINGS':
      return unit.openFindings;
  }
}

/**
 * Geospatial view.
 *
 * The map answers one question — where are the problems — so status colour is
 * used for performance (where a band is what matters) and a single-hue
 * sequential ramp for the continuous metrics. Selecting an area opens a compact
 * panel rather than navigating away, because comparing two areas means coming
 * straight back.
 */
export function MapCanvas({ data, periodId }: { data: MapData; periodId: string }) {
  const [metric, setMetric] = useState<MapMetric>('PERFORMANCE');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const scale = useMemo(() => {
    const values = data.units
      .map((unit) => valueFor(unit, metric))
      .filter((value): value is number => value !== null);
    if (values.length === 0) return { min: 0, max: 1 };
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [data.units, metric]);

  const fillFor = (unit: MapUnit): string => {
    if (metric === 'PERFORMANCE') return STATUS_FILL[unit.status];
    const value = valueFor(unit, metric);
    if (value === null) return 'var(--status-fill-none)';
    const span = scale.max - scale.min || 1;
    const step = Math.min(
      SEQUENTIAL.length - 1,
      Math.max(0, Math.floor(((value - scale.min) / span) * SEQUENTIAL.length)),
    );
    // For findings and decline, more is worse: invert so darker means worse.
    const index = metric === 'CONFIDENCE' ? step : SEQUENTIAL.length - 1 - step;
    return SEQUENTIAL[metric === 'CHANGE' ? SEQUENTIAL.length - 1 - step : index];
  };

  const selected = data.units.find((unit) => unit.orgUnitId === selectedId) ?? null;
  const radius = data.mode === 'SCHEMATIC' ? 22 : 4;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="rounded-[var(--radius-lg)] border bg-[var(--surface)] p-3">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <Select
            label="Colour by"
            value={metric}
            onChange={(event) => setMetric(event.target.value as MapMetric)}
            className="w-[220px]"
          >
            {Object.entries(METRIC_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>

          <div className="mb-1 flex items-center gap-3">
            {metric === 'PERFORMANCE' ? (
              <div className="flex items-center gap-2.5">
                {(['ON_TRACK', 'WATCH', 'NEEDS_ATTENTION', 'NO_DATA'] as const).map((status) => (
                  <span key={status} className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: STATUS_FILL[status] }}
                    />
                    {status.toLowerCase().replace('_', ' ')}
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                <span>{metric === 'CONFIDENCE' ? 'lower' : 'better'}</span>
                {SEQUENTIAL.map((colour) => (
                  <span
                    key={colour}
                    aria-hidden="true"
                    className="inline-block h-2.5 w-5"
                    style={{ backgroundColor: colour }}
                  />
                ))}
                <span>{metric === 'CONFIDENCE' ? 'higher' : 'worse'}</span>
              </div>
            )}
          </div>
        </div>

        <svg
          viewBox={`0 0 ${data.width} ${data.height}`}
          className="w-full rounded-[var(--radius-md)] bg-[var(--surface-sunken)]"
          // A group rather than an image: the areas inside are focusable
          // controls, and an image's children are presentational, which would
          // make each area unreachable by keyboard.
          role="group"
          aria-label={`${METRIC_LABELS[metric]} by area. ${data.note}`}
        >
          {data.units.map((unit) => {
            const active = selectedId === unit.orgUnitId || hoveredId === unit.orgUnitId;
            const label = `${unit.name}: ${
              valueFor(unit, metric) === null ? 'no value' : valueFor(unit, metric)
            }`;
            return (
              <g
                key={unit.orgUnitId}
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={() => setSelectedId(unit.orgUnitId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedId(unit.orgUnitId);
                  }
                }}
                onMouseEnter={() => setHoveredId(unit.orgUnitId)}
                onMouseLeave={() => setHoveredId(null)}
                className="cursor-pointer outline-none"
              >
                <title>{label}</title>
                {unit.path ? (
                  <path
                    d={unit.path}
                    fill={fillFor(unit)}
                    stroke="var(--viz-surface)"
                    strokeWidth={active ? 2.5 : 1}
                    opacity={active ? 1 : 0.92}
                  />
                ) : (
                  <circle
                    cx={unit.cx}
                    cy={unit.cy}
                    r={active ? radius + 3 : radius}
                    fill={fillFor(unit)}
                    stroke="var(--viz-surface)"
                    strokeWidth={2}
                    className="transition-[r] duration-150"
                  />
                )}
                {data.mode === 'SCHEMATIC' ? (
                  <text
                    x={unit.cx}
                    y={unit.cy + 4}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="#ffffff"
                    className="numeric pointer-events-none"
                  >
                    {unit.score === null ? '—' : Math.round(unit.score)}
                  </text>
                ) : null}
                <text
                  x={unit.cx}
                  y={unit.cy + (data.mode === 'SCHEMATIC' ? radius + 15 : 16)}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-secondary)"
                  className="pointer-events-none"
                >
                  {unit.name}
                </text>
              </g>
            );
          })}
        </svg>

        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">{data.note}</p>
      </div>

      <aside
        className={cn(
          'rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4',
          selected ? 'animate-enter' : undefined,
        )}
        aria-live="polite"
      >
        {selected ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.011em]">{selected.name}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusPill status={selected.status} />
                {selected.changePoints !== null ? (
                  <Badge tone={selected.changePoints < 0 ? 'concern' : 'positive'}>
                    {selected.changePoints > 0 ? '+' : ''}
                    {selected.changePoints} pts
                  </Badge>
                ) : null}
              </div>
            </div>

            <dl className="space-y-2.5 border-t pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[12px] text-[var(--text-tertiary)]">Overall score</dt>
                <dd className="numeric text-[16px] font-semibold">{selected.score ?? '—'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[12px] text-[var(--text-tertiary)]">Data confidence</dt>
                <dd>
                  <ConfidenceDisplay
                    score={selected.dataConfidence}
                    band={
                      selected.dataConfidence >= 80
                        ? 'HIGH'
                        : selected.dataConfidence >= 55
                          ? 'MODERATE'
                          : 'LOW'
                    }
                    size="sm"
                    hideLabel
                  />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[12px] text-[var(--text-tertiary)]">Open quality findings</dt>
                <dd className="numeric text-[13px] font-semibold">{selected.openFindings}</dd>
              </div>
            </dl>

            <div className="flex flex-col gap-1.5 border-t pt-3">
              <Link
                href={`/performance?orgUnit=${selected.orgUnitId}&period=${periodId}`}
                className="text-[12px] text-[var(--brand-600)] hover:underline"
              >
                Open scorecard →
              </Link>
              <Link
                href={`/intelligence/data-quality?orgUnit=${selected.orgUnitId}&period=${periodId}`}
                className="text-[12px] text-[var(--brand-600)] hover:underline"
              >
                Review data quality →
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-[13px] font-semibold">Select an area</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
              Choose an area on the map to see its score, movement, data confidence and open findings, and to
              open its scorecard.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
