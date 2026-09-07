import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, readSessionToken, type SessionClaims } from './session';
import { can, isInScope, type Permission } from './rbac';
import { canReach, experienceFor, permittedLevels, type Experience } from './experience';
import { getUserById, type User } from '@/data/repositories/users';
import { ensureBootstrapped } from '@/data/bootstrap';
import { getOrgUnit, getRootOrgUnit, listOrgUnits } from '@/data/repositories/orgUnits';
import type { OrgUnit } from '@/core/model/types';

/**
 * Resolves the signed-in user.
 *
 * The session claims are re-checked against the database on every request, so
 * deactivating a user or changing their scope takes effect immediately rather
 * than when their token happens to expire.
 */
export async function getCurrentUser(): Promise<User | null> {
  await ensureBootstrapped();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims: SessionClaims | null = await readSessionToken(token);
  if (!claims) return null;
  const user = await getUserById(claims.sub);
  if (!user || !user.active) return null;
  return user;
}

/** For pages: redirects to sign-in when there is no valid session. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  return user;
}

export async function requirePermission(permission: Permission): Promise<User> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect(experienceFor(user).landing);
  return user;
}

/**
 * Guards a whole route against the user's experience.
 *
 * Navigation is generated from the same `navigation` list this consults, so a
 * destination that is not shown is also not reachable by typing its URL — the
 * two cannot drift apart.
 */
export async function requireRoute(pathname: string): Promise<{ user: User; experience: Experience }> {
  const user = await requireUser();
  const experience = experienceFor(user);
  if (!canReach(experience, pathname)) redirect(experience.landing);
  return { user, experience };
}

/** The current user together with their resolved experience. */
export async function currentExperience(): Promise<{ user: User; experience: Experience }> {
  const user = await requireUser();
  return { user, experience: experienceFor(user) };
}

/** The org units a user may see, and the default one to open. */
export interface Scope {
  units: OrgUnit[];
  ids: string[];
  root: OrgUnit;
}

export async function resolveScope(user: User): Promise<Scope> {
  const [all, fallbackRoot] = await Promise.all([listOrgUnits(), getRootOrgUnit()]);
  const levels = permittedLevels(experienceFor(user));
  // Scope is geography *and* depth. Filtering both here means a geography
  // selector can never offer a unit that `assertOrgUnitInScope` would refuse.
  const permitted = all.filter(
    (unit) => isInScope(user.scope, unit.path) && levels.includes(unit.level),
  );

  // A scoped user's root is the highest unit they can see, so an LGA-scoped
  // user opens on their own LGA rather than on a state they cannot inspect.
  const root =
    user.scope.length === 0
      ? (fallbackRoot ?? permitted[0])
      : (permitted
          .filter((unit) => user.scope.includes(unit.id))
          .sort((a, b) => a.path.length - b.path.length)[0] ??
        fallbackRoot ??
        permitted[0]);

  return { units: permitted, ids: permitted.map((unit) => unit.id), root };
}

/**
 * Throws when a user requests an org unit they may not open.
 *
 * Two independent checks, both enforced here rather than in the interface:
 *
 *  - **Geographic scope** — the unit must be within the user's assigned scope.
 *  - **Depth** — the unit's level must be one their experience permits. An
 *    executive is an area-level reader, so a facility id is refused even when
 *    it falls inside their geography.
 *
 * Every API route and page resolves org units through this, so hiding a link
 * is never the thing standing between a user and data they may not have.
 */
export async function assertOrgUnitInScope(user: User, orgUnitId: string): Promise<OrgUnit> {
  const unit = await getOrgUnit(orgUnitId);
  if (!unit) {
    throw new ScopeError(`Unknown organisation unit: ${orgUnitId}`, 404);
  }
  if (!isInScope(user.scope, unit.path)) {
    throw new ScopeError('You do not have access to this organisation unit.', 403);
  }
  if (!permittedLevels(experienceFor(user)).includes(unit.level)) {
    throw new ScopeError(
      'This level of detail is not part of your access. Ask an administrator if you need it.',
      403,
    );
  }
  return unit;
}

export class ScopeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ScopeError';
  }
}
