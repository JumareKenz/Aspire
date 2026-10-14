import type {
  DataMode,
  Dataset,
  Observation,
  OrgUnit,
  Period,
  ReportingRecord,
} from '@/core/model/types';
import type { IndicatorDefinition } from '@/core/registry/types';
import type { Operand, SourceIndicatorDefinition } from '@/core/registry/provenance';

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
  /** Fetch category breakdowns too. Defaults to true; the monthly pass skips them. */
  includeBreakdowns?: boolean;
}

/** A data element on one of the requested forms, as the source describes it. */
export interface SourceDataElement {
  id: string;
  name: string;
  shortName: string | null;
  code: string | null;
  valueType: string | null;
  /** DHIS2 aggregation type (SUM, AVERAGE, LAST, …): how values combine over time and area. */
  aggregationType: string | null;
  /** The requested forms it sits on. */
  formIds: string[];
  categories: Array<{ id: string; name: string }>;
}

/** Metadata used to verify where every indicator's figures come from. */
export interface SourceMetadata {
  /** The requested forms the source actually holds. */
  forms: Array<{ id: string; name: string; periodType: string | null }>;
  dataElements: SourceDataElement[];
  /** Definitions of source-side indicators the registry refers to. */
  sourceIndicators: SourceIndicatorDefinition[];
  /** Display names of category option combos used by operands. */
  optionCombos: Record<string, string>;
  /**
   * For a synthetic source only: the operands each indicator is generated
   * from. A real source's operands are derived from its metadata instead.
   */
  syntheticOperands?: Record<string, Operand[]>;
}

export interface DataElementValueRequest {
  /** Data element references: "uid" or "uid.coc". */
  dx: string[];
  orgUnits: OrgUnit[];
  periods: Period[];
  /** Aggregation type per data element UID, for combining above the source's roots. */
  aggregationTypes: Record<string, string | null>;
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
  /**
   * The approved forms' data elements, and the definitions of any source-side
   * indicators the registry refers to (`sourceIndicatorIds`).
   */
  fetchMetadata(request: {
    indicators: IndicatorDefinition[];
    formIds: string[];
    sourceIndicatorIds: string[];
    optionComboIds: string[];
  }): Promise<SourceMetadata>;
  /**
   * Data element values at state and LGA level, aggregated by the source for
   * each requested period — never summed or split here across period types.
   */
  fetchDataElementValues(request: DataElementValueRequest): Promise<Array<{ dx: string; orgUnitId: string; periodId: string; value: number }>>;
}
