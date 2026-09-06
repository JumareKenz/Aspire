import type { Role } from '@/data/repositories/users';

/**
 * Capabilities, not screens.
 *
 * LGA, M&E, programme and technical users are one tier (`ANALYST`) sharing one
 * workspace. What differs between them is geographic scope, not the product
 * they see — so there is one set of pages and one set of permissions, and no
 * role-specific duplication.
 */
export const PERMISSIONS = [
  'intelligence.view',
  'intelligence.ask',
  'quality.triage',
  'actions.view',
  'actions.manage',
  'reports.generate',
  'admin.view',
  'admin.manage',
  'admin.sync',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  EXECUTIVE: ['intelligence.view', 'intelligence.ask', 'actions.view', 'reports.generate'],
  ANALYST: [
    'intelligence.view',
    'intelligence.ask',
    'quality.triage',
    'actions.view',
    'actions.manage',
    'reports.generate',
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
 * An empty scope means national access. Otherwise the unit must be one of the
 * scoped units or a descendant of one — which is why org units carry a
 * materialised ancestor path.
 */
export function isInScope(scope: string[], orgUnitPath: string[]): boolean {
  if (scope.length === 0) return true;
  return orgUnitPath.some((ancestorId) => scope.includes(ancestorId));
}

export const ROLE_LABELS: Record<Role, string> = {
  EXECUTIVE: 'Executive',
  ANALYST: 'Programme and M&E',
  ADMIN: 'Administrator',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  EXECUTIVE: 'Performance overview, intelligence and reports across the full scope.',
  ANALYST: 'Full analytical workspace, data-quality triage and follow-up actions.',
  ADMIN: 'Everything, plus users, indicator configuration, synchronisation and audit.',
};
