import type { OrgLevel, OrgUnit } from '@/core/model/types';
import { ORG_LEVEL_DEPTH } from '@/core/model/types';
import { isInScope } from '@/auth/rbac';
import type { User } from '@/data/repositories/users';
import { getOrgUnit, listChildren, listOrgUnits } from '@/data/repositories/orgUnits';
import { listIndicators } from '@/data/repositories/registry';
import { readLevelMap } from '@/data/sources/dhis2/adapter';
import { Dhis2Client, Dhis2Error, readDhis2Config } from '@/data/sources/dhis2/client';
import { ApiError } from '@/lib/api';

/**
 * The data explorer: ad-hoc analytics against the connected DHIS2 instance.
 *
 * Everything runs on the server with the service account, so the token never
 * reaches the browser. Org units come from ASPIRE's own synchronised hierarchy
 * and are checked against the signed-in user's scope, so the explorer can never
 * reach further than the rest of the platform does.
 */

export interface CatalogueItem {
  id: string;
  name: string;
  kind: 'INDICATOR' | 'DATA_ELEMENT';
  /** Indicator type (e.g. "Percentage") or data element value type. */
  type: string | null;
  groups: string[];
  /** Data elements only: the forms they are reported through. */
  forms: string[];
  /** Data elements only: categories that can split the value, e.g. sex or age. */
  categories: Array<{ id: string; name: string }>;
  /** Indicators only. */
  numerator: string | null;
  denominator: string | null;
  /** The ASPIRE indicator this item feeds, if any. */
  usedBy: string | null;
}

export interface Catalogue {
  source: string;
  loadedAt: string;
  items: CatalogueItem[];
}

declare global {
  var __aspireCatalogue: { key: string; at: number; value: Catalogue } | undefined;
}

/** The catalogue changes when DHIS2 metadata does, which is rarely. */
const CATALOGUE_TTL_MS = 60 * 60 * 1000;

/** DHIS2 value types in words, for the data element list. */
function valueTypeLabel(valueType: string | undefined): string | null {
  if (!valueType) return null;
  if (valueType.startsWith('INTEGER')) return 'Count';
  if (valueType === 'NUMBER' || valueType === 'UNIT_INTERVAL') return 'Number';
  if (valueType === 'PERCENTAGE') return 'Percentage';
  if (valueType === 'BOOLEAN' || valueType === 'TRUE_ONLY') return 'Yes/no';
  if (valueType.includes('TEXT')) return 'Text';
  return valueType.charAt(0) + valueType.slice(1).toLowerCase().replace(/_/g, ' ');
}

function client(): Dhis2Client {
  const config = readDhis2Config();
  if (!config) {
    throw new ApiError('No DHIS2 instance is connected. Set DHIS2_BASE_URL and DHIS2_TOKEN.', 409);
  }
  return new Dhis2Client(config);
}

export function isExplorerAvailable(): boolean {
  return readDhis2Config() !== null;
}

/** Every indicator and aggregate data element on the instance, cached for an hour. */
export async function getCatalogue(options: { refresh?: boolean } = {}): Promise<Catalogue> {
  const dhis2 = client();
  const cached = globalThis.__aspireCatalogue;
  if (!options.refresh && cached && cached.key === dhis2.baseUrl && Date.now() - cached.at < CATALOGUE_TTL_MS) {
    return cached.value;
  }

  const [raw, registry] = await Promise.all([dhis2.catalogue(), listIndicators(true)]);
  const usedBy = new Map<string, string>();
  for (const indicator of registry) {
    const parts = [
      indicator.source.dx,
      ...(indicator.source.numeratorDx ?? '').split('+'),
      ...(indicator.source.denominatorDx ?? '').split('+'),
    ];
    for (const part of parts) {
      const uid = part?.trim().split('.')[0];
      if (uid && !usedBy.has(uid)) usedBy.set(uid, indicator.name);
    }
  }
  const names = (list?: Array<{ displayName: string }>) =>
    [...new Set((list ?? []).map((item) => item.displayName))].sort();

  const items: CatalogueItem[] = [
    ...raw.indicators
      // DHIS2 configuration constants, not data (they return a fixed -1).
      .filter((indicator) => !indicator.displayName.startsWith('[CONFIG]'))
      .map((indicator) => ({
        id: indicator.id,
        name: indicator.displayName,
        kind: 'INDICATOR' as const,
        type: indicator.indicatorType?.displayName ?? null,
        groups: names(indicator.indicatorGroups),
        forms: [],
        categories: [],
        numerator: indicator.numeratorDescription ?? null,
        denominator: indicator.denominatorDescription ?? null,
        usedBy: usedBy.get(indicator.id) ?? null,
      })),
    ...raw.dataElements.map((element) => ({
      id: element.id,
      name: element.displayName,
      kind: 'DATA_ELEMENT' as const,
      type: valueTypeLabel(element.valueType),
      groups: names(element.dataElementGroups),
      forms: names(
        (element.dataSetElements ?? [])
          .map((entry) => entry.dataSet)
          .filter((set): set is { id: string; displayName: string } => Boolean(set)),
      ),
      categories: (element.categoryCombo?.categories ?? [])
        .filter((category) => category.dataDimension !== false && category.displayName !== 'default')
        .map((category) => ({ id: category.id, name: category.displayName })),
      numerator: null,
      denominator: null,
      usedBy: usedBy.get(element.id) ?? null,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const value: Catalogue = { source: dhis2.baseUrl, loadedAt: new Date().toISOString(), items };
  globalThis.__aspireCatalogue = { key: dhis2.baseUrl, at: Date.now(), value };
  return value;
}

export interface TreeNode {
  id: string;
  name: string;
  level: OrgLevel;
  hasChildren: boolean;
}

/**
 * Children of an org unit in the explorer's tree, or the top of the user's
 * scope when no parent is given. The federal tier is not offered: DHIS2 does
 * not serve it to the service account, and the states beneath it are.
 */
export async function orgUnitChildren(user: User, parentId: string | null): Promise<TreeNode[]> {
  let units: OrgUnit[];
  if (parentId) {
    const parent = await getOrgUnit(parentId);
    if (!parent || !isInScope(user.scope, parent.path)) throw new ApiError('That area is outside your access.', 403);
    units = await listChildren(parentId);
  } else {
    const all = (await listOrgUnits()).filter((unit) => isInScope(user.scope, unit.path) && unit.level !== 'COUNTRY');
    const top = Math.min(...all.map((unit) => ORG_LEVEL_DEPTH[unit.level]));
    units = all.filter((unit) => ORG_LEVEL_DEPTH[unit.level] === top);
  }
  return units
    .filter((unit) => unit.active)
    .map((unit) => ({ id: unit.id, name: unit.name, level: unit.level, hasChildren: unit.level !== 'FACILITY' }));
}

/** Search across the user's org units by name, for the tree's search box. */
export async function searchOrgUnits(user: User, text: string): Promise<Array<TreeNode & { parentName: string | null }>> {
  const needle = text.trim().toLowerCase();
  if (needle.length < 2) return [];
  const all = await listOrgUnits();
  const byId = new Map(all.map((unit) => [unit.id, unit]));
  return all
    .filter((unit) => unit.level !== 'COUNTRY' && isInScope(user.scope, unit.path) && unit.name.toLowerCase().includes(needle))
    .slice(0, 40)
    .map((unit) => ({
      id: unit.id,
      name: unit.name,
      level: unit.level,
      hasChildren: unit.level !== 'FACILITY',
      parentName: unit.parentId ? (byId.get(unit.parentId)?.name ?? null) : null,
    }));
}

export interface ExplorerQuery {
  dx: string[];
  periods: string[];
  orgUnits: string[];
  /** Break the selected areas down to this level, e.g. every LGA within them. */
  level: OrgLevel | null;
  /** Split the values by one category of the (single) selected data element. */
  category: string | null;
}

export interface ExplorerResult {
  dimensions: {
    dx: Array<{ id: string; name: string }>;
    pe: Array<{ id: string; name: string }>;
    ou: Array<{ id: string; name: string; level: OrgLevel | null }>;
    co: Array<{ id: string; name: string }> | null;
  };
  rows: Array<{ dx: string; pe: string; ou: string; co: string | null; value: number }>;
  /** The same query as a DHIS2 analytics URL (no credentials), to reproduce it there. */
  dhis2Url: string;
  durationMs: number;
}

const UID = /^[A-Za-z0-9]{11}(\.[A-Za-z0-9]{11})?$/;
const PERIOD = /^(\d{4}(Q[1-4]|\d{2}|S[12])?|THIS_YEAR|LAST_YEAR|LAST_4_QUARTERS|LAST_12_MONTHS|LAST_6_MONTHS|THIS_QUARTER|LAST_QUARTER|LAST_5_YEARS)$/;
export const EXPLORER_LIMITS = { dx: 50, periods: 60, orgUnits: 200, rows: 50_000 } as const;

/** Runs an explorer query against DHIS2 analytics, after checking every input. */
export async function runExplorerQuery(user: User, input: ExplorerQuery): Promise<ExplorerResult> {
  if (input.dx.length === 0) throw new ApiError('Choose at least one indicator or data element.', 400);
  if (input.periods.length === 0) throw new ApiError('Choose at least one period.', 400);
  if (input.orgUnits.length === 0) throw new ApiError('Choose at least one area.', 400);
  if (input.dx.length > EXPLORER_LIMITS.dx) throw new ApiError(`Choose at most ${EXPLORER_LIMITS.dx} data items.`, 400);
  if (input.periods.length > EXPLORER_LIMITS.periods) throw new ApiError(`Choose at most ${EXPLORER_LIMITS.periods} periods.`, 400);
  if (input.orgUnits.length > EXPLORER_LIMITS.orgUnits) throw new ApiError(`Choose at most ${EXPLORER_LIMITS.orgUnits} areas.`, 400);
  if (!input.dx.every((id) => UID.test(id))) throw new ApiError('One of the data items is not a valid DHIS2 identifier.', 400);
  if (!input.periods.every((id) => PERIOD.test(id))) throw new ApiError('One of the periods is not recognised.', 400);
  if (input.category && (!UID.test(input.category) || input.dx.length !== 1)) {
    throw new ApiError('A split by category needs exactly one data element.', 400);
  }

  // Areas: each must be an active unit inside the user's scope. The federal
  // unit is replaced by the states beneath it, which DHIS2 serves.
  const orgUnits: OrgUnit[] = [];
  for (const id of new Set(input.orgUnits)) {
    const unit = await getOrgUnit(id);
    if (!unit || !unit.active || !isInScope(user.scope, unit.path)) {
      throw new ApiError('One of the selected areas is outside your access.', 403);
    }
    if (unit.level === 'COUNTRY') orgUnits.push(...(await listChildren(unit.id)));
    else orgUnits.push(unit);
  }

  let level: number | undefined;
  if (input.level) {
    const entry = Object.entries(readLevelMap()).find(([, canonical]) => canonical === input.level);
    if (!entry) throw new ApiError('That level is not available on this instance.', 400);
    level = Number(entry[0]);
  }

  const params = {
    dx: input.dx,
    pe: input.periods,
    ou: orgUnits.map((unit) => unit.id),
    level,
    includeNumDen: false,
    dimensions: input.category ? [input.category] : [],
  };
  const dhis2 = client();
  const started = Date.now();
  let response;
  try {
    response = await dhis2.analytics(params);
  } catch (error) {
    if (error instanceof Dhis2Error) {
      throw new ApiError(
        error.status === 409
          ? 'DHIS2 could not answer this combination. Some data elements can only be read split by a category, and some items do not exist for the chosen periods.'
          : `DHIS2 did not answer: ${error.message}.`,
        502,
      );
    }
    throw error;
  }
  const durationMs = Date.now() - started;

  const columns = new Map(response.headers.map((header, index) => [header.name, index]));
  const [dxI, peI, ouI, vI] = ['dx', 'pe', 'ou', 'value'].map((name) => columns.get(name));
  const coI = input.category ? columns.get(input.category) : undefined;
  if (dxI === undefined || peI === undefined || ouI === undefined || vI === undefined) {
    throw new ApiError('DHIS2 returned an unexpected response.', 502);
  }
  if (response.rows.length > EXPLORER_LIMITS.rows) {
    throw new ApiError('That query returns too many values. Choose fewer areas, periods or data items.', 413);
  }

  const items = response.metaData?.items ?? {};
  const dimension = response.metaData?.dimensions ?? {};
  const name = (id: string) => (items[id]?.name ?? id).replace(/^[a-z]{2}\s+(?=[A-Z0-9])/, '');
  const known = new Map((await listOrgUnits()).map((unit) => [unit.id, unit]));
  const areaName = (id: string) => (known.get(id)?.name ?? name(id)).replace(/ Local Government Area$/, ' LGA');

  // Only areas ASPIRE holds as active: a level query also returns units the
  // platform excludes (such as the state cold stores filed at LGA level).
  const rows = response.rows
    .map((row) => ({
      dx: row[dxI],
      pe: row[peI],
      ou: row[ouI],
      co: coI === undefined ? null : row[coI],
      value: Number(row[vI]),
    }))
    .filter((row) => Number.isFinite(row.value) && known.has(row.ou));

  return {
    dimensions: {
      dx: (dimension.dx ?? input.dx).map((id) => ({ id, name: name(id) })),
      pe: (dimension.pe ?? [...new Set(rows.map((row) => row.pe))]).map((id) => ({ id, name: items[id]?.name ?? id })),
      ou: (dimension.ou ?? [...new Set(rows.map((row) => row.ou))])
        .filter((id) => known.has(id))
        .map((id) => ({ id, name: areaName(id), level: known.get(id)?.level ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      co: input.category
        ? (dimension[input.category] ?? [...new Set(rows.map((row) => row.co as string))]).map((id) => ({
            id,
            name: name(id),
          }))
        : null,
    },
    rows,
    dhis2Url: dhis2.analyticsUrl(params),
    durationMs,
  };
}
