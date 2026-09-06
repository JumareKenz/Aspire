import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Permission boundaries are enforced in the service layer, so they are testable
// without going through HTTP. These are the checks that matter: a scoped user
// must not be able to read, ask about or act on a geography outside their scope.
const dir = mkdtempSync(join(tmpdir(), 'aspire-perms-'));
process.env.ASPIRE_DB_PATH = join(dir, 'test.db');

const { closeDb } = await import('@/data/db/client');
const { ensureBootstrapped } = await import('@/data/bootstrap');
const { assertOrgUnitInScope, resolveScope, ScopeError } = await import('@/auth/server');
const { createUser, listUsers } = await import('@/data/repositories/users');
const { listOrgUnits, getRootOrgUnit } = await import('@/data/repositories/orgUnits');
const { answerQuestion } = await import('@/intelligence/answer');
const { latestCompletePeriodId } = await import('@/data/sync/periods');
const { can } = await import('@/auth/rbac');
import type { User } from '@/data/repositories/users';

let national: User;
let scoped: User;
let otherLgaId: string;
let scopedLgaId: string;
let rootId: string;

beforeAll(async () => {
  await ensureBootstrapped();
  national = listUsers().find((user) => user.role === 'ANALYST')!;
  rootId = getRootOrgUnit()!.id;
  const lgas = listOrgUnits('LGA');
  scopedLgaId = lgas[0].id;
  otherLgaId = lgas[1].id;
  scoped = createUser({
    email: 'scoped@aspire.local',
    name: 'Scoped officer',
    role: 'ANALYST',
    scope: [scopedLgaId],
    password: 'a-long-enough-password',
  });
}, 120_000);

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('geographic scope', () => {
  it('lets a national user reach everything', () => {
    const scope = resolveScope(national);
    expect(scope.root.id).toBe(rootId);
    expect(scope.ids).toContain(otherLgaId);
    expect(() => assertOrgUnitInScope(national, otherLgaId)).not.toThrow();
  });

  it('opens a scoped user on their own geography, not the state above it', () => {
    const scope = resolveScope(scoped);
    expect(scope.root.id).toBe(scopedLgaId);
    expect(scope.ids).not.toContain(otherLgaId);
  });

  it('includes a scoped user’s descendants', () => {
    const scope = resolveScope(scoped);
    const facilities = listOrgUnits('FACILITY').filter((unit) => unit.parentId === scopedLgaId);
    expect(facilities.length).toBeGreaterThan(0);
    for (const facility of facilities) expect(scope.ids).toContain(facility.id);
  });

  it('refuses a sibling geography with a 403', () => {
    expect(() => assertOrgUnitInScope(scoped, otherLgaId)).toThrow(ScopeError);
    try {
      assertOrgUnitInScope(scoped, otherLgaId);
    } catch (error) {
      expect((error as InstanceType<typeof ScopeError>).status).toBe(403);
    }
  });

  it('refuses the parent above the scope', () => {
    expect(() => assertOrgUnitInScope(scoped, rootId)).toThrow(ScopeError);
  });

  it('reports an unknown geography as 404, not 403', () => {
    try {
      assertOrgUnitInScope(national, 'no-such-unit');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as InstanceType<typeof ScopeError>).status).toBe(404);
    }
  });
});

describe('scope inside the intelligence pipeline', () => {
  it('does not answer about a geography outside the asking user’s scope', async () => {
    const answer = await answerQuestion(`How is the state performing?`, scoped, {
      orgUnitId: scopedLgaId,
      periodId: latestCompletePeriodId(),
    });
    expect(answer.result!.query.orgUnitId).toBe(scopedLgaId);
  });

  it('drops out-of-scope geographies from a comparison rather than answering about them', async () => {
    const other = listOrgUnits('LGA').find((unit) => unit.id === otherLgaId)!;
    const mine = listOrgUnits('LGA').find((unit) => unit.id === scopedLgaId)!;
    const answer = await answerQuestion(`Compare ${mine.name} and ${other.name}`, scoped, {
      orgUnitId: scopedLgaId,
      periodId: latestCompletePeriodId(),
    });
    expect(answer.result!.query.compareOrgUnitIds ?? []).not.toContain(otherLgaId);
  });
});

describe('capabilities', () => {
  it('withholds triage and administration from executives', () => {
    expect(can('EXECUTIVE', 'quality.triage')).toBe(false);
    expect(can('EXECUTIVE', 'actions.manage')).toBe(false);
    expect(can('EXECUTIVE', 'admin.view')).toBe(false);
    expect(can('EXECUTIVE', 'admin.sync')).toBe(false);
  });

  it('withholds administration from the programme tier', () => {
    expect(can('ANALYST', 'admin.manage')).toBe(false);
    expect(can('ANALYST', 'admin.sync')).toBe(false);
  });

  it('lets every tier ask questions and generate reports', () => {
    for (const role of ['EXECUTIVE', 'ANALYST', 'ADMIN'] as const) {
      expect(can(role, 'intelligence.ask')).toBe(true);
      expect(can(role, 'reports.generate')).toBe(true);
    }
  });
});
