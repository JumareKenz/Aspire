import { orgUnitChildren, searchOrgUnits } from '@/services/explorer';
import { ok, withUser } from '@/lib/api';

/** `?parent=<id>` lists an area's children; `?q=<text>` searches; neither lists the top of the user's scope. */
export const GET = withUser(async (user, request) => {
  const params = new URL(request.url).searchParams;
  const text = params.get('q');
  if (text) return ok(await searchOrgUnits(user, text));
  return ok(await orgUnitChildren(user, params.get('parent')));
}, 'admin.view');
