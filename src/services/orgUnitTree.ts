import type { OrgLevel, OrgUnit } from '@/core/model/types';
import { ORG_LEVEL_DEPTH } from '@/core/model/types';
import { isInScope } from '@/auth/rbac';
import { experienceFor, permittedLevels } from '@/auth/experience';
import { assertOrgUnitInScope, resolveScope } from '@/auth/server';
import type { User } from '@/data/repositories/users';
import { listChildren, listOrgUnits } from '@/data/repositories/orgUnits';

/**
 * The organisation unit hierarchy, as far as one user may see it.
 *
 * The geography selector walks this tree the way DHIS2's own org unit tree
 * works: start at the top of the user's access, open a unit to load its
 * children, search by name without losing where a result sits. Every call is
 * filtered by the user's geographic scope *and* depth on the server, so a
 * search for another state's LGA returns nothing rather than a disabled row,
 * and an executive's tree stops at LGA level.
 */
export interface TreeNode {
  id: string;
  name: string;
  level: OrgLevel;
  /** DHIS2-style level number: 1 federal, 2 state, 3 LGA, 4 ward, 5 facility. */
  levelNumber: number;
  hasChildren: boolean;
  parentId: string | null;
}

export interface SearchResult extends TreeNode {
  /** Ancestors within the user's access, top first, for showing where a result sits. */
  path: Array<{ id: string; name: string }>;
}

function toNode(unit: OrgUnit, deepest: OrgLevel): TreeNode {
  return {
    id: unit.id,
    name: unit.name,
    level: unit.level,
    levelNumber: ORG_LEVEL_DEPTH[unit.level],
    hasChildren: unit.level !== 'FACILITY' && ORG_LEVEL_DEPTH[unit.level] < ORG_LEVEL_DEPTH[deepest],
    parentId: unit.parentId,
  };
}

/** Children of `parentId`, or the top of the user's access when it is null. */
export async function scopedChildren(user: User, parentId: string | null): Promise<TreeNode[]> {
  const experience = experienceFor(user);
  const levels = permittedLevels(experience);
  if (!parentId) {
    const scope = await resolveScope(user);
    return [toNode(scope.root, experience.deepestLevel)];
  }
  // Scope and depth are checked on the parent before anything beneath it is read.
  await assertOrgUnitInScope(user, parentId);
  const children = await listChildren(parentId);
  return children
    .filter((unit) => isInScope(user.scope, unit.path) && levels.includes(unit.level))
    .map((unit) => toNode(unit, experience.deepestLevel));
}

/** Name search across the units the user may open, with each result's path. */
export async function searchScoped(user: User, text: string, level?: OrgLevel): Promise<SearchResult[]> {
  const needle = text.trim().toLowerCase();
  if (needle.length < 2) return [];
  const experience = experienceFor(user);
  const levels = permittedLevels(experience);
  const all = await listOrgUnits();
  const visible = all.filter((unit) => isInScope(user.scope, unit.path) && levels.includes(unit.level));
  const byId = new Map(visible.map((unit) => [unit.id, unit]));
  return visible
    .filter((unit) => (!level || unit.level === level) && unit.name.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        ORG_LEVEL_DEPTH[a.level] - ORG_LEVEL_DEPTH[b.level] ||
        Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 40)
    .map((unit) => ({
      ...toNode(unit, experience.deepestLevel),
      path: unit.path
        .slice(0, -1)
        .map((id) => byId.get(id))
        .filter((ancestor): ancestor is OrgUnit => Boolean(ancestor))
        .map((ancestor) => ({ id: ancestor.id, name: ancestor.name })),
    }));
}
