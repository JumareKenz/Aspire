# Implementation status

**Date:** 2026-09-06
**Build:** 201 tests passing · 0 lint errors · 0 type errors · 0 accessibility
violations across 10 pages · production build clean

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
| **DHIS2 integration** | Complete, unverified against a live server | Official Web API; see caveat below |
| **Demo dataset** | Complete | Deterministic, internally consistent, fictional names, planted signals |
| **Overview** | Complete | Four movements: how are we doing / what needs attention / what changed / what we recommend |
| **Performance** | Complete | Scorecard with domain → indicator → contributor drill-down; ranked areas |
| **Intelligence** | Complete | Governed pipeline; 9 query kinds; evidence and interpretation shown; 11/11 evaluation cases |
| **Map** | Complete | Four metrics; pluggable boundaries; schematic fallback, labelled |
| **Reports** | Complete | 5 reports, print-to-PDF, CSV export, provenance on both |
| **Actions** | Complete | Five states, assignment, outcome measured against a baseline score |
| **Admin** | Complete | Connection, sync history, freshness, methodology, users, indicators, audit |
| **Tests** | Complete | 201 across engines, store, adapters, pipeline, permissions, reports, components |
| **Documentation** | Complete | 8 documents, `CLAUDE.md`, `.env.example` |

---

## Honest caveats

These are the limits of what could be verified with the inputs available. They
are stated here rather than left for someone to discover.

**1. The repository was empty.** The brief described inspecting and reusing an
existing codebase. There was none — no files at all. Everything here was built
from first principles. See `docs/ASPIRE_REPOSITORY_ASSESSMENT.md`.

**2. The scorecard methodology is provisional.** The official ASPIRE-GAC
indicators, weights, thresholds and rules were not supplied. The engine is fully
configurable and versioned; the seeded record is marked `PROVISIONAL` and every
figure derived from it is badged. Publishing the official methodology is a
config addition, not a code change. See `docs/SCORECARD_METHODOLOGY.md`.

**3. DHIS2 is unverified against a live instance.** No server or credentials
were available. The client is written against the documented Web API and is
unit-tested against mocked responses. Treat first contact with a real instance
as a commissioning step. Indicator UIDs are deliberately `null` — inventing them
would produce a system that queries nothing while appearing to work.

**4. No HIVA brand assets were available.** No logo, palette, type or tokens
existed in the repository. Rather than invent an organisation's identity, the
product uses a neutral mark and a restrained palette, with every brand value
isolated in `--brand-*` in `globals.css` and a single `Logo` component. Swapping
in official assets is a two-file change. Nothing claims to be official HIVA
branding.

**5. No official boundary geometry.** The map renders a clearly-labelled
schematic layout. Setting `ASPIRE_BOUNDARIES_PATH` switches it to true geography
with no component changes.

**6. All figures on screen are synthetic.** The demo dataset is labelled at the
data layer, in the API, in the shell and on every report and export. It uses
fictional place names so it cannot be mistaken for reporting about real places.

**7. Language-model assistance is off by default.** It requires an explicit
`ASPIRE_AI_ENABLED=true` plus a credential. Everything works without it; the
model only ever chooses a query shape and phrases verified findings.

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

---

## Verification performed

- **201 automated tests** — scoring, analytics, quality detection, confidence,
  forecasting, periods, store, demo generator, DHIS2 adapter, end-to-end
  pipeline, permission boundaries, reports, sync, UI components
- **AI evaluation set** — 11 questions with known-correct answers, checked on the
  analytical result rather than the prose
- **Accessibility** — axe (WCAG 2.1 AA) across 10 pages: zero violations
- **Keyboard** — drawer open/escape/focus-return, scorecard expansion, indicator
  drill-down, map selection: all verified
- **Visual** — every page reviewed in light and dark at 768 / 900 / 1440
- **Console** — zero errors on every page
- **Build** — production build clean

---

## What a next iteration would address

Stated plainly rather than presented as finished:

1. **Commission against a real DHIS2 instance.** Map the indicator UIDs, run a
   sync, and confirm the analytics and completeness responses match expectations.
2. **Apply the official methodology** once issued, and retire the provisional record.
3. **Apply official HIVA brand assets.**
4. **Load real boundary geometry** to replace the schematic map.
5. **Disaggregation.** The model and schema carry a disaggregation key and the
   registry declares dimensions per indicator, but no view breaks figures down by
   age or sex yet.
6. **Scheduled synchronisation.** `npm run sync` is ready for cron; there is no
   in-app scheduler.
7. **Password self-service.** Administrators set passwords; there is no reset flow.
