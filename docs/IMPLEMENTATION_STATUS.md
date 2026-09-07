# Implementation status

**Date:** 2026-09-07
**Build:** 277 tests passing · 14/14 AI evaluation cases · 0 lint errors · 0 type
errors · 0 accessibility violations across 96 page audits (8 pages × 6 personas ×
light and dark) · 266 tier-walkthrough checks passing against the production
build · production build clean

---

## What was actually delivered

| Area | Status | Notes |
|---|---|---|
| **Foundation** | Complete | Design tokens, shell, sessions, RBAC + geographic scope, PostgreSQL store |
| **Canonical model** | Complete | OrgUnit · Period · Observation · ReportingRecord · Target, with materialised paths |
| **Indicator registry** | Complete | 15 indicators, 6 domains, fully configurable; editable in Admin |
| **Scorecard engine** | Complete | Methodology-driven, versioned, three scoring rules, three missing-data rules, coverage gate |
| **Analytics** | Complete | Trend with a stable band and history minimum; attribution; ranking |
| **Data quality** | Complete | Seven detectors; data confidence capped by completeness; triage that survives re-sync |
| **Forecasting** | Complete | OLS with prediction intervals; refuses below six observed periods |
| **Insights & recommendations** | Complete | Computed from figures, each carrying its evidence |
| **DHIS2 integration** | Complete, unverified against a live server | Official Web API; configurable level map; 5 real indicator UIDs; see caveats |
| **Multi-state architecture** | Complete | Bauchi and Sokoto under one root; role and scope independent; enforced in API, URL, exports, reports, map and AI |
| **Demo dataset** | Complete | Deterministic, internally consistent, real Bauchi and Sokoto geography (327 org units), planted signals in both states |
| **Overview** | Complete | Four movements: how are we doing / what needs attention / what changed / what we recommend |
| **Performance** | Complete | Scorecard with domain → indicator → contributor drill-down; ranked areas |
| **Intelligence** | Complete | Governed pipeline; 9 query kinds; evidence and interpretation shown; 11/11 evaluation cases |
| **Map** | Complete | Four metrics; real 43-LGA choropleth; small-multiples panels at the programme root; schematic fallback for unmapped geography |
| **Reports** | Complete | 6 reports including cross-state comparison, print-to-PDF, CSV export, provenance on both |
| **Actions** | Complete | Five states, assignment, outcome measured against a baseline score |
| **Admin** | Complete | Connection, sync history, freshness, methodology, users, indicators, audit |
| **Tests** | Complete | 277 across engines, store, adapters, geometry, pipeline, permissions, map, actions, reports, components |
| **Documentation** | Complete | 13 documents, `README.md`, `.env.example` |

---

## Inputs supplied later, and what they changed

Two of the four originally-missing inputs were supplied later and applied.

**Branding — ASPIRE-GAC.** The product carries its own identity: a geometric
mark (a rising performance series inside an institutional frame, drawn as SVG
so it holds at favicon size), a deep institutional green with a restrained gold
accent, and a matching app icon. Brand colour is confined to the `--brand-*`
and `--accent-*` tokens and is used for identity and primary actions only —
never for data, which keeps its separately validated palette.

**DHIS2 instance — configured, still unverified.** `https://dhis2.hiva.chat`,
state-rooted, 8 indicators / 187 data elements / 1,264 org units. Five indicators
now carry real UIDs. **The instance was returning `502 Bad Gateway`** (backend
on port 9090 not running) and no credentials were supplied, so nothing has been
run against it live. A state-rooted instance also means one connection per
state, and the adapter holds one — see the caveats below.

**Real geography — applied, then extended to both states.** All 43 LGA
boundaries of Bauchi and Sokoto ship with the platform
(`public/geo/lgas.geojson`, geoBoundaries gbOpen NGA ADM2 / GRID3, CC BY 4.0).
The map draws a real choropleth out of the box.

## Remaining caveats

**0. No signed scope of work was supplied.** The requirement set is
reconstructed from the written build briefs. `docs/SOW_IMPLEMENTATION_TRACEABILITY.md`
maps each reconstructed requirement to its implementation and tests, and
`docs/SOW_GAP_ANALYSIS.md` records what is outstanding — but **neither can see a
requirement the briefs never mentioned.** Diff a real SOW against the
traceability table before treating it as an acceptance document.

**1. The repository was empty.** Everything was built from first principles. See
`docs/ASPIRE_REPOSITORY_ASSESSMENT.md`.

**2. The scorecard methodology is still provisional.** The official ASPIRE-GAC
indicators, weights and thresholds were not among the supplied material. The
engine is configurable and versioned; the seeded record is `PROVISIONAL` and
every derived figure is badged. See `docs/SCORECARD_METHODOLOGY.md`.

**3. DHIS2 has not been exercised against the live server.** See above. Treat
first contact as commissioning.

**3a. One DHIS2 connection, two states.** The application models both states in
one hierarchy, but the adapter holds a single connection and the reference
instance is state-rooted. Live two-state synchronisation needs either an
instance rooted above both states (a configuration change — the level map
already supports it) or a per-state source in the source layer. This is the
largest architectural gap in the multi-state work; it does not affect demo mode
or any authorisation behaviour. See `docs/SOW_GAP_ANALYSIS.md` §4.

**4. Twelve of seventeen indicators have no DHIS2 mapping.** The instance
defines only 8 indicators, and family planning, adolescent SRHR, GBV and
commodity security are not among them. They need either DHIS2 indicators
defined or mappings onto the available data elements.

**5. All figures on screen are synthetic.** The demo dataset is labelled at the
data layer, in the API, in the shell and on every report and export. It now sits
on the *real* administrative geography of Bauchi and Sokoto, because a map of
invented places cannot be verified
and the deployment target is known — the pervasive labelling is what prevents
the confusion, not fictional names. Facility names remain constructed, since
naming a real service point and attaching an invented score to it would make a
claim about an identifiable place.

**6. Language-model assistance is off by default.** It requires an explicit
`ASPIRE_AI_ENABLED=true` plus a credential.

---

## Defects found and fixed during the build

Recorded because they show what the tests are actually for.

| Defect | Found by | Fix |
|---|---|---|
| `Number('')` is `0`, so an empty DHIS2 analytics cell would import as a reported zero — and a zero is scored where a missing value is excluded | Unit test | `parseCell` treats empty and whitespace as absent |
| Statistical detector flagged every steadily-declining unit as a data anomaly, burying real spikes | Reviewing 594 findings on the first run | Detrend before testing; test the residual against the unit's own trajectory |
| Data confidence could reach the seventies for a scope whose data was half missing | Reviewing confidence output | Confidence capped at completeness + 25 |
| Rank-order validation rejected "most improved" results, which are ordered by movement | AI evaluation set | Validate ordering only for rank-ordered query kinds; allow either direction |
| A ranking finding quoted a change figure absent from its own evidence | AI evaluation set | Added the change to the evidence |
| Prefix regexes like `/\bimprov\b/` never matched "improved" | Manual pipeline testing | Explicit suffix lists on every stem |
| Every sparkline in the product shared one silhouette | Visual review | Per-facility seasonal phase and amplitude |
| Percentage indicators saturated at 100, producing flat series that the detectors then flagged | Visual review | Soft ceiling below saturation |
| Sidebar left a visible seam on pages taller than the viewport | Dark-mode visual review | Full-height rail behind the sticky nav |
| Map failed `nested-interactive`: focusable areas inside `role="img"` are unreachable | axe audit | `role="group"` |
| 68 findings rendered as one unbroken table several screens long | Visual review | Paginated at 25 with a count |
| Model messaging duplicated in two panels | Visual review | Folded into one |
| SQLite could not run on Vercel — its filesystem is read-only outside `/tmp`, and `/tmp` is not shared between invocations, so accounts were seeded in one invocation and gone by the next | A deployment failing to sign in | Migrated to PostgreSQL behind the same repository interfaces |
| Concurrent cold starts would each seed the database | Reasoning about serverless before deploying | Postgres advisory lock around first-run setup; verified with three racing bootstraps producing 3 users and 1 sync run |
| A failed bootstrap was cached as a rejected promise, poisoning the instance for its lifetime | Same review | The memo is cleared on failure so the next request retries |
| **Real boundaries rendered as one giant rectangle covering the canvas** | Applying real geography | d3-geo reads polygons *spherically* and wants clockwise exterior rings — the opposite of RFC 7946. Specification-correct data therefore describes "the whole globe minus this LGA", collapsing the fitted scale from ~15,600 to 78. Rings are rewound once in the shipped file and normalised again on load for operator-supplied files |
| DHIS2 level mapping assumed a national hierarchy | Reading the target instance's metadata | Level map is configurable and defaults to the state-rooted shape; a malformed override is rejected rather than silently falling back |
| Analytics `LEVEL-n` built from canonical depth, not DHIS2's own numbering | Same | Level map is inverted to recover the instance's real level numbers |
| Map labels illegible on saturated fills | Visual review | White text with a dark halo via `paint-order`, drawn in a pass above every fill; small polygons get a leader line |
| White-on-green primary buttons failed contrast in dark mode (3.71:1) | axe audit, dark theme | Dedicated `--brand-action` / `--brand-action-fg` tokens; dark mode inverts to dark text on a lighter green |
| Zero-movement domains drew a stub bar labelled `+0` | Visual review | Rendered as "no change" |
| **The platform was built for one state, and `getRootOrgUnit()` used `LIMIT 1` on `parent_id IS NULL`** | Auditing the multi-state requirement | A single programme root above both states, so the top of the hierarchy has one answer |
| A programme root named "Bauchi and Sokoto" answered to a question naming either state, so "how is Bauchi doing?" returned the two-state aggregate | A failing evaluation case | Root named for the programme; org-unit name matching also strips the " State" suffix and keeps only the highest unit answering to a given name |
| The AI silently substituted the user's own scope for a geography they could not read — answering "compare Bauchi and Sokoto" with Bauchi's figures | Writing the multi-state authorisation matrix | The question is refused, naming what it cannot show, before any query is planned |
| The refusal skipped names under four characters, so a Bauchi officer asking about **Isa** — a real Sokoto LGA — was silently answered about Bauchi | Probing the running build by hand | Three-character names matched, with a stop list for names that are ordinary words; the test now asserts the refusal for *every* LGA of the other state, not a sample |
| At the programme root the map drew two dots several hundred kilometres apart, because no state-level boundary file ships with the platform | Visual review of the root map | Where the direct children have no boundaries but their children do, the map descends a level and labels each shape with its state |
| Both states in one projection wasted the canvas on the gap between them; labels collided and overflowed the frame | Screenshot of the descended map | Each state fitted to its own panel with a caption and divider; the note states that panels are not to a common scale |
| The user administration scope picker became a flat list of 46 checkboxes with no indication which state an LGA belonged to | Reviewing the admin screens after the hierarchy change | Grouped by state, LGAs nested and disabled when the state above them is already selected |
| A determinism test timed out at five seconds once the dataset covered 43 LGAs | Running the suite | Explicit 30-second budget — a timeout there says nothing about determinism |
| **The Actions board offered the whole user directory as assignees**, so a Bauchi officer could see that a Sokoto officer existed and assign them work about a geography they cannot open | Walking the product as every tier | Assignees filtered to people the viewer shares geography with, and `POST`/`PATCH` re-check the assignee id, because the dropdown is a convenience and the request carries an arbitrary id |
| **`PATCH /api/actions` updated an action by id with no scope check**, so an officer holding an id could reassign or close an action raised in the other state | Same walkthrough | The action is loaded first and its own geography checked against the caller's scope |
| Map leader lines all used one fixed offset, so small adjacent LGAs stacked their labels into unreadable piles | Screenshot review of the Sokoto map | Labels placed largest-first against reserved boxes: colliding ones move to a free leader position or are dropped, and the units stay selectable |
| The label width estimate ran narrow, so two labels could reserve non-overlapping boxes whose glyphs still touched | Screenshot review after the placement pass | Estimate widened and padded for the halo stroke |

---

## Verification performed

- **277 automated tests** — scoring, analytics, quality detection, confidence,
  forecasting, periods, store, demo generator, DHIS2 adapter, end-to-end
  pipeline, permission boundaries, map scope and label placement, action
  authorisation, reports, sync, UI components
- **AI evaluation set** — 14 questions with known-correct answers, checked on the
  analytical result rather than the prose. Four are multi-state: which state is
  worst, comparing the states, and below-target inside each state separately
- **Authorisation matrix** — role and scope varied one axis at a time across six
  personas, asserting that the other axis does not move
- **Tier walkthrough against the production build** — 266 checks driving the
  product as each of the six seeded accounts: navigation, all eleven
  destinations reached or guarded, no page naming a state outside scope,
  selector contents, facility and admin API allowed or refused, every offered
  report generated and exported, four intelligence questions answered with no
  out-of-scope row, the assignee list and cross-state action refusal, and no
  console errors
- **Accessibility** — axe (WCAG 2.1 AA) across 8 pages × 6 personas × light and
  dark, 96 audits: zero violations
- **Keyboard** — drawer open/escape/focus-return, scorecard expansion, indicator
  drill-down, map selection: all verified
- **Visual** — every page reviewed in light and dark at 768 / 900 / 1440,
  including the cross-state overview, the two-panel map and the comparison report
- **Console** — zero errors on every page
- **Build** — production build clean

---

## Migration to PostgreSQL

The platform was built on SQLite and moved to PostgreSQL so it can run on
Vercel. The change was confined to the data layer, which is what the repository
boundary exists for:

| Changed | Unchanged |
|---|---|
| `src/data/db/client.ts` — pool, schema application, transactions, batching | Every engine in `src/core` |
| The eight repository modules, now async | Every service's logic |
| `schema.sql` — Postgres types, JSONB for documents | The intelligence pipeline's behaviour |
| Call sites awaiting what were synchronous reads | Every component's markup |

No engine, service or component changed what it *does*. All 207 tests pass
against real PostgreSQL, and each store-backed suite now runs in its own
schema for isolation.

## What a next iteration would address

Stated plainly rather than presented as finished:

1. **Commission against the live DHIS2 instance** once its backend is running
   and credentials are available. Confirm the level map, the analytics
   responses and completeness registrations against expectations.
2. **Map the remaining twelve indicators**, either by defining DHIS2 indicators
   or by mapping onto the 187 available data elements.
3. **Apply the official methodology** once issued, and retire the provisional record.
4. **Disaggregation.** The model and schema carry a disaggregation key and the
   registry declares dimensions per indicator, but no view breaks figures down by
   age or sex yet.
5. **Scheduled synchronisation.** `npm run sync` is ready for cron; there is no
   in-app scheduler.
6. **Password self-service.** Administrators set passwords; there is no reset flow.
