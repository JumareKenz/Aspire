import type { AnalyticalResult, AnswerSection } from './types';
import { explain } from './explain';
import { isModelEnabled, MODEL_ID } from './model';

/**
 * Optional model-written prose.
 *
 * The model receives the validated findings and nothing else — no observations,
 * no database access, no arithmetic to perform. It is asked to phrase what has
 * already been established, and it is instructed not to introduce a figure that
 * is not in front of it.
 *
 * Any failure falls back to the deterministic explanation, which is always
 * computed first so there is something correct to fall back to.
 */
export async function narrate(
  question: string,
  result: AnalyticalResult,
): Promise<{ sections: AnswerSection[]; writtenBy: 'TEMPLATE' | 'MODEL' }> {
  const template = explain(result);
  if (!isModelEnabled() || result.findings.length === 0) {
    return { sections: template, writtenBy: 'TEMPLATE' };
  }

  try {
    const { generateText } = await import('ai');
    const { text } = await generateText({
      model: MODEL_ID,
      system: [
        'You write short analytical notes for government SRHR programme managers.',
        'You are given findings that have already been computed and verified. Your only job is to phrase them clearly.',
        'Never introduce a number, place, indicator or claim that is not in the findings.',
        'Never speculate about causes. If the findings do not establish why something happened, say what moved and stop.',
        'Write at most 90 words in British English. No preamble, no headings, no bullet points.',
      ].join(' '),
      prompt: [
        `Question: ${question}`,
        '',
        'Verified findings:',
        ...result.findings.map(
          (finding, index) =>
            `${index + 1}. ${finding.statement}${
              finding.evidence.length > 0
                ? ` [${finding.evidence.map((item) => `${item.label}: ${item.value}`).join('; ')}]`
                : ''
            }`,
        ),
        ...(result.caveats.length > 0 ? ['', `Qualifications: ${result.caveats.join(' ')}`] : []),
      ].join('\n'),
    });

    const prose = text.trim();
    if (prose.length === 0) return { sections: template, writtenBy: 'TEMPLATE' };

    // Keep every structural section; only the opening paragraph is replaced.
    const rest = template.filter((section) => section.heading !== null);
    return { sections: [{ heading: null, body: prose }, ...rest], writtenBy: 'MODEL' };
  } catch {
    return { sections: template, writtenBy: 'TEMPLATE' };
  }
}

export { MODEL_ID };
