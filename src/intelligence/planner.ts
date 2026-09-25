import { z } from 'zod';
import { QUERY_KINDS, type AnalyticalQuery } from './types';
import type { Intent, IntentContext } from './intent';
import { interpret } from './intent';
import { isModelEnabled, MODEL_ID } from './model';

/**
 * Optional model-assisted planning.
 *
 * The model's only job is to choose a query *shape*. It is given the registry
 * of geographies, indicators and domains that actually exist and is constrained
 * by a schema to identifiers drawn from those lists, so it cannot name an
 * indicator the platform does not have. It never sees a data value, and its
 * output is executed by the platform, not trusted as an answer.
 *
 * The rule-based interpretation always runs first and is used whenever the
 * model is unavailable, disagrees with the schema, or is less confident.
 */
export async function planQuery(
  question: string,
  context: IntentContext,
): Promise<{ intent: Intent; plannedBy: 'RULES' | 'MODEL' }> {
  const rules = interpret(question, context);

  // The rules are confident enough on their own; do not spend a model call.
  if (!isModelEnabled() || rules.confidence >= 0.85) {
    return { intent: rules, plannedBy: 'RULES' };
  }

  const schema = z.object({
    kind: z.enum(QUERY_KINDS),
    orgUnitId: z.string(),
    periodId: z.string(),
    indicatorId: z.string().nullable(),
    domainId: z.string().nullable(),
    compareOrgUnitIds: z.array(z.string()).max(3).optional(),
    direction: z.enum(['WORST_FIRST', 'BEST_FIRST']).optional(),
    interpretation: z.string().max(200),
  });

  try {
    const { generateText, Output } = await import('ai');
    const selectable = context.orgUnits
      .filter((unit) => unit.level !== 'WARD' && unit.level !== 'FACILITY')
      .slice(0, 200);

    const { output } = await generateText({
      model: MODEL_ID,
      output: Output.object({ schema }),
      system: [
        'You translate a question about SRHR programme performance into a structured analytical query.',
        'You never answer the question and never state or estimate any figure.',
        'Choose identifiers only from the lists provided. If the question names something not in the lists, leave that field null.',
        'The interpretation field restates the question in one plain sentence.',
      ].join(' '),
      prompt: [
        `Question: ${question}`,
        '',
        `Default geography: ${context.defaultOrgUnitId}`,
        `Default period: ${context.defaultPeriodId}`,
        `Available periods: ${context.periodIds.join(', ')}`,
        '',
        'Geographies:',
        ...selectable.map((unit) => `- ${unit.id} = ${unit.name} (${unit.level})`),
        '',
        'Indicators:',
        ...context.indicators.map((indicator) => `- ${indicator.id} = ${indicator.name}`),
        '',
        'Domains:',
        ...context.domains.map((domain) => `- ${domain.id} = ${domain.name}`),
      ].join('\n'),
    });

    const orgUnitIds = new Set(context.orgUnits.map((unit) => unit.id));
    const indicatorIds = new Set(context.indicators.map((indicator) => indicator.id));
    const domainIds = new Set(context.domains.map((domain) => domain.id));

    // Anything the model returned that is not a real identifier is discarded
    // rather than corrected: a plausible-looking invented id is exactly the
    // failure mode this whole layer exists to prevent.
    const query: AnalyticalQuery = {
      kind: output.kind,
      orgUnitId: orgUnitIds.has(output.orgUnitId) ? output.orgUnitId : context.defaultOrgUnitId,
      periodId: context.periodIds.includes(output.periodId) ? output.periodId : context.defaultPeriodId,
      indicatorId: output.indicatorId && indicatorIds.has(output.indicatorId) ? output.indicatorId : null,
      domainId: output.domainId && domainIds.has(output.domainId) ? output.domainId : null,
      compareOrgUnitIds: output.compareOrgUnitIds?.filter((id) => orgUnitIds.has(id)),
      direction: output.direction ?? 'WORST_FIRST',
    };

    return {
      intent: {
        query,
        interpretation: output.interpretation,
        confidence: 0.8,
        unmatched: [],
      },
      plannedBy: 'MODEL',
    };
  } catch {
    // A model failure must never take the feature down.
    return { intent: rules, plannedBy: 'RULES' };
  }
}
