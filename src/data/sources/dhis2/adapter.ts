import {
  ORG_LEVELS,
  type Dataset,
  type Observation,
  type OrgLevel,
  type OrgUnit,
  type Period,
  type ReportingRecord,
} from '@/core/model/types';
import type { ConnectionResult, FetchRequest, SourceAdapter } from '../port';
import type { IndicatorDefinition } from '@/core/registry/types';
import { Dhis2Client, Dhis2Error, type Dhis2Config } from './client';
import { env } from '@/lib/env';

/**
 * DHIS2 numeric levels do not have a fixed meaning — they depend on how the
 * instance was built. The configured instance is the national one, organised
 * Federal → State → LGA → Ward → Facility, so that is the default.
 * `DHIS2_LEVEL_MAP` overrides it for any other shape, e.g.
 * `DHIS2_LEVEL_MAP=1:STATE,2:LGA,3:WARD,5:FACILITY` for a state-rooted instance.
 *
 * A DHIS2 level left out of the map is skipped: its units are not imported and
 * the units beneath them are attached to their nearest mapped ancestor. That is
 * how an extra tier, such as a community level between ward and facility, is
 * collapsed without filing it as something it is not.
 *
 * Getting this wrong is not a cosmetic error: it would file every LGA as a
 * state and every ward as a facility, and every aggregate above them would be
 * computed over the wrong set of units.
 */
const DEFAULT_LEVEL_MAP: Record<number, OrgLevel> = {
  1: 'COUNTRY',
  2: 'STATE',
  3: 'LGA',
  4: 'WARD',
  5: 'FACILITY',
};

function readLevelMap(): Record<number, OrgLevel> {
  const configured = env('DHIS2_LEVEL_MAP');
  if (!configured) return DEFAULT_LEVEL_MAP;

  const valid = new Set<OrgLevel>(ORG_LEVELS);
  const map: Record<number, OrgLevel> = {};
  for (const pair of configured.split(',')) {
    const [rawLevel, rawName] = pair.split(':').map((part) => part.trim());
    const level = Number(rawLevel);
    const name = rawName?.toUpperCase() as OrgLevel | undefined;
    if (!Number.isInteger(level) || level < 1 || !name || !valid.has(name)) {
      throw new Error(
        `DHIS2_LEVEL_MAP is malformed near "${pair}". Expected entries like "1:COUNTRY,2:STATE,3:LGA,4:WARD,5:FACILITY".`,
      );
    }
    map[level] = name;
  }
  if (Object.keys(map).length === 0) return DEFAULT_LEVEL_MAP;
  return map;
}

/**
 * The national instance prefixes every unit with its state's two-letter code
 * ("ba Bauchi State", "so Kebbe Local Government Area"). The prefix is a DHIS2
 * sorting convention, not part of the name, and it would otherwise appear on
 * every screen and defeat matching a question like "how is Bauchi doing?".
 */
function cleanName(name: string): string {
  return name.replace(/^[a-z]{2}\s+(?=[A-Z0-9])/, '').trim();
}

/** Analytics requests are split by period so no single query outlives the timeout. */
const PERIODS_PER_REQUEST = 4;

/**
 * Analytics requests in flight at once. A sync must finish inside one
 * serverless request, and one-at-a-time requests to a distant instance spend
 * most of that budget waiting; a handful in parallel stays polite to DHIS2.
 */
const CONCURRENT_REQUESTS = 4;

/** Runs `task` over `items` with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Start date of a DHIS2 period id, for the period types the platform consumes. */
function periodStart(id: string): string | null {
  const monthly = /^(\d{4})(\d{2})$/.exec(id);
  if (monthly) return `${monthly[1]}-${monthly[2]}-01`;
  const quarterly = /^(\d{4})Q([1-4])$/.exec(id);
  if (quarterly) {
    const month = (Number(quarterly[2]) - 1) * 3 + 1;
    return `${quarterly[1]}-${String(month).padStart(2, '0')}-01`;
  }
  const yearly = /^(\d{4})$/.exec(id);
  if (yearly) return `${yearly[1]}-01-01`;
  return null;
}

/** How many of a data set's own periods make up one analysis period. */
function submissionsPerPeriod(dataset: Dataset, period: Period): number {
  if (dataset.periodType === 'MONTHLY') {
    if (period.type === 'QUARTERLY') return 3;
    if (period.type === 'YEARLY') return 12;
  }
  if (dataset.periodType === 'QUARTERLY' && period.type === 'YEARLY') return 4;
  return 1;
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
 * Combines the values of several units into their parent's value.
 *
 * Used for units above the service user's data-view roots — the federal tier,
 * whose own analytics DHIS2 will not return to a user scoped to two states.
 * Ratios are recombined from their numerators and denominators, never averaged,
 * so the larger state weighs more, exactly as DHIS2 would aggregate it. Values
 * with no numerator or denominator are counts and are summed. Anything else is
 * left absent rather than approximated.
 */
function combine(parts: Observation[]): Observation | null {
  const first = parts[0];
  if (!first) return null;
  const withRatio = parts.every((part) => part.numerator !== null && part.denominator !== null);
  if (withRatio) {
    const numerator = parts.reduce((sum, part) => sum + (part.numerator ?? 0), 0);
    const denominator = parts.reduce((sum, part) => sum + (part.denominator ?? 0), 0);
    if (denominator === 0) return null;
    // The indicator type's factor (100 for a percentage, 1000 for a rate per
    // thousand) is recovered from any part where it is observable.
    const sample = parts.find((part) => part.numerator !== 0 && part.denominator !== 0);
    const factor = sample ? (sample.value * sample.denominator!) / sample.numerator! : null;
    if (factor === null && numerator !== 0) return null;
    return {
      ...first,
      value: numerator === 0 ? 0 : (factor! * numerator) / denominator,
      numerator,
      denominator,
    };
  }
  const isCount = parts.every((part) => part.numerator === null && part.denominator === null);
  if (!isCount) return null;
  return {
    ...first,
    value: parts.reduce((sum, part) => sum + part.value, 0),
    numerator: null,
    denominator: null,
  };
}

/** Component UIDs of a numerator or denominator written as "uidA+uidB". */
function components(expression: string | null): string[] {
  return (expression ?? '').split('+').map((part) => part.trim()).filter(Boolean);
}

/** The multiplier an indicator's unit implies for numerator ÷ denominator. */
function unitFactor(unit: IndicatorDefinition['unit']): number {
  if (unit === 'PERCENT') return 100;
  if (unit === 'RATE_PER_1000') return 1000;
  if (unit === 'RATE_PER_100000') return 100000;
  return 1;
}

/**
 * An indicator is fetched either as one DHIS2 indicator or data element
 * (`source.dx`), or, where DHIS2 has no usable indicator, calculated here
 * from data elements (`source.numeratorDx` ÷ `source.denominatorDx`, each one
 * or more UIDs joined with "+").
 */
function isCalculated(indicator: IndicatorDefinition): boolean {
  return !indicator.source.dx && components(indicator.source.numeratorDx).length > 0 &&
    components(indicator.source.denominatorDx).length > 0;
}

/**
 * Maps the DHIS2 Web API onto the canonical model.
 *
 * Everything is scoped to the service user's data-view org units (or
 * `DHIS2_ROOT_ORG_UNITS`), plus the mapped ancestors above them. On the
 * national instance that is Bauchi and Sokoto beneath the federal tier: a few
 * thousand units rather than the sixty thousand the instance holds.
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
  private roots: string[] | null = null;

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

  /** The org units whose subtrees the platform imports and queries. */
  private async scopeRoots(): Promise<string[]> {
    if (this.roots) return this.roots;
    const configured = env('DHIS2_ROOT_ORG_UNITS')
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (configured && configured.length > 0) {
      this.roots = configured;
      return configured;
    }
    const me = await this.client.me();
    const units = me.dataViewOrganisationUnits?.length
      ? me.dataViewOrganisationUnits
      : (me.organisationUnits ?? []);
    if (units.length === 0) {
      throw new Dhis2Error(
        'The DHIS2 user has no data view org units. Assign them in DHIS2, or set DHIS2_ROOT_ORG_UNITS.',
        null,
        '/me',
      );
    }
    this.roots = units.map((unit) => unit.id);
    return this.roots;
  }

  async fetchOrgUnits(): Promise<OrgUnit[]> {
    const levelMap = readLevelMap();
    const roots = await this.scopeRoots();

    const subtrees = await Promise.all(roots.map((root) => this.client.organisationUnits({ root })));
    const units = new Map(subtrees.flat().map((unit) => [unit.id, unit]));

    // Ancestors above the roots, so the hierarchy keeps its federal tier.
    const ancestorIds = [
      ...new Set(
        roots.flatMap((root) => units.get(root)?.path.split('/').filter(Boolean).slice(0, -1) ?? []),
      ),
    ].filter((id) => !units.has(id));
    if (ancestorIds.length > 0) {
      for (const unit of await this.client.organisationUnits({ ids: ancestorIds })) {
        units.set(unit.id, unit);
      }
    }

    const kept = [...units.values()].filter((unit) => levelMap[unit.level] !== undefined);
    const keptIds = new Set(kept.map((unit) => unit.id));

    return kept.map((unit) => {
      // Units at unmapped levels are dropped from the path, so a child's parent
      // is its nearest ancestor that was imported.
      const path = unit.path.split('/').filter((id) => keptIds.has(id));
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
        name: cleanName(unit.displayName),
        level: levelMap[unit.level],
        parentId: path.length > 1 ? path[path.length - 2] : null,
        path,
        centroid,
        active: true,
      };
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
   * One analytics request per org level (split by period), rather than one per
   * org unit. DHIS2 performs the aggregation and returns a compact matrix;
   * nothing raw is pulled into the application.
   *
   * Units above the scope roots are not queried — the service user cannot
   * view them — and are computed from the roots with `combine` instead.
   */
  async fetchObservations(request: FetchRequest): Promise<Observation[]> {
    const direct = request.indicators.filter((indicator) => indicator.source.dx);
    const calculated = request.indicators.filter(isCalculated);
    const mapped = [...direct, ...calculated];
    if (mapped.length === 0) {
      throw new Dhis2Error(
        'No indicators in the registry are mapped to DHIS2 data. Set a DHIS2 identifier for each indicator in Admin → Indicators before synchronising.',
        null,
        '/analytics',
      );
    }

    const byDx = new Map(direct.map((indicator) => [indicator.source.dx as string, indicator]));
    const componentIds = new Set(
      calculated.flatMap((indicator) => [
        ...components(indicator.source.numeratorDx),
        ...components(indicator.source.denominatorDx),
      ]),
    );
    const dxIds = [...new Set([...byDx.keys(), ...componentIds])];
    /** Component values, keyed `uid|orgUnit|period`, for calculated indicators. */
    const raw = new Map<string, number>();
    const roots = await this.scopeRoots();
    const rootUnits = request.orgUnits.filter((unit) => roots.includes(unit.id));
    const rootDepth = Math.min(...rootUnits.map((unit) => unit.path.length));

    // `LEVEL-n` in an analytics request means DHIS2's *own* level number, which
    // is not the canonical depth. Invert the configured map to get back to the
    // numbers this instance actually uses, and query each one at or below the
    // roots once.
    const levelMap = readLevelMap();
    const rootLevels = new Set(rootUnits.map((unit) => unit.level));
    const rootDhis2Level = Math.min(
      ...Object.entries(levelMap)
        .filter(([, canonical]) => rootLevels.has(canonical))
        .map(([dhis2Level]) => Number(dhis2Level)),
    );
    const wanted = new Set(request.orgUnits.map((unit) => unit.level));
    const levels = [
      ...new Set(
        Object.entries(levelMap)
          .filter(([dhis2Level, canonical]) => wanted.has(canonical) && Number(dhis2Level) >= rootDhis2Level)
          .map(([dhis2Level]) => Number(dhis2Level)),
      ),
    ].sort((a, b) => a - b);

    const periodChunks: Period[][] = [];
    for (let i = 0; i < request.periods.length; i += PERIODS_PER_REQUEST) {
      periodChunks.push(request.periods.slice(i, i + PERIODS_PER_REQUEST));
    }

    const observations: Observation[] = [];
    const requests = levels.flatMap((level) => periodChunks.map((periods) => ({ level, periods })));
    const responses = await mapLimit(requests, CONCURRENT_REQUESTS, ({ level, periods }) =>
      this.client.analytics({
        dx: dxIds,
        pe: periods.map((period) => period.id),
        ou: roots,
        level,
        includeNumDen: true,
      }),
    );
    for (const response of responses) {
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
        const value = parseCell(row[valueIndex]);
        if (value === null) continue;
        if (componentIds.has(row[dxIndex])) raw.set(`${row[dxIndex]}|${row[ouIndex]}|${row[peIndex]}`, value);
        const indicator = byDx.get(row[dxIndex]);
        if (!indicator) continue;
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

    // Calculated indicators: numerator ÷ denominator per unit and period. A
    // missing numerator part counts as zero only when another part reported;
    // with no numerator at all, or no denominator, the value stays absent.
    const cells = new Set([...raw.keys()].map((key) => key.slice(key.indexOf('|') + 1)));
    for (const indicator of calculated) {
      const numeratorParts = components(indicator.source.numeratorDx);
      const denominatorParts = components(indicator.source.denominatorDx);
      for (const cell of cells) {
        const numeratorValues = numeratorParts.map((uid) => raw.get(`${uid}|${cell}`));
        if (numeratorValues.every((value) => value === undefined)) continue;
        const denominator = denominatorParts.reduce((sum, uid) => sum + (raw.get(`${uid}|${cell}`) ?? 0), 0);
        if (denominator <= 0) continue;
        const numerator = numeratorValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
        const [orgUnitId, periodId] = cell.split('|');
        observations.push({
          indicatorId: indicator.id,
          orgUnitId,
          periodId,
          value: (numerator / denominator) * unitFactor(indicator.unit),
          numerator,
          denominator,
          disaggregation: null,
        });
      }
    }

    // Breakdowns: a count split by one category, at the state and LGA
    // levels only. Wards and facilities would multiply the rows many times
    // over for splits nobody reads at that depth.
    const breakdownLevels = Object.entries(levelMap)
      .filter(([dhis2Level, canonical]) =>
        (canonical === 'STATE' || canonical === 'LGA') && Number(dhis2Level) >= rootDhis2Level)
      .map(([dhis2Level]) => Number(dhis2Level));
    observations.push(
      ...(await this.fetchBreakdowns(request.indicators, roots, breakdownLevels, periodChunks)),
    );

    // Units above the roots: each is computed from the roots beneath it, and
    // only where every one of those roots has a value — a federal figure built
    // from one state would silently present that state as the whole.
    const ancestors = request.orgUnits.filter((unit) => unit.path.length < rootDepth);
    const rootIdSet = new Set(roots);
    const rootObservations = new Map<string, Observation>();
    const splits = new Map<string, Set<string>>();
    for (const observation of observations) {
      if (rootIdSet.has(observation.orgUnitId)) {
        const split = observation.disaggregation ?? '';
        rootObservations.set(
          `${observation.orgUnitId}|${observation.indicatorId}|${observation.periodId}|${split}`,
          observation,
        );
        if (!splits.has(observation.indicatorId)) splits.set(observation.indicatorId, new Set());
        splits.get(observation.indicatorId)!.add(split);
      }
    }
    for (const ancestor of ancestors) {
      const beneath = rootUnits.filter((unit) => unit.path.includes(ancestor.id));
      if (beneath.length === 0) continue;
      for (const indicator of mapped) {
        for (const split of splits.get(indicator.id) ?? []) {
          for (const period of request.periods) {
            const parts = beneath.map((unit) =>
              rootObservations.get(`${unit.id}|${indicator.id}|${period.id}|${split}`),
            );
            if (parts.some((part) => part === undefined)) continue;
            const combined = combine(parts as Observation[]);
            if (combined) observations.push({ ...combined, orgUnitId: ancestor.id });
          }
        }
      }
    }
    return observations;
  }

  /**
   * Counts split by a category, for indicators that declare a breakdown. Each
   * becomes an observation whose `disaggregation` is "<label>:<option>", e.g.
   * "Sex:Female". They are counts of what `breakdown.counts` names, not values
   * of the indicator, and are kept out of scoring and the quality scan.
   */
  private async fetchBreakdowns(
    indicators: IndicatorDefinition[],
    roots: string[],
    levels: number[],
    periodChunks: Period[][],
  ): Promise<Observation[]> {
    const withBreakdown = indicators.filter((indicator) => indicator.source.breakdown);
    const observations: Observation[] = [];
    // One query per distinct (data element, category), shared by every
    // indicator that splits the same count.
    const groups = new Map<string, IndicatorDefinition[]>();
    for (const indicator of withBreakdown) {
      const { dx, category } = indicator.source.breakdown!;
      const key = `${dx}|${category}`;
      groups.set(key, [...(groups.get(key) ?? []), indicator]);
    }
    const requests = [...groups].flatMap(([key, members]) =>
      levels.flatMap((level) => periodChunks.map((periods) => ({ key, members, level, periods }))),
    );
    const responses = await mapLimit(requests, CONCURRENT_REQUESTS, async ({ key, level, periods }) => {
      const [dx, category] = key.split('|');
      try {
        return await this.client.analytics({
          dx: [dx],
          pe: periods.map((period) => period.id),
          ou: roots,
          level,
          includeNumDen: false,
          dimensions: [category],
        });
      } catch (error) {
        // A breakdown is supplementary: one that DHIS2 refuses (a category
        // that is not a data dimension, say) must not fail the whole sync.
        if (error instanceof Dhis2Error) return null;
        throw error;
      }
    });
    for (const [index, response] of responses.entries()) {
      const { key, members } = requests[index];
      const category = key.split('|')[1];
      if (!response) continue;
      const columns = new Map(response.headers.map((header, index) => [header.name, index]));
      const optionIndex = columns.get(category);
      const peIndex = columns.get('pe');
      const ouIndex = columns.get('ou');
      const valueIndex = columns.get('value');
      if (optionIndex === undefined || peIndex === undefined || ouIndex === undefined || valueIndex === undefined) {
        continue;
      }
      const items = response.metaData?.items ?? {};
      for (const row of response.rows) {
        const value = parseCell(row[valueIndex]);
        if (value === null) continue;
        const option = (items[row[optionIndex]]?.name ?? row[optionIndex]).trim();
        for (const indicator of members) {
          observations.push({
            indicatorId: indicator.id,
            orgUnitId: row[ouIndex],
            periodId: row[peIndex],
            value,
            numerator: null,
            denominator: null,
            disaggregation: `${indicator.source.breakdown!.label}:${option}`,
          });
        }
      }
    }
    return observations;
  }

  /**
   * Completeness and timeliness from data set registrations.
   *
   * Only the data sets the registry's indicators come from are considered, and
   * a unit is expected to report a data set only where DHIS2 assigns it. A
   * monthly data set counts as reported for a quarter when all three months
   * were registered; it was on time when the last of them was.
   */
  async fetchReporting(request: FetchRequest & { datasets: Dataset[] }): Promise<ReportingRecord[]> {
    const referenced = new Set(request.indicators.map((indicator) => indicator.source.datasetId));
    const datasets = request.datasets.filter((dataset) => referenced.has(dataset.id));
    if (datasets.length === 0 || request.periods.length === 0) return [];

    const roots = await this.scopeRoots();
    const known = new Set(request.orgUnits.map((unit) => unit.id));

    const response = await this.client.completeDataSetRegistrations({
      dataSet: datasets.map((set) => set.id),
      startDate: request.periods[0].startDate,
      endDate: request.periods[request.periods.length - 1].endDate,
      orgUnit: roots,
      children: true,
    });

    // Registrations folded into analysis periods: count and latest date.
    const periodFor = (dhis2Period: string): Period | undefined => {
      const start = periodStart(dhis2Period);
      if (!start) return undefined;
      return request.periods.find((period) => period.startDate <= start && start <= period.endDate);
    };
    const completed = new Map<string, { count: number; latest: string | null }>();
    for (const registration of response.completeDataSetRegistrations ?? []) {
      if (registration.completed === false) continue;
      const period = periodFor(registration.period);
      if (!period) continue;
      const key = `${registration.organisationUnit}|${registration.dataSet}|${period.id}`;
      const entry = completed.get(key) ?? { count: 0, latest: null };
      entry.count += 1;
      if (registration.date && (!entry.latest || registration.date > entry.latest)) {
        entry.latest = registration.date;
      }
      completed.set(key, entry);
    }

    const records: ReportingRecord[] = [];
    for (const dataset of datasets) {
      const assigned = (
        await Promise.all(roots.map((root) => this.client.dataSetAssignments(dataset.id, root)))
      )
        .flat()
        .filter((id) => known.has(id));
      for (const orgUnitId of new Set(assigned)) {
        for (const period of request.periods) {
          const entry = completed.get(`${orgUnitId}|${dataset.id}|${period.id}`);
          const due = new Date(`${period.endDate}T00:00:00Z`);
          due.setUTCDate(due.getUTCDate() + dataset.dueDays);
          const reported = (entry?.count ?? 0) >= submissionsPerPeriod(dataset, period);
          records.push({
            orgUnitId,
            datasetId: dataset.id,
            periodId: period.id,
            expected: true,
            reported,
            submittedAt: reported ? (entry?.latest ?? null) : null,
            dueDate: due.toISOString().slice(0, 10),
          });
        }
      }
    }
    return records;
  }
}
