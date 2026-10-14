import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission, resolveScope } from '@/auth/server';
import { can } from '@/auth/rbac';
import { listIndicators, getActiveMethodology, listDomains } from '@/data/repositories/registry';
import { listProvenance } from '@/data/repositories/nhmis';
import { getDataMode } from '@/data/repositories/settings';
import { analysisMonths, analysisPeriods } from '@/data/sync/periods';
import { getDataElementCatalogue } from '@/services/dataElements';
import { PageHeader } from '@/design/patterns/PageHeader';
import { Card } from '@/design/primitives/Card';
import { cn } from '@/design/primitives/cn';
import type { SearchParams } from '@/services/context';
import { AdminNav } from '../AdminNav';
import { IndicatorEditor } from './IndicatorEditor';
import { DataElementTable } from './DataElementTable';

export const metadata: Metadata = { title: 'Indicators' };
export const dynamic = 'force-dynamic';

export default async function IndicatorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission('admin.view');
  const tab = (await searchParams).tab === 'data-elements' ? 'data-elements' : 'indicators';
  const canManage = can(user.role, 'admin.manage');
  const [indicators, methodology, provenance, catalogue, domains, mode, scope] = await Promise.all([
    listIndicators(true),
    getActiveMethodology(),
    listProvenance(),
    getDataElementCatalogue({ all: true }),
    listDomains(),
    getDataMode(),
    resolveScope(user),
  ]);
  const verified = indicators.filter((indicator) => {
    const status = provenance.get(indicator.id)?.status;
    return status === 'VERIFIED' || status === 'APPROVED_EXCEPTION' || status === 'DEMO';
  }).length;

  // Areas a target can be set for: the administrator's own scope, to LGA level.
  const areas = scope.units
    .filter((unit) => unit.level === 'COUNTRY' || unit.level === 'STATE' || unit.level === 'LGA')
    .sort((a, b) => a.path.length - b.path.length || a.name.localeCompare(b.name))
    .map((unit) => ({ id: unit.id, name: unit.name, level: unit.level }));
  const periods = [...analysisPeriods(), ...analysisMonths()]
    .reverse()
    .map((period) => ({ id: period.id, label: period.label, type: period.type }));

  const tabs = [
    { id: 'indicators', label: 'Indicators', count: indicators.length, href: '/admin/indicators' },
    { id: 'data-elements', label: 'Data elements', count: catalogue.inScope, href: '/admin/indicators?tab=data-elements' },
  ];

  return (
    <>
      <PageHeader
        title="Administration"
        description={`${indicators.length} indicators in the registry, ${verified} verified for reporting, scored with ${methodology.version}. Targets, mappings and data element configuration are configuration, not code.`}
      />
      <AdminNav />
      <nav aria-label="Registry" className="mb-4 flex gap-1">
        {tabs.map((entry) => (
          <Link
            key={entry.id}
            href={entry.href}
            aria-current={tab === entry.id ? 'page' : undefined}
            className={cn(
              'rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === entry.id
                ? 'bg-[var(--brand-050)] text-[var(--brand-700)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-secondary)]',
            )}
          >
            {entry.label}
            <span className="numeric ml-1.5 text-[11px] font-normal text-[var(--text-tertiary)]">{entry.count}</span>
          </Link>
        ))}
      </nav>
      <Card className="px-2 py-1">
        <div className="p-3">
          {tab === 'indicators' ? (
            <IndicatorEditor
              indicators={indicators}
              provenance={Object.fromEntries(provenance)}
              domains={domains.map(({ id, name }) => ({ id, name }))}
              canManage={canManage}
              globalScope={user.scope.length === 0}
              areas={areas}
              periods={periods}
              mode={mode}
            />
          ) : (
            <DataElementTable catalogue={catalogue} canManage={canManage} />
          )}
        </div>
      </Card>
    </>
  );
}
