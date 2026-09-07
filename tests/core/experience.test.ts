import { describe, expect, it } from 'vitest';
import {
  canReach,
  experienceFor,
  NAV_ROUTES,
  permittedLevels,
  type NavKey,
} from '@/auth/experience';
import { can, PERMISSIONS } from '@/auth/rbac';

const executive = { role: 'EXECUTIVE' as const };
const analyst = { role: 'ANALYST' as const };
const admin = { role: 'ADMIN' as const };

describe('experience configuration', () => {
  it('gives the executive a shorter set of destinations than the analyst', () => {
    const exec = experienceFor(executive).navigation;
    const full = experienceFor(analyst).navigation;
    expect(exec.length).toBeLessThan(full.length);
    // Actions is a follow-up workflow, not a governance surface.
    expect(exec).not.toContain('actions');
    expect(full).toContain('actions');
  });

  it('reserves administration for administrators', () => {
    expect(experienceFor(admin).navigation).toContain('admin');
    expect(experienceFor(analyst).navigation).not.toContain('admin');
    expect(experienceFor(executive).navigation).not.toContain('admin');
  });

  it('stops the executive at area level and lets the analyst reach facilities', () => {
    expect(experienceFor(executive).deepestLevel).toBe('LGA');
    expect(permittedLevels(experienceFor(executive))).not.toContain('FACILITY');
    expect(permittedLevels(experienceFor(analyst))).toContain('FACILITY');
  });

  it('renders a different composition, not the same page trimmed', () => {
    expect(experienceFor(executive).detail).toBe('SUMMARY');
    expect(experienceFor(analyst).detail).toBe('FULL');
  });

  it('withholds row-level evidence from the executive', () => {
    expect(experienceFor(executive).showEvidence).toBe(false);
    expect(experienceFor(analyst).showEvidence).toBe(true);
  });

  it('limits the executive to executive reporting', () => {
    const exec = experienceFor(executive).reportTypes;
    expect(exec).toContain('EXECUTIVE_BRIEF');
    expect(exec).not.toContain('DATA_QUALITY');
    expect(exec).not.toContain('AREA_PERFORMANCE');
    expect(experienceFor(analyst).reportTypes).toContain('DATA_QUALITY');
  });
});

describe('route guarding follows the same list navigation is built from', () => {
  it('refuses a destination that is not in the experience', () => {
    expect(canReach(experienceFor(executive), '/actions')).toBe(false);
    expect(canReach(experienceFor(executive), '/admin')).toBe(false);
    expect(canReach(experienceFor(analyst), '/admin')).toBe(false);
  });

  it('allows every destination that is in the experience', () => {
    for (const key of experienceFor(analyst).navigation) {
      expect(canReach(experienceFor(analyst), NAV_ROUTES[key as NavKey])).toBe(true);
    }
  });

  it('guards nested routes, not only the exact path', () => {
    expect(canReach(experienceFor(executive), '/admin/users')).toBe(false);
    expect(canReach(experienceFor(admin), '/admin/users')).toBe(true);
  });

  it('leaves unknown paths to their own guards rather than blanket-denying', () => {
    expect(canReach(experienceFor(executive), '/sign-in')).toBe(true);
  });
});

describe('capabilities express depth, not just screens', () => {
  it('withholds investigative capabilities from the executive', () => {
    for (const permission of [
      'performance.facility',
      'performance.indicator',
      'quality.detail',
      'quality.triage',
      'actions.manage',
      'reports.detailed',
      'intelligence.evidence',
    ] as const) {
      expect(can('EXECUTIVE', permission)).toBe(false);
      expect(can('ANALYST', permission)).toBe(true);
    }
  });

  it('still lets the executive ask questions and generate reports', () => {
    expect(can('EXECUTIVE', 'intelligence.ask')).toBe(true);
    expect(can('EXECUTIVE', 'reports.generate')).toBe(true);
  });

  it('gives the administrator every capability', () => {
    for (const permission of PERMISSIONS) expect(can('ADMIN', permission)).toBe(true);
  });
});
