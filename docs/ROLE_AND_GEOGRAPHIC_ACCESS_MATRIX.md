# Role and geographic access matrix

ASPIRE-GAC serves **Bauchi** and **Sokoto** from one application, one database
and one authentication system. Two questions decide what a user gets, and they
are answered independently:

```
Role  = what the user can do
Scope = where they can do it
```

Neither is derived from the other. There is no "executive means national" and
no "state officer means read-only". A state-scoped executive and a state-scoped
analyst see the same *geography* and different *depth*; a global analyst and a
state analyst have the same *depth* and different *geography*.

This document is the reference for both axes. `ROLE_ACCESS_MATRIX.md` covers
the role axis in more detail; this one is the authority where the two meet.

---

## 1. The two axes

### Role — `src/auth/rbac.ts`, `src/auth/experience.ts`

Three roles. Programme, LGA, M&E and technical users are deliberately one role
(`ANALYST`), separated from each other by scope rather than by a different
product.

| Role | Depth | Composition | Reports | Navigation |
|---|---|---|---|---|
| `EXECUTIVE` | to LGA | `SUMMARY` — executive briefing | Executive brief, intelligence summary, cross-state comparison | Overview · Performance · Intelligence · Map · Reports |
| `ANALYST` | to facility | `FULL` | all types | the above, plus Actions |
| `ADMIN` | to facility | `FULL` | all types | the above, plus Admin |

### Scope — `user.scope`, `src/auth/server.ts`

An array of org unit ids. **Empty means global**: every geography in the
hierarchy. Otherwise the user holds the named units and everything beneath
them, resolved through the materialised ancestor path.

| Scope value | Reads | Typical holder |
|---|---|---|
| `[]` | Both states and everything under them | Federal / programme-wide |
| `['state-bauchi']` | Bauchi and its 20 LGAs and their facilities | Bauchi state officer |
| `['state-sokoto']` | Sokoto and its 23 LGAs and their facilities | Sokoto state officer |
| `['lga-bauchi-darazo']` | One LGA and its facilities | LGA officer |
| `['state-bauchi','state-sokoto']` | Both states, but **not** the programme root | A two-state user who is not global |

The last row is the reason scope is a list rather than a single id: it is
already the extension point for a third state, and for LGA-level assignment
across state lines.

---

## 2. The hierarchy

```
ASPIRE-GAC Programme            COUNTRY   aspire-programme
├── Bauchi State                STATE     state-bauchi        20 LGAs
│   ├── Alkaleri                LGA       lga-bauchi-alkaleri
│   │   └── facilities          FACILITY  fac-bauchi-alkaleri-1 …
│   └── …
└── Sokoto State                STATE     state-sokoto        23 LGAs
    ├── Binji                   LGA       lga-sokoto-binji
    └── …
```

One root, not two trees. The root exists so that a global user has a genuine
aggregate to read and one place to compare from, and so that `getRootOrgUnit()`
— which resolves the top of the hierarchy — has a single answer. A state-scoped
user is scoped to their state node and never sees the root or the sibling.

The root is named for the programme, not for the states beneath it. A root
called "Bauchi and Sokoto" would answer to a question naming either state, and
the intelligence pipeline matches geographies by name.

---

## 3. The combined matrix

Six seeded personas, chosen to vary one axis at a time.

| Account | Role | Scope | Sees | Depth | Cross-state |
|---|---|---|---|---|---|
| `executive@aspire.local` | EXECUTIVE | `[]` | both states | LGA | yes |
| `bauchi.executive@aspire.local` | EXECUTIVE | `['state-bauchi']` | Bauchi | LGA | no |
| `analyst@aspire.local` | ANALYST | `[]` | both states | facility | yes |
| `bauchi.analyst@aspire.local` | ANALYST | `['state-bauchi']` | Bauchi | facility | no |
| `sokoto.analyst@aspire.local` | ANALYST | `['state-sokoto']` | Sokoto | facility | no |
| `admin@aspire.local` | ADMIN | `[]` | both states | facility | yes |

Reading the table the two ways it is meant to be read:

- **Down a role**: `bauchi.executive` and `executive` differ only in geography.
- **Across a scope**: `bauchi.executive` and `bauchi.analyst` differ only in
  depth and capability.

If either axis were secretly driving the other, one of those pairs would come
out identical. `tests/api/permissions.test.ts` asserts both directions.

---

## 4. What each capability checks

| Surface | Role check | Scope check |
|---|---|---|
| Navigation | `Experience.navigation` | — |
| Action assignees offered | — | `scopesOverlap()` |
| Action assignment by id | `actions.manage` | `scopesOverlap()` |
| Action update by id | `actions.manage` | the action's own geography |
| Route access | `requireRoute(pathname)` | — |
| Geography selector | `permittedLevels(experience)` | `resolveScope(user)` |
| Any org unit by id | depth vs `deepestLevel` | `isInScope(user.scope, unit.path)` |
| Scorecards, map, performance | depth | `assertOrgUnitInScope` |
| Report *types* | `experienceFor(user).reportTypes` | `accessibleStates(user).length` |
| Report generation | as above | `assertOrgUnitInScope` |
| CSV export | as above | as above |
| Intelligence question | `permittedLevels` | permitted org-unit set |
| Cross-state comparison | — | `accessibleStates(user).length > 1` |

Note the two rows with a dash. Cross-state comparison is **not** role-gated:
`geography.crossState` is granted to every role, because whether a user has two
states to compare is a fact about their scope. A state-scoped executive does
not get it; a state-scoped analyst does not get it either.

---

## 5. Enforcement points

Everything below is server-side. No check in this list is implemented by
hiding a link.

| Vector | Guard | Result |
|---|---|---|
| Typing a route | `requireRoute()` | redirect to the user's landing page |
| `?orgUnit=` in a URL | `resolvePageContext()` → `isInScope` | falls back to the user's own root |
| Org unit id to an API route | `assertOrgUnitInScope()` | 403 out of scope, 403 too deep, 404 unknown |
| `?type=` on a report or export | `reportTypesFor(user, stateCount)` | 403 / 404 |
| A question naming another state | `answerQuestion()` refusal | declines, names what it cannot show |
| A question about a permitted state | permitted org-unit set | answered within scope |
| A model-planned query | re-check after planning | geography reset to the user's default |
| A result row from any executor | `ExecutionScope` row filter | row dropped |
| An assignee id from another state | `assertAssigneeReachable()` | 403 |
| An action id from another state | `getAction()` then `assertOrgUnitInScope()` | 403 |

### `assertOrgUnitInScope` — the three refusals

```ts
if (!unit)                                   throw ScopeError(404)  // unknown
if (!isInScope(user.scope, unit.path))       throw ScopeError(403)  // wrong place
if (!permittedLevels(exp).includes(level))   throw ScopeError(403)  // too deep
```

Geography and depth are separate checks in that order. A *global* executive is
still refused a facility id — depth alone stops them — and a *state* analyst is
still refused the other state's LGA even though analysts may read LGAs.

---

## 6. Cross-state behaviour, surface by surface

| Surface | Global user | State-scoped user (any role) |
|---|---|---|
| Overview | Cross-state section: per-state cards, domain-by-domain table, widest gaps, diverging domains | No section rendered, and none to render |
| Geography selector | Programme root, both states, all 43 LGAs | Their state and its LGAs only |
| Map at the root | All 43 LGAs drawn as real boundaries, labelled by state | Cannot select the root |
| Map in a state | That state's LGAs | Same |
| Performance | Any geography in the hierarchy | Their subtree |
| Reports | Cross-state comparison offered | Not offered; refused by id |
| Actions | Every officer offered as an assignee | Only officers who share their geography |
| Intelligence | "Compare Bauchi and Sokoto" answered from stored data | Refused, naming the state it cannot show |

### Why the AI refuses rather than substitutes

Silently narrowing "compare Bauchi and Sokoto" to "here is Bauchi" answers a
different question than the one asked and presents it as the answer. The
platform declines and says which geography is outside the user's access, so the
user knows to ask an administrator rather than believing they have been shown a
comparison. The refusal contains no figures.

### Why the root map descends a level

The root's children are the two states, and no state-level boundary file ships
with the platform, so drawing the children directly would put two dots on the
map several hundred kilometres apart. Where the direct children have no
boundaries but *their* children do, the map draws those instead and labels each
shape with its state. This is presentational only: everything drawn is a
descendant of a geography the caller already resolved against the user's scope.

---

## 7. Adding a state

The application is not written against two states. To add a third:

1. Add its LGAs to `src/data/sources/demo/geography.ts` (demo mode) or map its
   DHIS2 org units (live mode).
2. Add its LGA boundaries to `public/geo/lgas.geojson` with matching
   `orgUnitId` and `state` properties.
3. Assign users `scope: ['state-<name>']`.

Nothing in `src/auth`, `src/services/states.ts`, the map, the reports or the
intelligence pipeline counts states or names them. `compareStates()` takes a
list and compares whatever is in it; the Overview panel and the comparison
report render however many columns they are given.

The one place with a fixed assumption is the demo generator's planted signals,
which name specific LGAs so the evaluation set has known-correct answers.

---

## 8. People, not just data

Scope governs who a user is *shown*, not only what figures they read. The
Actions board offers as assignees only people the viewer shares geography with:
a state officer is not told that the other state's officers exist, and cannot
hand them follow-up about a geography neither can both open. Programme-wide
officers appear for everyone, because they can read every geography.

`scopesOverlap()` answers this in both directions — a candidate whose scope
sits *inside* the viewer's, and one whose scope *contains* it, are both
reachable. The board is a convenience: `POST` and `PATCH` on `/api/actions`
re-check the assignee id, and `PATCH` loads the action and checks its own
geography, because an action is addressed by id and could otherwise be
reassigned or closed from outside the scope it belongs to.

---

## 9. Tests

| File | Asserts |
|---|---|
| `tests/api/permissions.test.ts` | the full role × scope matrix, both axes varied one at a time; refusals by id; cross-state gating; AI refusal and AI answer for the same question |
| `tests/api/map.test.ts` | the root map spans both states with real boundaries; a state map never draws the other state |
| `tests/api/reports.test.ts` | the comparison report is refused where there is nothing to compare; report types are an intersection of role and scope |
| `tests/api/actions.test.ts` | who a user may be shown and assign work to; that an action addressed by id is checked against its own geography |
| `tests/core/experience.test.ts` | experience configuration, navigation, depth, route guarding |
| `tests/core/permissions.test.ts` | capability matrix and scope containment |
| `tests/intelligence/pipeline.test.ts` | scope inside the pipeline; both states scored from their own LGAs |
