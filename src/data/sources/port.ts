import type {
  DataMode,
  Dataset,
  Observation,
  OrgUnit,
  Period,
  ReportingRecord,
} from '@/core/model/types';
import type { IndicatorDefinition } from '@/core/registry/types';

export interface ConnectionResult {
  ok: boolean;
  message: string;
  /** Source version string where the source reports one. */
  version?: string;
}

export interface FetchRequest {
  orgUnits: OrgUnit[];
  indicators: IndicatorDefinition[];
  periods: Period[];
}

/**
 * The single seam between the platform and any external data source.
 *
 * Everything above this interface — analytics, scoring, quality, intelligence,
 * UI — is written against the canonical model and never against a source's own
 * API shape. Adding a source means implementing this port; it does not mean
 * touching the product.
 */
export interface SourceAdapter {
  mode: DataMode;
  /** Human label shown wherever the platform states where its data came from. */
  label: string;
  testConnection(): Promise<ConnectionResult>;
  fetchOrgUnits(): Promise<OrgUnit[]>;
  fetchDatasets(): Promise<Dataset[]>;
  /**
   * Aggregated values for the requested dimensions, at every org level
   * requested. Implementations must aggregate at the source where the source
   * can do so, rather than returning raw rows for the client to sum.
   */
  fetchObservations(request: FetchRequest): Promise<Observation[]>;
  fetchReporting(request: FetchRequest & { datasets: Dataset[] }): Promise<ReportingRecord[]>;
}
