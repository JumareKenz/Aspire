import type {
  Dataset,
  Observation,
  OrgLevel,
  OrgUnit,
  Period,
  ReportingRecord,
} from '@/core/model/types';
import type { ConnectionResult, FetchRequest, SourceAdapter } from '../port';
import { Dhis2Client, Dhis2Error, type Dhis2Config } from './client';
import { env } from '@/lib/env';

/**
 * DHIS2 numeric levels do not have a fixed meaning — they depend on how the
 * instance was built. A national deployment usually roots at the country; a
 * state deployment roots at the state, so its level 1 *is* the state.
 *
 * The DHIS2 instance currently configured is a state-rooted deployment
 * organised State → LGA → Ward → Community → Facility, so that is the default.
 * ASPIRE-GAC covers Bauchi and Sokoto, which in a state-rooted instance means
 * one connection per state; a single instance holding both would be rooted a
 * level higher and needs the override below. See docs/SOW_GAP_ANALYSIS.md.
 * `DHIS2_LEVEL_MAP` overrides it for any other shape, e.g.
 * `DHIS2_LEVEL_MAP=1:COUNTRY,2:STATE,3:LGA,4:FACILITY` for a national instance.
 *
 * Getting this wrong is not a cosmetic error: it would file every LGA as a
 * state and every ward as a facility, and every aggregate above them would be
 * computed over the wrong set of units.
 */
const DEFAULT_LEVEL_MAP: Record<number, OrgLevel> = {
  1: 'STATE',
  2: 'LGA',
  // Wards and communities sit between LGA and facility in this hierarchy.
  // The canonical model has no tier for them, so they are folded into the
  // reporting level below the LGA rather than being silently dropped.
  3: 'FACILITY',
  4: 'FACILITY',
  5: 'FACILITY',
};

function readLevelMap(): Record<number, OrgLevel> {
  const configured = env('DHIS2_LEVEL_MAP');
  if (!configured) return DEFAULT_LEVEL_MAP;

  const valid = new Set<OrgLevel>(['COUNTRY', 'STATE', 'LGA', 'FACILITY']);
  const map: Record<number, OrgLevel> = {};
  for (const pair of configured.split(',')) {
    const [rawLevel, rawName] = pair.split(':').map((part) => part.trim());
    const level = Number(rawLevel);
    const name = rawName?.toUpperCase() as OrgLevel | undefined;
    if (!Number.isInteger(level) || level < 1 || !name || !valid.has(name)) {
      throw new Error(
        `DHIS2_LEVEL_MAP is malformed near "${pair}". Expected entries like "1:STATE,2:LGA,3:FACILITY".`,
      );
    }
    map[level] = name;
  }
  if (Object.keys(map).length === 0) return DEFAULT_LEVEL_MAP;
  return map;
}

function periodTypeToDhis2(period: Period): string {
  return period.id;
}

/**
 * Parses an analytics cell.
 *
 * `Number('')` is 0, not NaN, so a bare `Number.isFinite` check would silently
 * turn an empty cell into a reported zero — and a zero is scored, whereas a
 * missing value is excluded. Empty and whitespace cells are therefore treated
 * as absent before any conversion.
 */
function parseCell(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Maps the DHIS2 Web API onto the canonical model.
 *
 * Indicators are only queried when they carry a `source.dx` mapping. An
 * unmapped indicator is skipped and reported, rather than silently returning
 * nothing — an unmapped registry is a configuration problem the administrator
 * needs to see.
 */
export class Dhis2Adapter implements SourceAdapter {
  readonly mode = 'DHIS2' as const;
  readonly label: string;
  private readonly client: Dhis2Client;

  constructor(config: Dhis2Config) {
    this.client = new Dhis2Client(config);
    this.label = config.baseUrl;
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      const info = await this.client.systemInfo();
      return { ok: true, message: `Connected to DHIS2 ${info.version}.`, version: info.version };
    } catch (error) {
      if (error instanceof Dhis2Error) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: 'Could not reach DHIS2.' };
    }
  }

  async fetchOrgUnits(): Promise<OrgUnit[]> {
    const levelMap = readLevelMap();
    const deepest = Math.max(...Object.keys(levelMap).map(Number));
    const units = await this.client.organisationUnits();
    return units
      .filter((unit) => unit.level <= deepest)
      .map((unit) => {
        const path = unit.path.split('/').filter(Boolean);
        const centroid =
          unit.geometry?.type === 'Point' && Array.isArray(unit.geometry.coordinates)
            ? {
                lon: Number((unit.geometry.coordinates as number[])[0]),
                lat: Number((unit.geometry.coordinates as number[])[1]),
              }
            : null;
        return {
          id: unit.id,
          code: unit.code ?? null,
          name: unit.displayName,
          level: levelMap[unit.level] ?? 'FACILITY',
          parentId: unit.parent?.id ?? null,
          path,
          centroid,
          active: true,
        } satisfies OrgUnit;
      });
  }

  async fetchDatasets(): Promise<Dataset[]> {
    const sets = await this.client.dataSets();
    return sets.map((set) => ({
      id: set.id,
      name: set.displayName,
      periodType:
        set.periodType === 'Monthly' ? 'MONTHLY' : set.periodType === 'Yearly' ? 'YEARLY' : 'QUARTERLY',
      dueDays: set.timelyDays ?? 15,
    }));
  }

  /**
   * One analytics request per org level, rather than one per org unit. DHIS2
   * performs the aggregation and returns a compact matrix; nothing raw is
   * pulled into the application.
   */
  async fetchObservations(request: FetchRequest): Promise<Observation[]> {
    const mapped = request.indicators.filter((indicator) => indicator.source.dx);
    if (mapped.length === 0) {
      throw new Dhis2Error(
        'No indicators in the registry are mapped to DHIS2 data. Set a DHIS2 identifier for each indicator in Admin → Indicators before synchronising.',
        null,
        '/analytics',
      );
    }

    const byDx = new Map(mapped.map((indicator) => [indicator.source.dx as string, indicator]));
    const roots = request.orgUnits.filter((unit) => unit.parentId === null);
    const rootIds = (roots.length > 0 ? roots : request.orgUnits).map((unit) => unit.id);

    // `LEVEL-n` in an analytics request means DHIS2's *own* level number, which
    // is not the canonical depth. Invert the configured map to get back to the
    // numbers this instance actually uses, and query each one once.
    const levelMap = readLevelMap();
    const wanted = new Set(request.orgUnits.map((unit) => unit.level));
    const levels = [
      ...new Set(
        Object.entries(levelMap)
          .filter(([, canonical]) => wanted.has(canonical))
          .map(([dhis2Level]) => Number(dhis2Level)),
      ),
    ].sort((a, b) => a - b);

    const observations: Observation[] = [];
    for (const level of levels) {
      const response = await this.client.analytics({
        dx: [...byDx.keys()],
        pe: request.periods.map(periodTypeToDhis2),
        ou: rootIds,
        level,
        includeNumDen: true,
      });

      const columnIndex = new Map(response.headers.map((header, index) => [header.name, index]));
      const dxIndex = columnIndex.get('dx');
      const peIndex = columnIndex.get('pe');
      const ouIndex = columnIndex.get('ou');
      const valueIndex = columnIndex.get('value');
      if (dxIndex === undefined || peIndex === undefined || ouIndex === undefined || valueIndex === undefined) {
        continue;
      }
      const numeratorIndex = columnIndex.get('numerator');
      const denominatorIndex = columnIndex.get('denominator');

      for (const row of response.rows) {
        const indicator = byDx.get(row[dxIndex]);
        if (!indicator) continue;
        const value = parseCell(row[valueIndex]);
        if (value === null) continue;
        observations.push({
          indicatorId: indicator.id,
          orgUnitId: row[ouIndex],
          periodId: row[peIndex],
          value,
          numerator: numeratorIndex === undefined ? null : parseCell(row[numeratorIndex]),
          denominator: denominatorIndex === undefined ? null : parseCell(row[denominatorIndex]),
          disaggregation: null,
        });
      }
    }
    return observations;
  }

  async fetchReporting(request: FetchRequest & { datasets: Dataset[] }): Promise<ReportingRecord[]> {
    const root = request.orgUnits.find((unit) => unit.parentId === null) ?? request.orgUnits[0];
    if (!root) return [];

    const response = await this.client.completeDataSetRegistrations({
      dataSet: request.datasets.map((set) => set.id),
      period: request.periods.map((period) => period.id),
      orgUnit: root.id,
      children: true,
    });

    const registrations = response.completeDataSetRegistrations ?? [];
    const completed = new Map(
      registrations
        .filter((registration) => registration.completed !== false)
        .map((registration) => [
          `${registration.organisationUnit}|${registration.dataSet}|${registration.period}`,
          registration.date ?? null,
        ]),
    );

    // Every reporting org unit is expected to report every dataset in every
    // period; DHIS2 only records the registrations that happened, so absence is
    // what completeness measures.
    const reportingUnits = request.orgUnits.filter((unit) => unit.level === 'FACILITY');
    const records: ReportingRecord[] = [];
    for (const unit of reportingUnits) {
      for (const dataset of request.datasets) {
        for (const period of request.periods) {
          const key = `${unit.id}|${dataset.id}|${period.id}`;
          const submittedAt = completed.get(key);
          const due = new Date(`${period.endDate}T00:00:00Z`);
          due.setUTCDate(due.getUTCDate() + dataset.dueDays);
          records.push({
            orgUnitId: unit.id,
            datasetId: dataset.id,
            periodId: period.id,
            expected: true,
            reported: completed.has(key),
            submittedAt: submittedAt ?? null,
            dueDate: due.toISOString().slice(0, 10),
          });
        }
      }
    }
    return records;
  }
}
