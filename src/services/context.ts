import type { OrgUnit } from '@/core/model/types';
import { ORG_LEVEL_DEPTH } from '@/core/model/types';
import { isInScope } from '@/auth/rbac';
import { requireUser, resolveScope } from '@/auth/server';
import type { User } from '@/data/repositories/users';
import { getOrgUnit } from '@/data/repositories/orgUnits';
import { analysisMonths, analysisPeriods } from '@/data/sync/periods';
import { listStoredPeriodIds } from '@/data/repositories/observations';
import { quarterOf } from '@/core/model/periods';
import { experienceFor } from '@/auth/experience';
import type { OrgLevel, Period } from '@/core/model/types';
import { defaultPeriodId } from './scorecards';
import type { ScopeOption, PeriodOption } from '@/design/patterns/ScopeBar';

export interface PageContext {
  user: User;
  orgUnit: OrgUnit;
  periodId: string;
  periodLabel: string;
  periodType: Period['type'];
  orgUnitOptions: ScopeOption[];
  periodOptions: PeriodOption[];
  /** The selected unit's ancestors within the user's access, top first, inclusive. */
  orgUnitPath: Array<{ id: string; name: string; level: OrgLevel }>;
  /** The deepest level this user may select, for the hierarchical selector. */
  deepestLevel: OrgLevel;
  /** The top of the user's access. */
  scopeRoot: OrgUnit;
  /** True when the requested org unit or period was not usable and a default was substituted. */
  substituted: boolean;
}

export type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolves the geography and period a page should render.
 *
 * Selections arrive from the URL and are validated against the signed-in
 * user's scope: a link to an out-of-scope geography quietly falls back to the
 * user's own root rather than erroring, because a shared link should still
 * open something useful.
 *
 * Facilities are excluded from the selector — there are too many for a dropdown
 * to be a sensible way to reach one, and they are reached by drilling into an
 * LGA instead.
 */
export async function resolvePageContext(
  searchParams: SearchParams,
  options: { monthly?: boolean } = {},
): Promise<PageContext> {
  const user = await requireUser();
  const scope = await resolveScope(user);

  // Months are offered only where a page supports them, and only once a sync
  // has imported them: a month the store has never held is not a choice.
  const stored = options.monthly ? new Set(await listStoredPeriodIds('MONTHLY')) : new Set<string>();
  const months = analysisMonths().filter((month) => stored.has(month.id));
  const periods = [...analysisPeriods(), ...months];
  const periodOptions: PeriodOption[] = [...periods]
    .reverse()
    .map((period) => ({ id: period.id, label: period.label, type: period.type }));

  const requestedPeriod = first(searchParams.period);
  const periodMatch = periods.find((period) => period.id === requestedPeriod);
  const fallbackId = await defaultPeriodId();
  // A month on a page without monthly support opens on the quarter containing it.
  const asQuarter = requestedPeriod && /^\d{6}$/.test(requestedPeriod) ? quarterOf(requestedPeriod) : null;
  const period =
    periodMatch ??
    periods.find((candidate) => candidate.id === asQuarter) ??
    periods.find((candidate) => candidate.id === fallbackId) ??
    periods.filter((candidate) => candidate.type === 'QUARTERLY').at(-1)!;

  const requestedOrgUnit = first(searchParams.orgUnit);
  const candidate = requestedOrgUnit ? await getOrgUnit(requestedOrgUnit) : null;
  // Geography and depth, as everywhere else: a facility id in an executive's
  // URL opens their own root rather than a level they may not read.
  const usable =
    candidate && isInScope(user.scope, candidate.path) && scope.ids.includes(candidate.id) ? candidate : null;
  const orgUnit = usable ?? scope.root;

  // Wards and facilities are reached by drilling down; hundreds of them in the
  // selector would bury the levels people actually choose between.
  const selectable = scope.units
    .filter((unit) => unit.level !== 'WARD' && unit.level !== 'FACILITY')
    .sort((a, b) =>
      a.path.length === b.path.length
        ? a.name.localeCompare(b.name)
        : a.path.length - b.path.length,
    );
  const rootDepth = ORG_LEVEL_DEPTH[scope.root.level];
  const orgUnitOptions: ScopeOption[] = selectable.map((unit) => ({
    id: unit.id,
    name: unit.name,
    level: unit.level,
    depth: Math.max(0, ORG_LEVEL_DEPTH[unit.level] - rootDepth),
    parentId: unit.parentId,
  }));
  const visible = new Map(scope.units.map((unit) => [unit.id, unit]));
  const orgUnitPath = orgUnit.path
    .map((id) => visible.get(id))
    .filter((unit): unit is OrgUnit => Boolean(unit))
    .map((unit) => ({ id: unit.id, name: unit.name, level: unit.level }));

  return {
    user,
    orgUnit,
    periodId: period.id,
    periodLabel: period.label,
    periodType: period.type,
    orgUnitOptions,
    periodOptions,
    orgUnitPath,
    deepestLevel: experienceFor(user).deepestLevel,
    scopeRoot: scope.root,
    substituted: (requestedOrgUnit !== undefined && !usable) || (requestedPeriod !== undefined && !periodMatch),
  };
}
