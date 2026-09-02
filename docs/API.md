# API Reference

Terranoetis exposes **297 REST endpoints** plus a real-time **WebSocket** channel. All API routes are served under `/api`. Authentication uses JWT bearer tokens with role-based access control (RBAC).

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
- [WebSocket](#websocket)
- [Error Handling](#error-handling)

---

## Conventions

- **Base URL:** `/api`
- **Content-Type:** `application/json`
- **Auth:** `Authorization: Bearer <JWT>`
- **Rate limiting:** per-IP and per-user limits apply on public + authenticated routes
- **Public routes** (no auth): `/auth/login`, `/auth/dev-login`, `/auth/refresh`, `/health`, `/ready`, `/live`, `/metrics`, `/config/apis`, `/openapi.json`, `/docs`

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
| POST | `/api/agent/plan` / `/api/agent/plan/execute` | Hierarchical task network (HTN) planning + execution |
| POST | `/api/agent/search-all` | Unified natural-language search across all databases |
| POST | `/api/agent/suggestions` | Proactive insight suggestions |
| POST | `/api/agent/schedule` | Schedule recurring tasks |
| POST | `/api/agent/approve` | Approve pending agent actions |
| POST | `/api/agent/feedback` | Record feedback for self-improvement |
| GET | `/api/agent/analytics` | Agent performance analytics |
| GET | `/api/agent/context` | Conversation context |
| GET | `/api/agent/events` | Agent event stream |
| GET | `/api/agent/tiers` | Model tier configuration |
| GET | `/api/agent/models` | List all available LLM models with availability status |
| GET | `/api/agent/geocode` | Geocoding |
| GET | `/api/agent/trace/:id` | Reasoning trace for an interaction |
| GET | `/api/agent/memory` / DELETE | Conversation memory retrieval / clear |
| GET | `/api/agent/profile` / POST / DELETE | User profile management |
| GET | `/api/agent/monitor` / POST / DELETE | Monitor rule management |
| GET | `/api/agent/schedule` / POST / DELETE | Scheduled task management |
| GET | `/api/agent/cache` / DELETE | Agent cache inspection / purge |
| GET | `/api/agent/evidence/:id` | Evidence chain for a claim |

---

## Analytical Models

150 peer-reviewed equation engines across 25 domains and 7 parts.

| Method | Path | Description |
|---|---|---|
| GET | `/api/analytical-models/search` | Full-text + domain search over all 150 models |
| GET | `/api/analytical-models/:id` | Model detail (paper citation, formula, params) |
| POST | `/api/analytical-models/:id/execute-internal` | Execute a model with inputs |

The analytical pipeline applies **7-stage quality control** (input validation, unit checks, NaN/Inf handling, physical plausibility, uncertainty bounds, provenance capture, audit logging).

---

## Live Data Feeds

| Category | Endpoints |
|---|---|
| Seismic | `/api/earthquakes`, `/api/earthquakes/significant`, `/api/earthquakes/summary` |
| Weather | `/api/weather/open-meteo`, `/api/weather/alerts`, `/api/weather/nhc`, `/api/weather/marine`, `/api/weather/air-quality`, `/api/weather/gfs`, `/api/weather/ensemble`, `/api/weather/seasonal`, `/api/weather/historical`, `/api/weather/flood` |
| Aviation | `/api/flights`, `/api/flights/all`, `/api/flights/military`, `/api/adsb-fi`, `/api/adsb-lol`, `/api/flightaware`, `/api/airlabs` |
| Maritime | `/api/ais`, `/api/ais/nearby`, `/api/ais/status` |
| Fires & hazards | `/api/firms`, `/api/eonet`, `/api/gdacs/alerts`, `/api/fema`, `/api/geospatial/overpass` |
| Space | `/api/satellites/tle`, `/api/ucs-satellites`, `/api/spacex/launches`, `/api/space-debris`, `/api/space-weather/donki`, `/api/space-weather/kp`, `/api/aurora`, `/api/iss` |
| Traffic | `/api/road-traffic/analyze` |
| Climate | `/api/climate/power`, `/api/displacement`, `/api/electricity-grid` |

---

## Intelligence & Pulse

| Method | Path | Description |
|---|---|---|
| GET | `/api/pulse/market/quotes` | Live stock + crypto quotes |
| GET | `/api/pulse/energy/prices` | Energy commodity prices |
| GET | `/api/pulse/geopolitical/risks` | Geopolitical risk scores |
| GET | `/api/pulse/correlation/cards` | Cross-asset correlation analysis |
| GET | `/api/pulse/heatmap` | 18-asset price heatmap |
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
| GET | `/api/sandbox/workspace` / DELETE | Sandbox workspace management |
| POST | `/api/digital-twin/analyze` | Full regional digital-twin analysis |
| GET | `/api/kaggle/simulate/:id` | Kaggle simulation job status / results |
| GET | `/api/kaggle/simulate/:id/results` | Simulation result data |
| GET | `/api/kaggle/jobs` | Kaggle job queue |
| POST | `/api/kaggle/simulate` | Submit a simulation run |

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
| GET | `/api/explain/bias/report` / `reports` | Bias audit reports |
| POST | `/api/explain/override/:id/approve` / `reject` | Human override workflow |
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
| GET | `/api/memory/stats` / `status` | Memory statistics / subsystem status |
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
| GET | `/api/tools` | Registered tools |
| DELETE | `/api/tools/:id` | Disable tool |
| GET | `/api/config/apis` | Public API config (no secrets) |
| GET | `/api/openapi.json` | OpenAPI spec |
| GET | `/api/docs` | API documentation UI |
| GET | `/api/health` | Health + readiness checks |

---

## WebSocket

The WebSocket server (`server/websocket.ts`) streams live data and agent events to connected clients:

- Live entity updates (flights, vessels, satellites, earthquakes)
- Agent SSE-style streaming relayed over WS
- Presence (collaboration cursors, typing)
- Pub/sub messages (alerts, fork state)

Connection: `ws://<host>:3001` (brokered through the same server as REST).

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
