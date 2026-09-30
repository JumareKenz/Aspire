'use client';

import { useRef, useState } from 'react';
import type { BatchResult, Coverage, FacilityScorecard } from '@/services/validationScorecard';
import { Badge } from '@/design/primitives/Badge';
import { Button } from '@/design/primitives/Button';
import { Card } from '@/design/primitives/Card';
import { Select } from '@/design/primitives/Field';
import { EmptyState, ErrorState } from '@/design/primitives/States';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { cn } from '@/design/primitives/cn';
import { callApi } from '../explorer/api';
import { periodLabel } from '../explorer/periods';
import { ScrollArea } from '../ui';

const int = (value: number) => value.toLocaleString('en-GB');
const pct = (value: number | null) => (value === null ? '–' : `${value.toFixed(1)}%`);

const OPERATOR: Record<string, string> = {
  equal_to: 'equal to',
  not_equal_to: 'not equal to',
  greater_than: 'greater than',
  greater_than_or_equal_to: 'at least',
  less_than: 'less than',
  less_than_or_equal_to: 'at most',
  compulsory_pair: 'reported together with',
  exclusive_pair: 'not reported with',
};

/** Pass rates are graded the same way everywhere on the panel. */
function tone(rate: number | null): 'positive' | 'warning' | 'concern' | 'neutral' {
  if (rate === null) return 'neutral';
  return rate >= 80 ? 'positive' : rate >= 50 ? 'warning' : 'concern';
}
const FILL = {
  positive: 'bg-[var(--status-fill-positive)]',
  warning: 'bg-[var(--status-fill-warning)]',
  concern: 'bg-[var(--status-fill-concern)]',
  neutral: 'bg-[var(--status-fill-none)]',
};

function RateBar({ rate }: { rate: number | null }) {
  return (
    <span className="block h-2 w-full min-w-[60px] overflow-hidden rounded-full bg-[var(--ink-100)]" aria-hidden="true">
      <span className={cn('block h-full rounded-full', FILL[tone(rate)])} style={{ width: `${rate ?? 0}%` }} />
    </span>
  );
}

export interface ScorecardArea {
  id: string;
  name: string;
  /** The state an LGA belongs to; empty for the states and the root. */
  group: string;
}

export function ScorecardPanel({
  initial,
  areas,
  connected,
  canRun,
}: {
  initial: FacilityScorecard | null;
  areas: ScorecardArea[];
  connected: boolean;
  canRun: boolean;
}) {
  const [card, setCard] = useState(initial);
  const [coverage, setCoverage] = useState<Coverage | null>(initial?.coverage ?? null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  async function open(id: string) {
    setLoading(true);
    setError(null);
    try {
      const next = await callApi<FacilityScorecard | null>(`/api/admin/validation/scorecard?ou=${encodeURIComponent(id)}`);
      if (next) {
        setCard(next);
        setCoverage(next.coverage);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The scorecard did not load.');
    } finally {
      setLoading(false);
    }
  }

  /** Works through what is outstanding in short requests, so progress shows and it can be stopped. */
  async function run() {
    setRunning(true);
    setError(null);
    stop.current = false;
    try {
      let idle = 0;
      while (!stop.current) {
        const batch = await callApi<BatchResult>('/api/admin/validation/scorecard', { method: 'POST' });
        setCoverage(batch);
        if (batch.remaining === 0) break;
        idle = batch.done === 0 ? idle + 1 : 0;
        if (idle >= 2) throw new Error('DHIS2 is not answering. What has been checked is kept; try again later.');
      }
      if (card) await open(card.scope.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The check did not run.');
    } finally {
      setRunning(false);
    }
  }

  if (!card || !coverage) {
    return (
      <Card className="p-4">
        <EmptyState
          title="Nothing to validate yet."
          description={connected ? 'No indicator names a DHIS2 form whose rules could be run.' : 'DHIS2 validation needs a connected instance.'}
        />
      </Card>
    );
  }

  const { summary } = card;
  const progress = coverage.total === 0 ? 0 : (coverage.checked / coverage.total) * 100;
  const first = coverage.months[0];
  const last = coverage.months[coverage.months.length - 1];
  const states = areas.filter((area) => area.group === '');
  const groups = [...new Set(areas.filter((area) => area.group !== '').map((area) => area.group))];
  const known = areas.some((area) => area.id === card.scope.id);

  return (
    <div className="flex flex-col gap-5">
      {coverage.remaining > 0 || running ? (
        <Card className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                {int(coverage.checked)} of {int(coverage.total)} facility-months checked
              </h3>
              <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                {int(coverage.facilities)} facilities × {coverage.months.length} months. The scorecard below covers what has been
                checked so far; the rest is picked up automatically each night.
              </p>
            </div>
            {canRun && connected ? (
              running ? (
                <Button onClick={() => { stop.current = true; }}>Stop after this batch</Button>
              ) : (
                <Button variant="primary" onClick={run}>Continue checking now</Button>
              )
            ) : null}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--ink-100)]" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Facility-months checked">
            <div className="h-full rounded-full bg-[var(--brand-500)] transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
        </Card>
      ) : null}
      {error ? <ErrorState title="Something went wrong." description={error} /> : null}

      <Card className={cn('flex flex-col gap-7 p-5 sm:p-7', loading && 'opacity-60')}>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <p className="text-[34px] font-semibold leading-none tracking-[-0.02em]">{pct(summary.passRate)}</p>
              <p className="text-[14px] text-[var(--text-secondary)]">of monthly reports passed every validation rule</p>
              <Badge tone={tone(summary.passRate)}>{card.scope.name.replace(/ Local Government Area$/, '')}</Badge>
            </div>
            <p className="max-w-2xl text-[12px] leading-relaxed text-[var(--text-tertiary)]">
              {periodLabel(first)} to {periodLabel(last)}. A report passes when none of DHIS2&apos;s validation rules for the form is
              broken. Months a facility did not report are counted separately, not as passes.
            </p>
          </div>
          <Select label="Area" value={known ? card.scope.id : ''} onChange={(event) => open(event.target.value)} disabled={loading} className="w-full sm:w-[280px]">
            {!known ? <option value="">{card.scope.name}</option> : null}
            {states.map((area) => (
              <option key={area.id} value={area.id}>{area.name}</option>
            ))}
            {groups.map((group) => (
              <optgroup key={group} label={`${group} LGAs`}>
                {areas.filter((area) => area.group === group).map((area) => (
                  <option key={area.id} value={area.id}>{area.name}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-6 lg:grid-cols-4">
          <Figure label="Reports checked" value={int(summary.reported)} detail="facility-months with a report" />
          <Figure label="Passed every rule" value={int(summary.clean)} detail={pct(summary.passRate)} />
          <Figure label="Broke at least one rule" value={int(summary.withViolations)} detail={`${int(summary.violations)} rule violations in all`} />
          <Figure label="No report" value={int(summary.noReport)} detail="nothing to validate" />
        </dl>

        {summary.checked === 0 ? (
          <EmptyState title="Nothing checked here yet." description="This area's facilities have not been reached yet." />
        ) : (
          <div className="border-t pt-6">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">Pass rate by month</h3>
            <ol className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-6 xl:grid-cols-12">
              {card.byMonth.map((month) => (
                <li key={month.month} className="flex flex-col gap-1.5" title={`${int(month.clean)} of ${int(month.reported)} reports passed`}>
                  <span className="numeric text-[14px] font-semibold">{pct(month.passRate)}</span>
                  <RateBar rate={month.passRate} />
                  <span className="text-[11px] text-[var(--text-tertiary)]">{periodLabel(month.month).replace(/^(\w{3})\w* /, '$1 ')}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Card>

      {summary.checked > 0 ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="flex flex-col gap-4 p-5 sm:p-6">
            <Heading
              title={card.byArea[0]?.kind === 'FACILITY' ? 'By facility' : 'By LGA'}
              description={card.byArea[0]?.kind === 'FACILITY' ? 'Lowest pass rate first.' : 'Lowest pass rate first. Select an LGA to see its facilities.'}
            />
            <ScrollArea maxHeight={460} className="[&_table]:min-w-[420px]!">
              <TableWrap>
                <thead>
                  <tr>
                    <Th>{card.byArea[0]?.kind === 'FACILITY' ? 'Facility' : 'LGA'}</Th>
                    <Th align="right">Reports</Th>
                    <Th align="right">Violations</Th>
                    <Th align="right">Passed</Th>
                    <Th><span className="sr-only">Pass rate</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {card.byArea.map((area) => (
                    <Tr key={area.id}>
                      <Td className="text-[13px]">
                        {area.kind === 'LGA' ? (
                          <button type="button" onClick={() => open(area.id)} className="text-left font-medium text-[var(--brand-600)] hover:underline">
                            {area.name}
                          </button>
                        ) : (
                          area.name
                        )}
                        {area.kind === 'LGA' ? <span className="block text-[11px] text-[var(--text-tertiary)]">{int(area.facilities)} facilities</span> : null}
                      </Td>
                      <Td align="right" numeric className="text-[13px] text-[var(--text-secondary)]">{area.reported === 0 ? 'none' : int(area.reported)}</Td>
                      <Td align="right" numeric className="text-[13px] text-[var(--text-secondary)]">{int(area.violations)}</Td>
                      <Td align="right" numeric className="text-[13px] font-semibold">{pct(area.passRate)}</Td>
                      <Td className="w-[84px] pl-0"><RateBar rate={area.passRate} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </ScrollArea>
          </Card>

          <Card className="flex flex-col gap-4 p-5 sm:p-6">
            <Heading title="Rules broken most often" description="What each rule expects, and how many reports and facilities broke it." />
            {card.byRule.length === 0 ? (
              <EmptyState title="No rule was broken." description="Every report checked here passed." />
            ) : (
              <ScrollArea maxHeight={460} className="[&_table]:min-w-[420px]!">
                <TableWrap>
                  <thead>
                    <tr>
                      <Th>Rule</Th>
                      <Th align="right">Violations</Th>
                      <Th align="right">Facilities</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.byRule.map((rule) => (
                      <Tr key={rule.rule}>
                        <Td className="text-[13px]">
                          <span className="flex flex-wrap items-center gap-2">
                            {rule.rule}
                            {rule.importance === 'HIGH' ? <Badge tone="concern">high</Badge> : null}
                          </span>
                          {rule.left && rule.right ? (
                            <span className="mt-0.5 block text-[11px] text-[var(--text-tertiary)]">
                              {rule.left} should be {OPERATOR[rule.operator ?? ''] ?? rule.operator ?? 'consistent with'} {rule.right}
                            </span>
                          ) : null}
                        </Td>
                        <Td align="right" numeric className="text-[13px] font-semibold">{int(rule.violations)}</Td>
                        <Td align="right" numeric className="text-[13px] text-[var(--text-secondary)]">{int(rule.facilities)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableWrap>
              </ScrollArea>
            )}
          </Card>

          {card.worst.length > 0 ? (
            <Card className="flex flex-col gap-4 p-5 sm:p-6 xl:col-span-2">
              <Heading title="Facilities to follow up" description="The facilities whose reports broke the most rules over the period." />
              <ScrollArea maxHeight={420}>
                <TableWrap>
                  <thead>
                    <tr>
                      <Th>Facility</Th>
                      <Th>LGA</Th>
                      <Th align="right">Violations</Th>
                      <Th align="right">Months with a violation</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.worst.map((facility) => (
                      <Tr key={facility.id}>
                        <Td className="text-[13px]">{facility.name}</Td>
                        <Td className="text-[13px] text-[var(--text-secondary)]">{facility.lga}</Td>
                        <Td align="right" numeric className="text-[13px] font-semibold">{int(facility.violations)}</Td>
                        <Td align="right" numeric className="text-[13px] text-[var(--text-secondary)]">
                          {facility.monthsFailed} of {facility.monthsReported}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableWrap>
              </ScrollArea>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">{label}</dt>
      <dd className="numeric text-[22px] font-semibold leading-tight tracking-[-0.01em]">{value}</dd>
      <dd className="text-[12px] text-[var(--text-tertiary)]">{detail}</dd>
    </div>
  );
}

function Heading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">{description}</p>
    </div>
  );
}
