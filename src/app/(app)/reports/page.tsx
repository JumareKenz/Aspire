import type { Metadata } from 'next';
import Link from 'next/link';
import { resolvePageContext, type SearchParams } from '@/services/context';
import { REPORT_META, REPORT_TYPES } from '@/services/reports';
import { PageHeader } from '@/design/patterns/PageHeader';
import { ScopeBar } from '@/design/patterns/ScopeBar';
import { Card } from '@/design/primitives/Card';
import { getDataMode } from '@/data/repositories/settings';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await resolvePageContext(await searchParams);
  const mode = getDataMode();

  return (
    <>
      <PageHeader
        title="Reports"
        description="Generated from stored reporting for the selected geography and period. Nothing is written ahead of the data."
        controls={
          <ScopeBar
            orgUnits={context.orgUnitOptions}
            periods={context.periodOptions}
            orgUnitId={context.orgUnit.id}
            periodId={context.periodId}
          />
        }
      />

      {mode === 'DEMO' ? (
        <p className="mb-5 rounded-[var(--radius-md)] border border-[var(--warning-600)]/30 bg-[var(--warning-100)]/40 px-4 py-2.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          Reports generated now will carry a demo-data notice on every page, because the platform is not
          connected to a DHIS2 instance. They are suitable for review of the format, not for distribution as
          government reporting.
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {REPORT_TYPES.map((type) => {
          const meta = REPORT_META[type];
          const href = `/reports/view?type=${type}&orgUnit=${context.orgUnit.id}&period=${context.periodId}`;
          return (
            <Card key={type} className="flex flex-col p-4">
              <h2 className="text-[13px] font-semibold">{meta.title}</h2>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                {meta.description}
              </p>
              <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">For: {meta.audience}</p>
              <div className="mt-auto flex items-center gap-3 pt-4">
                <Link
                  href={href}
                  className="inline-flex h-8 items-center rounded-[var(--radius-md)] bg-[var(--brand-600)] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[var(--brand-700)]"
                >
                  Generate
                </Link>
                <a
                  href={`/api/reports/export?type=${type}&orgUnit=${context.orgUnit.id}&period=${context.periodId}`}
                  className="text-[12px] text-[var(--brand-600)] hover:underline"
                >
                  Download CSV
                </a>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
