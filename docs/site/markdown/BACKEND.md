# Backend

The Terranoetis backend is a **Node.js + Express 4** API server (TypeScript via `tsx`), exposing **360+ REST endpoints** (398 handler registrations counted 2026-09-09 across app/router verbs) and a WebSocket channel.

> Site view with per-module citations: [Platform services](../capabilities/platform-services.html) · [Live data & monitoring](../capabilities/live-data-and-monitoring.html) · [AI cognition](../capabilities/ai-cognition.html). It coordinates live data ingestion, the 150-equation analytical engine, AI cognition, realtime services, and persistent state.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Top-Level Modules](#top-level-modules)
- [Module Directories](#module-directories)
- [Database](#database)
- [Security](#security)
- [Observability](#observability)

---

## Tech Stack

| Concern | Technology |
|---|---|
| Runtime | Node.js, Express 4, TypeScript via `tsx` |
| Database | SQLite (`better-sqlite3`), Redis (`ioredis`) |
| Realtime | WebSocket (`ws`), SSE |
| Auth | JWT + RBAC, scrypt password hashing |
| LLM routing | Omninet 9-provider router (Groq, Gemini, Bai, DeepSeek, Claude, OpenRouter, Ollama, HuggingFace, local GGUF) |
| Observability | Pino, in-house OpenTelemetry-style tracing, Sentry |
| Sandbox | Python / Node / Bash execution |

---

## Top-Level Modules

| File | Purpose |
|---|---|
| `index.ts` | Express app: routes, middleware, startup orchestration, background services |
| `agent.ts` | Intent router: natural-language → typed intent (quick_scan / deep_analysis / fly_to / toggle_layer / weather_check / compute / panel_command / unknown) |
| `advancedAgent.ts` | Multi-step agent orchestration, dynamic tool integration |
| `orchestrator.ts` | Agent orchestration helpers |
| `aiGate.ts` | AI provider gating / fallback |
| `mcp.ts` | Model Context Protocol integration |
| `websocket.ts` | WebSocket server for live data + agent relay |
| `voiceRealtime.ts` | Realtime voice bridge (OpenAI Realtime → Gemini Live) |
| `pubsub.ts` | Publish/subscribe message bus (in-process EventEmitter — not Redis) |
| `monitor.ts` | Runtime monitor |
| `selfImprover.ts` / `selfImproverV2.ts` | Feedback-driven self-improvement (response evaluation, drift detection, prompt evolution) |
| `costOptimizer.ts` | LLM cost optimization |
| `resilience.ts` | Failure resilience utilities |
| `disasterAssessment.ts` / `disasterFusion.ts` | Disaster risk assessment + multi-source fusion |
| `pluginManager.ts` | Plugin system for extensibility |
| `sandboxManager.ts` | Sandbox execution manager |
| `apiMetadata.ts` | API metadata + category definitions |
| `embedding.ts` | Text embedding engine for semantic search |
| `memoryManager.ts` | Top-level memory facade with XML context builder |

---

## Module Directories

| Module | Purpose |
|---|---|
| `analytical-models/` | 150 equation engines grounded in primary literature (7 parts, 26 domains), tool configs, workflows, context engine |
| `cognition/` | CognitiveOrchestrator, System 1 / System 2, MCTS, reasoning tree, tree-of-thoughts, execution orchestrator |
| `sentinel/` | Continuous monitoring: stream processor, anomaly detector, correlation engine, alert intelligence, ambient/proactive insights |
| `memory/` + `memoryV2/` | Working / episodic / semantic / procedural / predictive memory, sensory buffer, Redis adapter |
| `scenarios/` | Scenario generation (single + batch), simulators, scenario DB |
| `sandboxV2/` | Simplified surrogate engines (`farsiteLite`, `adcircLite`, `wrfLite`, `hysplitLite`, FNO) — not the operational models of the same names |
| `world-model/` | Causal graph, ensemble predictor, physics NN, prediction validator, scenario simulator |
| `causal/` | Causal reasoning: KG, discovery engine, entropy mixer, Python microservice (DoWhy) |
| `kgV2/` | Knowledge graph v2: entity/edge generation, graph completion, counterfactual, evolving graph |
| `multimodal/` | Satellite analyzer, seismic processor, radar interpreter, sentiment analyzer, fusion |
| `ai-router/` | Omninet 9-provider LLM router (incl. local GGUF fallback) |
| `rag/` | Retrieval-augmented generation: embeddings, memory bridge |
| `h3-engine/` | H3 indexing, spatial query, ClickHouse, TimescaleDB, stream processor |
| `foundation-models/` | Weather forecaster, agriculture monitor, BayFire detector, MVT tile server, SpaceX API, STAC search |
| `kaggle/` | Kaggle simulation orchestration: sim runner, local runner, power saver, bathymetry, ERA5, land cover |
| `data/` | 30+ data fetchers: weather, seismic, ocean, glacier, permafrost, volcano, tides, soil, imerg, gldas |
| `grid/` | NetCDF reader |
| `dream/` | Dream engine: synthetic scenario generation |
| `earthgen/` | Earth generation: latent transformer, flow matching, dataset |
| `meta-cognition/` | Architecture proposals, prompt evolution, intent discovery |
| `self-evolution/` | Code writer, test runner, git integration, bandit router |
| `ml/` | Evals, prompt lab, synthetic data, knowledge graph, predictor |
| `toolsV2/` | Dynamic tool system: generator, composer, discovery, self-healing executor, repair |
| `reflex/` | Reflex engine: conditions, actions, trauma mode |
| `explainability/` | Bias auditor, evidence chain, human override, reasoning visualizer |
| `fork/` | Parallel reality fork manager |
| `middleware/` | JWT auth, rate limiter, tenant isolation, audit, validation, error handler |
| `observability/` | Pino logger, metrics, in-house OpenTelemetry-style tracing, Sentry |
| `queue/` | Job queue |
| `email/` | Nodemailer integration |
| `routes/` | Foundation models, self-evolution, pulse, cache service, OpenAPI |
| `infrastructure/` | Redis setup |
| `utils/` | 29 utility modules: FIRMS, EONET, ISS, MGRS, NDBC, OpenAQ, ERA5, ACLED, CMEMS, shakeMap, SPC, VAAC, space debris, wavewatch, geo |
| `ai-patterns/` | Pattern store, summarize tool |
| `plugins/` | Plugin system + example plugin |
| `maritime/` | AIS tracker |
| `simulation/` | Real-data bridge |

---

## Local GGUF Model

The server can fall back to a **local LLM** via `llama-server` when cloud providers are unavailable. This is the `local-gguf` provider in the Omninet router.

### Auto-launch

On startup, the server checks for `models/LFM2.5-2.6B-Q4_K_M.gguf`. If found, it spawns `llama-server` on port **11436** (configurable via `LLAMA_SERVER_PATH`). The local model is then available as a drop-in LLM provider.

### One-click download

The admin panel Home tab includes a "Download Model" button that streams the model from HuggingFace (`LiquidAI/LFM2.5-2.6B-GGUF`) directly into `models/`. The download features:

- **Live progress bar** with percentage, speed (MB/s), and ETA
- **Resume support** — writes to a `.partial` temp file; on interruption, re-triggering sends an HTTP `Range` header to HuggingFace and appends to the partial file
- **Atomic finalisation** — the `.partial` file is renamed to the final path only when 100% complete, so a corrupt file never shows as "Installed"

### API

| Endpoint | Description |
|---|---|
| `GET /api/admin/models/gguf-status` | Install state, file size, partial size, live download progress, speed, ETA |
| `POST /api/admin/models/gguf-download` | Start or resume download (guards against re-download if already installed) |
| `DELETE /api/admin/models/gguf` | Remove the model file and any partial download |

Override the download URL with `GGUF_DOWNLOAD_URL` environment variable.

---

## Database

### SQLite (`better-sqlite3`)

Primary store. Schema is defined in `server/db/schema.sql` (47 tables) and applied via `server/db/index.ts` migrations:

- Users, roles, permissions
- Scenarios + simulation jobs
- Memory traces (episodic / semantic / procedural)
- Forks, sessions
- Feedback, evidence chains
- Audit logs

### Redis (`ioredis`)

Optional caching and the sensory/working memory hot path. The server **gracefully degrades** to SQLite when Redis is unreachable — memory and caching tiers fall back automatically. WebSocket/SSE delivery uses the in-process event bus, not Redis pub/sub.

---

## Security

| Control | Implementation |
|---|---|
| Authentication | JWT bearer tokens (`middleware/auth.ts`) |
| Password hashing | scrypt (RFC 7914, `N=16384, r=8, p=1`) |
| Authorization | Role-based access control (RBAC) |
| Rate limiting | Per-IP + per-user limiters (`middleware/rateLimiter.ts`) |
| Tenant isolation | `middleware/tenantIsolation.ts` |
| Audit | `middleware/audit.ts` |
| Input validation | Zod schemas (`middleware/validate.ts`) |
| SSRF protection | `utils/ssrfGuard.ts` |
| Security headers | CSP, HSTS (stricter in production) |
| Sandboxing | `sandboxManager.ts` + `sandboxV2/` for untrusted execution |

### Production Enforcement

In `NODE_ENV=production`, the server **requires** a `JWT_SECRET` of ≥ 32 characters and an `ADMIN_BOOTSTRAP_PASSWORD` (≥ 16 chars) to provision the default admin. Development auto-login (`/api/auth/dev-login`) is disabled.

---

## Observability

| Component | Tooling |
|---|---|
| Logging | Pino (structured JSON, pretty in dev) |
| Metrics | Prometheus-style metrics endpoint |
| Tracing | OpenTelemetry-style spans (in-house `observability/openTelemetry.ts`; official SDK imports are stubbed) |
| Error tracking | Sentry (opt-in via `SENTRY_DSN`) |
| Health | `/api/health`, `/api/ready`, `/api/live` |

---

## See Also

- [API Reference](API.md) — full REST + WebSocket endpoint list
- [Analytical Models](MODELS.md) — the 150 equation engines
- [Architecture](ARCHITECTURE.md) — system topology and request flow
