import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each store-backed suite gets its own database file so that suites cannot see
// one another's writes.
const dir = mkdtempSync(join(tmpdir(), 'aspire-store-'));
process.env.ASPIRE_DB_PATH = join(dir, 'test.db');

const { closeDb } = await import('@/data/db/client');
const { upsertOrgUnits, listOrgUnits, listChildren, listDescendants, getRootOrgUnit, getOrgUnit } =
  await import('@/data/repositories/orgUnits');
const { upsertObservations, upsertTargets, getEffectiveTargets, getSeries, getSeriesForUnits, getObservations } =
  await import('@/data/repositories/observations');
const { replaceFindings, listFindings, setFindingStatus } = await import('@/data/repositories/findings');
const { createUser, authenticate, hashPassword, verifyPassword, updateUser } = await import(
  '@/data/repositories/users'
);
const { periodRange } = await import('@/core/model/periods');
import type { OrgUnit } from '@/core/model/types';

const state: OrgUnit = {
  id: 'state-1',
  code: 'S1',
  name: 'State One',
  level: 'STATE',
  parentId: null,
  path: ['state-1'],
  centroid: { lon: 8, lat: 11 },
  active: true,
};
const lga: OrgUnit = {
  id: 'lga-1',
  code: 'L1',
  name: 'LGA One',
  level: 'LGA',
  parentId: 'state-1',
  path: ['state-1', 'lga-1'],
  centroid: null,
  active: true,
};
const facility: OrgUnit = {
  id: 'fac-1',
  code: 'F1',
  name: 'Facility One',
  level: 'FACILITY',
  parentId: 'lga-1',
  path: ['state-1', 'lga-1', 'fac-1'],
  centroid: null,
  active: true,
};

beforeAll(() => {
  upsertOrgUnits([state, lga, facility]);
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('org unit repository', () => {
  it('round-trips a unit including its materialised path', () => {
    const loaded = getOrgUnit('lga-1');
    expect(loaded?.path).toEqual(['state-1', 'lga-1']);
    expect(loaded?.centroid).toBeNull();
    expect(getOrgUnit('state-1')?.centroid).toEqual({ lon: 8, lat: 11 });
  });

  it('finds the root and direct children', () => {
    expect(getRootOrgUnit()?.id).toBe('state-1');
    expect(listChildren('state-1').map((unit) => unit.id)).toEqual(['lga-1']);
  });

  it('finds descendants at a level without including the root itself', () => {
    const facilities = listDescendants('state-1', 'FACILITY');
    expect(facilities.map((unit) => unit.id)).toEqual(['fac-1']);
    expect(listDescendants('state-1').map((unit) => unit.id)).not.toContain('state-1');
  });

  it('filters by level', () => {
    expect(listOrgUnits('LGA').map((unit) => unit.id)).toEqual(['lga-1']);
  });

  it('updates rather than duplicating on re-import', () => {
    upsertOrgUnits([{ ...lga, name: 'LGA One Renamed' }]);
    expect(getOrgUnit('lga-1')?.name).toBe('LGA One Renamed');
    expect(listOrgUnits('LGA')).toHaveLength(1);
  });
});

describe('observation repository', () => {
  const periods = periodRange('2026Q2', 4);

  beforeAll(() => {
    upsertObservations([
      { indicatorId: 'i1', orgUnitId: 'lga-1', periodId: '2025Q3', value: 10, numerator: 10, denominator: 100, disaggregation: null },
      { indicatorId: 'i1', orgUnitId: 'lga-1', periodId: '2026Q1', value: 30, numerator: 30, denominator: 100, disaggregation: null },
      { indicatorId: 'i1', orgUnitId: 'lga-1', periodId: '2026Q2', value: 40, numerator: 40, denominator: 100, disaggregation: null },
      // A disaggregated row must never be mistaken for the total.
      { indicatorId: 'i1', orgUnitId: 'lga-1', periodId: '2026Q2', value: 99, numerator: 99, denominator: 100, disaggregation: 'age:15-19' },
    ]);
  });

  it('returns a series aligned to the period axis with nulls for gaps', () => {
    const series = getSeries('lga-1', periods, ['i1'])['i1'];
    expect(series).toEqual([10, null, 30, 40]);
  });

  it('never mixes a disaggregated value into the total series', () => {
    const series = getSeries('lga-1', periods, ['i1'])['i1'];
    expect(series[3]).toBe(40);
    expect(getObservations(['lga-1'], ['2026Q2'])).toHaveLength(1);
  });

  it('returns an all-null series for an indicator with no data', () => {
    expect(getSeries('lga-1', periods, ['missing'])['missing']).toEqual([null, null, null, null]);
  });

  it('loads many units in one query', () => {
    const byUnit = getSeriesForUnits(['lga-1', 'fac-1'], periods, ['i1']);
    expect(byUnit.get('lga-1')?.['i1']).toEqual([10, null, 30, 40]);
    expect(byUnit.get('fac-1')?.['i1']).toEqual([null, null, null, null]);
  });

  it('overwrites rather than duplicating on re-sync', () => {
    upsertObservations([
      { indicatorId: 'i1', orgUnitId: 'lga-1', periodId: '2026Q2', value: 44, numerator: 44, denominator: 100, disaggregation: null },
    ]);
    expect(getSeries('lga-1', periods, ['i1'])['i1'][3]).toBe(44);
  });
});

describe('targets', () => {
  beforeAll(() => {
    upsertTargets([
      { indicatorId: 'i1', orgUnitId: null, periodId: null, value: 50 },
      { indicatorId: 'i1', orgUnitId: 'lga-1', periodId: null, value: 60 },
      { indicatorId: 'i1', orgUnitId: 'lga-1', periodId: '2026Q2', value: 70 },
      { indicatorId: 'i2', orgUnitId: null, periodId: null, value: 20 },
    ]);
  });

  it('prefers the most specific target available', () => {
    expect(getEffectiveTargets('lga-1', '2026Q2')['i1']).toBe(70);
    expect(getEffectiveTargets('lga-1', '2026Q1')['i1']).toBe(60);
    expect(getEffectiveTargets('fac-1', '2026Q2')['i1']).toBe(50);
  });

  it('falls back to the global default for indicators with no specific target', () => {
    expect(getEffectiveTargets('lga-1', '2026Q2')['i2']).toBe(20);
  });
});

describe('quality findings', () => {
  const finding = {
    id: 'f1',
    dimension: 'VALIDITY' as const,
    severity: 'HIGH' as const,
    orgUnitId: 'lga-1',
    orgUnitName: 'LGA One',
    indicatorId: 'i1',
    indicatorName: 'Indicator One',
    periodId: '2026Q2',
    title: 'Impossible value',
    reason: 'Out of range',
    evidence: [{ label: 'Value', value: '128' }],
    status: 'OPEN' as const,
    detectedAt: '2026-07-01T00:00:00.000Z',
  };

  it('stores and reads back evidence', () => {
    replaceFindings([finding]);
    const [loaded] = listFindings({ orgUnitIds: ['lga-1'] });
    expect(loaded.evidence).toEqual([{ label: 'Value', value: '128' }]);
  });

  it('preserves a triage decision across a re-scan', () => {
    replaceFindings([finding]);
    setFindingStatus('f1', 'ACKNOWLEDGED');
    replaceFindings([finding]);
    expect(listFindings({ status: 'ACKNOWLEDGED' })).toHaveLength(1);
  });

  it('drops findings that a re-scan no longer produces', () => {
    replaceFindings([]);
    expect(listFindings()).toHaveLength(0);
  });

  it('reports when a status change targets a finding that no longer exists', () => {
    expect(setFindingStatus('gone', 'RESOLVED')).toBe(false);
  });
});

describe('user credentials', () => {
  it('salts hashes so identical passwords do not collide', () => {
    const a = hashPassword('correct-horse');
    const b = hashPassword('correct-horse');
    expect(a).not.toBe(b);
    expect(verifyPassword('correct-horse', a)).toBe(true);
    expect(verifyPassword('correct-horse', b)).toBe(true);
  });

  it('rejects the wrong password and malformed stored hashes', () => {
    expect(verifyPassword('wrong', hashPassword('right'))).toBe(false);
    expect(verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('authenticates an active user and refuses a disabled one', () => {
    const user = createUser({
      email: 'Test.User@example.org',
      name: 'Test User',
      role: 'ANALYST',
      scope: ['lga-1'],
      password: 'a-long-enough-password',
    });
    expect(user.email).toBe('test.user@example.org');
    expect(authenticate('TEST.USER@example.org', 'a-long-enough-password')?.id).toBe(user.id);
    expect(authenticate('test.user@example.org', 'wrong')).toBeNull();

    updateUser(user.id, { active: false });
    expect(authenticate('test.user@example.org', 'a-long-enough-password')).toBeNull();
  });

  it('returns null for an unknown account rather than throwing', () => {
    expect(authenticate('nobody@example.org', 'whatever')).toBeNull();
  });
});
