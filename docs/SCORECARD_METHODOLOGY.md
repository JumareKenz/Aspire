# Scorecard methodology

## The official methodology has not been supplied

This is the central constraint of the build. The ASPIRE-GAC indicator set,
weights, thresholds, targets, aggregation rules and missing-data rules were not
available. Rather than guess at them and bake the guess into the product, the
scoring engine is driven entirely by a **versioned methodology record**.

The seeded record is:

```
ASPIRE-SRHR-PROVISIONAL-v0     status: PROVISIONAL
```

Everything derived from it is badged as provisional — in the Overview, on every
scorecard, in the Performance workspace, in every report and in every CSV export.
No one can mistake a development placeholder for an agreed government measure.

## Publishing the official methodology

Add a record with `status: 'OFFICIAL'`. That is the whole change.

```ts
// src/config/methodology.ts
export const OFFICIAL_METHODOLOGY: ScorecardMethodology = {
  id: 'aspire-srhr-v1',
  version: 'ASPIRE-SRHR-v1',
  status: 'OFFICIAL',
  effectiveFrom: '2026-01-01',
  domainWeights: { /* … */ },
  indicatorWeights: { /* … */ },
  statusBands: { onTrack: 80, watch: 65 },
  aggregation: { domain: 'WEIGHTED_MEAN', overall: 'WEIGHTED_MEAN', geography: 'POPULATION_WEIGHTED' },
  missingData: { rule: 'EXCLUDE', carryMaxPeriods: 1, minCoverage: 0.6 },
  minPeriodsForTrend: 3,
};
```

`getActiveMethodology()` prefers `OFFICIAL` over `PROVISIONAL`, most recent
`effectiveFrom` first. No engine, service, component or test needs editing. The
provisional badge disappears on its own, because it is driven by the record's
own status.

Every scorecard carries `methodologyId`, `methodologyVersion` and
`methodologyStatus`, so a score computed under v0 remains traceable to v0 after
v1 is published.

## What is configurable

| Field | Effect |
|---|---|
| `domainWeights` | Relative weight of each domain in the overall score. Normalised at evaluation |
| `indicatorWeights` | Relative weight within a domain. Normalised per domain |
| `statusBands.onTrack` / `.watch` | Score thresholds for the three status bands |
| `aggregation.domain` / `.overall` | How component scores combine |
| `aggregation.geography` | How child units roll up into a parent |
| `missingData.rule` | `EXCLUDE` (drop and renormalise), `ZERO` (punitive), `CARRY` (reuse the last value) |
| `missingData.carryMaxPeriods` | How far back `CARRY` may look |
| `missingData.minCoverage` | Proportion of weighted indicators that must report before a score is published at all |
| `minPeriodsForTrend` | How much history is needed before a direction is asserted |

Per-indicator scoring rules (`TARGET_RATIO`, `BANDS`, `LINEAR`) and validity
bounds live on the indicator record in the registry, and are shown but not
editable from the interface — changing how a value becomes a score is a
methodology decision and should be versioned as one.

## How a score is computed

```
value ──scoring rule──► indicator score (0–100)
                              │
                     weighted mean within domain, missing handled by the rule
                              ▼
                        domain score (0–100)
                              │
                    weighted mean across domains
                              ▼
                       overall score (0–100)
                              │
                        status bands
                              ▼
              ON_TRACK · WATCH · NEEDS_ATTENTION · NO_DATA
```

Three properties worth stating explicitly:

**Direction is handled at the rule, not by negating scores.** `LINEAR` is
direction-agnostic — a lower-is-better indicator configures a ceiling below its
floor. `TARGET_RATIO` inverts the ratio for lower-is-better. Contraceptive
stock-outs score correctly without any special case downstream.

**Overachievement is capped.** The provisional record caps `TARGET_RATIO` at
100, so one indicator far above target cannot mask several below it.

**A score can be withheld.** If weighted coverage falls below `minCoverage` the
score is `null`, not zero, and the interface explains that reporting was too
sparse to publish a figure. A missing score and a bad score are different
findings.

## The provisional record's choices

Recorded so they can be argued with rather than inherited silently:

- **Equal domain weights.** No basis was available to prefer one SRHR domain
  over another; equality is the assumption that adds least.
- **Equal indicator weights within a domain.** Same reasoning.
- **`onTrack: 75`, `watch: 60`.** Conventional programme-performance bands.
- **`EXCLUDE` for missing data.** `ZERO` would punish a unit for a reporting
  failure as though it were a service failure — precisely the confusion the
  data-confidence measure exists to prevent.
- **`minCoverage: 0.5`.** Below half the weighted indicators, an aggregate is
  describing the indicators that happened to report rather than the programme.
- **Targets are placeholders.** Set per geography and period through the targets
  table; the values in `src/config/indicators.ts` are defaults, not policy.
  Count targets apply only to the area and period type they were set for; an
  indicator with no applicable target is shown unscored rather than scored
  against a guess. See `docs/NHMIS_GOVERNANCE_TARGETS_AND_PERIODS.md`.

## Performance is not data confidence

The two are computed from different evidence and are never combined.

|  | Performance | Data confidence |
|---|---|---|
| Question | How well is the programme doing? | How much should we trust this? |
| Computed from | Observations against targets, weighted by methodology | Reporting completeness, timeliness, validity, consistency, stability |
| Range | 0–100 | 0–100% in three bands |

A score of 64 at 94% confidence and a score of 64 at 41% confidence are
different findings, and the product renders them differently. See
`docs/DATA_MODEL.md` for how confidence is computed and why it is capped by
completeness.
