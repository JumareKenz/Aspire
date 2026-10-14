import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSchema, dropSchema, isolatedSchema } from '../helpers/db';

/**
 * Store-backed tests for the overview, governance, monthly, target, catalogue,
 * hierarchy and map enhancements — with the RBAC cases varied one axis at a
 * time: global vs Bauchi vs Sokoto, and analyst vs executive.
 */

// Pages resolve the signed-in user from a cookie; tests set the token directly.
let sessionToken: string | null = null;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (sessionToken ? { value: sessionToken } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const schema = isolatedSchema();
const { ensureBootstrapped } = await import('@/data/bootstrap');
const { createSessionToken } = await import('@/auth/session');
const { listUsers, createUser } = await import('@/data/repositories/users');
const { listOrgUnits, getOrgUnit } = await import('@/data/repositories/orgUnits');
const { listReportingIndicators, listIndicators } = await import('@/data/repositories/registry');
const { saveProvenance, listProvenance, listCatalogue, saveDataElementConfig } = await import('@/data/repositories/nhmis');
const { setDataMode } = await import('@/data/repositories/settings');
const { listStoredPeriodIds } = await import('@/data/repositories/observations');
const { getScorecard } = await import('@/services/scorecards');
const { getIndicatorDetail } = await import('@/services/indicators');
const { getOverviewMap } = await import('@/services/geography');
const { getContributingElements, getDataElementCatalogue, getDataElementReport } = await import('@/services/dataElements');
const { saveIndicatorTarget, removeIndicatorTarget, listIndicatorTargets } = await import('@/services/targetAdmin');
const { scopedChildren, searchScoped } = await import('@/services/orgUnitTree');
const { resolvePageContext } = await import('@/services/context');
const { explainOverall, explainDomain } = await import('@/core/scoring/explain');
const { latestCompletePeriodId, analysisMonths } = await import('@/data/sync/periods');
const { monthsOf, previousPeriodId } = await import('@/core/model/periods');
const { PROVISIONAL_METHODOLOGY } = await import('@/config/methodology');
const { ScopeError } = await import('@/auth/server');
import type { User } from '@/data/repositories/users';

const BAUCHI = 'state-bauchi';
const SOKOTO = 'state-sokoto';
const bands = PROVISIONAL_METHODOLOGY.statusBands;

let admin: User;
let bauchiAdmin: User;
let analyst: User;
let bauchiAnalyst: User;
let sokotoAnalyst: User;
let executive: User;
let quarter: string;
let month: string;

async function signIn(user: User) {
  sessionToken = await createSessionToken({ sub: user.id, email: user.email, name: user.name, role: user.role, scope: user.scope });
}

beforeAll(async () => {
  await createSchema(schema);
  await ensureBootstrapped();
  const users = await listUsers();
  const find = (role: User['role'], scope: string | null) =>
    users.find((user) => user.role === role && (scope === null ? user.scope.length === 0 : user.scope.includes(scope)))!;
  admin = find('ADMIN', null);
  analyst = find('ANALYST', null);
  executive = find('EXECUTIVE', null);
  bauchiAnalyst = find('ANALYST', BAUCHI);
  sokotoAnalyst = find('ANALYST', SOKOTO);
  bauchiAdmin = await createUser({
    email: 'bauchi.admin@aspire.local',
    name: 'Bauchi administrator',
    role: 'ADMIN',
    scope: [BAUCHI],
    password: 'a-long-enough-password',
  });
  quarter = latestCompletePeriodId();
  month = monthsOf(quarter)[2];
}, 180_000);

afterAll(async () => {
  await dropSchema(schema);
});

describe('overview and domain cards', () => {
  it('scores every configured domain once and reconciles the overall figure with its terms', async () => {
    const card = (await getScorecard(BAUCHI, quarter))!;
    expect(card.domains.length).toBeGreaterThan(0);
    const overall = explainOverall(card);
    expect(overall.total).toBeCloseTo(card.overallScore!, 0);
    for (const domain of card.domains) {
      if (domain.score !== null) expect(explainDomain(domain).total).toBeCloseTo(domain.score, 0);
    }
    const ids = card.domains.flatMap((domain) => domain.indicators.map((indicator) => indicator.indicatorId));
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);

  it('lists the data elements behind each indicator with values at state level, and none below LGA', async () => {
    const state = (await getOrgUnit(BAUCHI))!;
    const elements = await getContributingElements(state, quarter);
    const mcpr = elements['mcpr'];
    expect(mcpr.map((entry) => entry.role)).toEqual(['NUMERATOR', 'DENOMINATOR']);
    expect(mcpr.every((entry) => entry.value !== null)).toBe(true);

    const facility = (await listOrgUnits('FACILITY')).find((unit) => unit.path.includes(BAUCHI))!;
    const atFacility = await getContributingElements(facility, quarter);
    expect(atFacility['mcpr'].every((entry) => entry.value === null)).toBe(true);
    const report = await getDataElementReport(facility, quarter);
    expect(report.available).toBe(false);
  }, 60_000);
});

describe('monthly and quarterly reporting', () => {
  it('stores months as months from the source, alongside the quarters', async () => {
    const months = await listStoredPeriodIds('MONTHLY');
    expect(months).toEqual(analysisMonths().map((period) => period.id));
    expect(months).toContain(month);
  });

  it('scores a month on its own monthly series, with a month-to-month trend axis', async () => {
    const monthly = (await getScorecard(BAUCHI, month))!;
    const quarterly = (await getScorecard(BAUCHI, quarter))!;
    expect(monthly.periodLabel).toMatch(/^[A-Z][a-z]+ \d{4}$/);
    expect(monthly.periodLabels.at(-2)).toBe(
      (await getScorecard(BAUCHI, previousPeriodId(month)))!.periodLabel,
    );
    expect(monthly.overallScore).not.toBe(quarterly.overallScore);
  }, 60_000);

  it('does not apply a quarterly count target to a month, and does not invent one', async () => {
    const monthly = (await getScorecard(BAUCHI, month))!;
    const acceptors = monthly.domains.flatMap((d) => d.indicators).find((i) => i.indicatorId === 'fp-new-acceptors')!;
    expect(acceptors.value).not.toBeNull();
    expect(acceptors.target).toBeNull();
    expect(acceptors.score).toBeNull();
  }, 60_000);
});

describe('NHMIS governance in the data-access layer', () => {
  let snapshot: Awaited<ReturnType<typeof listProvenance>>;
  beforeAll(async () => {
    snapshot = await listProvenance();
  });
  afterAll(async () => {
    await setDataMode('DEMO');
    await saveProvenance([...snapshot.values()]);
  });

  it('reports nothing against DHIS2 until indicators are verified, and only verified ones after', async () => {
    await setDataMode('DHIS2');
    // Provenance from the demo sync is DEMO, which does not count against DHIS2.
    expect(await listReportingIndicators()).toEqual([]);

    const all = await listIndicators(true);
    await saveProvenance(
      all.map((indicator) => ({
        indicatorId: indicator.id,
        status: indicator.id === 'mcpr' ? ('UNVERIFIED' as const) : ('VERIFIED' as const),
        sourceKind: 'SOURCE_INDICATOR' as const,
        sourceName: null,
        operands: [],
        reasons: indicator.id === 'mcpr' ? ['denominator is not on an approved NHMIS form'] : [],
      })),
    );
    const reporting = await listReportingIndicators();
    expect(reporting.some((indicator) => indicator.id === 'mcpr')).toBe(false);
    expect(reporting.length).toBe(all.filter((indicator) => indicator.active).length - 1);

    // Excluded from scorecards, from the indicator panel by id, and from target setting.
    const card = (await getScorecard(BAUCHI, quarter))!;
    expect(card.domains.flatMap((d) => d.indicators).some((i) => i.indicatorId === 'mcpr')).toBe(false);
    expect(await getIndicatorDetail(BAUCHI, 'mcpr', quarter)).toBeNull();
    await expect(
      saveIndicatorTarget(admin, { indicatorId: 'mcpr', orgUnitId: BAUCHI, periodId: null, value: 30 }),
    ).rejects.toThrow(/verified NHMIS/);
  }, 60_000);
});

describe('target setting', () => {
  it('validates values, scope and the count rule', async () => {
    await expect(
      saveIndicatorTarget(admin, { indicatorId: 'anc4-coverage', orgUnitId: BAUCHI, periodId: quarter, value: 140 }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      saveIndicatorTarget(admin, { indicatorId: 'fp-new-acceptors', orgUnitId: null, periodId: 'QUARTERLY', value: 1000 }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      saveIndicatorTarget(admin, { indicatorId: 'anc4-coverage', orgUnitId: BAUCHI, periodId: '2026S1', value: 70 }),
    ).rejects.toMatchObject({ status: 422 });
    // A Bauchi administrator cannot set Sokoto's targets, nor programme-wide ones.
    await expect(
      saveIndicatorTarget(bauchiAdmin, { indicatorId: 'anc4-coverage', orgUnitId: SOKOTO, periodId: null, value: 70 }),
    ).rejects.toBeInstanceOf(ScopeError);
    await expect(
      saveIndicatorTarget(bauchiAdmin, { indicatorId: 'anc4-coverage', orgUnitId: null, periodId: null, value: 70 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('persists a period target, re-scores that period only, and lists it only within scope', async () => {
    const before = (await getScorecard(BAUCHI, quarter))!;
    const earlier = (await getScorecard(BAUCHI, previousPeriodId(quarter)))!;
    const pick = (card: typeof before) => card.domains.flatMap((d) => d.indicators).find((i) => i.indicatorId === 'anc4-coverage')!;

    await saveIndicatorTarget(admin, { indicatorId: 'anc4-coverage', orgUnitId: BAUCHI, periodId: quarter, value: 95 });
    // Saving again replaces rather than duplicates.
    const listing = await saveIndicatorTarget(admin, { indicatorId: 'anc4-coverage', orgUnitId: BAUCHI, periodId: quarter, value: 96 });
    expect(listing.rows.filter((row) => row.orgUnitId === BAUCHI && row.periodId === quarter)).toHaveLength(1);

    const after = (await getScorecard(BAUCHI, quarter))!;
    expect(pick(after).target).toBe(96);
    expect(pick(after).targetScope).toBe('AREA_PERIOD');
    expect(pick(after).achievementPct).not.toBe(pick(before).achievementPct);
    // History is not re-scored, and Sokoto is untouched.
    expect(pick((await getScorecard(BAUCHI, previousPeriodId(quarter)))!).target).toBe(pick(earlier).target);
    expect(pick((await getScorecard(SOKOTO, quarter))!).target).toBe(pick(before).target);

    // A count can be given a monthly target for an area, which then scores the month.
    await saveIndicatorTarget(admin, { indicatorId: 'fp-new-acceptors', orgUnitId: BAUCHI, periodId: 'MONTHLY', value: 9000 });
    const monthly = (await getScorecard(BAUCHI, month))!;
    expect(monthly.domains.flatMap((d) => d.indicators).find((i) => i.indicatorId === 'fp-new-acceptors')!.target).toBe(9000);

    // Sokoto's rows are not shown to the Bauchi administrator.
    await saveIndicatorTarget(admin, { indicatorId: 'anc4-coverage', orgUnitId: SOKOTO, periodId: quarter, value: 90 });
    const bauchiView = await listIndicatorTargets(bauchiAdmin, 'anc4-coverage');
    expect(bauchiView.rows.some((row) => row.orgUnitId === SOKOTO)).toBe(false);
    expect((await listIndicatorTargets(admin, 'anc4-coverage')).rows.some((row) => row.orgUnitId === SOKOTO)).toBe(true);

    await removeIndicatorTarget(admin, { indicatorId: 'anc4-coverage', orgUnitId: BAUCHI, periodId: quarter });
    expect(pick((await getScorecard(BAUCHI, quarter))!).target).toBe(pick(before).target);
    await expect(
      removeIndicatorTarget(admin, { indicatorId: 'anc4-coverage', orgUnitId: null, periodId: null }),
    ).rejects.toMatchObject({ status: 422 });
  }, 120_000);
});

describe('data element catalogue', () => {
  it('groups by domain, adolescent SRHR first, then alphabetically, each element once', async () => {
    const view = await getDataElementCatalogue();
    const ids = view.groups.map((group) => group.domainId);
    expect(ids[0]).toBe('adolescent-srhr');
    const names = view.groups.slice(1).filter((group) => group.domainId).map((group) => group.domainName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en-GB')));
    for (const group of view.groups) {
      const items = group.items.map((item) => item.name);
      expect(items).toEqual([...items].sort((a, b) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' })));
    }
    const all = view.groups.flatMap((group) => group.items.map((item) => item.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps administrator configuration apart from source metadata', async () => {
    const element = (await listCatalogue())[0];
    await saveDataElementConfig(element.id, { domainId: 'gbv-response', active: true }, admin.email);
    const view = await getDataElementCatalogue();
    const row = view.groups.flatMap((group) => group.items).find((item) => item.id === element.id)!;
    expect(row.domainId).toBe('gbv-response');
    expect(row.domainSource).toBe('CONFIGURED');
    expect(row.name).toBe(element.name);
  });
});

describe('organisation unit hierarchy', () => {
  it('starts each user at the top of their own access', async () => {
    expect((await scopedChildren(analyst, null)).map((node) => node.level)).toEqual(['COUNTRY']);
    expect((await scopedChildren(bauchiAnalyst, null)).map((node) => node.id)).toEqual([BAUCHI]);
    expect((await scopedChildren(sokotoAnalyst, null)).map((node) => node.id)).toEqual([SOKOTO]);
  });

  it('walks parent to child, and refuses another state by id', async () => {
    const lgas = await scopedChildren(bauchiAnalyst, BAUCHI);
    expect(lgas.length).toBe(20);
    expect(lgas.every((node) => node.level === 'LGA' && node.parentId === BAUCHI)).toBe(true);
    await expect(scopedChildren(bauchiAnalyst, SOKOTO)).rejects.toMatchObject({ status: 403 });
    await expect(scopedChildren(sokotoAnalyst, lgas[0].id)).rejects.toMatchObject({ status: 403 });
  });

  it('never returns another state in search, and stops at LGA for executives', async () => {
    const hits = await searchScoped(bauchiAnalyst, 'al');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.path.some((step) => step.id === SOKOTO) || hit.id === SOKOTO)).toBe(false);
    expect((await searchScoped(sokotoAnalyst, 'Bauchi')).length).toBe(0);

    const lga = (await scopedChildren(executive, BAUCHI))[0];
    expect(lga.hasChildren).toBe(false);
    expect(await scopedChildren(executive, lga.id)).toEqual([]);
    expect(await searchScoped(executive, 'al', 'FACILITY')).toEqual([]);
  });
});

describe('overview map and page context (RBAC)', () => {
  it('gives a global user both states and every LGA', async () => {
    const root = (await getOrgUnit('aspire-programme'))!;
    const map = (await getOverviewMap(root, root, quarter, bands))!;
    expect(map.states.map((state) => state.id).sort()).toEqual([BAUCHI, SOKOTO]);
    expect(map.lgas).toHaveLength(43);
    expect(map.focus).toEqual({ stateId: null, lgaId: null });
    expect(map.lgas.every((lga) => lga.path && lga.bounds)).toBe(true);
  }, 60_000);

  it('confines a state user to their state, and focuses the camera on the selection', async () => {
    for (const [stateId, other] of [[BAUCHI, 'sokoto'], [SOKOTO, 'bauchi']] as const) {
      const state = (await getOrgUnit(stateId))!;
      const lga = (await listOrgUnits('LGA')).find((unit) => unit.parentId === stateId)!;
      const map = (await getOverviewMap(state, lga, quarter, bands))!;
      expect(map.states.map((entry) => entry.id)).toEqual([stateId]);
      expect(map.lgas.some((entry) => entry.id.includes(other) || entry.stateId !== stateId)).toBe(false);
      expect(map.focus).toEqual({ stateId, lgaId: lga.id });
    }
  }, 60_000);

  it('uses the same scores on the map as on the scorecards', async () => {
    const state = (await getOrgUnit(BAUCHI))!;
    const map = (await getOverviewMap(state, state, quarter, bands))!;
    const lga = map.lgas[0];
    expect(lga.score).toBe((await getScorecard(lga.id, quarter))!.overallScore);
    expect(map.states[0].score).toBe((await getScorecard(BAUCHI, quarter))!.overallScore);
  }, 60_000);

  it('falls back to the user’s own root for another state’s id or a level they may not read', async () => {
    const sokotoLga = (await listOrgUnits('LGA')).find((unit) => unit.parentId === SOKOTO)!;
    await signIn(bauchiAnalyst);
    const context = await resolvePageContext({ orgUnit: sokotoLga.id, period: quarter }, { monthly: true });
    expect(context.orgUnit.id).toBe(BAUCHI);
    expect(context.substituted).toBe(true);
    expect(context.orgUnitOptions.some((option) => option.id.includes('sokoto'))).toBe(false);
    expect(context.scopeRoot.id).toBe(BAUCHI);

    const facility = (await listOrgUnits('FACILITY')).find((unit) => unit.path.includes(BAUCHI))!;
    await signIn(executive);
    const forExecutive = await resolvePageContext({ orgUnit: facility.id });
    expect(forExecutive.orgUnit.level).toBe('COUNTRY');
    await signIn(analyst);
    expect((await resolvePageContext({ orgUnit: facility.id })).orgUnit.id).toBe(facility.id);
  });

  it('offers months only where a page supports them, and maps a month to its quarter elsewhere', async () => {
    await signIn(bauchiAnalyst);
    const monthly = await resolvePageContext({ period: month }, { monthly: true });
    expect(monthly.periodId).toBe(month);
    expect(monthly.periodType).toBe('MONTHLY');
    const quarterly = await resolvePageContext({ period: month });
    expect(quarterly.periodId).toBe(quarter);
    expect(quarterly.periodOptions.every((option) => option.type === 'QUARTERLY')).toBe(true);
    expect(monthly.orgUnitPath.map((step) => step.id)).toEqual([BAUCHI]);
  });
});
