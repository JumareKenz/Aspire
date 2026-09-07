# Product specification

## What this is

A decision-support platform that turns government DHIS2 SRHR reporting into
intelligence. It moves a user through **monitor → understand → prioritise → act**
without requiring them to understand DHIS2, the database, the scoring engine or
the AI.

The interface answers five questions and treats everything else as secondary:

> What is happening? · Where? · Why? · What needs attention? · What should we do?

## Users — three tiers, not three products

| Tier | Role | Their question |
|---|---|---|
| **Executive / governance** | `EXECUTIVE` | "How are we performing and what requires my attention?" |
| **Programme, LGA, M&E, technical** | `ANALYST` | "Where are the problems, why, and what should we investigate?" |
| **System administrator** | `ADMIN` | Users, connection, configuration, audit |

**LGA, M&E, programme and technical users are one tier.** They share one
workspace. What differs between an LGA officer and a state M&E officer is
*geographic scope*, not the product they see. There are no role-specific
dashboards and no duplicated screens.

**Scope is the second axis, and it is independent of tier.** The platform serves
Bauchi and Sokoto from one application. Any tier can be held programme-wide or
restricted to a state or an LGA: a state commissioner is an `EXECUTIVE` scoped to
their state, not a lesser role. The surfaces that need more than one state — the
cross-state comparison on Overview, the comparison report, the two-panel map —
appear on *scope*, never on seniority. See
[`ROLE_AND_GEOGRAPHIC_ACCESS_MATRIX.md`](ROLE_AND_GEOGRAPHIC_ACCESS_MATRIX.md).

Administration is a separate area, reached from a separate navigation group.

## Navigation — six destinations

`Overview · Performance · Intelligence · Map · Reports · Actions`, plus `Admin`
for administrators. Related capabilities live *inside* a workspace rather than
becoming their own sidebar entry — data quality is inside Intelligence, the
scorecard is inside Performance.

## Overview — the command centre

Reads as an executive briefing, in four movements:

1. **How are we doing?** Overall score, movement, data confidence, reporting
   received, areas needing attention, open findings — and a trend line.
2. **What needs attention?** Automatically identified and ranked by how much it
   should change what the reader does next. Each opens its evidence.
3. **What changed?** Domain contributions to the overall movement, and the area
   ranking.
4. **What we recommend.** Evidence-bearing recommendations, each naming the
   geography, the indicators and the figures behind it.

For a user whose scope holds both states, a fifth movement sits between the
first and second: **how the states compare** — each state's score and
confidence, every domain side by side, where the gap is widest, and where the
two are moving in opposite directions. It leads with the difference rather than
asking the reader to diff two columns. A state-scoped user of any tier does not
see it, because there is nothing for them to compare.

A senior user should understand the state of the programme in about thirty
seconds without scrolling.

## Performance — the analytical workspace

State → LGA → facility → indicator → period, by progressive disclosure:

- Headline score, confidence, coverage, strongest and weakest domain
- Trajectory: this geography against the three areas that moved most
- **Scorecard**: six domain rows; expand one for its indicators; select an
  indicator for its history, contributor breakdown, quality findings and outlook
- **Areas**: ranked, with movement, a sparkline and data confidence per row

The same screen serves an executive reading six rows and an analyst three levels
down.

## Intelligence — the differentiator

Natural-language questions answered through a governed pipeline
(`docs/AI_ARCHITECTURE.md`). Every answer carries the sentence, the evidence
table it was computed from, how each statement was verified, and how the
question was interpreted — because the commonest failure of a natural-language
interface is answering a different question well.

**Data quality** lives here rather than in Admin: the question "is this a service
problem or a reporting problem?" is an analytical question, not an operational one.

## Map

Where the problems are. Colour by performance, change, confidence or findings;
select an area for a compact panel and a route into its scorecard.

Boundaries are pluggable. With none configured the map renders a **schematic
layout** and says so — it never presents invented polygons as administrative
geography.

## Reports

Five reports, generated from stored data with no fabricated narrative: executive
brief, quarterly performance, area performance, data quality, intelligence
summary. Formatted output prints to PDF; tabular data exports as CSV. Both carry
provenance — source, sync time, methodology version, and a demo-data notice when
applicable.

## Actions

Insight → investigate → act → resolve → measure. Five states, one owner, and an
outcome measured against the score at the moment the action was raised.
Deliberately not a project-management system.

## Admin

Connection and synchronisation with history including failures; data freshness;
methodology; users, roles and scope; indicator configuration; audit.

## Quality bar

| | |
|---|---|
| **Simple?** | Overview readable in 30 seconds; six navigation items; progressive disclosure |
| **Useful?** | Every view ends in a decision or a route to one |
| **Trustworthy?** | Every figure traceable to evidence; provenance on every report; demo data unmissable |
| **Insightful?** | Insights, attribution and recommendations computed, not asserted |
| **Beautiful?** | Restrained, validated palette, deliberate typography, purposeful motion |
| **Fast?** | Server aggregation, one query per view, on-demand drill-down |
| **Robust?** | Failure behaviour table in `docs/ARCHITECTURE.md` |
| **Maintainable?** | Pure engines, one seam to the outside, 172 tests |
| **Extensible?** | Indicators and methodology are configuration; sources are an interface |
| **Safe?** | Capability + scope enforced in the service layer; credentials server-only; audited |
