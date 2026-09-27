import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/auth/server';
import { can } from '@/auth/rbac';
import { isInScope } from '@/auth/rbac';
import { listOrgUnits } from '@/data/repositories/orgUnits';
import { PageHeader } from '@/design/patterns/PageHeader';
import { Badge } from '@/design/primitives/Badge';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { SectionHeading } from '@/design/primitives/Meta';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { getValidationOverview } from '@/services/validation';
import { defaultPeriodId } from '@/services/scorecards';
import { AdminNav } from '../AdminNav';
import { OutlierPanel, ReconciliationPanel, RuleCheckPanel } from './ValidationPanels';

export const metadata: Metadata = { title: 'Data validation' };
export const dynamic = 'force-dynamic';

const DIMENSION_LABELS: Record<string, string> = {
  COMPLETENESS: 'Reporting gaps',
  TIMELINESS: 'Late reporting',
  VALIDITY: 'Impossible values',
  CONSISTENCY: 'Numerator above denominator',
  STATISTICAL: 'Statistical outliers',
  TEMPORAL: 'Sudden level changes',
  REPEATED_VALUE: 'Repeated values',
};

const LEVEL_LABELS: Record<string, string> = {
  COUNTRY: 'Federal',
  STATE: 'State',
  LGA: 'LGA',
  WARD: 'Ward',
  FACILITY: 'Facility',
};

function relativeAge(iso: string | null): string {
  if (!iso) return 'never';
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes ago`;
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default async function ValidationPage() {
  const user = await requirePermission('admin.view');
  const [overview, units, defaultPeriod] = await Promise.all([getValidationOverview(), listOrgUnits(), defaultPeriodId()]);
  const connected = overview.source.mode === 'DHIS2' && overview.source.url !== null;
  const lastRun = overview.runs[0] ?? null;
  const reconciliation = overview.reconciliation;
  // Outlier detection runs per LGA (see runOutlierCheck), grouped by state.
  const stateName = new Map(units.filter((unit) => unit.level === 'STATE').map((unit) => [unit.id, unit.name]));
  const areas = units
    .filter((unit) => unit.level === 'LGA' && isInScope(user.scope, unit.path))
    .map((unit) => ({ id: unit.id, name: unit.name, group: stateName.get(unit.parentId ?? '') ?? '' }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

  const maxByDimension = Math.max(1, ...overview.findings.byDimension.map((entry) => entry.count));
  const maxByPeriod = Math.max(1, ...overview.findings.byPeriod.map((entry) => entry.count));
  const maxByLevel = Math.max(1, ...overview.findings.byLevel.map((entry) => entry.count));

  return (
    <>
      <PageHeader
        title="Administration"
        description="Evidence that the figures on this platform can be trusted: how they compare with DHIS2, what the quality checks found, and DHIS2's own validation."
      />
      <AdminNav />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Validation status">
        <StatusCard label="Data source">
          <p className="text-[14px] font-semibold">{connected ? 'DHIS2' : 'Demo data'}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-tertiary)]">
            {overview.source.url?.replace(/^https?:\/\//, '') ?? 'No instance connected'}
          </p>
        </StatusCard>
        <StatusCard label="Last synchronisation">
          {lastRun ? (
            <>
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                {relativeAge(lastRun.finishedAt ?? lastRun.startedAt)}
                <Badge tone={lastRun.status === 'SUCCESS' ? 'positive' : lastRun.status === 'FAILED' ? 'concern' : 'neutral'}>
                  {lastRun.status.toLowerCase()}
                </Badge>
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
                {lastRun.observations.toLocaleString('en-GB')} values · {lastRun.orgUnits.toLocaleString('en-GB')} areas ·{' '}
                <Link href="/admin" className="text-[var(--brand-600)] hover:underline">history</Link>
              </p>
            </>
          ) : (
            <p className="text-[14px] font-semibold">Never run</p>
          )}
        </StatusCard>
        <StatusCard label="Agreement with DHIS2">
          {reconciliation ? (
            <>
              <p className="text-[14px] font-semibold">
                {reconciliation.summary.matched.toLocaleString('en-GB')} of {reconciliation.summary.compared.toLocaleString('en-GB')} identical
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">Checked {relativeAge(reconciliation.reconciledAt)}</p>
            </>
          ) : (
            <p className="text-[14px] font-semibold">Not checked yet</p>
          )}
        </StatusCard>
        <StatusCard label="Reporting completeness">
          {overview.reporting.records > 0 ? (
            <p className="text-[14px] font-semibold">{overview.reporting.records.toLocaleString('en-GB')} submission records</p>
          ) : (
            <>
              <p className="text-[14px] font-semibold">Not available</p>
              <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">The source holds no form-submission records.</p>
            </>
          )}
        </StatusCard>
      </section>

      <section className="mb-8">
        <SectionHeading description="ASPIRE's stored figures compared with the values DHIS2 itself returns, for a fixed sample of indicators, areas at every level and quarters.">
          Reconciliation with DHIS2
        </SectionHeading>
        <ReconciliationPanel initial={reconciliation} canRun={connected && can(user.role, 'admin.sync')} />
      </section>

      <section className="mb-8">
        <SectionHeading
          description={`${overview.findings.open.toLocaleString('en-GB')} open findings from the checks ASPIRE runs on every sync. Each is reviewed and resolved in the data-quality workspace.`}
        >
          ASPIRE quality checks
        </SectionHeading>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="By type of problem"
              action={
                <div className="flex gap-1.5">
                  <Badge tone="concern">{overview.findings.bySeverity.HIGH.toLocaleString('en-GB')} high</Badge>
                  <Badge tone="warning">{overview.findings.bySeverity.MEDIUM.toLocaleString('en-GB')} medium</Badge>
                  <Badge tone="neutral">{overview.findings.bySeverity.LOW.toLocaleString('en-GB')} low</Badge>
                </div>
              }
            />
            <CardBody>
              <BarList
                rows={overview.findings.byDimension.map((entry) => ({
                  label: DIMENSION_LABELS[entry.dimension] ?? entry.dimension,
                  value: entry.count,
                }))}
                max={maxByDimension}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="By level" description="Where in the hierarchy the problems were found." />
            <CardBody>
              <BarList
                rows={overview.findings.byLevel.map((entry) => ({ label: LEVEL_LABELS[entry.level] ?? entry.level, value: entry.count }))}
                max={maxByLevel}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="By indicator" description="Indicators with the most open findings." />
            <CardBody>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Indicator</Th>
                    <Th align="right">Open</Th>
                    <Th align="right">High</Th>
                  </tr>
                </thead>
                <tbody>
                  {overview.findings.byIndicator.map((entry) => (
                    <Tr key={entry.indicator}>
                      <Td className="text-[12px]">{entry.indicator}</Td>
                      <Td align="right" numeric className="text-[12px]">{entry.count.toLocaleString('en-GB')}</Td>
                      <Td align="right" numeric className="text-[12px]">{entry.high.toLocaleString('en-GB')}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="By quarter" description="Open findings for each reporting period." />
            <CardBody>
              <BarList rows={overview.findings.byPeriod.map((entry) => ({ label: entry.periodId, value: entry.count }))} max={maxByPeriod} />
              <p className="mt-3 text-[12px]">
                <Link href="/intelligence/data-quality" className="text-[var(--brand-600)] hover:underline">
                  Review and resolve findings in the data-quality workspace →
                </Link>
              </p>
            </CardBody>
          </Card>
        </div>
      </section>

      <section className="mb-8">
        <SectionHeading description="DHIS2's own statistical check on raw facility-month values, one LGA at a time. It finds the single facility report that an LGA or state total would hide.">
          DHIS2 outlier detection
        </SectionHeading>
        <OutlierPanel areas={areas} connected={connected} defaultPeriod={defaultPeriod} />
      </section>

      <section className="mb-8">
        <SectionHeading description="Runs a form's validation rules in DHIS2 for one area and month, such as ANC 4th visits not exceeding total ANC attendance.">
          DHIS2 validation rules
        </SectionHeading>
        <RuleCheckPanel connected={connected} defaultPeriod={defaultPeriod} />
      </section>
    </>
  );
}

function StatusCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{label}</p>
      {children}
    </Card>
  );
}

function BarList({ rows, max }: { rows: Array<{ label: string; value: number }>; max: number }) {
  if (rows.length === 0) return <p className="text-[12px] text-[var(--text-tertiary)]">No open findings.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_64px] items-center gap-3 text-[12px]">
          <span className="truncate text-[var(--text-secondary)]">{row.label}</span>
          <span className="h-2 rounded-full bg-[var(--ink-100)]">
            <span className="block h-full rounded-full bg-[var(--brand-500)]" style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span className="numeric text-right">{row.value.toLocaleString('en-GB')}</span>
        </li>
      ))}
    </ul>
  );
}
