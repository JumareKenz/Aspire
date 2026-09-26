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

  private async request<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
    const url = new URL(`${this.config.baseUrl}/api/${path.replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
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

  async indicators(): Promise<Array<{ id: string; displayName: string; numerator?: string }>> {
    const response = await this.request<{ indicators: never[] }>('indicators', {
      fields: 'id,displayName,numerator',
      paging: 'false',
    });
    return response.indicators;
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
    const ouDimension = params.level ? [...params.ou, `LEVEL-${params.level}`] : params.ou;
    return this.request<AnalyticsResponse>('analytics', {
      dimension: [
        `dx:${params.dx.join(';')}`,
        `pe:${params.pe.join(';')}`,
        `ou:${ouDimension.join(';')}`,
        ...(params.dimensions ?? []),
      ],
      includeNumDen: String(params.includeNumDen ?? true),
      skipMeta: 'false',
      skipRounding: 'true',
    });
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
