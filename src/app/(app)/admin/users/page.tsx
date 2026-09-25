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
  const [users, orgUnits] = await Promise.all([listUsers(), listOrgUnits()]);
  // Wards and facilities are excluded — a scope of one ward or facility is not
  // a role anyone holds, and thousands more checkboxes would bury the levels
  // that matter. The
  // parent is carried through so the picker can group LGAs under their state;
  // a flat list of 43 LGAs from two states gives an administrator no way to
  // tell which state an LGA belongs to.
  const scopeChoices = orgUnits
    .filter((unit) => unit.level !== 'WARD' && unit.level !== 'FACILITY')
    .map((unit) => ({
      id: unit.id,
      name: unit.name,
      level: unit.level,
      parentId: unit.parentId,
    }));

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
