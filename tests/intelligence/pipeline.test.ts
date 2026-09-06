import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A full end-to-end suite: bootstrap a fresh database, generate the demo
// dataset, synchronise it, then ask the platform questions with known answers.
const dir = mkdtempSync(join(tmpdir(), 'aspire-pipeline-'));
process.env.ASPIRE_DB_PATH = join(dir, 'test.db');

const { closeDb } = await import('@/data/db/client');
const { ensureBootstrapped } = await import('@/data/bootstrap');
const { runAllCases } = await import('@/intelligence/evals/run');
const { EVAL_CASES } = await import('@/intelligence/evals/cases');
const { answerQuestion } = await import('@/intelligence/answer');
const { validateResult } = await import('@/intelligence/validate');
const { listUsers } = await import('@/data/repositories/users');
const { getRootOrgUnit } = await import('@/data/repositories/orgUnits');
const { latestCompletePeriodId } = await import('@/data/sync/periods');
const { getScorecard, getChildScorecards } = await import('@/services/scorecards');
import type { User } from '@/data/repositories/users';

let analyst: User;
let scopedUser: User;
let rootId: string;
let periodId: string;

beforeAll(async () => {
  await ensureBootstrapped();
  const users = listUsers();
  analyst = users.find((user) => user.role === 'ANALYST')!;
  // A user scoped to a single LGA, to check that scope is enforced inside the
  // pipeline and not only at the HTTP boundary.
  scopedUser = { ...analyst, id: `${analyst.id}-scoped`, scope: ['lga-eguma'] };
  rootId = getRootOrgUnit()!.id;
  periodId = latestCompletePeriodId();
}, 120_000);

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('demo dataset', () => {
  it('produces a scorable state with all indicators covered', () => {
    const card = getScorecard(rootId, periodId);
    expect(card).not.toBeNull();
    expect(card!.overallScore).not.toBeNull();
    expect(card!.coverage).toBe(1);
    expect(card!.domains).toHaveLength(6);
  });

  it('aggregates consistently — an LGA total is built from its facilities', () => {
    const children = getChildScorecards(rootId, periodId);
    expect(children.length).toBeGreaterThan(10);
    for (const child of children) {
      expect(child.overallScore).not.toBeNull();
      expect(child.overallScore!).toBeGreaterThanOrEqual(0);
      expect(child.overallScore!).toBeLessThanOrEqual(100);
    }
  });

  it('marks the planted low-reporting LGA as low confidence while others stay high', () => {
    const children = getChildScorecards(rootId, periodId);
    const weak = children.find((child) => child.orgUnitId === 'lga-hadeja-west')!;
    const others = children.filter((child) => child.orgUnitId !== 'lga-hadeja-west');
    expect(weak.dataConfidence.band).toBe('LOW');
    expect(weak.dataConfidence.reasons.length).toBeGreaterThan(0);
    expect(others.every((child) => child.dataConfidence.band !== 'LOW')).toBe(true);
  });

  it('keeps performance and data confidence independent', () => {
    // The low-confidence LGA is not the lowest performer: if the two measures
    // were entangled, it would be.
    const children = getChildScorecards(rootId, periodId);
    const lowest = [...children].sort((a, b) => (a.overallScore ?? 0) - (b.overallScore ?? 0))[0];
    expect(lowest.orgUnitId).not.toBe('lga-hadeja-west');
  });
});

describe('intelligence evaluation set', () => {
  it('answers every case correctly', async () => {
    const outcomes = await runAllCases(analyst, { orgUnitId: rootId, periodId });
    const failures = outcomes.filter((outcome) => !outcome.passed);
    expect(
      failures.map((outcome) => `${outcome.case.id}: ${outcome.failures.join(' ')}`),
    ).toEqual([]);
    expect(outcomes).toHaveLength(EVAL_CASES.length);
  }, 120_000);
});

describe('pipeline guarantees', () => {
  it('never returns a figure that disagrees with the scorecard', async () => {
    const answer = await answerQuestion('Generate an executive summary', analyst, {
      orgUnitId: rootId,
      periodId,
    });
    const card = getScorecard(rootId, periodId)!;
    expect(answer.result!.headline).toContain(String(card.overallScore));
  });

  it('answers within the asking user’s geographic scope, not the requested one', async () => {
    const answer = await answerQuestion('How is Chalawa performing?', scopedUser, {
      orgUnitId: 'lga-eguma',
      periodId,
    });
    // Chalawa is outside this user's scope, so the query falls back to their own.
    expect(answer.result!.query.orgUnitId).toBe('lga-eguma');
  });

  it('states plainly when it cannot answer rather than inventing something', async () => {
    const answer = await answerQuestion('Compare Atlantis and El Dorado', analyst, {
      orgUnitId: rootId,
      periodId,
    });
    // The question is read as a comparison — that part is right — but neither
    // place exists, so the platform says what it needs instead of comparing two
    // geographies it invented.
    expect(answer.result!.query.kind).toBe('COMPARE_UNITS');
    expect(answer.result!.query.compareOrgUnitIds ?? []).toHaveLength(0);
    expect(answer.result!.rows).toHaveLength(0);
    expect(answer.result!.headline).toMatch(/two or more geographies/i);
  });

  it('produces prose without a language model configured', async () => {
    const answer = await answerQuestion('Which areas are performing below target?', analyst, {
      orgUnitId: rootId,
      periodId,
    });
    expect(answer.writtenBy).toBe('TEMPLATE');
    expect(answer.plannedBy).toBe('RULES');
    expect(answer.sections[0].body.length).toBeGreaterThan(20);
    expect(answer.declined).toBe(false);
  });

  it('attaches evidence to every finding it states', async () => {
    const answer = await answerQuestion('Which area has the lowest performance?', analyst, {
      orgUnitId: rootId,
      periodId,
    });
    for (const finding of answer.result!.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
    }
  });

  it('every quoted figure is traceable to its own evidence', async () => {
    // The validator's evidence check is the guarantee behind "trust this
    // number": if a figure appears in prose it must appear in the evidence the
    // reader can open. Any warning here is a defect in a finding, not a
    // cosmetic issue, so the whole question set is checked.
    const questions = [
      'Why is performance declining?',
      'Which areas are performing below target?',
      'Which areas improved most?',
      'Which area has the lowest performance?',
      'What are the biggest SRHR risks?',
      'Generate an executive summary',
      'How is adolescent family planning uptake doing?',
      'Which areas have unusual reporting patterns?',
    ];

    const offenders: string[] = [];
    for (const question of questions) {
      const answer = await answerQuestion(question, analyst, { orgUnitId: rootId, periodId });
      if (!answer.result) continue;
      for (const issue of validateResult(answer.result)) {
        offenders.push(`${question} — ${issue.severity}: ${issue.message}`);
      }
    }
    expect(offenders).toEqual([]);
  }, 120_000);

  it('refuses an empty question', async () => {
    const answer = await answerQuestion('   ', analyst, { orgUnitId: rootId, periodId });
    expect(answer.declined).toBe(true);
    expect(answer.result).toBeNull();
  });
});
