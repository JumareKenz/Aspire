# NHMIS governance, targets, monthly reporting and the overview map

Reference for the October 2026 enhancement. Code is the authority; this says
where to look and why it is shaped the way it is.

## 1. NHMIS provenance

**Rule.** An indicator enters reporting only if every operand it is computed
from is a data element on an approved NHMIS form, as DHIS2's own data set
metadata records it — or is covered by an explicit, documented exception.
Names are never used ("NHMIS …", "adolescent …" prove nothing).

| Piece | Where |
|---|---|
| Approved forms: NHMIS 2019 (`O82o1WlMisO`) and NHMIS 2013 (`lyVV9bPLlVy`, approved 2026-10-14); the 2025 form is not approved | `src/config/nhmis.ts` |
| Exceptions (empty) | `NHMIS_PROVENANCE_EXCEPTIONS` in the same file |
| Expression parser and classifier (pure) | `src/core/registry/provenance.ts` |
| Verification at sync | `src/data/sync/governance.ts`, called first in `runSync` |
| Enforcement | `listReportingIndicators()` in `src/data/repositories/registry.ts` |

At every sync the adapter reads the approved forms' `dataSetElements` and the
numerator/denominator of every DHIS2 indicator the registry maps. Each
indicator becomes `VERIFIED`, `APPROVED_EXCEPTION`, `UNVERIFIED` or `UNMAPPED`
(demo data: `DEMO`). Operands accepted: data elements (or one option of one)
on an approved form, reporting rates of an approved form, `[days]`. Everything
else — constants, population estimates not on the form, org unit group counts,
tracker data, nested indicators, anything unparseable — blocks the indicator.

Only reportable indicators are fetched from DHIS2. `listReportingIndicators()`
is what scorecards, the indicator panel, the map, reports, AI answers, target
setting, reconciliation and the validation scorecard read, so an unverified
indicator is unreachable by id as well as absent from screens. Nothing is
deleted: its registry entry and any older observations stay, unused, and
Admin → Indicators shows the operand that blocked it.

**Deploying:** until the first sync after deployment no indicator is verified
against DHIS2, so pages report nothing. Run a sync (Admin → System, or wait for
the 03:00 cron) immediately after deploying.

**Result on staging (dry run, 2026-10-14):** 18 indicators verified; mCPR
excluded because its denominator is census Total Population × 0.22
(`JiqRpGPcjXz`, Population Estimates); three have no source mapped. The national
instance's definitions of ANC timing, skilled birth attendance, PNC and HIV
testing in ANC combine 2013- and 2019-form elements, which is why the 2013 form
is approved; its elements hold well under 1% of values from 2025. Approving the
population denominator for mCPR is an open programme decision.

**Sync safety.** Provenance is saved straight after verification, before the
analytics requests, so a later failure leaves the stored figures of verified
indicators reportable. A sync that imports no values is recorded as failed
(DHIS2 sometimes answers with an empty table). Gateway errors (502/503/504) are
retried once. Each run's message lists per-phase timings; on the Hobby plan the
whole sync must finish within 300 s (about 210 s on staging with
`DHIS2_TIMEOUT_MS=120000`). If it approaches the limit, lower
`ASPIRE_MONTHLY_HISTORY`.

## 2. Data elements

`nhmis_data_elements` holds the approved forms' elements (refreshed each sync;
removed ones are marked inactive, not deleted). `data_element_config` holds the
platform's own choices (domain, inclusion), never overwritten by a sync.
`data_element_values` holds values for the elements used by reportable
indicators (and any an administrator adds), at state and LGA level, fetched from
DHIS2 analytics per period. The federal tier is the sum of the states only for
`SUM` elements; other aggregation types are left absent there.

A data element is evidence, not performance: it has no target, no score, and is
never added to a domain or overall figure.

Ordering (Admin and Overview): `PRIORITY_DOMAIN_IDS` (`adolescent-srhr`) first,
then domains alphabetically, then "Not assigned"; elements alphabetical within a
domain; each element once, under an administrator's domain if set, otherwise the
highest-priority domain among the indicators it feeds.

## 3. Monthly and quarterly

Quarters: 12, as before. Months: the 12 months ending with the latest complete
quarter (`ASPIRE_MONTHLY_HISTORY`, 0–36; 0 turns monthly sync off). Months are
requested from DHIS2 as months, so DHIS2 applies each element's own aggregation
type. Nothing monthly is derived from a quarter, and nothing quarterly from
months. Category breakdowns and data-quality findings remain quarterly.

The Monthly/Quarterly switch appears on Overview, Performance, Map and Reports
once a sync has stored months. Intelligence and Data quality stay quarterly; a
month in their URL opens the quarter containing it.

## 4. Targets

Rows in `targets` name an indicator, optionally an area, and a period: one
period ("2025Q4", "202512"), a period type ("QUARTERLY", "MONTHLY"), or every
period. `resolveTarget` (`src/core/targets/resolve.ts`) picks the most specific.

* **Counts are per area.** A count target is applied only to the area it was
  set for. The previous behaviour applied the programme default (e.g. 1,200 new
  FP acceptors) identically to the federal tier, each state, each LGA and each
  facility.
* **Counts are per period type.** A quarterly count target is not applied to
  months and is never divided by three. An untyped count target belongs to the
  indicator's reporting frequency.
* Rates and percentages: defaults apply everywhere.
* Area targets are not inherited by child areas, and parent targets are not
  divided among children — no allocation rule has been defined.
* No target → value shown, achievement and score left empty, "No target set".

Admin → Indicators → (indicator) → Targets: requires `admin.manage`; an
administrator can set targets only inside their own scope; programme-wide
targets need programme-wide scope; values are validated (≤100 for
percentages, whole numbers for counts, no zero target where a ratio needs one).
Every change is audited with the value it replaced. A period target leaves
other periods untouched; the form warns that changing the programme default
re-scores every period without its own target.

## 5. Overview map

`getOverviewMap` (`src/services/geography.ts`) draws the LGAs under the user's
**scope root**, with one projection; the selection only moves the camera
(animated `viewBox`, 650 ms, instant under `prefers-reduced-motion`). A
state-scoped user's map contains no other state's geometry, names or figures.

Colour: the overall score's status band from the active methodology, from the
same scorecards as the cards. No publishable score is hatched and labelled
"No publishable score" — never shown as low performance.

The selection is the `orgUnit` URL parameter, shared with the hierarchical
selector, so the map and selector cannot disagree or loop. The map is optional:
without boundaries the page works through the selector.

Boundaries: `public/geo/lgas.geojson`, geoBoundaries gbOpen NGA ADM2 (GRID3),
CC BY 4.0, matched to DHIS2 units by id or normalised name. No state boundary
file is needed: a state's outline is drawn from its LGAs.

## 6. Organisation unit selector

`OrgUnitSelector` replaces the flat list: a tree from the top of the user's
access, expandable, with wards and facilities loaded on demand from
`/api/orgunits`, search with each result's path, a level filter, breadcrumb,
and keyboard support (arrows, Home/End, Enter, Escape). The API applies scope
and depth on the server; an executive's tree stops at LGA.
