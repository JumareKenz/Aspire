# Implementation status

**Date:** 2026-09-06
**Build:** 207 tests passing · 11/11 AI evaluation cases · 0 lint errors · 0 type
errors · 0 accessibility violations across 11 pages in **both** light and dark ·
production build clean

---

## What was actually delivered

| Area | Status | Notes |
|---|---|---|
| **Foundation** | Complete | Design tokens, shell, sessions, RBAC + geographic scope, SQLite store |
| **Canonical model** | Complete | OrgUnit · Period · Observation · ReportingRecord · Target, with materialised paths |
| **Indicator registry** | Complete | 15 indicators, 6 domains, fully configurable; editable in Admin |
| **Scorecard engine** | Complete | Methodology-driven, versioned, three scoring rules, three missing-data rules, coverage gate |
| **Analytics** | Complete | Trend with a stable band and history minimum; attribution; ranking |
| **Data quality** | Complete | Seven detectors; data confidence capped by completeness; triage that survives re-sync |
| **Forecasting** | Complete | OLS with prediction intervals; refuses below six observed periods |
| **Insights & recommendations** | Complete | Computed from figures, each carrying its evidence |
| **DHIS2 integration** | Complete, unverified against a live server | Official Web API; configurable level map; 5 real indicator UIDs; see caveats |
| **Demo dataset** | Complete | Deterministic, internally consistent, real Gombe geography, planted signals |
| **Overview** | Complete | Four movements: how are we doing / what needs attention / what changed / what we recommend |
| **Performance** | Complete | Scorecard with domain → indicator → contributor drill-down; ranked areas |
| **Intelligence** | Complete | Governed pipeline; 9 query kinds; evidence and interpretation shown; 11/11 evaluation cases |
| **Map** | Complete | Four metrics; real Gombe LGA choropleth; schematic fallback for unmapped geography |
| **Reports** | Complete | 5 reports, print-to-PDF, CSV export, provenance on both |
| **Actions** | Complete | Five states, assignment, outcome measured against a baseline score |
| **Admin** | Complete | Connection, sync history, freshness, methodology, users, indicators, audit |
| **Tests** | Complete | 207 across engines, store, adapters, geometry, pipeline, permissions, reports, components |
| **Documentation** | Complete | 9 documents, `README.md`, `.env.example` |

---

## Inputs supplied later, and what they changed

Three of the four originally-missing inputs were supplied later, from the HIVA
platform repository, and applied.

**HIVA brand assets — applied.** `HIVA_Logo.png` and
`BRANDING_UPDATE_COMPLETE.md` gave the official Hayok Medicare identity. The
mark is redrawn as SVG (`src/design/patterns/Logo.tsx`) with the ring, gold
orbital arcs and gold-node "H" of the original, plus a favicon. The palette is
the documented one — forest green `#1A5C38`, warm gold `#C8A46E`, off-white
`#F5F2EC`, charcoal `#2C2C2C`, muted `#6B6B6B`, light sage `#D4E4DA` — extended
into a ramp using the logo artwork's own measured values (`#014C37`, `#DF9F3E`).
Brand colour is used for identity, primary actions and active navigation, not
for data.

**DHIS2 instance — configured, still unverified.** `https://dhis2.hiva.chat`,
Gombe State, 8 indicators / 187 data elements / 1,264 org units. Five indicators
now carry real UIDs. **The instance was returning `502 Bad Gateway`** (backend
on port 9090 not running) and no credentials were supplied, so nothing has been
run against it live.

**Real geography — applied.** Gombe State's eleven LGA boundaries now ship with
the platform (`public/geo/gombe-lgas.geojson`, geoBoundaries gbOpen NGA ADM2 /
GRID3, CC BY 4.0). The map draws a real choropleth out of the box.

## Remaining caveats

**1. The repository was empty.** Everything was built from first principles. See
`docs/ASPIRE_REPOSITORY_ASSESSMENT.md`.

**2. The scorecard methodology is still provisional.** The official ASPIRE-GAC
indicators, weights and thresholds were not among the supplied material. The
engine is configurable and versioned; the seeded record is `PROVISIONAL` and
every derived figure is badged. See `docs/SCORECARD_METHODOLOGY.md`.

**3. DHIS2 has not been exercised against the live server.** See above. Treat
first contact as commissioning.

**4. Twelve of seventeen indicators have no DHIS2 mapping.** The instance
defines only 8 indicators, and family planning, adolescent SRHR, GBV and
commodity security are not among them. They need either DHIS2 indicators
defined or mappings onto the available data elements.

**5. All figures on screen are synthetic.** The demo dataset is labelled at the
data layer, in the API, in the shell and on every report and export. It now sits
on *real* Gombe geography, because a map of invented places cannot be verified
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
| **Real boundaries rendered as one giant rectangle covering the canvas** | Applying real geography | d3-geo reads polygons *spherically* and wants clockwise exterior rings — the opposite of RFC 7946. Specification-correct data therefore describes "the whole globe minus this LGA", collapsing the fitted scale from ~15,600 to 78. Rings are rewound once in the shipped file and normalised again on load for operator-supplied files |
| DHIS2 level mapping assumed a national hierarchy | Reading the target instance's metadata | Level map is configurable and defaults to the state-rooted Gombe shape; a malformed override is rejected rather than silently falling back |
| Analytics `LEVEL-n` built from canonical depth, not DHIS2's own numbering | Same | Level map is inverted to recover the instance's real level numbers |
| Map labels illegible on saturated fills | Visual review | White text with a dark halo via `paint-order`, drawn in a pass above every fill; small polygons get a leader line |
| White-on-green primary buttons failed contrast in dark mode (3.71:1) | axe audit, dark theme | Dedicated `--brand-action` / `--brand-action-fg` tokens; dark mode inverts to dark text on a lighter green |
| Zero-movement domains drew a stub bar labelled `+0` | Visual review | Rendered as "no change" |

---

## Verification performed

- **201 automated tests** — scoring, analytics, quality detection, confidence,
  forecasting, periods, store, demo generator, DHIS2 adapter, end-to-end
  pipeline, permission boundaries, reports, sync, UI components
- **AI evaluation set** — 11 questions with known-correct answers, checked on the
  analytical result rather than the prose
- **Accessibility** — axe (WCAG 2.1 AA) across 11 pages in light *and* dark:
  zero violations
- **Keyboard** — drawer open/escape/focus-return, scorecard expansion, indicator
  drill-down, map selection: all verified
- **Visual** — every page reviewed in light and dark at 768 / 900 / 1440
- **Console** — zero errors on every page
- **Build** — production build clean

---

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
