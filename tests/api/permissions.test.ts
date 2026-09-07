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
const { accessibleStates, hasCrossStateAccess, compareStates } = await import('@/services/states');
import type { User } from '@/data/repositories/users';

const BAUCHI = 'state-bauchi';
const SOKOTO = 'state-sokoto';

/** Global scope, every role. */
let national: User;
let executive: User;
/** One LGA, to prove scope is not tied to any particular level. */
let scoped: User;
/** Same role, different state — and same state, different role. */
let bauchiAnalyst: User;
let sokotoAnalyst: User;
let bauchiExecutive: User;

let facilityId: string;
let otherLgaId: string;
let scopedLgaId: string;
let sokotoLgaId: string;
let rootId: string;

beforeAll(async () => {
  await createSchema(schema);
  await ensureBootstrapped();
  const [users, root, lgas] = await Promise.all([listUsers(), getRootOrgUnit(), listOrgUnits('LGA')]);
  const global = (role: User['role']) =>
    users.find((user) => user.role === role && user.scope.length === 0)!;
  national = global('ANALYST');
  executive = global('EXECUTIVE');
  rootId = root!.id;

  const bauchiLgas = lgas.filter((unit) => unit.parentId === BAUCHI);
  const sokotoLgas = lgas.filter((unit) => unit.parentId === SOKOTO);
  scopedLgaId = bauchiLgas[0].id;
  otherLgaId = bauchiLgas[1].id;
  sokotoLgaId = sokotoLgas[0].id;

  scoped = await createUser({
    email: 'scoped@aspire.local',
    name: 'Scoped officer',
    role: 'ANALYST',
    scope: [scopedLgaId],
    password: 'a-long-enough-password',
  });
  bauchiAnalyst = users.find(
    (user) => user.role === 'ANALYST' && user.scope.includes(BAUCHI),
  )!;
  sokotoAnalyst = users.find(
    (user) => user.role === 'ANALYST' && user.scope.includes(SOKOTO),
  )!;
  bauchiExecutive = users.find(
    (user) => user.role === 'EXECUTIVE' && user.scope.includes(BAUCHI),
  )!;
  facilityId = (await listOrgUnits('FACILITY')).find(
    (unit) => unit.path.includes(scopedLgaId),
  )!.id;
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

  it('seeds the personas that prove role and scope are independent', () => {
    for (const user of [national, executive, scoped, bauchiAnalyst, sokotoAnalyst, bauchiExecutive]) {
      expect(user).toBeDefined();
    }
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

  it('refuses a comparison that names a geography outside the scope', async () => {
    const lgas = await listOrgUnits('LGA');
    const other = lgas.find((unit) => unit.id === otherLgaId)!;
    const mine = lgas.find((unit) => unit.id === scopedLgaId)!;
    const answer = await answerQuestion(`Compare ${mine.name} and ${other.name}`, scoped, {
      orgUnitId: scopedLgaId,
      periodId: latestCompletePeriodId(),
    });
    // Quietly dropping the other geography would answer a narrower question
    // than the one asked and present it as the answer, so it is refused and
    // says which geography it cannot show.
    expect(answer.declined).toBe(true);
    expect(answer.result).toBeNull();
    expect(answer.sections[0].body).toContain(other.name);
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

describe('role and geography are independent', () => {
  // The two axes are varied one at a time. If either dimension were secretly
  // driving the other, one of these pairs would come out identical.

  it('same role, different state: the geography changes and nothing else does', async () => {
    const [bauchi, sokoto] = await Promise.all([
      resolveScope(bauchiAnalyst),
      resolveScope(sokotoAnalyst),
    ]);
    expect(bauchi.root.id).toBe(BAUCHI);
    expect(sokoto.root.id).toBe(SOKOTO);
    expect(bauchi.ids).not.toContain(SOKOTO);
    expect(sokoto.ids).not.toContain(BAUCHI);
    // Same role, so the same depth and the same capabilities.
    expect(experienceFor(bauchiAnalyst)).toEqual(experienceFor(sokotoAnalyst));
    expect(bauchi.ids.some((id) => id.startsWith('lga-bauchi-'))).toBe(true);
    expect(bauchi.ids.some((id) => id.startsWith('lga-sokoto-'))).toBe(false);
  });

  it('same state, different role: the depth changes and the geography does not', async () => {
    const [analystScope, execScope] = await Promise.all([
      resolveScope(bauchiAnalyst),
      resolveScope(bauchiExecutive),
    ]);
    expect(execScope.root.id).toBe(analystScope.root.id);
    // Both are confined to Bauchi …
    expect(execScope.ids.every((id) => analystScope.ids.includes(id))).toBe(true);
    // … but only the analyst reaches facilities inside it.
    expect(analystScope.ids.some((id) => id.startsWith('fac-'))).toBe(true);
    expect(execScope.ids.some((id) => id.startsWith('fac-'))).toBe(false);
    expect(experienceFor(bauchiExecutive).detail).toBe('SUMMARY');
    expect(experienceFor(bauchiAnalyst).detail).toBe('FULL');
  });

  it('a state-scoped executive is refused the other state, exactly as the analyst is', async () => {
    for (const user of [bauchiExecutive, bauchiAnalyst]) {
      await expect(assertOrgUnitInScope(user, SOKOTO)).rejects.toMatchObject({ status: 403 });
      await expect(assertOrgUnitInScope(user, sokotoLgaId)).rejects.toMatchObject({ status: 403 });
      await expect(assertOrgUnitInScope(user, rootId)).rejects.toMatchObject({ status: 403 });
      await expect(assertOrgUnitInScope(user, BAUCHI)).resolves.toBeTruthy();
    }
  });

  it('a global executive reaches both states, because scope and not role decides that', async () => {
    for (const user of [executive, national]) {
      await expect(assertOrgUnitInScope(user, BAUCHI)).resolves.toBeTruthy();
      await expect(assertOrgUnitInScope(user, SOKOTO)).resolves.toBeTruthy();
    }
  });
});

describe('cross-state comparison follows scope, not role', () => {
  it('offers the comparison to any global user and to no state-scoped user', async () => {
    expect(await hasCrossStateAccess(executive)).toBe(true);
    expect(await hasCrossStateAccess(national)).toBe(true);
    expect(await hasCrossStateAccess(bauchiExecutive)).toBe(false);
    expect(await hasCrossStateAccess(bauchiAnalyst)).toBe(false);
    expect(await hasCrossStateAccess(sokotoAnalyst)).toBe(false);
    expect(await hasCrossStateAccess(scoped)).toBe(false);
  });

  it('returns only the states a user holds', async () => {
    expect((await accessibleStates(national)).map((state) => state.id).sort()).toEqual([
      BAUCHI,
      SOKOTO,
    ]);
    expect((await accessibleStates(bauchiExecutive)).map((state) => state.id)).toEqual([BAUCHI]);
    expect(await accessibleStates(scoped)).toEqual([]);
  });

  it('cannot be built from one state, so there is nothing to leak', async () => {
    const oneState = await accessibleStates(bauchiAnalyst);
    expect(await compareStates(oneState, latestCompletePeriodId())).toBeNull();
  });

  it('produces a real comparison for a user who holds both', async () => {
    const comparison = await compareStates(
      await accessibleStates(executive),
      latestCompletePeriodId(),
    );
    expect(comparison).not.toBeNull();
    expect(comparison!.states.map((state) => state.orgUnitId).sort()).toEqual([BAUCHI, SOKOTO]);
    expect(comparison!.domains.length).toBeGreaterThan(1);
    // Every domain row carries a figure for each state, so the table is a
    // comparison rather than two half-filled columns.
    for (const row of comparison!.domains) {
      expect(Object.keys(row.scores).sort()).toEqual([BAUCHI, SOKOTO]);
    }
    // Bauchi is seeded above Sokoto; the comparison must find that, not assert it.
    const byId = new Map(comparison!.states.map((state) => [state.orgUnitId, state.score!]));
    expect(byId.get(BAUCHI)!).toBeGreaterThan(byId.get(SOKOTO)!);
  }, 60_000);
});

describe('the AI refuses cross-state questions it cannot honestly answer', () => {
  const period = latestCompletePeriodId();

  it('refuses for a state-scoped user of either role, naming what it cannot show', async () => {
    for (const user of [bauchiAnalyst, bauchiExecutive]) {
      const answer = await answerQuestion('Compare Bauchi and Sokoto', user, {
        orgUnitId: BAUCHI,
        periodId: period,
      });
      expect(answer.declined).toBe(true);
      expect(answer.result).toBeNull();
      expect(answer.sections[0].body).toContain('Sokoto');
    }
  }, 60_000);

  it('answers it for a global user of either role', async () => {
    for (const user of [national, executive]) {
      const answer = await answerQuestion('Compare Bauchi and Sokoto', user, {
        orgUnitId: rootId,
        periodId: period,
      });
      expect(answer.declined).toBe(false);
      expect(answer.result!.query.compareOrgUnitIds).toEqual(
        expect.arrayContaining([BAUCHI, SOKOTO]),
      );
    }
  }, 60_000);

  it('refuses a question naming an LGA of the state the user does not hold', async () => {
    const lgas = await listOrgUnits('LGA');
    // Every Sokoto LGA, not one sample: a name-length or word-boundary rule
    // that happens to miss one of them is the whole failure mode here, and it
    // is invisible if only the first name is tried. Isa, at three letters, is
    // the one an earlier length guard let through.
    const missed: string[] = [];
    for (const lga of lgas.filter((unit) => unit.parentId === SOKOTO)) {
      const answer = await answerQuestion(`How is ${lga.name} performing?`, bauchiAnalyst, {
        orgUnitId: BAUCHI,
        periodId: period,
      });
      if (!answer.declined || answer.result !== null) missed.push(lga.name);
    }
    expect(missed).toEqual([]);
  }, 120_000);

  it('does not refuse a question that merely resembles a geography name', async () => {
    // The refusal must not fire on ordinary words. A question about the user's
    // own state, using words that appear inside no permitted name, is answered.
    const answer = await answerQuestion('How is maternal health doing?', bauchiAnalyst, {
      orgUnitId: BAUCHI,
      periodId: period,
    });
    expect(answer.declined).toBe(false);
    expect(answer.result).not.toBeNull();
  });
});
