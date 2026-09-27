import { buildQualityWorkbook } from '@/services/qualityExport';
import { recordAudit } from '@/data/repositories/audit';
import { withUser } from '@/lib/api';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Every open data quality finding as an Excel workbook, built fresh from the store. */
export const GET = withUser(async (user) => {
  const { buffer, filename, findings } = await buildQualityWorkbook();
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.quality_export',
    detail: `Exported ${findings.toLocaleString('en-GB')} open findings`,
  });
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}, 'admin.view');
