import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, dropSchema, isolatedSchema } from '../helpers/db';

const schema = isolatedSchema();
const { ensureBootstrapped } = await import('@/data/bootstrap');
const { listUsers } = await import('@/data/repositories/users');
const { createAction, getAction } = await import('@/data/repositories/actions');
const { resolveScope } = await import('@/auth/server');
const { scopesOverlap } = await import('@/auth/rbac');
import type { User } from '@/data/repositories/users';

const BAUCHI = 'state-bauchi';
const SOKOTO = 'state-sokoto';

let globalAnalyst: User;
let bauchiAnalyst: User;
let sokotoAnalyst: User;
let admin: User;

beforeAll(async () => {
  await createSchema(schema);
  await ensureBootstrapped();
  const users = await listUsers();
  globalAnalyst = users.find((u) => u.role === 'ANALYST' && u.scope.length === 0)!;
  bauchiAnalyst = users.find((u) => u.role === 'ANALYST' && u.scope.includes(BAUCHI))!;
  sokotoAnalyst = users.find((u) => u.role === 'ANALYST' && u.scope.includes(SOKOTO))!;
  admin = users.find((u) => u.role === 'ADMIN')!;
}, 120_000);

afterAll(async () => {
  await dropSchema(schema);
});

describe('who a user may be shown, and assign work to', () => {
  it('does not show a state officer the officers of the other state', async () => {
    const scope = await resolveScope(bauchiAnalyst);
    expect(scopesOverlap(scope.ids, scope.root.path, sokotoAnalyst.scope)).toBe(false);
    // The full directory would disclose that the other state's officers exist,
    // and would offer work to someone who cannot open the geography.
    const visible = (await listUsers()).filter((entry) =>
      scopesOverlap(scope.ids, scope.root.path, entry.scope),
    );
    expect(visible.map((entry) => entry.email)).not.toContain(sokotoAnalyst.email);
  });

  it('does show them the programme-wide officers, who can read their geography', async () => {
    const scope = await resolveScope(bauchiAnalyst);
    expect(scopesOverlap(scope.ids, scope.root.path, globalAnalyst.scope)).toBe(true);
    expect(scopesOverlap(scope.ids, scope.root.path, admin.scope)).toBe(true);
  });

  it('shows a programme-wide officer everyone, in both directions', async () => {
    const scope = await resolveScope(globalAnalyst);
    for (const candidate of [bauchiAnalyst, sokotoAnalyst, admin]) {
      expect(scopesOverlap(scope.ids, scope.root.path, candidate.scope)).toBe(true);
    }
  });

  it('is symmetric for two users who share nothing', async () => {
    const bauchiScope = await resolveScope(bauchiAnalyst);
    const sokotoScope = await resolveScope(sokotoAnalyst);
    expect(scopesOverlap(bauchiScope.ids, bauchiScope.root.path, sokotoAnalyst.scope)).toBe(false);
    expect(scopesOverlap(sokotoScope.ids, sokotoScope.root.path, bauchiAnalyst.scope)).toBe(false);
  });
});

describe('an action is addressed by id, so scope is checked against the action', () => {
  it('keeps another state’s action out of a state officer’s list', async () => {
    const sokotoAction = await createAction({
      title: 'Review commodity stock in Sokoto',
      detail: '',
      orgUnitId: SOKOTO,
      indicatorId: null,
      periodId: '2026Q2',
      source: 'MANUAL',
      sourceRef: null,
      priority: 'MEDIUM',
      assigneeId: null,
      createdBy: sokotoAnalyst.id,
      dueDate: null,
      baselineScore: null,
    });

    const bauchiScope = await resolveScope(bauchiAnalyst);
    // The list is built from the viewer's scope ids, so the action is absent …
    expect(bauchiScope.ids).not.toContain(SOKOTO);
    // … and the action itself still exists, reachable only by id, which is
    // exactly why the PATCH route re-checks the action's own geography rather
    // than trusting that the caller could only have found it through the list.
    expect((await getAction(sokotoAction.id))!.orgUnitId).toBe(SOKOTO);
  });
});
