import { chunk, execute, query, queryOne, valuesClause } from '../db/client';
import type { OrgLevel, OrgUnit } from '@/core/model/types';

interface Row {
  id: string;
  code: string | null;
  name: string;
  level: string;
  parent_id: string | null;
  path: string;
  lon: number | null;
  lat: number | null;
  active: boolean;
}

function toOrgUnit(row: Row): OrgUnit {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    level: row.level as OrgLevel,
    parentId: row.parent_id,
    path: row.path.split('/').filter(Boolean),
    centroid: row.lon !== null && row.lat !== null ? { lon: row.lon, lat: row.lat } : null,
    active: row.active,
  };
}

export async function listOrgUnits(level?: OrgLevel): Promise<OrgUnit[]> {
  const rows = level
    ? await query<Row>('SELECT * FROM org_units WHERE level = $1 AND active ORDER BY name', [level])
    : await query<Row>('SELECT * FROM org_units WHERE active ORDER BY level, name');
  return rows.map(toOrgUnit);
}

export async function getOrgUnit(id: string): Promise<OrgUnit | null> {
  const row = await queryOne<Row>('SELECT * FROM org_units WHERE id = $1', [id]);
  return row ? toOrgUnit(row) : null;
}

export async function listChildren(parentId: string): Promise<OrgUnit[]> {
  const rows = await query<Row>(
    'SELECT * FROM org_units WHERE parent_id = $1 AND active ORDER BY name',
    [parentId],
  );
  return rows.map(toOrgUnit);
}

/** All descendants at a given level, using the materialised path. */
export async function listDescendants(rootId: string, level?: OrgLevel): Promise<OrgUnit[]> {
  const pattern = `%/${rootId}/%`;
  const rows = level
    ? await query<Row>(
        'SELECT * FROM org_units WHERE path LIKE $1 AND level = $2 AND id <> $3 AND active ORDER BY name',
        [pattern, level, rootId],
      )
    : await query<Row>(
        'SELECT * FROM org_units WHERE path LIKE $1 AND id <> $2 AND active ORDER BY level, name',
        [pattern, rootId],
      );
  return rows.map(toOrgUnit);
}

/** The root of the hierarchy, used as the default scope for national users. */
export async function getRootOrgUnit(): Promise<OrgUnit | null> {
  const row = await queryOne<Row>(
    'SELECT * FROM org_units WHERE parent_id IS NULL AND active ORDER BY level LIMIT 1',
  );
  return row ? toOrgUnit(row) : null;
}

export async function upsertOrgUnits(units: OrgUnit[]): Promise<void> {
  if (units.length === 0) return;
  for (const batch of chunk(units, 9)) {
    const { text, params } = valuesClause(
      batch.map((unit) => [
        unit.id,
        unit.code,
        unit.name,
        unit.level,
        unit.parentId,
        `/${unit.path.join('/')}/`,
        unit.centroid?.lon ?? null,
        unit.centroid?.lat ?? null,
        unit.active,
      ]),
    );
    await execute(
      `INSERT INTO org_units (id, code, name, level, parent_id, path, lon, lat, active)
       VALUES ${text}
       ON CONFLICT (id) DO UPDATE SET
         code = EXCLUDED.code, name = EXCLUDED.name, level = EXCLUDED.level,
         parent_id = EXCLUDED.parent_id, path = EXCLUDED.path,
         lon = EXCLUDED.lon, lat = EXCLUDED.lat, active = EXCLUDED.active`,
      params,
    );
  }
}
