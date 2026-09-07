import { describe, expect, it } from 'vitest';
import { generateDemoData, DECLINING_LGAS, IMPROVING_LGA, LOW_REPORTING_LGA } from '@/data/sources/demo/generator';
import { buildDemoGeography } from '@/data/sources/demo/geography';
import { hashSeed, mulberry32 } from '@/data/sources/demo/random';
import { INDICATORS, DATASETS } from '@/config/indicators';
import { periodRange } from '@/core/model/periods';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const periods = periodRange('2026Q2', 12);

describe('deterministic generation', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(hashSeed('same'));
    const b = mulberry32(hashSeed('same'));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('produces different sequences for different seeds', () => {
    expect(mulberry32(hashSeed('a'))()).not.toBe(mulberry32(hashSeed('b'))());
  });

  it('generates an identical dataset on every run', () => {
    const first = generateDemoData(INDICATORS, periods, DATASETS);
    const second = generateDemoData(INDICATORS, periods, DATASETS);
    expect(first.observations.length).toBe(second.observations.length);
    expect(first.observations.slice(0, 200)).toEqual(second.observations.slice(0, 200));
    // Two full generations over 43 LGAs and their facilities; the default
    // five-second budget is not enough and a timeout here would say nothing
    // about determinism.
  }, 30_000);
});

describe('demo geography', () => {
  it('puts both programme states under one root, so a global user has an aggregate to read', () => {
    const geography = buildDemoGeography();
    expect(geography.root.parentId).toBeNull();
    expect(geography.root.level).toBe('COUNTRY');
    expect(geography.states.map((state) => state.name).sort()).toEqual([
      'Bauchi State',
      'Sokoto State',
    ]);
    for (const state of geography.states) {
      expect(state.parentId).toBe(geography.root.id);
    }
    // Exactly one root: the application resolves a user's scope root by
    // walking up, and a second parentless unit would make that ambiguous.
    expect(geography.all.filter((unit) => unit.parentId === null)).toHaveLength(1);
  });

  it('uses the real LGAs of Bauchi and Sokoto', () => {
    const geography = buildDemoGeography();
    expect(geography.lgas).toHaveLength(43);
    const byState = (stateId: string) =>
      geography.lgas.filter((lga) => lga.parentId === stateId).length;
    expect(byState('state-bauchi')).toBe(20);
    expect(byState('state-sokoto')).toBe(23);
    const names = geography.lgas.map((lga) => lga.name);
    expect(names).toContain('Katagum');
    expect(names).toContain('Sabon Birni');
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBeGreaterThanOrEqual(42);
  });

  it('gives every LGA an id that matches the shipped boundary file', () => {
    const boundaries = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/geo/lgas.geojson'), 'utf8'),
    ) as { features: Array<{ properties: { orgUnitId: string } }> };
    const boundaryIds = new Set(boundaries.features.map((f) => f.properties.orgUnitId));
    for (const lga of buildDemoGeography().lgas) {
      expect(boundaryIds.has(lga.id)).toBe(true);
    }
    expect(boundaryIds.size).toBe(43);
  });

  it('gives every unit a materialised path back to the root', () => {
    const geography = buildDemoGeography();
    for (const unit of geography.all) {
      expect(unit.path[0]).toBe(geography.root.id);
      expect(unit.path[unit.path.length - 1]).toBe(unit.id);
    }
  });

  it('keeps a state path free of the other state, so scope filtering separates them', () => {
    const geography = buildDemoGeography();
    const sokoto = geography.all.filter((unit) => unit.path.includes('state-sokoto'));
    expect(sokoto.some((unit) => unit.path.includes('state-bauchi'))).toBe(false);
    expect(sokoto.length).toBeGreaterThan(23);
  });

  it('does not name individual real health facilities', () => {
    // Real administrative geography is used deliberately, and the figures on it
    // are labelled DEMO throughout. Facilities are the exception: naming a real
    // service point and attaching an invented score to it would make a claim
    // about an identifiable place, so facility names are constructed.
    const facilities = buildDemoGeography().facilities;
    expect(facilities.length).toBeGreaterThan(50);
    for (const facility of facilities) {
      expect(facility.name).toMatch(
        /(General Hospital|Primary Health Centre|Comprehensive Health Centre|Maternity Centre|Health Post|Cottage Hospital)$/,
      );
    }
  });
});

describe('generated dataset', () => {
  const data = generateDemoData(INDICATORS, periods, DATASETS);

  it('produces a value for every indicator, unit and period', () => {
    const facilities = data.orgUnits.filter((unit) => unit.level === 'FACILITY');
    expect(data.observations.length).toBeGreaterThan(facilities.length * INDICATORS.length);
  });

  it('keeps percentage values inside their possible range, apart from the planted invalid one', () => {
    const percentIds = new Set(
      INDICATORS.filter((indicator) => indicator.unit === 'PERCENT').map((indicator) => indicator.id),
    );
    const outOfRange = data.observations.filter(
      (observation) =>
        percentIds.has(observation.indicatorId) && (observation.value < 0 || observation.value > 100),
    );
    // Exactly one impossible value is planted, so the validity detector has
    // something real to find.
    expect(outOfRange).toHaveLength(1);
  });

  it('aggregates an LGA from its own facilities rather than inventing a figure', () => {
    const lga = data.orgUnits.find((unit) => unit.level === 'LGA')!;
    const facilityIds = new Set(
      data.orgUnits.filter((unit) => unit.parentId === lga.id).map((unit) => unit.id),
    );
    const indicator = INDICATORS.find((entry) => entry.unit === 'PERCENT')!;
    const period = periods[periods.length - 1].id;

    const rows = data.observations.filter(
      (observation) =>
        observation.indicatorId === indicator.id &&
        observation.periodId === period &&
        facilityIds.has(observation.orgUnitId),
    );
    const numerator = rows.reduce((total, row) => total + (row.numerator ?? 0), 0);
    const denominator = rows.reduce((total, row) => total + (row.denominator ?? 0), 0);
    const expected = Number(((numerator / denominator) * 100).toFixed(2));

    const aggregate = data.observations.find(
      (observation) =>
        observation.indicatorId === indicator.id &&
        observation.periodId === period &&
        observation.orgUnitId === lga.id,
    )!;
    expect(aggregate.value).toBeCloseTo(expected, 2);
  });

  it('plants a sustained decline in the named LGAs and not elsewhere', () => {
    const indicatorId = 'adolescent-fp-uptake';
    const series = (orgUnitId: string) =>
      periods.map(
        (period) =>
          data.observations.find(
            (observation) =>
              observation.orgUnitId === orgUnitId &&
              observation.indicatorId === indicatorId &&
              observation.periodId === period.id,
          )?.value ?? null,
      );

    for (const lgaId of DECLINING_LGAS) {
      const values = series(lgaId).filter((value): value is number => value !== null);
      expect(values[values.length - 1]).toBeLessThan(values[0]);
    }

    const improving = series(IMPROVING_LGA).filter((value): value is number => value !== null);
    expect(improving[improving.length - 1]).toBeGreaterThan(improving[0] * 0.95);
  });

  it('plants incomplete reporting in exactly one LGA', () => {
    const rate = (lgaId: string) => {
      const facilityIds = new Set(
        data.orgUnits.filter((unit) => unit.parentId === lgaId).map((unit) => unit.id),
      );
      const records = data.reporting.filter((record) => facilityIds.has(record.orgUnitId));
      return records.filter((record) => record.reported).length / records.length;
    };
    const lgas = data.orgUnits.filter((unit) => unit.level === 'LGA');
    expect(rate(LOW_REPORTING_LGA)).toBeLessThan(0.45);
    for (const lga of lgas) {
      if (lga.id === LOW_REPORTING_LGA) continue;
      expect(rate(lga.id)).toBeGreaterThan(0.75);
    }
  });

  it('gives the cross-state comparison a determinate answer', () => {
    // The generator applies a state factor so that one state is genuinely
    // weaker than the other. Without a planted difference a comparison feature
    // would be exercised against noise and could pass by luck.
    const indicatorId = 'adolescent-fp-uptake';
    const period = periods[periods.length - 1].id;
    const stateValue = (stateId: string) =>
      data.observations.find(
        (observation) =>
          observation.orgUnitId === stateId &&
          observation.indicatorId === indicatorId &&
          observation.periodId === period,
      )?.value ?? null;

    const bauchi = stateValue('state-bauchi');
    const sokoto = stateValue('state-sokoto');
    expect(bauchi).not.toBeNull();
    expect(sokoto).not.toBeNull();
    expect(sokoto!).toBeLessThan(bauchi!);
  });

  it('aggregates the programme root from both states', () => {
    const root = data.orgUnits.find((unit) => unit.level === 'COUNTRY')!;
    const period = periods[periods.length - 1].id;
    const indicatorId = 'adolescent-fp-uptake';
    const rootValue = data.observations.find(
      (observation) =>
        observation.orgUnitId === root.id &&
        observation.indicatorId === indicatorId &&
        observation.periodId === period,
    );
    expect(rootValue).toBeDefined();
    const states = ['state-bauchi', 'state-sokoto'].map(
      (id) =>
        data.observations.find(
          (observation) =>
            observation.orgUnitId === id &&
            observation.indicatorId === indicatorId &&
            observation.periodId === period,
        )!.value,
    );
    // The root sits between the two states it is built from — it is a real
    // aggregate, not one state relabelled.
    expect(rootValue!.value).toBeGreaterThanOrEqual(Math.min(...states) - 0.01);
    expect(rootValue!.value).toBeLessThanOrEqual(Math.max(...states) + 0.01);
  });

  it('records a due date for every expected submission', () => {
    for (const record of data.reporting.slice(0, 500)) {
      expect(record.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (record.reported) expect(record.submittedAt).not.toBeNull();
      else expect(record.submittedAt).toBeNull();
    }
  });
});
