import type { Metadata } from 'next';
import Link from 'next/link';
import { resolvePageContext, type SearchParams } from '@/services/context';
import { can } from '@/auth/rbac';
import { requirePermission } from '@/auth/server';
import { listFindings } from '@/data/repositories/findings';
import { listChildren, listDescendants } from '@/data/repositories/orgUnits';
import { rollup } from '@/core/quality/types';
import { getScorecard } from '@/services/scorecards';
import { CONFIDENCE_WEIGHTS } from '@/core/quality/confidence';
import { PageHeader } from '@/design/patterns/PageHeader';
import { ScopeBar } from '@/design/patterns/ScopeBar';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { ConfidenceDisplay } from '@/design/primitives/Score';
import { SectionHeading } from '@/design/primitives/Meta';
import { FindingsTable } from './FindingsTable';

export const metadata: Metadata = { title: 'Data quality' };
export const dynamic = 'force-dynamic';

/**
 * The table gets the most severe findings, not every one. A state or federal
 * scope holds thousands, and sending them all makes the page slow without
 * making it more useful: the summary above the table says where they are.
 */
const TABLE_LIMIT = 500;

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const COMPONENT_LABELS: Record<string, string> = {
  completeness: 'Completeness',
  timeliness: 'Timeliness',
  validity: 'Validity',
  consistency: 'Consistency',
  stability: 'Stability',
};

export default async function DataQualityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The data-quality workspace is investigative detail. Executives get the
  // confidence summary on Overview and Intelligence instead.
  await requirePermission('quality.detail');
  const context = await resolvePageContext(await searchParams);
  const [children, facilities] = await Promise.all([
    listChildren(context.orgUnit.id),
    listDescendants(context.orgUnit.id, 'FACILITY'),
  ]);
  const scope = [
    context.orgUnit.id,
    ...children.map((child) => child.id),
    ...facilities.map((unit) => unit.id),
  ];
  const [findings, scorecard] = await Promise.all([
    listFindings({ orgUnitIds: scope }),
    getScorecard(context.orgUnit.id, context.periodId),
  ]);
  const open = findings.filter((finding) => finding.status === 'OPEN');
  const counts = rollup(open);
  const confidence = scorecard?.dataConfidence ?? null;

  // The most common issues, by what the check found and for which indicator.
  const byIssue = new Map<string, { count: number; units: Set<string> }>();
  for (const finding of open) {
    const entry = byIssue.get(finding.title) ?? { count: 0, units: new Set<string>() };
    entry.count += 1;
    entry.units.add(finding.orgUnitId);
    byIssue.set(finding.title, entry);
  }
  const commonIssues = [...byIssue].sort((a, b) => b[1].count - a[1].count).slice(0, 6);

  // Where they are: each open finding counted against the area directly
  // beneath the selected geography that contains it.
  const paths = new Map(facilities.map((unit) => [unit.id, unit.path]));
  const byArea = new Map(children.map((child) => [child.id, 0]));
  for (const finding of open) {
    const path = paths.get(finding.orgUnitId) ?? [finding.orgUnitId];
    const area = children.find((child) => path.includes(child.id));
    if (area) byArea.set(area.id, (byArea.get(area.id) ?? 0) + 1);
  }
  const busiestAreas = children
    .map((child) => ({ child, count: byArea.get(child.id) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const tableFindings = [...findings]
    .sort(
      (a, b) =>
        Number(b.status === 'OPEN') - Number(a.status === 'OPEN') ||
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        b.periodId.localeCompare(a.periodId),
    )
    .slice(0, TABLE_LIMIT);

  return (
    <>
      <PageHeader
        title="Data quality"
        description="Whether an apparent performance problem is a service problem or a reporting problem. Every finding names what was checked and what it found."
        controls={
          <ScopeBar
            orgUnits={context.orgUnitOptions}
            periods={context.periodOptions}
            orgUnitPath={context.orgUnitPath}
            deepestLevel={context.deepestLevel}
            orgUnitId={context.orgUnit.id}
            periodId={context.periodId}
          />
        }
      />

      <nav className="mb-4 text-[12px]">
        <Link href="/intelligence" className="text-[var(--brand-600)] hover:underline">
          ← Back to Intelligence
        </Link>
      </nav>

      <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="p-5">
          <p className="text-[12px] text-[var(--text-tertiary)]">
            Data confidence · {context.orgUnit.name}
          </p>
          {confidence ? (
            <>
              <div className="mt-2">
                <ConfidenceDisplay score={confidence.score} band={confidence.band} size="lg" />
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                This is a measure of the evidence, not of performance. A high score here means the reported
                figures can be relied on; it says nothing about whether they are good.
              </p>
              {confidence.reasons.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t pt-3">
                  {confidence.reasons.map((reason) => (
                    <li key={reason} className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
              No scored period is available for this geography.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader
            title="What makes up the confidence figure"
            description="Weighted components, each scored independently from the reporting record."
          />
          <CardBody>
            {confidence ? (
              <ul className="space-y-2.5">
                {Object.entries(confidence.components).map(([key, value]) => (
                  <li key={key} className="grid grid-cols-[130px_1fr_auto] items-center gap-3">
                    <span className="text-[12px] text-[var(--text-secondary)]">
                      {COMPONENT_LABELS[key] ?? key}
                    </span>
                    {value === null ? (
                      <>
                        <span className="text-[11px] text-[var(--text-tertiary)]">
                          No submission records in the source
                        </span>
                        <span className="w-20 text-right text-[12px] text-[var(--text-tertiary)]">
                          n/a
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="h-2 overflow-hidden rounded-full bg-[var(--ink-100)]">
                          <span
                            className="block h-full rounded-full transition-[width] duration-500"
                            style={{
                              width: `${value}%`,
                              backgroundColor:
                                value >= 90
                                  ? 'var(--status-fill-positive)'
                                  : value >= 70
                                    ? 'var(--status-fill-warning)'
                                    : 'var(--status-fill-concern)',
                            }}
                          />
                        </span>
                        <span className="numeric w-20 text-right text-[12px]">
                          {value}%
                          <span className="ml-1 text-[10px] text-[var(--text-tertiary)]">
                            ×{CONFIDENCE_WEIGHTS[key as keyof typeof CONFIDENCE_WEIGHTS]}
                          </span>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            <dl className="mt-4 grid grid-cols-3 gap-4 border-t pt-4">
              <div>
                <dt className="text-[11px] text-[var(--text-tertiary)]">Open findings</dt>
                <dd className="numeric mt-0.5 text-[16px] font-semibold">{counts.total}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--text-tertiary)]">High severity</dt>
                <dd className="numeric mt-0.5 text-[16px] font-semibold">{counts.bySeverity.HIGH}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--text-tertiary)]">Reporting gaps</dt>
                <dd className="numeric mt-0.5 text-[16px] font-semibold">
                  {counts.byDimension.COMPLETENESS}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </section>

      {open.length > 0 ? (
        <section className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Most common issues"
              description="Open findings grouped by what the check found."
            />
            <CardBody>
              <ul className="space-y-2">
                {commonIssues.map(([title, entry]) => (
                  <li key={title} className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="text-[var(--text-secondary)]">{title}</span>
                    <span className="numeric shrink-0 text-[var(--text-tertiary)]">
                      {entry.count.toLocaleString('en-GB')} in {entry.units.size.toLocaleString('en-GB')}{' '}
                      {entry.units.size === 1 ? 'unit' : 'units'}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Where they are"
              description={`Open findings by area within ${context.orgUnit.name}.`}
            />
            <CardBody>
              {busiestAreas.length > 0 ? (
                <ul className="space-y-2">
                  {busiestAreas.map(({ child, count }) => (
                    <li key={child.id} className="flex items-baseline justify-between gap-3 text-[12px]">
                      <Link
                        href={`/intelligence/data-quality?orgUnit=${child.id}&period=${context.periodId}`}
                        className="text-[var(--brand-600)] hover:underline"
                      >
                        {child.name}
                      </Link>
                      <span className="numeric text-[var(--text-tertiary)]">{count.toLocaleString('en-GB')}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-[var(--text-tertiary)]">
                  All open findings are recorded against {context.orgUnit.name} itself.
                </p>
              )}
            </CardBody>
          </Card>
        </section>
      ) : null}

      <section>
        <SectionHeading
          description={
            findings.length > TABLE_LIMIT
              ? `The ${TABLE_LIMIT} most severe of ${findings.length.toLocaleString('en-GB')} findings. Choose an area above to see all of its findings.`
              : 'Select an issue to see the figures the detector looked at, and record what you decided.'
          }
        >
          Findings
        </SectionHeading>
        <Card className="p-4">
          <FindingsTable
            findings={tableFindings}
            periodId={context.periodId}
            canTriage={can(context.user.role, 'quality.triage')}
          />
        </Card>
      </section>
    </>
  );
}
