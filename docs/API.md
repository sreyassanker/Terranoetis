# API Reference

Terranoetis exposes **360+ REST endpoints** (371 handler registrations counted across `server/` on 2026-09-09) plus real-time **WebSocket** (`/ws/agent`, `/ws/voice`) and **SSE** channels. All API routes are served under `/api`. Authentication uses JWT bearer tokens with role-based access control (RBAC).

> Site views: [API reference](reference/api.html) · [Simulation job API & parameter contracts](reference/simulation-api.html) · machine-readable spec at `GET /api/openapi.json`. The tables below are the curated prose map; per-endpoint behaviour is cited in the reference pages.

---

## Table of Contents

- [Conventions](#conventions)
- [Authentication](#authentication)
- [Agent & Cognition](#agent--cognition)
- [Analytical Models](#analytical-models)
- [Live Data Feeds](#live-data-feeds)
- [Intelligence & Pulse](#intelligence--pulse)
- [Simulations & Scenarios](#simulations--scenarios)
- [Explainability & Governance](#explainability--governance)
- [Memory & Knowledge](#memory--knowledge)
- [Admin & Operations](#admin--operations)
- [Local GGUF Model](#local-gguf-model)
- [WebSocket](#websocket)
- [Error Handling](#error-handling)

---

## Conventions

- **Base URL:** `/api`
- **Content-Type:** `application/json`
- **Auth:** `Authorization: Bearer <JWT>`
- **Rate limiting:** per-IP and per-user limits apply on public + authenticated routes
- **Public routes** (no auth): `/auth/login`, `/auth/dev-login`, `/auth/refresh`, `/health`, `/ready`, `/live`, `/metrics`, `/config/apis`, `/openapi.json`, `/docs`. In addition, read-only live-data endpoints (e.g. `/earthquakes`, `/weather/*`, `/flights`, `/ais`, `/satellites/tle`, `/pulse/*`, `/kaggle/*`, `/analytical-models` search + detail) are public but server-side rate-limited, as are shared-session reads (`/shared/*`), map tiles (`/tiles/*`, `/tilejson`), foundation-model endpoints (`/fm/*`, `/road-traffic/*`, `/spacex/*`, `/bayfire/*`), multimodal endpoints (`/multimodal/*`), and simulations (`/simulate/*`). `/social/stream` authenticates via `?token=` (SSE).

---

## Authentication

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Exchange credentials for a JWT |
| POST | `/api/auth/dev-login` | Development-only auto-login (disabled in production) |
| POST | `/api/auth/refresh` | Refresh an unexpired JWT |
| — | `authGuard` | Protects authenticated routes |

Passwords are hashed with **scrypt** (RFC 7914, `scrypt$N=16384,r=8,p=1`) — no plaintext storage, no external crypto dependency.

---

## Agent & Cognition

The agent pipeline routes natural-language queries through intent recognition (System 1 / System 2) and executes tool chains against live data.

| Method | Path | Description |
|---|---|---|
| POST | `/api/agent/ask` | Main agent endpoint — SSE streaming chat with tool execution |
| POST | `/api/agent/local-ask` | Offline/local fallback agent |
| POST | `/api/agent/cognize` | Cognitive reasoning entry point |
| POST | `/api/agent/analyze-data` | Data analysis task |
| POST | `/api/agent/analyze-vision` | Vision/image analysis |
| POST | `/api/agent/pipeline` | Multi-stage pipeline execution |
| POST | `/api/agent/plan` | Hierarchical task network (HTN) planning |
| POST | `/api/agent/plan/execute` | Execute an HTN plan |
| POST | `/api/agent/search-all` | Unified natural-language search across all databases |
| POST | `/api/agent/suggestions` | Proactive insight suggestions |
| POST | `/api/agent/approve` | Approve pending agent actions |
| POST | `/api/agent/feedback` | Record feedback for self-improvement |
| GET | `/api/agent/analytics` | Agent performance analytics |
| GET | `/api/agent/context` | Conversation context |
| GET | `/api/agent/events` | Agent event stream (SSE; deprecated — superseded by WebSocket `/ws/agent`) |
| GET | `/api/agent/tiers` | Model tier configuration |
| GET | `/api/agent/models` | List all available LLM models with availability status |
| GET | `/api/agent/geocode` | Geocoding |
| GET | `/api/agent/trace/:id` | Reasoning trace for an interaction |
| GET | `/api/agent/memory` | Conversation memory retrieval |
| DELETE | `/api/agent/memory` | Clear conversation memory |
| GET | `/api/agent/profile` | Get user profile |
| POST | `/api/agent/profile` | Update user profile |
| DELETE | `/api/agent/profile` | Delete user profile |
| GET | `/api/agent/monitor` | List monitor rules |
| POST | `/api/agent/monitor` | Create monitor rule |
| DELETE | `/api/agent/monitor/:id` | Delete a monitor rule |
| GET | `/api/agent/schedule` | List scheduled tasks |
| POST | `/api/agent/schedule` | Create a scheduled task |
| DELETE | `/api/agent/schedule/:id` | Delete a scheduled task |
| GET | `/api/agent/cache` | Inspect agent cache |
| DELETE | `/api/agent/cache` | Purge agent cache |
| GET | `/api/agent/evidence/:id` | Evidence chain for a claim |

---

## Analytical Models

150 equation engines grounded in primary literature across 26 domains and 7 parts.

| Method | Path | Description |
|---|---|---|
| GET | `/api/analytical-models` | Full catalog (all 150 models) |
| GET | `/api/analytical-models/search` | Full-text + domain search over all 150 models |
| GET | `/api/analytical-models/:id` | Model detail (paper citation, formula, params) |
| POST | `/api/analytical-models/:id/execute` | Execute a model with inputs (authenticated) |
| POST | `/api/analytical-models/:id/execute-internal` | Execute a model from the server-side tool executor (loopback; remote callers need admin JWT) |

The analytical pipeline applies a **7-stage workflow** (input validation → preprocessing → computation → post-processing → quality control → uncertainty estimation → interpretation), defined in `server/analytical-models/toolWorkflows.ts`.

---

## Live Data Feeds

| Category | Endpoints |
|---|---|
| Seismic | `/api/earthquakes`, `/api/earthquakes/significant`, `/api/earthquakes/summary` |
| Weather | `/api/weather/open-meteo`, `/api/weather/alerts`, `/api/weather/nhc`, `/api/weather/marine`, `/api/weather/air-quality`, `/api/weather/gfs`, `/api/weather/ensemble`, `/api/weather/seasonal`, `/api/weather/historical`, `/api/weather/flood` |
| Aviation | `/api/flights`, `/api/flights/all`, `/api/flights/military`, `/api/adsb-fi`, `/api/adsb-lol`, `/api/airlabs` |
| Maritime | `/api/ais`, `/api/ais/nearby`, `/api/ais/status` |
| Fires & hazards | `/api/firms`, `/api/eonet`, `/api/gdacs/alerts`, `/api/fema`, `/api/geospatial/overpass` |
| Space | `/api/satellites/tle`, `/api/ucs-satellites`, `/api/spacex/launches`, `/api/space-debris`, `/api/space-weather/donki`, `/api/space-weather/kp`, `/api/aurora`, `/api/iss` |
| Traffic | `/api/road-traffic/analyze` |
| Climate | `/api/climate/power`, `/api/electricity-grid` |

---

## Intelligence & Pulse

| Method | Path | Description |
|---|---|---|
| GET | `/api/pulse/market/quotes` | Live stock + crypto quotes |
| GET | `/api/pulse/energy/prices` | Energy commodity prices |
| GET | `/api/pulse/geopolitical/risks` | Geopolitical risk scores |
| GET | `/api/pulse/correlation/cards` | Cross-asset correlation analysis |
| GET | `/api/pulse/heatmap` | 19-asset price heatmap |
| GET | `/api/correlation/anomalies` | Anomaly detection feed |
| GET | `/api/correlation/status` | Correlation engine status |
| GET | `/api/gold`, `/api/fred`, `/api/eia`, `/api/entsoe`, `/api/imf`, `/api/comtrade`, `/api/alphavantage`, `/api/coingecko` | Economic & financial data |

---

## Simulations & Scenarios

| Method | Path | Description |
|---|---|---|
| POST | `/api/scenarios/generate` | Generate a single disaster scenario |
| POST | `/api/scenarios/batch` | Batch-generate scenarios |
| GET | `/api/scenarios/:id` | Scenario detail |
| POST | `/api/sandbox/execute` | Execute Python / Node / Bash in the sandbox |
| POST | `/api/sandbox/workspace` | Create a sandbox workspace |
| DELETE | `/api/sandbox/workspace/:id` | Delete a workspace |
| POST | `/api/sandbox/workspace/:id/upload` | Upload a file to the workspace |
| GET | `/api/sandbox/workspace/:id/files` | List workspace files |
| GET | `/api/sandbox/workspace/:id/read` | Read a workspace file |
| GET | `/api/kaggle/simulate/:id` | Kaggle simulation job status / results |
| GET | `/api/kaggle/simulate/:id/results` | Simulation result data |
| GET | `/api/kaggle/jobs` | Kaggle job queue |
| POST | `/api/kaggle/simulate` | Submit a simulation run (zod-validated contract; see parameter-contract reference) |
| GET | `/api/kaggle/simulate/:id/stream` | SSE job status/progress stream |
| POST | `/api/kaggle/simulate/:id/cancel` | Cooperative cancel (local runs SIGKILL at `LOCAL_SIM_TIMEOUT_MS`) |
| GET | `/api/kaggle/simulate/:id/grid/:name` | Result grid as raw `.npy` or JSON (≤ 5 M elements) |
| GET | `/api/kaggle/simulate/:id/geotiff/:name` | Result grid as WGS84 GeoTIFF |
| GET | `/api/kaggle/jobs` · `/api/kaggle/kernels` | Job list · kernel availability & GPU-accelerator flags |
| POST | `/api/kaggle/calibrate` | Landslide μ×ξ fit to an observed runout (local python3) |
| POST | `/api/kaggle/landslide/quantify` · `/api/kaggle/volcano/quantify` | Monte-Carlo UQ ensembles (local python3) |
| POST | `/api/kaggle/volcano/calibrate` · `/api/kaggle/volcano/profile` | Lava rheology calibration · wind-profile sampling |

---

## Explainability & Governance

| Method | Path | Description |
|---|---|---|
| GET | `/api/explain/status` | Explainability subsystem status |
| GET | `/api/explain/traces` | Reasoning traces |
| GET | `/api/explain/trace/:interactionId` | Full trace for an interaction |
| POST | `/api/explain/trace` | Create a trace |
| GET | `/api/explain/evidence/:interactionId` | Evidence chain |
| POST | `/api/explain/evidence/link` | Link evidence to claims |
| POST | `/api/explain/evidence/:id/verify` | Verify evidence |
| GET | `/api/explain/bias/geographic` | Geographic bias audit |
| GET | `/api/explain/bias/temporal` | Temporal bias audit |
| GET | `/api/explain/bias/report` | Latest bias audit report |
| GET | `/api/explain/bias/reports` | List bias audit reports |
| POST | `/api/explain/override/:id/approve` | Approve a pending override |
| POST | `/api/explain/override/:id/reject` | Reject a pending override |
| GET | `/api/explain/override/pending` | Pending overrides |
| GET | `/api/explain/override/audit-log` | Override audit log |
| POST | `/api/explain/uncertainty/compute` | Uncertainty quantification |
| GET | `/api/explain/uncertainty/calibration` | Calibration metrics |

---

## Memory & Knowledge

| Method | Path | Description |
|---|---|---|
| POST | `/api/memory/consolidate` | Trigger memory consolidation |
| GET | `/api/memory/working` | Working memory |
| GET | `/api/memory/episodes` | Episodic memory |
| GET | `/api/memory/facts` | Fact memory |
| GET | `/api/memory/procedural` | Procedural memory |
| GET | `/api/memory/predictive` | Predictive memory |
| GET | `/api/memory/sensory` | Sensory buffer |
| GET | `/api/memory/stats` | Memory statistics |
| GET | `/api/memory/status` | Memory subsystem status |
| GET | `/api/causal-graph` | Causal knowledge graph |
| GET | `/api/causal-graph/dot` | GraphViz DOT export |
| POST | `/api/kgV2/generate-entities` | Generate entities from a trigger event |
| POST | `/api/kgV2/generate-edges` | Generate causal relationships |
| POST | `/api/kgV2/counterfactual` | Counterfactual graph |
| POST | `/api/kgV2/complete` | Complete missing edges |
| GET | `/api/kgV2/evolve` | Apply decay, evolution log |

---

## Admin & Operations

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/metrics` | System metrics |
| GET | `/api/admin/audit-logs` | Audit log |
| GET | `/api/admin/plugins` | Installed plugins |
| POST | `/api/admin/plugins/install` | Install plugin (URL / GitHub / raw code) |
| POST | `/api/admin/plugins/install-zip` | Install plugin from a ZIP archive |
| POST | `/api/admin/plugins/:id/toggle` | Enable or disable a plugin |
| DELETE | `/api/admin/plugins/:id` | Remove plugin |
| GET | `/api/admin/models/gguf-status` | Local GGUF model status (installed, size, partial file, download progress, speed, ETA) |
| POST | `/api/admin/models/gguf-download` | Start or resume downloading the LFM 2.5 2.6B Q4_K_M GGUF model from HuggingFace |
| DELETE | `/api/admin/models/gguf` | Remove the local GGUF model file (and any partial download) |
| GET | `/api/tools` | Registered tools |
| DELETE | `/api/tools/:id` | Disable tool |
| GET | `/api/config/apis` | Public API config (no secrets) |
| GET | `/api/openapi.json` | OpenAPI spec |
| GET | `/api/docs` | API documentation UI |
| GET | `/api/health` | Health + readiness checks |

### Local GGUF Model

The server ships with a built-in downloader for the **LFM 2.5 2.6B Q4_K_M** GGUF model (`~1.6 GB`). Once downloaded, the server auto-starts `llama-server` on port 11436, making the local model available as a fallback LLM provider.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/models/gguf-status` | Check install state, file size, partial/resume state, and live download progress (speed, ETA) |
| POST | `/api/admin/models/gguf-download` | Start or resume downloading. Returns `alreadyInstalled: true` if the model is already present. Writes to a `.partial` file so network interruptions don't corrupt the real path |
| DELETE | `/api/admin/models/gguf` | Delete the model file and any partial download |

**Resume behaviour**: if the download is interrupted (network drop, server restart), the partial file is kept at `models/LFM2.5-2.6B-Q4_K_M.gguf.partial`. Re-triggering the download sends an HTTP `Range` header to HuggingFace and appends to the partial file — no re-download from scratch.

**Progress tracking**: the status endpoint returns `speedBytes` (bytes/s), `etaSeconds`, `percent`, `received`, `total`, `running`, `done`, and `resuming` flags for real-time UI updates.

---

## WebSocket

The WebSocket server (`server/websocket.ts`) streams live data and agent events to connected clients:

- Live entity updates (flights, vessels, satellites, earthquakes)
- Agent SSE-style streaming relayed over WS
- Presence (collaboration cursors, typing)
- Pub/sub messages (alerts, fork state)

Connection: `ws://<host>:3001` on paths `/ws/agent` and `/ws/voice` only (all other upgrade paths are destroyed); auth via `Sec-WebSocket-Protocol` bearer JWT (fallback `?token=`); 30 s heartbeat / 35 s timeout; channel allowlist includes `sentinel:raw`, `sentinel:alerts`, `correlation:alerts`, `fork:*`, per-user `ws:<id>` (`server/websocket.ts:79-145`). The event bus feeding it is the in-process pub/sub (`server/pubsub.ts`) — Redis is not required for realtime delivery.

---

## Error Handling

| Status | Meaning |
|---|---|
| `200` | Success |
| `400` | Validation error |
| `401` | Missing/invalid token |
| `403` | Insufficient role |
| `404` | Not found |
| `429` | Rate limited |
| `500` | Internal error |

Errors return `{ "error": "<message>" }`. Authentication failures return `{ "error": "Missing or invalid Authorization header..." }`.
