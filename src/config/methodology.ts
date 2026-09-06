import type { ScorecardMethodology } from '@/core/scoring/types';
import { INDICATORS } from './indicators';

/**
 * Provisional scorecard methodology.
 *
 * The official ASPIRE-GAC methodology — its indicator set, weights, thresholds,
 * targets, aggregation and missing-data rules — has not been supplied. This
 * record exists so that the platform can be built, demonstrated and tested
 * end to end without pre-empting that decision.
 *
 * It is marked PROVISIONAL. Every score derived from it is badged as such in
 * the interface and in exports, and no consumer of the scoring engine reads
 * anything from this file directly: they receive whichever methodology record
 * the store returns. Publishing the official methodology means adding a record
 * with `status: 'OFFICIAL'` and a new version — not editing engine or UI code.
 */
export const PROVISIONAL_METHODOLOGY: ScorecardMethodology = {
  id: 'aspire-srhr-provisional-v0',
  version: 'ASPIRE-SRHR-PROVISIONAL-v0',
  label: 'Provisional SRHR scorecard',
  status: 'PROVISIONAL',
  description:
    'Development methodology used until the official ASPIRE-GAC scorecard methodology is issued. Equal domain weighting, equal indicator weighting within domains, target-ratio scoring capped at 110, and exclusion of indicators without data.',
  effectiveFrom: '2024-01-01',
  domainWeights: {
    'maternal-health': 1,
    'family-planning': 1,
    'adolescent-srhr': 1,
    'gbv-response': 1,
    'hiv-sti': 1,
    'commodity-security': 1,
  },
  indicatorWeights: Object.fromEntries(INDICATORS.map((indicator) => [indicator.id, 1])),
  statusBands: { onTrack: 75, watch: 60 },
  aggregation: {
    domain: 'WEIGHTED_MEAN',
    overall: 'WEIGHTED_MEAN',
    geography: 'POPULATION_WEIGHTED',
  },
  missingData: {
    rule: 'EXCLUDE',
    carryMaxPeriods: 1,
    minCoverage: 0.5,
  },
  minPeriodsForTrend: 3,
};

export const METHODOLOGIES: ScorecardMethodology[] = [PROVISIONAL_METHODOLOGY];
