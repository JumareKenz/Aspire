import { chunk, execute, query, valuesClause } from '../db/client';
import type { IndicatorProvenance, ProvenanceStatus } from '@/core/registry/provenance';

/** A data element on an approved NHMIS form, with the platform's configuration for it. */
export interface DataElementRecord {
  id: string;
  name: string;
  shortName: string | null;
  code: string | null;
  valueType: string | null;
  aggregationType: string | null;
  formIds: string[];
  categories: Array<{ id: string; name: string }>;
  synthetic: boolean;
  /** Still on an approved form as of the last synchronisation. */
  active: boolean;
  syncedAt: string;
  config: { domainId: string | null; active: boolean; updatedAt: string; updatedBy: string | null } | null;
}

export interface FormRecord {
  id: string;
  name: string;
  periodType: string | null;
  synthetic: boolean;
  active: boolean;
}

export interface SourceDataElementInput {
  id: string;
  name: string;
  shortName: string | null;
  code: string | null;
  valueType: string | null;
  aggregationType: string | null;
  formIds: string[];
  categories: Array<{ id: string; name: string }>;
}

/**
 * Replaces the catalogue with what the source reports for the approved forms.
 * Upserts what is present and marks the rest inactive; nothing is deleted and
 * platform configuration (`data_element_config`) is never touched.
 */
export async function replaceCatalogue(
  forms: Array<{ id: string; name: string; periodType: string | null }>,
  elements: SourceDataElementInput[],
  synthetic: boolean,
): Promise<void> {
  for (const form of forms) {
    await execute(
      `INSERT INTO nhmis_forms (id, name, period_type, synthetic, active, synced_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, period_type = EXCLUDED.period_type,
         synthetic = EXCLUDED.synthetic, active = TRUE, synced_at = EXCLUDED.synced_at`,
      [form.id, form.name, form.periodType, synthetic],
    );
  }
  await execute('UPDATE nhmis_forms SET active = FALSE WHERE NOT (id = ANY($1))', [forms.map((form) => form.id)]);

  for (const batch of chunk(elements, 10)) {
    const { text, params } = valuesClause(
      batch.map((element) => [
        element.id,
        element.name,
        element.shortName,
        element.code,
        element.valueType,
        element.aggregationType,
        element.formIds.join(','),
        JSON.stringify(element.categories),
        synthetic,
        true,
      ]),
    );
    await execute(
      `INSERT INTO nhmis_data_elements
         (id, name, short_name, code, value_type, aggregation_type, form_ids, categories, synthetic, active, synced_at)
       SELECT v.id, v.name, v.short_name, v.code, v.value_type, v.aggregation_type, v.form_ids,
              v.categories::jsonb, v.synthetic::boolean, v.active::boolean, NOW()
       FROM (VALUES ${text}) AS v(id, name, short_name, code, value_type, aggregation_type, form_ids, categories, synthetic, active)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, short_name = EXCLUDED.short_name,
         code = EXCLUDED.code, value_type = EXCLUDED.value_type, aggregation_type = EXCLUDED.aggregation_type,
         form_ids = EXCLUDED.form_ids, categories = EXCLUDED.categories, synthetic = EXCLUDED.synthetic,
         active = TRUE, synced_at = EXCLUDED.synced_at`,
      params,
    );
  }
  await execute('UPDATE nhmis_data_elements SET active = FALSE WHERE active AND NOT (id = ANY($1))', [
    elements.map((element) => element.id),
  ]);
}

interface ElementRow {
  id: string;
  name: string;
  short_name: string | null;
  code: string | null;
  value_type: string | null;
  aggregation_type: string | null;
  form_ids: string;
  categories: Array<{ id: string; name: string }>;
  synthetic: boolean;
  active: boolean;
  synced_at: Date | string;
  config_domain: string | null;
  config_active: boolean | null;
  config_updated_at: Date | string | null;
  config_updated_by: string | null;
}

const iso = (value: Date | string) => (typeof value === 'string' ? value : value.toISOString());

/** The catalogue, joined to platform configuration. Inactive entries only on request. */
export async function listCatalogue(options: { includeInactive?: boolean } = {}): Promise<DataElementRecord[]> {
  const rows = await query<ElementRow>(
    `SELECT e.*, c.domain_id AS config_domain, c.active AS config_active,
            c.updated_at AS config_updated_at, c.updated_by AS config_updated_by
     FROM nhmis_data_elements e LEFT JOIN data_element_config c ON c.id = e.id
     ${options.includeInactive ? '' : 'WHERE e.active'}
     ORDER BY e.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    code: row.code,
    valueType: row.value_type,
    aggregationType: row.aggregation_type,
    formIds: row.form_ids.split(',').filter(Boolean),
    categories: row.categories ?? [],
    synthetic: row.synthetic,
    active: row.active,
    syncedAt: iso(row.synced_at),
    config:
      row.config_active === null
        ? null
        : {
            domainId: row.config_domain,
            active: row.config_active,
            updatedAt: iso(row.config_updated_at!),
            updatedBy: row.config_updated_by,
          },
  }));
}

export async function listForms(): Promise<FormRecord[]> {
  const rows = await query<{ id: string; name: string; period_type: string | null; synthetic: boolean; active: boolean }>(
    'SELECT id, name, period_type, synthetic, active FROM nhmis_forms ORDER BY name',
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    periodType: row.period_type,
    synthetic: row.synthetic,
    active: row.active,
  }));
}

export async function saveDataElementConfig(
  id: string,
  config: { domainId: string | null; active: boolean },
  updatedBy: string,
): Promise<void> {
  await execute(
    `INSERT INTO data_element_config (id, domain_id, active, updated_at, updated_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (id) DO UPDATE SET domain_id = EXCLUDED.domain_id, active = EXCLUDED.active,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [id, config.domainId, config.active, updatedBy],
  );
}

/** Records each indicator's provenance from this synchronisation. */
export async function saveProvenance(entries: IndicatorProvenance[]): Promise<void> {
  for (const entry of entries) {
    await execute(
      `INSERT INTO indicator_provenance (indicator_id, status, detail, checked_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (indicator_id) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail,
         checked_at = EXCLUDED.checked_at`,
      [entry.indicatorId, entry.status, JSON.stringify(entry)],
    );
  }
}

export async function listProvenance(): Promise<Map<string, IndicatorProvenance & { checkedAt: string }>> {
  const rows = await query<{ indicator_id: string; status: ProvenanceStatus; detail: IndicatorProvenance; checked_at: Date | string }>(
    'SELECT indicator_id, status, detail, checked_at FROM indicator_provenance',
  );
  return new Map(
    rows.map((row) => [row.indicator_id, { ...row.detail, status: row.status, checkedAt: iso(row.checked_at) }]),
  );
}

export interface DataElementValue {
  dx: string;
  orgUnitId: string;
  periodId: string;
  value: number;
}

export async function upsertDataElementValues(values: DataElementValue[]): Promise<void> {
  for (const batch of chunk(values, 4)) {
    const { text, params } = valuesClause(batch.map((row) => [row.dx, row.orgUnitId, row.periodId, row.value]));
    await execute(
      `INSERT INTO data_element_values (dx, org_unit_id, period_id, value) VALUES ${text}
       ON CONFLICT (dx, org_unit_id, period_id) DO UPDATE SET value = EXCLUDED.value`,
      params,
    );
  }
}

/** Values for the given references, units and periods, keyed "dx|orgUnit|period". */
export async function getDataElementValues(
  dx: string[],
  orgUnitIds: string[],
  periodIds: string[],
): Promise<Map<string, number>> {
  if (dx.length === 0 || orgUnitIds.length === 0 || periodIds.length === 0) return new Map();
  const rows = await query<{ dx: string; org_unit_id: string; period_id: string; value: number }>(
    `SELECT dx, org_unit_id, period_id, value FROM data_element_values
     WHERE dx = ANY($1) AND org_unit_id = ANY($2) AND period_id = ANY($3)`,
    [dx, orgUnitIds, periodIds],
  );
  return new Map(rows.map((row) => [`${row.dx}|${row.org_unit_id}|${row.period_id}`, Number(row.value)]));
}
