import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aspire-sync-'));
process.env.ASPIRE_DB_PATH = join(dir, 'test.db');

const { closeDb } = await import('@/data/db/client');
const { runSync } = await import('@/data/sync/orchestrator');
const { listSyncRuns, lastSuccessfulSync } = await import('@/data/repositories/syncRuns');
const { getDataMode, getLastSyncAt } = await import('@/data/repositories/settings');
const { listOrgUnits } = await import('@/data/repositories/orgUnits');
const { listFindings, setFindingStatus } = await import('@/data/repositories/findings');
const { getObservations } = await import('@/data/repositories/observations');
const { latestCompletePeriodId } = await import('@/data/sync/periods');

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('synchronisation', () => {
  let first: Awaited<ReturnType<typeof runSync>>;

  beforeAll(async () => {
    first = await runSync();
  }, 120_000);

  it('imports org units, observations and findings', () => {
    expect(first.ok).toBe(true);
    expect(first.mode).toBe('DEMO');
    expect(first.orgUnits).toBeGreaterThan(100);
    expect(first.observations).toBeGreaterThan(1000);
    expect(first.findings).toBeGreaterThan(0);
  });

  it('records the run, its counts and its outcome', () => {
    const runs = listSyncRuns(5);
    expect(runs[0].status).toBe('SUCCESS');
    expect(runs[0].observations).toBe(first.observations);
    expect(runs[0].finishedAt).not.toBeNull();
    expect(lastSuccessfulSync()?.id).toBe(runs[0].id);
  });

  it('records the data mode and freshness so the interface can state them', () => {
    expect(getDataMode()).toBe('DEMO');
    expect(getLastSyncAt()).not.toBeNull();
  });

  it('is idempotent — a second run does not duplicate rows', async () => {
    const before = listOrgUnits().length;
    const observationsBefore = getObservations(
      listOrgUnits('LGA').map((unit) => unit.id),
      [latestCompletePeriodId()],
    ).length;

    const second = await runSync();
    expect(second.ok).toBe(true);
    expect(listOrgUnits().length).toBe(before);
    expect(
      getObservations(
        listOrgUnits('LGA').map((unit) => unit.id),
        [latestCompletePeriodId()],
      ).length,
    ).toBe(observationsBefore);
  }, 120_000);

  it('preserves a triage decision across a re-sync', async () => {
    const finding = listFindings({ status: 'OPEN' })[0];
    expect(finding).toBeDefined();
    setFindingStatus(finding.id, 'ACKNOWLEDGED');

    await runSync();

    const after = listFindings().find((entry) => entry.id === finding.id);
    expect(after?.status).toBe('ACKNOWLEDGED');
  }, 120_000);

  it('produces findings across several quality dimensions, not just one', () => {
    const dimensions = new Set(listFindings().map((finding) => finding.dimension));
    expect(dimensions.size).toBeGreaterThanOrEqual(4);
    expect(dimensions.has('COMPLETENESS')).toBe(true);
    expect(dimensions.has('VALIDITY')).toBe(true);
    expect(dimensions.has('CONSISTENCY')).toBe(true);
  });
});
