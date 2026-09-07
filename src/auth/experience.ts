import type { OrgLevel } from '@/core/model/types';
import type { Role, User } from '@/data/repositories/users';
import type { ReportType } from '@/services/reports';
import { can, type Permission } from './rbac';

/**
 * Experience configuration.
 *
 * This is the layer that was missing, and the reason an executive and an
 * analyst previously saw the same product: navigation was a hard-coded array
 * and pages never consulted the role for *what* to render, only for whether to
 * enable a button. Role therefore changed the trim, not the experience.
 *
 * The pipeline the product needs is:
 *
 *     identity → role + permissions + geographic scope
 *             → experience configuration
 *             → authorised navigation → authorised data → intelligence
 *
 * `Experience` is that third step, resolved once per request and consumed by
 * navigation, pages, services and API routes alike. A component asks the
 * experience what depth it may render; it never branches on the role name.
 * Adding a role means adding a case here, not editing every page.
 */
export type Tier = 'EXECUTIVE' | 'ANALYST' | 'ADMIN';

export const NAV_KEYS = [
  'overview',
  'performance',
  'intelligence',
  'map',
  'reports',
  'actions',
  'admin',
] as const;
export type NavKey = (typeof NAV_KEYS)[number];

export interface Experience {
  tier: Tier;
  /** Where signing in lands, and where an unauthorised route redirects to. */
  landing: string;
  /** Navigation in display order. Anything absent is also route-guarded. */
  navigation: NavKey[];
  /**
   * The deepest organisational level this user may open. Executives work at
   * area level; facility records are operational detail they do not action.
   */
  deepestLevel: OrgLevel;
  /**
   * How much of a page to render. SUMMARY is not "the same page with cards
   * removed" — pages branch on this to choose a different composition.
   */
  detail: 'SUMMARY' | 'FULL';
  /** Report types this user may generate or export. */
  reportTypes: ReportType[];
  /** How many attention items the overview surfaces before it stops. */
  attentionLimit: number;
  /** Whether answers may expose row-level evidence tables. */
  showEvidence: boolean;
}

const EXECUTIVE_REPORTS: ReportType[] = ['EXECUTIVE_BRIEF', 'INTELLIGENCE_SUMMARY'];
const ALL_REPORTS: ReportType[] = [
  'EXECUTIVE_BRIEF',
  'QUARTERLY_PERFORMANCE',
  'AREA_PERFORMANCE',
  'DATA_QUALITY',
  'INTELLIGENCE_SUMMARY',
];

const BY_ROLE: Record<Role, Experience> = {
  EXECUTIVE: {
    tier: 'EXECUTIVE',
    landing: '/overview',
    // No Actions: follow-up assignment is an operational workflow, and adding
    // a destination an executive never uses is a decision they must make on
    // every visit.
    navigation: ['overview', 'performance', 'intelligence', 'map', 'reports'],
    deepestLevel: 'LGA',
    detail: 'SUMMARY',
    reportTypes: EXECUTIVE_REPORTS,
    attentionLimit: 4,
    showEvidence: false,
  },
  ANALYST: {
    tier: 'ANALYST',
    landing: '/overview',
    navigation: ['overview', 'performance', 'intelligence', 'map', 'reports', 'actions'],
    deepestLevel: 'FACILITY',
    detail: 'FULL',
    reportTypes: ALL_REPORTS,
    attentionLimit: 8,
    showEvidence: true,
  },
  ADMIN: {
    tier: 'ADMIN',
    landing: '/overview',
    navigation: ['overview', 'performance', 'intelligence', 'map', 'reports', 'actions', 'admin'],
    deepestLevel: 'FACILITY',
    detail: 'FULL',
    reportTypes: ALL_REPORTS,
    attentionLimit: 8,
    showEvidence: true,
  },
};

export function experienceFor(user: Pick<User, 'role'>): Experience {
  return BY_ROLE[user.role] ?? BY_ROLE.EXECUTIVE;
}

/** Route each navigation key points at, so nav and guards cannot disagree. */
export const NAV_ROUTES: Record<NavKey, string> = {
  overview: '/overview',
  performance: '/performance',
  intelligence: '/intelligence',
  map: '/map',
  reports: '/reports',
  actions: '/actions',
  admin: '/admin',
};

export const NAV_LABELS: Record<NavKey, string> = {
  overview: 'Overview',
  performance: 'Performance',
  intelligence: 'Intelligence',
  map: 'Map',
  reports: 'Reports',
  actions: 'Actions',
  admin: 'Admin',
};

/**
 * Whether a route is part of this user's experience.
 *
 * Derived from the same `navigation` list the sidebar renders, so a link that
 * is not shown is also not reachable by typing the URL.
 */
export function canReach(experience: Experience, pathname: string): boolean {
  const key = (Object.keys(NAV_ROUTES) as NavKey[]).find(
    (nav) => pathname === NAV_ROUTES[nav] || pathname.startsWith(`${NAV_ROUTES[nav]}/`),
  );
  if (!key) return true;
  return experience.navigation.includes(key);
}

/** Org levels this user may open, deepest permitted last. */
export function permittedLevels(experience: Experience): OrgLevel[] {
  const order: OrgLevel[] = ['COUNTRY', 'STATE', 'LGA', 'FACILITY'];
  return order.slice(0, order.indexOf(experience.deepestLevel) + 1);
}

/** Convenience for pages that need both the capability and the depth. */
export function allows(user: Pick<User, 'role'>, permission: Permission): boolean {
  return can(user.role, permission);
}
