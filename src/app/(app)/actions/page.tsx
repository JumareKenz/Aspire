import type { Metadata } from 'next';
import { requireUser, resolveScope } from '@/auth/server';
import { can } from '@/auth/rbac';
import { getActionViews } from '@/services/actions';
import { listUsers } from '@/data/repositories/users';
import { PageHeader } from '@/design/patterns/PageHeader';
import { ActionBoard } from './ActionBoard';

export const metadata: Metadata = { title: 'Actions' };
export const dynamic = 'force-dynamic';

export default async function ActionsPage() {
  const user = await requireUser();
  const scope = await resolveScope(user);
  const [actions, users] = await Promise.all([getActionViews(scope.ids), listUsers()]);
  const assignees = users
    .filter((entry) => entry.active)
    .map((entry) => ({ id: entry.id, name: entry.name }));

  const open = actions.filter((action) => action.status !== 'RESOLVED' && action.status !== 'CLOSED');

  return (
    <>
      <PageHeader
        title="Actions"
        description={`Follow-up raised from insights, recommendations and data-quality findings. ${open.length} open.`}
      />
      <ActionBoard actions={actions} canManage={can(user.role, 'actions.manage')} assignees={assignees} />
    </>
  );
}
