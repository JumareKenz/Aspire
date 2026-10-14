import { z } from 'zod';
import { getDataElementCatalogue } from '@/services/dataElements';
import { listCatalogue, saveDataElementConfig } from '@/data/repositories/nhmis';
import { listDomains } from '@/data/repositories/registry';
import { recordAudit } from '@/data/repositories/audit';
import { ApiError, ok, query, withUser } from '@/lib/api';

export const GET = withUser(
  async (_user, request) => ok(await getDataElementCatalogue({ all: query(request).get('all') === '1' })),
  'admin.view',
);

const schema = z.object({
  id: z.string().min(1),
  domainId: z.string().min(1).nullable(),
  active: z.boolean(),
});

/**
 * Platform configuration for one data element: the domain it is reported
 * under, and whether it is included. Only elements on an approved NHMIS form
 * can be configured; the source metadata itself is never edited here.
 */
export const PATCH = withUser(async (user, request) => {
  const body = schema.parse(await request.json());
  const element = (await listCatalogue()).find((entry) => entry.id === body.id);
  if (!element) throw new ApiError('That data element is not on an approved NHMIS form.', 404);
  if (body.domainId && !(await listDomains()).some((domain) => domain.id === body.domainId)) {
    throw new ApiError('That domain does not exist.', 422);
  }
  await saveDataElementConfig(body.id, { domainId: body.domainId, active: body.active }, user.email);
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.data_element_update',
    target: body.id,
    detail: `${element.name}: domain ${element.config?.domainId ?? 'derived'}→${body.domainId ?? 'derived'}, ${body.active ? 'included' : 'excluded'}`,
  });
  return ok(await getDataElementCatalogue());
}, 'admin.manage');
