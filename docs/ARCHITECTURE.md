# Architecture

**Terranoetis** is a real-time geospatial intelligence platform built as a three-tier application:

- **Client** — React 19 + CesiumJS single-page application (Vite 7)
- **Server** — Node.js + Express 4 API, WebSocket realtime, JWT auth
- **Persistence** — SQLite (primary store) + Redis (cache, session, pub/sub)

This document describes the system topology, request lifecycle, background services, and the runtime modules that power the platform.

---

## Table of Contents

- [System Topology](#system-topology)
- [Request Flow](#request-flow)
- [Background Processes](#background-processes)
- [Frontend (`src/`)](#frontend-src)
- [Backend (`server/`)](#backend-server)
- [Storage Layer](#storage-layer)
- [External Integrations](#external-integrations)

---

## System Topology

```mermaid
%%{init: {'theme': 'neutral', 'flowchart': {'htmlLabels': false}}}%%
flowchart LR
    subgraph CLIENT["CLIENT (React 19 + CesiumJS)"]
        direction LR
        UI["UI\nPanels"]
        Render["Rendering\nCesium + 41 modules"]
        WS["WebSocket\nClient"]
        API["REST\nClient"]
        UI --> API
        Render --> API
        UI --> WS
    end

    subgraph SERVER["EXPRESS.JS SERVER"]
        Security["Security &\nObservability"]
        Agents["Agent &\nCognition\nSystem 1 + System 2\n9-LLM Router"]
        Engine["Analytical Engine\n150 equations\n7-stage QC\nKaggle kernels"]
        Data["Data Layer\n30+ live APIs\nFetchers + Cache"]
        Realtime["Realtime\nSentinel · Reflex\nVoice Bridge\nPubSub"]
        Services["World Model\nCausal KG · Memory\nDream · Forks\nScenarios"]
        Security --> Agents
        Security --> Data
        Agents --> Engine
        Data --> Engine
        Agents --> Realtime
        Agents --> Services
        Engine --> Services
    end

    subgraph STORAGE["PERSISTENCE"]
        SQLite["SQLite\nAuth · Scenarios\nMemory · Forks"]
        Redis["Redis\nCache · Session\nPubSub · Queue"]
    end

    subgraph EXTERNAL["EXTERNAL APIs"]
        LLM["LLM Providers\nGemini · Claude\nGroq · DeepSeek"]
        Live["Live Data\nOpenSky · USGS\nTomTom · Landsat\nFIRMS · AIS · LL2"]
        Voice["Realtime Voice\nOpenAI → Gemini\n(brokered server-side)"]
    end

    CLIENT -->|HTTP| Security
    CLIENT -->|WebSocket| Realtime
    Services --> STORAGE
    Engine --> Live
    Agents --> LLM
    Realtime --> Voice
```

### Component Inventory

| Layer | Location | Details |
|---|---|---|
| Client | `src/` | React 19, TypeScript, Vite 7, Tailwind CSS 3, CesiumJS 1.140 |
| Server | `server/` | Express 4, tsx runtime, TypeScript source files across module directories |
| Persistence | SQLite + Redis | better-sqlite3, ioredis |
| Containerization | Docker Compose | `terranoetis` (app), `redis` (cache), `causal-service` (Python) |

---

## Request Flow

The request lifecycle routes a natural-language user query through intent recognition, cognitive orchestration, and multi-stage tool execution.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart LR
    Q["User Query"] --> IR["IntentRouter\n(agent.ts)"]
    IR -->|"embedding + cosine similarity"| CO["CognitiveOrchestrator"]
    CO -->|"confidence >= 0.92"| S1["System 1\nFast real-data resolution"]
    CO -->|"0.70 <= conf < 0.92"| S2V["System 2\nVerify (10s timeout)"]
    CO -->|"conf < 0.70"| S2D["System 2\nDeep reasoning"]
    S1 -->|"real tool"| TE["Tool Execution\n(weather / earthquakes /\nflights / eonet / gdacs)"]
    S2D --> HTN["HTN Decomposition"]
    HTN --> MAD["Multi-Agent Debate\n4 agent personas"]
    MAD --> CR["Causal Reasoning"]
    CR --> CA["Counterfactual Analysis"]
    CA --> HG["Hypothesis Generation"]
    HG --> SC["Synthesis + Critic"]
    S2V --> TE
    SC --> TE
    TE -->|"API calls"| DF["Data Fetchers\n30+ sources"]
    TE -->|"Equations"| AE["Analytical Engine\n150 models"]
    TE -->|"Sandbox"| SB["Python / Node / Bash"]
    TE -->|"Foundation"| FME["Weather / Agriculture\nBayFire / SpaceX / MVT"]
    TE --> RP["Response Processing"]
    RP -->|"Cesium globe"| CG["3D Render"]
    RP -->|"Panels"| UP["UI Update"]
    RP -->|"Memory"| MS["Memory Store"]
```

### Routing

| Route | View | Description |
|---|---|---|
| `/` | App | Main Cesium globe application (~11,000 lines, 11 lazy-loaded panels) |
| `/v2/globe` | GlobePage | Dedicated Cesium globe viewport |
| `/v2/canvas` | CanvasPage | Spatial canvas |
| `/v2/scenarios` | ScenariosPage | Scenario gallery and editor |
| `/v2/tours` | ToursPage | Cinematic tours |

---

## Background Processes

The platform runs several continuous services that monitor live data, simulate scenarios, improve responses, and enforce safety.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart LR
    subgraph Continuous["Continuous Background Processes"]
        SE["Sentinel Engine\nPoll watch zones\nCompare vs baseline"] --> SP["Stream Processor\nFilter, Enrich, Route"]
        SP --> AD["Anomaly Detector"]
        SP --> CE["Correlation Engine\nCross-stream fusion"]
        AD --> AL["Alerts via PubSub"]
        CE --> AL

        DE["Dream Engine\nSynthetic scenarios"] --> FK["Fork Simulation"]
        FK --> EA["Evaluate Accuracy"]
        EA --> KG["Update Causal KG"]

        SI["Self-Improver\nRecord feedback"] --> ER["Evaluate Responses"]
        ER --> DD["Detect Drift"]
        DD --> EP["Evolve Prompts"]

        REF["Reflex Engine\nMonitor channels"] --> EC["Evaluate Conditions"]
        EC --> AC["Execute Actions\nALERT / ZOOM / SCAN"]
        AC --> TR["Trauma Mode\n>=3 simultaneous"]
    end
```

### Service Table

| Service | Purpose |
|---|---|
| Sentinel Engine | Polls configured watch zones and compares live conditions against baselines |
| Stream Processor | Filters, enriches, and routes incoming data streams |
| Correlation Engine | Cross-stream fusion for anomaly detection |
| Dream Engine | Generates synthetic scenarios and evaluates them against ground truth |
| Self-Improver | Records feedback, evaluates responses, detects drift, evolves prompts |
| Reflex Engine | Monitors channels and executes actions (ALERT / ZOOM / SCAN) |
| Trauma Mode | Aggregated response when ≥3 simultaneous alerts fire |

---

## Frontend (`src/`)

### Rendering Engine (`src/rendering/`, 41 modules)

| File | Purpose |
|---|---|
| `ais.ts` | Maritime AIS vessel positions/tracks |
| `aviation.ts` | Flight tracking (real-time aircraft + paths) |
| `flights.ts` | Flight route arcs (departure/arrival) |
| `earthquakes.ts` | Earthquake markers (magnitude-scaled, depth-colored) |
| `satelliteDataSources.ts` | TLE orbit propagation & rendering |
| `satelliteImagery.ts` | GIBS/XYZ/WMS imagery layer management |
| `satnogs.ts` | SatNOGS ground station visualization |
| `osmBuildings.ts` | OSM 3D building extrusion |
| `surfaceRenderer.ts` | IDW interpolation surface rendering |
| `gisFusion.ts` | GIS data fusion for risk surfaces |
| `studyArea.ts` | GeoJSON upload/draw/export/fly-to |
| `scenarioEngine.ts` | What-if scenario definition/rollout/diff |
| `causalGraph.ts` | Noisy-OR causal Bayesian network |
| `blackboard.ts` | Blackboard pattern for probability writing |
| `physicsSurrogates.ts` | Liquefaction, dispersion, wildfire, flood surrogates |
| `domainLayers.ts` | Domain-specific layer management |
| `advancedWaterShader.ts` | Custom water shader |
| `ghostEntity.ts` / `ghostProtocol.ts` | Ghost entity rendering + protocol |
| `entropyHalo.ts` | Entropy halo visualization |
| `forkRenderer.ts` | Parallel reality fork rendering |
| `layerRenderer.ts` | Generic layer rendering abstraction |
| `navigation.ts` | Navigation utilities |
| `oracleChains.ts` | Oracle chain visualization |
| `idwInterpolation.ts` | IDW interpolation algorithm |
| `tectonic.ts` | Tectonic plate data |
| `weather.ts` | Weather data |
| `trajectoryPredictor.ts` | Trajectory prediction |
| `toolResultParser.ts` | Tool result parsing |
| `ucsSatelliteDb.ts` | UCS satellite database |
| `formatStepResult.ts` | Step result formatting |
| `sensorStyles.ts` | GLSL sensor looks (CRT · NVG · FLIR · Noir · Snow) via `PostProcessStage` |
| `photorealisticGlobe.ts` | Google Photorealistic 3D Tiles (Cesium Ion asset 2275207) |
| `cinematicCamera.ts` | Tick-based camera engine (orbit/pan/tilt/rotate, route dolly) |
| `tomtomTraffic.ts` | Per-vehicle street-level traffic flow (TomTom) |
| `cctvViewshed.ts` | Estimated coverage cones for public webcams |
| `launchReplay.ts` | Rocket ascent reconstruction (Launch Library 2) |
| `aircraftHangar.ts` | LOD swap: flight glyphs → 3D glTF models |
| `osrmRoute.ts` | Street-following walking route (OSRM) |
| `radioWave.ts` | Radio tuner globe wave animation |
| `detectionOverlay.ts` | Screen-space bounding boxes over live entities |

### Hooks (7 total)

| Hook | Purpose |
|---|---|
| `useChat` | Chat pipeline: SSE streaming to `/api/agent/ask`, tool calls, analytical-result auto-render |
| `useChatSelectors` | Zustand selectors for chat UI state |
| `useWebSocket` | WebSocket connection manager |
| `useCollaboration` | Real-time presence: join/heartbeat, typing, cursor position |
| `useKaggleSimulation` | Kaggle GPU simulation job lifecycle |
| `useOfflineChat` | Offline banner + local fallback when AI provider is unreachable |
| `useRealtimeVoice` | Primary voice: OpenAI Realtime → Gemini Live fallback via server bridge |

---

## Backend (`server/`)

### Runtime Modules

| Module Directory | Purpose |
|---|---|
| `analytical-models/` | 150 equation engines grounded in primary literature (7 parts, 26 domains), tool configs, workflows |
| `cognition/` | Cognitive orchestrator, System 1 / System 2, MCTS, reasoning tree, tree-of-thoughts |
| `sentinel/` | Continuous monitoring: stream processor, anomaly detector, correlation engine, alert intelligence |
| `memory/` + `memoryV2/` | Working/episodic/semantic/procedural/predictive memory, sensory buffer, Redis adapter |
| `scenarios/` | Scenario generation (single + batch), simulator engines, scenario DB |
| `sandboxV2/` | Sandbox simulation engines: FARSITE, ADCIRC, WRF, HYSPLIT, FNO surrogate |
| `world-model/` | Causal graph, ensemble predictor, physics NN, prediction validator |
| `causal/` | Causal reasoning: KG, discovery engine, entropy mixer, Python microservice (DoWhy) |
| `kgV2/` | Knowledge graph v2: entity/edge generation, graph completion, counterfactual, evolving graph |
| `multimodal/` | Satellite analyzer, seismic processor, radar interpreter, sentiment analyzer, fusion |
| `ai-router/` | Omninet 9-provider LLM router (incl. local GGUF fallback) |
| `rag/` | Retrieval-augmented generation: embeddings, memory bridge |
| `h3-engine/` | H3 indexing, spatial query, ClickHouse, TimescaleDB, stream processor |
| `observability/` | Pino logger, metrics, OpenTelemetry, Sentry |
| `middleware/` | JWT auth, rate limiter, tenant isolation, audit, validation, error handler |
| `sandboxManager.ts` / `pluginManager.ts` | Sandbox execution + plugin extensibility |
| `selfImprover.ts` / `selfImproverV2.ts` | Feedback-driven self-improvement |
| `fork/` | Parallel reality fork manager |

---

## Storage Layer

### SQLite (better-sqlite3)

Primary store for authentication, scenarios, memory traces, forks, and application state.

### Redis (ioredis)

Used for caching, session state, WebSocket pub/sub, and queueing. The server **gracefully degrades** to SQLite when Redis is unreachable (see `server/infrastructure/redis.ts`).

---

## External Integrations

| Category | Providers |
|---|---|
| LLM | Gemini, Claude, Groq, DeepSeek, OpenRouter, Bai, Ollama, HuggingFace, local LFM (GGUF) |
| Live data | OpenSky, USGS, TomTom, Landsat, FIRMS, AIS, Launch Library 2, CelesTrak, UCS |
| Realtime voice | OpenAI Realtime → Gemini Live (server-side brokering) |
| Earth observation | NASA Earthdata, Sentinel Hub, Copernicus, Planet Labs, Maxar |
| Weather & disaster | NOAA, NASA EONET, GDACS, OpenAQ, WAQI, Windy |

---

## Deployment

See [Deployment & Operations](DEPLOYMENT.md) for Docker Compose, CI/CD, environment variables, and security configuration.
