<p align="center">
  <img src="Terranoetis.png" alt="Terreanoetis" width="120" />
</p>

# Terranoetis

A real-time geospatial data visualization and AI-powered Earth intelligence platform. Combines a Cesium-based 3D globe with a comprehensive backend serving live environmental data, satellite imagery, analytical models, simulations, and AI-driven insights.

<div align="center">

[![Website](https://img.shields.io/badge/Portfolio-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://sreyassanker.vercel.app)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sreyassanker)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/sreyassanker)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_A_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/sreyassanker)

</div>

## Architecture

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph CLIENT["CLIENT (React 19 + CesiumJS)"]
        direction TB
        Pages["Pages: App / Globe / Canvas / Scenarios / Tours"]
        UI["UI Panels: Analytics, Intelligence, Satellite, Scenarios, Cockpit"]
        Render["Rendering Engine: 36 modules for weather, aviation, maritime, satellites, earthquakes, military symbology, scenarios"]
        Api["Data Layer: REST Client + WebSocket"]
        Pages --> UI
        UI --> Api
        Render --> Api
    end

    subgraph PROXY["VITE DEV PROXY"]
        Proxy["/api/* -> :3001\n/ws/* -> ws://:3001"]
    end

    subgraph SERVER["EXPRESS.JS SERVER"]
        direction TB
        Security["Security & Observability\nHelmet CSP, CORS, JWT Auth, Rate Limiter, Logger, Prometheus Metrics"]
        
        subgraph Data["Data Integration"]
            direction LR
            Fetchers["Data Fetchers\n(server/data/)"]
            Utils["Utility Modules\n(server/utils/)"]
            Fetchers --- Utils
        end

        subgraph Core["Core Services"]
            direction TB
            Analytical["Analytical Models\n150 equations in 26 domains\nContextEngine + 7-stage QC Pipeline\nSandbox: FARSITE, ADCIRC, WRF, HYSPLIT, FNO"]
            FM["Foundation Models\nPrithvi v2, CLAY, U-Net, SAM-Geo\nWeather, Agriculture, AlphaEarth\nBayFire, SpaceX, MVT Tiles"]
            Multimodal["Multimodal Perception\nSatellite Analyzer, Seismic\nRadar, Sentiment, Fusion"]
        end

        subgraph AI["AI & Cognition"]
            direction TB
            OmniNet["OmniNet LLM Router\nMulti-model orchestration"]
            CogOrch["Cognitive Orchestrator\nSystem 1 (fast) + System 2 (deep)"]
            S2["System 2 Reasoning\nHTN Decomposition\nMulti-Agent Debate\nCausal Reasoning\nCounterfactual Analysis\nHypothesis Synthesis"]
            Meta["Meta-Cognition\nSelf-Improvement\nPrompt Evolution\nExplainability (Traces, Bias, Uncertainty, Human Override)"]
            OmniNet --> CogOrch
            CogOrch --> S2
            CogOrch --> Meta
        end

        subgraph Realtime["Realtime Intelligence"]
            direction TB
            Sentinel["Sentinel Engine\nBackground monitoring\nStream Processing\nAnomaly Detection\nCorrelation Engine\nForce Posture"]
            Reflex["Reflex Engine\nAutonomic responses to\nreal-time events\nTrauma mode"]
            Monitor["Monitor Manager\nRules + Scheduled Tasks\nAmbient Event Detection"]
        end

        subgraph World["World Modeling"]
            direction TB
            Causal["Causal Knowledge Graph\nDiscovery Engine\nEntropy Mixer\nEntity & Edge Generation\nGraph Completion\nCounterfactual Graph"]
            Dream["Dream Engine\nSynthetic scenario generation\nFork simulation\nCausal KG refinement"]
            Fork["Fork Manager\nDivergent what-if\nsimulation threads"]
            Sim["Scenario Simulator\nEnsemble Predictor\nPhysics NN"]
        end
    end

    subgraph STORAGE["PERSISTENCE & CACHING"]
        direction TB
        SQLite["SQLite\nAuth, Scenarios, Forks\nMemory Traces, Sentinel\nWatch Zones, Evaluations"]
        Redis["Redis\nCache, PubSub\nSession, Queue"]
    end

    subgraph COMMS["REAL-TIME COMMUNICATION"]
        Ws["WebSocket Server\nClient channels (ws:<userId>)\nBroadcast (ws:all)\nFork channels (fork:<id>)\nHeartbeat 30s"]
        PubSub["PubSub Event Bus\nsentinel:raw -> enriched -> alerts\nseismic | weather | ais | adsb\nproactive, fork, sse channels"]
    end

    CLIENT -->|HTTP| Proxy
    CLIENT -->|WebSocket| Ws
    Proxy --> Security
    Security --> Data
    Data --> Core
    Security --> AI
    AI --> Core
    Core --> World
    Data --> Realtime
    Realtime --> COMMS
    World --> STORAGE
    Core --> STORAGE
    COMMS --> CLIENT
    COMMS --> SERVER
    AI --> Realtime
    Realtime --> Ws
    Ws --> PubSub
```

**Request Flow:**

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart LR
    Q["User Query"] --> IR["IntentRouter\n(agent.ts)"]
    IR -->|"embedding + cosine similarity"| CO["CognitiveOrchestrator"]
    CO -->|"confidence >= 0.92"| S1["System 1\nFast pattern match"]
    CO -->|"0.70 <= conf < 0.92"| S2V["System 2\nVerify (10s timeout)"]
    CO -->|"conf < 0.70"| S2D["System 2\nDeep reasoning"]
    S2D --> HTN["HTN Decomposition"]
    HTN --> MAD["Multi-Agent Debate\n4 agent personas"]
    MAD --> CR["Causal Reasoning"]
    CR --> CA["Counterfactual Analysis"]
    CA --> HG["Hypothesis Generation"]
    HG --> SC["Synthesis + Critic"]
    S1 --> TE["Tool Execution"]
    S2V --> TE
    SC --> TE
    TE -->|"API calls"| DF["Data Fetchers\n30+ sources"]
    TE -->|"Equations"| AE["Analytical Engine\n150 models"]
    TE -->|"Sandbox"| SB["Python / Node / Bash"]
    TE -->|"Foundation"| FME["Prithvi / CLAY / U-Net\nSAM-Geo / Weather"]
    TE --> RP["Response Processing"]
    RP -->|"Cesium globe"| CG["3D Render"]
    RP -->|"Panels"| UP["UI Update"]
    RP -->|"Memory"| MS["Memory Store"]
```

**Background Processes:**

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

### Frontend (`src/`)

- **Framework:** React 19 with TypeScript, built with Vite 7
- **3D Rendering:** CesiumJS 1.140 (WebGL, Cesium World Terrain)
- **Styling:** Tailwind CSS 3 with class-variance-authority, dark mode by default, Inter + JetBrains Mono typefaces
- **Routing:** React Router
- **State Management:** React context (AuthContext) + custom hooks + WebSocket store

**Routing (from `App.tsx`):**

| Route | View | Description |
|---|---|---|
| `/fullworld` | Globe | Main Cesium globe viewport |
| `/cockpit` | Dashboard | Mosaic layout: CognitiveDashboard, MemoryExplorer, SettingsPanel, ToolWorkbench |
| `/scenario` | Scenarios | Scenario gallery and editor |
| `/login` | Login | Authentication page |

**Core components:**

| Component | Lines | Description |
|---|---|---|
| **Topbar** | 270 | Dark glass toolbar: clock, branding, status indicators (connection/memory/entities), theme toggle, auth, hatch animation |
| **Sidebar** | 455 | Collapsible left panel with 9 layer groups (Natural Hazards, Infrastructure, Environment, Flights, AIS, Satellites, Military, Tectonic, Custom) |
| **SearchBox** | 225 | Geocoding search with globe fly-to, suggestion dropdown |
| **ModularModal** | 472 | Generic modal: title, body, footer, accent color, z-index |
| **Tile3DLayer** | 273 | Cesium 3D Tiles: tileset creation, style JSON, bounding sphere padding, SSE |
| **CommandPalette** | — | Cmd+K palette: search layers/locations/actions, toggle/fly-to/open intel |
| **PerformanceMonitor** | 250 | Real-time FPS/entities/primitives/memory/JS heap, toggle Ctrl+Shift+P |
| **FlightTravelView** | 1250 | Flight deck HUD: compass, alt/heading tapes, horizon, pitch ladder, 8-dir look, mach |
| **IssTravelView** | 370 | ISS orbital HUD: nadir/horizon compass, pitch tape, Earth-viewing mode |
| **IssLivePanel** | — | ISS camera iframe + position stats (lat/lon/alt/speed) |
| **IntelligencePanel** | 1700 | 8-tab intel: Market, Energy, Geopolitical, Correlation, Sentiment, Heatmap, Analysis, Force Posture |
| **ToolDialog** | 2500 | Analysis tool execution: study area, params, grid, execution, results, export |
| **DigitalTwinPanel** | — | Recharts charts (Area/Bar/Pie/Line), stat cards, recommendations |
| **CameraControls** | — | Zoom slider + log-scale height + fly-to-target |
| **ForkPanel** | — | Parallel realities: pause/resume/terminate, divergence score |
| **ErrorBoundary** | — | React class-based, optional label + reset |
| **LoginModal** | — | Auth token check, manual login, listens for `auth:required` event |
| **CesiumContext.tsx** | — | React context providing Cesium.Viewer instance |
| **useCesium** | — | Hook returning CesiumContext value with optional lazy init |

**Component subdirectories:**

`src/components/chat/` — `AdvancedChatViews.tsx` (850L): PlanCard, SubAgentActivity, InlineTable/Chart/Slider, ToolApproval, ModelTierSelector, TraceExpander

`src/components/collaboration/` — `PresenceComponents.tsx`: PresenceIndicator (avatar stack + viewer/typing count), RemoteCursor (position marker over the message input)

`src/components/cockpit/`:
- `CognitiveDashboard.tsx` (860L) — AnimatedBrain SVG, sparklines, system metrics
- `MemoryExplorer.tsx` (530L) — SVG Knowledge Graph (force-directed)
- `SettingsPanel.tsx` (600L) — 4 tabs: Cognitive (S1/S2 bias), Alerts, Providers, Privacy
- `ToolWorkbench.tsx` (1570L) — Physics causal chain builder, IDW risk surface, Noisy-OR CBN, physics surrogates

`src/components/scenarios/` (12 files):
- `types.ts` — Point3D, ShapeData (11 types), Scenario, ScenarioSummary, SCENARIO_TYPE_LABELS/COLORS
- `CinematicDirector.tsx` (643L) — Camera path animation for disaster fly-throughs
- `EarthquakeVisualizer.tsx` (206L) — MMI polygons, P/S/Rayleigh/Love wavefront rings
- `hazardRenderers.ts` (188L) — Renders 11 shape types on Cesium (polygon, cylinder, corridor, ellipse, ring, flood_surface, wavefront, intensity/damage/liquefaction zones)
- `ScenarioEditor.tsx` (568L) — Parameter forms for 7 disaster types; ships real Cesium terrain for landslide/flood/volcano runs and ash-transport knobs (particle diameter, diffusivity, wind shear)
- `ScenarioGallery.tsx` (147L) — Sortable/filterable grid, search
- `AddScenarioModal.tsx`, `ScenarioGraph.tsx`, `ScenarioPanel.tsx`, `ScenarioTimeline.tsx`, `ScenarioWizard.tsx`, `ScenarioThumbnail.tsx`

> **Material fix (Cesium):** every scenario visualizer, `navigation.ts`, `weather.ts`, and `kaggle/shared.ts` now wrap `CallbackProperty` in `Cesium.ColorMaterialProperty` — raw `CallbackProperty` lacks `getType()`, which previously crashed `MaterialProperty.getValue` with `"materialProperty.getType is not a function"` during polygon/polyline rendering.

Scenario types and colors:

| Key | Label | Color |
|---|---|---|
| `earthquake_swarm` | Earthquake | `#ef4444` |
| `hurricane_landfall` | Hurricane | `#f59e0b` |
| `wildfire_spread` | Wildfire | `#ff6b35` |
| `volcanic_eruption` | Volcanic | `#d946ef` |
| `flood_inundation` | Flood | `#3b82f6` |
| `tsunami_wave` | Tsunami | `#06b6d4` |
| `landslide` | Landslide | `#78350f` |
| `data_layer` | Data Layer | `#10b981` |

`src/components/prithvi/`:
- `AviationTrackerPanel.tsx` (560L) — Live OpenSky flights, search/filter
- `SatelliteTrackerPanel.tsx` (530L) — TLE catalog (CelesTrak/UCS/Starlink), track button

`src/components/explainability/` — `HumanOverrideBanner.tsx` (420L): pending override approval/rejection

`src/components/ui/` — 18 Radix-based primitives: Button, Checkbox, Dialog, DropdownMenu, Input, Label, ScrollArea, Select, Separator, Slider, Switch, Tabs, Textarea, Tooltip, ToggleGroup, Panel, ApiVault, SatelliteImageryPanel, StudyAreaPanel, ChartComponents

**Kaggle overlays (7 files)** — each fetches `.npy` raster data and renders Cesium `SingleTileImageryProvider` with custom colormaps:

| File | Layers | Lines |
|---|---|---|
| `KaggleEarthquakeOverlay.tsx` | PGA / PGV / MMI / Sa (inferno + turbo + viridis + spectral + coolwarm schemes) | 204 |
| `KaggleFloodOverlay.tsx` | Water depth + terrain (3-mode) | 411 |
| `KaggleHurricaneOverlay.tsx` | Wind speed + surge + rainfall | 317 |
| `KaggleLandslideOverlay.tsx` | Debris depth + velocity + runout | 304 |
| `KaggleTsunamiOverlay.tsx` | Wave height + bathymetry | 203 |
| `KaggleVolcanoOverlay.tsx` | Ash deposit + lava thickness | 304 |
| `KaggleWildfireOverlay.tsx` | Fire intensity + fire state | 205 |

**Kaggle GPU simulation kernels (`kaggle-kernels/`, 7 sims)** — each is a self-contained Python runnable on Kaggle CPU/GPU, orchestrated by `server/kaggle/simRunner.ts` and pushed to the 3D globe via the overlays above:

| Kernel | Physics | Notes |
|---|---|---|
| `earthquake-sim/main.py` | 3D elastic wave equation (leapfrog) + NGA-West2 GMPE → PGA/PGV/Sa/MMI ShakeMap | Upgraded from 2D to full 3D displacement formulation (ux, uy, uz) |
| `tsunami-sim/main.py` | Finite-volume shallow-water equations (MUSCL + minmod + HLL fluxes) via `swe_solver.py` | Real GEBCO 2020 bathymetry sampled server-side (`server/kaggle/bathymetry.ts`); synthetic bowl is only the fallback |
| `volcano-sim/main.py` | Conservative Rusanov lava shallow-water solver + buoyant Morton-Taylor plume + ash advection-diffusion-settling | Real terrain required (no synthetic cone); Enthalpy-porosity solidification, Arrhenius viscosity |
| `landslide-sim/main.py` | Depth-averaged debris flow on real Cesium terrain | — |
| `flood-sim/main.py` | Local-inertial SWE + real terrain + ESA WorldCover roughness | — |
| `hurricane-sim/main.py` | Parametric wind field + surge + rainfall | — |
| `fire-sim/main.py` | Rothermel fire spread + terrain/wind effects | — |

All kernels ship a `_json_safe` conversion helper so NumPy 2.x scalar types serialize cleanly to JSON on Kaggle.

**Rendering engine (`src/rendering/`, 33 files):**

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
| `studyArea.ts` | GeoJSON upload/draw/export/fly-to; `getStudyAreaOuterRings` for point-in-polygon sweep filtering |
| `scenarioEngine.ts` | What-if scenario definition/rollout/diff |
| `causalGraph.ts` | Noisy-OR causal Bayesian network |
| `blackboard.ts` | Blackboard pattern for probability writing |
| `physicsSurrogates.ts` | Physics surrogates: liquefaction, dispersion, wildfire, flood |
| `domainLayers.ts` | Domain-specific layer management |
| `advancedWaterShader.ts` | Custom water shader |
| `GhostEntity.ts` / `ghostProtocol.ts` | Ghost entity rendering + protocol |
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
| `shpjs.d.ts` | Shapefile type declarations |

**Hooks (15 total):**

| Hook | Storage | Purpose |
|---|---|---|
| `useSettings` | LocalStorage | User settings persistence |
| `useTheme` | LocalStorage | Dark/light theme toggle |
| `useAuth` | SessionStorage | Auth state + token |
| `useWebSocket` | — | Socket.IO connection manager |
| `useMapConfig` | React state | Map configuration from server |
| `useUserPreferences` | React state | User preferences CRUD |
| `useUserPreferencesPanel` | React state | Panel-specific settings |
| `useNotifications` | React state | Alert/notification system |
| `useSavedMap` | React state | Saved maps CRUD |
| `useLayerToggle` | React state | Layer visibility toggles |
| `useSession` | React state | Session management |
| `useLocalStorage` | LocalStorage | Generic typed storage |
| `useUser` | React state | User data fetching |
| `useApi` | — | Generic API fetcher |
| `useCollaboration` | WebSocket | Real-time presence: join/heartbeat, typing, cursor position per session |

### Backend (`server/`)

- **Runtime:** Node.js with Express.js 4, TypeScript via tsx
- **Database:** SQLite (better-sqlite3) with Redis (ioredis) for caching
- **Real-time:** WebSocket server (ws) for live data streaming
- **Authentication:** JWT-based auth with role-based access control
- **Observability:** Pino logging, Prometheus metrics, OpenTelemetry tracing
- **Security:** Helmet CSP, CORS, rate limiting, SSRF guard, input validation

**Server modules (62 entries):**

| Module | Purpose |
|--------|---------|
| `server/index.ts` | Main Express application entry point (~11000 lines) with route registration, middleware, agent system, AI pipeline, and all API integrations |
| `server/agent.ts` | Cognitive agent system with command parsing, intent routing, tool registry, and LLM orchestration |
| `server/analytical-models/` | 150 scientific equation engines with workflow runners, context engine, and REST API |
| `server/cognition/` | Cognitive architecture: System 1 (fast), System 2 (slow), tree-of-thoughts, MCTS engine, reasoning tree, execution orchestrator |
| `server/sentinel/` | Ambient intelligence engine: stream processor, anomaly detector, correlation engine, force posture analysis, road traffic detector, proactive insights |
| `server/foundation-models/` | Earth observation AI models: Prithvi v2, IBM CLAY, U-Net segmenter, SAM-Geo, agriculture monitor, weather forecaster, AlphaEarth, SpaceX API, bayesian fire detector, MVT tile server |
| `server/multimodal/` | Multimodal perception: satellite analyzer, seismic processor, radar interpreter, sentiment analyzer, multimodal fusion |
| `server/scenarios/` | Disaster scenario generation, batch generation, enhanced BBOX-based generation, geographic validation, simulation, export (GeoJSON/CZML/NetCDF), database |
| `server/simulation/` | Physics simulation bridge for real-world data integration |
| `server/world-model/` | World modeling: causal graph, ensemble predictor, physics neural network, prediction validator, scenario simulator |
| `server/causal/` | Causal reasoning: knowledge graph, discovery engine, entropy mixer, Python microservice |
| `server/kg-v2/` | Knowledge graph v2: entity generation, edge generation, graph completion, counterfactual graph, evolving graph |
| `server/memory/` | Memory systems: planetary memory system, Redis adapter |
| `server/memory-v2/` | Memory v2: working memory, episodic memory, semantic memory, procedural memory, predictive memory, sensory buffer |
| `server/tools-v2/` | Dynamic tool system: generator, composer, discovery, self-healing executor, repair |
| `server/self-evolution/` | Self-improvement: code writer, test runner, git integration, intent discovery, bandit router, performance monitor |
| `server/meta-cognition/` | Meta-cognition: architecture proposals, prompt evolution, intent discovery, performance analysis, feedback learning, self-report |
| `server/explainability/` | AI explainability: reasoning visualizer, evidence chain, uncertainty quantification, bias auditor, human override |
| `server/ai-router/` | AI model router (OmniNet) for multi-model LLM orchestration |
| `server/reflex/` | Reflex engine for autonomous reactive behaviors |
| `server/fork/` | Fork management: create divergent AI reasoning branches, compare and merge |
| `server/maritime/` | AIS vessel tracking with real-time WebSocket streaming |
| `server/military/` | OSINT bridge for military intelligence data |
| `server/digitalTwin/` | Digital twin analysis, data fetching, orchestration |
| `server/dream/` | Dream engine for AI-generated exploratory simulations |
| `server/h3-engine/` | H3 hexagonal spatial indexing with spatial query engine, ClickHouse and TimescaleDB integrations |
| `server/grid/` | NetCDF reader for gridded scientific data |
| `server/db/` | SQLite database setup, schema, reasoning traces |
| `server/data/` | Data fetchers for climate, ocean, glacier, permafrost, soil moisture, satellite thermal, volcanoes, and more |
| `server/routes/` | Route handlers: foundation models, self-evolution, vault, pulse dashboard |
| `server/middleware/` | Auth (JWT), rate limiting, tenant isolation, audit logging, validation, error handler |
| `server/observability/` | Logging (Pino), metrics (Prometheus), error classes, OpenTelemetry |
| `server/utils/` | Utility modules (29 files): FIRMS, EONET, ISS, MGRS, NDBC, OpenAQ, shake maps, SPC, VAAC, space debris, SSRF guard, GeoJSON, web transport, and more |
| `server/queue/` | Simple task queue for background processing |
| `server/infrastructure/` | Redis infrastructure setup |
| `server/plugins/` | Plugin system with example plugin |
| `server/sandbox-v2/` | Sandbox simulation engines: FARSITE (wildfire), ADCIRC (tsunami), WRF (atmosphere), HYSPLIT (ash dispersion), FNO surrogate (fast neural weather prediction) |
| `server/embedding.ts` | Text embedding engine for semantic search |
| `server/orchestrator.ts` | Agent orchestrator for multi-agent coordination |
| `server/pubsub.ts` | Publish-subscribe event bus |
| `server/resilience.ts` | Circuit breaker and retry mechanisms |
| `server/websocket.ts` | WebSocket server for real-time bidirectional communication |
| `server/selfImprover.ts` | Self-improvement engine with feedback management and analytics |
| `server/selfImprover-v2.ts` | Improved self-improvement architecture |
| `server/pluginManager.ts` | Plugin manager for extensibility |
| `server/sandboxManager.ts` | Sandbox execution manager |
| `server/mcp.ts` | Model Context Protocol integration |
| `server/costOptimizer.ts` | Model routing, cost tracking, enhanced caching (Gemini 2.5 Flash/Pro/Flash-Lite tiers) |
| `server/kaggle/bathymetry.ts` | GEBCO 2020 seafloor sampler (OpenTopoData) + base64 grid compaction for tsunami runs |

## API Endpoints

The server exposes hundreds of API endpoints across the following categories:

- **Authentication:** `/api/auth/login`, `/api/auth/dev-login`
- **Seismic:** `/api/earthquakes`, `/api/earthquakes/significant`, `/api/tectonic`, `/api/shakemap/*`
- **Weather:** `/api/weather/open-meteo`, `/api/weather/alerts`, `/api/weather/nhc`, `/api/weather/flood`, `/api/weather/marine`, `/api/weather/ensemble`, `/api/weather/seasonal`, `/api/weather/historical`, `/api/weather/air-quality`, `/api/weather/gfs`, `/api/weather/drought`, `/api/weather/climate-indices`, `/api/weather/ibtracs`, `/api/radar/rainviewer`, `/api/climate/power`, `/api/climate/anomalies`, `/api/climate/co2`, `/api/climate/sea-ice`
- **Hazards:** `/api/eonet`, `/api/firms`, `/api/gdacs/alerts`, `/api/vaac/*`, `/api/volcanoes`, `/api/lightning`
- **Aviation:** `/api/flights`, `/api/flights/all`, `/api/flights/military`, `/api/adsb-lol`, `/api/airlabs`, `/api/openflights`, `/api/airspaces`
- **Maritime:** `/api/ais`, `/api/ais/nearby`, `/api/submarine-cables`
- **Space:** `/api/satellites/tle`, `/api/space-debris`, `/api/space-weather/kp`, `/api/space-weather/donki`, `/api/nasa-dsn`, `/api/aurora`, `/api/iss`, `/api/spacex/launches`, `/api/spacex/starlink`
- **Earth Observation:** `/api/fm/prithvi-v2/*`, `/api/fm/clay/*`, `/api/fm/unet/*`, `/api/fm/weather/*`, `/api/fm/agri/*`, `/api/fm/samgeo/*`, `/api/fm/alpha/*`, `/api/satellite/process`, `/api/tiles/*`, `/api/road-traffic/*`, `/api/bayfire/*`
- **Multimodal:** `/api/multimodal/satellite/*`, `/api/multimodal/seismic/*`, `/api/multimodal/radar/*`, `/api/multimodal/sentiment/*`, `/api/multimodal/fusion/*`
- **Simulation:** `/api/simulate/run`, `/api/simulate/templates`
- **Kaggle:** `/api/kaggle/simulate`, `/api/kaggle/simulate/:id`, `/api/kaggle/simulate/:id/stream`, `/api/kaggle/simulate/:id/cancel`, `/api/kaggle/simulate/:id/results`, `/api/kaggle/simulate/:id/grid/:name`, `/api/kaggle/simulate/:id/geotiff/:name`, `/api/kaggle/jobs`, `/api/kaggle/kernels`, `/api/kaggle/calibrate`, `/api/kaggle/landslide/quantify`
- **Scenarios:** `/api/scenarios/generate`, `/api/scenarios/generate-from-bbox`, `/api/scenarios/search`, `/api/scenarios/export/*`
- **Analytical Models:** `/api/analytical-models`, `/api/analytical-models/search`, `/api/analytical-models/:id`, `/api/analytical-models/:id/execute`
- **Fork:** `/api/fork/*`
- **Pulse:** `/api/pulse/*`
- **Vault:** `/api/vault/*`
- **AI Agent:** `/api/agent/ask` (SSE streaming or JSON), `/api/agent/analyze-vision` (multimodal), `/api/agent/analyze-data` (CSV/GeoJSON), `/api/agent/local-ask` (Ollama fallback), `/api/agent/search-all` (unified RAG), `/api/agent/pipeline` (code execution + globe commands), `/api/agent/geocode` (LLM-based location lookup)
- **Self-Evolution:** `/api/self-evolve/*`
- **Health:** `/api/health`, `/api/ready`, `/api/live`, `/api/metrics`

## Analytical Models

The platform implements **150 scientific equation engines** across **26 domains in 7 parts**, each with a peer-reviewed reference (DOI-verified), a 7-stage scientific workflow pipeline, zonal grid statistics, and PDF report export.

### Architecture

Every tool passes through a **7-stage pipeline** (`server/analytical-models/toolWorkflows.ts`):
1. **Input Validation** — range, type, physical-plausibility checks
2. **Preprocessing** — unit conversion, derived-parameter computation
3. **Computation** — the peer-reviewed equation (`engine.ts`, 10,247 lines of pure functions)
4. **Post-processing** — classification, unit normalisation
5. **Quality Control** — result sanity checks, outlier detection
6. **Uncertainty Estimation** — error propagation / empirical RMSE
7. **Interpretation** — contextual analysis + scientific recommendations

Each tool has a scientific configuration (`toolConfigs.ts`): visualization type, classification bands, uncertainty template, QC valid range, contextual analysis, preprocessing notes, and recommendations.

### Visualization Types

| Type | Count | Tools |
|------|-------|-------|
| `scalar` | 39 | Point-value results (Planck, SVP, hydrostatic, Manning, Gumbel, GPD, FvCB, allometric, Eppley, Redfield, Chapman, Stommel, TEOS-10, Osborn-Cox, PWP, Stokes, Bruun, McCowan, Richardson, Schmidt, VEI, MTT, climate sensitivity, Planck feedback, Charney-Stern, Eady, Köhler, Z-R, satellite drag, collision, Kessler, HCW, Debye, DOP, Saastamoinen, Thiem, Cooper-Jacob, Froehlich, FSPL, etc.) |
| `heatmap` | 27 | Spatial field (LST, pollutant transport, FAO-56 ET, SCS-CN, ocean heat budget, Green-Ampt, NDVI, NDWI, EVI, NDSI, NBR, FRP, sea ice, Gaussian plume, USLE, de Vries, ocean CO₂, Bigleaf, Chapman ozone, Stockdon runup, wave dispersion, stream power, SPI, TWI, Reynolds decomposition, frontogenesis) |
| `timeseries` | 26 | Time-varying (Muskingum, Omori, snowmelt, GDD, Priestley-Taylor, Hargreaves, ET₀, lake evaporation, glacier PDD, Stefan, Herron-Langway, EBM, orbital decay, Kessler, Klobuchar, Hohmann, etc.) |
| `gauge` | 13 | Dashboard-style (Richardson, GMPE, Mohr-Coulomb, CWSI, slope stability, Kp, DOP, S4, Dst, risk index, PMP, PDSI, etc.) |
| `profile` | 12 | Vertical profiles (pressure, wind, Monin-Obukhov, log wind, FvCB, Beer-Lambert, TEOS-10, Stokes, NRLMSISE, IRI, Saastamoinen, Thiem, etc.) |
| `vector` | 8 | Directional (geostrophic wind, Ekman, geostrophic current, Sverdrup, Stommel, Munk, vorticity, longshore transport) |
| `scatter` | 8 | Correlation plots (semivariogram, van Genuchten, Brooks-Corey, Wells-Coppersmith, Z-R, EAD, Doppler, etc.) |
| `contour` | 6 | Isoline maps (kriging, IDW, QGPV, Earth tides, EGM2008, geoid) |
| `spectrum` | 5 | Spectral analysis (brightness temp, Kolmogorov, Pierson-Moskowitz, JONSWAP, Rossby wave) |
| `bar` | 3 | Categorical bars (Gutenberg-Richter, Redfield, AQI) |
| `distribution` | 2 | Probabilistic (Gumbel, GPD) |
| `histogram` | 1 | Frequency distribution (Marshall-Palmer DSD) |

### 7 Parts · 26 Domains · 150 Tools

**Part I — Earth System Core** (Equations 1–50)

| Domain | Tools | Description |
|--------|-------|-------------|
| 1. Atmospheric Science | 1–8 | Split-window LST, Planck brightness temperature, SVP, hydrostatic pressure, geostrophic wind, advection-diffusion, Richardson number, Kolmogorov spectrum |
| 2. Hydrology & Oceanography | 9–18 | FAO-56 evapotranspiration, SCS curve-number runoff, Manning's, rational method, Muskingum flood routing, tide prediction, Ekman spiral, geostrophic current, ocean heat budget, Green-Ampt infiltration |
| 3. Geophysics & Seismology | 19–25 | Gutenberg-Richter, Omori aftershock, Campbell-Bozorgnia GMPE, Mohr-Coulomb, moment magnitude, Brune stress drop, Wells-Coppersmith fault scaling |
| 4. Remote Sensing & Cryosphere | 26–35 | NDVI, NDWI, NDMI, EVI, NDSI, NBR, FRP, CWSI, degree-day snowmelt, sea ice concentration |
| 5. Spatial Analysis & Extreme Events | 36–42 | Haversine distance, ordinary kriging, IDW, Gaussian plume, Gumbel distribution, GPD, Matheron semivariogram |
| 6. Soil Science & Land Surface | 43–50 | van Genuchten, Brooks-Corey, USLE/RUSLE, Q₁₀ soil respiration, de Vries thermal conductivity, Monin-Obukhov, log wind profile, Ball-Berry stomatal conductance |

**Part II — Biosphere, Agriculture & Chemistry** (Equations 51–65)

| Domain | Tools | Description |
|--------|-------|-------------|
| 7. Biosphere & Carbon Cycle | 51–57 | Monteith LUE, Beer-Lambert extinction, NEE, FvCB photosynthesis, Chave allometric biomass, Wanninkhof CO₂ uptake, Redfield ratios |
| 8. Agriculture & Crop Science | 58–63 | McMaster GDD, Priestley-Taylor ET, Hargreaves ET, FAO-56 yield-water response, Eppley phytoplankton, Bigleaf Penman-Monteith |
| 9. Atmospheric Chemistry | 64–65 | Chapman ozone equilibrium, Atkinson VOC-NOx lifetime |

**Part III — Ocean & Coastal Advanced** (Equations 66–80)

| Domain | Tools | Description |
|--------|-------|-------------|
| 10. Ocean Dynamics & Circulation | 66–73 | Sverdrup transport, Stommel western boundary, Munk viscous, Stommel box, TEOS-10 seawater, Osborn-Cox mixing, PWP mixed layer, Pierson-Moskowitz spectrum |
| 11. Coastal & Wave Mechanics | 74–80 | Stockdon wave runup, Bruun rule, McCowan breaker, CERC longshore transport, Airy dispersion, Stokes drift, JONSWAP spectrum |

**Part IV — Geomorphology, Limnology & Cryosphere** (Equations 81–95)

| Domain | Tools | Description |
|--------|-------|-------------|
| 12. Geomorphology & Mass Wasting | 81–87 | Stream power law, Hack stream profiles, Richardson fractal, infinite slope stability, Voellmy friction, SPI, TWI |
| 13. Limnology & Freshwater | 88–90 | Lake evaporation, Schmidt stability, Nash cascade unit hydrograph |
| 14. Cryosphere & Volcanology | 91–95 | Glacier PDD, Stefan permafrost, Herron-Langway firn, VEI, Morton-Taylor plume |

**Part V — Climate & Atmosphere Advanced** (Equations 96–110)

| Domain | Tools | Description |
|--------|-------|-------------|
| 15. Climate Dynamics | 96–101 | Budyko-Sellers EBM, climate sensitivity, Planck feedback, Rossby wave, Charney-Stern baroclinic, Eady growth rate |
| 16. Atmospheric Dynamics | 102–107 | QGPV, Reynolds decomposition, Ekman depth, Deardorff convective scale, Petterssen frontogenesis, vorticity equation |
| 17. Cloud Physics | 108–110 | Köhler droplet, Marshall-Palmer DSD, Z-R radar relationship |

**Part VI — Space Environment & Satellite** (Equations 111–130)

| Domain | Tools | Description |
|--------|-------|-------------|
| 18. Geodesy | 111–115 | IERS rotation, Wahr Earth tides, EGM2008, Helmert transformation, orthometric height |
| 19. Thermosphere/Ionosphere/Magnetosphere | 116–122 | NRLMSISE-00, IRI, Joule heating, S4 scintillation, magnetopause, Dst, Debye length |
| 20. Satellite Dynamics & Space Debris | 123–127 | Satellite drag, orbital decay, collision probability, Kessler syndrome, Hill-Clohessy-Wiltshire |
| 21. Solar-Terrestrial & GNSS | 128–130 | Kp index, DOP, Saastamoinen delay |

**Part VII — Advanced Engineering & Risk** (Equations 131–150)

| Domain | Tools | Description |
|--------|-------|-------------|
| 22. Groundwater & Subsurface | 131–134 | Thiem, Theis, Cooper-Jacob, Horton infiltration |
| 23. Hazard, Risk & Disaster Engineering | 135–140 | UNISDR risk index, expected annual damage, AQI breakpoints, PMP, PDSI, Froehlich dam breach |
| 24. Data Assimilation & State Estimation | 141–144 | EnKF, optimal interpolation, 4D-Var cost, Shannon entropy |
| 25. Signal Processing & Communications | 145–147 | Free-space path loss, Klobuchar ionospheric delay, Doppler shift |
| 26. Mathematical Frameworks | 148–150 | Hohmann transfer, Lagrange points, mutual information |

### Key Features

**Multi-Scene Composite (MVC):** Satellite indices (26–33) support a date-range composite mode. Single date = paper-faithful single-scene index. Date range = max-value composite (MVC, Holben 1986) across 5 cloud-free scenes — the operational standard used by MODIS 16-day and Landsat 8-day products.

**Temporal Controls:** Tools have contextual time granularity — `instant` (single date, ~37 tools), `range` (start+end date, ~21 tools including GDD, seismic catalog, satellite indices, tide), `multi-year` (start/end year, 3 tools: EBM, PMP, PDSI), and `none` (static equations, ~89 tools).

**Spatial Grid (28×28):** All 27 heatmap tools output a spatial field rasterized over the study-area bbox, with per-cell terrain, weather, and satellite data. Grid statistics (mean, median, σ, min, max, cell count) are computed automatically.

**Zonal Statistics:** The panel shows a value-distribution histogram (20 bins) colored by the heatmap ramp, plus field statistics (Mean, Std Dev, Median, cell count).

**Heatmap Rendering:** The globe surface is rendered via bilinear interpolation at 4× sub-cell resolution (112×112), with a per-pixel polygon mask for exact study-area boundary fill. Supports 8 color schemes (Default, Viridis, Turbo, Inferno, Plasma, Spectral, Cool-Warm, Grayscale, Terrain) switchable via the legend.

**Colour-Scheme Switcher:** The legend includes a Colors dropdown (same 9 schemes as Kaggle simulation overlays) that re-renders both the globe heatmap and the legend gradient bar in real-time.

**Raster Value Probe:** An optional On/Off toggle in the legend enables cursor hover over the heatmap to show the exact cell value + lat/lon (QGIS identify-tool behaviour). Off by default to keep zoom/pan fully smooth.

**Scientific PDF Report:** Downloadable A4 report (jsPDF) with: cover header, tool title, result panel, outputs table, series chart (SVG→canvas), field statistics table, value-distribution histogram, heatmap colour bar legend, data sources, contextual analysis, recommendations, methodology steps, and two-pass "Page X of N" footers. Reports match the professional batch-generator format.

**Hover Probe:** When enabled, hovering over the heatmap surface on the globe shows the exact cell value and coordinates. Throttled to ~12 Hz and skipped during camera movement to avoid zoom stutter.

**7-Stage Scientific Workflow:** Each tool runs through input validation, preprocessing, equation computation, post-processing, quality control, uncertainty estimation, and interpretation — with a full workflow log visible in the advanced panel.

**Data Sources:** Tools auto-fetch from 30+ live APIs (Open-Meteo, USGS, ERA5, NASA FIRMS, Landsat C2 L2, Sentinel Hub, NOAA NDBC, NOAA CO-OPS, GEBCO, ISRIC SoilGrids, WorldPop, MODIS, SMAP, SMOS, GPM IMERG, CHIRPS, HydroSHEDS, AVISO, CAMS, CERES, GOES, Himawari, Copernicus Marine, NSIDC, NOAA SWPC, and more) — all fetched contextually based on the tool's governing equation.

**PDF Report Export:** Each tool result can be downloaded as a professional A4 PDF. Includes: cover header with tool name and ID, result panel, secondary outputs table, series chart (SVG-rendered), field statistics, value-distribution histogram, heatmap colour bar, data provenance, contextual analysis, recommendations, methodology steps, and two-pass page numbering. The batch generator (`scripts/generateToolReports.mjs`) produces all 150 reports in a single run.

## AI Intelligence Panel

The EARTH INTELLIGENCE AI panel (`Panel.tsx` wrapper with inline UI in `src/App.tsx`) provides a conversational AI assistant for the 3D globe. Nine major improvements have been implemented:

| # | Feature | Server | Client | Description |
|---|---------|--------|--------|-------------|
| 1 | **Multimodal in main chat** | `POST /api/agent/analyze-vision` | `streamPassMultimodal()` | Images attached to chat are sent as base64 to Gemini's streaming vision API. Falls back to text-only Omninet when Gemini is unavailable. |
| 2 | **Agentic globe control with undo** | `executeAgentCommands()` in SSE output | `agentActionHistoryRef`, `undoLastAgentAction()`, `clearAllAgentActions()` | Every AI action (flyTo, toggleLayer, addPin, addHeatmap, addPolygon, addGeoJSON, addChart, addPanel) is recorded. Undo reverts the last action; Clear removes all AI entities. Undo/Clear buttons in panel header. |
| 3 | **Persistent memory across sessions** | `buildWorkingMemoryContext(recentMessages)` | Sends last 8 messages as `recentMessages` | Client passes conversation history to server; server folds it into the working memory context instead of starting from empty on each query. |
| 4 | **Proactive context-aware suggestions** | Dynamic chip generation | Chips adapt to active layers + recent discoveries | Suggestion chips (earthquake, wildfire, flight, voyage, etc.) update based on which layers are active and recent discoveries from the ambient intelligence engine. |
| 5 | **Local model fallback** | `POST /api/agent/local-ask` → Ollama | `generateLocalResponse()` | When remote AI providers are unreachable, queries route to Ollama (llama3 on `localhost:11434`). Falls back to keyword matching if Ollama is also unavailable. |
| 6 | **Real-time streaming markdown** | SSE `event: output` with chunked tokens | Blinking `▊` cursor, auto-scroll on content change | Streaming assistant responses render incrementally with a cursor indicator. Scroll tracks content growth during streaming. |
| 7 | **Multi-provider transparency** | SSE includes `modelTier` in output event | Badge displayed on each assistant message | Users see which tier handled their query (e.g., "Free tier (local routing)", "Gemini Flash", "Claude") via a small badge on each AI response. |
| 8 | **Code pipeline → 3D globe** | `__GLOBE_COMMANDS__` protocol in sandbox stdout | `data.commands` handler in pipeline SSE | Pipeline sandbox code can emit `__GLOBE_COMMANDS__::[{...}]` markers in stdout. Server extracts the JSON and sends a `globe` SSE event. Client renders pins, polygons, heatmaps, charts on Cesium. |
| 9 | **RAG over live geospatial databases** | `POST /api/agent/search-all` + tools-v2 generator | Integrated into agent tool selection | Unified `search_all` endpoint routes natural language queries across all databases (earthquakes, weather, fires, flights, vessels, satellites, volcanoes). System prompt updated with explicit Query Planning section mapping intents → tools. |

**Chat UI additions:**

- **Live Process Panel** (`src/components/chat/LiveProcessPanel.tsx`) — Claude Code-style collapsible agent trace: braille-dot spinner, rotating phase verbs, per-step status (classifying, reasoning, tool_execution, synthesis, streaming, …), progress bar and elapsed timer.
- **Rich markdown** (`RichMarkdown.tsx`) — highlighted code blocks (highlight.js), tables, blockquotes, inline code; `ai-typing-row` replaces the old bouncing-dot indicator.
- **Virtualized message list** (`VirtualizedMessageList.tsx`) with slim custom scrollbars.
- **Collaboration presence** — `useCollaboration` broadcasts join/heartbeat/typing/cursor events over the WebSocket per session; `PresenceComponents` render the avatar stack, typing count, and remote input cursor. Paired with an **offline banner** when the AI provider is unreachable (`useOfflineChat`).

## Panel System

The UI uses a dynamic z-index stacking manager. Panels can be toggled from the toolbar and bring themselves to front when activated.

**Available panels:**
- Analytics Workbench
- Intelligence Feed (Pulse)
- Satellite Tracker
- Satellite Imagery
- Land Cover Mapper
- Aviation Tracker
- Fork Manager (multiverse)
- Scenario Gallery, Editor, Viewer
- Cinematic Director
- Spatial Sketching
- Study Area
- Cognitive Dashboard
- Tool Workbench
- Memory Explorer
- Settings
- Digital Twin
- ISS Live
- API Vault
- Command Palette

## Infrastructure

### Docker Deployment

```yaml
services:
  terranoetis:     # Main application (Express + Vite)
  redis:           # Caching and pub/sub
  causal-service:  # Python causal inference microservice
```

**Dockerfile** (`Dockerfile`, multi-stage):
- **Base**: `node:20-alpine` with build deps (python3, make, g++)
- **Build**: `npm ci` → `npm run build` (tsc + vite)
- **Production**: `node:20-alpine` with `dumb-init`, `npm ci --omit=dev`
- **Healthcheck**: `curl -f http://localhost:3001/api/health`
- **Ports**: 3001 (server), 3000 (dev client)
- **Entrypoint**: `tsx server/index.ts`

### Database Schema (Prisma)

7 models in `server/DB-prisma/schema.prisma`:

| Model | Key Fields |
|---|---|
| `User` | id, username, password, role, createdAt |
| `Session` | id, userId, token, expiresAt |
| `MapConfig` | id, userId, center, zoom, layers |
| `Preferences` | id, userId, theme, settings |
| `Notification` | id, userId, type, message, read |
| `SavedMap` | id, userId, name, config |
| `LayerToggle` | id, userId, layerId, visible |

### External Dependencies

- **Cesium Ion** – 3D globe terrain and imagery tiles
- **Redis** – Caching, session store, pub/sub messaging
- **SQLite** – Application database (auth, scenarios, memory traces, reasoning)
- **Local ML weights** – downloaded to `public/models/` (see `scripts/download-models.mjs`); Vite serves a true 404 for missing files there so `transformers.js` falls back to Hugging Face instead of parsing `index.html`
- **Various APIs** – See `.env` for full list of 30+ integrated data providers

### CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) for automated testing and build.

## Security

- JWT-based authentication with role-based access control
- Helmet CSP headers with restrictive content security policy
- Rate limiting (per-IP and per-user)
- SSRF guard for outbound URL validation
- Input validation with Zod schemas
- Audit logging for sensitive operations
- Tenant isolation for multi-user scenarios
- Automatic JWT secret strength validation at startup
- Protected routes with fine-grained public/private endpoint classification

## Getting Started

### Prerequisites

- Node.js 20+
- Redis server (or Docker)
- Cesium Ion access token (free tier at https://ion.cesium.com)

### Installation

```bash
cp .env .env.local    # Edit with your API keys
npm install
```

### Development

```bash
npm run dev           # Starts client (port 3000), server (port 3001), and Redis
```

### Build

```bash
npm run build         # TypeScript compilation + Vite production build
```

### Testing

```bash
npm test              # Vitest test runner (unit + server integration)
npx playwright test   # E2E tests (Playwright): live render, land-cover mapper, material getType regression (e2e/materialFix.spec.ts)
```

### Production

```bash
docker compose up -d  # Builds and starts all services
```

## Scripts

**npm scripts (from `package.json`):**

| Script | Purpose |
|--------|---------|
| `dev` | Concurrent: server + client + redis |
| `dev:client` | Kill port 3000, start Vite dev server |
| `dev:server` | `tsx server/index.ts` on port 3001 |
| `build` | `tsc -b && vite build` |
| `lint` | `eslint .` |
| `test` | `vitest run` |

**Utility scripts:**

| Script | Purpose |
|--------|---------|
| `scripts/test_all_tools.ts` | End-to-end validation of all 150 analytical models |
| `scripts/runtime_validate.ts` | Runtime validation of tool outputs |
| `scripts/validate_all_tools.ts` | Comprehensive tool validation suite |
| `scripts/compute_ndvi.py` | Python NDVI computation helper |
| `scripts/compute_ndwi.py` | Python NDWI computation helper |

## WASM Modules

- `wasm/idw/` – Inverse Distance Weighting interpolation WebAssembly module

## Environment Variables

The `.env` file contains configuration for 30+ integrated services across categories:

- **Server:** PROXY_PORT, JWT_SECRET, CLIENT_ORIGIN
- **NASA Earthdata:** GNSS satellite orbit data
- **Satellite & Imagery:** Cesium Ion, Sentinel Hub, Copernicus, NASA FIRMS, Planet Labs, Maxar
- **Aviation:** FlightAware, AirLabs
- **Maritime:** AISStream, MarineTraffic
- **AI/LLM:** Google Gemini, Anthropic Claude, Groq, OpenRouter, Ollama
- **Weather & Disaster:** USGS, NASA EONET, GDACS, NWS, NOAA, OpenAQ, WAQI, Windy
- **Economic & Financial:** FRED, EIA, Alpha Vantage, ENTSO-E, UN Comtrade
- **Search & Scraping:** Brave Search, Exa, Firecrawl
- **Other:** Telegram, Resend, ACLED, GoldAPI, Cloudflare Radar, AbuseIPDB, AlienVault OTX
- **Foundation Models:** ECMWF CDS, E2B Sandbox

Services gracefully disable features when corresponding API keys are absent.

## License

[MIT](LICENSE)

Copyright (c) 2026 Terreanoetis
