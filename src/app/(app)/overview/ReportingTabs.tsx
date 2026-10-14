'use client';

import { Fragment, useState } from 'react';
import type { Scorecard } from '@/core/scoring/types';
import type { DataElementReport } from '@/services/dataElements';
import type { ReportingStatus } from '@/services/overview';
import { ScorecardTable } from '@/design/patterns/ScorecardTable';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { Badge } from '@/design/primitives/Badge';
import { cn } from '@/design/primitives/cn';

const ROLE: Record<string, string> = { NUMERATOR: 'numerator', DENOMINATOR: 'denominator', VALUE: 'value', BREAKDOWN: 'split' };

/**
 * Indicator and data element reporting, side by side as tabs.
 *
 * Indicators are performance measures, scored against targets. Data elements
 * are the NHMIS counts they are computed from: reported here as values with
 * their availability and the indicators they feed — never with an invented
 * target or achievement, and never as performance in their own right.
 */
export function ReportingTabs({
  scorecard,
  elements,
  reporting,
  canOpenIndicator,
}: {
  scorecard: Scorecard;
  elements: DataElementReport;
  reporting: ReportingStatus;
  canOpenIndicator: boolean;
}) {
  const [tab, setTab] = useState<'indicators' | 'elements'>('indicators');
  const tabs = [
    { id: 'indicators' as const, label: 'Indicators', count: scorecard.domains.reduce((sum, d) => sum + d.indicators.length, 0) },
    { id: 'elements' as const, label: 'Data elements', count: elements.total },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Reporting" className="mb-3 flex gap-1 border-b">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            id={`reporting-tab-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`reporting-panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => setTab(entry.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const next = entry.id === 'indicators' ? 'elements' : 'indicators';
                setTab(next);
                document.getElementById(`reporting-tab-${next}`)?.focus();
              }
            }}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === entry.id
                ? 'border-[var(--brand-600)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            {entry.label}
            <span className="numeric ml-1.5 text-[11px] font-normal text-[var(--text-tertiary)]">{entry.count}</span>
          </button>
        ))}
      </div>

      <div id="reporting-panel-indicators" role="tabpanel" aria-labelledby="reporting-tab-indicators" hidden={tab !== 'indicators'}>
        <p className="mb-2 text-[12px] text-[var(--text-tertiary)]">
          Calculated indicators, scored against their targets for {scorecard.orgUnitName}, {scorecard.periodLabel}.
          Open a domain to see its indicators.
        </p>
        <ScorecardTable scorecard={scorecard} canOpenIndicator={canOpenIndicator} />
      </div>

      <div id="reporting-panel-elements" role="tabpanel" aria-labelledby="reporting-tab-elements" hidden={tab !== 'elements'}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12px] text-[var(--text-tertiary)]">
            Source NHMIS data elements behind the indicators, for {elements.orgUnitName}, {elements.periodLabel}. Values
            are counts from the form, not performance scores, and have no targets of their own.
          </p>
          <p className="text-[12px] text-[var(--text-secondary)]">
            {elements.available ? (
              <>
                <span className="numeric font-medium">{elements.reported}</span> of {elements.total} with a value
              </>
            ) : null}
            {reporting.completeness !== null ? (
              <span className="ml-3">
                Form completeness <span className="numeric font-medium">{reporting.completeness}%</span>
              </span>
            ) : (
              <span className="ml-3 text-[var(--text-tertiary)]">Form completeness not available from the source</span>
            )}
          </p>
        </div>
        {elements.synthetic ? (
          <p className="mb-2 text-[11px] text-[var(--warning-700)]">
            Demo data: these are the synthetic counts each demo indicator is generated from, not NHMIS data elements.
          </p>
        ) : null}
        {!elements.available ? (
          <p className="rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
            {elements.reason}
          </p>
        ) : elements.total === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
            No verified NHMIS data elements are in the reporting scope yet. They are recorded at the next synchronisation.
          </p>
        ) : (
          <TableWrap>
            <caption className="sr-only">
              Data element values for {elements.orgUnitName}, {elements.periodLabel}, grouped by domain
            </caption>
            <thead>
              <tr>
                <Th width="40%">Data element</Th>
                <Th align="right">Value</Th>
                <Th>Availability</Th>
                <Th>Feeds</Th>
              </tr>
            </thead>
            <tbody>
              {elements.groups.map((group) => (
                <Fragment key={group.domainId ?? 'none'}>
                  <Tr className="bg-[var(--surface-sunken)]">
                    <Td colSpan={4} className="text-[12px] font-semibold">
                      {group.domainName}
                      <span className="ml-1.5 font-normal text-[var(--text-tertiary)]">{group.items.length}</span>
                    </Td>
                  </Tr>
                  {group.items.map((row) => (
                    <Tr key={row.id}>
                      <Td className="text-[12px]">
                        {row.name}
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <Badge tone="info">Data element</Badge>
                          <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{row.id}</span>
                        </span>
                      </Td>
                      <Td align="right" numeric className="text-[12px] font-medium">
                        {row.value === null ? '—' : row.value.toLocaleString('en-GB')}
                      </Td>
                      <Td className="text-[11px]">
                        {row.status === 'REPORTED' ? (
                          <span className="text-[var(--positive-700)]">Reported</span>
                        ) : row.status === 'NOT_ADDITIVE' ? (
                          <span className="text-[var(--text-tertiary)]" title="DHIS2 does not sum this element across states.">
                            Not combined at federal level
                          </span>
                        ) : (
                          <span className="text-[var(--warning-700)]">No value reported</span>
                        )}
                      </Td>
                      <Td className="text-[11px] text-[var(--text-secondary)]">
                        {row.usedBy.length === 0
                          ? 'Added by an administrator'
                          : row.usedBy.map((use) => `${use.name} (${ROLE[use.role] ?? use.role})`).join('; ')}
                      </Td>
                    </Tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </div>
  );
}
