import { z } from 'zod';
import { answerQuestion } from '@/intelligence/answer';
import { resolveScope } from '@/auth/server';
import { latestCompletePeriodId } from '@/data/sync/periods';
import { ok, withUser } from '@/lib/api';

const schema = z.object({
  question: z.string().min(1).max(500),
  orgUnitId: z.string().optional(),
  periodId: z.string().optional(),
});

/**
 * Answers a natural-language question through the governed pipeline.
 *
 * The question is audited, the scope is taken from the signed-in user rather
 * than from the request, and the answer carries its own evidence.
 */
export const POST = withUser(async (user, request) => {
  const body = schema.parse(await request.json());
  const scope = await resolveScope(user);

  const answer = await answerQuestion(body.question, user, {
    orgUnitId:
      body.orgUnitId && scope.ids.includes(body.orgUnitId) ? body.orgUnitId : scope.root.id,
    periodId: body.periodId ?? latestCompletePeriodId(),
  });

  return ok(answer);
}, 'intelligence.ask');
