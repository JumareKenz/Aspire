# Scope decisions

Decisions taken while making ASPIRE-GAC serve two states, with the reasoning
and the alternatives that were rejected. Recorded because several of them are
not obviously right, and a future change to any of them should be made
deliberately rather than by accident.

---

## 1. Role and scope are separate axes, not one hierarchy

**Decision.** `Role` answers *what a user can do*; `scope` answers *where*.
Neither derives from the other. A state-scoped executive is a real,
first-class combination.

**Rejected: role implies scope.** The obvious shortcut — "executives are
national, state officers are analysts" — collapses the two questions into one.
It makes a state commissioner impossible to represent, and it means the moment
a state wants its own executive view, the role model has to be reopened.

**Rejected: a scope level on the role.** A `role: 'STATE_EXECUTIVE'` variant per
state multiplies roles by states. Two states and three roles is six; three
states is nine, and every capability check has to enumerate them.

**Consequence.** Every feature has to decide which axis gates it. The
cross-state comparison is gated on *scope*; the facility drill-down is gated on
*role*. Getting this wrong is the failure mode the model exists to prevent, so
`tests/api/permissions.test.ts` varies one axis at a time and asserts that the
other does not move.

---

## 2. One root above both states, not two disconnected trees

**Decision.** A `COUNTRY`-level root, `aspire-programme`, sits above Bauchi and
Sokoto.

**Why.** Three things need a single answer:

- `getRootOrgUnit()` resolves the top of the hierarchy. With two parentless
  units it returned whichever the database listed first — the bug that surfaced
  this whole question.
- A global user needs a genuine aggregate to open on. Without a root, "the
  programme's overall score" does not exist as a stored figure and would have to
  be computed ad hoc by every surface that wanted it.
- Cross-state comparison needs a geography to be *at* while comparing.

**Rejected: two roots and a synthetic union.** Every aggregate becomes a special
case, and the scope model needs a "user with several roots" concept that the
materialised path cannot express.

**Cost.** A state-scoped user must be refused the root, which is now a real node
they could name. `assertOrgUnitInScope` refuses it: `isInScope(['state-bauchi'],
['aspire-programme'])` is false because the root is an *ancestor*, not a
descendant.

---

## 3. Empty scope means global

**Decision.** `scope: []` grants the whole hierarchy.

**Why.** It makes the common case cheap and keeps scope purely additive: a scope
entry only ever *narrows*. The alternative — an explicit `['aspire-programme']`
— reads as a normal scope but behaves as a superuser flag, and an administrator
removing what looks like one org unit would silently create a user who can see
nothing.

**Risk accepted.** A bug that produces an empty scope array grants everything
rather than nothing. This is mitigated by scope never being *computed* — it is
stored per user and only ever read.

---

## 4. Scope is a list of org unit ids at any level

**Decision.** Not a state field, not a level enum. A list of ids.

**Why.** It is already the answer for LGA-level assignment, for a user who holds
two states but not the programme root, and for a third state. Nothing in the
code counts states or names them.

**Consequence.** `isInScope` is a path-containment test, which is why every org
unit carries a materialised ancestor path.

---

## 5. Cross-state features are gated on scope, and `geography.crossState` is granted to every role

**Decision.** The capability exists and every role has it. Whether a user sees
a cross-state surface is decided by `accessibleStates(user).length > 1`, which
reads `user.scope` and nothing else.

**Why.** Withholding the capability from executives would re-introduce "role
implies scope" through the back door. Comparing the two states a user already
holds is not a more privileged act than looking at either one.

**Consequence.** `accessibleStates()` deliberately does not take a role. If a
future change makes it consult one, decision 1 has been reversed.

---

## 6. The AI refuses out-of-scope questions instead of narrowing them

**Decision.** A question naming a geography the user cannot read is declined,
naming the geography it cannot show, with no figures in the refusal.

**Rejected: silently substitute the user's own scope.** This was the previous
behaviour. Asked "compare Bauchi and Sokoto", a Bauchi officer would be shown
Bauchi's figures under the heading of a comparison — a different question
answered as though it were the one asked. That is worse than a refusal, because
the user has no way to tell.

**Rejected: drop the unreadable geography and answer the remainder.** Same
problem in a milder form: "compare X and Y" silently becomes "here is X".

**Where it happens.** Before planning, in `answerQuestion()`. Matching is on
STATE and LGA names, whole-word, with the " State" suffix stripped because
nobody writes it. Facility names are excluded: they are constructed from their
LGA and would produce false refusals.

**Known limitation.** A question that describes a geography without naming it
("the other state", "the north-west") is not caught by name matching. It is
still safe — the planner is only shown permitted geographies and every result
row is filtered — but it will be answered about the user's own scope rather than
refused. Recorded in `SOW_GAP_ANALYSIS.md`.

---

## 7. The map descends a level at the programme root

**Decision.** Where the direct children have no boundary features but their own
children do, the map draws the grandchildren, labelled by parent.

**Why.** The root's children are two states; no state-level boundary file ships
with the platform. Drawing the children directly gives a global user two dots
600km apart.

**Not a scope hole.** The caller has already resolved the geography against the
user's scope; everything drawn is a descendant of it. A user who cannot select
the root never triggers the descent.

**Rejected: dissolve the LGA boundaries into state outlines.** It would work,
but it produces a two-shape choropleth that says less than the overview's
comparison table already says, and it adds a geometry step to a build that
currently just reads a file.

---

## 8. Each state gets its own map panel

**Decision.** When the map spans more than one state, each is fitted into its
own panel with a caption and a divider, rather than sharing one projection.

**Why.** Bauchi and Sokoto do not adjoin. One projection across both spends most
of the canvas on the gap, shrinking each state until its labels collide and
overflow the frame — verified visually before the change.

**Cost, stated on the map.** The panels are not to a common scale. The note
under the map says so, because a reader comparing two shapes will otherwise
assume they are.

---

## 9. Demo data plants a real difference between the states

**Decision.** Sokoto's LGAs are seeded at 0.93 of Bauchi's capability, and the
planted declines are split across both states.

**Why.** A comparison feature exercised against noise can pass by luck. With a
planted difference, "which state is performing worse" has one correct answer, and
`tests/data/demo.test.ts` asserts it at the aggregate level.

**Honesty.** This is synthetic and labelled DEMO everywhere it appears. It
reflects nothing about either state's actual performance, and the demo geography
module says so.

---

## 10. Facility names stay constructed; administrative geography is real

**Decision.** Unchanged from the single-state build, restated because the
geography module was rewritten.

Real LGA names and boundaries are used, because a map of invented places cannot
be checked against anything and the deployment target is known. Facility names
are constructed, because naming a real service point and attaching an invented
score to it makes a claim about an identifiable place. Every figure is labelled
DEMO at the data layer, in the API, in the shell, and on every report and export.

---

## 11. The programme root is named for the programme

**Decision.** `ASPIRE-GAC Programme`, not `Bauchi and Sokoto`.

**Why.** The intelligence pipeline matches geographies by name. A root named
after its children answers to a question naming either child, so "how is Bauchi
doing?" resolved to the root and returned the two-state aggregate. Found by a
failing test, not by inspection.

---

## 12. Report types are the intersection of role and scope

**Decision.** `reportTypesFor(user, stateCount)` — the role's list, minus the
types the scope cannot support.

**Why.** The cross-state comparison is the first report whose availability
depends on geography rather than seniority. Adding it to the role lists alone
would have offered a state officer a report that produces nothing; gating it on
role alone would have hidden it from a global executive who should have it.

**Property worth keeping.** Scope can only ever *remove* types. A global
executive gains the comparison and nothing else — holding two states does not
turn an executive into an analyst. Asserted in `tests/api/reports.test.ts`.
