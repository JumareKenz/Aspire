import type { EvidenceItem, Severity } from '../quality/types';

export const INSIGHT_KINDS = [
  'BELOW_TARGET',
  'DECLINE',
  'IMPROVEMENT',
  'DATA_QUALITY',
  'RISK',
  'CHANGE',
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  /** One sentence a senior user can act on without reading further. */
  headline: string;
  /** Two or three sentences of grounded explanation. */
  detail: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  indicatorId: string | null;
  periodId: string;
  evidence: EvidenceItem[];
  /**
   * Absolute magnitude used to rank insights against each other. Not shown to
   * the user; it exists so the Overview surfaces what matters most.
   */
  magnitude: number;
  /** Deep link into the workspace that explains this insight in full. */
  href: string;
}

export interface Recommendation {
  id: string;
  title: string;
  /** What is wrong. */
  issue: string;
  /** Where it is happening. */
  location: string;
  orgUnitId: string | null;
  indicatorIds: string[];
  /** The figures the recommendation rests on. */
  evidence: EvidenceItem[];
  /** The most probable explanation, stated as a hypothesis rather than a fact. */
  likelyDriver: string;
  /** The specific next step being recommended. */
  nextStep: string;
  priority: Severity;
  /** 0..1, reflecting evidence strength and data confidence. */
  confidence: number;
}
