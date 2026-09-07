# Role access matrix

Three tiers. Programme, LGA, M&E and technical users are deliberately **one
tier** (`ANALYST`), separated from each other by geographic scope rather than by
a different product.

## Why the tiers previously looked identical

Recorded because the fix is architectural, not cosmetic.

Navigation was a hard-coded array in `src/app/(app)/layout.tsx`, identical for
every role except a single `can(role, 'admin.view')` check on the Admin link.
Pages never consulted the role to decide *what* to render — only whether to
enable two buttons (`canManageActions`, `canTriage`). A permission model
existed but was used for action gating alone.

So role changed the trim, not the experience. There was no layer between
"identity" and "page", which is exactly where the difference belongs.

The missing layer is now `src/auth/experience.ts`:

```
identity → role + permissions + geographic scope
        → experience configuration        ← this was absent
        → authorised navigation → authorised data → intelligence
```

`Experience` is resolved once per request and consumed by navigation, pages,
services and API routes. A component asks the experience what depth it may
render; it never branches on a role name. Adding a role is a row in
`ROLE_PERMISSIONS` plus a case in `BY_ROLE`, not an audit of every page.

## Capability matrix

| Capability | Executive | Programme / LGA / M&E / Technical | Admin |
|---|---|---|---|
| Overview | Executive briefing (different composition) | Full analytical overview | Full |
| Performance — domain scorecard | Yes | Yes | Yes |
| Performance — indicator detail panel | No | Yes | Yes |
| Performance — facility drill-down | No (stops at LGA) | Yes, within scope | Yes |
| Period / geography comparison | No | Yes | Yes |
| Map | Yes, to LGA | Yes, to facility | Yes |
| Intelligence — ask questions | Yes | Yes | Yes |
| Intelligence — row-level evidence tables | No | Yes | Yes |
| Intelligence — suggested prompts | Position, change, risk | Cause, drivers, reporting quality | Full set |
| Data quality — confidence summary | Yes (Overview, Intelligence) | Yes | Yes |
| Data quality — findings workspace | No | Yes | Yes |
| Data quality — triage findings | No | Yes | Yes |
| Follow-up actions | No (not in navigation) | Yes | Yes |
| Reports — executive brief | Yes | Yes | Yes |
| Reports — intelligence summary | Yes | Yes | Yes |
| Reports — quarterly / area / data quality | No | Yes | Yes |
| Users and roles | No | No | Yes |
| Indicator configuration | No | No | Yes |
| Scorecard methodology | No | No | Yes |
| DHIS2 connection and synchronisation | No | No | Yes |
| Audit log | No | No | Yes |

## Navigation by tier

| Tier | Destinations |
|---|---|
| Executive | Overview · Performance · Intelligence · Map · Reports |
| Programme / M&E / Technical | Overview · Performance · Intelligence · Map · Reports · Actions |
| Admin | the above, plus Admin |

Navigation is generated from `Experience.navigation`, and `requireRoute()`
guards each destination against that same list — so a link that is not
rendered is also not reachable by typing its URL. The two cannot drift.

## Geographic scope

Independent of tier. An empty scope means national; otherwise the user sees
their assigned org units and everything beneath them, resolved through the
materialised ancestor path.

Scope and depth are both enforced in `assertOrgUnitInScope()`, which every page
and API route resolves org units through:

| Check | Refuses |
|---|---|
| Geography | A unit outside the user's assigned scope → 403 |
| Depth | A unit below the tier's `deepestLevel` → 403 |
| Existence | An unknown id → 404 |

An executive with *national* scope is still refused a facility id, because
depth is a separate check from geography. Hiding a link is never the thing
standing between a user and data.

## Where each rule is enforced

| Concern | Enforced in |
|---|---|
| Route reachability | `requireRoute()` / `requirePermission()` in `src/auth/server.ts` |
| Geography + depth | `assertOrgUnitInScope()`, `resolveScope()` |
| Capability | `can()` via `withUser(handler, permission)` on every API route |
| Report type | `experienceFor(user).reportTypes` in both the page and the export route |
| Intelligence scope | `answerQuestion()` filters the planner's org-unit list **before** planning, then re-checks the resolved query, then filters result rows |

## Intelligence authorisation

Authorisation happens **before** retrieval, not after an answer exists:

1. The permitted org-unit set is computed from scope **and** depth.
2. The planner is shown only those geographies, so it cannot name a place the
   user may not see — there is nothing to redact afterwards.
3. The resolved query's geography is re-checked against the same set, because a
   model is not trusted to have respected the list it was given.
4. Result rows are filtered against the set as a final defence, so no executor
   branch can widen scope by accident.

An analyst scoped to one LGA asking "rank every area" receives their own area
only. An executive receives areas, never facilities.

## Testing

- `tests/core/experience.test.ts` — configuration, navigation, depth, route guarding
- `tests/core/permissions.test.ts` — capability matrix and scope containment
- `tests/api/permissions.test.ts` — enforcement against the real store, including
  bypass attempts by id, and intelligence scope for both tiers
