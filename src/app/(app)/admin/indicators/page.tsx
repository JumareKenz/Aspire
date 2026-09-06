import type { Metadata } from 'next';
import { requirePermission } from '@/auth/server';
import { can } from '@/auth/rbac';
import { listIndicators, getActiveMethodology } from '@/data/repositories/registry';
import { PageHeader } from '@/design/patterns/PageHeader';
import { Card } from '@/design/primitives/Card';
import { AdminNav } from '../AdminNav';
import { IndicatorEditor } from './IndicatorEditor';

export const metadata: Metadata = { title: 'Indicators' };
export const dynamic = 'force-dynamic';

export default async function IndicatorsPage() {
  const user = await requirePermission('admin.view');
  const indicators = listIndicators(true);
  const methodology = getActiveMethodology();

  return (
    <>
      <PageHeader
        title="Administration"
        description={`${indicators.length} indicators in the registry, scored with ${methodology.version}. Targets and DHIS2 mappings are configuration, not code.`}
      />
      <AdminNav />
      <Card className="px-2 py-1">
        <div className="p-3">
          <IndicatorEditor indicators={indicators} canManage={can(user.role, 'admin.manage')} />
        </div>
      </Card>
    </>
  );
}
