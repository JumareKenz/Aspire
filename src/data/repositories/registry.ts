import { execute, query, queryOne } from '../db/client';
import type { DomainDefinition, IndicatorDefinition } from '@/core/registry/types';
import type { ScorecardMethodology } from '@/core/scoring/types';
import { DOMAINS } from '@/config/domains';
import { INDICATORS } from '@/config/indicators';
import { METHODOLOGIES } from '@/config/methodology';
import { isReportable, type ProvenanceStatus } from '@/core/registry/provenance';
import { getDataMode } from './settings';

/**
 * The indicator registry and the scoring methodology are stored as JSONB
 * documents so that both remain configuration. The files in `src/config` seed
 * an empty database; once seeded, the database is authoritative and the admin
 * interface edits it.
 */
export async function seedRegistryIfEmpty(): Promise<void> {
  const indicatorCount = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM indicator_config');
  if (Number(indicatorCount?.n ?? 0) === 0) {
    for (const indicator of INDICATORS) {
      await execute(
        `INSERT INTO indicator_config (id, definition, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [indicator.id, JSON.stringify(indicator)],
      );
    }
  }

  const domainCount = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM domain_config');
  if (Number(domainCount?.n ?? 0) === 0) {
    for (const domain of DOMAINS) {
      await execute(
        'INSERT INTO domain_config (id, definition) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [domain.id, JSON.stringify(domain)],
      );
    }
  }

  const methodologyCount = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM methodologies');
  if (Number(methodologyCount?.n ?? 0) === 0) {
    for (const methodology of METHODOLOGIES) {
      await execute(
        `INSERT INTO methodologies (id, version, status, document, updated_at)
         VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (id) DO NOTHING`,
        [methodology.id, methodology.version, methodology.status, JSON.stringify(methodology)],
      );
    }
  }
}

export async function listIndicators(includeInactive = false): Promise<IndicatorDefinition[]> {
  const rows = await query<{ definition: IndicatorDefinition }>('SELECT definition FROM indicator_config');
  const indicators = rows.map((row) => row.definition);
  return includeInactive ? indicators : indicators.filter((indicator) => indicator.active);
}

/**
 * The indicators that make up the reporting workflow: active, and — against
 * DHIS2 — verified as drawing only on approved NHMIS forms (or an explicitly
 * approved exception). Every scorecard, report, map, breakdown, target and
 * answer is built from this list, so an unverified indicator cannot reach a
 * screen by any route; filtering in the interface would not be enough.
 *
 * Before the first governed synchronisation no indicator has been verified, so
 * nothing is reported. That is deliberate: the alternative is reporting
 * figures nobody has checked the provenance of.
 *
 * The demo dataset is synthetic and labelled as such everywhere; its
 * indicators carry status DEMO and are all reported.
 */
export async function listReportingIndicators(): Promise<IndicatorDefinition[]> {
  const mode = await getDataMode();
  const rows = await query<{ definition: IndicatorDefinition; status: ProvenanceStatus | null }>(
    `SELECT ic.definition, p.status FROM indicator_config ic
     LEFT JOIN indicator_provenance p ON p.indicator_id = ic.id`,
  );
  return rows
    .filter((row) => row.definition.active)
    .filter((row) => (mode === 'DEMO' ? row.status === null || row.status === 'DEMO' : isReportable(row.status) && row.status !== 'DEMO'))
    .map((row) => row.definition);
}

export async function getIndicator(id: string): Promise<IndicatorDefinition | null> {
  const row = await queryOne<{ definition: IndicatorDefinition }>(
    'SELECT definition FROM indicator_config WHERE id = $1',
    [id],
  );
  return row?.definition ?? null;
}

export async function saveIndicator(indicator: IndicatorDefinition): Promise<void> {
  await execute(
    `INSERT INTO indicator_config (id, definition, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at`,
    [indicator.id, JSON.stringify(indicator)],
  );
}

export async function listDomains(): Promise<DomainDefinition[]> {
  const rows = await query<{ definition: DomainDefinition }>('SELECT definition FROM domain_config');
  return rows.map((row) => row.definition).sort((a, b) => a.order - b.order);
}

export async function listMethodologies(): Promise<ScorecardMethodology[]> {
  const rows = await query<{ document: ScorecardMethodology }>(
    'SELECT document FROM methodologies ORDER BY version',
  );
  return rows.map((row) => row.document);
}

/**
 * The methodology used for scoring. An OFFICIAL methodology always takes
 * precedence over a PROVISIONAL one, so publishing the official ASPIRE-GAC
 * methodology switches the platform over without any code change.
 */
export async function getActiveMethodology(): Promise<ScorecardMethodology> {
  const methodologies = await listMethodologies();
  const official = methodologies
    .filter((m) => m.status === 'OFFICIAL')
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  if (official.length > 0) return official[0];
  const provisional = methodologies.find((m) => m.status === 'PROVISIONAL');
  if (provisional) return provisional;
  throw new Error('No scoring methodology is configured.');
}

export async function saveMethodology(methodology: ScorecardMethodology): Promise<void> {
  await execute(
    `INSERT INTO methodologies (id, version, status, document, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, status = EXCLUDED.status,
       document = EXCLUDED.document, updated_at = EXCLUDED.updated_at`,
    [methodology.id, methodology.version, methodology.status, JSON.stringify(methodology)],
  );
}
