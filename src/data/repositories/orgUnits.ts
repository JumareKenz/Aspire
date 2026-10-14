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

/** The root of the hierarchy, used as the default scope for programme-wide users. */
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

/**
 * Marks inactive every unit the source no longer returns, e.g. one removed in
 * DHIS2 or newly excluded by the adapter. Nothing is deleted: history stays
 * attached, and a unit that reappears is reactivated by the next upsert.
 */
export async function deactivateMissingOrgUnits(currentIds: string[]): Promise<number> {
  if (currentIds.length === 0) return 0;
  return execute('UPDATE org_units SET active = FALSE WHERE active AND NOT (id = ANY($1))', [currentIds]);
}

/** Name key for carrying a scope across sources: case, punctuation and spacing ignored. */
function nameKey(level: string, name: string): string {
  return `${level}|${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/**
 * Clears the previous source's geography and data when the source changes,
 * e.g. from demo data to DHIS2.
 *
 * The two sources identify units differently ("state-bauchi" against DHIS2's
 * "ziJ3yxfgb3m"), so an upsert would leave the old hierarchy standing beside
 * the new one, with two roots and every total doubled. User scopes are carried
 * across by matching level and name, so a Bauchi-scoped account stays
 * Bauchi-scoped; a scope with no match is dropped, and its user reported, rather
 * than silently widened.
 */
export async function replaceGeography(next: OrgUnit[]): Promise<{ unmatchedUsers: string[] }> {
  const previous = await query<Row>('SELECT * FROM org_units');
  const nextByName = new Map(next.map((unit) => [nameKey(unit.level, unit.name), unit.id]));
  const remap = new Map(
    previous.map((row) => [row.id, nextByName.get(nameKey(row.level, row.name)) ?? null]),
  );

  const unmatchedUsers: string[] = [];
  const users = await query<{ id: string; email: string; scope: string | null }>(
    'SELECT id, email, scope FROM users',
  );
  for (const user of users) {
    const scope = (user.scope ?? '').split(',').filter(Boolean);
    if (scope.length === 0) continue;
    const mapped = scope.map((id) => remap.get(id) ?? (next.some((unit) => unit.id === id) ? id : null));
    const kept = mapped.filter((id): id is string => id !== null);
    if (kept.length < scope.length) unmatchedUsers.push(user.email);
    // A scope that matched nothing is deactivated rather than emptied: an empty
    // scope means programme-wide access, which would be a silent escalation.
    await execute('UPDATE users SET scope = $1, active = active AND $2 WHERE id = $3', [
      kept.join(','),
      kept.length > 0,
      user.id,
    ]);
  }

  await execute('DELETE FROM observations');
  await execute('DELETE FROM data_element_values');
  await execute('DELETE FROM reporting');
  await execute('DELETE FROM quality_findings');
  await execute("DELETE FROM targets WHERE org_unit_id <> ''");
  await execute('DELETE FROM org_units');
  return { unmatchedUsers };
}
