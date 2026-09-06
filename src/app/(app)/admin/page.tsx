import type { Metadata } from 'next';
import { requirePermission } from '@/auth/server';
import { can } from '@/auth/rbac';
import { listSyncRuns, lastSuccessfulSync } from '@/data/repositories/syncRuns';
import { getDataMode, getLastSyncAt } from '@/data/repositories/settings';
import { getSourceAdapter, isDhis2Configured } from '@/data/sources';
import { getActiveMethodology, listIndicators } from '@/data/repositories/registry';
import { listOrgUnits } from '@/data/repositories/orgUnits';
import { listFindings } from '@/data/repositories/findings';
import { latestCompletePeriodId } from '@/data/sync/periods';
import { PageHeader } from '@/design/patterns/PageHeader';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { Badge } from '@/design/primitives/Badge';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { EmptyState } from '@/design/primitives/States';
import { AdminNav } from './AdminNav';
import { SyncPanel } from './SyncPanel';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

function relativeAge(iso: string | null): string {
  if (!iso) return 'never';
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes ago`;
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default async function AdminPage() {
  const user = await requirePermission('admin.view');
  const adapter = getSourceAdapter();
  const [mode, lastSync, runs, lastSuccess, methodology, indicators, orgUnits, openFindings] =
    await Promise.all([
      getDataMode(),
      getLastSyncAt(),
      listSyncRuns(10),
      lastSuccessfulSync(),
      getActiveMethodology(),
      listIndicators(true),
      listOrgUnits(),
      listFindings({ status: 'OPEN' }),
    ]);
  const unmapped = indicators.filter((indicator) => indicator.source.dx === null);

  return (
    <>
      <PageHeader
        title="Administration"
        description="Connection, synchronisation, configuration and audit."
      />
      <AdminNav />

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Data source" />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={mode === 'DHIS2' ? 'positive' : 'warning'}>
                {mode === 'DHIS2' ? 'Live DHIS2' : 'Demo data'}
              </Badge>
              <span className="text-[12px] text-[var(--text-secondary)]">{adapter.label}</span>
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
              {isDhis2Configured()
                ? 'DHIS2 credentials are configured in the environment. They are read on the server and never sent to the browser.'
                : 'No DHIS2 instance is configured. Set DHIS2_BASE_URL and either DHIS2_TOKEN or DHIS2_USERNAME and DHIS2_PASSWORD, then synchronise.'}
            </p>
            <SyncPanel canSync={can(user.role, 'admin.sync')} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Data freshness" />
          <CardBody>
            <dl className="space-y-2.5 text-[12px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--text-tertiary)]">Last synchronisation</dt>
                <dd className="font-medium">{relativeAge(lastSync)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--text-tertiary)]">Last success</dt>
                <dd className="font-medium">{relativeAge(lastSuccess?.finishedAt ?? null)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--text-tertiary)]">Latest complete period</dt>
                <dd className="numeric font-medium">{latestCompletePeriodId()}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--text-tertiary)]">Organisation units</dt>
                <dd className="numeric font-medium">{orgUnits.length}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--text-tertiary)]">Open quality findings</dt>
                <dd className="numeric font-medium">{openFindings.length}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Scoring methodology" />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={methodology.status === 'OFFICIAL' ? 'positive' : 'warning'}>
                {methodology.status.toLowerCase()}
              </Badge>
              <span className="numeric text-[12px] font-medium">{methodology.version}</span>
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
              {methodology.description}
            </p>
            <dl className="space-y-1.5 border-t pt-2 text-[12px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--text-tertiary)]">On-track threshold</dt>
                <dd className="numeric font-medium">{methodology.statusBands.onTrack}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--text-tertiary)]">Missing-data rule</dt>
                <dd className="font-medium">{methodology.missingData.rule.toLowerCase()}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--text-tertiary)]">Minimum coverage</dt>
                <dd className="numeric font-medium">
                  {Math.round(methodology.missingData.minCoverage * 100)}%
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </section>

      {unmapped.length > 0 && isDhis2Configured() ? (
        <div className="mb-6 rounded-[var(--radius-md)] border border-[var(--warning-600)]/40 bg-[var(--warning-100)]/40 px-4 py-3">
          <p className="text-[13px] font-medium">
            {unmapped.length} of {indicators.length} indicators have no DHIS2 mapping.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            An unmapped indicator is skipped during synchronisation, so its scores will be missing rather than
            wrong. Set an identifier for each in Admin → Indicators.
          </p>
        </div>
      ) : null}

      <section>
        <Card className="px-2 py-1">
          <CardHeader title="Synchronisation history" description="Most recent first, including failures." />
          {runs.length === 0 ? (
            <CardBody>
              <EmptyState title="No synchronisation has run yet." />
            </CardBody>
          ) : (
            <div className="px-3 pb-3">
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Started</Th>
                    <Th>Source</Th>
                    <Th>Status</Th>
                    <Th align="right">Org units</Th>
                    <Th align="right">Values</Th>
                    <Th align="right">Findings</Th>
                    <Th>Detail</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <Tr key={run.id}>
                      <Td className="numeric text-[12px] text-[var(--text-secondary)]">
                        {new Date(run.startedAt).toLocaleString('en-GB')}
                      </Td>
                      <Td>{run.source}</Td>
                      <Td>
                        <Badge
                          tone={
                            run.status === 'SUCCESS' ? 'positive' : run.status === 'FAILED' ? 'concern' : 'neutral'
                          }
                        >
                          {run.status.toLowerCase()}
                        </Badge>
                      </Td>
                      <Td align="right" numeric>
                        {run.orgUnits}
                      </Td>
                      <Td align="right" numeric>
                        {run.observations.toLocaleString('en-GB')}
                      </Td>
                      <Td align="right" numeric>
                        {run.findings}
                      </Td>
                      <Td className="text-[12px] text-[var(--text-tertiary)]">{run.message ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
