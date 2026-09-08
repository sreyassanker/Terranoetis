# Contributing to Terranoetis

## Development Setup

### Prerequisites

- Node.js 20+
- Redis 7+ (optional for dev — falls back to in-memory cache)
- A `.env` file with your API keys (copy from `.env.example`)

### Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys (see .env.example for documentation)

# Start all services (client + server + Redis)
npm run dev
```

The client runs on `http://localhost:3000` and the server on `http://localhost:3001`.

### Running Tests

```bash
# Unit + integration tests
npm test              # vitest — 1624+ tests

# TypeScript type checking
npx tsc -p tsconfig.server.json --noEmit
npx tsc -p tsconfig.app.json --noEmit

# Lint
npm run lint          # eslint — 0 errors required

# E2E browser tests
npx playwright test   # 7 spec files, headless Chromium

# Build
npm run build         # tsc + vite build
```

## Code Style

- **TypeScript** — strict mode enabled. No `any` unless explicitly justified.
- **Imports** — prefer `import type` for type-only imports. Use path aliases (`@/` for `src/`, direct paths for `server/`).
- **No fabricated data** — every API response must be computed from real data or honestly labeled. No mocks, stubs, or hardcoded values in production code.
- **Error handling** — never throw from analytical equations. Return `NaN` with a clear warning. Use `AppError` subclasses for HTTP errors.
- **Naming** — `camelCase` for variables and functions, `PascalCase` for types and components, `UPPER_SNAKE` for constants.

## Adding a New Analytical Model

1. Add the equation function to the appropriate `server/analytical-models/equationParts/PART{n}.ts` file (or create a new part if adding a new domain).
2. The function receives typed inputs `Record<string, number>` and must return `{ result: number, unit: string, steps: string[] }`.
3. Add the ID to the `EQUATION_ENGINE` object (it's composed from the parts automatically).
4. Register the model's metadata in `src/data/analyticalModels.ts` (name, equation, description, reference, etc.).
5. Add the search keyword mapping in `server/index.ts` (`tryAnalyticalModelRunInner`'s `MODEL_KEYWORDS` array).
6. Wire the model's inputs in `server/analytical-models/contextEngine.ts` (`mapInputs` switch-case).
7. Add a unit test in `server/__tests__/unit/` and an E2E test in `e2e/`.

## Adding a New Data Layer

1. Add the fetch function in `server/data/dataFetchers.ts`.
2. Add the route in `server/index.ts` and register it in the public/authenticated bypass list if needed.
3. Add the API metadata in `server/apiMetadata.ts`.
4. Add the endpoint to the OpenAPI spec in `server/routes/openapi.ts`.
5. Add the layer to the catalog in `src/lib/layerConfig.ts`.
6. Verify the route returns real data: `curl http://localhost:3001/api/your-endpoint`.

## Documentation

Docs prose lives in Markdown (`README.md`, `docs/*.md`, `docs/capabilities/*.md`); the Pages site under `docs/` is generated from `scripts/docs/` page specs — edit the spec, run `node scripts/docs/build.mjs`, and keep `node scripts/docs/quality-gate.mjs` green. Every factual claim needs a `file:line` citation; executed evidence is labelled MEASURED, code-read evidence is labelled inspection-only. The writing rules are at [docs/governance/style-guide.html](docs/governance/style-guide.html).

## Pull Request Process

1. Run the full test suite before submitting: `npm test && npx playwright test && npm run build`.
2. Ensure eslint is clean: `npm run lint`.
3. No `.env` files in commits — they are gitignored.
4. No third-party API keys in source code.
5. Every new feature must have a corresponding E2E test.
6. All analytical model outputs must be computed from real data — no fabricated results.

## Architecture

See `README.md` for the full architecture diagram and request flow.

## License & Contributions

Terranoetis is licensed under the **Business Source License 1.1 (BUSL-1.1)** (see `LICENSE`). Each version converts to the MIT License four years after publication.

By submitting a contribution (pull request, patch, or code), you agree that:

1. Your contribution is licensed to the project under the same BUSL-1.1 terms.
2. The maintainer may relicense and use your contribution for any purpose, **including commercial licensing** of the project (e.g. offering it under a paid commercial license). This is required so the project can stay sustainable.
3. You confirm you have the right to grant these permissions and that your contribution is original or properly attributed.

Third-party components you reference (models, data sources, libraries) must keep their own licenses — do not relicense someone else's work as ours.