# Tool Workbench — Complete Architecture

## Overview

The Tool Workbench is a **no-code geospatial intelligence pipeline builder** that chains together 12 tools across 6 domains, executes them sequentially against a user-defined study area (bounding box on the CesiumJS globe), propagates evidence through a Noisy-OR Causal Bayesian Network (CBN), runs physics surrogates inline at each step, and renders a final fused IDW (Inverse Distance Weighting) risk surface on the 3D globe.

---

## High-Level Data Flow

```
User draws Study Area (bbox)
        │
        ▼
┌─────────────────────────┐
│  ToolWorkbench auto-     │
│  populates chain with    │
│  12 tools in topo order  │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  executeChain() runs     │
│  each tool sequentially  │──────────────────────────┐
│  (real API or /execute)  │                          │
└──────────┬──────────────┘                           │
           │                                          │
    ┌──────┴──────┐                                   │
    │ Per step:   │                                   │
    │ 1. Fetch data│                                 │
    │ 2. Extract   │                                 │
    │    points →  │                                 │
    │    allPoints │                                 │
    │ 3. Extract   │                                 │
    │    evidence  │                                 │
    │ 4. Run       │                                 │
    │    physics   │                                 │
    │    surrogate │                                 │
    │ 5. CBN       │                                 │
    │    propagate │                                 │
    │ 6. Pipe to   │                                 │
    │    next step │                                 │
    └──────┬──────┘                                   │
           │                                          │
           ▼ (after all steps)                        │
┌─────────────────────────┐                           │
│  Generate synthetic     │                           │
│  risk points at bbox    │                           │
│  centroid/edges/corners │                           │
└──────────┬──────────────┘                           │
           │                                          │
           ▼                                          │
┌─────────────────────────┐                           │
│  onSurfaceData('fused', │                           │
│    fusedJson)           │                           │
└──────────┬──────────────┘                           │
           │                                          │
           ▼                                          │
┌─────────────────────────┐                           │
│  App.tsx handleSurface  │                           │
│  Data → extractPoints   │                           │
│  FromResult('fused', ..)│                           │
└──────────┬──────────────┘                           │
           │                                          │
           ▼                                          │
┌─────────────────────────┐                           │
│  interpolateIDW()       │                           │
│  (KD-tree accelerated)  │                           │
└──────────┬──────────────┘                           │
           │                                          │
           ▼                                          │
┌─────────────────────────┐                           │
│  renderGridToCanvas()   │                           │
│  → CesiumJS imagery     │                           │
│    layer on globe       │                           │
└─────────────────────────┘                           │
```

---

## Step-by-Step Execution Flow

### Phase 1: Initialization

1. **Study Area drawn** → User draws a bbox on the globe via the Crosshair tool
2. **bbox computed** → `computeStudyAreaBbox()` returns `{ latMin, latMax, lonMin, lonMax }`
3. **Chain auto-populated** → When `autoMode=true`, the ToolWorkbench fills 12 tools in causal topological order:

| Order | Tool | Category | API Source |
|-------|------|----------|------------|
| 1 | Earthquakes | seismic | USGS GeoJSON (`/api/earthquakes`) |
| 2 | Seismic Events | seismic | USGS GeoJSON (`/api/earthquakes`) |
| 3 | Weather Forecast | weather | Open-Meteo (`/api/weather/open-meteo`) |
| 4 | Storms | weather | NHC (`/api/weather/nhc`) |
| 5 | FIRMS Fires | hazards | NASA FIRMS (`/api/firms`) |
| 6 | Wildfires | hazards | NASA EONET (`/api/eonet`) |
| 7 | Floods | hazards | NASA EONET (`/api/eonet`) |
| 8 | Radar Fetch | multimodal | NEXRAD (`/api/weather/alerts`) |
| 9 | Satellite Analyze | multimodal | `/api/tools/execute` |
| 10 | Sentiment Analyze | multimodal | `/api/tools/execute` |
| 11 | Predict | ml | `/api/tools/execute` |
| 12 | Sandbox Python | compute | `/api/tools/execute` |

Each tool's params are auto-filled with the bbox centroid and bounds.

### Phase 2: Chain Execution (`executeChain()`)

For each step `i` in the chain:

```
Step 1: Parse params from JSON
Step 2: Inject cumulative evidence from upstream tools via getToolIO()
Step 3: Fetch data
         - Direct API: GET /api/earthquakes?minLat=...&maxLat=...
         - Indirect: POST /api/tools/execute { toolId, params }
Step 4: Extract real spatial points → push into allPoints[]
         - GeoJSON features: extract lat/lon/value from geometry.coordinates + properties
         - Single-point results: extract lat/lon from latitude/longitude fields
Step 5: Format result for display (formatStepResult)
Step 6: Extract evidence (extractEvidence) → update cumulativeEvidence
Step 7: Run physics surrogate for this tool:
         - Earthquakes → Seed-Idriss Liquefaction (FS, CSR/CRR, P(liq))
         - Weather → Gaussian Plume Dispersion (stability class, concentration)
         - Wildfires → Rothermel FBP (ROS m/min, intensity kW/m)
         - Floods → Manning Kinematic Wave (peak discharge, Froude number)
Step 8: CBN propagation:
         - computeCausalProbabilities(cumulativeEvidence, location-aware, centroid)
         - computeFullCausalState(cumulativeEvidence, centroid)
         - writeCausalProbs() → SharedArrayBuffer blackboard
Step 9: Pipe data to next step via getMapping() edge weights
```

### Phase 3: Surface Rendering

After all steps complete:

1. **Real points accumulated** → `allPoints[]` contains every spatial point from every API response
2. **Synthetic risk points generated** (only when `compositeRisk > 0`):
   - Centroid: `value = compositeRisk` (full weight)
   - 4 edges: `value = compositeRisk × 0.6`
   - 4 corners: `value = compositeRisk × 0.4`
3. **Fused JSON constructed** with `_surfaceMode: 'fused'` marker
4. **`onSurfaceData('fused', fusedJson)` called once**
5. **App.tsx `handleSurfaceData`** receives it:
   - `extractPointsFromResult('fused', json)` → detects `_surfaceMode`, calls `extractFusedPoints()`
   - Returns all pre-accumulated `InterpPoint[]`
6. **IDW interpolation**:
   - `interpolateIDW(points, bbox, width, height, power=2, neighbors=12)`
   - KD-tree accelerated nearest-neighbor search
   - Variance estimation for confidence overlay
7. **Canvas rendering**:
   - `renderGridToCanvas(grid, colorStops)` → blue (low risk) → green → yellow → red (high risk)
8. **CesiumJS imagery layer**:
   - `showInterpSurface(viewer, grid, colors, opacity=0.65, showConfidence=true)`
   - Creates `SingleTileImageryProvider` draped over the study area
   - Optional confidence overlay (green = high confidence, gray = low)

---

## Scientific Models

### Noisy-OR Causal Bayesian Network (CBN)

**File:** `src/rendering/causalGraph.ts`

The CBN has 12 nodes and 9 directed edges. Each node represents a hazard domain.

**Noisy-OR formula:**
```
P(Y=1) = 1 - Π_i (1 - q_i × P(X_i=1))
```
where `q_i` is the causal strength (leak probability) of parent `i` on child `Y`.

**Spatial variation via Gaussian Process kernel:**
```
q_i(lat, lon) = q_base × exp(-d² / (2 × ℓ²))
```
where `d` is distance from the reference location and `ℓ` is the correlation length scale (default 500km).

**Belief propagation** runs in topological order, updating each node's probability once all parents are processed.

**Information gain:**
```
H = -Σ pᵢ log₂(pᵢ)    (Shannon entropy)
ΔH = H(prior) - H(posterior)   (information gain in bits)
```

### Physics Surrogates

**File:** `src/rendering/physicsSurrogates.ts`

| Model | Formula | Reference |
|-------|---------|-----------|
| **Seed-Idriss Liquefaction** | CSR = 0.65 × (a_max/g) × (σ_v / σ'_v) × r_d; CRR from SPT N-value; FS = CRR/CSR | NCEER 1997, Seed & Idriss 1971 |
| **Gaussian Plume Dispersion** | C(x,y,z) = Q/(2πuσ_yσ_z) × exp(-y²/2σ_y²) × [exp(-(z-H)²/2σ_z²) + exp(-(z+H)²/2σ_z²)] | Pasquill-Gifford (1968), Martin 1976 |
| **Rothermel Wildfire Spread** | ROS = I_R × ξ(1 + φ_w + φ_s) / (ρ_b × ε × Q_ig) | Rothermel 1972, Canadian FBP |
| **Manning Kinematic Wave** | v = (1/n) × R^(2/3) × S^(1/2); Q = v × A; Fr = v / √(g × D) | Manning 1889, kinematic wave approx. |

### IDW Interpolation

**File:** `src/rendering/idwInterpolation.ts`

```
z(x₀) = Σᵢ wᵢ × z(xᵢ) / Σᵢ wᵢ
wᵢ = 1 / d(x₀, xᵢ)^p     (p=2 default)
```

Uses a KD-tree for O(k log n) nearest-neighbor lookup instead of brute-force O(n) per grid cell.

**Variance estimation:**
```
σ²(x₀) = Σᵢ wᵢ × (z(xᵢ) - z(x₀))² / (Σᵢ wᵢ × (k-1)/k)
```

---

## Component Architecture

```
src/
├── components/cockpit/
│   ├── ToolWorkbench.tsx      # Main UI: chain builder, palette, execution, results
│   └── index.ts               # Re-exports
├── rendering/
│   ├── causalGraph.ts         # Noisy-OR CBN: 12 nodes, 9 edges, GP kernel, belief propagation
│   ├── scenarioEngine.ts      # What-if scenarios using CBN
│   ├── physicsSurrogates.ts   # Seed-Idriss, Gaussian plume, Rothermel, Manning
│   ├── blackboard.ts          # SharedArrayBuffer data bus (with ArrayBuffer fallback)
│   ├── idwInterpolation.ts    # KD-tree accelerated IDW + canvas rendering
│   ├── wasmIdw.ts             # WASM wrapper (graceful JS fallback)
│   ├── surfaceRenderer.ts     # CesiumJS imagery layer management
│   ├── toolResultParser.ts    # Extract InterpPoint[] from API responses
│   └── formatStepResult.ts    # Format API responses for display
└── App.tsx                    # handleSurfaceData callback (line 1356)
```

---

## Key Data Structures

### `InterpPoint` (idwInterpolation.ts)
```typescript
interface InterpPoint { lat: number; lon: number; value: number; }
```

### `InterpGrid` (idwInterpolation.ts)
```typescript
interface InterpGrid {
  data: Float32Array;      // Interpolated values [width × height]
  variance: Float32Array;  // Uncertainty estimate per cell
  width: number; height: number;
  latMin/latMax/lonMin/lonMax: number;  // Bounding box
  valueMin/valueMax: number;            // Value range
}
```

### `CausalState` (causalGraph.ts)
```typescript
interface CausalState {
  beliefs: Record<string, { probability: number; entropy: number }>;
  topoOrder: string[];
  informationGain: number;  // bits
}
```

### `FormattedStepResult` (formatStepResult.ts)
```typescript
interface FormattedStepResult {
  status: 'success' | 'synthetic' | 'error';
  label: string;
  summary: string;
  metrics: { label: string; value: string }[];
  latencyMs: number;
  raw: string;
}
```

---

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `SharedArrayBuffer ReferenceError` | Browser without COOP/COEP headers | All SAB references guarded with `typeof SharedArrayBuffer !== 'undefined'`; falls back to `ArrayBuffer` |
| `wasm.__wbindgen_malloc` | WASM module not found | `wasmIdw.ts` catches import error, falls back to pure JS IDW |
| `beliefs[nodeId] undefined` | Evidence keys like `_composite` aren't node IDs | Guarded with `if (!beliefs[nodeId]) continue` in both `computeCausalProbabilities` and `computeFullCausalState` |
| `IDW surface not rendering` | Per-step onSurfaceData overwrites; allPoints never populated | Now accumulates all points, renders ONCE at end with fused mode |

---

## What-If Scenarios

**File:** `src/rendering/scenarioEngine.ts`

After the chain runs, the What-If tab lets users select predefined scenarios (e.g., "Major Earthquake", "Hurricane Landfall"). Each scenario:

1. Defines evidence overrides (e.g., `{ earthquakes: 0.95, floods: 0.7 }`)
2. Calls `rolloutScenario(scenario, currentProbs, location)` which:
   - Creates a copy of current CBN state
   - Applies scenario evidence overrides
   - Re-runs topological belief propagation
   - Computes deltas: `scenarioProb - baseProb` for each affected node
3. Displays cascading risk impact: base → scenario with delta in percentage points
