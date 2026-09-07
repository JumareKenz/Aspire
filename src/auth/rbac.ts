import type { Role } from '@/data/repositories/users';

/**
 * Capabilities, not screens.
 *
 * Programme, LGA, M&E and technical users remain one tier (`ANALYST`) sharing
 * one workspace, separated from each other only by geographic scope. What
 * separates them from `EXECUTIVE` is not scope but *depth*: an executive gets a
 * decision-support summary, an analyst gets the investigative workspace.
 *
 * Depth is expressed here as capabilities rather than as `if (role === …)` in
 * components, so that a page asks "may this user drill into a facility?" and
 * never "is this user an executive?". Adding a fourth role later means adding a
 * row to `ROLE_PERMISSIONS`, not auditing every component.
 */
export const PERMISSIONS = [
  'intelligence.view',
  'intelligence.ask',
  /** See the evidence tables and verification behind an answer. */
  'intelligence.evidence',
  /** Drill below the LGA into individual reporting facilities. */
  'performance.facility',
  /** Open an indicator's full history, contributors and outlook. */
  'performance.indicator',
  /** Compare periods and geographies side by side. */
  'performance.compare',
  /**
   * Read more than one state. Held by every role — it is *scope*, not role,
   * that decides whether a user actually has two states to compare, so this
   * capability gates the cross-state surfaces and geographic scope gates the
   * data behind them.
   */
  'geography.crossState',
  /** The full data-quality workspace rather than a confidence summary. */
  'quality.detail',
  'quality.triage',
  'actions.view',
  'actions.manage',
  'reports.generate',
  /** Operational reports beyond the executive brief. */
  'reports.detailed',
  'admin.view',
  'admin.manage',
  'admin.sync',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Decision support: how are we doing, what needs attention, what changed.
  // Deliberately excludes facility drill-down, the data-quality workspace and
  // the follow-up board — those are operational, not governance, concerns.
  EXECUTIVE: [
    'intelligence.view',
    'intelligence.ask',
    'reports.generate',
    'geography.crossState',
  ],
  ANALYST: [
    'intelligence.view',
    'intelligence.ask',
    'intelligence.evidence',
    'performance.facility',
    'performance.indicator',
    'performance.compare',
    'geography.crossState',
    'quality.detail',
    'quality.triage',
    'actions.view',
    'actions.manage',
    'reports.generate',
    'reports.detailed',
  ],
  ADMIN: [...PERMISSIONS],
};

export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: Role, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

/**
 * Whether a user may see an org unit.
 *
 * An empty scope means programme-wide access. Otherwise the unit must be one of the
 * scoped units or a descendant of one — which is why org units carry a
 * materialised ancestor path.
 */
export function isInScope(scope: string[], orgUnitPath: string[]): boolean {
  if (scope.length === 0) return true;
  return orgUnitPath.some((ancestorId) => scope.includes(ancestorId));
}

/**
 * Whether two users share any geography at all.
 *
 * Used where one user is offered a list of others — assigning a follow-up, for
 * example. A Bauchi officer has no business seeing that a Sokoto officer
 * exists, and could not usefully assign them work about a geography neither of
 * them can both open.
 *
 * Overlap runs in both directions: a candidate whose scope sits *inside* the
 * viewer's, and a candidate whose scope *contains* it, are both reachable.
 */
export function scopesOverlap(
  viewerScopeIds: string[],
  viewerRootPath: string[],
  candidateScope: string[],
): boolean {
  // The candidate can read the viewer's root, so everything the viewer sees.
  if (isInScope(candidateScope, viewerRootPath)) return true;
  // Or the candidate sits somewhere inside what the viewer can read.
  return candidateScope.some((id) => viewerScopeIds.includes(id));
}

export const ROLE_LABELS: Record<Role, string> = {
  EXECUTIVE: 'Executive',
  ANALYST: 'Programme and M&E',
  ADMIN: 'Administrator',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  EXECUTIVE:
    'Decision-support summary: overall performance, what needs attention, what changed, and executive reporting.',
  ANALYST:
    'The full investigative workspace: facility drill-down, indicator detail, data-quality triage and follow-up actions.',
  ADMIN: 'Everything, plus users, indicator configuration, synchronisation and audit.',
};
