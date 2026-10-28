# Frontend

The Terranoetis client is a **React 19 + TypeScript** single-page application built with **Vite 7**, styled with **Tailwind CSS 3**, and rendered on a **CesiumJS 1.140** WebGL globe. “GPU” below refers to WebGL rendering primitives and shaders only — the simulation kernels the overlays visualize are NumPy/CPU code ([verified modes table](../capabilities/hazard-simulations.html#modes)).

> Verified site view: [3D globe visualization](../capabilities/globe-visualization.html). The UI shell (topbar, sidebar, modals, panels) is implemented inline in `src/App.tsx` (14,451 lines); feature surfaces are split across lazy-loaded panels and modular component trees.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Routing](#routing)
- [Component Architecture](#component-architecture)
- [Rendering Engine](#rendering-engine)
- [Simulation Overlays](#simulation-overlays)
- [Hooks](#hooks)
- [State & Data](#state--data)

---

## Tech Stack

| Concern | Technology |
|---|---|
| Framework | React 19, TypeScript |
| Build | Vite 7 |
| 3D rendering | CesiumJS 1.140 (WebGL, Cesium World Terrain) |
| Styling | Tailwind CSS 3, class-variance-authority, dark theme via CSS variables (no light mode) |
| Routing | React Router 7 (`BrowserRouter` on web, `HashRouter` in Tauri desktop) |
| State | React context (AuthContext) + custom hooks + Zustand chat and user preference stores |
| Charts | Recharts |
| Fonts | Inter + JetBrains Mono |

---

## Routing

Defined in `src/main.tsx`:

| Route | View | Description |
|---|---|---|
| `/` | `App` | Unified Cesium globe application with 11 lazy-loaded panels, command palette, and modal dialogs |

In desktop builds (`isDesktopApp`), React Router automatically switches to `HashRouter` for filesystem origin compatibility (`tauri://localhost`). Administrative tools, scenario creation, spatial querying, and tool execution are operated as in-viewport panels and dialogs within `App.tsx`.

---

## Component Architecture

### Core Panels

| Component | Lines | Description |
|---|---|---|
| `ArchaeologyDiscoveryPanel.tsx` | 2776 | Multi-spectral and elevation anomaly discovery, peer-reviewed benchmark locations |
| `CinematicDirector.tsx` | 1669 | Camera path animation and waypoint fly-throughs for disaster scenarios |
| `PluginManager.tsx` | 1468 | Plugin installer, runtime toggle, and manifest inspection |
| `LocalAiHub.tsx` | 1428 | Local GGUF model manager: download progress, resume support, `llama-server` lifecycle |
| `ApiVault.tsx` | 1383 | Secure API key vault and external provider credentials configuration |
| `MultiHazardPanel.tsx` | 1279 | Multi-hazard causal risk chain, IDW risk surface, Noisy-OR CBN, physics surrogates |
| `MarketIntelPanel.tsx` | 1202 | 8-tab intel: Markets, Energy, Risk, Signals, Sentiment, Heatmap, Analysis, Intel |
| `ToolDialog.tsx` | 1199 | Analysis tool execution: study area, params, grid, execution, results, export |
| `ScenarioEditor.tsx` | 1176 | Parameter forms for 7 disaster types with pinned geographic origins |
| `HelicopterHud.tsx` | 1142 | Rotorcraft cockpit HUD: attitude, airspeed, collective tape, rotor RPM, torque |
| `MetricsDashboard.tsx` | 1050 | Administrative runtime telemetry, heap inspection, and Prometheus metrics |
| `EvolutionHub.tsx` | 986 | Self-evolution dashboard: prompt tuning, drift evaluation, and bandit routing |
| `ChatPanel.tsx` | 912 | Primary chat interface container with SSE streaming and tool event rendering |
| `LoginModal.tsx` | 706 | Auth token check, manual login, listens for `auth:required` |
| `MemoryExplorer.tsx` | 586 | SVG knowledge graph visualizer with circular layout |
| `AdvancedChatViews.tsx` | 571 | PlanCard, SubAgentActivity, InlineTable, ToolApproval, ModelTierSelector, TraceExpander |
| `LandCoverMapperPanel.tsx` | 527 | Land cover classification mapper and Copernicus Sentinel integration |
| `FlightTravelView.tsx` | 507 | Flight deck HUD: compass, altitude/heading tapes, artificial horizon, pitch ladder |
| `CommandPalette.tsx` | 505 | Cmd+K palette: search layers, locations, actions, toggle overlays, open intel |
| `StudyAreaPanel.tsx` | 469 | Study area boundary definition: GeoJSON upload, polygon sketching, clipping |
| `SatelliteImageryPanel.tsx` | 435 | Satellite imagery selector: GIBS, Sentinel-2, Landsat, thermal overlays |
| `AnalyticsWorkbench.tsx` | 419 | 150-tool analytical engine browser: hierarchical search, live context indicators |
| `ScenarioGallery.tsx` | 371 | Filterable scenario library with thumbnail cards and launch triggers |
| `LiveProcessPanel.tsx` | 364 | Live agent cognitive pipeline state and execution steps |
| `CameraControls.tsx` | 338 | Zoom slider, log-scale height control, and camera reorientation |
| `LaunchReplayPanel.tsx` | 233 | Scrubbable rocket ascent replay via Launch Library 2 telemetry |
| `RadioTunerPanel.tsx` | 209 | Analog tuner over geolocated global radio streams |
| `IssTravelView.tsx` | 172 | ISS orbital perspective HUD: nadir/horizon compass, orbital velocity tape |
| `PerformanceMonitor.tsx` | 152 | Real-time FPS, entity count, primitive tally, memory, and JS heap (Ctrl+Shift+P) |
| `FirstRunCard.tsx` | 121 | Initial mission setup card for newly initialized sessions |
| `ForkPanel.tsx` | 304 | Parallel realities manager: pause, resume, branch, divergence score |
| `IssLivePanel.tsx` | 138 | Live ISS camera feed iframe and orbital position coordinates |

### Cockpit (`src/components/cockpit/`)

- `MultiHazardPanel.tsx` (1,279 lines) — Multi-hazard causal risk chain, IDW risk surface
- `MemoryExplorer.tsx` (586 lines) — SVG knowledge graph visualizer

### Chat (`src/components/chat/`)

11 modular components:
- `ChatPanel.tsx`, `ChatPanelContent.tsx`, `ChatMessageRow.tsx`, `ChatTabs.tsx`, `ChatHistoryPanel.tsx`
- `AdvancedChatViews.tsx` (PlanCard, SubAgentActivity, ToolApproval, ModelTierSelector, TraceExpander)
- `LiveProcessPanel.tsx`, `RichMarkdown.tsx`, `VirtualizedMessageList.tsx`, `ModelSelector.tsx`, `StudyAreaPrompt.tsx`

### Collaboration & Explainability

- `src/components/collaboration/PresenceComponents.tsx` — Avatar stack, typing indicator, remote cursors
- `src/components/explainability/HumanOverrideBanner.tsx` — Human-in-the-loop override review and approvals

### Trackers (`src/components/trackers/`)

- `AviationTrackerPanel.tsx` — Live OpenSky flights, callsign search, altitude filtering
- `SatelliteTrackerPanel.tsx` — TLE catalog (CelesTrak, UCS, Starlink), real-time propagation

---

## Rendering Engine

`src/rendering/` contains **55 rendering modules** (54 TypeScript modules and 1 type declaration) that transform live feeds and computational outputs into Cesium entities, primitives, and shaders.

### 1. Aerospace & Rotorcraft Simulation (11 modules)

| File | Purpose |
|---|---|
| `helicopterSim.ts` | 6-DOF rotorcraft flight dynamics, collective/cyclic/pedals, ground effect, autorotation |
| `apacheModel.ts` | AH-64 Apache glTF geometry generation, rotor articulation, weapon pylons, gear |
| `heliCameraRig.ts` | Camera modes: chase close, chase wide, cockpit POV, top-down, external orbit |
| `heliCockpitScreens.ts` | Glass cockpit MFD screen management and attitude direction indicator |
| `heliControls.ts` | Flight controls keyboard/gamepad binding, trim axes, collective hold |
| `heliHeadModel.ts` | Pilot head model and responsive look-at interpolation |
| `heliInstrPaint.ts` | Canvas 2D instrument cluster rendering: altimeter, airspeed, torque, VVI |
| `heliAudio.ts` | Web Audio API turbine whine, rotor blade slap, and audio stall warnings |
| `cockpitAnchors.ts` | 3D cockpit space to 2D screen coordinate projection anchors |
| `gltfBuilder.ts` | Procedural glTF 2.0 binary asset compilation for dynamic 3D models |
| `m4.ts` | 4x4 matrix transformation mathematics for articulated entities |

### 2. Live Tracking & Trajectory (12 modules)

| File | Purpose |
|---|---|
| `aviation.ts` | Live flight position tracking and military airspace integration |
| `flights.ts` | Great-circle flight route arcs and altitude-band hypsometric color ramps |
| `aircraftHangar.ts` | Level-of-detail model management for commercial and military aircraft glyphs |
| `ais.ts` | Maritime AIS vessel positioning, heading vectors, and track histories |
| `satelliteDataSources.ts` | NORAD SGP4/SDP4 TLE orbit propagation and real-time footprint rendering |
| `satnogs.ts` | SatNOGS satellite transmitter and radio frequency ground station records |
| `ucsSatelliteDb.ts` | Union of Concerned Scientists satellite database overlay and country queries |
| `trajectoryPredictor.ts` | Ballistic and orbital trajectory prediction paths |
| `launchReplay.ts` | Rocket launch ascent trajectory reconstruction from launch logs |
| `cctvViewshed.ts` | Public CCTV camera location markers, ground-projected FOV frustum viewsheds |
| `tomtomTraffic.ts` | Per-segment street-level traffic flow speeds via TomTom Flow API |
| `osrmRoute.ts` | Street-network routing polyline generation and camera fly-through |

### 3. Earth Observation & Geospatial Layers (8 modules)

| File | Purpose |
|---|---|
| `satelliteImagery.ts` | NASA GIBS, XYZ, and WMS imagery layer orchestration |
| `photorealisticGlobe.ts` | Google Photorealistic 3D Tiles integration (Cesium Ion asset 2275207) |
| `osmBuildings.ts` | OpenStreetMap 3D building extrusion via Cesium 3D Tiles |
| `domainLayers.ts` | Power grids, submarine cables, gas storage, animal migration, space debris |
| `primitiveLayers.ts` | High-performance Cesium PrimitiveCollection management |
| `tectonic.ts` | Tectonic plate boundary fault lines and velocity vectors |
| `earthquakes.ts` | Real-time USGS earthquake markers, magnitude scaling, and seismic wavefront rings |
| `weather.ts` | Storm tracks, radar precipitation sites, drought zones, climate anomaly indices |

### 4. Spatial Analysis, Surfaces & Archaeology (8 modules)

| File | Purpose |
|---|---|
| `surfaceRenderer.ts` | View-dependent resolution grid generation, canvas texture colormaps |
| `idwInterpolation.ts` | Inverse Distance Weighting interpolation with KD-tree spatial sampling |
| `studyArea.ts` | Study area boundary clipping, GeoJSON containment checks, bounding box computation |
| `gisFusion.ts` | Multi-source GIS data fusion for spatial risk indexing |
| `physicsSurrogates.ts` | Rapid surrogates for liquefaction, dispersion, wildfire, and flood |
| `archaeologyOverlay.ts` | LiDAR hillshade anomaly detection, cropmark/soilmark filters, mound extraction |
| `toolResultParser.ts` | Tool output parsing into spatial entity coordinates |
| `formatStepResult.ts` | Multi-step calculation result formatting for map display |

### 5. Causal Cognition & Scenarios (8 modules)

| File | Purpose |
|---|---|
| `scenarioEngine.ts` | What-if scenario definition, temporal rollout, and state differentiation |
| `causalGraph.ts` | Noisy-OR causal Bayesian network graph structure and inference |
| `blackboard.ts` | Shared blackboard pattern for cognitive probability distribution updates |
| `ghostEntity.ts` | Ghost entity rendering for counterfactual alternative branches |
| `ghostProtocol.ts` | State synchronization protocol for counterfactual scenarios |
| `entropyHalo.ts` | Visual entropy halo indicating state uncertainty on the globe |
| `forkRenderer.ts` | Visual branch visualization for parallel realities |
| `oracleChains.ts` | Causal chain link visualization connecting initiating triggers to outcomes |

### 6. Visual Effects, Camera & Utilities (8 modules)

| File | Purpose |
|---|---|
| `sensorStyles.ts` | PostProcessStage GLSL shaders (CRT, NVG, FLIR thermal, Noir, Snow) |
| `cinematicCamera.ts` | Camera movement engine (orbit, pan, tilt, rotate, dolly transitions) |
| `cinematicSpline.ts` | Catmull-Rom and Hermite spline camera interpolation for fly-throughs |
| `detectionOverlay.ts` | Screen-space bounding boxes and tracking reticles over live entities |
| `navigation.ts` | Spherical navigation math, safe facility routing, distance metrics |
| `layerRenderer.ts` | Dynamic layer fetching and visual rendering abstraction |
| `radioWave.ts` | Animated electromagnetic radiation ring propagation from transmitter points |
| `shpjs.d.ts` | TypeScript declarations for Shapefile parser integration |

---

## Simulation Overlays

### Shared Core (`src/components/kaggle/`)

| File | Lines | Contents |
|---|---|---|
| `KaggleScalarOverlay.tsx` | 677 | Scalar field renderer (raster to Cesium surface, colormap legend, timeline) |
| `VolcanoEnsembleOverlay.tsx` | 310 | Combined volcanic ensemble (lava flow thickness + ash dispersal) overlay |
| `shared.ts` | 505 | Colormaps, color stops, contour thresholds, and simulation configuration types |
| `KaggleLegend.tsx` | 113 | Interactive colormap scale and unit display |
| `KaggleAnimationControls.tsx` | 116 | Simulation playback controls (play, pause, step, speed) |

### GPU Primitives (`src/components/kaggle/gpu/`)

`ScalarSurfacePrimitive.ts` (492L), `ArrowFieldPrimitive.ts` (721L), `ParticleAdvector.ts` (399L), `cesiumRuntime.ts`, `cfdColormaps.ts`, `fieldData.ts`, `terrain.ts`.

### Disaster Wrappers (`src/components/`)

| File | Layers |
|---|---|
| `KaggleEarthquakeOverlay.tsx` | Peak Ground Acceleration (PGA), PGV, Instrumental MMI, Spectral Acceleration |
| `KaggleFloodOverlay.tsx` | Water depth, velocity vectors, flooded terrain surface |
| `KaggleHurricaneOverlay.tsx` | Sustained wind speed, storm surge height, precipitation rate |
| `KaggleLandslideOverlay.tsx` | Debris flow depth, velocity field, deposit runout extent |
| `KaggleTsunamiOverlay.tsx` | Wave elevation, propagation time, coastal runup |
| `KaggleVolcanoOverlay.tsx` | Lava flow thickness, tephra fallout, column height |
| `KaggleWildfireOverlay.tsx` | Fire front perimeter, rate of spread, flame length, fire intensity |

---

## Hooks

| Hook | Purpose |
|---|---|
| `useChat` | Chat pipeline: SSE streaming, function calling, automated result visualization |
| `useChatSelectors` | Selective Zustand subscribers minimizing re-renders in chat views |
| `useWebSocket` | WebSocket connection manager for live entity feeds and alert pub/sub |
| `useCollaboration` | Multi-user presence: join/leave, heartbeat, typing indicator, remote cursors |
| `useKaggleSimulation` | Simulation job lifecycle for local CPU kernels and Kaggle dispatched jobs |
| `useOfflineChat` | Offline connectivity detection and local fallback agent switching |
| `useRealtimeVoice` | Low-latency voice interaction via OpenAI Realtime with Gemini Live fallback |

---

## State & Data

| Store | Purpose |
|---|---|
| `AuthContext` | User authentication state, role permissions, token refresh lifecycle |
| `chatStore` (Zustand) | Chat messages, model configuration, study-area coordinates, tool cards |
| `userPrefStore` (Zustand) | Location preference, timezone preference (persisted in localStorage) |
| `src/data/` | Analytical models metadata catalog (150 tools), land cover class definitions |
| `src/lib/` | API client (`api.ts`), desktop helpers (`desktop.ts`), time formatting (`formatTime.ts`), PDF reports |
