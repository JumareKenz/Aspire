'use client';

import { Fragment, useState } from 'react';
import type { DomainScore } from '@/core/scoring/types';
import type { ScoreExplanation } from '@/core/scoring/explain';
import type { ContributingElement } from '@/services/dataElements';
import { TARGET_SCOPE_LABEL } from '@/core/targets/resolve';
import { Drawer } from '@/design/primitives/Drawer';
import { Badge } from '@/design/primitives/Badge';
import { StatusPill } from '@/design/primitives/StatusPill';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';

const UNIT_SUFFIX: Record<string, string> = { PERCENT: '%', RATE_PER_1000: ' per 1,000', RATE_PER_100000: ' per 100,000', COUNT: '', RATIO: '' };
const ROLE_LABEL: Record<ContributingElement['role'], string> = {
  NUMERATOR: 'numerator',
  DENOMINATOR: 'denominator',
  VALUE: 'value',
  BREAKDOWN: 'breakdown',
};

function format(value: number | null, unit = ''): string {
  if (value === null) return '—';
  return `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })}${UNIT_SUFFIX[unit] ?? ''}`;
}

function availability(indicator: DomainScore['indicators'][number]): { text: string; tone: 'neutral' | 'warning' | 'positive' } {
  if (!indicator.mapped) return { text: 'Not reported by the source', tone: 'warning' };
  if (indicator.value === null) return { text: 'No value this period', tone: 'warning' };
  if (indicator.score === null && indicator.target === null) return { text: 'No target set', tone: 'warning' };
  if (indicator.carriedForward) return { text: 'Carried forward', tone: 'warning' };
  return { text: 'Reported', tone: 'positive' };
}

/**
 * How a card's figure is made up.
 *
 * Lists exactly the records the scoring engine used for the card — the
 * indicators of the domain (or of every domain, for the overall card), each
 * with its value, target, achievement and score — and the arithmetic that
 * turns them into the card's number, so the two can be reconciled by hand.
 *
 * Beneath each indicator are the NHMIS data elements it is computed from.
 * They are evidence for the indicator's value and are labelled as such: they
 * are not scored and are not added into any total, so nothing is counted twice.
 */
export function BreakdownButton({
  label,
  title,
  explanation,
  domains,
  elements,
  orgUnitName,
  periodLabel,
  overall = false,
}: {
  /** What the card shows, for the button's accessible name. */
  label: string;
  title: string;
  explanation: ScoreExplanation;
  domains: DomainScore[];
  elements: Record<string, ContributingElement[]>;
  orgUnitName: string;
  periodLabel: string;
  overall?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const scored = explanation.terms.filter((term) => term.score !== null).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`How ${label} is calculated`}
        title="How this is calculated"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-tertiary)] transition-colors hover:bg-[var(--ink-100)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-400)]"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.2v3.6" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.4" fill="currentColor" />
        </svg>
      </button>

      <Drawer open={open} onClose={() => setOpen(false)} title={title} description={`${orgUnitName} · ${periodLabel}`} width="lg">
        <div className="space-y-6">
          <section aria-labelledby="breakdown-arithmetic">
            <h3 id="breakdown-arithmetic" className="text-[12px] font-semibold">
              How the figure is calculated
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              {explanation.score === null
                ? `No score is published: too few ${overall ? 'domains' : 'indicators'} have one for this period, below the minimum the methodology requires.`
                : `${explanation.score} is the weighted mean of the ${scored} ${overall ? 'domain' : 'indicator'} score${scored === 1 ? '' : 's'} available${
                    explanation.excluded > 0
                      ? `; ${explanation.excluded} without a score ${explanation.excluded === 1 ? 'is' : 'are'} excluded and the weights of the rest renormalised`
                      : ''
                  }. Each row's contribution is its score times its share of the weight used.`}
            </p>
            <TableWrap className="mt-2.5">
              <thead>
                <tr>
                  <Th>{overall ? 'Domain' : 'Indicator'}</Th>
                  <Th align="right">Score</Th>
                  <Th align="right">Weight used</Th>
                  <Th align="right">Contribution</Th>
                </tr>
              </thead>
              <tbody>
                {explanation.terms.map((term) => (
                  <Tr key={term.id}>
                    <Td className="text-[12px]">{term.name}</Td>
                    <Td align="right" numeric className="text-[12px]">
                      {term.score ?? '—'}
                    </Td>
                    <Td align="right" numeric className="text-[12px] text-[var(--text-secondary)]">
                      {term.score === null ? 'excluded' : `${Math.round(term.share * 1000) / 10}%`}
                    </Td>
                    <Td align="right" numeric className="text-[12px]">
                      {term.contribution === null ? '—' : term.contribution.toFixed(1)}
                    </Td>
                  </Tr>
                ))}
                {explanation.total !== null ? (
                  <Tr>
                    <Td className="text-[12px] font-semibold">Total</Td>
                    <Td />
                    <Td align="right" numeric className="text-[12px] text-[var(--text-secondary)]">
                      100%
                    </Td>
                    <Td align="right" numeric className="text-[12px] font-semibold">
                      {explanation.total.toFixed(1)}
                    </Td>
                  </Tr>
                ) : null}
              </tbody>
            </TableWrap>
          </section>

          <section aria-labelledby="breakdown-records">
            <h3 id="breakdown-records" className="text-[12px] font-semibold">
              Records behind it
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              Indicators are scored against their targets. The NHMIS data elements beneath each one are the source
              values it is computed from: shown for verification, not scored, and not added to any total.
            </p>
            <div className="mt-2.5 space-y-4">
              {domains.map((domain) => (
                <div key={domain.domainId}>
                  {overall ? (
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 border-b pb-1">
                      <h4 className="text-[12px] font-semibold">{domain.name}</h4>
                      <span className="numeric text-[12px] text-[var(--text-secondary)]">
                        {domain.score === null ? 'no score' : `${domain.score} / 100`}
                      </span>
                    </div>
                  ) : null}
                  <TableWrap>
                    <thead>
                      <tr>
                        <Th width="38%">Name</Th>
                        <Th align="right">Value</Th>
                        <Th align="right">Target</Th>
                        <Th align="right">Achievement</Th>
                        <Th align="right">Score</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {domain.indicators.map((indicator) => {
                        const state = availability(indicator);
                        const sources = elements[indicator.indicatorId] ?? [];
                        return (
                          <Fragment key={indicator.indicatorId}>
                            <Tr>
                              <Td className="text-[12px]">
                                <span className="font-medium">{indicator.name}</span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                  <Badge tone="neutral">Indicator</Badge>
                                  <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{indicator.indicatorId}</span>
                                </span>
                              </Td>
                              <Td align="right" numeric className="text-[12px]">
                                {format(indicator.value, indicator.unit)}
                              </Td>
                              <Td align="right" numeric className="text-[12px]">
                                {indicator.target === null ? (
                                  <span className="text-[var(--text-tertiary)]">not set</span>
                                ) : (
                                  <span title={indicator.targetScope ? TARGET_SCOPE_LABEL[indicator.targetScope] : undefined}>
                                    {format(indicator.target, indicator.unit)}
                                    {indicator.targetProvisional ? <span className="text-[var(--text-tertiary)]">*</span> : null}
                                  </span>
                                )}
                              </Td>
                              <Td align="right" numeric className="text-[12px]">
                                {indicator.achievementPct === null ? '—' : `${indicator.achievementPct}%`}
                              </Td>
                              <Td align="right" numeric className="text-[12px] font-medium">
                                {indicator.score ?? '—'}
                              </Td>
                              <Td>
                                <div className="flex flex-col items-start gap-1">
                                  <StatusPill status={indicator.status} compact />
                                  <span className="text-[10px] text-[var(--text-tertiary)]">{state.text}</span>
                                </div>
                              </Td>
                            </Tr>
                            {sources.map((source) => (
                              <Tr key={`${indicator.indicatorId}:${source.ref}:${source.role}`} className="bg-[var(--surface-sunken)]">
                                <Td className="pl-6 text-[11px] text-[var(--text-secondary)]">
                                  <span>{source.name}</span>
                                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                    <Badge tone="info">Data element · {ROLE_LABEL[source.role]}</Badge>
                                    <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{source.ref}</span>
                                  </span>
                                </Td>
                                <Td align="right" numeric className="text-[11px]">
                                  {source.value === null ? (
                                    <span className="text-[var(--text-tertiary)]">no value</span>
                                  ) : (
                                    source.value.toLocaleString('en-GB')
                                  )}
                                </Td>
                                <Td colSpan={4} className="text-[10px] text-[var(--text-tertiary)]">
                                  Source count, not scored
                                </Td>
                              </Tr>
                            ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </TableWrap>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              * Provisional target, pending the programme&apos;s confirmation. Data element values are held for the
              federal tier (additive elements only), states and LGAs; below LGA level they show as no value.
            </p>
          </section>
        </div>
      </Drawer>
    </>
  );
}
