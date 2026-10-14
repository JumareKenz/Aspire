import Link from 'next/link';
import type { OverviewData } from '@/services/overview';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { ConfidenceDisplay, ScoreDisplay } from '@/design/primitives/Score';
import { StatusPill } from '@/design/primitives/StatusPill';
import { TrendIndicator } from '@/design/primitives/Trend';
import { SectionHeading } from '@/design/primitives/Meta';
import { EmptyState } from '@/design/primitives/States';
import { LineChart } from '@/design/charts/LineChart';
import { RankingBars } from '@/design/charts/RankingBars';
import { SeverityPill } from '@/design/primitives/StatusPill';

/**
 * The executive briefing.
 *
 * A different composition from the analyst overview, not the same page with
 * controls removed. It answers four questions in order and stops:
 *
 *   how are we doing · what needs attention · what changed · what it means
 *
 * There is no evidence drawer, no contribution decomposition and no follow-up
 * board. Those are investigative tools, and offering them to a reader who
 * cannot action them turns a briefing into a workspace. Each finding instead
 * carries a written interpretation, because the decision this page supports is
 * "where do I direct attention", not "what is the arithmetic".
 */
export function ExecutiveBriefing({
  data,
  attentionLimit,
  headlineAction,
  afterHeadline,
}: {
  data: OverviewData;
  attentionLimit: number;
  /** Placed beside the headline figure, e.g. its breakdown control. */
  headlineAction?: React.ReactNode;
  /** Rendered after the headline section, e.g. the domain cards. */
  afterHeadline?: React.ReactNode;
}) {
  const { scorecard, previous, ranking, insights, recommendations, contributions, reporting, history } =
    data;

  const attention = insights.filter((insight) => insight.severity !== 'LOW').slice(0, attentionLimit);
  const needsAttention = ranking.filter((unit) => unit.status === 'NEEDS_ATTENTION');
  const declining = ranking.filter((unit) => unit.changePoints !== null && unit.changePoints < -2);
  const improving = ranking.filter((unit) => unit.changePoints !== null && unit.changePoints > 2);
  const topDriver = contributions.filter((entry) => entry.contributionPoints < 0)[0] ?? null;

  const movement =
    previous && previous.overallScore !== null && scorecard.overallScore !== null
      ? Math.round((scorecard.overallScore - previous.overallScore) * 10) / 10
      : null;

  return (
    <>
      {/* How are we doing ------------------------------------------------ */}
      <section className="mb-9">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-1.5">
              <p className="text-[12px] text-[var(--text-tertiary)]">
                Overall SRHR performance · {scorecard.orgUnitName}
              </p>
              {headlineAction}
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <ScoreDisplay score={scorecard.overallScore} size="xl" status={scorecard.status} />
              <div className="mb-1.5 flex items-center gap-2">
                <StatusPill status={scorecard.status} />
                <TrendIndicator trend={scorecard.trend} />
              </div>
            </div>

            <p className="mt-4 max-w-md text-[14px] leading-relaxed text-[var(--text-secondary)]">
              {movement === null
                ? `No comparable previous period is available, so this quarter's figure stands alone.`
                : movement < 0
                  ? `Performance fell ${Math.abs(movement)} points on ${previous?.periodLabel}${
                      topDriver ? `, driven mainly by ${topDriver.name}` : ''
                    }.`
                  : movement > 0
                    ? `Performance rose ${movement} points on ${previous?.periodLabel}.`
                    : `Performance is unchanged on ${previous?.periodLabel}.`}
              {needsAttention.length > 0
                ? ` ${needsAttention.length} ${needsAttention.length === 1 ? 'area needs' : 'areas need'} attention.`
                : ' No area is below the attention threshold.'}
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 border-t pt-5">
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
                  {reporting.completeness === null ? (
                    <span className="text-[12px] font-normal text-[var(--text-tertiary)]">
                      Not available from the source
                    </span>
                  ) : (
                    `${reporting.completeness}%`
                  )}
                </dd>
              </div>
            </dl>

            {scorecard.dataConfidence.band !== 'HIGH' ? (
              <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                {scorecard.dataConfidence.reasons[0] ??
                  'Reporting for this period is incomplete; read the figure with that in mind.'}
              </p>
            ) : null}
          </div>

          <Card>
            <CardHeader
              title="Performance over time"
              description={`Overall score across the last ${history.labels.length} reporting periods.`}
            />
            <CardBody>
              <LineChart
                labels={history.labels}
                series={[{ id: 'overall', label: 'Overall score', values: history.values }]}
                yLabel="Overall score"
                referenceValue={75}
                referenceLabel="On track"
                height={196}
              />
            </CardBody>
          </Card>
        </div>
      </section>

      {afterHeadline}

      {/* What needs attention -------------------------------------------- */}
      <section className="mb-9">
        <SectionHeading description="The issues most likely to change a decision this quarter.">
          What needs attention
        </SectionHeading>
        {attention.length === 0 ? (
          <EmptyState
            title="Nothing is flagged for this period."
            description="No area fell below the attention threshold, declined materially, or lost data confidence."
          />
        ) : (
          <Card>
            <ul className="divide-y">
              {attention.map((insight) => (
                <li key={insight.id} className="flex items-start gap-4 px-5 py-4">
                  <span className="mt-0.5 shrink-0">
                    <SeverityPill severity={insight.severity} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[var(--text-primary)]">
                      {insight.headline}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                      {insight.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* What changed ----------------------------------------------------- */}
      <section className="mb-9">
        <SectionHeading
          description={
            previous
              ? `Movement between ${previous.periodLabel} and ${scorecard.periodLabel}.`
              : 'No previous period is available for comparison.'
          }
        >
          What changed
        </SectionHeading>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h3 className="text-[13px] font-semibold">In summary</h3>
            <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
              {topDriver ? (
                <li>
                  <span className="font-medium text-[var(--text-primary)]">{topDriver.name}</span> was
                  the largest single contributor to the change, accounting for{' '}
                  {Math.round(topDriver.share * 100)}% of the total movement.
                </li>
              ) : null}
              {declining.length === 1 ? (
                <li>
                  <span className="font-medium text-[var(--text-primary)]">
                    {declining[0].orgUnitName}
                  </span>{' '}
                  declined materially, by {declining[0].changePoints} points.
                </li>
              ) : declining.length > 1 ? (
                <li>
                  {declining.length} areas declined materially, the steepest being{' '}
                  <span className="font-medium text-[var(--text-primary)]">
                    {declining[declining.length - 1].orgUnitName}
                  </span>{' '}
                  at {declining[declining.length - 1].changePoints} points.
                </li>
              ) : (
                <li>No area declined materially this period.</li>
              )}
              {improving.length > 0 ? (
                <li>
                  {improving[0].orgUnitName} improved most, by +{improving[0].changePoints} points.
                </li>
              ) : null}
              {ranking.length > 0 ? (
                <li>
                  The spread across areas runs from {ranking[0].score} to{' '}
                  {ranking[ranking.length - 1].score}, a gap of{' '}
                  {Math.round(((ranking[0].score ?? 0) - (ranking[ranking.length - 1].score ?? 0)) * 10) /
                    10}{' '}
                  points.
                </li>
              ) : null}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Performance by area"
              description="The marker shows the on-track threshold."
              action={
                <Link
                  href={`/performance?orgUnit=${scorecard.orgUnitId}&period=${scorecard.periodId}`}
                  className="text-[12px] text-[var(--brand-600)] hover:underline"
                >
                  See detail
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

      {/* What it means ---------------------------------------------------- */}
      <section>
        <SectionHeading description="Where the evidence suggests attention would have most effect.">
          What we recommend
        </SectionHeading>
        {recommendations.length === 0 ? (
          <EmptyState
            title="No recommendation met the evidence threshold this period."
            description="Recommendations are only produced where the platform can name the geography, the indicators and the figures behind them."
          />
        ) : (
          <Card>
            <ol className="divide-y">
              {recommendations.slice(0, 3).map((entry, index) => (
                <li key={entry.id} className="flex gap-4 px-5 py-4">
                  <span className="numeric mt-0.5 text-[13px] text-[var(--text-tertiary)]">
                    {index + 1}.
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[var(--text-primary)]">{entry.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                      {entry.issue}
                    </p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                      <span className="text-[var(--text-tertiary)]">Recommended: </span>
                      {entry.nextStep}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </section>
    </>
  );
}
