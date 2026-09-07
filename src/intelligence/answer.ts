import { listDomains, listIndicators } from '@/data/repositories/registry';
import { listOrgUnits } from '@/data/repositories/orgUnits';
import { isInScope } from '@/auth/rbac';
import { experienceFor, permittedLevels } from '@/auth/experience';
import type { User } from '@/data/repositories/users';
import { analysisPeriods } from '@/data/sync/periods';
import { recordAudit } from '@/data/repositories/audit';
import type { Answer } from './types';
import type { IntentContext } from './intent';
import { planQuery } from './planner';
import { executeQuery } from './execute';
import { validateResult, isPresentable } from './validate';
import { narrate } from './narrate';
import { explain } from './explain';

/**
 * The governed pipeline, end to end.
 *
 *   question
 *     → intent (rules, optionally refined by a model)
 *     → structured query, restricted to this user's scope
 *     → executed against stored data by the platform's own engines
 *     → validated
 *     → explained
 *
 * The model, where used, never touches steps three or four. Every figure in an
 * answer came out of the same code that renders the scorecards.
 */
export async function answerQuestion(
  question: string,
  user: User,
  defaults: { orgUnitId: string; periodId: string },
): Promise<Answer> {
  const trimmed = question.trim();
  if (trimmed.length === 0) {
    return {
      question,
      result: null,
      sections: [{ heading: null, body: 'Ask a question about performance, change, risk or data quality.' }],
      interpretation: '',
      plannedBy: 'RULES',
      writtenBy: 'TEMPLATE',
      declined: true,
    };
  }

  const periods = analysisPeriods();
  // Scope is applied to the planner's inputs, not just to its output: the model
  // is never shown the name of a geography this user may not see.
  const [allUnits, indicators, domains] = await Promise.all([
    listOrgUnits(),
    listIndicators(),
    listDomains(),
  ]);

  // Authorisation happens here — before any query is planned or executed, and
  // long before an answer exists. The planner is shown only the geographies
  // this user may read, filtered by both scope and depth, so it cannot name a
  // place it should not and there is nothing to redact afterwards.
  const experience = experienceFor(user);
  const levels = permittedLevels(experience);
  const orgUnits = allUnits.filter(
    (unit) => isInScope(user.scope, unit.path) && levels.includes(unit.level),
  );
  // A question that names a geography the user cannot read is refused outright.
  // Silently substituting their own scope would answer a different question
  // than the one asked and present it as the answer — a state officer asking
  // "how does Sokoto compare with Bauchi" must be told they cannot see Sokoto,
  // not handed Bauchi's figures under Sokoto's question.
  const outOfScope = namedButUnreadable(trimmed, allUnits, orgUnits);
  if (outOfScope.length > 0) {
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'intelligence.refused',
      target: outOfScope.join(','),
      detail: trimmed.slice(0, 500),
    });
    return {
      question: trimmed,
      result: null,
      sections: [
        {
          heading: null,
          body: `Your access covers ${describeScope(orgUnits)}, so I cannot answer a question about ${formatList(outOfScope)}. Ask about a geography within your access, or ask an administrator to widen it.`,
        },
      ],
      interpretation: '',
      plannedBy: 'RULES',
      writtenBy: 'TEMPLATE',
      declined: true,
    };
  }

  const context: IntentContext = {
    orgUnits,
    indicators,
    domains,
    defaultOrgUnitId: defaults.orgUnitId,
    defaultPeriodId: defaults.periodId,
    periodIds: periods.map((period) => period.id),
  };

  const { intent, plannedBy } = await planQuery(trimmed, context);

  // The planner's output is re-checked against the same permitted set. A model
  // is not trusted to have respected the list it was given.
  const permitted = orgUnits.some((unit) => unit.id === intent.query.orgUnitId);
  if (!permitted) {
    intent.query.orgUnitId = defaults.orgUnitId;
  }
  if (intent.query.compareOrgUnitIds) {
    intent.query.compareOrgUnitIds = intent.query.compareOrgUnitIds.filter((id) =>
      orgUnits.some((unit) => unit.id === id),
    );
  }

  const result = await executeQuery(intent.query, { permittedOrgUnitIds: new Set(orgUnits.map((u) => u.id)) });
  const issues = validateResult(result);

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'intelligence.question',
    target: `${intent.query.kind}:${intent.query.orgUnitId}:${intent.query.periodId}`,
    detail: trimmed.slice(0, 500),
  });

  if (!isPresentable(issues)) {
    // A failed verification is a defect in the analysis, so it is logged for
    // operators rather than only shown to the user as an apology.
    console.error('[intelligence] result failed verification', {
      query: intent.query,
      issues,
    });
    return {
      question: trimmed,
      result: null,
      sections: [
        {
          heading: null,
          body: 'I could not verify the figures for that question, so I am not going to answer it. This is a fault in the analysis rather than in the question — please report it.',
        },
      ],
      interpretation: intent.interpretation,
      plannedBy,
      writtenBy: 'TEMPLATE',
      declined: true,
    };
  }

  // Nothing found is a real answer and is stated plainly, not padded out.
  if (result.findings.length === 0 && result.rows.length === 0) {
    return {
      question: trimmed,
      result,
      sections: explain(result),
      interpretation: intent.interpretation,
      plannedBy,
      writtenBy: 'TEMPLATE',
      declined: result.href === null,
    };
  }

  const { sections, writtenBy } = await narrate(trimmed, result);
  const warnings = issues.filter((issue) => issue.severity === 'WARNING');

  return {
    question: trimmed,
    result,
    sections:
      warnings.length > 0
        ? [
            ...sections,
            {
              heading: 'Verification',
              body: `${warnings.length} figure(s) in this answer could not be matched to their evidence and should be checked against the table below.`,
            },
          ]
        : sections,
    interpretation: intent.interpretation,
    plannedBy,
    writtenBy,
    declined: false,
  };
}

/**
 * Prompts for the executive tier: position, movement and risk, not causation
 * mechanics or reporting hygiene.
 */
export const EXECUTIVE_QUESTIONS = [
  'How are we performing this quarter?',
  'What changed this quarter?',
  'Which areas need attention?',
  'Where are the biggest SRHR risks?',
  'Which areas improved most?',
  'Generate an executive summary.',
];

export const SUGGESTED_QUESTIONS = [
  'Which areas are performing below target?',
  'What changed this quarter?',
  'Why is performance declining?',
  'Which areas improved most?',
  'Where are the biggest SRHR risks?',
  'Which areas have unusual reporting patterns?',
  'How is adolescent family planning uptake doing?',
  'Generate an executive summary.',
];

/**
 * Names of geographies the question mentions that this user may not read.
 *
 * Matching is on whole words so that "Bauchi" does not match inside another
 * word, and state names are checked with and without the "State" suffix
 * because people write both. Only STATE and LGA names are considered:
 * facility names are constructed from their LGA and would produce noise.
 *
 * Short names are matched too. Isa is a real LGA of Sokoto and dropping
 * three-letter names — as an earlier version did — meant "how is Isa
 * performing?" from a Bauchi officer was silently answered about Bauchi. The
 * risk this creates is the opposite one: a place name that is also an ordinary
 * English word would refuse a question that never mentioned the place. The
 * stop list below carries the words that actually collide with names in the
 * configured hierarchy; a new geography whose name is an English word must be
 * added to it.
 */
const NAME_STOPWORDS = new Set(['data', 'care', 'state', 'north', 'south', 'east', 'west']);
function namedButUnreadable(
  question: string,
  allUnits: Array<{ id: string; name: string; level: string }>,
  permitted: Array<{ id: string }>,
): string[] {
  const allowed = new Set(permitted.map((unit) => unit.id));
  const haystack = ` ${question.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const named: string[] = [];
  for (const unit of allUnits) {
    if (allowed.has(unit.id)) continue;
    if (unit.level !== 'STATE' && unit.level !== 'LGA') continue;
    const bare = unit.name.replace(/ State$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (bare.length < 3 || NAME_STOPWORDS.has(bare)) continue;
    if (haystack.includes(` ${bare} `)) named.push(unit.name);
  }
  return [...new Set(named)];
}

function describeScope(orgUnits: Array<{ name: string; level: string }>): string {
  const states = orgUnits.filter((unit) => unit.level === 'STATE').map((unit) => unit.name);
  if (states.length === 0) return 'the geographies assigned to you';
  return formatList(states);
}

function formatList(values: string[]): string {
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}
