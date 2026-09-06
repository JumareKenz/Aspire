# ASPIRE-GAC SRHR Intelligence & Performance Platform

Turns government DHIS2 SRHR reporting into performance intelligence: scorecards,
data-quality intelligence, forecasting, evidence-grounded recommendations and
automated reports.

Built on **HIVA by Hayok Medicare**, targeting **Gombe State**.

## Getting started

Requires **PostgreSQL**. For local development:

```bash
docker run -d --name aspire-postgres \
  -e POSTGRES_USER=aspire -e POSTGRES_PASSWORD=aspire -e POSTGRES_DB=aspire \
  -p 127.0.0.1:55433:5432 postgres:16-alpine

cp .env.example .env.local     # set DATABASE_URL and ASPIRE_SEED_PASSWORD
npm install
npm run dev
```

Open <http://localhost:3000>. The platform applies its schema and seeds itself
on first request with a clearly-labelled demo dataset.

## Deploying to Vercel

1. Install **Neon** from the Vercel Marketplace (`vercel integration add neon`).
   It provisions the database and sets `DATABASE_URL`.
2. Set `ASPIRE_SESSION_SECRET` (32+ characters) and `ASPIRE_SEED_PASSWORD`.
3. Deploy. The schema is applied and the demo data seeded on the first request;
   an advisory lock ensures only one instance does it.

Accounts created on first seed:

| Account | Tier |
|---|---|
| `executive@aspire.local` | Executive / governance |
| `analyst@aspire.local` | Programme, LGA, M&E and technical |
| `admin@aspire.local` | System administrator |

The password is whatever `ASPIRE_SEED_PASSWORD` was set to when the database was
first seeded.

## Commands

```bash
npm run dev         npm run build       npm start
npm run typecheck   npm run lint        npm test
npm run seed        npm run sync        npm run eval:ai
```

## Connecting to DHIS2

Set `DHIS2_BASE_URL` and a credential in `.env.local` (see `.env.example`), map
each indicator to its DHIS2 identifier in **Admin → Indicators**, then run
`npm run sync`. The demo-data notice disappears on its own once the source is live.

## Documentation

| Document | Covers |
|---|---|
| [`docs/ENGINEERING_GUIDE.md`](docs/ENGINEERING_GUIDE.md) | Conventions and the rules that must hold |
| [`docs/ASPIRE_REPOSITORY_ASSESSMENT.md`](docs/ASPIRE_REPOSITORY_ASSESSMENT.md) | The starting point and why the architecture is what it is |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, stack decisions, performance, failure behaviour |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Users, workspaces, quality bar |
| [`docs/SCORECARD_METHODOLOGY.md`](docs/SCORECARD_METHODOLOGY.md) | The configurable scoring engine and how to publish the official methodology |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Canonical types, schema, confidence, the demo dataset |
| [`docs/DHIS2_INTEGRATION.md`](docs/DHIS2_INTEGRATION.md) | Endpoints, aggregation strategy, mapping |
| [`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md) | The governed pipeline and why the model never produces a number |
| [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) | What is done, the honest caveats, defects found |

## Important

- **All figures shown are synthetic** until the DHIS2 instance is connected, and
  are labelled as such throughout. They sit on real Gombe State geography so the
  map and hierarchy behave as they will against live data.
- **The scorecard methodology is provisional.** The official ASPIRE-GAC
  methodology has not been supplied; every derived figure is badged accordingly.
- **DHIS2 has not been verified against the live server.** The instance was
  unreachable and no credentials were supplied. See
  [`docs/DHIS2_INTEGRATION.md`](docs/DHIS2_INTEGRATION.md).

## Attribution

Boundary geometry: [geoBoundaries](https://www.geoboundaries.org) gbOpen NGA
ADM2 (source: GRID3), CC BY 4.0.
