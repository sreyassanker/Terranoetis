# Realtime_v2 — Autonomous Geospatial AI Platform

A real-time geospatial intelligence platform with a 3D Cesium globe, multi-source data layer aggregation, autonomous AI agent, background job queue, WebSocket real-time communication, and a full ML pipeline for predictive analytics.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp server/.env.example server/.env
# Edit server/.env with your API keys (at minimum JWT_SECRET and GEMINI_API_KEY)

# Start both client (Vite) and server (tsx) concurrently
npm run dev

# Or start them separately:
npm run dev:server   # Express API on :3001
npm run dev:client   # Vite dev server on :5173
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Frontend (Vite + React)                      │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ CesiumJS │  │ AuthContext   │  │ useWS    │  │ AdminDashboard    │  │
│  │   Globe   │  │  (JWT auth)  │  │ (WS hook)│  │ (Metrics/Audit)   │  │
│  │  Layers   │  │ LoginModal   │  │  Cancel  │  │ ML Pipeline UI    │  │
│  └────┬─────┘  └──────┬───────┘  └────┬─────┘  └────────┬──────────┘  │
└───────┼───────────────┼───────────────┼──────────────────┼─────────────┘
        │               │               │                  │
   ┌────▼───────────────▼───────────────▼──────────────────▼──────────┐
   │                     HTTP / WebSocket (port 3001)                 │
   │  ┌─────────┐  ┌──────────┐  ┌─────────────┐  ┌───────────────┐  │
   │  │Express  │  │  authGuard│  │  WebSocket  │  │  SSE (/events)│  │
   │  │  Routes │  │ (JWT)     │  │  /ws/agent  │  │  (deprecated) │  │
   │  └────┬────┘  └──────────┘  └──────┬──────┘  └───────────────┘  │
   └───────┼────────────────────────────┼─────────────────────────────┘
           │                            │
     ┌─────▼────────────────────────────▼──────────────────────────┐
     │                    Express Server (index.ts)                │
     │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
     │  │Agent     │ │Sandbox    │ │Memory    │ │Orchestrator  │  │
     │  │(Gemini)  │ │Manager    │ │Manager   │ │              │  │
     │  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
     │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
     │  │Embedding │ │CostOpt    │ │SelfImpro │ │PromptLab     │  │
     │  │Engine    │ │(cache +   │ │ver       │ │(A/B testing) │  │
     │  │          │ │ routing)  │ │(tuning)  │ │              │  │
     │  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
     │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
     │  │Knowledge │ │Predictor  │ │Evals     │ │SyntheticData │  │
     │  │Graph     │ │(hazard)   │ │(Gemini)  │ │Generator     │  │
     │  └──────────┘ └───────────┘ └──────────┘ └──────────────┘  │
     └──────────────────────────┬──────────────────────────────────┘
                                │
     ┌──────────────────────────▼──────────────────────────────────┐
     │                  Background Job Queue (SQLite)              │
     │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
     │  │Monitor   │ │Scheduler │ │Ambient   │ │ML: synthetic  │  │
     │  │(rules)   │ │(tasks)   │ │Detector  │ │KG stats       │  │
     │  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
     └─────────────────────────────────────────────────────────────┘
                                │
     ┌──────────────────────────▼──────────────────────────────────┐
     │                    SQLite Database                          │
     │  profiles, episodes, feedback, config, cache_entries,       │
     │  facts, vec_store, procedural_patterns, eval_scores,        │
     │  synthetic_data, knowledge_entities, knowledge_relations,   │
     │  historical_patterns, prediction_log, audit_logs, chats     │
     └─────────────────────────────────────────────────────────────┘
```

### Key Data Flows

1. **User → Globe**: CesiumJS renders data layers fetched from Express REST endpoints (earthquakes, weather, flights, etc.)
2. **User → Agent**: Chat messages POST to `/api/agent/ask` → Gemini → structured commands → globe visualization
3. **Real-time push**: Background workers (monitor/scheduler/ambient) publish via EventEmitter → WebSocket broadcasts to subscribed clients
4. **Self-improvement**: Each agent response is evaluated by Gemini (relevance/accuracy/helpfulness), feedback is stored, SelfImprover auto-tunes cache thresholds and model routing
5. **ML Pipeline**: Synthetic data generation → prompt A/B testing → knowledge graph construction → hazard prediction → outcome tracking

## API Documentation

### Authentication

```
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "any" }

Response: { "token": "eyJhbGci..." }
```

All subsequent requests require `Authorization: Bearer <token>` header. Token contains JWT with 24h expiry.

### Agent

```
POST /api/agent/ask                  — Send query to AI agent (SSE stream)
  Body: { "message": "...", "intentType": optional, "modelTier": optional }
  Events: connected → step → commands → output → done

GET  /api/agent/analytics            — Full analytics (feedback, cost, cache, ML)
GET  /api/agent/feedback             — Feedback stats (by intent, by model)
POST /api/agent/feedback             — Submit vote (up/down)
GET  /api/agent/tuning               — Current SelfImprover parameters

POST /api/agent/analyze-vision       — Gemini Vision image analysis
POST /api/agent/analyze-data         — CSV/GeoJSON file analysis
```

### WebSocket

```
WS   /ws/agent?token=<JWT>

Messages (JSON):
  { "type": "subscribe",     "channel": "proactive" }
  { "type": "unsubscribe",   "channel": "proactive" }
  { "type": "ping" }
  { "type": "cancel_request", "requestId": "uuid" }
  { "type": "command",       "action": "typing", "data": {} }

Server sends (JSON):
  { "type": "monitor_trigger",  "channel": "proactive", ... }
  { "type": "scheduled_report", "channel": "proactive", ... }
  { "type": "ambient_event",    "channel": "proactive", ... }
  { "type": "pong" }
  { "type": "ack", "ok": true }
```

### ML Pipeline

```
GET  /api/ml/evals                        — Evaluation scores
GET  /api/ml/synthetic-data[?intent=]     — Generated training examples
POST /api/ml/synthetic-data/generate      — Trigger one-off generation
GET  /api/ml/knowledge-graph/stats        — Entity/relation counts
GET  /api/ml/knowledge-graph/entity?name= — Entity lookup
GET  /api/ml/knowledge-graph/query?q=     — Vector similarity search
POST /api/ml/knowledge-graph/entity       — Create entity
POST /api/ml/knowledge-graph/relation     — Create relation
GET  /api/ml/predict?lat=&lon=&layers=    — Hazard predictions
POST /api/ml/predict/outcome              — Record prediction outcome
GET  /api/ml/predict/report               — Gemini risk report
GET  /api/ml/variants                     — Active prompt variants
```

### Monitoring

```
GET  /api/health     — Full health (db, memory, uptime, queue depth)
GET  /api/ready      — Readiness probe (db available)
GET  /api/live       — Liveness probe (process alive)
GET  /api/metrics    — Prometheus metrics (Prometheus format)
```

### Data

```
GET  /api/earthquakes[?minutes=1440]       — USGS earthquakes (GeoJSON)
GET  /api/earthquakes/significant           — Significant quakes (30d)
GET  /api/tectonic                           — Tectonic plates
GET  /api/gdacs/alerts                       — GDACS disaster alerts
GET  /api/weather/open-meteo?lat=&lon=       — Open-Meteo forecast
GET  /api/weather/nhc                        — Tropical cyclone tracks
GET  /api/weather/alerts                     — NWS alerts (US)
GET  /api/lightning                          — Lightning strikes
GET  /api/eonet[?source=wildfires|floods]    — NASA EONET events
GET  /api/firms[?days=1]                     — NASA FIRMS fires
GET  /api/vaac/tokyo                         — Volcanic ash advisories
GET  /api/adsb-lol                           — Live aircraft (ADSB)
GET  /api/openflights                        — Airport database
GET  /api/submarine-cables                   — Submarine cable map
GET  /api/electricity-grid                   — Grid carbon intensity
GET  /api/space-debris                       — Orbital debris tracking
GET  /api/nasa-dsn                           — Deep Space Network
GET  /api/aurora                             — Aurora forecast
GET  /api/iss                                — ISS position
GET  /api/cameras[/:lat/:lon/:radius]        — CCTV cameras
GET  /api/sandbox/execute                    — Execute code sandbox
GET  /api/chats                              — Chat sessions
```

## Security

- **Authentication**: JWT with 24h expiry, required on all endpoints except `/api/auth/login`, `/api/health`, `/api/ready`, `/api/live`, `/api/metrics`
- **Rate Limiting**: Per-user — 30 req/min for agent endpoints, 5 req/min for sandbox execution
- **Sandbox Isolation**: Plugin/user code executes in isolated VM sandbox with resource limits (3 concurrent local, 10 concurrent cloud)
- **Tenant Isolation**: Row-level ownership checks via `requireOwnership` middleware — users can only access their own data
- **Input Validation**: Joi schemas validate all request bodies at middleware level
- **Audit Logging**: All mutations logged to `audit_logs` table with user ID, action, IP, and user agent
- **Helmet**: Standard HTTP security headers (CSP disabled for CesiumJS inline styles)
- **CORS**: Restricted to `CLIENT_ORIGIN` env var

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | Secret key for JWT token signing |
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key (agent + embeddings + evals) |
| `CLIENT_ORIGIN` | Yes | `http://localhost:5173` | Allowed CORS origin |
| `PROXY_PORT` | No | `3001` | Server listen port |
| `NODE_ENV` | No | `development` | Environment name |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `GOOGLE_GEMINI_API_KEY` | No | — | Backup Gemini key (legacy fallback) |
| `SANDBOX_API_TOKEN` | No | — | Sandbox execution token |
| `METRICS_API_TOKEN` | No | — | Prometheus metrics endpoint token |
| `E2B_API_KEY` | No | — | E2B cloud sandbox key |
| `CESIUM_ION_ACCESS_TOKEN` | No | — | Cesium Ion 3D globe token |
| `SENTINEL_HUB_CLIENT_ID` | No | — | Sentinel Hub satellite imagery |
| `SENTINEL_HUB_CLIENT_SECRET` | No | — | Sentinel Hub client secret |
| `NASA_FIRMS_MAP_KEY` | No | — | NASA FIRMS wildfire detections |
| `EARTHDATA_USERNAME` | No | — | NASA Earthdata GNSS orbits |
| `EARTHDATA_PASSWORD` | No | — | NASA Earthdata password |
| `FLIGHTAWARE_AEROAPI_KEY` | No | — | FlightAware flight tracking |
| `AIRLABS_API_KEY` | No | — | AirLabs flight data |
| `AIS_STREAM_API_KEY` | No | — | AIS vessel tracking |
| `MARINE_TRAFFIC_API_KEY` | No | — | MarineTraffic vessels |
| `ANTHROPIC_API_KEY` | No | — | Claude AI (alternative agent) |
| `PLANET_API_KEY` | No | — | Planet Labs satellite imagery |
| `MAXAR_API_KEY` | No | — | Maxar satellite imagery |
| `TWITTER_API_KEY` | No | — | Twitter/X API (intel feed) |
| `TWITTER_API_SECRET` | No | — | Twitter API secret |
| `TWITTER_BEARER_TOKEN` | No | — | Twitter bearer token |
| `NEWS_API_KEY` | No | — | NewsAPI aggregation |

Non-critical missing vars log a warning at startup; the app continues with degraded functionality.

## Deployment

### Docker

```bash
# Build
docker build -t realtime-v2 .

# Run
docker run -p 3001:3001 --env-file server/.env -v realtime-data:/data realtime-v2

# Or with docker-compose
docker compose up -d
```

### Health Checks (Kubernetes)

```yaml
livenessProbe:
  httpGet: { path: /api/live, port: 3001 }
  initialDelaySeconds: 10
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /api/ready, port: 3001 }
  initialDelaySeconds: 5
  periodSeconds: 5
```

### Prometheus Metrics

The `/api/metrics` endpoint exposes Prometheus-formatted metrics including:
- `gemini_api_calls_total` — Gemini API call count by model/status
- `gemini_api_latency` — Gemini API latency histogram
- `sandbox_executions_total` — Sandbox runs by language
- `db_query_duration` — SQLite query latency
- `cache_hit_rate` — Semantic cache hit ratio
- `active_sse_connections` — Active SSE connections

### Tech Stack

- **Frontend**: React 19, TypeScript, CesiumJS, Tailwind CSS, Radix UI, Vite
- **Server**: Node.js 20, Express, TypeScript, SQLite (better-sqlite3)
- **AI**: Google Gemini API (agent, embeddings, vision, evals, synthetic data)
- **Real-time**: WebSocket (`ws`), SSE (deprecated fallback), EventEmitter pub/sub
- **Background Jobs**: SQLite-backed priority queue
- **Observability**: Pino logging, Prometheus metrics, health probes
- **Sandbox**: Isolated code execution (local VM + E2B cloud)
