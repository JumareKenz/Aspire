import type { SourceAdapter } from './port';
import { DemoAdapter } from './demo/adapter';
import { Dhis2Adapter } from './dhis2/adapter';
import { readDhis2Config } from './dhis2/client';

/**
 * Chooses the active source.
 *
 * DHIS2 is used whenever it is configured; otherwise the platform falls back to
 * the demo dataset and says so. There is no mode in which the product shows
 * demo figures while claiming a DHIS2 connection.
 */
export function getSourceAdapter(): SourceAdapter {
  const config = readDhis2Config();
  return config ? new Dhis2Adapter(config) : new DemoAdapter();
}

export function isDhis2Configured(): boolean {
  return readDhis2Config() !== null;
}

export type { SourceAdapter } from './port';
