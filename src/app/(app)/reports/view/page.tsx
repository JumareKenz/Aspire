import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertOrgUnitInScope, requireUser } from '@/auth/server';
import { generateReport, REPORT_TYPES, type ReportType } from '@/services/reports';
import { reportTypesFor } from '@/auth/experience';
import { accessibleStates } from '@/services/states';
import { latestCompletePeriodId } from '@/data/sync/periods';
import { recordAudit } from '@/data/repositories/audit';
import type { SearchParams } from '@/services/context';
import { PrintButton } from './PrintButton';

export const metadata: Metadata = { title: 'Report' };
export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportViewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requireUser();

  const type = first(params.type) as ReportType | undefined;
  const orgUnitId = first(params.orgUnit);
  const periodId = first(params.period) ?? latestCompletePeriodId();
  if (!type || !REPORT_TYPES.includes(type) || !orgUnitId) notFound();
  const permittedTypes = reportTypesFor(user, (await accessibleStates(user)).length);
  if (!permittedTypes.includes(type)) notFound();

  await assertOrgUnitInScope(user, orgUnitId);
  const report = await generateReport(type, orgUnitId, periodId);
  if (!report) notFound();

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'reports.generate',
    target: `${type}:${orgUnitId}:${periodId}`,
  });

  const generated = new Date(report.generatedAt).toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <div className="mx-auto max-w-[840px]">
      <div className="no-print mb-5 flex items-center justify-between gap-4">
        <Link href="/reports" className="text-[12px] text-[var(--brand-600)] hover:underline">
          ← All reports
        </Link>
        <div className="flex items-center gap-3">
          <a
            href={`/api/reports/export?type=${type}&orgUnit=${orgUnitId}&period=${periodId}`}
            className="text-[12px] text-[var(--brand-600)] hover:underline"
          >
            Download CSV
          </a>
          <PrintButton />
        </div>
      </div>

      <article className="rounded-[var(--radius-lg)] border bg-[var(--surface)] px-8 py-8 shadow-[var(--shadow-sm)] print:border-0 print:shadow-none">
        <header className="mb-6 border-b pb-5">
          {report.provenance.mode === 'DEMO' ? (
            <p className="mb-3 rounded border border-[var(--warning-600)]/40 bg-[var(--warning-100)]/50 px-3 py-1.5 text-[11px] font-medium">
              DEMO DATA — synthetic figures generated for demonstration. This document is not government
              reporting.
            </p>
          ) : null}
          <p className="text-[11px] tracking-wide text-[var(--text-tertiary)]">
            ASPIRE-GAC SRHR Intelligence
          </p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.018em]">{report.title}</h1>
          <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
            {report.orgUnitName} · {report.periodLabel}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-[var(--text-tertiary)] sm:grid-cols-3">
            <div>
              <dt className="inline">Generated: </dt>
              <dd className="inline">{generated}</dd>
            </div>
            <div>
              <dt className="inline">Source: </dt>
              <dd className="inline">{report.provenance.sourceLabel}</dd>
            </div>
            <div>
              <dt className="inline">Methodology: </dt>
              <dd className="inline">
                {report.provenance.methodologyVersion}
                {report.provenance.methodologyStatus === 'PROVISIONAL' ? ' (provisional)' : ''}
              </dd>
            </div>
          </dl>
        </header>

        {report.sections.map((section) => (
          <section key={section.heading} className="mb-7 break-inside-avoid">
            <h2 className="mb-2 text-[15px] font-semibold tracking-[-0.011em]">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mb-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {paragraph}
              </p>
            ))}
            {section.table ? (
              <figure className="mt-3">
                <figcaption className="mb-1.5 text-[11px] text-[var(--text-tertiary)]">
                  {section.table.caption}
                </figcaption>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr>
                        {section.table.columns.map((column) => (
                          <th
                            key={column}
                            scope="col"
                            className="border-b px-2 py-1.5 text-left text-[11px] font-medium text-[var(--text-tertiary)]"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.table.rows.map((row, index) => (
                        <tr key={index}>
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className={`border-b border-[var(--border)]/60 px-2 py-1.5 ${
                                typeof cell === 'number' ? 'numeric text-right' : ''
                              }`}
                            >
                              {cell === null ? '—' : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </figure>
            ) : null}
          </section>
        ))}

        <footer className="mt-8 border-t pt-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          <p>
            All figures were computed from stored reporting by the platform’s analytical engine using
            methodology {report.provenance.methodologyVersion}. Performance and data confidence are separate
            measures and should be read together.
          </p>
          {report.provenance.lastSyncAt ? (
            <p className="mt-1">
              Underlying data last synchronised{' '}
              {new Date(report.provenance.lastSyncAt).toLocaleString('en-GB')}.
            </p>
          ) : null}
        </footer>
      </article>
    </div>
  );
}
