import type { Scorecard } from '@/core/scoring/types';
import { explainDomain } from '@/core/scoring/explain';
import type { ContributingElement } from '@/services/dataElements';
import { StatusPill } from '@/design/primitives/StatusPill';
import { TrendIndicator } from '@/design/primitives/Trend';
import { ScoreBar } from '@/design/charts/ScoreBar';
import { BreakdownButton } from './PerformanceBreakdown';

/**
 * One card per programme domain, in the methodology's own domain order.
 *
 * Each card is the domain score from the same scorecard as the overall
 * figure — not a separate calculation — shown against the on-track
 * threshold, with how many of its indicators reported. The domains come from
 * the configured registry, so a domain with no reportable indicator has no
 * card rather than an empty one.
 */
export function DomainCards({
  scorecard,
  elements,
}: {
  scorecard: Scorecard;
  elements: Record<string, ContributingElement[]>;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Performance by domain">
      {scorecard.domains.map((domain) => {
        const withData = domain.indicators.filter((indicator) => indicator.value !== null).length;
        const scored = domain.indicators.filter((indicator) => indicator.score !== null).length;
        return (
          <li key={domain.domainId} className="flex flex-col rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[13px] font-semibold leading-snug">{domain.name}</h3>
              <BreakdownButton
                label={`the ${domain.name} score`}
                title={`${domain.name}: how the score is made up`}
                explanation={explainDomain(domain)}
                domains={[domain]}
                elements={elements}
                orgUnitName={scorecard.orgUnitName}
                periodLabel={scorecard.periodLabel}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
              <p className="numeric leading-none">
                <span className="text-[26px] font-semibold tracking-[-0.02em]">{domain.score ?? '—'}</span>
                {domain.score !== null ? <span className="ml-1 text-[12px] text-[var(--text-tertiary)]">/ 100</span> : (
                  <span className="sr-only">No score</span>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <StatusPill status={domain.status} compact />
                <TrendIndicator trend={domain.trend} />
              </div>
            </div>
            <ScoreBar score={domain.score} target={domain.target} status={domain.status} className="mt-3" />
            <dl className="mt-2.5 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-tertiary)]">
              <div className="flex gap-1">
                <dt>On track at</dt>
                <dd className="numeric text-[var(--text-secondary)]">{domain.target}</dd>
              </div>
              <div className="flex gap-1">
                <dt className="sr-only">Indicators</dt>
                <dd>
                  <span className="numeric text-[var(--text-secondary)]">{scored}</span> of {domain.indicators.length} indicators scored
                  {withData > scored ? ` (${withData - scored} without a target)` : ''}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt className="sr-only">Period</dt>
                <dd>{scorecard.periodLabel}</dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
