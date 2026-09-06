import type { Metadata } from 'next';
import Link from 'next/link';
import { resolvePageContext, type SearchParams } from '@/services/context';
import { getChildScorecards, getScorecard } from '@/services/scorecards';
import { rankScorecards } from '@/core/analytics/attribution';
import { previousPeriodId } from '@/core/model/periods';
import { getOrgUnit } from '@/data/repositories/orgUnits';
import { PageHeader } from '@/design/patterns/PageHeader';
import { ScopeBar } from '@/design/patterns/ScopeBar';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { ConfidenceDisplay, ScoreDisplay } from '@/design/primitives/Score';
import { StatusPill } from '@/design/primitives/StatusPill';
import { TrendIndicator } from '@/design/primitives/Trend';
import { ProvisionalBadge, SectionHeading } from '@/design/primitives/Meta';
import { EmptyState } from '@/design/primitives/States';
import { ScorecardTable } from '@/design/patterns/ScorecardTable';
import { AreaTable, type AreaRow } from '@/design/patterns/AreaTable';
import { LineChart } from '@/design/charts/LineChart';

export const metadata: Metadata = { title: 'Performance' };
export const dynamic = 'force-dynamic';

/** State › LGA › Facility, so a user always knows where they are and can step back. */
function Breadcrumb({ path, periodId }: { path: string[]; periodId: string }) {
  const units = path.map((id) => getOrgUnit(id)).filter((unit) => unit !== null);
  if (units.length <= 1) return null;
  return (
    <nav aria-label="Geography" className="mb-2 flex flex-wrap items-center gap-1 text-[12px]">
      {units.map((unit, index) => (
        <span key={unit.id} className="flex items-center gap-1">
          {index > 0 ? (
            <span aria-hidden="true" className="text-[var(--text-tertiary)]">
              ›
            </span>
          ) : null}
          {index === units.length - 1 ? (
            <span className="text-[var(--text-secondary)]">{unit.name}</span>
          ) : (
            <Link
              href={`/performance?orgUnit=${unit.id}&period=${periodId}`}
              className="text-[var(--brand-600)] hover:underline"
            >
              {unit.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const context = await resolvePageContext(params);
  const scorecard = getScorecard(context.orgUnit.id, context.periodId);
  const expandDomain = typeof params.domain === 'string' ? [params.domain] : undefined;

  const controls = (
    <ScopeBar
      orgUnits={context.orgUnitOptions}
      periods={context.periodOptions}
      orgUnitId={context.orgUnit.id}
      periodId={context.periodId}
    />
  );

  if (!scorecard) {
    return (
      <>
        <PageHeader title="Performance" controls={controls} />
        <EmptyState
          title="No stored reporting for this geography."
          description="Ask an administrator to run a synchronisation, or choose another geography."
        />
      </>
    );
  }

  const children = getChildScorecards(context.orgUnit.id, context.periodId);
  const previousChildren = new Map(
    getChildScorecards(context.orgUnit.id, previousPeriodId(context.periodId)).map((card) => [
      card.orgUnitId,
      card,
    ]),
  );
  const ranked = rankScorecards(children, previousChildren);
  const historyByUnit = new Map(children.map((card) => [card.orgUnitId, card.overallSeries]));
  const rows: AreaRow[] = ranked.map((unit) => ({
    ...unit,
    history: historyByUnit.get(unit.orgUnitId) ?? [],
    level: children.find((card) => card.orgUnitId === unit.orgUnitId)?.orgUnitLevel ?? 'LGA',
  }));

  const scored = scorecard.domains.filter((domain) => domain.score !== null);
  const strongest = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
  const weakest = [...scored].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0] ?? null;

  // Comparison line: the scope itself against the three areas that moved most.
  const movers = [...ranked]
    .filter((unit) => unit.changePoints !== null)
    .sort((a, b) => (a.changePoints ?? 0) - (b.changePoints ?? 0))
    .slice(0, 3);
  const comparisonSeries = [
    { id: scorecard.orgUnitId, label: scorecard.orgUnitName, values: scorecard.overallSeries },
    ...movers.map((unit) => ({
      id: unit.orgUnitId,
      label: unit.orgUnitName,
      values: historyByUnit.get(unit.orgUnitId) ?? [],
    })),
  ].slice(0, 4);

  return (
    <>
      <PageHeader
        title="Performance"
        description={`Scorecard and breakdown for ${scorecard.orgUnitName}, ${scorecard.periodLabel}.`}
        meta={
          <ProvisionalBadge version={scorecard.methodologyVersion} status={scorecard.methodologyStatus} />
        }
        controls={controls}
      />

      <Breadcrumb path={context.orgUnit.path} periodId={context.periodId} />

      <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card className="p-5">
          <p className="text-[12px] text-[var(--text-tertiary)]">
            Overall score · {scorecard.orgUnitLevel.toLowerCase()}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <ScoreDisplay score={scorecard.overallScore} size="lg" status={scorecard.status} />
            <div className="mb-1 flex items-center gap-2">
              <StatusPill status={scorecard.status} />
              <TrendIndicator trend={scorecard.trend} />
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-4">
            <div>
              <dt className="text-[11px] text-[var(--text-tertiary)]">Data confidence</dt>
              <dd className="mt-1">
                <ConfidenceDisplay
                  score={scorecard.dataConfidence.score}
                  band={scorecard.dataConfidence.band}
                  size="sm"
                />
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--text-tertiary)]">Indicator coverage</dt>
              <dd className="numeric mt-1 text-[14px] font-semibold">
                {Math.round(scorecard.coverage * 100)}%
              </dd>
            </div>
            {strongest ? (
              <div>
                <dt className="text-[11px] text-[var(--text-tertiary)]">Strongest domain</dt>
                <dd className="mt-1 text-[13px] font-medium">
                  {strongest.name}{' '}
                  <span className="numeric font-normal text-[var(--text-tertiary)]">
                    {strongest.score}
                  </span>
                </dd>
              </div>
            ) : null}
            {weakest ? (
              <div>
                <dt className="text-[11px] text-[var(--text-tertiary)]">Weakest domain</dt>
                <dd className="mt-1 text-[13px] font-medium">
                  {weakest.name}{' '}
                  <span className="numeric font-normal text-[var(--text-tertiary)]">{weakest.score}</span>
                </dd>
              </div>
            ) : null}
          </dl>
          {scorecard.dataConfidence.reasons.length > 0 ? (
            <p className="mt-4 border-t pt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              {scorecard.dataConfidence.reasons[0]}
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Trajectory"
            description={
              comparisonSeries.length > 1
                ? 'This geography against the three areas that moved most this period.'
                : 'Overall score across the analysis window.'
            }
          />
          <CardBody>
            <LineChart
              labels={scorecard.periodLabels}
              series={comparisonSeries}
              yLabel="Overall score"
              referenceValue={75}
              referenceLabel="On track"
              height={192}
            />
          </CardBody>
        </Card>
      </section>

      <section className="mb-8">
        <SectionHeading description="Select a domain to see the indicators inside it, then an indicator to see its history, contributors and outlook.">
          Scorecard
        </SectionHeading>
        <Card className="px-2 py-1">
          <ScorecardTable scorecard={scorecard} defaultExpanded={expandDomain} />
        </Card>
      </section>

      <section>
        <SectionHeading
          description={
            rows.length > 0
              ? 'Ranked by overall score. Select an area to drill into it.'
              : undefined
          }
        >
          {rows.length > 0 ? 'Areas within this geography' : 'Breakdown'}
        </SectionHeading>
        {rows.length === 0 ? (
          <EmptyState
            title="This is a reporting facility."
            description="Facilities are the lowest level of the hierarchy, so there is nothing further to break down. Use the scorecard above to see this facility's indicator detail."
          />
        ) : (
          <Card className="px-2 py-1">
            <AreaTable rows={rows} periodId={context.periodId} />
          </Card>
        )}
      </section>
    </>
  );
}
