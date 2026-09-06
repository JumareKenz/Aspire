# ASPIRE-GAC SRHR Intelligence & Performance Platform

Turns government DHIS2 SRHR reporting into performance intelligence: scorecards,
data-quality intelligence, forecasting, evidence-grounded recommendations and
automated reports.

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The platform seeds itself on first request with a
clearly-labelled demo dataset — no configuration is required to see it working.

Development accounts (password `aspire-demo` unless `ASPIRE_SEED_PASSWORD` is set):

| Account | Tier |
|---|---|
| `executive@aspire.local` | Executive / governance |
| `analyst@aspire.local` | Programme, LGA, M&E and technical |
| `admin@aspire.local` | System administrator |

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
| [`CLAUDE.md`](CLAUDE.md) | Conventions and the rules that must hold |
| [`docs/ASPIRE_REPOSITORY_ASSESSMENT.md`](docs/ASPIRE_REPOSITORY_ASSESSMENT.md) | The starting point and why the architecture is what it is |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, stack decisions, performance, failure behaviour |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Users, workspaces, quality bar |
| [`docs/SCORECARD_METHODOLOGY.md`](docs/SCORECARD_METHODOLOGY.md) | The configurable scoring engine and how to publish the official methodology |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Canonical types, schema, confidence, the demo dataset |
| [`docs/DHIS2_INTEGRATION.md`](docs/DHIS2_INTEGRATION.md) | Endpoints, aggregation strategy, mapping |
| [`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md) | The governed pipeline and why the model never produces a number |
| [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) | What is done, the honest caveats, defects found |

## Important

- **All figures shown are synthetic** until a DHIS2 instance is connected, and
  are labelled as such throughout.
- **The scorecard methodology is provisional.** The official ASPIRE-GAC
  methodology has not been supplied; every derived figure is badged accordingly.
