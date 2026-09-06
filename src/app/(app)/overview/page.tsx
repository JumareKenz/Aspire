import type { Metadata } from 'next';
import Link from 'next/link';
import { resolvePageContext, type SearchParams } from '@/services/context';
import { getOverview } from '@/services/overview';
import { PageHeader } from '@/design/patterns/PageHeader';
import { ScopeBar } from '@/design/patterns/ScopeBar';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { ConfidenceDisplay, ScoreDisplay } from '@/design/primitives/Score';
import { StatusPill } from '@/design/primitives/StatusPill';
import { TrendIndicator } from '@/design/primitives/Trend';
import { ProvisionalBadge, SectionHeading } from '@/design/primitives/Meta';
import { EmptyState } from '@/design/primitives/States';
import { LineChart } from '@/design/charts/LineChart';
import { ContributionBars } from '@/design/charts/ContributionBars';
import { RankingBars } from '@/design/charts/RankingBars';
import { ButtonLink } from '@/design/primitives/Button';
import { InsightList } from './InsightList';
import { RecommendationList } from '@/design/patterns/RecommendationList';
import { can } from '@/auth/rbac';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await resolvePageContext(await searchParams);
  const overview = getOverview(context.orgUnit.id, context.periodId);

  if (!overview || overview.scorecard.overallScore === null) {
    return (
      <>
        <PageHeader
          title="Overview"
          description={`${context.orgUnit.name} · ${context.periodLabel}`}
          controls={
            <ScopeBar
              orgUnits={context.orgUnitOptions}
              periods={context.periodOptions}
              orgUnitId={context.orgUnit.id}
              periodId={context.periodId}
            />
          }
        />
        <EmptyState
          title={`No SRHR performance can be reported for ${context.periodLabel}.`}
          description={
            overview
              ? `Only ${Math.round(overview.scorecard.coverage * 100)}% of weighted indicators have data for this period, which is below the minimum the scoring methodology requires. Reporting for this period may still be open.`
              : 'This geography has no stored reporting. Try another period, or ask an administrator to run a synchronisation.'
          }
          action={
            <ButtonLink href="/intelligence/data-quality" size="sm">
              Review data quality
            </ButtonLink>
          }
        />
      </>
    );
  }

  const { scorecard, previous, ranking, insights, recommendations, contributions, reporting, quality, history } =
    overview;
  const attention = insights.filter((insight) => insight.severity !== 'LOW').slice(0, 5);
  const needsAttention = ranking.filter((unit) => unit.status === 'NEEDS_ATTENTION').length;
  const watch = ranking.filter((unit) => unit.status === 'WATCH').length;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`SRHR performance for ${scorecard.orgUnitName}, ${scorecard.periodLabel}.`}
        meta={
          <ProvisionalBadge
            version={scorecard.methodologyVersion}
            status={scorecard.methodologyStatus}
          />
        }
        controls={
          <ScopeBar
            orgUnits={context.orgUnitOptions}
            periods={context.periodOptions}
            orgUnitId={context.orgUnit.id}
            periodId={context.periodId}
          />
        }
      />

      {/* How are we doing? ---------------------------------------------- */}
      <section className="mb-8" aria-labelledby="how-are-we-doing">
        <h2 id="how-are-we-doing" className="sr-only">
          How are we doing
        </h2>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <Card className="p-5">
            <p className="text-[12px] text-[var(--text-tertiary)]">Overall SRHR performance</p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <ScoreDisplay score={scorecard.overallScore} size="xl" status={scorecard.status} />
              <div className="mb-1 flex items-center gap-2">
                <StatusPill status={scorecard.status} />
                <TrendIndicator trend={scorecard.trend} />
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-4">
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
                <dt className="text-[11px] text-[var(--text-tertiary)]">Reporting received</dt>
                <dd className="numeric mt-1 text-[14px] font-semibold">
                  {reporting.completeness}%
                  <span className="ml-1.5 text-[11px] font-normal text-[var(--text-tertiary)]">
                    {reporting.received.toLocaleString('en-GB')} of{' '}
                    {reporting.expected.toLocaleString('en-GB')}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--text-tertiary)]">Areas needing attention</dt>
                <dd className="numeric mt-1 text-[14px] font-semibold">
                  {needsAttention}
                  <span className="ml-1.5 text-[11px] font-normal text-[var(--text-tertiary)]">
                    {watch > 0 ? `and ${watch} to watch` : `of ${ranking.length}`}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--text-tertiary)]">Open quality findings</dt>
                <dd className="numeric mt-1 text-[14px] font-semibold">
                  {quality.total}
                  <span className="ml-1.5 text-[11px] font-normal text-[var(--text-tertiary)]">
                    {quality.bySeverity.HIGH} high
                  </span>
                </dd>
              </div>
            </dl>

            {scorecard.dataConfidence.reasons.length > 0 ? (
              <p className="mt-4 border-t pt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                {scorecard.dataConfidence.reasons[0]}
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Performance over time"
              description={`Overall score across the last ${history.labels.length} reporting periods, scored with ${scorecard.methodologyVersion}.`}
            />
            <CardBody>
              <LineChart
                labels={history.labels}
                series={[{ id: 'overall', label: 'Overall score', values: history.values }]}
                yLabel="Overall score"
                referenceValue={75}
                referenceLabel="On track"
                height={188}
              />
            </CardBody>
          </Card>
        </div>
      </section>

      {/* What needs attention? ------------------------------------------ */}
      <section className="mb-8" aria-labelledby="needs-attention">
        <SectionHeading
          description="Ranked by how much this should change what you do next."
          action={
            <ButtonLink href="/intelligence" size="sm">
              Ask a question
            </ButtonLink>
          }
        >
          <span id="needs-attention">What needs attention</span>
        </SectionHeading>
        <Card>
          {attention.length === 0 ? (
            <CardBody className="pt-5">
              <EmptyState
                title="Nothing is flagged for this period."
                description="No geography in scope fell below the attention threshold, declined materially, or dropped to low data confidence."
              />
            </CardBody>
          ) : (
            <div className="px-4 py-1">
              <InsightList insights={attention} />
            </div>
          )}
        </Card>
      </section>

      {/* What changed? --------------------------------------------------- */}
      <section className="mb-8" aria-labelledby="what-changed">
        <SectionHeading
          description={
            previous
              ? `Movement between ${previous.periodLabel} and ${scorecard.periodLabel}.`
              : 'No previous period is available for comparison.'
          }
        >
          <span id="what-changed">What changed</span>
        </SectionHeading>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Contribution to the overall change"
              description="Each domain's movement multiplied by its weight in the methodology."
            />
            <CardBody>
              {contributions.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-[var(--text-tertiary)]">
                  A previous period with a comparable score is needed before change can be attributed.
                </p>
              ) : (
                <ContributionBars contributions={contributions} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={`Performance by ${ranking.length > 0 ? 'area' : 'geography'}`}
              description="Scored on the same methodology. The marker shows the on-track threshold."
              action={
                <Link
                  href={`/performance?orgUnit=${scorecard.orgUnitId}&period=${scorecard.periodId}`}
                  className="text-[12px] text-[var(--brand-600)] hover:underline"
                >
                  Open Performance
                </Link>
              }
            />
            <CardBody>
              {ranking.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-[var(--text-tertiary)]">
                  This is the lowest level of the hierarchy in your scope.
                </p>
              ) : (
                <RankingBars
                  threshold={75}
                  data={ranking.map((unit) => ({
                    id: unit.orgUnitId,
                    label: unit.orgUnitName,
                    value: unit.score,
                    status: unit.status,
                    secondary: `data confidence ${unit.dataConfidence}%`,
                  }))}
                />
              )}
            </CardBody>
          </Card>
        </div>
      </section>

      {/* Why does it matter? --------------------------------------------- */}
      <section aria-labelledby="what-to-do">
        <SectionHeading description="Each recommendation names the geography, the indicators and the figures it rests on.">
          <span id="what-to-do">What we recommend</span>
        </SectionHeading>
        <RecommendationList
          recommendations={recommendations.slice(0, 4)}
          periodId={scorecard.periodId}
          canManageActions={can(context.user.role, 'actions.manage')}
        />
      </section>
    </>
  );
}
