# Data model

## Canonical types

`src/core/model/types.ts` is the contract between any source and everything
above it.

| Type | Purpose |
|---|---|
| `OrgUnit` | Hierarchy node with a **materialised ancestor path** and optional centroid |
| `Period` | DHIS2 ISO identifier (`2026Q2`, `202603`, `2026`) with resolved dates and a label |
| `Observation` | One indicator × org unit × period × disaggregation. Retains numerator and denominator |
| `ReportingRecord` | Whether a submission was expected, whether it arrived, when it was due |
| `Target` | Indicator target, optionally specific to an org unit and/or period |
| `DataMode` | `DEMO` or `DHIS2` — carried through the model, the API and the interface |

Two decisions worth noting:

**The materialised path.** `path: ['state-1', 'lga-1', 'fac-1']` makes a scope
check one containment test and a descendant query one indexed `LIKE`. Without it
every permission check would walk the tree.

**Numerator and denominator are kept.** The value alone cannot be checked for
consistency; `numerator > denominator` is one of the strongest signals of a
reporting error, and it is only available if both are stored.

## Schema

`src/data/db/schema.sql`. All access goes through repositories.

| Table | Notes |
|---|---|
| `org_units` | Materialised `path`; indexed on parent and level |
| `periods` · `observations` · `reporting` · `targets` | Composite primary keys make every sync idempotent |
| `indicator_config` · `domain_config` · `methodologies` | JSON documents — the registry and methodology are *configuration*, not schema |
| `quality_findings` | Deterministic ids, so a finding keeps its identity across scans and its triage status survives |
| `users` | scrypt hash, role, comma-separated scope |
| `actions` | Includes `baseline_score`, so outcomes can be measured rather than only ticked off |
| `audit_log` · `sync_runs` | Operational record, newest-first indexed |

`observations` is keyed on `(indicator, org unit, period, disaggregation)` with
`''` for a total, so a disaggregated row can never be mistaken for the total —
a mistake that would silently corrupt every aggregate above it.

## Effective targets

Specificity wins: `(indicator, org unit, period)` beats `(indicator, org unit)`
beats `(indicator)`. Resolved in one query, scored, and reduced to the most
specific match per indicator.

## Data confidence

Computed in `src/core/quality/confidence.ts` from the *evidence*, never from the
performance figures.

| Component | Weight | Measures |
|---|---|---|
| Completeness | 0.40 | Received ÷ expected submissions |
| Timeliness | 0.15 | On-time ÷ received |
| Validity | 0.15 | Rate of impossible values |
| Consistency | 0.15 | Rate of internal contradictions |
| Stability | 0.15 | Rate of anomalies, level shifts, repeated values |

**Capped by completeness + 25.** Without this, a scope whose data was half
missing but internally tidy would still score in the seventies, because the
other four dimensions can only assess data that actually arrived. Confidence in
largely absent evidence has to be limited by how much of it is there.

Bands: HIGH ≥ 80, MODERATE ≥ 55, LOW below. Every band below HIGH carries
plain-language reasons.

## Demo dataset

Synthetic, deterministic, and labelled `DEMO DATA` at the data layer, the API
layer, in the shell, and on every report and export.

**Fictional names throughout.** "Kandara State", "Eguma", "Chalawa". Attaching
synthetic figures to real Nigerian states or LGAs would produce documents that
read as real reporting about real places — exactly the confusion the product
must avoid. A test asserts that no real state name appears.

**Internally consistent by construction.** Facility numerators and denominators
are generated first; every higher level is aggregated from them, with percentages
recomputed from summed numerators and denominators rather than averaged. An LGA
figure genuinely is the sum of its facilities, and a test verifies this.

**Rooted at the state**, with no synthetic national tier above a single state.

### Planted signals

These give the analytical engines and the AI evaluation set known-correct
answers to find. They are the ground truth the eval set asserts against.

| Signal | Where | Purpose |
|---|---|---|
| Sustained decline in adolescent SRHR | Eguma, Fankama, Ilesan, Lamurde | Trend detection, attribution, "why is performance declining" |
| Sustained improvement | Chalawa | "Which areas improved most" |
| Reporting collapse (~48%, worse recently) | Hadeja West | Completeness detection, low data confidence, the performance-vs-confidence distinction |
| Impossible value (128.4%) | One facility, ANC4 | Validity detection |
| Numerator > denominator | One facility, skilled delivery | Consistency detection |
| Value repeated 5 periods | One facility, mCPR | Repeated-value detection |
| 7.5× spike | One facility, new FP acceptors | Statistical anomaly detection |

Hadeja West is deliberately *not* the lowest performer. If performance and data
confidence were entangled it would be, and a test asserts that it is not.

### Realism

- Per-facility capability and catchment, per-LGA capability
- Seasonality with its **own phase and amplitude per facility/indicator** — a
  shared phase made every sparkline in the product share one silhouette
- Percentage indicators held below a soft ceiling, so strong units are not
  pinned at 100 every period producing flat, uninformative series
- Reporting rates that vary by facility, with plausible late submissions

Replacing the demo source with DHIS2 requires no product change: both implement
`SourceAdapter`.
