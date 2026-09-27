import { z } from 'zod';
import { listCheckableForms, runRuleCheck } from '@/services/validation';
import { recordAudit } from '@/data/repositories/audit';
import { ok, withUser } from '@/lib/api';

const schema = z.object({
  dataSet: z.string().min(1),
  orgUnit: z.string().min(1),
  period: z.string().min(1),
});

/** The forms whose validation rules can be run. */
export const GET = withUser(async () => ok(await listCheckableForms()), 'admin.view');

/** Runs one form's validation rules for one area and month. */
export const POST = withUser(async (user, request) => {
  const body = schema.parse(await request.json());
  const result = await runRuleCheck(user, body);
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.validation_rules',
    target: body.orgUnit,
    detail: `${body.dataSet} for ${body.period}: ${result.violations.length} violations`,
  });
  return ok(result);
}, 'admin.view');
