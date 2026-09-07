import type { Metadata } from 'next';
import { requireRoute, resolveScope } from '@/auth/server';
import { can, scopesOverlap } from '@/auth/rbac';
import { getActionViews } from '@/services/actions';
import { listUsers } from '@/data/repositories/users';
import { PageHeader } from '@/design/patterns/PageHeader';
import { ActionBoard } from './ActionBoard';

export const metadata: Metadata = { title: 'Actions' };
export const dynamic = 'force-dynamic';

export default async function ActionsPage() {
  const { user } = await requireRoute('/actions');
  const scope = await resolveScope(user);
  const [actions, users] = await Promise.all([getActionViews(scope.ids), listUsers()]);
  // Only people this user shares geography with. The full directory would tell
  // a state officer who works in the other state, and would let them assign
  // follow-up to someone who cannot open the geography it concerns.
  const assignees = users
    .filter(
      (entry) =>
        entry.active && scopesOverlap(scope.ids, scope.root.path, entry.scope),
    )
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
