# Deployment & Operations

Terranoetis runs in a Docker Compose stack with three services, or directly with Node.js for development. This document covers setup, configuration, production deployment, and CI/CD.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Development)](#quick-start-development)
- [Docker Deployment](#docker-deployment)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [CI/CD Pipeline](#cicd-pipeline)
- [Security](#security)

---

## Prerequisites

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | ≥ 20 | Runtime (matches CI and Docker image) |
| npm | ≥ 10 | Package management |
| Redis | 7.x | Caching, session, pub/sub (optional — graceful fallback to SQLite) |
| Docker & Compose | Latest | Containerized deployment |
| Cesium Ion token | — | Photorealistic 3D Tiles (set `VITE_CESIUM_ION_ACCESS_TOKEN`) |

---

## Quick Start (Development)

```bash
# Clone and install
git clone https://github.com/sreyassanker/Terranoetis.git
cd Terranoetis
cp .env.example .env    # Fill in API keys as needed
npm install

# Start development servers
npm run dev

# In a separate terminal:
npm run dev:client      # Vite dev server (port 3000) only
npm run dev:server      # Express API (port 3001) only
```

The `dev` command starts the Vite dev server and the Express API concurrently. Redis is started automatically if installed; otherwise the server falls back to SQLite.

### Verification

```bash
# Frontend
open http://localhost:3000

# API health
curl http://localhost:3001/api/health
```

---

## Docker Deployment

### Services

| Service | Image | Port | Purpose |
|---|---|---|---|
| `terranoetis` | Custom (Dockerfile) | 3001 | Express API + built frontend (single origin) |
| `redis` | `redis:7-alpine` | 6379 | Cache, session, pub/sub |
| `causal-service` | Custom (Python) | 5001 | Causal inference microservice (DoWhy) |

> In production (`NODE_ENV=production`), the Express app serves the built frontend from `dist/` on the same origin as the API — open `http://localhost:3001` for the full application. In development, Vite serves the client on :3000 and proxies `/api` to :3001.

### Production Start

```bash
# Copy environment (edit with your production values)
cp .env.example .env

# Build and start all services
docker compose up -d

# Verify
curl http://localhost:3001/api/health   # API
open http://localhost:3001              # Frontend (served by the same container)

# View logs
docker compose logs -f terranoetis
```

### Build

```bash
docker compose build    # Rebuild images
docker compose up -d    # Restart with rebuilt images
```

### Data Persistence

| Volume | Mount | Contents |
|---|---|---|
| `terranoetis-data` | `/app/data` | SQLite databases, runtime state |
| `redis-data` | `/data` | Redis persistence |
| `.env` mount | `/app/.env:ro` | Environment configuration (read-only) |

---

## Configuration

### Ports

| Variable | Default | Description |
|---|---|---|
| `PROXY_PORT` | `3001` | Express API port (empty = fall through to `PORT`, else 3001) |
| `PORT` | `3001` | Standard runtime port (used when `PROXY_PORT` is unset; set by Dockerfile/compose) |
| Vite port | `3000` | Frontend dev server (hardcoded in `vite.config.ts`) |

### NODE_ENV Behavior

| Mode | Dev (`development`) | Production (`production`) |
|---|---|---|
| JWT_SECRET | Auto-generated weak secret | Required, ≥ 32 chars |
| ADMIN_BOOTSTRAP_PASSWORD | Auto-generated | Required, ≥ 16 chars |
| Dev auto-login | Enabled | Disabled (returns 404) |
| CSP / HSTS | Relaxed | Strict |
| Startup validation | Warning | Hard error |

---

## Environment Variables

The `.env` file configures 100+ variables covering 70+ integrated services (see `.env.example`). Missing keys disable the corresponding feature — services degrade gracefully.

### Required (production)

| Variable | Notes |
|---|---|
| `JWT_SECRET` | ≥ 32 characters |
| `ADMIN_BOOTSTRAP_PASSWORD` | ≥ 16 characters, used to provision the initial admin account |
| `VITE_CESIUM_ION_ACCESS_TOKEN` | For Google Photorealistic 3D Tiles |

### Category Reference

| Category | Variables |
|---|---|
| Server | `PROXY_PORT`, `CLIENT_ORIGIN`, `NODE_ENV` |
| Local AI Model | `GGUF_DOWNLOAD_URL` (override HuggingFace download source), `LLAMA_SERVER_PATH` (path to `llama-server` binary) |
| NASA Earthdata | `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD`, `EARTHDATA_EDL_TOKEN`, `USGS_ERS_*` |
| Satellite & Imagery | `VITE_CESIUM_ION_ACCESS_TOKEN`, Sentinel Hub, Copernicus, NASA FIRMS, Planet Labs, Maxar |
| Aviation | FlightAware, AirLabs |
| Maritime | AISStream, MarineTraffic |
| Traffic | TOMTOM_API_KEY |
| Realtime Voice | `OPENAI_API_KEY` (primary), `GOOGLE_GEMINI_API_KEY` (Live fallback) |
| AI/LLM | Google Gemini, Anthropic Claude, Groq, OpenRouter, DeepSeek, Bai, Ollama |
| Error Tracking | `SENTRY_DSN` (optional, unset = no-op) |
| Weather & Disaster | USGS, NASA EONET, GDACS, NOAA, OpenAQ, WAQI, Windy |
| Economic & Financial | FRED, EIA, Alpha Vantage, ENTSO-E, UN Comtrade, IMF, GoldAPI |
| Search & Scraping | Brave Search, Exa, Firecrawl, Guardian, NewsAPI |
| Kaggle simulation kernels | Kaggle API token at `~/.kaggle/kaggle.json` (see below), `KAGGLE_BIN`, `KAGGLE_POLL_INTERVAL_MS`, `KAGGLE_POST_PUSH_SETTLE_MS`, `KAGGLE_STALE_ERROR_GRACE_MS`. Optional — the 3 local CPU scenarios need none of it. |
| Other | Telegram, Resend, ACLED, Cloudflare Radar, AbuseIPDB, AlienVault OTX, Gmail SMTP |

### Kaggle simulation kernels (optional setup)

Four physics simulations (tsunami, volcano, landslide, flood) are dispatched to **Kaggle kernels** as their execution venue. All kernels are NumPy CPU code (no GPU imports); only flood-sim requests Kaggle's GPU accelerator in its kernel metadata, so “GPU kernels” is a hosting term here, not a compute claim (verified 2026-09-08 — see [modes table](capabilities/hazard-simulations.html#modes)). The three 2D scenarios — earthquake, wildfire, and hurricane — finish in seconds on a laptop CPU and run **locally via `python3`** (see `server/kaggle/simRunner.ts`; measured end-to-end job completion of 166 ms for the earthquake kernel), so they work without any token. To enable the Kaggle-routed kernels:

1. Create a token at **https://www.kaggle.com/settings/account** → *Create New Token* (requires an account with phone verification).
2. Save the downloaded `kaggle.json` as **`~/.kaggle/kaggle.json`** and restrict permissions:
   ```bash
   mkdir -p ~/.kaggle && mv ~/Downloads/kaggle.json ~/.kaggle/kaggle.json && chmod 600 ~/.kaggle/kaggle.json
   ```
3. Install the Kaggle CLI (`pip install kaggle`), or point `KAGGLE_BIN` at its path.

The simulation runner reads credentials exclusively from `~/.kaggle` (`KAGGLE_CONFIG_DIR`, see `server/kaggle/simRunner.ts`) — **never from the repository**, so no secrets are ever committed. Without a token, the 4 Kaggle-routed simulations disable gracefully while the 3 local CPU scenarios (earthquake, wildfire, hurricane) and the analytical engine keep working.

---

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs the following on every push and pull request:

| Job | Description |
|---|---|
| TypeScript Check | `tsc --noEmit` for frontend + server |
| Lint | `eslint .` |
| Unit Tests | Vitest in `server/__tests__/unit` + `src/__tests__` |
| Integration Tests | Vitest in `server/__tests__/integration` |
| Coverage | Vitest with `--coverage` |
| Build | `npm run build` (tsc -b + vite build) |
| Docker Build | Docker build verification |
| Security Audit | `npm audit` |
| Docs Gate (docs.yml) | `node scripts/docs/build.mjs --check` (build drift) + `node scripts/docs/quality-gate.mjs` (links, anchors, page metadata, file:line citations, marketing-vocabulary ban) |
| Browser Tests | Playwright — headless Chromium with software WebGL (SwiftShader) |
| Summary | Aggregates job results into a single CI status comment |

### CI Notes

- **Node version:** 20 (specified in workflow and `.nvmrc`; the 2026-09-08 verification pass ran Node 26 with 1,653 unit + 49 integration tests passing)
- **Docs quality gate:** `.github/workflows/docs.yml` runs on every push/PR touching `docs/**` or `scripts/docs/**`
- **Browser tests** run headless in CI on `ubuntu-latest` using Chromium with software WebGL (`--use-gl=angle --enable-unsafe-swiftshader`), so no physical display/GPU is required. They are still the most environment-sensitive job and can be flaky.
- **Redis** is optional in both development and CI (the server falls back to SQLite gracefully)
- **Docker Compose** is recommended for production

---

## Security

| Control | Implementation |
|---|---|
| Authentication | JWT bearer tokens |
| Password hashing | scrypt (RFC 7914, N=16384, r=8, p=1) |
| Authorization | Role-based access control (RBAC) |
| Rate limiting | Per-IP + per-user (middleware/rateLimiter.ts) |
| Input validation | Zod schemas |
| SSRF protection | `utils/ssrfGuard.ts` |
| Security headers | CSP, HSTS, X-Frame-Options |
| Prod mode only | Dev auto-login, auto-generated passwords disabled in NODE_ENV=production |

### Best Practices

- Always set a strong JWT_SECRET and ADMIN_BOOTSTRAP_PASSWORD in production
- Keep the .env file out of version control (gitignored)
- Periodically rotate API keys
- Seal the Docker network if deploying in a multi-tenant environment