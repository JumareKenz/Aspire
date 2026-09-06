import { z } from 'zod';
import { getIndicator, listIndicators, saveIndicator } from '@/data/repositories/registry';
import { upsertTargets } from '@/data/repositories/observations';
import { recordAudit } from '@/data/repositories/audit';
import { ApiError, ok, withUser } from '@/lib/api';

const schema = z.object({
  id: z.string().min(1),
  active: z.boolean().optional(),
  defaultTarget: z.number().finite().optional(),
  /** DHIS2 identifier. Empty string clears the mapping. */
  dx: z.string().nullable().optional(),
});

export const GET = withUser(async () => ok(await listIndicators(true)), 'admin.view');

/**
 * Edits an indicator's configuration.
 *
 * The registry is data, so changing a target or a DHIS2 mapping is a write to
 * this table rather than a code change. Every edit is audited with what changed.
 */
export const PATCH = withUser(async (user, request) => {
  const body = schema.parse(await request.json());
  const indicator = await getIndicator(body.id);
  if (!indicator) throw new ApiError('That indicator is not in the registry.', 404);

  const changes: string[] = [];
  if (body.active !== undefined && body.active !== indicator.active) {
    indicator.active = body.active;
    changes.push(`active=${body.active}`);
  }
  if (body.defaultTarget !== undefined && body.defaultTarget !== indicator.defaultTarget) {
    changes.push(`target ${indicator.defaultTarget}→${body.defaultTarget}`);
    indicator.defaultTarget = body.defaultTarget;
    // The global default target is also a row in `targets`, which is what the
    // scoring engine reads, so both are kept in step.
    await upsertTargets([
      { indicatorId: indicator.id, orgUnitId: null, periodId: null, value: body.defaultTarget },
    ]);
  }
  if (body.dx !== undefined) {
    const next = body.dx === '' ? null : body.dx;
    if (next !== indicator.source.dx) {
      changes.push(`dhis2 mapping ${indicator.source.dx ?? 'none'}→${next ?? 'none'}`);
      indicator.source = { ...indicator.source, dx: next };
    }
  }

  if (changes.length === 0) return ok(indicator);

  await saveIndicator(indicator);
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.indicator_update',
    target: indicator.id,
    detail: changes.join(', '),
  });
  return ok(indicator);
}, 'admin.manage');
