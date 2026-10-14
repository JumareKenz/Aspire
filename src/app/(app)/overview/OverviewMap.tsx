'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { OverviewMap as OverviewMapData, OverviewMapArea } from '@/services/geography';
import type { MapUnit } from '@/services/geography';
import type { PerformanceStatus } from '@/core/scoring/types';
import { StatusPill } from '@/design/primitives/StatusPill';
import { cn } from '@/design/primitives/cn';
import { placeLabels } from '../map/MapCanvas';

type Box = { x: number; y: number; w: number; h: number };

const FILL: Record<PerformanceStatus, string> = {
  ON_TRACK: 'var(--status-fill-positive)',
  WATCH: 'var(--status-fill-warning)',
  NEEDS_ATTENTION: 'var(--status-fill-concern)',
  NO_DATA: 'url(#overview-map-no-data)',
};

const STATUS_WORD: Record<PerformanceStatus, string> = {
  ON_TRACK: 'on track',
  WATCH: 'watch',
  NEEDS_ATTENTION: 'needs attention',
  NO_DATA: 'no data',
};

const DURATION_MS = 650;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** A box around `bounds`, padded and widened to the canvas aspect so nothing is cut off. */
function frame(
  bounds: [[number, number], [number, number]],
  canvas: { width: number; height: number },
  padding: number,
  minWidth: number,
): Box {
  const [[x0, y0], [x1, y1]] = bounds;
  let w = Math.max((x1 - x0) * (1 + padding * 2), minWidth);
  let h = Math.max((y1 - y0) * (1 + padding * 2), (minWidth * canvas.height) / canvas.width);
  const aspect = canvas.width / canvas.height;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  // Never zoom out past the whole canvas.
  if (w > canvas.width) {
    w = canvas.width;
    h = canvas.height;
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    x: Math.min(Math.max(cx - w / 2, 0), canvas.width - w),
    y: Math.min(Math.max(cy - h / 2, 0), canvas.height - h),
    w,
    h,
  };
}

export interface MapSelectionSummary {
  name: string;
  level: string;
  parentName: string | null;
  periodLabel: string;
  score: number | null;
  status: PerformanceStatus;
  coverage: number;
  dataConfidence: number;
  indicatorsWithData: number;
  indicatorsTotal: number;
  domains: Array<{ id: string; name: string; score: number | null; status: PerformanceStatus }>;
}

/**
 * The geographical entry to the overview.
 *
 * The camera moves; the geometry does not. Choosing a state eases the view to
 * its boundary and reveals its LGAs; choosing an LGA eases in to frame it and
 * updates every figure on the page, because the choice is written to the URL
 * — the same `orgUnit` parameter the geography selector writes. The map
 * never holds its own copy of the selection, so the two cannot disagree and
 * cannot set each other off in a loop.
 *
 * Everything drawn is inside the user's access: the server builds the
 * geometry from their scope root, so a state officer's map has no other state
 * in it to navigate to.
 */
export function OverviewMap({
  map,
  selectedId,
  rootId,
  summary,
}: {
  map: OverviewMapData;
  selectedId: string;
  /** The top of the user's access, for "back to all". */
  rootId: string;
  summary: MapSelectionSummary | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The area just chosen, so the camera moves at once rather than after the
  // server has recomputed the page. Cleared when the URL catches up.
  // Tagged with the selection it was made from, so it lapses by itself once
  // the page arrives with the new selection.
  const [optimistic, setOptimistic] = useState<{ from: string; stateId: string | null; lgaId: string | null } | null>(null);
  const [hover, setHover] = useState<{ area: OverviewMapArea; x: number; y: number; width: number } | null>(null);
  const [animating, setAnimating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const focus = optimistic && optimistic.from === selectedId ? optimistic : map.focus;
  const crossState = map.states.length > 1;
  const canvas = useMemo(() => ({ width: map.width, height: map.height }), [map.width, map.height]);
  const full: Box = useMemo(() => ({ x: 0, y: 0, w: map.width, h: map.height }), [map.width, map.height]);

  const target = useMemo<Box>(() => {
    const lga = focus.lgaId ? map.lgas.find((area) => area.id === focus.lgaId) : null;
    if (lga?.bounds) return frame(lga.bounds, canvas, 0.45, map.width / 5);
    const state = focus.stateId ? map.states.find((area) => area.id === focus.stateId) : null;
    if (state?.bounds && crossState) return frame(state.bounds, canvas, 0.06, map.width / 3);
    return full;
  }, [focus, map, canvas, crossState, full]);

  // Camera: interpolate the viewBox towards the target. Reduced motion jumps.
  const [view, setView] = useState<Box>(target);
  const viewRef = useRef(view);
  useEffect(() => {
    const from = viewRef.current;
    const reduce =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || (from.x === target.x && from.y === target.y && from.w === target.w)) {
      viewRef.current = target;
      setView(target);
      return;
    }
    let frameId = 0;
    const started = performance.now();
    setAnimating(true);
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION_MS);
      const e = easeInOutCubic(t);
      const next = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      };
      viewRef.current = next;
      setView(next);
      if (t < 1) frameId = requestAnimationFrame(step);
      else setAnimating(false);
    };
    frameId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frameId);
      setAnimating(false);
    };
  }, [target]);

  const navigate = (orgUnitId: string, next: { stateId: string | null; lgaId: string | null }) => {
    if (orgUnitId === selectedId) return;
    setOptimistic({ from: selectedId, ...next });
    setHover(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set('orgUnit', orgUnitId);
    params.delete('facility');
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  const chooseLga = (area: OverviewMapArea) => {
    // At the programme view a click picks the state first, as DHIS2's tree does.
    if (crossState && focus.stateId !== area.stateId && area.stateId) {
      navigate(area.stateId, { stateId: area.stateId, lgaId: null });
      return;
    }
    navigate(area.id, { stateId: area.stateId, lgaId: area.id });
  };

  // Labels: states at the programme view, LGAs once a state is in view. They
  // are placed in screen space for the camera's destination and shown once it
  // arrives, so they never smear across the animation.
  const k = map.width / target.w;
  const toScreen = (x: number, y: number) => ({ x: (x - target.x) * k, y: (y - target.y) * k });
  const showLgaLabels = !crossState || focus.stateId !== null;
  const labelUnits: MapUnit[] = (showLgaLabels
    ? map.lgas.filter((area) => !crossState || area.stateId === focus.stateId)
    : map.states
  ).map((area) => {
    const point = toScreen(area.cx, area.cy);
    return {
      orgUnitId: area.id,
      name: area.name,
      score: area.score,
      status: area.status,
      changePoints: null,
      dataConfidence: area.dataConfidence,
      openFindings: 0,
      path: showLgaLabels ? area.path : null,
      cx: point.x,
      cy: point.y,
      area: area.area * k * k,
      groupName: null,
    };
  });
  const labels = placeLabels(
    labelUnits.filter((unit) => unit.cx > 0 && unit.cx < map.width && unit.cy > 0 && unit.cy < map.height),
    (unit) => unit.score,
  );

  const focusedState = focus.stateId ? map.states.find((area) => area.id === focus.stateId) ?? null : null;
  const focusedLga = focus.lgaId ? map.lgas.find((area) => area.id === focus.lgaId) ?? null : null;
  const lgasInView = map.lgas
    .filter((area) => !crossState || area.stateId === focus.stateId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const backTo =
    focusedLga && focusedState
      ? { id: focusedState.id, stateId: focusedState.id, label: focusedState.name }
      : focusedState && crossState
        ? { id: rootId, stateId: null, label: 'both states' }
        : null;
  const hint = focusedLga
    ? `Showing ${focusedLga.name}. Choose another LGA, or go back to ${focusedState?.name ?? 'the state'}.`
    : crossState && !focusedState
      ? 'Choose a state to zoom in to its LGAs.'
      : 'Choose an LGA to see its performance.';

  return (
    <section aria-labelledby="overview-map-heading" className="mb-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-[var(--radius-lg)] border bg-[var(--surface)] p-3">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <h2 id="overview-map-heading" className="text-[13px] font-semibold">
                Performance by area
              </h2>
              <nav aria-label="Map location" className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-[var(--text-tertiary)]">
                {crossState ? (
                  <button
                    type="button"
                    onClick={() => navigate(rootId, { stateId: null, lgaId: null })}
                    className={cn('hover:text-[var(--brand-600)] hover:underline', !focusedState && 'font-medium text-[var(--text-secondary)]')}
                  >
                    Both states
                  </button>
                ) : null}
                {focusedState ? (
                  <>
                    {crossState ? <span aria-hidden="true">›</span> : null}
                    <button
                      type="button"
                      onClick={() => navigate(focusedState.id, { stateId: focusedState.id, lgaId: null })}
                      className={cn('hover:text-[var(--brand-600)] hover:underline', !focusedLga && 'font-medium text-[var(--text-secondary)]')}
                    >
                      {focusedState.name}
                    </button>
                  </>
                ) : null}
                {focusedLga ? (
                  <>
                    <span aria-hidden="true">›</span>
                    <span className="font-medium text-[var(--text-secondary)]">{focusedLga.name}</span>
                  </>
                ) : null}
              </nav>
            </div>

            {crossState ? (
              <div role="group" aria-label="Choose a state" className="flex gap-1">
                {map.states.map((state) => (
                  <button
                    key={state.id}
                    type="button"
                    aria-pressed={focus.stateId === state.id}
                    onClick={() => navigate(state.id, { stateId: state.id, lgaId: null })}
                    className={cn(
                      'h-7 rounded-[var(--radius-md)] border px-2.5 text-[12px] font-medium transition-colors',
                      focus.stateId === state.id
                        ? 'border-[var(--brand-600)] bg-[var(--brand-050)] text-[var(--brand-700)]'
                        : 'hover:bg-[var(--surface-sunken)]',
                    )}
                  >
                    {state.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div ref={containerRef} className="relative">
            <svg
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              className="block h-auto w-full rounded-[var(--radius-md)] bg-[var(--surface-sunken)]"
              role="group"
              aria-label={`Map of overall SRHR performance, ${map.periodLabel}. ${hint}`}
              onMouseLeave={() => setHover(null)}
            >
              <defs>
                <pattern id="overview-map-no-data" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform={`rotate(45) scale(${1 / k})`}>
                  <rect width="6" height="6" fill="var(--ink-100)" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-300)" strokeWidth="2" />
                </pattern>
              </defs>

              {/* State outlines: each state's LGAs stroked heavily beneath the fills. */}
              {map.lgas.map((area) =>
                area.path ? (
                  <path
                    key={`outline-${area.id}`}
                    d={area.path}
                    fill="none"
                    stroke="var(--ink-500)"
                    strokeWidth={3}
                    vectorEffect="non-scaling-stroke"
                    aria-hidden="true"
                  />
                ) : null,
              )}

              {map.lgas.map((area) => {
                if (!area.path) return null;
                const inFocus = !crossState || !focus.stateId || area.stateId === focus.stateId;
                const selected = area.id === focus.lgaId;
                const interactive = !crossState || focus.stateId !== null;
                const label = `${area.name}${crossState ? `, ${map.states.find((s) => s.id === area.stateId)?.name ?? ''}` : ''}: ${
                  area.score === null ? 'no score' : `${area.score} out of 100`
                }, ${STATUS_WORD[area.status]}`;
                return (
                  <path
                    key={area.id}
                    d={area.path}
                    fill={FILL[area.status]}
                    stroke={selected ? 'var(--brand-800)' : 'var(--viz-surface)'}
                    strokeWidth={selected ? 2.5 : 0.8}
                    vectorEffect="non-scaling-stroke"
                    opacity={inFocus ? (focus.lgaId && !selected ? 0.55 : 0.95) : 0.28}
                    role={interactive && inFocus ? 'button' : undefined}
                    tabIndex={interactive && inFocus ? 0 : -1}
                    aria-label={interactive && inFocus ? label : undefined}
                    aria-pressed={interactive && inFocus ? selected : undefined}
                    className="cursor-pointer outline-none transition-opacity duration-300 focus-visible:stroke-[var(--brand-600)] motion-reduce:transition-none"
                    onClick={() => chooseLga(area)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        chooseLga(area);
                      }
                    }}
                    onMouseMove={(event) => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (rect) setHover({ area, x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width });
                    }}
                    onFocus={() => setHover(null)}
                  >
                    <title>{label}</title>
                  </path>
                );
              })}

              {/* Selected LGA drawn last so its outline is never covered by a neighbour. */}
              {focusedLga?.path ? (
                <path
                  d={focusedLga.path}
                  fill="none"
                  stroke="var(--brand-800)"
                  strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  aria-hidden="true"
                />
              ) : null}
            </svg>

            {/* Labels sit in screen space above the map and never take the pointer. */}
            <svg
              viewBox={`0 0 ${map.width} ${map.height}`}
              className={cn(
                // At phone width the labels would shrink below legibility;
                // names are in the tooltip, the panel and the LGA list instead.
                'pointer-events-none absolute inset-0 hidden h-full w-full transition-opacity duration-200 motion-reduce:transition-none sm:block',
                animating ? 'opacity-0' : 'opacity-100',
              )}
              aria-hidden="true"
            >
              {labels.map((placement) => {
                const { unit } = placement;
                const text = unit.score === null ? '—' : String(unit.score);
                if (placement.kind === 'INSIDE') {
                  return (
                    <g key={unit.orgUnitId}>
                      <text x={unit.cx} y={unit.cy} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff" stroke="rgb(20 24 20 / 0.6)" strokeWidth={2.6} paintOrder="stroke" strokeLinejoin="round">
                        {unit.name}
                      </text>
                      <text x={unit.cx} y={unit.cy + 13} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" stroke="rgb(20 24 20 / 0.6)" strokeWidth={2.6} paintOrder="stroke" strokeLinejoin="round" className="numeric">
                        {text}
                      </text>
                    </g>
                  );
                }
                const { dx, dy, anchor } = placement;
                return (
                  <g key={unit.orgUnitId}>
                    <line x1={unit.cx} y1={unit.cy} x2={unit.cx + dx} y2={unit.cy + dy} stroke="var(--text-tertiary)" strokeWidth={1} />
                    <text x={unit.cx + dx + (anchor === 'end' ? -3 : 3)} y={unit.cy + dy - 2} textAnchor={anchor} fontSize={10} fontWeight={600} fill="var(--text-primary)" stroke="var(--viz-surface)" strokeWidth={2.4} paintOrder="stroke" strokeLinejoin="round">
                      {unit.name} {text}
                    </text>
                  </g>
                );
              })}
            </svg>

            {hover && !animating ? (
              <div
                className="pointer-events-none absolute z-10 max-w-[220px] rounded-[var(--radius-md)] border bg-[var(--surface-raised)] px-2.5 py-1.5 text-[12px] shadow-[var(--shadow-md)]"
                style={{ left: Math.max(0, Math.min(hover.x + 12, hover.width - 220)), top: hover.y + 12 }}
              >
                <p className="font-semibold">{hover.area.name}</p>
                <p className="numeric text-[var(--text-secondary)]">
                  {hover.area.score === null ? 'No publishable score' : `${hover.area.score} / 100 · ${STATUS_WORD[hover.area.status]}`}
                </p>
                <p className="text-[11px] text-[var(--text-tertiary)]">
                  {hover.area.reporting.withData} of {hover.area.reporting.total} indicators with data
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-1">
            <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
              {(
                [
                  ['ON_TRACK', `On track (${map.bands.onTrack}+)`],
                  ['WATCH', `Watch (${map.bands.watch}–${map.bands.onTrack - 1})`],
                  ['NEEDS_ATTENTION', `Needs attention (below ${map.bands.watch})`],
                  ['NO_DATA', 'No publishable score'],
                ] as Array<[PerformanceStatus, string]>
              ).map(([status, text]) => (
                <li key={status} className="flex items-center gap-1.5">
                  <svg width="12" height="12" aria-hidden="true">
                    {status === 'NO_DATA' ? (
                      <>
                        <rect width="12" height="12" rx="2" fill="var(--ink-100)" stroke="var(--ink-300)" />
                        <line x1="0" y1="12" x2="12" y2="0" stroke="var(--ink-300)" strokeWidth="2" />
                      </>
                    ) : (
                      <rect width="12" height="12" rx="2" fill={FILL[status]} />
                    )}
                  </svg>
                  {text}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-[var(--text-tertiary)]" aria-live="polite">
              {pending ? 'Updating…' : hint}
            </p>
          </div>
          <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            Coloured by overall SRHR score for {map.periodLabel}, from the same scorecards as the figures below.
            Hatched areas have too little reporting for a score; that is missing data, not low performance.
            {map.missing.length > 0 ? ` No boundary is available for ${map.missing.join(', ')}.` : ''} Boundaries:
            geoBoundaries (GRID3), CC BY 4.0.
          </p>
        </div>

        <aside
          aria-labelledby="overview-map-selection"
          aria-busy={pending}
          className={cn('rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4 transition-opacity', pending && 'opacity-60')}
        >
          <p className="text-[11px] text-[var(--text-tertiary)]">Selected area</p>
          {summary ? (
            <div className="space-y-3.5">
              <div>
                <h3 id="overview-map-selection" className="text-[15px] font-semibold tracking-[-0.011em]">
                  {summary.name}
                </h3>
                <p className="text-[12px] text-[var(--text-tertiary)]">
                  {summary.level}
                  {summary.parentName ? ` · ${summary.parentName}` : ''} · {summary.periodLabel}
                </p>
              </div>
              <div className="flex items-end justify-between gap-3">
                <p className="numeric text-[28px] font-semibold leading-none">
                  {summary.score ?? '—'}
                  {summary.score !== null ? <span className="ml-1 text-[13px] font-normal text-[var(--text-tertiary)]">/ 100</span> : null}
                </p>
                <StatusPill status={summary.status} />
              </div>
              {summary.score === null ? (
                <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  No overall score: only {Math.round(summary.coverage * 100)}% of weighted indicators have data for this period.
                </p>
              ) : null}
              <dl className="space-y-1.5 border-t pt-3 text-[12px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">Indicators with data</dt>
                  <dd className="numeric font-medium">
                    {summary.indicatorsWithData} of {summary.indicatorsTotal}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">Data confidence</dt>
                  <dd className="numeric font-medium">{summary.dataConfidence}%</dd>
                </div>
              </dl>
              {summary.domains.length > 0 ? (
                <ul className="space-y-1.5 border-t pt-3" aria-label="Domain scores">
                  {summary.domains.map((domain) => (
                    <li key={domain.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="truncate text-[var(--text-secondary)]">{domain.name}</span>
                      <span className="numeric shrink-0 font-medium">
                        {domain.score ?? '—'}
                        <span className="sr-only">, {STATUS_WORD[domain.status]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p id="overview-map-selection" className="mt-1 text-[12px] text-[var(--text-secondary)]">
              No reporting is stored for this area and period.
            </p>
          )}

          {lgasInView.length > 0 && (focusedState || !crossState) ? (
            <div className="mt-4 border-t pt-3">
              <label htmlFor="overview-map-lga" className="text-[11px] font-medium text-[var(--text-tertiary)]">
                Go to an LGA
              </label>
              <select
                id="overview-map-lga"
                value={focusedLga?.id ?? ''}
                onChange={(event) => {
                  const area = map.lgas.find((entry) => entry.id === event.target.value);
                  if (area) navigate(area.id, { stateId: area.stateId, lgaId: area.id });
                }}
                className="mt-1 h-8 w-full rounded-[var(--radius-md)] border bg-[var(--surface)] px-2 text-[13px]"
              >
                <option value="" disabled>
                  Choose an LGA
                </option>
                {lgasInView.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {backTo ? (
            <button
              type="button"
              onClick={() => navigate(backTo.id, { stateId: backTo.stateId, lgaId: null })}
              className="mt-3 text-[12px] text-[var(--brand-600)] hover:underline"
            >
              ← Back to {backTo.label}
            </button>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
