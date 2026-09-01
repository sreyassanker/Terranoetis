<p align="center">
  <img src="Terranoetis.png" alt="Terranoetis" width="120" />
</p>

# Terranoetis

A real-time geospatial intelligence platform. Combines a photorealistic Cesium 3D globe with a comprehensive backend serving live environmental data, satellite imagery, **150 real scientific equation engines**, physics simulations, realtime voice, and AI-driven cognition. Unlike a passive globe viewer, Terranoetis **computes** — it runs peer-reviewed equations over live data, reasons about what it sees, and paints real results back onto the Earth.

<div align="center">

[![Website](https://img.shields.io/badge/Portfolio-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://sreyassanker.vercel.app)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sreyassanker)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/sreyassanker)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/sreyassanker)

</div>

---

## Highlights

- **150 peer-reviewed analytical models** across 26 domains — every equation paper-grounded and DOI-indexed ([details](docs/MODELS.md))
- **Photorealistic CesiumJS 3D globe** with 40 rendering modules, satellite imagery, and sensor styles
- **7 GPU physics simulations** — earthquake, tsunami, volcano, landslide, flood, hurricane, wildfire
- **AI cognition** — System 1 / System 2 reasoning, multi-agent debate, causal + counterfactual analysis
- **30+ live data feeds** — seismic, weather, aviation, maritime, satellite, traffic, space
- **Realtime voice** — OpenAI Realtime → Gemini Live (server-side brokering)
- **Explainable AI** — evidence chains, uncertainty quantification, human-override workflow

---

## Quick Start

```bash
git clone https://github.com/sreyassanker/Terranoetis.git
cd Terranoetis
cp .env.example .env    # Fill in API keys as needed
npm install
npm run dev             # Vite (3000) + Express API (3001); Redis optional
```

> Redis is optional — the server falls back to SQLite automatically if Redis is unavailable. See [Deployment](docs/DEPLOYMENT.md) for the full Docker + production setup.

---

## Documentation

| Document | Covers |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System topology, request flow, background services, module inventory |
| [API Reference](docs/API.md) | 294 REST endpoints + WebSocket channel |
| [Frontend](docs/FRONTEND.md) | React components, rendering engine, Kaggle GPU overlays, hooks |
| [Backend](docs/BACKEND.md) | Server modules, cognition, memory, security, observability |
| [Analytical Models](docs/MODELS.md) | The 150 equation engines, 7 parts, 26 domains |
| [Deployment](docs/DEPLOYMENT.md) | Docker, environment variables, CI/CD, security |

---

## Repository Structure

```
src/           React 19 + CesiumJS client
server/        Express 4 + TypeScript API, cognition, analytics
kaggle-kernels/  7 self-contained Python physics simulations
data/          Runtime databases and ML models
docs/          Architecture, API, frontend, backend, models, deployment
e2e/           Playwright browser tests
scripts/       Development and probe scripts
```

---

## Development Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Concurrent: server + client (+ Redis if available) |
| `npm run dev:client` | Vite dev server on :3000 |
| `npm run dev:server` | Express API on :3001 |
| `npm run build` | `tsc -b && vite build` |
| `npm test` | Vitest — 1,624 unit + integration tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration + e2e tests |
| `npm run test:coverage` | Coverage report |

---

## Testing

```bash
npm test              # Vitest — 1,624 unit + integration tests
npx playwright test   # Playwright (local, requires display/GPU — skipped in CI)
```

---

## License

Released under the [MIT License](LICENSE).

Copyright (c) 2026 Terranoetis.
