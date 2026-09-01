# Backend

The Terranoetis backend is a **Node.js + Express 4** API server (TypeScript via `tsx`), exposing **294 REST endpoints** and a WebSocket channel. It coordinates live data ingestion, the 150-equation analytical engine, AI cognition, realtime services, and persistent state.

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
| LLM routing | Omninet 7-provider router |
| Observability | Pino, OpenTelemetry, Sentry |
| Sandbox | Python / Node / Bash execution |

---

## Top-Level Modules

| File | Purpose |
|---|---|
| `index.ts` | Express app: routes, middleware, startup orchestration, background services |
| `agent.ts` | Intent router: natural-language → typed intent (quick_scan / deep_analysis / fly_to / toggle_layer / weather_check / compute / digital_twin / panel_command) |
| `advancedAgent.ts` | Multi-step agent orchestration, dynamic tool integration |
| `orchestrator.ts` | Agent orchestration helpers |
| `aiGate.ts` | AI provider gating / fallback |
| `mcp.ts` | Model Context Protocol integration |
| `websocket.ts` | WebSocket server for live data + agent relay |
| `voiceRealtime.ts` | Realtime voice bridge (OpenAI Realtime → Gemini Live) |
| `pubsub.ts` | Publish/subscribe message bus |
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
| `analytical-models/` | 150 peer-reviewed equation engines (7 parts, 26 domains), tool configs, workflows, context engine |
| `cognition/` | CognitiveOrchestrator, System 1 / System 2, MCTS, reasoning tree, tree-of-thoughts, execution orchestrator |
| `sentinel/` | Continuous monitoring: stream processor, anomaly detector, correlation engine, alert intelligence, ambient/proactive insights |
| `memory/` + `memoryV2/` | Working / episodic / semantic / procedural / predictive memory, sensory buffer, Redis adapter |
| `digitalTwin/` | Regional analysis: data fetching, analysis, orchestrator |
| `scenarios/` | Scenario generation (single + batch), simulators, scenario DB |
| `sandboxV2/` | Simulation engines: FARSITE, ADCIRC, WRF, HYSPLIT, FNO surrogate |
| `world-model/` | Causal graph, ensemble predictor, physics NN, prediction validator, scenario simulator |
| `causal/` | Causal reasoning: KG, discovery engine, entropy mixer, Python microservice (DoWhy) |
| `kgV2/` | Knowledge graph v2: entity/edge generation, graph completion, counterfactual, evolving graph |
| `multimodal/` | Satellite analyzer, seismic processor, radar interpreter, sentiment analyzer, fusion |
| `ai-router/` | Omninet 7-provider LLM router |
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
| `observability/` | Pino logger, metrics, OpenTelemetry, Sentry |
| `queue/` | Job queue |
| `email/` | Nodemailer integration |
| `routes/` | Foundation models, self-evolution, vault, pulse, cache service, OpenAPI |
| `infrastructure/` | Redis setup |
| `utils/` | 29 utility modules: FIRMS, EONET, ISS, MGRS, NDBC, OpenAQ, ERA5, ACLED, CMEMS, shakeMap, SPC, VAAC, space debris, wavewatch, geo |
| `ai-patterns/` | Pattern store, summarize tool |
| `plugins/` | Plugin system + example plugin |
| `maritime/` | AIS tracker |
| `simulation/` | Real-data bridge |

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

Caching, session state, WebSocket pub/sub, and queueing. The server **gracefully degrades** to SQLite when Redis is unreachable — memory and caching tiers fall back automatically.

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
| Tracing | OpenTelemetry |
| Error tracking | Sentry (opt-in via `SENTRY_DSN`) |
| Health | `/api/health`, `/api/ready`, `/api/live` |

---

## See Also

- [API Reference](API.md) — full REST + WebSocket endpoint list
- [Analytical Models](MODELS.md) — the 150 equation engines
- [Architecture](ARCHITECTURE.md) — system topology and request flow
