import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePermission } from '@/auth/server';
import { can, isInScope } from '@/auth/rbac';
import { listOrgUnits } from '@/data/repositories/orgUnits';
import { PageHeader } from '@/design/patterns/PageHeader';
import { Badge } from '@/design/primitives/Badge';
import { Card } from '@/design/primitives/Card';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { cn } from '@/design/primitives/cn';
import { getValidationOverview } from '@/services/validation';
import { defaultPeriodId } from '@/services/scorecards';
import { AdminNav } from '../AdminNav';
import { ToolTabs } from '../ui';
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

type Tone = 'positive' | 'warning' | 'concern' | 'neutral';

export default async function ValidationPage() {
  const user = await requirePermission('admin.view');
  const [overview, units, defaultPeriod] = await Promise.all([getValidationOverview(), listOrgUnits(), defaultPeriodId()]);
  const connected = overview.source.mode === 'DHIS2' && overview.source.url !== null;
  const lastRun = overview.runs[0] ?? null;
  const reconciliation = overview.reconciliation;
  const differences = reconciliation
    ? reconciliation.summary.mismatched + reconciliation.summary.onlyAspire + reconciliation.summary.onlyDhis2
    : null;

  // Outlier detection runs per LGA (see runOutlierCheck), grouped by state.
  const stateName = new Map(units.filter((unit) => unit.level === 'STATE').map((unit) => [unit.id, unit.name]));
  const areas = units
    .filter((unit) => unit.level === 'LGA' && isInScope(user.scope, unit.path))
    .map((unit) => ({ id: unit.id, name: unit.name, group: stateName.get(unit.parentId ?? '') ?? '' }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

  const findings = overview.findings;
  const quality: ReactNode = (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel
        title="By type of problem"
        aside={
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="concern">{findings.bySeverity.HIGH.toLocaleString('en-GB')} high</Badge>
            <Badge tone="warning">{findings.bySeverity.MEDIUM.toLocaleString('en-GB')} medium</Badge>
            <Badge tone="neutral">{findings.bySeverity.LOW.toLocaleString('en-GB')} low</Badge>
          </div>
        }
      >
        <BarList rows={findings.byDimension.map((entry) => ({ label: DIMENSION_LABELS[entry.dimension] ?? entry.dimension, value: entry.count }))} />
      </Panel>
      <Panel title="By level" description="Where in the hierarchy the problems were found.">
        <BarList rows={findings.byLevel.map((entry) => ({ label: LEVEL_LABELS[entry.level] ?? entry.level, value: entry.count }))} />
      </Panel>
      <Panel title="By indicator" description="Indicators with the most open findings.">
        <TableWrap>
          <thead>
            <tr>
              <Th>Indicator</Th>
              <Th align="right">Open</Th>
              <Th align="right">High severity</Th>
            </tr>
          </thead>
          <tbody>
            {findings.byIndicator.map((entry) => (
              <Tr key={entry.indicator}>
                <Td className="py-2.5 text-[13px]">{entry.indicator}</Td>
                <Td align="right" numeric className="py-2.5 text-[13px]">{entry.count.toLocaleString('en-GB')}</Td>
                <Td align="right" numeric className="py-2.5 text-[13px] text-[var(--text-secondary)]">{entry.high.toLocaleString('en-GB')}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>
      <Panel title="By quarter" description="Open findings for each reporting period.">
        <BarList rows={findings.byPeriod.map((entry) => ({ label: entry.periodId, value: entry.count }))} />
        <Link
          href="/intelligence/data-quality"
          className="mt-5 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--brand-600)] hover:underline"
        >
          Review and resolve findings in the data-quality workspace →
        </Link>
      </Panel>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Administration"
        description="Evidence that the figures on this platform can be trusted: how they compare with DHIS2, what the quality checks found, and DHIS2's own validation."
      />
      <AdminNav />

      <section className="mb-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Validation status">
        <StatusTile
          label="Data source"
          tone={connected ? 'positive' : 'neutral'}
          value={connected ? 'DHIS2 connected' : 'Demo data'}
          detail={<span className="font-mono">{overview.source.url?.replace(/^https?:\/\//, '') ?? 'No instance connected'}</span>}
        />
        <StatusTile
          label="Last synchronisation"
          tone={!lastRun ? 'neutral' : lastRun.status === 'SUCCESS' ? 'positive' : lastRun.status === 'FAILED' ? 'concern' : 'neutral'}
          value={lastRun ? relativeAge(lastRun.finishedAt ?? lastRun.startedAt) : 'Never run'}
          detail={
            lastRun ? (
              <>
                {lastRun.status === 'SUCCESS' ? 'Succeeded' : lastRun.status === 'FAILED' ? 'Failed' : 'Running'} ·{' '}
                {lastRun.observations.toLocaleString('en-GB')} values ·{' '}
                <Link href="/admin" className="text-[var(--brand-600)] hover:underline">history</Link>
              </>
            ) : null
          }
        />
        <StatusTile
          label="Agreement with DHIS2"
          tone={differences === null ? 'neutral' : differences === 0 ? 'positive' : 'concern'}
          value={
            reconciliation
              ? `${reconciliation.summary.matched.toLocaleString('en-GB')} of ${reconciliation.summary.compared.toLocaleString('en-GB')} identical`
              : 'Not checked yet'
          }
          detail={reconciliation ? `Checked ${relativeAge(reconciliation.reconciledAt)}` : 'Run the check in Reconciliation'}
        />
        <StatusTile
          label="Reporting completeness"
          tone={overview.reporting.records > 0 ? 'positive' : 'warning'}
          value={overview.reporting.records > 0 ? `${overview.reporting.records.toLocaleString('en-GB')} records` : 'Not available'}
          detail={overview.reporting.records > 0 ? 'Form-submission records held' : 'The source holds no form-submission records'}
        />
      </section>

      <ToolTabs
        tabs={[
          {
            id: 'reconciliation',
            label: 'Reconciliation',
            badge: differences === null ? undefined : differences === 0 ? '✓' : differences,
            hint: "ASPIRE's stored figures compared with the values DHIS2 itself returns, for a fixed sample of indicators, areas at every level from facility to Federal, and two quarters.",
            content: <ReconciliationPanel initial={reconciliation} canRun={connected && can(user.role, 'admin.sync')} />,
          },
          {
            id: 'quality',
            label: 'Quality checks',
            badge: findings.open.toLocaleString('en-GB'),
            hint: `${findings.open.toLocaleString('en-GB')} open findings from the checks ASPIRE runs on every synchronisation. Each is reviewed and resolved in the data-quality workspace.`,
            content: quality,
          },
          {
            id: 'outliers',
            label: 'Outlier detection',
            hint: "DHIS2's own statistical check on raw facility-month values, one LGA at a time. It finds the single facility report that an LGA or state total would hide.",
            content: <OutlierPanel areas={areas} connected={connected} defaultPeriod={defaultPeriod} />,
          },
          {
            id: 'rules',
            label: 'Validation rules',
            hint: "Runs a form's validation rules in DHIS2 for one area and month, such as ANC 4th visits not exceeding total ANC attendance.",
            content: <RuleCheckPanel connected={connected} defaultPeriod={defaultPeriod} />,
          },
        ]}
      />
    </>
  );
}

const TONE_DOT: Record<Tone, string> = {
  positive: 'bg-[var(--status-fill-positive)]',
  warning: 'bg-[var(--status-fill-warning)]',
  concern: 'bg-[var(--status-fill-concern)]',
  neutral: 'bg-[var(--status-fill-none)]',
};

function StatusTile({ label, value, detail, tone }: { label: string; value: string; detail: ReactNode; tone: Tone }) {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
        <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', TONE_DOT[tone])} />
        {label}
      </p>
      <p className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[var(--text-primary)]">{value}</p>
      {detail ? <p className="line-clamp-2 break-words text-[12px] leading-relaxed text-[var(--text-tertiary)]">{detail}</p> : null}
    </Card>
  );
}

function Panel({ title, description, aside, children }: { title: string; description?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h3>
          {description ? <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}

function BarList({ rows }: { rows: Array<{ label: string; value: number }> }) {
  if (rows.length === 0) return <p className="text-[13px] text-[var(--text-tertiary)]">No open findings.</p>;
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-[13px] sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_72px] sm:items-center">
          <span className="truncate text-[var(--text-secondary)]">{row.label}</span>
          <span className="numeric text-right font-medium sm:order-last">{row.value.toLocaleString('en-GB')}</span>
          <span className="col-span-2 h-2 rounded-full bg-[var(--ink-100)] sm:col-span-1">
            <span className="block h-full rounded-full bg-[var(--brand-500)]" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
