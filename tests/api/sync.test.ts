import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, dropSchema, isolatedSchema } from '../helpers/db';

const schema = isolatedSchema();
const { runSync } = await import('@/data/sync/orchestrator');
const { listSyncRuns, lastSuccessfulSync } = await import('@/data/repositories/syncRuns');
const { getDataMode, getLastSyncAt } = await import('@/data/repositories/settings');
const { listOrgUnits } = await import('@/data/repositories/orgUnits');
const { listFindings, setFindingStatus } = await import('@/data/repositories/findings');
const { getObservations } = await import('@/data/repositories/observations');
const { latestCompletePeriodId } = await import('@/data/sync/periods');

afterAll(async () => {
  await dropSchema(schema);
});

describe('synchronisation', () => {
  let first: Awaited<ReturnType<typeof runSync>>;

  beforeAll(async () => {
    await createSchema(schema);
    first = await runSync();
  }, 120_000);

  it('imports org units, observations and findings', () => {
    expect(first.ok).toBe(true);
    expect(first.mode).toBe('DEMO');
    expect(first.orgUnits).toBeGreaterThan(100);
    expect(first.observations).toBeGreaterThan(1000);
    expect(first.findings).toBeGreaterThan(0);
  });

  it('records the run, its counts and its outcome', async () => {
    const runs = await listSyncRuns(5);
    expect(runs[0].status).toBe('SUCCESS');
    expect(runs[0].observations).toBe(first.observations);
    expect(runs[0].finishedAt).not.toBeNull();
    expect((await lastSuccessfulSync())?.id).toBe(runs[0].id);
  });

  it('records the data mode and freshness so the interface can state them', async () => {
    expect(await getDataMode()).toBe('DEMO');
    expect(await getLastSyncAt()).not.toBeNull();
  });

  it('is idempotent — a second run does not duplicate rows', async () => {
    const before = (await listOrgUnits()).length;
    const lgaIds = (await listOrgUnits('LGA')).map((unit) => unit.id);
    const observationsBefore = (await getObservations(lgaIds, [latestCompletePeriodId()])).length;

    const second = await runSync();
    expect(second.ok).toBe(true);
    expect((await listOrgUnits()).length).toBe(before);
    expect((await getObservations(lgaIds, [latestCompletePeriodId()])).length).toBe(
      observationsBefore,
    );
  }, 120_000);

  it('preserves a triage decision across a re-sync', async () => {
    const finding = (await listFindings({ status: 'OPEN' }))[0];
    expect(finding).toBeDefined();
    await setFindingStatus(finding.id, 'ACKNOWLEDGED');

    await runSync();

    const after = (await listFindings()).find((entry) => entry.id === finding.id);
    expect(after?.status).toBe('ACKNOWLEDGED');
  }, 120_000);

  it('produces findings across several quality dimensions, not just one', async () => {
    const dimensions = new Set((await listFindings()).map((finding) => finding.dimension));
    expect(dimensions.size).toBeGreaterThanOrEqual(4);
    expect(dimensions.has('COMPLETENESS')).toBe(true);
    expect(dimensions.has('VALIDITY')).toBe(true);
    expect(dimensions.has('CONSISTENCY')).toBe(true);
  });
});
