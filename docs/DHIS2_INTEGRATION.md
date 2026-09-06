# DHIS2 integration

## Status

The platform ships a complete DHIS2 client and adapter written against the
official Web API. **No DHIS2 instance or credentials were supplied**, so the
integration is unit-tested against mocked responses rather than verified against
a live server. The endpoints, parameters and response shapes follow the
documented API; the first connection to a real instance should still be treated
as a commissioning step.

## Configuration

```bash
DHIS2_BASE_URL=https://dhis2.example.org   # no trailing slash
DHIS2_TOKEN=…                              # preferred
# or
DHIS2_USERNAME=…
DHIS2_PASSWORD=…
DHIS2_TIMEOUT_MS=30000
```

Credentials are read on the server only. They are never sent to the browser,
never included in an API response, and never written to the audit log. The
Admin console reports whether a connection succeeded and the server's version —
nothing else.

Setting `DHIS2_BASE_URL` plus a credential switches the source automatically.
There is no mode in which the platform shows demo figures while claiming a live
connection.

## Endpoints used

| Endpoint | Purpose |
|---|---|
| `GET /api/system/info` | Connection test; returns the server version |
| `GET /api/organisationUnits` | Hierarchy: `id,code,displayName,level,parent[id],path,geometry`, unpaged |
| `GET /api/dataSets` | `id,displayName,periodType,timelyDays` — drives reporting expectations |
| `GET /api/indicators` | Metadata for mapping the registry |
| `GET /api/analytics` | **Aggregated values.** The main data path |
| `GET /api/completeDataSetRegistrations` | Completeness and timeliness |

## Analytics: aggregate at the source

The adapter issues **one request per org level**, using DHIS2's own dimensional
aggregation:

```
GET /api/analytics
  ?dimension=dx:<uid>;<uid>;…
  &dimension=pe:2026Q1;2026Q2;…
  &dimension=ou:<root>;LEVEL-3
  &includeNumDen=true
  &skipRounding=true
```

`LEVEL-n` asks DHIS2 to return every org unit at that level beneath the roots,
so LGA and facility figures arrive without enumerating identifiers. A 14-LGA,
120-facility, 12-period, 15-indicator synchronisation is a handful of requests,
not thousands — and no raw data values are downloaded to be summed here.

`includeNumDen=true` returns numerators and denominators, which the consistency
detector needs. `skipRounding=true` keeps the platform's own rounding as the
single rounding step.

## Mapping the registry

Each indicator carries a `source.dx` — the DHIS2 indicator or data-element UID.
**These are `null` in the shipped registry**, because no DHIS2 metadata was
available and inventing UIDs would produce a system that queries nothing while
appearing to work.

Set them in **Admin → Indicators**, or in `src/config/indicators.ts` before the
first seed.

Behaviour when mappings are missing:

- **No indicator mapped:** synchronisation *fails* with a specific message. It
  does not import zero rows and report success.
- **Some indicators mapped:** the mapped ones import; the rest are skipped, and
  Admin shows a banner naming how many are unmapped. Their scores are absent
  rather than wrong.

## Org-unit levels

DHIS2 numeric levels map onto the canonical hierarchy:

| DHIS2 level | Canonical |
|---|---|
| 1 | `COUNTRY` |
| 2 | `STATE` |
| 3 | `LGA` |
| 4 | `FACILITY` |

Levels below 4 are ignored. `path` is retained as a materialised ancestor list,
which is what makes geographic scope checks a single containment test rather
than a recursive walk. Point geometry becomes a centroid; polygon geometry is
not consumed here — real boundaries are supplied separately via
`ASPIRE_BOUNDARIES_PATH` (see `docs/ARCHITECTURE.md`).

## Reporting completeness

DHIS2 records the registrations that *happened*. Completeness is about the ones
that did not, so the adapter builds the full expectation grid — every reporting
unit × dataset × period — and marks a cell reported only where a registration
exists. `timelyDays` on the dataset sets the due date; the submission date
determines lateness.

## Empty cells are absent, not zero

`Number('')` is `0` in JavaScript, so a naive parse would turn an empty analytics
cell into a reported zero — and a zero is *scored*, whereas a missing value is
*excluded* by the methodology. The adapter treats empty and whitespace cells as
absent before any conversion. This was found by a unit test during the build and
is regression-covered in `tests/data/dhis2.test.ts`.

## Synchronisation

```bash
npm run sync          # or Admin → Synchronise now
```

Each run: fetch org units → fetch datasets → fetch analytics per level → fetch
completeness → write canonically → re-run the data-quality scan → record the run.

Runs are recorded in `sync_runs` with counts and, on failure, the reason. The
store keeps the last good data when a run fails, so a DHIS2 outage degrades
freshness rather than taking the platform down.

Triage decisions on data-quality findings survive a re-scan — acknowledging a
known issue is not undone by the next synchronisation.
