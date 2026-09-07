import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, dropSchema, isolatedSchema } from '../helpers/db';

const schema = isolatedSchema();
const { ensureBootstrapped } = await import('@/data/bootstrap');
const { getMapData } = await import('@/services/geography');
const { latestCompletePeriodId } = await import('@/data/sync/periods');

let periodId: string;

beforeAll(async () => {
  await createSchema(schema);
  await ensureBootstrapped();
  periodId = latestCompletePeriodId();
}, 120_000);

afterAll(async () => {
  await dropSchema(schema);
});

describe('the map at the programme root', () => {
  it('draws every LGA of both states as real boundaries, not two dots', async () => {
    const data = await getMapData('aspire-programme', periodId);
    // The root's children are the two states, and no state boundary file ships
    // with the platform. Drawing the children directly would put two marks on
    // the map; the map descends instead.
    expect(data.mode).toBe('GEOJSON');
    expect(data.drawnLevel).toBe('LGA');
    expect(data.units).toHaveLength(43);
    for (const unit of data.units) {
      expect(unit.path).toBeTruthy();
      expect(unit.groupName).toMatch(/^(Bauchi|Sokoto) State$/);
    }
    expect(data.note).toContain('one level down');
  }, 60_000);

  it('gives each state its own panel rather than one projection across the gap', async () => {
    const data = await getMapData('aspire-programme', periodId);
    expect(data.panels.map((panel) => panel.name).sort()).toEqual(['Bauchi State', 'Sokoto State']);
    // The panels tile the canvas without overlapping.
    const sorted = [...data.panels].sort((a, b) => a.x - b.x);
    expect(sorted[0].x).toBe(0);
    expect(sorted[0].x + sorted[0].width).toBeCloseTo(sorted[1].x, 5);
    expect(sorted[1].x + sorted[1].width).toBeCloseTo(data.width, 5);
    // Every shape falls inside its own panel.
    for (const unit of data.units) {
      const panel = data.panels.find((entry) => entry.name === unit.groupName)!;
      expect(unit.cx).toBeGreaterThanOrEqual(panel.x);
      expect(unit.cx).toBeLessThanOrEqual(panel.x + panel.width);
    }
    // The note says the panels are not to a common scale, because they are not.
    expect(data.note).toContain('not to a common scale');
  }, 60_000);

  it('scores each LGA against its own state, so no figure is borrowed', async () => {
    const data = await getMapData('aspire-programme', periodId);
    const bauchi = data.units.filter((unit) => unit.groupName === 'Bauchi State');
    const sokoto = data.units.filter((unit) => unit.groupName === 'Sokoto State');
    expect(bauchi).toHaveLength(20);
    expect(sokoto).toHaveLength(23);
    for (const unit of bauchi) expect(unit.orgUnitId.startsWith('lga-bauchi-')).toBe(true);
    for (const unit of sokoto) expect(unit.orgUnitId.startsWith('lga-sokoto-')).toBe(true);
    // Every drawn unit carries its own score rather than inheriting the root's.
    expect(data.units.every((unit) => unit.score !== null)).toBe(true);
    expect(new Set(data.units.map((unit) => unit.score)).size).toBeGreaterThan(20);
  }, 60_000);
});

describe('the map inside one state', () => {
  it('draws only that state, which is what a state-scoped user can select', async () => {
    const data = await getMapData('state-bauchi', periodId);
    expect(data.mode).toBe('GEOJSON');
    expect(data.drawnLevel).toBe('LGA');
    expect(data.units).toHaveLength(20);
    // Not descended, so no group label is needed and none is invented.
    expect(data.units.every((unit) => unit.groupName === null)).toBe(true);
    expect(data.units.every((unit) => unit.orgUnitId.startsWith('lga-bauchi-'))).toBe(true);
    expect(data.note).not.toContain('one level down');
    expect(data.panels).toEqual([]);
  }, 60_000);

  it('never draws a unit outside the geography it was asked for', async () => {
    for (const stateId of ['state-bauchi', 'state-sokoto']) {
      const data = await getMapData(stateId, periodId);
      const other = stateId === 'state-bauchi' ? 'sokoto' : 'bauchi';
      expect(data.units.some((unit) => unit.orgUnitId.includes(other))).toBe(false);
    }
  }, 60_000);
});
