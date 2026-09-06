# ASPIRE-GAC — Repository Assessment

**Date:** 2026-09-06
**Assessor:** Lead architecture pass, pre-implementation
**Repository:** `/root/aspire`

---

## 1. Finding of fact: the repository was empty

The build brief assumed an existing codebase to inspect, reuse, and refactor. It is important
to record accurately what was actually there.

```
$ ls -la /root/aspire
total 8
drwxr-xr-x  2 root root 4096 .
drwx------ 41 root root 4096 ..
```

The directory contained **no files at all** — no `package.json`, no git history, no framework,
no DHIS2 client, no HIVA brand assets, no design tokens, no components, no tests, no CI.

A semantic and lexical sweep for the terms named in the brief (`dhis2`, `srhr`, `scorecard`,
`indicator`, `analytics`, `lga`, `facility`, `anomaly`, `forecast`, `hiva`, `intelligence`, …)
returned zero matches, because there was nothing to match against.

**Consequences for the brief:**

| Brief instruction | Status |
|---|---|
| Inspect existing architecture | Done — none existed |
| Identify reusable components | None exist |
| Do not duplicate existing functionality | No risk |
| Reuse actual HIVA brand assets | **Not possible — no assets present** (see §6) |
| Refactor poor existing architecture | Nothing to refactor |
| Build necessary architecture properly from scratch | **This is the operative path** |

This assessment therefore documents the *chosen* architecture and the reasoning behind it,
rather than a critique of prior work.

---

## 2. Existing architecture

None. Greenfield.

## 3. Reusable components

None available in-repo. Reuse instead comes from the ecosystem, chosen deliberately and
kept minimal (§7).

## 4. Existing capabilities

None.

## 5. Existing gaps

Everything in the product brief is a gap. Prioritised into the implementation sequence in §11.

## 6. Assets that were requested but are not available

These are recorded explicitly because the brief forbids inventing them, and the product
must not pretend to have them.

| Missing input | Impact | How the build handles it |
|---|---|---|
| **HIVA brand assets** (logo, palette, type, tokens) | Cannot apply official brand | A neutral, restrained design system is built with brand values isolated in a single token file (`src/design/tokens.css`) and a single mark component. Swapping in real HIVA assets is a one-file change; no component hard-codes a brand hex. Nothing claims to be official HIVA branding. |
| **Official ASPIRE-GAC scorecard methodology** (indicators, weights, thresholds, targets, aggregation, missing-data rules) | Cannot compute an authoritative score | A *configurable, versioned* methodology engine is built. The seeded methodology is labelled `ASPIRE-SRHR-PROVISIONAL-v0` with `status: "provisional"`, and every surface that renders a score derived from it carries a provisional marker. Publishing the official methodology is a config addition, not a code change. |
| **Live DHIS2 instance + credentials** | Cannot ingest authoritative data | A source-adapter port with two implementations: a real DHIS2 adapter (official Web API: `/api/analytics`, `/api/organisationUnits`, `/api/indicators`, `/api/dataSets`, `/api/completeDataSetRegistrations`) and a deterministic demo generator. The demo dataset is labelled `DEMO DATA` at the data layer, the API layer and in every view. Switching sources is an environment change. |
| **Official Nigeria/state LGA boundary GeoJSON** | Cannot draw true geography | The map consumes a pluggable `BoundarySource`. With no official boundaries configured it renders a **schematic cartogram**, explicitly labelled as schematic — it never presents synthetic polygons as real administrative boundaries. Dropping in real GeoJSON switches the map to true geography with no component changes. |

## 7. Recommended architecture

Layered, modular, one deployable. No microservices, no queues, no external infrastructure —
per the brief's anti-overengineering constraint.

```
DHIS2 Web API ─┐
               ├─► Source adapter (port)  ─►  Canonical SRHR model  ─►  SQLite store
Demo generator ─┘                                                          │
                                                                           ▼
                                       ┌───────────── Analytics engine ─────────────┐
                                       │  aggregation · trend · ranking · compare   │
                                       └────────────────────┬───────────────────────┘
                                                            ▼
              ┌──────────────────── Intelligence engines (pure, testable) ───────────────────┐
              │  scoring · data quality · forecasting · recommendation · insight · narrative │
              └────────────────────────────────┬────────────────────────────────────────────┘
                                               ▼
                             Governed query pipeline (NL → structured query → execute
                             → validate → explain), RBAC-scoped HTTP API
                                               ▼
                                 App shell · Overview · Performance · Intelligence
                                 · Map · Reports · Actions · Admin
```

**Principles enforced by the layout:**

- `src/core/**` is **pure**: no I/O, no framework imports, no network. Fully unit-testable.
  All scoring, trend, quality, forecast and recommendation logic lives here.
- No React component talks to DHIS2. Components consume the internal API only.
- The LLM never produces numbers. It receives a *computed, validated* result set and writes
  prose about it. With no model credentials the platform still answers analytically, using a
  deterministic narrative renderer.
- Methodology is data, not code.

**Stack decisions and their reasons:**

| Choice | Reason |
|---|---|
| Next.js 16 App Router, React 19, TypeScript strict | Server components keep heavy aggregation off the browser; one deployable; typed end to end |
| Tailwind v4 + hand-built design system | Restraint requires owning the primitives; no template-marketplace component kit |
| SQLite (`better-sqlite3`) behind repository interfaces | Zero-infrastructure, synchronous, fast for the aggregate volumes involved; repositories mean Postgres is a swap, not a rewrite |
| Hand-built SVG charts | Every chart answers a question; chart libraries push decorative defaults and ship weight we do not need |
| `d3-geo` only for projection math | Small, no tile server, no network dependency in the map |
| `jose` + scrypt sessions, own RBAC | Auth needs are narrow and specific (geographic scope + tier); a full auth framework would be more surface than value |
| Vitest | Fast, native ESM/TS |
| AI SDK (`ai`), optional at runtime | LLM is an *enhancement* to explanation, never a dependency for correctness |

## 8. What should be reused

Nothing in-repo. Ecosystem reuse limited to the table in §7.

## 9. What should be refactored

Not applicable at assessment time. The scaffold's default `create-next-app` marketing page,
globals and font wiring are removed in the first implementation commit.

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Provisional scoring methodology mistaken for official | **High** | `status: "provisional"` on the methodology record; provisional badge rendered next to every derived score; methodology version stamped on every scorecard and report |
| Demo data mistaken for production data | **High** | Data mode carried in the canonical model, returned by every API response, and surfaced as a persistent shell banner; demo rows are physically separated by source tag |
| LLM fabricating figures | **High** | LLM has no data access and no arithmetic role; it receives computed facts and is evaluated against a fixed answer set |
| Forecasting on thin history | Medium | Hard minimum-history gate; explicit "insufficient data" result type that the UI must render |
| DHIS2 analytics query volume | Medium | Server-side dimensional queries only, cached, never raw data dumps to the browser |
| Scope: brief is very large | Medium | Sequenced below; each phase verified before the next |

## 11. Implementation sequence

1. Foundation — design tokens, shell, auth, RBAC, SQLite store *(done)*
2. Canonical model, indicator registry, configurable methodology engine *(done)*
3. Analytics engine — aggregation, trend, ranking, comparison, attribution *(done)*
4. Source adapters — demo generator + DHIS2 client, sync orchestration *(done)*
5. Data-quality intelligence — completeness, timeliness, validity, consistency, statistical,
   temporal, repeated-value; data-confidence scoring *(done)*
6. Overview, Performance, scorecard drill-down *(done)*
7. Intelligence — governed NL pipeline, evidence panels, evaluation set *(done)*
8. Forecasting and recommendations *(done)*
9. Map, Reports, Actions, Admin *(done)*
10. Tests, accessibility and visual review, dead-code removal *(done)*

Status detail is tracked in `docs/IMPLEMENTATION_STATUS.md`.
