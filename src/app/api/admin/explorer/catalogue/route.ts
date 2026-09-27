import { getCatalogue } from '@/services/explorer';
import { ok, withUser } from '@/lib/api';

/** Every indicator and aggregate data element on the connected instance. `?refresh=1` reloads it. */
export const GET = withUser(async (_user, request) => {
  const refresh = new URL(request.url).searchParams.get('refresh') === '1';
  return ok(await getCatalogue({ refresh }));
}, 'admin.view');
