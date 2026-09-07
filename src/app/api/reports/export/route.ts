import { assertOrgUnitInScope } from '@/auth/server';
import { generateReport, REPORT_TYPES, type ReportType } from '@/services/reports';
import { recordAudit } from '@/data/repositories/audit';
import { latestCompletePeriodId } from '@/data/sync/periods';
import { ApiError, query, withUser } from '@/lib/api';
import { experienceFor } from '@/auth/experience';

/** RFC 4180 quoting, so commas and quotes inside area names survive. */
function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV export of a report's tables.
 *
 * Tabular data leaves as CSV because that is what it will be used for — pasted
 * into a spreadsheet or a submission. The formatted narrative version is
 * printed from the report view.
 */
export const GET = withUser(async (user, request) => {
  const params = query(request);
  const type = params.get('type') as ReportType | null;
  const orgUnitId = params.get('orgUnit');
  const periodId = params.get('period') ?? latestCompletePeriodId();

  if (!type || !REPORT_TYPES.includes(type)) throw new ApiError('Unknown report type.', 400);
  if (!orgUnitId) throw new ApiError('orgUnit is required.', 400);
  // Report type is part of the experience, not a UI filter: an executive
  // cannot export the operational reports by guessing the query parameter.
  if (!experienceFor(user).reportTypes.includes(type)) {
    throw new ApiError('That report is not part of your access.', 403);
  }
  await assertOrgUnitInScope(user, orgUnitId);

  const report = await generateReport(type, orgUnitId, periodId);
  if (!report) throw new ApiError('There is no stored reporting for that geography and period.', 404);

  const lines: string[] = [
    `# ${report.title}`,
    `# ${report.orgUnitName} — ${report.periodLabel}`,
    `# Generated ${report.generatedAt}`,
    `# Source: ${report.provenance.sourceLabel}${report.provenance.mode === 'DEMO' ? ' (DEMO DATA — synthetic, not government reporting)' : ''}`,
    `# Methodology: ${report.provenance.methodologyVersion}${report.provenance.methodologyStatus === 'PROVISIONAL' ? ' (provisional)' : ''}`,
    '',
  ];

  for (const section of report.sections) {
    if (!section.table) continue;
    lines.push(`# ${section.table.caption}`);
    lines.push(section.table.columns.map(csvCell).join(','));
    for (const row of section.table.rows) lines.push(row.map(csvCell).join(','));
    lines.push('');
  }

  if (lines.length <= 6) {
    lines.push('# This report contains no tabular data. Use the report view for its narrative sections.');
  }

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'reports.export',
    target: `${type}:${orgUnitId}:${periodId}`,
    detail: 'CSV',
  });

  const filename = `aspire-${type.toLowerCase().replace(/_/g, '-')}-${orgUnitId}-${periodId}.csv`;
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}, 'reports.generate');
