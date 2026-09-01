# Frontend

The Terranoetis client is a **React 19 + TypeScript** single-page application built with **Vite 7**, styled with **Tailwind CSS 3**, and rendered on a **CesiumJS 1.140** WebGL globe. The UI shell (topbar, sidebar, modals) is implemented inline in `src/App.tsx` (~10,800 lines); feature surfaces are split across lazy-loaded panels.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Routing](#routing)
- [Component Architecture](#component-architecture)
- [Rendering Engine](#rendering-engine)
- [Kaggle GPU Overlays](#kaggle-gpu-overlays)
- [Hooks](#hooks)
- [State & Data](#state--data)

---

## Tech Stack

| Concern | Technology |
|---|---|
| Framework | React 19, TypeScript |
| Build | Vite 7 |
| 3D rendering | CesiumJS 1.140 (WebGL, Cesium World Terrain) |
| Styling | Tailwind CSS 3, class-variance-authority, dark mode by default |
| Routing | React Router |
| State | React context (AuthContext) + custom hooks + Zustand chat store |
| Charts | Recharts |
| Fonts | Inter + JetBrains Mono |

---

## Routing

Defined in `src/main.tsx`:

| Route | View | Description |
|---|---|---|
| `/` | App | Main Cesium globe application (14 lazy-loaded panels) |
| `/v2/globe` | GlobePage | Dedicated Cesium globe viewport |
| `/v2/canvas` | CanvasPage | Spatial canvas |
| `/v2/scenarios` | ScenariosPage | Scenario gallery and editor |
| `/v2/tours` | ToursPage | Cinematic tours |

---

## Component Architecture

### Core Panels

| Component | Lines | Description |
|---|---|---|
| CommandPalette | 322 | Cmd+K palette: search layers/locations/actions, toggle/fly-to/open intel |
| PerformanceMonitor | 149 | Real-time FPS/entities/primitives/memory/JS heap, Ctrl+Shift+P |
| FlightTravelView | 507 | Flight deck HUD: compass, alt/heading tapes, horizon, pitch ladder |
| IssTravelView | 172 | ISS orbital HUD: nadir/horizon compass, pitch tape |
| IssLivePanel | 67 | ISS camera iframe + position stats (lat/lon/alt/speed) |
| MarketIntelPanel | 1202 | 8-tab intel: Markets, Energy, Risk, Signals, Sentiment, Heatmap, Analysis, Intel |
| ToolDialog | 1040 | Analysis tool execution: study area, params, grid, execution, results, export |
| AnalyticsWorkbench | 331 | 150-tool browser: tree/flat search over equations, domains, live-source counts |
| MultiHazardPanel | 1168 | Multi-hazard causal risk chain, IDW risk surface, Noisy-OR CBN, physics surrogates |
| LaunchReplayPanel | 202 | Scrubbable rocket ascent replay (Launch Library 2) |
| RadioTunerPanel | 191 | Analog tuner over 500 geolocated radio stations, stream playback |
| DuckdbAnalyticsPanel | — | In-browser DuckDB-WASM SQL workbench over 7 live data layers |
| FirstRunCard | 137 | First-load "stage a mission" card |
| DigitalTwinPanel | 220 | Recharts charts, stat cards, recommendations |
| CameraControls | 332 | Zoom slider + log-scale height + fly-to-target |
| ForkPanel | 68 | Parallel realities: pause/resume/terminate, divergence score |
| LoginModal | 96 | Auth token check, manual login, listens for `auth:required` |

### Cockpit (`src/components/cockpit/`)

| Component | Lines | Description |
|---|---|---|
| CognitiveDashboard | 314 | AnimatedBrain SVG, sparklines, system metrics |
| MemoryExplorer | 244 | SVG knowledge graph (force-directed) |
| SettingsPanel | 220 | 4 tabs: Cognitive (S1/S2 bias), Alerts, Providers, Privacy |
| MultiHazardPanel | 1168 | Multi-hazard causal risk chain, IDW risk surface |

### Chat (`src/components/chat/`, 9 components)

`ChatPanel.tsx`, `ChatPanelContent.tsx`, `ChatMessageRow.tsx`, `ChatTabs.tsx`, `ChatHistoryPanel.tsx`, `AdvancedChatViews.tsx` (PlanCard, SubAgentActivity, InlineTable/Chart/Slider, ToolApproval, ModelTierSelector, TraceExpander), `LiveProcessPanel.tsx`, `RichMarkdown.tsx`, `VirtualizedMessageList.tsx`

### Collaboration (`src/components/collaboration/`)

- `PresenceComponents.tsx` — PresenceIndicator (avatar stack + viewer/typing count), RemoteCursor

### Explainability (`src/components/explainability/`)

- `HumanOverrideBanner.tsx` (238L) — pending override approval/rejection

### Prithvi (`src/components/prithvi/`)

| Component | Description |
|---|---|
| AviationTrackerPanel | Live OpenSky flights, search/filter |
| SatelliteTrackerPanel | TLE catalog (CelesTrak/UCS/Starlink), track button |

### Scenarios (`src/components/scenarios/`)

| Component | Description |
|---|---|
| `CinematicDirector.tsx` | Camera path animation for disaster fly-throughs |
| `EarthquakeVisualizer.tsx` | MMI polygons, P/S/Rayleigh/Love wavefront rings |
| `ScenarioEditor.tsx` | Parameter forms for 7 disaster types |
| `ScenarioGallery.tsx` | Sortable/filterable grid, search |
| `hazardRenderers.ts` | Renders 11 shape types on Cesium |
| `SpatialSketching.tsx`, `TimelineControls.tsx`, `FloodWaterSurface.tsx` | Supporting visualizers |

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

---

## Rendering Engine

`src/rendering/` contains **40 rendering modules** that transform live data into Cesium entities, surfaces, and effects.

### Data & Entity Modules

| File | Purpose |
|---|---|
| `ais.ts` | Maritime AIS vessel positions/tracks |
| `aviation.ts` | Flight tracking |
| `flights.ts` | Flight route arcs |
| `earthquakes.ts` | Earthquake markers |
| `satelliteDataSources.ts` | TLE orbit propagation & rendering |
| `satelliteImagery.ts` | GIBS/XYZ/WMS imagery layers |
| `satnogs.ts` | SatNOGS ground stations |
| `osmBuildings.ts` | OSM 3D building extrusion |
| `ucsSatelliteDb.ts` | UCS satellite database |
| `tectonic.ts` | Tectonic plate data |
| `weather.ts` | Weather data |
| `trajectoryPredictor.ts` | Trajectory prediction |
| `tomtomTraffic.ts` | Per-vehicle street-level traffic flow |
| `cctvViewshed.ts` | Webcam coverage cones |
| `launchReplay.ts` | Rocket ascent reconstruction |
| `aircraftHangar.ts` | Flight glyphs → 3D glTF models (LOD) |
| `osrmRoute.ts` | Street-following route + camera fly-through |

### Spatial & Analysis Modules

| File | Purpose |
|---|---|
| `surfaceRenderer.ts` | IDW interpolation surface rendering |
| `gisFusion.ts` | GIS data fusion for risk surfaces |
| `studyArea.ts` | GeoJSON upload/draw/export/fly-to |
| `idwInterpolation.ts` | IDW interpolation algorithm |
| `domainLayers.ts` | Domain-specific layer management |
| `physicsSurrogates.ts` | Liquefaction, dispersion, wildfire, flood surrogates |
| `layerRenderer.ts` | Generic layer rendering abstraction |
| `toolResultParser.ts` | Tool result parsing |
| `formatStepResult.ts` | Step result formatting |

### Cognition & Effects

| File | Purpose |
|---|---|
| `scenarioEngine.ts` | What-if scenario definition/rollout/diff |
| `causalGraph.ts` | Noisy-OR causal Bayesian network |
| `blackboard.ts` | Blackboard pattern for probability writing |
| `advancedWaterShader.ts` | Custom water shader |
| `ghostEntity.ts` / `ghostProtocol.ts` | Ghost entity rendering + protocol |
| `entropyHalo.ts` | Entropy halo visualization |
| `forkRenderer.ts` | Parallel reality fork rendering |
| `oracleChains.ts` | Oracle chain visualization |
| `sensorStyles.ts` | GLSL sensor looks (CRT · NVG · FLIR · Noir · Snow) |
| `photorealisticGlobe.ts` | Google Photorealistic 3D Tiles (Cesium Ion asset 2275207) |
| `cinematicCamera.ts` | Tick-based camera engine (orbit/pan/tilt/rotate, route dolly) |
| `detectionOverlay.ts` | Screen-space bounding boxes over live entities |
| `navigation.ts` | Navigation utilities |

---

## Kaggle GPU Overlays

### Shared Core (`src/components/kaggle/`)

| File | Lines | Contents |
|---|---|---|
| `KaggleScalarOverlay.tsx` | 541 | Generic scalar field renderer (raster → Cesium surface, colormap legend, animation) |
| `VolcanoEnsembleOverlay.tsx` | 310 | Volcano ensemble (lava + ash) overlay |
| `shared.ts` | 485 | Shared colormaps, color stops, config types |
| `KaggleLegend.tsx` | 113 | Legend component |
| `KaggleAnimationControls.tsx` | 116 | Animation timeline controls |

### GPU Primitives (`src/components/kaggle/gpu/`)

`ScalarSurfacePrimitive.ts`, `ArrowFieldPrimitive.ts`, `ParticleAdvector.ts`, `cesiumRuntime.ts`, `cfdColormaps.ts`, `fieldData.ts`, `terrain.ts`

### Disaster Wrappers

| File | Layers |
|---|---|
| `KaggleEarthquakeOverlay.tsx` | PGA / PGV / MMI / Sa |
| `KaggleFloodOverlay.tsx` | Water depth + terrain |
| `KaggleHurricaneOverlay.tsx` | Wind speed + surge + rainfall |
| `KaggleLandslideOverlay.tsx` | Debris depth + velocity + runout |
| `KaggleTsunamiOverlay.tsx` | Wave height + bathymetry |
| `KaggleVolcanoOverlay.tsx` | Ash deposit + lava thickness |
| `KaggleWildfireOverlay.tsx` | Fire intensity + fire state |

---

## Hooks

| Hook | Purpose |
|---|---|
| `useChat` | Chat pipeline: SSE streaming, tool calls, analytical-result auto-render |
| `useChatSelectors` | Zustand selectors for chat UI state |
| `useWebSocket` | WebSocket connection manager |
| `useCollaboration` | Real-time presence: join/heartbeat, typing, cursor position |
| `useKaggleSimulation` | Kaggle GPU simulation job lifecycle |
| `useOfflineChat` | Offline banner + local fallback |
| `useRealtimeVoice` | Primary voice: OpenAI Realtime → Gemini Live fallback via server bridge |

---

## State & Data

| Store | Purpose |
|---|---|
| `AuthContext` | Authentication state, token refresh |
| `chatStore` (Zustand) | Chat messages, UI state |
| `useChatSelectors` | Derived selectors |
| `src/data/` | Analytical models catalog, land cover classes |
| `src/lib/` | API client, chat store, DuckDB analytics, land-cover pipeline, PDF report, formatting |
