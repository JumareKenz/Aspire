import { execute, queryOne } from '../db/client';
import type { DataMode } from '@/core/model/types';
import { env } from '@/lib/env';

const KEYS = {
  dataMode: 'data.mode',
  lastSyncAt: 'data.lastSyncAt',
  latestDataPeriod: 'data.latestPeriod',
  dhis2BaseUrl: 'dhis2.baseUrl',
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await queryOne<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await execute(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, value],
  );
}

/**
 * The active data mode. Defaults to DEMO so that a fresh installation is
 * unambiguous about what it is showing; it becomes DHIS2 only when a DHIS2
 * synchronisation has actually succeeded.
 */
export async function getDataMode(): Promise<DataMode> {
  return (await getSetting(KEYS.dataMode)) === 'DHIS2' ? 'DHIS2' : 'DEMO';
}

export async function setDataMode(mode: DataMode): Promise<void> {
  await setSetting(KEYS.dataMode, mode);
}

export async function getLastSyncAt(): Promise<string | null> {
  return getSetting(KEYS.lastSyncAt);
}

export async function setLastSyncAt(at: string): Promise<void> {
  await setSetting(KEYS.lastSyncAt, at);
}

export async function getDhis2BaseUrl(): Promise<string | null> {
  return env('DHIS2_BASE_URL') ?? (await getSetting(KEYS.dhis2BaseUrl));
}

export const SETTING_KEYS = KEYS;

/** The latest period the top of the hierarchy has data for, as of the last sync. */
export async function getLatestDataPeriod(): Promise<string | null> {
  return getSetting(KEYS.latestDataPeriod);
}

export async function setLatestDataPeriod(periodId: string): Promise<void> {
  await setSetting(KEYS.latestDataPeriod, periodId);
}
