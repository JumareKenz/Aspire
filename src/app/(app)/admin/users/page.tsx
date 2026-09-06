import type { Metadata } from 'next';
import { requirePermission } from '@/auth/server';
import { can } from '@/auth/rbac';
import { listUsers } from '@/data/repositories/users';
import { listOrgUnits } from '@/data/repositories/orgUnits';
import { PageHeader } from '@/design/patterns/PageHeader';
import { Card } from '@/design/primitives/Card';
import { AdminNav } from '../AdminNav';
import { UserManager } from './UserManager';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const user = await requirePermission('admin.view');
  const users = listUsers();
  const scopeChoices = listOrgUnits()
    .filter((unit) => unit.level !== 'FACILITY')
    .map((unit) => ({ id: unit.id, name: unit.name, level: unit.level }));

  return (
    <>
      <PageHeader
        title="Administration"
        description="Accounts, roles and geographic scope. Programme, LGA, M&E and technical users share one workspace and are separated by scope, not by a different product."
      />
      <AdminNav />
      <Card className="px-2 py-1">
        <div className="p-3">
          <UserManager
            users={users}
            scopeChoices={scopeChoices}
            currentUserId={user.id}
            canManage={can(user.role, 'admin.manage')}
          />
        </div>
      </Card>
    </>
  );
}
