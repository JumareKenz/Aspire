import { getDb } from '../db/client';
import type { DomainDefinition, IndicatorDefinition } from '@/core/registry/types';
import type { ScorecardMethodology } from '@/core/scoring/types';
import { DOMAINS } from '@/config/domains';
import { INDICATORS } from '@/config/indicators';
import { METHODOLOGIES } from '@/config/methodology';

/**
 * The indicator registry and the scoring methodology are stored as documents so
 * that both remain configuration. The files in `src/config` seed an empty
 * database; once seeded, the database is authoritative and the admin interface
 * edits it.
 */

export function seedRegistryIfEmpty(): void {
  const db = getDb();
  const indicatorCount = (db.prepare('SELECT COUNT(*) AS n FROM indicator_config').get() as { n: number }).n;
  if (indicatorCount === 0) {
    const statement = db.prepare(
      'INSERT INTO indicator_config (id, definition, updated_at) VALUES (?, ?, ?)',
    );
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const indicator of INDICATORS) statement.run(indicator.id, JSON.stringify(indicator), now);
    })();
  }

  const domainCount = (db.prepare('SELECT COUNT(*) AS n FROM domain_config').get() as { n: number }).n;
  if (domainCount === 0) {
    const statement = db.prepare('INSERT INTO domain_config (id, definition) VALUES (?, ?)');
    db.transaction(() => {
      for (const domain of DOMAINS) statement.run(domain.id, JSON.stringify(domain));
    })();
  }

  const methodologyCount = (db.prepare('SELECT COUNT(*) AS n FROM methodologies').get() as { n: number }).n;
  if (methodologyCount === 0) {
    const statement = db.prepare(
      'INSERT INTO methodologies (id, version, status, document, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const methodology of METHODOLOGIES) {
        statement.run(methodology.id, methodology.version, methodology.status, JSON.stringify(methodology), now);
      }
    })();
  }
}

export function listIndicators(includeInactive = false): IndicatorDefinition[] {
  const rows = getDb().prepare('SELECT definition FROM indicator_config').all() as Array<{
    definition: string;
  }>;
  const indicators = rows.map((row) => JSON.parse(row.definition) as IndicatorDefinition);
  return includeInactive ? indicators : indicators.filter((indicator) => indicator.active);
}

export function getIndicator(id: string): IndicatorDefinition | null {
  const row = getDb().prepare('SELECT definition FROM indicator_config WHERE id = ?').get(id) as
    | { definition: string }
    | undefined;
  return row ? (JSON.parse(row.definition) as IndicatorDefinition) : null;
}

export function saveIndicator(indicator: IndicatorDefinition): void {
  getDb()
    .prepare(
      `INSERT INTO indicator_config (id, definition, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at`,
    )
    .run(indicator.id, JSON.stringify(indicator), new Date().toISOString());
}

export function listDomains(): DomainDefinition[] {
  const rows = getDb().prepare('SELECT definition FROM domain_config').all() as Array<{
    definition: string;
  }>;
  return rows
    .map((row) => JSON.parse(row.definition) as DomainDefinition)
    .sort((a, b) => a.order - b.order);
}

export function listMethodologies(): ScorecardMethodology[] {
  const rows = getDb().prepare('SELECT document FROM methodologies ORDER BY version').all() as Array<{
    document: string;
  }>;
  return rows.map((row) => JSON.parse(row.document) as ScorecardMethodology);
}

/**
 * The methodology used for scoring. An OFFICIAL methodology always takes
 * precedence over a PROVISIONAL one, so publishing the official ASPIRE-GAC
 * methodology switches the platform over without any code change.
 */
export function getActiveMethodology(): ScorecardMethodology {
  const methodologies = listMethodologies();
  const official = methodologies
    .filter((m) => m.status === 'OFFICIAL')
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  if (official.length > 0) return official[0];
  const provisional = methodologies.find((m) => m.status === 'PROVISIONAL');
  if (provisional) return provisional;
  throw new Error('No scoring methodology is configured.');
}

export function saveMethodology(methodology: ScorecardMethodology): void {
  getDb()
    .prepare(
      `INSERT INTO methodologies (id, version, status, document, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET version = excluded.version, status = excluded.status,
         document = excluded.document, updated_at = excluded.updated_at`,
    )
    .run(
      methodology.id,
      methodology.version,
      methodology.status,
      JSON.stringify(methodology),
      new Date().toISOString(),
    );
}
