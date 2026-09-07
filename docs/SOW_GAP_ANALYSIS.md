# SOW gap analysis

What is **not** delivered, what is delivered but unverified, and what is
delivered on a placeholder. Written to be read before acceptance, not after.

**Scope of this document.** No signed scope-of-work was supplied to this
repository; the requirement set is reconstructed from the written build briefs.
See the note at the top of `SOW_IMPLEMENTATION_TRACEABILITY.md`. **The largest
gap this document cannot see is anything the SOW requires that the briefs did
not mention.** Diff a real SOW against the traceability table first.

Gaps are ordered by what they would cost if ignored.

---

## Blocking for production use

### 1. The scorecard methodology is provisional

`ASPIRE-SRHR-PROVISIONAL-v0` — indicator set, domain weights, scoring rules and
status thresholds were all chosen by the build, not issued by the programme.

Every score in the product derives from it. It is versioned, stored as a
document, editable in Admin, and badged `PROVISIONAL` on every surface that
shows a derived figure, so nothing is presented as official. But **no score
should be quoted outside the platform until the official methodology replaces
it.**

*Closing it:* load the official indicators, weights and thresholds as a new
methodology version and mark it `ACTIVE`. The engine needs no change. Historic
scores stay attributed to the version that produced them.

### 2. DHIS2 has never been exercised against a live server

The adapter is written against the official Web API and tested against
fixtures. It has not made a request to a real instance: the configured host was
returning `502 Bad Gateway` and no credentials were supplied.

Unverified against reality: authentication, the org-unit level map, analytics
response shape at scale, `completeDataSetRegistrations` semantics, paging
behaviour, and how long a full sync takes.

*Closing it:* treat first contact as a commissioning exercise, not a
configuration change. Confirm the level map before trusting any aggregate — a
wrong level map files every LGA as a state and every ward as a facility, and
every figure above them is then computed over the wrong set.

### 3. Twelve of seventeen indicators have no DHIS2 mapping

The reference instance defines 8 indicators and 187 data elements. Family
planning, adolescent SRHR, GBV and commodity security are not among them.
Unmapped indicators are skipped at synchronisation and listed in Admin, so the
gap is visible rather than silent — but four of the six domains would score on
partial evidence, and the coverage gate may refuse to publish a score at all.

*Closing it:* define DHIS2 indicators for them, or map each onto the underlying
data elements in Admin → Indicators.

### 4. Two states, and DHIS2 is configured for one instance

The application models both states in one hierarchy. The DHIS2 adapter holds
**one** connection. A state-rooted DHIS2 deployment — which is what the
reference instance is — means one instance *per state*, and there is no
multi-source synchronisation.

This is the single largest architectural gap in the multi-state work. It does
not affect demo mode, and it does not affect any authorisation behaviour, but
**live two-state operation is not possible as built.**

*Closing it:* either (a) point at one DHIS2 instance rooted above both states
and set `DHIS2_LEVEL_MAP` accordingly — the adapter already supports this and it
is the smaller change; or (b) extend the source layer to hold a connection per
state and merge at sync. Option (b) needs a per-source sync run, per-source
credentials, and a decision about what happens when one state's sync fails.

---

## Delivered, with a stated limitation

### 5. The AI catches geographies by name, not by description

A question naming a state or LGA outside the user's scope is refused, naming
what it cannot show. Verified for every LGA of the state a scoped user does not
hold.

A question that *describes* a geography without naming it — "the other state",
"compare us with our neighbour" — is not caught by name matching. It is still
**safe**: the planner is only ever shown permitted geographies, the resolved
query is re-checked, and every result row is filtered. In practice such
questions fall out as "two or more geographies the platform recognises are
needed for a comparison", which is honest. But a question like "which state is
performing worse?" from a single-state user is answered as a summary of their
own state rather than declined, and the answer does not say that the question
as asked could not be answered.

*Closing it:* recognise comparative phrasing with no resolvable second
geography and decline explicitly. Small, and worth doing.

### 6. Map panels are not to a common scale

At the programme root the map draws each state in its own panel, fitted
independently. Two shapes side by side invite a size comparison that the
projection does not support. The note under the map says so; nothing else
prevents the misreading.

*Closing it:* a shared scale bar, or a common projection scale with the panels
positioned rather than fitted. The latter wastes canvas on the state with the
smaller extent.

### 7. Some map labels are dropped rather than shown

Labels are placed largest-polygon-first, and one that would collide with a
label already placed is moved to a free leader position or, if none is free,
omitted. In the dense cluster of small LGAs around a state capital that means a
few units carry no visible label at the state or programme scale.

They remain focusable, hoverable and selectable, and their names are in the
accessible label, the SVG title and the detail panel — but a reader scanning
the map alone will not see every name.

*Closing it:* nothing is strictly required. A denser label style, or labelling
the dropped units on hover of their cluster, would recover them.

### 8. Accessibility audits are manual

axe (WCAG 2.1 AA) was run across eight pages × six personas × light and dark —
96 page audits, zero violations, including every cross-state surface. The run
is a script executed by hand, not part of `npm test`, so a regression would not
be caught by CI.

*Closing it:* move the audit into the test suite behind a flag, and run it in CI
against a built server.

### 9. Cross-state comparison is two states wide by construction of the data, not of the code

`compareStates()` takes a list and compares whatever is in it. The Overview
panel and the comparison report render as many columns as they are given. Three
states would work. What is *tested* is two, because two is what the hierarchy
holds.

*Closing it:* nothing, until a third state exists. Noted so that "supports N
states" is not read as "verified for N states".

---

## Not built

### 10. Disaggregation

The canonical model and the schema carry a disaggregation key, and the registry
declares dimensions per indicator, but no view breaks any figure down by age or
sex. For an SRHR platform this is a substantive absence — adolescent outcomes
are exactly where disaggregation matters — and it is a data-model-complete,
UI-absent gap rather than a redesign.

### 11. Scheduled synchronisation

`npm run sync` is ready for cron. There is no in-app scheduler, no retry policy
and no alert when a sync fails.

### 12. Password self-service

Administrators set passwords. There is no reset flow, no expiry and no
lockout after repeated failures.

### 13. LGA-level user administration across states

Scope is a list of ids and supports LGA-level assignment — the model, the
enforcement and the tests all cover it. The Admin → Users screen offers the
geography picker over the whole hierarchy, so an administrator *can* assign an
LGA, but there is no bulk assignment and no way to give one user LGAs in two
different states through the interface without selecting each.

### 14. Per-state configuration

Indicator targets, methodology and thresholds are programme-wide. If Bauchi and
Sokoto need different targets for the same indicator, the targets table already
keys on org unit and period — but nothing in Admin sets them per state.

---

## Explicitly out of scope, recorded so it is not mistaken for an oversight

- **Data entry.** ASPIRE-GAC reads from DHIS2; it is not a collection tool.
- **Individual-level records.** The model is aggregate. No patient data enters
  the platform, by design.
- **Real facility identities.** Facility names are constructed. See
  `SCOPE_DECISIONS.md` §10.
- **A language model in the default configuration.** The pipeline works
  entirely without one; `ASPIRE_AI_ENABLED` is off unless set.

---

## Verification standing behind this document

| Check | Result |
|---|---|
| Automated tests | 277 passing |
| AI evaluation set | 14/14 |
| Type check | clean |
| Lint | clean |
| Production build | clean |
| axe WCAG 2.1 AA | 96 page audits, zero violations |
| Tier walkthrough | 266 checks across all six personas, all passing |

The tier walkthrough drives the running production build as each of the six
seeded accounts and checks, for every one of them: the navigation it is given,
each of the eleven destinations reached or guarded, that no page names a state
outside its scope, the geography selector's contents, whether a facility record
and the admin API are allowed or refused, every report type it is offered
generated and exported end to end, four intelligence questions answered with no
row citing an out-of-scope geography (and no facility row for an executive),
that the assignee list withholds the other state's officers and that raising an
action there is refused, and that no page logged a console error.
