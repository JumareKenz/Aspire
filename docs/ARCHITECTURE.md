# Architecture

## The shape of it

```
┌─ Sources ────────────────────────────────────────────────────────────────┐
│  DHIS2 Web API                     Demo generator                        │
│  /api/analytics, /api/organisationUnits,   deterministic, labelled DEMO  │
│  /api/dataSets, /api/completeDataSetRegistrations                        │
└───────────────────────┬──────────────────────────────────────────────────┘
                        │  SourceAdapter (the only seam)
┌───────────────────────▼──────────────────────────────────────────────────┐
│  Canonical SRHR model — OrgUnit · Period · Observation · ReportingRecord │
│  Everything above this line is written against these types, never        │
│  against a source's own API shape.                                       │
└───────────────────────┬──────────────────────────────────────────────────┘
                        │  repositories
┌───────────────────────▼──────────────────────────────────────────────────┐
│  PostgreSQL store (pg)                                                   │
└───────────────────────┬──────────────────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────────────┐
│  src/core — PURE ENGINES (no I/O, no framework, no network)              │
│                                                                          │
│   analytics/  stats · trend · attribution                                │
│   scoring/    methodology-driven scorecard engine                        │
│   quality/    seven detectors + data-confidence                          │
│   forecast/   OLS trend with explicit insufficiency                      │
│   insight/    insight + recommendation generation                        │
└───────────────────────┬──────────────────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────────────┐
│  src/services — composition (store + engines → page payloads)            │
│  scorecards · overview · indicators · geography · reports · actions      │
└───────────────────────┬──────────────────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────────────┐
│  src/intelligence — governed question pipeline                           │
│  intent → planner → EXECUTE → validate → explain/narrate                 │
└───────────────────────┬──────────────────────────────────────────────────┘
                        │  RBAC-scoped HTTP API
┌───────────────────────▼──────────────────────────────────────────────────┐
│  src/app — Overview · Performance · Intelligence · Map · Reports ·       │
│            Actions · Admin      (src/design supplies every primitive)    │
└──────────────────────────────────────────────────────────────────────────┘
```

## Why the layers are where they are

**`src/core` is pure.** Every engine takes its data as a parameter. No database
handle, no `fetch`, no React. This is not stylistic: it is what allows the
scoring, trend, quality and forecast logic to be tested exhaustively without
fixtures or mocks, and what guarantees that the figure on a screen, the figure in
a report and the figure in an AI answer are produced by the same code path.

**One seam to the outside world.** `SourceAdapter` is the only interface that
knows a source exists. Adding a source is implementing that interface; it is not
a change to the product. The demo generator and the DHIS2 adapter are peers.

**Services compose, they do not calculate.** A service loads from repositories
and hands the result to an engine. When you find arithmetic in `src/services`,
it belongs in `src/core`.

**The store is an implementation detail.** Repositories are the boundary. The
platform was originally built on SQLite and moved to PostgreSQL by rewriting
only `src/data/db/client.ts` and the eight repository modules — no engine, no
service and no component changed its logic. That is the property the boundary
exists to provide.

## Stack, and why

| Choice | Reason |
|---|---|
| Next.js 16 App Router, React 19 | Server components keep aggregation off the browser; one deployable |
| TypeScript, `strict` | The domain has many nullable figures; the type system is doing real work here |
| PostgreSQL via `pg` | Runs anywhere the platform does, including serverless. Behind repositories, so the engine is an implementation detail |
| Tailwind v4 + hand-built primitives | Restraint requires owning the components |
| Hand-built SVG charts | Every chart answers a question; chart libraries ship weight and decorative defaults |
| `d3-geo` for projection only | No tile server, no network dependency in the map |
| `jose` + scrypt, own RBAC | The requirement is narrow (capability + geographic scope); a framework would be more surface than value |
| AI SDK, optional at runtime | The model is an enhancement to phrasing, never a dependency for correctness |
| Vitest | Fast, native TS/ESM |

## Performance

- **Aggregate at the source.** The DHIS2 adapter issues one analytics request
  per org level using `LEVEL-n` dimensions, not one per org unit, and never
  downloads raw data values.
- **One query per view, not per row.** `getSeriesForUnits` loads every child's
  full series in a single statement; a 14-LGA page is two queries, not twenty-eight.
- **Score history is a by-product.** The scoring engine already scores every
  historical period to compute a trend, so `overallSeries` is exposed rather than
  recomputed for sparklines and trend lines.
- **Detectors are scoped deliberately.** Completeness and timeliness are reported
  at LGA level for recent periods; value-level detectors run at LGA and facility.
  Raising one finding per facility per period would produce hundreds of rows
  saying the same thing.
- **Drill-down is fetched on demand.** A scorecard renders fifteen indicators;
  only the one a user opens loads its history, contributors and forecast.

## Running serverless

The platform runs on Vercel Functions as well as on a long-lived server. Three
things make that work:

- **A connection pool cached on `globalThis`.** Fluid Compute reuses instances,
  so a warm pool is reused rather than reconnected per request. `max` stays
  small because instances are numerous.
- **Idempotent schema application.** Every statement in `schema.sql` is
  `IF NOT EXISTS`, applied once per process on first use. There is no separate
  migration step to forget on a platform with no deploy hook.
- **A Postgres advisory lock around first-run setup.** Many instances can cold
  start at once; the lock means exactly one seeds the registry, accounts and
  demo dataset while the others wait and then observe the finished state.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| DHIS2 unreachable | Sync run recorded as FAILED with the reason; the store keeps the last good data; Admin shows it; pages continue to serve |
| Database unreachable | Requests fail with a human-readable message; a failed bootstrap is not cached, so the next request retries rather than the instance staying poisoned for its lifetime |
| No indicators mapped to DHIS2 | Sync refuses with a specific message rather than importing nothing silently |
| Empty analytics cell | Treated as absent, never as a reported zero |
| Coverage below the methodology minimum | No score published; the page explains why instead of showing a misleading number |
| Fewer than six observed periods | No forecast; an explicit insufficiency message |
| Model unavailable or failing | Rules plan the query and templates write the prose; the answer is unchanged in substance |
| Result fails validation | The answer is withheld and logged; the platform says so rather than presenting an unverified figure |
