import { describe, expect, it } from 'vitest';
import { can, canManageAccount, canTakeAction, isInScope, permissionsFor, PERMISSIONS } from '@/auth/rbac';

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

describe('who can take an action', () => {
  const sokotoPath = ['root', 'state-sokoto'];
  const viewer = { ids: ['root', 'state-bauchi', 'state-sokoto'], rootPath: ['root'] };
  const take = (role: 'EXECUTIVE' | 'ANALYST', scope: string[], active = true, path: string[] | null = sokotoPath) =>
    canTakeAction({ role, scope, active }, path, viewer.ids, viewer.rootPath);

  it('accepts an officer who can read the action\'s area', () => {
    expect(take('ANALYST', ['state-sokoto'])).toBe(true);
    expect(take('ANALYST', [])).toBe(true);
  });

  it('refuses an officer of another state, even though the viewer shares geography with them', () => {
    expect(take('ANALYST', ['state-bauchi'])).toBe(false);
  });

  it('refuses a role that has no Actions workspace', () => {
    expect(take('EXECUTIVE', ['state-sokoto'])).toBe(false);
    expect(take('EXECUTIVE', [])).toBe(false);
  });

  it('refuses a disabled account', () => {
    expect(take('ANALYST', ['state-sokoto'], false)).toBe(false);
  });

  it('falls back to overlap with the viewer when the action names no area', () => {
    expect(take('ANALYST', ['state-bauchi'], true, null)).toBe(true);
  });
});

describe('who can manage an account', () => {
  const bauchi = ['root', 'state-bauchi'];
  const sokoto = ['root', 'state-sokoto'];

  it('lets a programme-wide administrator reset anyone', () => {
    expect(canManageAccount([], [], [])).toBe(true);
    expect(canManageAccount([], ['state-sokoto'], [sokoto])).toBe(true);
  });

  it('lets a state administrator reset accounts inside their state', () => {
    expect(canManageAccount(['state-bauchi'], ['lga-1'], [[...bauchi, 'lga-1']])).toBe(true);
  });

  it('refuses a state administrator a programme-wide account, which would widen their access', () => {
    expect(canManageAccount(['state-bauchi'], [], [])).toBe(false);
  });

  it('refuses an account in another state, or reaching beyond their own', () => {
    expect(canManageAccount(['state-bauchi'], ['state-sokoto'], [sokoto])).toBe(false);
    expect(canManageAccount(['state-bauchi'], ['state-bauchi', 'state-sokoto'], [bauchi, sokoto])).toBe(false);
  });

  it('refuses a scoped administrator granting programme-wide access, by an empty scope', () => {
    expect(canManageAccount(['lga-1'], [], [])).toBe(false);
  });

  it('refuses an LGA administrator the state above them', () => {
    expect(canManageAccount(['lga-1'], ['state-bauchi'], [bauchi])).toBe(false);
  });

  it('refuses when an assigned area can no longer be resolved', () => {
    expect(canManageAccount(['state-bauchi'], ['gone'], [])).toBe(false);
  });
});
