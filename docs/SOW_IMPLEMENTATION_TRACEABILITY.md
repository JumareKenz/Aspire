# SOW implementation traceability

Maps each requirement of the ASPIRE-GAC brief to the code that implements it,
the tests that prove it, and its honest status.

**A note on the source of requirements.** No signed scope-of-work document was
supplied to this repository. The requirement set below is reconstructed from
the two written build briefs — the original 52-section build prompt and the
multi-state architecture brief — and from the DHIS2 and branding material
supplied later. Where a requirement is inferred rather than quoted, it is
marked *(inferred)*. **A real SOW should be diffed against this table before it
is relied upon for acceptance**; anything in the SOW that is absent here is a
gap this document cannot see. `SOW_GAP_ANALYSIS.md` records what is known to be
outstanding.

**Status vocabulary**

| Status | Means |
|---|---|
| **Implemented** | Built, integrated and covered by tests that would fail if it regressed |
| **Implemented, unverified** | Built and tested against fixtures; not exercised against the live external system |
| **Provisional** | Built and working, but resting on a placeholder that must be replaced with the official one |
| **Partial** | Some of the requirement is delivered; the remainder is named in the gap analysis |
| **Not built** | Not delivered |

Verification state at the time of writing: **277 automated tests passing ·
14/14 AI evaluation cases · 96 accessibility audits with zero violations · 266
tier-walkthrough checks against the production build · 0 lint errors · 0 type
errors · production build clean**.

---

## 1. Multi-state architecture

| # | Requirement | Status | Implementation | Tests |
|---|---|---|---|---|
| 1.1 | One application, one auth system, serving Bauchi and Sokoto | Implemented | Single hierarchy under one root: `src/data/sources/demo/geography.ts` | `tests/data/demo.test.ts` |
| 1.2 | Role and geographic scope are independent | Implemented | `src/auth/rbac.ts` (role), `user.scope` (geography); the two meet only in `reportTypesFor()` | `tests/api/permissions.test.ts` — "role and geography are independent" |
| 1.3 | Global scope | Implemented | Empty `scope` array = whole hierarchy, `isInScope()` | `tests/core/permissions.test.ts` |
| 1.4 | State-specific scope | Implemented | `scope: ['state-bauchi']`; `resolveScope()` roots the user at their own node | `tests/api/permissions.test.ts` |
| 1.5 | LGA-extensible scope | Implemented | Scope is a list of org unit ids at any level; an LGA-scoped persona is exercised | `tests/api/permissions.test.ts` |
| 1.6 | Server-side enforcement everywhere | Implemented | `assertOrgUnitInScope()` (geography + depth + existence), `requireRoute()`, `withUser(handler, permission)` | `tests/api/permissions.test.ts` |
| 1.7 | Enforcement against URL and query-parameter tampering | Implemented | `resolvePageContext()` falls back to the user's root; API routes 403/404 | `tests/api/permissions.test.ts` |
| 1.8 | Genuine cross-state comparison for global users | Implemented | `src/services/states.ts` → `compareStates()`; Overview panel; comparison report; root map | `tests/api/permissions.test.ts`, `tests/api/reports.test.ts`, `tests/api/map.test.ts` |
| 1.9 | Cross-state surfaces gated by scope, not role | Implemented | `accessibleStates()` reads `user.scope` only; `geography.crossState` granted to every role | `tests/api/permissions.test.ts` |
| 1.10 | AI refuses cross-state questions from state-scoped users | Implemented | `namedButUnreadable()` in `src/intelligence/answer.ts`, before planning | `tests/api/permissions.test.ts`, `tests/intelligence/pipeline.test.ts` |
| 1.11 | Extensible to a third state *(inferred)* | Implemented | Nothing counts or names states; see `ROLE_AND_GEOGRAPHIC_ACCESS_MATRIX.md` §7 | — |

## 2. Data model and DHIS2 integration

| # | Requirement | Status | Implementation | Tests |
|---|---|---|---|---|
| 2.1 | Canonical DHIS2-shaped domain model | Implemented | `src/core/model/types.ts` — OrgUnit, Period, Observation, ReportingRecord, Target | `tests/core/*` |
| 2.2 | Materialised ancestor paths for scope resolution | Implemented | `OrgUnit.path`; every scope check is a path containment test | `tests/data/demo.test.ts`, `tests/api/permissions.test.ts` |
| 2.3 | Source adapter port, swappable backends | Implemented | `SourceAdapter` in `src/data/sources/`; demo and DHIS2 implementations | `tests/data/dhis2.test.ts` |
| 2.4 | DHIS2 Web API integration | Implemented, unverified | `src/data/sources/dhis2/adapter.ts` — `/api/analytics`, `completeDataSetRegistrations` | `tests/data/dhis2.test.ts` against fixtures |
| 2.5 | Configurable org-unit level mapping | Implemented | `DEFAULT_LEVEL_MAP` (state-rooted), `DHIS2_LEVEL_MAP` override, malformed value rejected | `tests/data/dhis2.test.ts` |
| 2.6 | Indicator registry, configurable | Implemented | 17 indicators across 6 domains, editable in Admin → Indicators | `tests/core/scoring.test.ts` |
| 2.7 | Indicator → DHIS2 UID mapping | Partial | 5 of 17 carry a real UID; unmapped ones are skipped at sync and reported in Admin | `tests/data/dhis2.test.ts` |
| 2.8 | Real administrative geography | Implemented | 43 LGA boundaries, `public/geo/lgas.geojson` (geoBoundaries gbOpen NGA ADM2 / GRID3, CC BY 4.0) | `tests/data/dhis2.test.ts` — "bundled geography" |
| 2.9 | Deterministic demo dataset | Implemented | `src/data/sources/demo/generator.ts`; 327 org units, 66,708 observations, aggregated bottom-up | `tests/data/demo.test.ts` |

## 3. Scorecard engine

| # | Requirement | Status | Implementation | Tests |
|---|---|---|---|---|
| 3.1 | Configurable, versioned methodology | Implemented | `ScorecardMethodology` document in `methodologies`; version stamped on every derived figure | `tests/core/scoring.test.ts` |
| 3.2 | Domain weighting and scoring rules | Implemented | Three scoring rules, three missing-data rules | `tests/core/scoring.test.ts` |
| 3.3 | Coverage gate — refuse to score thin data | Implemented | Below the methodology's minimum coverage, no score is published | `tests/core/scoring.test.ts` |
| 3.4 | Performance and data confidence kept separate | Implemented | `src/core/quality/confidence.ts`, capped at completeness + 25 | `tests/intelligence/pipeline.test.ts` |
| 3.5 | Official ASPIRE-GAC methodology | **Provisional** | Seeded record is `ASPIRE-SRHR-PROVISIONAL-v0`, status `PROVISIONAL`, badged on every surface | `tests/api/reports.test.ts` |

## 4. Analytics and forecasting

| # | Requirement | Status | Implementation | Tests |
|---|---|---|---|---|
| 4.1 | Trend with a stable band | Implemented | `src/core/analytics/` | `tests/core/analytics.test.ts` |
| 4.2 | Change attribution to domains | Implemented | `attributeChange`, `attributeDomainChange` | `tests/core/analytics.test.ts` |
| 4.3 | Ranking with movement | Implemented | `rankScorecards` | `tests/core/analytics.test.ts` |
| 4.4 | Forecasting that refuses to fabricate | Implemented | OLS with prediction intervals; refuses below six observed periods | `tests/core/forecast.test.ts` |

## 5. Data-quality intelligence

| # | Requirement | Status | Implementation | Tests |
|---|---|---|---|---|
| 5.1 | Detectors over completeness, validity, consistency | Implemented | Seven detectors; 197 open findings on the demo dataset | `tests/core/quality.test.ts` |
| 5.2 | Findings carry their evidence | Implemented | `EvidenceItem[]` on every finding | `tests/core/quality.test.ts` |
| 5.3 | Triage that survives re-synchronisation | Implemented | Finding status keyed on a stable identity | `tests/api/sync.test.ts` |

## 6. Governed AI

| # | Requirement | Status | Implementation | Tests |
|---|---|---|---|---|
| 6.1 | The model never produces numbers | Implemented | `intent → plan → **platform executes** → validate → narrate`; the model only emits an `AnalyticalQuery` | `tests/intelligence/pipeline.test.ts` |
| 6.2 | Nine query kinds | Implemented | `QUERY_KINDS` in `src/intelligence/types.ts` | evaluation set |
| 6.3 | Answers validated before presentation | Implemented | `validateResult()`; an unverifiable result is refused, not softened | `tests/intelligence/pipeline.test.ts` |
| 6.4 | Every quoted figure traceable to evidence | Implemented | Validator checks prose figures against the finding's own evidence | `tests/intelligence/pipeline.test.ts` |
| 6.5 | Authorisation before retrieval | Implemented | Permitted org-unit set computed first; planner sees only it; query re-checked; rows filtered | `tests/api/permissions.test.ts` |
| 6.6 | Works without a language model | Implemented | Rules planner and template narrator are the default; `ASPIRE_AI_ENABLED` is off by default | `tests/intelligence/pipeline.test.ts` |
| 6.7 | Evaluation set with known-correct answers | Implemented | 14 cases, checked on the analytical result rather than the prose | `tests/intelligence/pipeline.test.ts` |

## 7. Interface

| # | Requirement | Status | Implementation | Tests |
|---|---|---|---|---|
| 7.1 | Role-differentiated experiences, not hidden buttons | Implemented | `src/auth/experience.ts`; Overview branches to a different composition | `tests/core/experience.test.ts` |
| 7.2 | Overview | Implemented | Four movements, plus the cross-state section for users who hold both states | `tests/ui/components.test.tsx` |
| 7.3 | Performance with drill-down | Implemented | domain → indicator → contributor, depth-gated | `tests/api/permissions.test.ts` |
| 7.4 | Map | Implemented | Four metrics, real choropleth, descends a level at the root so both states are drawn | `tests/api/map.test.ts` |
| 7.5 | Intelligence workspace | Implemented | Question box, interpretation, evidence, suggested prompts by tier | `tests/intelligence/pipeline.test.ts` |
| 7.6 | Reports | Implemented | 6 types including cross-state comparison; print and CSV; provenance on both | `tests/api/reports.test.ts` |
| 7.7 | Actions | Implemented | Five states, assignment, outcome measured against a baseline. Assignees and updates are both scope-checked on the server | `tests/api/actions.test.ts` |
| 7.8 | Admin | Implemented | Connection, sync, methodology, users, indicators, audit | `tests/api/sync.test.ts` |
| 7.9 | Light theme default with a toggle that persists | Implemented | `THEME_INIT_SCRIPT` pre-paint, `aspire-theme` in `localStorage` | `tests/ui/components.test.tsx` |
| 7.10 | ASPIRE-GAC branding, no third-party marks | Implemented | Brand confined to `--brand-*` / `--accent-*` tokens | — |
| 7.11 | Accessibility to WCAG 2.1 AA | Implemented | axe across 8 pages × 6 personas × light and dark, 96 audits: zero violations | axe audit (manual run) |

## 8. Governance and honesty

| # | Requirement | Status | Implementation | Tests |
|---|---|---|---|---|
| 8.1 | No synthetic data presented as real | Implemented | DEMO labelled at the data layer, in the API, in the shell, on every report and export | `tests/api/reports.test.ts` |
| 8.2 | No invented methodology presented as official | Implemented | `PROVISIONAL` status badged wherever a score appears | `tests/api/reports.test.ts` |
| 8.3 | Audit log | Implemented | Sign-in, questions, refusals, report generation, exports, admin changes | `tests/api/sync.test.ts` |
| 8.4 | Provenance on printed output | Implemented | Source, mode, sync time, methodology version on every report and CSV | `tests/api/reports.test.ts` |

---

## Requirements this document cannot vouch for

- **Anything in a SOW not reflected in the written briefs.** See the note at the
  top. This is the largest single risk in the table.
- **Live DHIS2 behaviour.** Section 2 is tested against fixtures, not a server.
- **The official methodology.** Section 3.5 is provisional by construction.
- **Accessibility on an unaudited change.** The axe run is manual rather than
  part of CI, so it proves the state of the build it was run against and not
  the next one. See `SOW_GAP_ANALYSIS.md` §8.
