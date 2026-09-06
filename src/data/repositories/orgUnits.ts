import { getDb } from '../db/client';
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
  active: number;
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
    active: row.active === 1,
  };
}

export function listOrgUnits(level?: OrgLevel): OrgUnit[] {
  const db = getDb();
  const rows = (
    level
      ? db.prepare('SELECT * FROM org_units WHERE level = ? AND active = 1 ORDER BY name').all(level)
      : db.prepare('SELECT * FROM org_units WHERE active = 1 ORDER BY level, name').all()
  ) as Row[];
  return rows.map(toOrgUnit);
}

export function getOrgUnit(id: string): OrgUnit | null {
  const row = getDb().prepare('SELECT * FROM org_units WHERE id = ?').get(id) as Row | undefined;
  return row ? toOrgUnit(row) : null;
}

export function listChildren(parentId: string): OrgUnit[] {
  const rows = getDb()
    .prepare('SELECT * FROM org_units WHERE parent_id = ? AND active = 1 ORDER BY name')
    .all(parentId) as Row[];
  return rows.map(toOrgUnit);
}

/** All descendants at a given level, using the materialised path. */
export function listDescendants(rootId: string, level?: OrgLevel): OrgUnit[] {
  const db = getDb();
  const pattern = `%/${rootId}/%`;
  const rows = (
    level
      ? db
          .prepare(
            'SELECT * FROM org_units WHERE path LIKE ? AND level = ? AND id != ? AND active = 1 ORDER BY name',
          )
          .all(pattern, level, rootId)
      : db
          .prepare('SELECT * FROM org_units WHERE path LIKE ? AND id != ? AND active = 1 ORDER BY level, name')
          .all(pattern, rootId)
  ) as Row[];
  return rows.map(toOrgUnit);
}

/** The root of the hierarchy, used as the default scope for national users. */
export function getRootOrgUnit(): OrgUnit | null {
  const row = getDb()
    .prepare('SELECT * FROM org_units WHERE parent_id IS NULL AND active = 1 ORDER BY level LIMIT 1')
    .get() as Row | undefined;
  return row ? toOrgUnit(row) : null;
}

export function upsertOrgUnits(units: OrgUnit[]): void {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO org_units (id, code, name, level, parent_id, path, lon, lat, active)
     VALUES (@id, @code, @name, @level, @parent_id, @path, @lon, @lat, @active)
     ON CONFLICT(id) DO UPDATE SET
       code = excluded.code, name = excluded.name, level = excluded.level,
       parent_id = excluded.parent_id, path = excluded.path,
       lon = excluded.lon, lat = excluded.lat, active = excluded.active`,
  );
  const run = db.transaction((rows: OrgUnit[]) => {
    for (const unit of rows) {
      statement.run({
        id: unit.id,
        code: unit.code,
        name: unit.name,
        level: unit.level,
        parent_id: unit.parentId,
        path: `/${unit.path.join('/')}/`,
        lon: unit.centroid?.lon ?? null,
        lat: unit.centroid?.lat ?? null,
        active: unit.active ? 1 : 0,
      });
    }
  });
  run(units);
}
