import { getDb } from '../db/client';
import type { DataMode } from '@/core/model/types';

export interface Dhis2Settings {
  baseUrl: string;
  /** Personal access token or basic-auth pair; never sent to the browser. */
  hasCredentials: boolean;
}

const KEYS = {
  dataMode: 'data.mode',
  lastSyncAt: 'data.lastSyncAt',
  dhis2BaseUrl: 'dhis2.baseUrl',
} as const;

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, new Date().toISOString());
}

/**
 * The active data mode. Defaults to DEMO so that a fresh installation is
 * unambiguous about what it is showing; it becomes DHIS2 only when a DHIS2
 * synchronisation has actually succeeded.
 */
export function getDataMode(): DataMode {
  return getSetting(KEYS.dataMode) === 'DHIS2' ? 'DHIS2' : 'DEMO';
}

export function setDataMode(mode: DataMode): void {
  setSetting(KEYS.dataMode, mode);
}

export function getLastSyncAt(): string | null {
  return getSetting(KEYS.lastSyncAt);
}

export function setLastSyncAt(at: string): void {
  setSetting(KEYS.lastSyncAt, at);
}

export function getDhis2BaseUrl(): string | null {
  return process.env.DHIS2_BASE_URL ?? getSetting(KEYS.dhis2BaseUrl);
}

export const SETTING_KEYS = KEYS;
