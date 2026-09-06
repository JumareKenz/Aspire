import type { Metadata } from 'next';
import Link from 'next/link';
import { resolvePageContext, type SearchParams } from '@/services/context';
import { SUGGESTED_QUESTIONS } from '@/intelligence/answer';
import { modelStatus } from '@/intelligence/model';
import { listFindings } from '@/data/repositories/findings';
import { listChildren } from '@/data/repositories/orgUnits';
import { rollup } from '@/core/quality/types';
import { PageHeader } from '@/design/patterns/PageHeader';
import { ScopeBar } from '@/design/patterns/ScopeBar';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { Badge } from '@/design/primitives/Badge';
import { AskPanel } from './AskPanel';

export const metadata: Metadata = { title: 'Intelligence' };
export const dynamic = 'force-dynamic';

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await resolvePageContext(await searchParams);
  const model = modelStatus();

  const children = await listChildren(context.orgUnit.id);
  const scope = [context.orgUnit.id, ...children.map((child) => child.id)];
  const findings = await listFindings({ orgUnitIds: scope, status: 'OPEN' });
  const quality = rollup(findings);

  return (
    <>
      <PageHeader
        title="Intelligence"
        description="Ask a question in your own words. The platform turns it into an analytical query, runs that query against stored reporting, and explains the result."
        controls={
          <ScopeBar
            orgUnits={context.orgUnitOptions}
            periods={context.periodOptions}
            orgUnitId={context.orgUnit.id}
            periodId={context.periodId}
          />
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <AskPanel
          orgUnitId={context.orgUnit.id}
          periodId={context.periodId}
          suggestions={SUGGESTED_QUESTIONS}
        />

        <aside className="space-y-4">
          <Card>
            <CardHeader title="How answers are produced" />
            <CardBody>
              <ol className="space-y-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                {[
                  'Your question is turned into a structured analytical query.',
                  'The query is restricted to the geographies you are permitted to see.',
                  'The platform executes it against stored reporting.',
                  'The result is checked for internal consistency.',
                  'Only then is an explanation written.',
                ].map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="numeric mt-px shrink-0 text-[var(--text-tertiary)]">{index + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 border-t pt-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge tone={model.enabled ? 'positive' : 'neutral'}>
                    {model.enabled ? 'Model assistance enabled' : 'Model assistance not in use'}
                  </Badge>
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">{model.reason}</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                  A language model, when enabled, only chooses the query and phrases the result. It never
                  calculates a figure and cannot name an indicator or geography that does not exist.
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Data quality in this scope"
              description="Open findings that affect how the answers above should be read."
            />
            <CardBody>
              <dl className="space-y-2 text-[12px]">
                <div className="flex items-baseline justify-between">
                  <dt className="text-[var(--text-tertiary)]">Open findings</dt>
                  <dd className="numeric font-semibold">{quality.total}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-[var(--text-tertiary)]">High severity</dt>
                  <dd className="numeric font-semibold">{quality.bySeverity.HIGH}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-[var(--text-tertiary)]">Reporting gaps</dt>
                  <dd className="numeric font-semibold">{quality.byDimension.COMPLETENESS}</dd>
                </div>
              </dl>
              <Link
                href={`/intelligence/data-quality?orgUnit=${context.orgUnit.id}&period=${context.periodId}`}
                className="mt-3 inline-block text-[12px] text-[var(--brand-600)] hover:underline"
              >
                Open data quality →
              </Link>
            </CardBody>
          </Card>

        </aside>
      </div>
    </>
  );
}
