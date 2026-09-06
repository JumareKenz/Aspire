import type { Metadata } from 'next';
import { requirePermission } from '@/auth/server';
import { listAudit } from '@/data/repositories/audit';
import { PageHeader } from '@/design/patterns/PageHeader';
import { Card } from '@/design/primitives/Card';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { EmptyState } from '@/design/primitives/States';
import { AdminNav } from '../AdminNav';

export const metadata: Metadata = { title: 'Audit' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  await requirePermission('admin.view');
  const entries = await listAudit(200);

  return (
    <>
      <PageHeader
        title="Administration"
        description="Sign-ins, configuration changes, synchronisation, report generation and every question asked of the Intelligence workspace."
      />
      <AdminNav />

      <Card className="px-2 py-1">
        {entries.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing has been recorded yet." />
          </div>
        ) : (
          <div className="p-3">
            <TableWrap>
              <thead>
                <tr>
                  <Th width="16%">When</Th>
                  <Th width="18%">Who</Th>
                  <Th width="18%">Action</Th>
                  <Th width="18%">Target</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <Tr key={entry.id}>
                    <Td className="numeric text-[12px] text-[var(--text-secondary)]">
                      {new Date(entry.at).toLocaleString('en-GB')}
                    </Td>
                    <Td className="text-[12px]">{entry.actorEmail ?? 'system'}</Td>
                    <Td className="text-[12px] font-medium">{entry.action}</Td>
                    <Td className="text-[12px] text-[var(--text-tertiary)]">{entry.target ?? '—'}</Td>
                    <Td className="text-[12px] text-[var(--text-tertiary)]">{entry.detail ?? '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Card>
    </>
  );
}
