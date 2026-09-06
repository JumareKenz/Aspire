import { getSourceAdapter, isDhis2Configured } from '@/data/sources';
import { ok, withUser } from '@/lib/api';

/**
 * Tests the configured data source. Returns only the outcome and, where the
 * source reports one, its version — never the credentials used to reach it.
 */
export const GET = withUser(async () => {
  const adapter = getSourceAdapter();
  const result = await adapter.testConnection();
  return ok({
    mode: adapter.mode,
    label: adapter.label,
    configured: isDhis2Configured(),
    ...result,
  });
}, 'admin.view');
