/**
 * Canonical SRHR data model.
 *
 * This is the stable internal contract that sits between any external source
 * (DHIS2, demo generator, future sources) and everything above it. Nothing in
 * `src/core` may import framework, network or database code — these types and
 * the engines that operate on them are pure and unit-testable.
 */

/**
 * Administrative hierarchy: Federal → State → LGA → Ward → Facility, which is
 * the shape of the national DHIS2 instance. `COUNTRY` is the federal tier.
 */
export type OrgLevel = 'COUNTRY' | 'STATE' | 'LGA' | 'WARD' | 'FACILITY';

/** Canonical levels, top first. */
export const ORG_LEVELS: OrgLevel[] = ['COUNTRY', 'STATE', 'LGA', 'WARD', 'FACILITY'];

export const ORG_LEVEL_DEPTH: Record<OrgLevel, number> = {
  COUNTRY: 1,
  STATE: 2,
  LGA: 3,
  WARD: 4,
  FACILITY: 5,
};

export interface OrgUnit {
  id: string;
  /** Source-system code, retained for traceability back to DHIS2. */
  code: string | null;
  name: string;
  level: OrgLevel;
  parentId: string | null;
  /** Materialised ancestor path, root first, inclusive of self. */
  path: string[];
  /** Representative point, used for schematic and true-geography maps alike. */
  centroid: { lon: number; lat: number } | null;
  active: boolean;
}

/** Period identifiers follow DHIS2 ISO period format: 2026Q1, 202603, 2026. */
export type PeriodType = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface Period {
  id: string;
  type: PeriodType;
  /** Inclusive ISO date of first day. */
  startDate: string;
  /** Inclusive ISO date of last day. */
  endDate: string;
  /** Human label, e.g. "Q1 2026". */
  label: string;
}

/**
 * A single measured fact: one indicator, one org unit, one period.
 * `value` is authoritative; numerator/denominator are retained where the
 * source provides them so that consistency rules can be evaluated.
 */
export interface Observation {
  indicatorId: string;
  orgUnitId: string;
  periodId: string;
  value: number;
  numerator: number | null;
  denominator: number | null;
  /** Optional disaggregation key, e.g. "age:15-19|sex:F". Null = total. */
  disaggregation: string | null;
}

/**
 * Whether a reporting unit was expected to report, and whether it did.
 * Drives completeness and timeliness intelligence.
 */
export interface ReportingRecord {
  orgUnitId: string;
  datasetId: string;
  periodId: string;
  expected: boolean;
  reported: boolean;
  /** ISO datetime the submission was received, if it was. */
  submittedAt: string | null;
  /** ISO date the submission was due. */
  dueDate: string;
}

export interface Target {
  indicatorId: string;
  /** Null = applies to every org unit not covered by a more specific target. */
  orgUnitId: string | null;
  /** Null = applies to every period. */
  periodId: string | null;
  value: number;
}

/** Where a row came from. Demo rows are never silently mixed with live rows. */
export type DataMode = 'DEMO' | 'DHIS2';

export interface DataSourceInfo {
  mode: DataMode;
  /** Human label shown in the UI, e.g. "Demo dataset" or a DHIS2 base URL. */
  label: string;
  /** ISO datetime of the last successful synchronisation, if any. */
  lastSyncAt: string | null;
}

export interface Dataset {
  id: string;
  name: string;
  periodType: PeriodType;
  /** Days after period end by which submission is due. */
  dueDays: number;
}
