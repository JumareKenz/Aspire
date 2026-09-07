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

/** Below this rendered area a polygon cannot hold its own label legibly. */
const MIN_LABEL_AREA = 2600;

/**
 * Approximate rendered width of a string at the label font size.
 *
 * Measured against the shipped semibold face and rounded *up*: an estimate
 * that runs narrow lets two labels reserve boxes that do not overlap while the
 * glyphs that land in them do. The two extra pixels of padding cover the halo
 * stroke, which is painted outside the text box.
 */
function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62 + 4;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export type LabelPlacement =
  /** `box` is the space this label reserved, so a caller can check the result. */
  | { kind: 'INSIDE'; unit: MapUnit; box: Box }
  | { kind: 'LEADER'; unit: MapUnit; dx: number; dy: number; anchor: 'start' | 'end'; box: Box };

/**
 * Decides where each label goes, or that it goes nowhere.
 *
 * Small adjacent units — the LGAs around a state capital, typically — cannot
 * all carry a label. Drawing them anyway produced stacks of overprinted text,
 * so labels are placed largest-first and anything that would collide with one
 * already placed is either moved to a free leader position or dropped.
 *
 * A dropped label costs nothing that matters: the shape is still focusable,
 * still hoverable, still carries its name in the accessible label and the SVG
 * title, and selecting it fills the detail panel. Overprinted text costs the
 * reader both names.
 */
export function placeLabels(units: MapUnit[], value: (unit: MapUnit) => number | null): LabelPlacement[] {
  // Candidate leader directions, tried in order: up-left, up-right, down-left,
  // down-right, then the same again further out.
  const OFFSETS: Array<{ dx: number; dy: number; anchor: 'start' | 'end' }> = [
    { dx: -34, dy: -22, anchor: 'end' },
    { dx: 34, dy: -22, anchor: 'start' },
    { dx: -34, dy: 26, anchor: 'end' },
    { dx: 34, dy: 26, anchor: 'start' },
    { dx: -56, dy: -40, anchor: 'end' },
    { dx: 56, dy: -40, anchor: 'start' },
    { dx: -56, dy: 44, anchor: 'end' },
    { dx: 56, dy: 44, anchor: 'start' },
  ];

  const placed: Box[] = [];
  const result: LabelPlacement[] = [];

  // Largest first: a big polygon has the strongest claim to its own centre.
  for (const unit of [...units].sort((a, b) => b.area - a.area)) {
    const reading = value(unit);
    const text = `${unit.name} ${reading === null ? '—' : reading}`;
    const roomy = unit.path === null || unit.area > MIN_LABEL_AREA;

    if (roomy) {
      const w = Math.max(textWidth(unit.name, 11), textWidth(String(reading ?? '—'), 11));
      const box: Box = { x: unit.cx - w / 2, y: unit.cy - 12, w, h: 28 };
      if (!placed.some((entry) => overlaps(entry, box))) {
        placed.push(box);
        result.push({ kind: 'INSIDE', unit, box });
        continue;
      }
    }

    const w = textWidth(text, 10);
    let chosen: Box | null = null;
    const found = OFFSETS.find(({ dx, dy, anchor }) => {
      const x = anchor === 'end' ? unit.cx + dx - 3 - w : unit.cx + dx + 3;
      const box: Box = { x, y: unit.cy + dy - 12, w, h: 14 };
      if (placed.some((entry) => overlaps(entry, box))) return false;
      placed.push(box);
      chosen = box;
      return true;
    });
    if (found && chosen) result.push({ kind: 'LEADER', unit, ...found, box: chosen });
  }

  return result;
}

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

  // Label placement depends only on the geometry and the metric being shown,
  // so it is computed once per render of that pair rather than per shape.
  const labels = useMemo(
    () => placeLabels(data.units, (unit) => valueFor(unit, metric)),
    [data.units, metric],
  );

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
          {/* Panel captions and dividers, when the canvas holds more than one
              geography. Drawn first so every shape sits above them. */}
          {data.panels.map((panel, index) => (
            <g key={panel.name}>
              {index > 0 ? (
                <line
                  x1={panel.x}
                  y1={26}
                  x2={panel.x}
                  y2={data.height - 8}
                  stroke="var(--border)"
                  strokeDasharray="3 4"
                />
              ) : null}
              <text
                x={panel.x + panel.width / 2}
                y={18}
                textAnchor="middle"
                className="fill-[var(--text-secondary)] text-[12px] font-semibold"
              >
                {panel.name}
              </text>
            </g>
          ))}

          {data.units.map((unit) => {
            const active = selectedId === unit.orgUnitId || hoveredId === unit.orgUnitId;
            const value = valueFor(unit, metric);
            // The state is part of the label when the map spans more than one:
            // two LGAs can share a name, and a reader comparing across states
            // needs to know which one they are pointing at.
            const label = `${unit.name}${unit.groupName ? `, ${unit.groupName}` : ''}: ${
              value === null ? 'no value' : value
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
                    opacity={active ? 1 : 0.94}
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
              </g>
            );
          })}

          {/*
            Labels are drawn in a second pass, above every fill, so a neighbour
            painted later cannot cover them. White text with a dark halo reads
            on all four status colours and on every step of the sequential ramp,
            which plain dark text does not.
          */}
          {labels.map((placement) => {
            const { unit } = placement;
            const value = valueFor(unit, metric);
            if (placement.kind === 'INSIDE') {
              return (
                <g key={`label-${unit.orgUnitId}`} className="pointer-events-none">
                  <text
                    x={unit.cx}
                    y={unit.cy}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="#ffffff"
                    stroke="rgb(20 24 20 / 0.55)"
                    strokeWidth={2.6}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    {unit.name}
                  </text>
                  <text
                    x={unit.cx}
                    y={unit.cy + 13}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill="#ffffff"
                    stroke="rgb(20 24 20 / 0.55)"
                    strokeWidth={2.6}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                    className="numeric"
                  >
                    {value === null ? '—' : value}
                  </text>
                </g>
              );
            }
            // Too small to hold its own label, or its centre is already taken:
            // a leader line carries the name to the nearest free position.
            const { dx, dy, anchor } = placement;
            return (
              <g key={`label-${unit.orgUnitId}`} className="pointer-events-none">
                <line
                  x1={unit.cx}
                  y1={unit.cy}
                  x2={unit.cx + dx}
                  y2={unit.cy + dy}
                  stroke="var(--text-tertiary)"
                  strokeWidth={1}
                />
                <text
                  x={unit.cx + dx + (anchor === 'end' ? -3 : 3)}
                  y={unit.cy + dy - 2}
                  textAnchor={anchor}
                  fontSize={10}
                  fontWeight={600}
                  fill="var(--text-primary)"
                  stroke="var(--viz-surface)"
                  strokeWidth={2.4}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                >
                  {unit.name} {value === null ? '—' : value}
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
              {selected.groupName ? (
                <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">{selected.groupName}</p>
              ) : null}
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
