import type { Metadata } from 'next';
import { requireRoute, resolveScope } from '@/auth/server';
import { can } from '@/auth/rbac';
import { getActionAssignees, getActionViews } from '@/services/actions';
import { PageHeader } from '@/design/patterns/PageHeader';
import { ActionBoard } from './ActionBoard';

export const metadata: Metadata = { title: 'Actions' };
export const dynamic = 'force-dynamic';

export default async function ActionsPage() {
  const { user } = await requireRoute('/actions');
  const scope = await resolveScope(user);
  const actions = await getActionViews(scope.ids);
  // Offered per action: the full directory would tell a state officer who works
  // in the other state, and an action can only go to someone who can open it.
  const assignees = await getActionAssignees(actions, scope);

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
