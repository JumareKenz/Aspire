import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, dropSchema, isolatedSchema } from '../helpers/db';

const schema = isolatedSchema();
const { ensureBootstrapped } = await import('@/data/bootstrap');
const { assertOrgUnitInScope, resolveScope, ScopeError } = await import('@/auth/server');
const { createUser, listUsers } = await import('@/data/repositories/users');
const { listOrgUnits, getRootOrgUnit } = await import('@/data/repositories/orgUnits');
const { answerQuestion } = await import('@/intelligence/answer');
const { latestCompletePeriodId } = await import('@/data/sync/periods');
const { can } = await import('@/auth/rbac');
const { experienceFor } = await import('@/auth/experience');
import type { User } from '@/data/repositories/users';

let national: User;
let scoped: User;
let executive: User;
let facilityId: string;
let otherLgaId: string;
let scopedLgaId: string;
let rootId: string;

beforeAll(async () => {
  await createSchema(schema);
  await ensureBootstrapped();
  const [users, root, lgas] = await Promise.all([listUsers(), getRootOrgUnit(), listOrgUnits('LGA')]);
  national = users.find((user) => user.role === 'ANALYST')!;
  rootId = root!.id;
  scopedLgaId = lgas[0].id;
  otherLgaId = lgas[1].id;
  scoped = await createUser({
    email: 'scoped@aspire.local',
    name: 'Scoped officer',
    role: 'ANALYST',
    scope: [scopedLgaId],
    password: 'a-long-enough-password',
  });
  executive = users.find((user) => user.role === 'EXECUTIVE')!;
  facilityId = (await listOrgUnits('FACILITY'))[0].id;
}, 120_000);

afterAll(async () => {
  await dropSchema(schema);
});

describe('geographic scope', () => {
  it('lets a national user reach everything', async () => {
    const scope = await resolveScope(national);
    expect(scope.root.id).toBe(rootId);
    expect(scope.ids).toContain(otherLgaId);
    await expect(assertOrgUnitInScope(national, otherLgaId)).resolves.toBeTruthy();
  });

  it('opens a scoped user on their own geography, not the state above it', async () => {
    const scope = await resolveScope(scoped);
    expect(scope.root.id).toBe(scopedLgaId);
    expect(scope.ids).not.toContain(otherLgaId);
  });

  it('includes a scoped user’s descendants', async () => {
    const scope = await resolveScope(scoped);
    const facilities = (await listOrgUnits('FACILITY')).filter((unit) => unit.parentId === scopedLgaId);
    expect(facilities.length).toBeGreaterThan(0);
    for (const facility of facilities) expect(scope.ids).toContain(facility.id);
  });

  it('refuses a sibling geography with a 403', async () => {
    await expect(assertOrgUnitInScope(scoped, otherLgaId)).rejects.toBeInstanceOf(ScopeError);
    await expect(assertOrgUnitInScope(scoped, otherLgaId)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses the parent above the scope', async () => {
    await expect(assertOrgUnitInScope(scoped, rootId)).rejects.toBeInstanceOf(ScopeError);
  });

  it('reports an unknown geography as 404, not 403', async () => {
    await expect(assertOrgUnitInScope(national, 'no-such-unit')).rejects.toMatchObject({
      status: 404,
    });
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
    const lgas = await listOrgUnits('LGA');
    const other = lgas.find((unit) => unit.id === otherLgaId)!;
    const mine = lgas.find((unit) => unit.id === scopedLgaId)!;
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

describe('depth is enforced in the data layer, not by hiding links', () => {
  it('refuses a facility to an executive even inside their own geography', async () => {
    // The executive has national scope, so this is refused on depth alone —
    // which is the check a hidden link would not provide.
    await expect(assertOrgUnitInScope(executive, facilityId)).rejects.toMatchObject({ status: 403 });
  });

  it('allows the same facility to an analyst', async () => {
    await expect(assertOrgUnitInScope(national, facilityId)).resolves.toBeTruthy();
  });

  it('keeps facilities out of an executive’s selectable scope entirely', async () => {
    const scope = await resolveScope(executive);
    expect(scope.ids).not.toContain(facilityId);
    expect((await resolveScope(national)).ids).toContain(facilityId);
  });

  it('still lets an executive open an area', async () => {
    await expect(assertOrgUnitInScope(executive, scopedLgaId)).resolves.toBeTruthy();
  });
});

describe('intelligence inherits role and scope before any query runs', () => {
  it('does not return facility rows to an executive', async () => {
    const answer = await answerQuestion('Which areas are performing below target?', executive, {
      orgUnitId: rootId,
      periodId: latestCompletePeriodId(),
    });
    const permitted = new Set((await resolveScope(executive)).ids);
    for (const row of answer.result?.rows ?? []) {
      if (row.refKind === 'ORG_UNIT' && row.refId) expect(permitted.has(row.refId)).toBe(true);
    }
  });

  it('confines a scoped analyst to their own geography', async () => {
    const answer = await answerQuestion('Rank every area by performance', scoped, {
      orgUnitId: scopedLgaId,
      periodId: latestCompletePeriodId(),
    });
    const permitted = new Set((await resolveScope(scoped)).ids);
    for (const row of answer.result?.rows ?? []) {
      if (row.refKind === 'ORG_UNIT' && row.refId) expect(permitted.has(row.refId)).toBe(true);
    }
    expect(permitted.has(otherLgaId)).toBe(false);
  });
});

describe('report types are part of the experience', () => {
  it('withholds operational reports from an executive', () => {
    const exec = experienceFor(executive).reportTypes;
    expect(exec).not.toContain('DATA_QUALITY');
    expect(exec).not.toContain('AREA_PERFORMANCE');
  });

  it('gives an analyst the full set', () => {
    expect(experienceFor(national).reportTypes).toContain('DATA_QUALITY');
  });
});
