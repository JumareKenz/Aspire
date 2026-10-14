import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSchema, dropSchema, isolatedSchema } from '../helpers/db';
import { DemoAdapter } from '@/data/sources/demo/adapter';

/**
 * What a failing source leaves behind. The adapter is the real demo adapter
 * with one method sabotaged at a time.
 */
const behaviour: { observations: 'normal' | 'empty' | 'throw' } = { observations: 'normal' };
class FlakyAdapter extends DemoAdapter {
  override async fetchObservations(request: Parameters<DemoAdapter['fetchObservations']>[0]) {
    if (behaviour.observations === 'empty') return [];
    if (behaviour.observations === 'throw') throw new Error('DHIS2 responded with 504 Gateway Time-out');
    return super.fetchObservations(request);
  }
}
vi.mock('@/data/sources', () => ({ getSourceAdapter: () => new FlakyAdapter(), isDhis2Configured: () => false }));

const schema = isolatedSchema();
const { ensureBootstrapped } = await import('@/data/bootstrap');
const { runSync } = await import('@/data/sync/orchestrator');
const { queryOne, execute } = await import('@/data/db/client');
const { listProvenance } = await import('@/data/repositories/nhmis');

beforeAll(async () => {
  await createSchema(schema);
  await ensureBootstrapped();
}, 180_000);

afterAll(async () => {
  await dropSchema(schema);
});

const count = async () => Number((await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM observations'))!.n);

describe('sync safety', () => {
  it('fails a sync that imports no values, and keeps the stored data', async () => {
    const before = await count();
    expect(before).toBeGreaterThan(0);
    behaviour.observations = 'empty';
    const result = await runSync();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no values/);
    expect(await count()).toBe(before);
    const run = await queryOne<{ status: string }>('SELECT status FROM sync_runs ORDER BY started_at DESC LIMIT 1');
    expect(run!.status).toBe('FAILED');
  }, 120_000);

  it('records provenance before the slow analytics step, so a failure there cannot blank the pages', async () => {
    await execute('DELETE FROM indicator_provenance');
    behaviour.observations = 'throw';
    const result = await runSync();
    expect(result.ok).toBe(false);
    expect((await listProvenance()).size).toBeGreaterThan(0);
    behaviour.observations = 'normal';
  }, 120_000);
});
