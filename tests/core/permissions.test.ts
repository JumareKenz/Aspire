import { describe, expect, it } from 'vitest';
import { can, isInScope, permissionsFor, PERMISSIONS } from '@/auth/rbac';

describe('role permissions', () => {
  it('gives executives read access and report generation, but no triage or admin', () => {
    expect(can('EXECUTIVE', 'intelligence.view')).toBe(true);
    expect(can('EXECUTIVE', 'intelligence.ask')).toBe(true);
    expect(can('EXECUTIVE', 'reports.generate')).toBe(true);
    expect(can('EXECUTIVE', 'quality.triage')).toBe(false);
    expect(can('EXECUTIVE', 'actions.manage')).toBe(false);
    expect(can('EXECUTIVE', 'admin.view')).toBe(false);
  });

  it('gives the single programme/LGA/M&E tier the full analytical workspace but not administration', () => {
    expect(can('ANALYST', 'quality.triage')).toBe(true);
    expect(can('ANALYST', 'actions.manage')).toBe(true);
    expect(can('ANALYST', 'admin.view')).toBe(false);
    expect(can('ANALYST', 'admin.sync')).toBe(false);
  });

  it('gives administrators every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(can('ADMIN', permission)).toBe(true);
    }
    expect(permissionsFor('ADMIN')).toHaveLength(PERMISSIONS.length);
  });
});

describe('geographic scope', () => {
  const statePath = ['state-1'];
  const lgaPath = ['state-1', 'lga-1'];
  const facilityPath = ['state-1', 'lga-1', 'fac-1'];
  const otherLgaPath = ['state-1', 'lga-2'];

  it('treats an empty scope as national access', () => {
    expect(isInScope([], statePath)).toBe(true);
    expect(isInScope([], facilityPath)).toBe(true);
  });

  it('grants access to a scoped unit and everything beneath it', () => {
    expect(isInScope(['lga-1'], lgaPath)).toBe(true);
    expect(isInScope(['lga-1'], facilityPath)).toBe(true);
  });

  it('refuses a sibling and refuses the parent above the scope', () => {
    expect(isInScope(['lga-1'], otherLgaPath)).toBe(false);
    expect(isInScope(['lga-1'], statePath)).toBe(false);
  });

  it('accepts any of several scoped units', () => {
    expect(isInScope(['lga-1', 'lga-2'], otherLgaPath)).toBe(true);
  });
});
