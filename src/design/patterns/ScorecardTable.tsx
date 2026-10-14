'use client';

import { Fragment, useState } from 'react';
import type { Scorecard } from '@/core/scoring/types';
import { TableWrap, Td, Th, Tr } from '../primitives/Table';
import { StatusPill } from '../primitives/StatusPill';
import { TrendIndicator } from '../primitives/Trend';
import { ScoreBar } from '../charts/ScoreBar';
import { IndicatorDrawer, type IndicatorDrawerTarget } from './IndicatorDrawer';
import { cn } from '../primitives/cn';

const UNIT_SUFFIX: Record<string, string> = {
  PERCENT: '%',
  RATE_PER_1000: '',
  RATE_PER_100000: '',
  COUNT: '',
  RATIO: '',
};

/**
 * The scorecard.
 *
 * Domains first, indicators on request. A senior reader gets six rows and a
 * verdict; an analyst expands the domain they care about and gets the fifteen
 * indicators underneath it. That is the progressive disclosure the product
 * depends on — the same screen serves both without becoming two products.
 */
export function ScorecardTable({
  scorecard,
  defaultExpanded,
  canOpenIndicator = true,
}: {
  scorecard: Scorecard;
  /** Domain ids to open on first render, e.g. one linked to from an insight. */
  defaultExpanded?: string[];
  /**
   * Whether indicator rows open their detail panel. Executives read the
   * scorecard; the history, contributor breakdown and outlook behind an
   * indicator are investigative tools, so the row stays plain text for them
   * rather than looking interactive and refusing.
   */
  canOpenIndicator?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(defaultExpanded ?? []));
  const [target, setTarget] = useState<IndicatorDrawerTarget | null>(null);

  const toggle = (domainId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(domainId)) next.delete(domainId);
      else next.add(domainId);
      return next;
    });
  };

  return (
    <>
      <TableWrap>
        <caption className="sr-only">
          SRHR scorecard for {scorecard.orgUnitName}, {scorecard.periodLabel}, scored with{' '}
          {scorecard.methodologyVersion}
        </caption>
        <thead>
          <tr>
            <Th width="42%">Domain</Th>
            <Th align="right" width="9%">
              Score
            </Th>
            <Th width="20%">Against threshold</Th>
            <Th width="16%">Status</Th>
            <Th align="right" width="13%">
              Trend
            </Th>
          </tr>
        </thead>
        <tbody>
          {scorecard.domains.map((domain) => {
            const open = expanded.has(domain.domainId);
            return (
              <Fragment key={domain.domainId}>
                <Tr className="bg-[var(--surface)]">
                  <Td>
                    <button
                      type="button"
                      onClick={() => toggle(domain.domainId)}
                      aria-expanded={open}
                      className="flex items-center gap-1.5 text-left font-medium text-[var(--text-primary)]"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'inline-block text-[10px] text-[var(--text-tertiary)] transition-transform duration-150',
                          open && 'rotate-90',
                        )}
                      >
                        ▶
                      </span>
                      {domain.name}
                      <span className="ml-1 text-[11px] font-normal text-[var(--text-tertiary)]">
                        {domain.indicators.length} indicators
                      </span>
                    </button>
                  </Td>
                  <Td align="right" numeric className="font-semibold">
                    {domain.score ?? '—'}
                  </Td>
                  <Td>
                    <ScoreBar score={domain.score} target={domain.target} status={domain.status} />
                  </Td>
                  <Td>
                    <StatusPill status={domain.status} />
                  </Td>
                  <Td align="right">
                    <TrendIndicator trend={domain.trend} />
                  </Td>
                </Tr>

                {open
                  ? domain.indicators.map((indicator) => {
                      const suffix = UNIT_SUFFIX[indicator.unit] ?? '';
                      return (
                        <Tr key={indicator.indicatorId} className="bg-[var(--surface-sunken)]">
                          <Td className="pl-9">
                            {canOpenIndicator ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setTarget({
                                    indicatorId: indicator.indicatorId,
                                    orgUnitId: scorecard.orgUnitId,
                                    periodId: scorecard.periodId,
                                  })
                                }
                                className="text-left text-[12px] text-[var(--text-secondary)] hover:text-[var(--brand-600)] hover:underline"
                              >
                                {indicator.name}
                              </button>
                            ) : (
                              <span className="text-[12px] text-[var(--text-secondary)]">
                                {indicator.name}
                              </span>
                            )}
                            {indicator.carriedForward ? (
                              <span
                                className="ml-1.5 text-[10px] text-[var(--warning-700)]"
                                title="No value was reported for this period; the previous period's value was carried forward under the methodology's missing-data rule."
                              >
                                carried forward
                              </span>
                            ) : null}
                            {/* The measured value belongs with the indicator that was
                                measured, not in a column a domain row cannot fill. */}
                            <span className="numeric mt-0.5 block text-[11px] text-[var(--text-tertiary)]">
                              {!indicator.mapped
                                ? 'Not reported by the data source'
                                : indicator.value === null
                                  ? 'No value reported this period'
                                  : `${indicator.value}${suffix}`}
                              {indicator.target === null
                                ? ' · no target set for this area and period'
                                : `${indicator.targetProvisional ? ' against a provisional target of ' : ' against a target of '}${indicator.target}${suffix}`}
                            </span>
                          </Td>
                          <Td align="right" numeric className="text-[12px]">
                            {indicator.score ?? '—'}
                          </Td>
                          <Td>
                            <ScoreBar
                              score={indicator.score}
                              target={75}
                              status={indicator.status}
                              height={4}
                            />
                          </Td>
                          <Td>
                            <StatusPill status={indicator.status} compact />
                          </Td>
                          <Td align="right">
                            <TrendIndicator trend={indicator.trend} />
                          </Td>
                        </Tr>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </TableWrap>

      <IndicatorDrawer target={target} onClose={() => setTarget(null)} />
    </>
  );
}
