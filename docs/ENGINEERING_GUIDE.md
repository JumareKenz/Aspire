# Engineering guide

Conventions and constraints for working on this codebase. Read
`docs/ARCHITECTURE.md` first for the structure, and
`docs/ASPIRE_REPOSITORY_ASSESSMENT.md` for why it is the way it is.

---


## Commands

```bash
npm run dev         # development server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run (207 tests)
npm run seed        # create schema, seed registry + accounts, first sync
npm run sync        # synchronise from the configured source
npm run eval:ai     # run the Intelligence evaluation set
```

`npm test` and `npm run eval:ai` must both pass before a change is considered done.

---

## Architecture in one screen

```
DHIS2 Web API ─┐
               ├─► SourceAdapter port ─► canonical model ─► SQLite store
demo generator ─┘
                                                              │
        analytics · scoring · quality · forecast · insight ────┤
                                                              │
        governed NL pipeline ─────────────────────────────────┤
                                                              ▼
             RBAC-scoped API ─► Overview · Performance · Intelligence
                                · Map · Reports · Actions · Admin
```

| Directory | Contains | Rule |
|---|---|---|
| `src/core/**` | Domain engines: scoring, analytics, quality, forecast, insight | **Pure.** No I/O, no framework, no network. Everything is passed in. |
| `src/config/**` | Domains, indicator registry, methodology | Configuration that seeds the database. The database is authoritative once seeded. |
| `src/data/**` | Store, repositories, source adapters, sync | The only place that talks to PostgreSQL or DHIS2 |
| `src/services/**` | Composition of store + engines into page payloads | No React |
| `src/intelligence/**` | The governed question pipeline and its evaluation set | The model never computes |
| `src/auth/**` | Sessions, RBAC, geographic scope, experience configuration | Role differences are resolved here, not in pages |
| `src/design/**` | Tokens, primitives, charts, patterns | No data fetching except through the internal API |
| `src/app/**` | Routes | Pages compose services; API routes use `withUser` |

---

## Non-negotiable rules

**1. `src/core` stays pure.** If an engine needs data, it is a parameter. This is
what makes the scoring, quality and forecast logic testable without a database.

**2. Repositories are async and are the only database boundary.** Nothing
outside `src/data` may import `pg` or write SQL. Batch writes go through
`chunk`/`valuesClause` because PostgreSQL caps a statement at 65535 parameters.

**3. No component talks to DHIS2.** Components consume `/api/*`. The DHIS2
client runs on the server and its credentials never leave it.

**4. Role differences live in the experience layer, never in components.**
`src/auth/experience.ts` turns identity into an `Experience` — navigation,
depth, detail level, report types. A component asks the experience what it may
render; it never writes `if (role === 'EXECUTIVE')`. Navigation is generated
from `Experience.navigation` and `requireRoute()` guards against the same list,
so a hidden link is also an unreachable URL. See `docs/ROLE_ACCESS_MATRIX.md`.

**5. Authorisation happens before retrieval.** `assertOrgUnitInScope()` checks
geography *and* depth, and the intelligence pipeline filters the planner's
inputs before planning rather than redacting an answer afterwards.

**6. The model never produces a number.** In the Intelligence pipeline a
language model may (a) choose a structured query from a fixed schema restricted
to real identifiers, and (b) phrase findings the platform already computed and
validated. It has no data access and no arithmetic role. With no model
configured the platform answers every question by rules and templates — check
this still holds after any change to `src/intelligence`.

**7. Performance and data confidence are separate figures.** Never combine them
into one number and never let a score be presented without its confidence.

**8. Demo data is always labelled.** The data mode is carried in the model,
returned by the API, shown in the shell, and stamped on every report and export.
Never render a synthetic figure without it. The demo dataset sits on *real*
Gombe State geography — the labelling is what prevents confusion, not fictional
place names — but facility names are constructed, because naming a real service
point and attaching an invented score to it makes a claim about a real place.

**9. The methodology is provisional until told otherwise.** Anything derived
from `ASPIRE-SRHR-PROVISIONAL-v0` is badged. See `docs/SCORECARD_METHODOLOGY.md`.

**10. Indicators are configuration.** Never hard-code an indicator id, target or
threshold in a component or an engine.

**11. DHIS2 level numbers are not canonical levels.** They depend on how the
instance was built. The target instance is state-rooted
(State → LGA → Ward → Community → Facility); `DHIS2_LEVEL_MAP` overrides it.
Never assume a national hierarchy.

**12. Boundary rings must wind for d3-geo, not RFC 7946.** d3 reads polygons
spherically and wants exterior rings *clockwise* — the opposite of the GeoJSON
specification. Wrongly-wound data renders as the whole globe minus the intended
shape. `normaliseWinding` in `src/services/geography.ts` handles operator-supplied
files; `scripts/rewind-boundaries.cjs` fixes a file in place.

---

## Design principles

- **Restraint.** Cards only where they improve hierarchy; whitespace and
  typography do the rest. If a page looks like a template marketplace dashboard,
  it is wrong.
- **Every chart answers a question.** No decorative visualisations.
- **Status is never colour alone.** Always colour + label + shape. The
  categorical palette in `globals.css` was validated for colour-vision
  deficiency and contrast in both themes — re-validate before changing it.
- **Brand colour is for identity, not data.** The ASPIRE-GAC green and gold
  carry the mark, primary actions, selected states and active navigation. Data
  uses the separately validated viz palette. Primary actions use
  `--brand-action` / `--brand-action-fg`, which invert in dark mode so small
  text keeps 4.5:1.
- **Sentence case everywhere.** No shouting headings, no bold by default.
- **Light is the default theme** and the primary experience. Dark applies only
  on `data-theme="dark"`, never from `prefers-color-scheme`, and is re-applied
  before first paint by the script in `ThemeToggle`. Both palettes are picked
  against their own ground — dark is not an inversion.
- **Progressive disclosure.** Domains before indicators; indicators before
  facilities. The same screen serves an executive and an analyst.
- **Numbers are tabular.** Use the `numeric` class for anything compared in a
  column.
- All user-facing copy is British English and uses typographic apostrophes.

## Empty, loading and error states

Every view has all three, and each says something. "No data" is always
accompanied by why, and by what would change it. Technical detail appears only
for administrators, never as a raw stack trace.

---

## Security

- Sessions are signed JWTs in an httpOnly cookie; `ASPIRE_SESSION_SECRET` is
  required in production.
- Passwords use scrypt with a per-user salt.
- Authorisation is a role (capability) plus a geographic scope. Scope is applied
  in the service layer, not only at the HTTP boundary — see
  `assertOrgUnitInScope` and the scope filtering in `answerQuestion`.
- Sign-in, configuration changes, synchronisation, report generation and every
  Intelligence question are audited.
- Nothing is sent to an external AI service unless `ASPIRE_AI_ENABLED=true` is
  set explicitly, and even then only computed findings — never raw observations.

---

## Adding things

**A new indicator** — add it to `src/config/indicators.ts` (or via Admin →
Indicators once seeded). Nothing else changes.

**A new methodology** — add a record with `status: 'OFFICIAL'` and a new
version. `getActiveMethodology()` prefers official over provisional, so no code
changes. Historical scores keep the version they were computed with.

**A new data source** — implement `SourceAdapter` in `src/data/sources/`.

**A new question type** — add a `QueryKind`, a rule in `KIND_RULES`, an executor
branch, and at least one case in `src/intelligence/evals/cases.ts`.

---

## Environment

See `.env.example`. The platform runs with no configuration at all: it seeds
itself with clearly-labelled demo data on first request.
