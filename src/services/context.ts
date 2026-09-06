import type { OrgUnit } from '@/core/model/types';
import { ORG_LEVEL_DEPTH } from '@/core/model/types';
import { isInScope } from '@/auth/rbac';
import { requireUser, resolveScope } from '@/auth/server';
import type { User } from '@/data/repositories/users';
import { getOrgUnit } from '@/data/repositories/orgUnits';
import { analysisPeriods } from '@/data/sync/periods';
import type { ScopeOption, PeriodOption } from '@/design/patterns/ScopeBar';

export interface PageContext {
  user: User;
  orgUnit: OrgUnit;
  periodId: string;
  periodLabel: string;
  orgUnitOptions: ScopeOption[];
  periodOptions: PeriodOption[];
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
export async function resolvePageContext(searchParams: SearchParams): Promise<PageContext> {
  const user = await requireUser();
  const scope = resolveScope(user);

  const periods = analysisPeriods();
  const periodOptions: PeriodOption[] = [...periods]
    .reverse()
    .map((period) => ({ id: period.id, label: period.label }));

  const requestedPeriod = first(searchParams.period);
  const periodMatch = periods.find((period) => period.id === requestedPeriod);
  const period = periodMatch ?? periods[periods.length - 1];

  const requestedOrgUnit = first(searchParams.orgUnit);
  const candidate = requestedOrgUnit ? getOrgUnit(requestedOrgUnit) : null;
  const usable = candidate && isInScope(user.scope, candidate.path) ? candidate : null;
  const orgUnit = usable ?? scope.root;

  const selectable = scope.units
    .filter((unit) => unit.level !== 'FACILITY')
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
  }));

  return {
    user,
    orgUnit,
    periodId: period.id,
    periodLabel: period.label,
    orgUnitOptions,
    periodOptions,
    substituted: (requestedOrgUnit !== undefined && !usable) || (requestedPeriod !== undefined && !periodMatch),
  };
}
