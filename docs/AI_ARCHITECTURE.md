# Intelligence architecture

## The rule

**The language model never produces a number.**

It may choose a query shape from a fixed schema, and it may phrase findings the
platform has already computed and verified. It has no database access, performs
no arithmetic, and cannot name an indicator or geography that does not exist.

With no model configured the platform still answers every question. Correctness
does not depend on the model; only phrasing does.

## The pipeline

```
   question
      │
      ▼
┌─────────────────┐  rules first, always. Deterministic, testable, no credentials.
│ INTENT (rules)  │  Matches query kind, indicator, domain, geography, period.
└────────┬────────┘
         │  confidence < 0.85 and a model is enabled?
         ▼
┌─────────────────┐  The model sees only the REGISTRY — the names of real
│ PLANNER (model) │  indicators, domains and permitted geographies. Never a
│   optional      │  data value. Constrained by a Zod schema. Any identifier
└────────┬────────┘  it returns that is not real is DISCARDED, not corrected.
         │
         ▼
┌─────────────────┐  AnalyticalQuery: kind, orgUnitId, periodId, indicatorId,
│ STRUCTURED      │  domainId, compareOrgUnitIds, limit, direction.
│ QUERY           │  Re-scoped to the asking user before execution.
└────────┬────────┘
         │
         ▼
┌─────────────────┐  The PLATFORM executes this, using the same engines that
│ EXECUTE         │  render the scorecards. This is the only place a figure is
│ (authoritative) │  produced.
└────────┬────────┘
         │
         ▼
┌─────────────────┐  Row limits respected · ranks distinct and ordered ·
│ VALIDATE        │  scores within 0–100 · every figure quoted in a finding
│                 │  appears in that finding's own evidence.
└────────┬────────┘  An ERROR withholds the answer. A WARNING annotates it.
         │
         ▼
┌─────────────────┐  Deterministic template ALWAYS runs first, so there is
│ EXPLAIN         │  something correct to fall back to.
└────────┬────────┘
         │  model enabled?
         ▼
┌─────────────────┐  Receives ONLY the verified findings and their evidence.
│ NARRATE (model) │  Instructed: introduce no number, place, indicator or claim
│   optional      │  that is not in the findings; never speculate on cause;
└────────┬────────┘  90 words maximum. Any failure → template.
         │
         ▼
   answer + evidence table + how each statement was verified
```

## Why the rules come first

The rule-based planner is the primary path, not a degraded fallback:

- It is deterministic, so the evaluation set means something.
- It cannot hallucinate an identifier — it selects from the registry.
- It needs no credentials and costs nothing.
- It is faster than a model round trip.

The model is consulted only when the rules are genuinely uncertain
(confidence < 0.85), and its output is filtered against the real registry before
anything is executed.

## Query kinds

| Kind | Question it answers |
|---|---|
| `RANK_UNITS` | Which areas are strongest or weakest? |
| `BELOW_TARGET` | Which areas are below the on-track threshold? |
| `MOST_IMPROVED` | Which areas improved most? |
| `EXPLAIN_CHANGE` | What is driving the change, and by how much? |
| `INDICATOR_TREND` | How is one indicator doing, and where is it moving? |
| `COMPARE_UNITS` | How do these areas compare, domain by domain? |
| `DATA_QUALITY` | What reporting problems are open? |
| `RISK_OUTLOOK` | Which areas carry the most risk? |
| `SUMMARY` | How are we doing overall? |

Adding one means: a `QueryKind`, a rule in `KIND_RULES`, an executor branch, and
at least one case in the evaluation set.

## Attribution is arithmetic, not assertion

"Which indicators are driving the decline?" is answered by decomposition, not by
asking a model to speculate:

```
contribution = component's own change × its weight in the methodology
share        = |contribution| / Σ|contributions|
```

So "Adolescent SRHR accounts for 70% of the overall change" is a computed
statement with the domain's movement, its weight and its contribution shown as
evidence beside it.

## Evaluation

`npm run eval:ai` runs `src/intelligence/evals/cases.ts` — questions with
**known-correct answers**, derived from signals deliberately planted in the demo
dataset (see `docs/DATA_MODEL.md`).

The harness checks the *analytical result*, not the prose: the query kind, the
resolved indicator, the top row, required rows, headline content and row counts.
Wording may vary; the answer may not.

All 11 cases pass, and the suite also runs inside `npm test`. Two real defects
were caught by it during the build — a rank-ordering assumption that broke
"most improved", and a finding that quoted a change figure absent from its own
evidence.

The set includes a negative case: *"What is the malaria positivity rate?"*
Malaria is not in the SRHR registry, and the platform must not invent it.

## What the model is allowed to see

| | Sees |
|---|---|
| Planner | Names and ids of real indicators, domains and permitted geographies. The question. **No data values.** |
| Narrator | Verified findings and their evidence. **No raw observations, no database access.** |

Both are gated on `ASPIRE_AI_ENABLED=true` *and* a credential. The switch exists
because sending DHIS2-derived material to an external service is an operator's
decision, not something that should switch itself on because a key is present.

## Refusals

The platform declines rather than guessing:

- No comparable previous period → change cannot be attributed.
- Fewer than six observed periods → "Insufficient historical data for a reliable
  prediction", with the counts.
- Coverage below the methodology minimum → no score published.
- Unrecognised indicator → not resolved, never substituted.
- Validation error → answer withheld and logged.
