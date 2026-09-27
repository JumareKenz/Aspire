import type { Metadata } from 'next';
import { requirePermission } from '@/auth/server';
import { PageHeader } from '@/design/patterns/PageHeader';
import { EmptyState } from '@/design/primitives/States';
import { Card } from '@/design/primitives/Card';
import { isExplorerAvailable } from '@/services/explorer';
import { readDhis2Config } from '@/data/sources/dhis2/client';
import { AdminNav } from '../AdminNav';
import { Explorer } from './Explorer';

export const metadata: Metadata = { title: 'Data explorer' };
export const dynamic = 'force-dynamic';

export default async function ExplorerPage() {
  await requirePermission('admin.view');
  const available = isExplorerAvailable();

  return (
    <>
      <PageHeader
        title="Administration"
        description="Query the connected DHIS2 instance directly: any indicator or data element, for any period and any area in your access."
      />
      <AdminNav />
      {available ? (
        <Explorer source={readDhis2Config()!.baseUrl} />
      ) : (
        <Card className="p-4">
          <EmptyState
            title="No DHIS2 instance is connected."
            description="The explorer reads from DHIS2 directly. Set DHIS2_BASE_URL and DHIS2_TOKEN, then run a synchronisation."
          />
        </Card>
      )}
    </>
  );
}
