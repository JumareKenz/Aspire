import { ORG_LEVELS, type OrgLevel } from '@/core/model/types';
import { scopedChildren, searchScoped } from '@/services/orgUnitTree';
import { ok, query, withUser } from '@/lib/api';

/**
 * The geography selector's tree. `?parent=<id>` lists a unit's children;
 * `?q=<text>[&level=LGA]` searches; neither returns the top of the user's
 * access. Scope and depth are enforced in the service, never in the browser.
 */
export const GET = withUser(async (user, request) => {
  const params = query(request);
  const text = params.get('q');
  if (text) {
    const level = params.get('level');
    return ok(
      await searchScoped(user, text, level && (ORG_LEVELS as string[]).includes(level) ? (level as OrgLevel) : undefined),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  return ok(await scopedChildren(user, params.get('parent')), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
