/**
 * DHIS2 Web API client.
 *
 * Runs on the server only. Credentials are read from the environment and are
 * never sent to the browser, included in an API response, or written to the
 * audit log.
 *
 * The client speaks the official DHIS2 Web API — `/api/organisationUnits`,
 * `/api/indicators`, `/api/dataSets`, `/api/analytics` and
 * `/api/completeDataSetRegistrations`. In particular it uses the analytics
 * endpoint's dimensional query support to have DHIS2 aggregate across data
 * elements, periods and org-unit levels, rather than downloading raw data
 * values and aggregating them here.
 */

import { env, envNumber } from '@/lib/env';

export interface Dhis2Config {
  baseUrl: string;
  /** Personal access token, preferred over basic authentication. */
  token?: string;
  username?: string;
  password?: string;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
}

export class Dhis2Error extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = 'Dhis2Error';
  }
}

export function readDhis2Config(): Dhis2Config | null {
  const baseUrl = env('DHIS2_BASE_URL');
  if (!baseUrl) return null;
  const token = env('DHIS2_TOKEN');
  const username = env('DHIS2_USERNAME');
  const password = env('DHIS2_PASSWORD');
  if (!token && !(username && password)) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    username,
    password,
    timeoutMs: envNumber('DHIS2_TIMEOUT_MS', 30_000),
  };
}

function authHeader(config: Dhis2Config): string {
  if (config.token) return `ApiToken ${config.token}`;
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
}

export interface AnalyticsResponse {
  headers: Array<{ name: string; column: string; valueType: string }>;
  rows: string[][];
  metaData?: {
    items?: Record<string, { name: string; uid?: string }>;
    dimensions?: Record<string, string[]>;
  };
}

export class Dhis2Client {
  constructor(private readonly config: Dhis2Config) {}

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  private async request<T>(
    path: string,
    params?: Record<string, string | string[]>,
    timeoutMs = this.config.timeoutMs,
  ): Promise<T> {
    const url = new URL(`${this.config.baseUrl}/api/${path.replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { Authorization: authHeader(this.config), Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Dhis2Error(
          `DHIS2 responded with ${response.status} ${response.statusText}`,
          response.status,
          url.pathname,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Dhis2Error) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Dhis2Error(`Could not reach DHIS2: ${message}`, null, url.pathname);
    } finally {
      clearTimeout(timer);
    }
  }

  /** `/api/system/info` — used as the connection test. */
  async systemInfo(): Promise<{ version: string; contextPath: string }> {
    return this.request<{ version: string; contextPath: string }>('system/info');
  }

  /** The org units the authenticated user may view data for. */
  async me(): Promise<{
    dataViewOrganisationUnits?: Array<{ id: string }>;
    organisationUnits?: Array<{ id: string }>;
  }> {
    return this.request('me', {
      fields: 'dataViewOrganisationUnits[id],organisationUnits[id]',
    });
  }

  /**
   * Org units with levels, parents and coordinates: the subtree beneath `root`
   * inclusive, or the listed units when `ids` is given. A national instance
   * holds tens of thousands of units, so the hierarchy is always fetched by
   * subtree rather than whole.
   */
  async organisationUnits(selector: { root: string } | { ids: string[] }): Promise<
    Array<{
      id: string;
      code?: string;
      displayName: string;
      level: number;
      parent?: { id: string };
      path: string;
      geometry?: { type: string; coordinates: number[] | number[][][] };
    }>
  > {
    const filter =
      'root' in selector ? `path:like:${selector.root}` : `id:in:[${selector.ids.join(',')}]`;
    const response = await this.request<{ organisationUnits: never[] }>('organisationUnits', {
      filter,
      fields: 'id,code,displayName,level,parent[id],path,geometry',
      paging: 'false',
    });
    return response.organisationUnits;
  }

  /** Units beneath `root` that a data set is assigned to, i.e. expected to report it. */
  async dataSetAssignments(dataSet: string, root: string): Promise<string[]> {
    const response = await this.request<{ organisationUnits: Array<{ id: string }> }>(
      'organisationUnits',
      {
        filter: [`dataSets.id:eq:${dataSet}`, `path:like:${root}`],
        fields: 'id',
        paging: 'false',
      },
    );
    return response.organisationUnits.map((unit) => unit.id);
  }

  async dataSets(): Promise<
    Array<{ id: string; displayName: string; periodType: string; timelyDays?: number }>
  > {
    const response = await this.request<{ dataSets: never[] }>('dataSets', {
      fields: 'id,displayName,periodType,timelyDays',
      paging: 'false',
    });
    return response.dataSets;
  }

  /**
   * Forms with the data elements DHIS2 records on them: the authoritative
   * statement of which data elements belong to an NHMIS form.
   */
  async formMetadata(ids: string[]): Promise<
    Array<{
      id: string;
      displayName: string;
      periodType?: string;
      dataSetElements?: Array<{
        dataElement?: {
          id: string;
          displayName: string;
          shortName?: string;
          code?: string;
          valueType?: string;
          aggregationType?: string;
          domainType?: string;
          categoryCombo?: { categories?: Array<{ id: string; displayName: string; dataDimension?: boolean }> };
        };
      }>;
    }>
  > {
    if (ids.length === 0) return [];
    const response = await this.request<{ dataSets: never[] }>('dataSets', {
      filter: `id:in:[${ids.join(',')}]`,
      fields:
        'id,displayName,periodType,dataSetElements[dataElement[id,displayName,shortName,code,valueType,aggregationType,domainType,categoryCombo[categories[id,displayName,dataDimension]]]]',
      paging: 'false',
    });
    return response.dataSets;
  }

  /** Numerator and denominator expressions of the named indicators. */
  async indicatorDefinitions(
    ids: string[],
  ): Promise<Array<{ id: string; displayName: string; numerator?: string; denominator?: string }>> {
    if (ids.length === 0) return [];
    const response = await this.request<{ indicators: never[] }>('indicators', {
      filter: `id:in:[${ids.join(',')}]`,
      fields: 'id,displayName,numerator,denominator',
      paging: 'false',
    });
    return response.indicators;
  }

  /** Display names of category option combos. */
  async optionComboNames(ids: string[]): Promise<Array<{ id: string; displayName: string }>> {
    if (ids.length === 0) return [];
    const response = await this.request<{ categoryOptionCombos: never[] }>('categoryOptionCombos', {
      filter: `id:in:[${ids.join(',')}]`,
      fields: 'id,displayName',
      paging: 'false',
    });
    return response.categoryOptionCombos;
  }

  async indicators(): Promise<Array<{ id: string; displayName: string; numerator?: string }>> {
    const response = await this.request<{ indicators: never[] }>('indicators', {
      fields: 'id,displayName,numerator',
      paging: 'false',
    });
    return response.indicators;
  }

  /**
   * The metadata catalogue behind the data explorer: indicators and aggregate
   * data elements with their groups, forms and categories. Fetched whole
   * (a few thousand rows) and cached by the caller.
   */
  async catalogue(): Promise<{
    indicators: Array<{
      id: string;
      displayName: string;
      indicatorType?: { displayName: string };
      indicatorGroups?: Array<{ displayName: string }>;
      numeratorDescription?: string;
      denominatorDescription?: string;
    }>;
    dataElements: Array<{
      id: string;
      displayName: string;
      valueType?: string;
      aggregationType?: string;
      dataElementGroups?: Array<{ displayName: string }>;
      dataSetElements?: Array<{ dataSet?: { id: string; displayName: string } }>;
      categoryCombo?: {
        categories?: Array<{ id: string; displayName: string; dataDimension?: boolean }>;
      };
    }>;
  }> {
    const [indicators, dataElements] = await Promise.all([
      this.request<{ indicators: never[] }>('indicators', {
        fields:
          'id,displayName,indicatorType[displayName],indicatorGroups[displayName],numeratorDescription,denominatorDescription',
        paging: 'false',
      }),
      this.request<{ dataElements: never[] }>('dataElements', {
        filter: 'domainType:eq:AGGREGATE',
        fields:
          'id,displayName,valueType,aggregationType,dataElementGroups[displayName],dataSetElements[dataSet[id,displayName]],categoryCombo[categories[id,displayName,dataDimension]]',
        paging: 'false',
      }),
    ]);
    return { indicators: indicators.indicators, dataElements: dataElements.dataElements };
  }

  /** DHIS2's own outlier detection over facility-level raw values. */
  async outliers(params: {
    dataElements: string[];
    orgUnits: string[];
    startDate: string;
    endDate: string;
    algorithm: 'Z_SCORE' | 'MOD_Z_SCORE' | 'MIN_MAX';
    threshold?: number;
    maxResults?: number;
  }): Promise<{
    outlierValues?: Array<{
      de: string;
      deName: string;
      pe: string;
      ou: string;
      ouName: string;
      cocName?: string;
      value: number;
      mean?: number;
      median?: number;
      stdDev?: number;
      zScore?: number;
      lowerBound?: number;
      upperBound?: number;
    }>;
  }> {
    // Outlier detection scans every raw facility value in the range, which
    // takes DHIS2 far longer than an analytics query does.
    return this.request(
      'outlierDetection',
      {
        de: params.dataElements,
        ou: params.orgUnits,
        startDate: params.startDate,
        endDate: params.endDate,
        algorithm: params.algorithm,
        ...(params.threshold ? { threshold: String(params.threshold) } : {}),
        maxResults: String(params.maxResults ?? 200),
        orderBy: params.algorithm === 'MIN_MAX' ? 'ABS_DEV' : 'Z_SCORE',
      },
      Math.max(this.config.timeoutMs, 120_000),
    );
  }

  /** Validation rules, for describing violations. */
  async validationRules(): Promise<
    Array<{
      id: string;
      displayName: string;
      importance?: string;
      operator?: string;
      instruction?: string;
      leftSide?: { description?: string };
      rightSide?: { description?: string };
    }>
  > {
    const response = await this.request<{ validationRules: never[] }>('validationRules', {
      fields: 'id,displayName,importance,operator,instruction,leftSide[description],rightSide[description]',
      paging: 'false',
    });
    return response.validationRules;
  }

  /**
   * Runs a form's validation rules for one org unit and period. A read-only
   * request, unlike the bulk validation analysis, which needs write access.
   */
  async validateDataSet(dataSet: string, period: string, orgUnit: string): Promise<{
    validationRuleViolations?: Array<{
      validationRule?: { id: string; name?: string; displayName?: string };
      leftsideValue?: number;
      rightsideValue?: number;
      period?: { id?: string };
      organisationUnit?: { id: string; name?: string };
    }>;
  }> {
    return this.request(`validation/dataSet/${encodeURIComponent(dataSet)}`, { pe: period, ou: orgUnit });
  }

  /**
   * Dimensional analytics query. `dx`, `pe` and `ou` are passed as DHIS2
   * dimensions so aggregation happens server-side in DHIS2.
   *
   * `ouMode` of `LEVEL-n` requests every org unit at that level beneath the
   * given roots, which is how the platform retrieves LGA and facility figures
   * without enumerating identifiers.
   */
  async analytics(params: {
    dx: string[];
    pe: string[];
    ou: string[];
    level?: number;
    includeNumDen?: boolean;
    /** Extra dimensions, e.g. a category UID to split values by its options. */
    dimensions?: string[];
  }): Promise<AnalyticsResponse> {
    return this.request<AnalyticsResponse>('analytics', this.analyticsParams(params));
  }

  /** The analytics query string, shared with `analyticsUrl` for display. */
  private analyticsParams(params: {
    dx: string[];
    pe: string[];
    ou: string[];
    level?: number;
    includeNumDen?: boolean;
    dimensions?: string[];
  }): Record<string, string | string[]> {
    const ouDimension = params.level ? [...params.ou, `LEVEL-${params.level}`] : params.ou;
    return {
      dimension: [
        `dx:${params.dx.join(';')}`,
        `pe:${params.pe.join(';')}`,
        `ou:${ouDimension.join(';')}`,
        ...(params.dimensions ?? []),
      ],
      includeNumDen: String(params.includeNumDen ?? true),
      skipMeta: 'false',
      skipRounding: 'true',
    };
  }

  /**
   * The same query as a DHIS2 URL, without credentials, so an analyst can
   * reproduce a result in DHIS2 itself.
   */
  analyticsUrl(params: Parameters<Dhis2Client['analytics']>[0]): string {
    const url = new URL(`${this.config.baseUrl}/api/analytics`);
    for (const [key, value] of Object.entries(this.analyticsParams(params))) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item);
    }
    return url.toString();
  }

  /**
   * Completeness registrations between two dates, used for reporting
   * completeness and timeliness. A date range rather than period ids, because
   * monthly data sets register monthly periods while the platform analyses
   * quarters.
   */
  async completeDataSetRegistrations(params: {
    dataSet: string[];
    startDate: string;
    endDate: string;
    orgUnit: string[];
    children: boolean;
  }): Promise<{
    completeDataSetRegistrations?: Array<{
      period: string;
      organisationUnit: string;
      dataSet: string;
      date?: string;
      completed?: boolean;
    }>;
  }> {
    return this.request('completeDataSetRegistrations', {
      dataSet: params.dataSet,
      startDate: params.startDate,
      endDate: params.endDate,
      orgUnit: params.orgUnit,
      children: String(params.children),
    });
  }
}
