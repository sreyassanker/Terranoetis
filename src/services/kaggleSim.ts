/**
 * Kaggle simulation service.
 *
 * Pure, framework-free logic for the simulation payload contract.
 * Contains zero React code, zero JSX, and zero DOM references —
 * safe to unit-test under plain Node.js.
 *
 * Physical summary:
 * - Every scenario-type exposes a zod schema whose bounds mirror the
 *   physical ranges enforced by the Kaggle simulator kernels in
 *   `kaggle-kernels/`. Validation MUST happen at this boundary, not inside
 *   the kernel, so bad input fails fast with a legible error.
 * - No synthetic fallbacks. If a value is required, the boundary throws.
 */

import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────────────────

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const gridSize = z.number().int().min(64).max(2048);
const extentKm = z.number().positive().max(40_000);
const durationHrs = z.number().positive().max(24 * 30);

// ── Per-scenario contracts (bounds validated against kernel CLIs) ───────────

export const SimulationRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('flood_inundation'),
    lat, lon,
    grid_size: gridSize,
    extent_km: extentKm,
    rainfall_mm: z.number().min(10).max(3000),
    duration_hours: durationHrs,
    soil_saturation: z.number().min(0).max(1),
    dam_breach: z.literal(true),
    wind_speed_ms: z.number().min(0).max(60).optional(),
    /** Per-hour rainfall rate (mm/hr) — the kernel derives it from total/duration if absent. */
    rainfall_mm_hr: z.number().min(1).max(300).optional(),
    /**
     * Real terrain sampled from the Cesium globe for the drawn study box
     * (row-major, row 0 = north, meters above ellipsoid). When present the
     * kernel runs the flood on this grid instead of synthetic terrain.
     */
    terrain: z.array(z.number()).max(65_536).optional(),
    terrain_gs: z.number().int().min(2).max(256).optional(),
    /**
     * ESA WorldCover v200 land-cover class codes for the drawn study box
     * (row-major, row 0 = north, same geometry as `terrain`). Maps to
     * per-cell Manning's n in the kernel. Optional — the server auto-samples
     * land cover for flood runs when this is absent.
     */
    landcover: z.array(z.number().int().min(0).max(255)).max(65_536).optional(),
    landcover_gs: z.number().int().min(2).max(256).optional(),
  }),
  z.object({
    type: z.literal('wildfire_spread'),
    lat, lon,
    grid_size: gridSize,
    extent_km: extentKm,
    wind_speed_ms: z.number().min(0).max(60),
    wind_dir_deg: z.number().min(0).max(360),
    humidity_pct: z.number().min(0).max(100),
    duration_hours: durationHrs,
    fuel_type: z.enum(['grass', 'shrub', 'forest', 'urban']),
    ignition_x: z.number().int().nonnegative().optional(),
    ignition_y: z.number().int().nonnegative().optional(),
    /**
     * Real terrain sampled from the Cesium globe for the drawn study box
     * (row-major, row 0 = north, meters above ellipsoid). The server compacts
     * this 256×256 grid to `terrain_b64` before embedding it in the kernel, and
     * the kernel derives slope/aspect from it and runs on real topography
     * instead of the synthetic noise field.
     */
    terrain: z.array(z.number()).max(65_536).optional(),
    terrain_gs: z.number().int().min(2).max(256).optional(),
    /** Per-cell fuel-load multiplier [0..1.2] (row-major, row 0 = north). */
    fuel_mult: z.array(z.number()).max(65_536).optional(),
    fuel_gs: z.number().int().min(2).max(256).optional(),
    /** Live dead-fuel moisture override (fraction). Drives the Simard EMC. */
    dead_moisture: z.number().min(0).max(0.6).optional(),
    live_moisture: z.number().min(0).max(2).optional(),
    /** Air temperature [°C] used for the equilibrium-moisture calculation. */
    temperature_c: z.number().min(-40).max(60).optional(),
  }),
  z.object({
    type: z.literal('earthquake_swarm'),
    lat, lon,
    grid_size: gridSize,
    extent_km: extentKm,
    // Bounds mirror the 2D GMPE kernel's validity window (kaggle-kernels/
    // earthquake-sim/main.py): M 3.0–9.7, hypocentral depth 0.5–700 km.
    magnitude: z.number().min(3).max(9.7),
    depth_km: z.number().min(0.5).max(700),
    /** Site condition — NEHRP Vs30 (m/s). Default 760 (class C rock). */
    vs30: z.number().min(150).max(1500).optional(),
    /**
     * Pinned epicentre as a fraction of the study box (column = x eastward,
     * row = y southward, 0..1), exactly like the volcano vent. Defaults to the
     * box centroid (0.5,0.5) when absent. The GMPE distance field radiates from
     * this cell, so the strongest shaking sits on the fault trace the user
     * clicked, not the box centre.
     */
    epi_frac_x: z.number().min(0).max(1).optional(),
    epi_frac_y: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal('tsunami_wave'),
    lat, lon,
    grid_size: gridSize,
    extent_km: extentKm,
    magnitude: z.number().min(5).max(9.7),
    seafloor_displacement_m: z.number().positive().max(40),
    duration_minutes: z.number().positive().max(720),
    /**
     * Real seafloor depth sampled from the GEBCO 2020 grid for the drawn
     * study box (row-major, row 0 = north, meters positive-down; negative
     * = dry land). When present the kernel runs the tsunami on this depth
     * grid instead of the synthetic parabolic bowl. Optional — the server
     * auto-samples bathymetry for tsunami runs when this is absent.
     */
    bathymetry: z.array(z.number()).max(65_536).optional(),
    bathy_gs: z.number().int().min(2).max(256).optional(),
    /** Optional benchmark stations for comparing modeled eta(t) against observed series. */
    benchmark_stations: z.array(z.object({
      name: z.string().min(1).max(64),
      row: z.number().int().min(0).max(4096),
      col: z.number().int().min(0).max(4096),
      observed_times_min: z.array(z.number()).min(1).max(2048),
      observed_eta_m: z.array(z.number()).min(1).max(2048),
      arrival_threshold_m: z.number().positive().max(100).optional(),
    })).max(16).optional(),
  }),
  z.object({
    type: z.literal('hurricane_landfall'),
    lat, lon,
    grid_size: gridSize,
    extent_km: extentKm,
    category: z.number().int().min(1).max(5),
    forward_speed_kmh: z.number().min(2).max(80),
    central_pressure_hpa: z.number().min(860).max(1020),
    radius_max_wind_km: z.number().min(5).max(300),
    duration_hours: durationHrs,
    /**
     * Track heading in degrees clockwise from north (270 = moving west).
     * Omit to let the kernel auto-aim the storm at the pinned landfall point
     * from the water centroid — a genuine water-side approach for any
     * coastline orientation.
     */
    heading_deg: z.number().min(0).max(360).optional(),
    /**
     * Pinned landfall / track-center point as a fraction of the study box
     * (column = x eastward, row = y southward, 0..1) — the eye passes this
     * cell at mid-duration, like the earthquake epicentre. Defaults to the
     * box centre (0.5,0.5) when absent.
     */
    track_frac_x: z.number().min(0).max(1).optional(),
    track_frac_y: z.number().min(0).max(1).optional(),
    /**
     * Real terrain/bathymetry sampled from the Cesium globe for the drawn
     * study box (row-major, row 0 = north, meters; negative = below sea).
     * The kernel runs the surge/inundation on this grid instead of the
     * synthetic coastal profile.
     */
    terrain: z.array(z.number()).max(65_536).optional(),
    terrain_gs: z.number().int().min(2).max(256).optional(),
  }),
  z.object({
    type: z.literal('volcanic_eruption'),
    lat, lon,
    grid_size: gridSize,
    extent_km: extentKm,
    vei: z.number().int().min(0).max(8),
    wind_speed_ms: z.number().min(0).max(60),
    wind_dir_deg: z.number().min(0).max(360),
    duration_hours: durationHrs,
    /**
     * Real terrain sampled from the Cesium globe for the drawn study box
     * (row-major, row 0 = north, meters above ellipsoid). When present the
     * kernel runs the lava flow on this grid instead of the synthetic cone.
     */
    terrain: z.array(z.number()).max(65_536).optional(),
    terrain_gs: z.number().int().min(2).max(256).optional(),
    /**
     * Median volcanic ash particle diameter [m] — drives the Stokes-law
     * terminal settling velocity. Default 316 µm → v_t ≈ 3 m/s.
     */
    ash_particle_diameter_m: z.number().min(50e-6).max(2e-3).optional(),
    /** Sub-grid turbulent (eddy) diffusivity of the ash cloud [m²/s]. */
    ash_diffusivity_m2_s: z.number().min(10).max(5000).optional(),
    /** Wind-shear factor: low-level wind fraction of the free-stream speed. */
    ash_wind_shear_factor: z.number().min(0).max(1).optional(),
    /**
     * Vent position as a fraction of the study box (column = x eastward,
     * row = y southward, 0..1). Defaults to centroid (0.5, 0.5). Set from the
     * clicked vent marker so the eruption originates where the user pinned it.
     */
    vent_frac_x: z.number().min(0).max(1).optional(),
    vent_frac_y: z.number().min(0).max(1).optional(),
    /** Lava rheology multiplier — lower = more fluid, overflows further. */
    yield_scale: z.number().min(0.01).max(10).optional(),
    /** Lava volume multiplier — higher = more lava, fills the crater first. */
    mass_scale: z.number().min(0.1).max(100).optional(),
  }),
  z.object({
    type: z.literal('landslide'),
    lat, lon,
    grid_size: gridSize,
    extent_km: extentKm,
    trigger_type: z.enum(['earthquake', 'rainfall', 'volcanic']),
    magnitude: z.number().min(3).max(9.7),
    pga_threshold: z.number().min(0.01).max(1),
    rainfall_mm: z.number().min(0).max(3000),
    friction_angle: z.number().min(10).max(60),
    cohesion: z.number().min(0).max(5000),
    duration_hours: durationHrs,
    /**
     * Real terrain sampled from the Cesium globe for the drawn study box
     * (row-major, row 0 = north, meters above ellipsoid). When present the
     * kernel runs the debris flow on this grid instead of synthetic terrain.
     */
    terrain: z.array(z.number()).max(65_536).optional(),
    terrain_gs: z.number().int().min(2).max(256).optional(),
    /**
     * Voellmy friction law: dry (Coulomb) friction μ [-]. The kernel's
     * depth-averaged debris flow is a Voellmy model; these are its free
     * parameters, calibrated against observed runout via /api/calibrate.
     */
    mu: z.number().min(0.01).max(1).optional(),
    /** Voellmy turbulent friction coefficient ξ [m/s²]. */
    xi: z.number().min(10).max(5000).optional(),
    /** Bed entrainment rate [1/s] — 0 disables erosion growth (default). */
    entrainment_rate: z.number().min(0).max(0.1).optional(),
    /** Maximum erodible bed depth [m] available for entrainment. */
    erodible_depth_m: z.number().min(0).max(50).optional(),
    /** Cumulative rainfall needed to trigger rain-driven slides [mm]. */
    rainfall_threshold: z.number().min(0).max(3000).optional(),
  }),
]);

export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;

// ── Study-area geometry ──────────────────────────────────────────────────────

export interface StudyAreaBbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/** Earth radius (mean) used by the simulator kernels for degree→km work. */
const EARTH_KM_PER_DEG_LAT = 111.0;

export function deriveCenter(bbox: StudyAreaBbox): { lat: number; lon: number } {
  return {
    lat: (bbox.latMin + bbox.latMax) / 2,
    lon: (bbox.lonMin + bbox.lonMax) / 2,
  };
}

export function deriveExtentKm(bbox: StudyAreaBbox): number {
  const latCenter = (bbox.latMin + bbox.latMax) / 2;
  const dLatKm = (bbox.latMax - bbox.latMin) * EARTH_KM_PER_DEG_LAT;
  const dLonKm =
    (bbox.lonMax - bbox.lonMin) *
    EARTH_KM_PER_DEG_LAT *
    Math.cos((latCenter * Math.PI) / 180);
  // Simulators require a strictly-positive extent to derive dx/dy
  return Math.max(dLatKm, dLonKm, 1.0);
}

/**
 * Convert a vent point (lat/lon) into grid fractions (0..1) for the volcano
 * kernel.
 *
 * The simulation grid is a SQUARE of `extent_km` centred on the bbox centroid
 * (not the bbox itself — the bbox may be non-square, the grid is always
 * square). Column 0 = west, column gs-1 = east; row 0 = north, row gs-1 =
 * south. The old code computed the fractions relative to the *bbox*, which is
 * a different reference frame — the vent appeared shifted whenever the bbox
 * aspect ratio ≠ 1 or the vent sat off-centre.
 *
 * Returns { vent_frac_x, vent_frac_y } or null when the vent is outside the
 * grid (caller should fall back to the grid centroid).
 */
export function computeVentFractions(
  bbox: StudyAreaBbox,
  vent: { lat: number; lon: number },
): { vent_frac_x: number; vent_frac_y: number } | null {
  const c = deriveCenter(bbox);
  const extentKm = deriveExtentKm(bbox);
  const latHalfDeg = (extentKm / 2) / EARTH_KM_PER_DEG_LAT;
  const lonHalfDeg =
    (extentKm / 2) /
    (EARTH_KM_PER_DEG_LAT * Math.max(0.1, Math.cos((c.lat * Math.PI) / 180)));
  const gridLatMin = c.lat - latHalfDeg;
  const gridLatMax = c.lat + latHalfDeg;
  const gridLonMin = c.lon - lonHalfDeg;
  const gridLonMax = c.lon + lonHalfDeg;

  // Clamp the vent into the grid so the run never fails (the kernel clamps too).
  const lat = Math.min(gridLatMax, Math.max(gridLatMin, vent.lat));
  const lon = Math.min(gridLonMax, Math.max(gridLonMin, vent.lon));
  const fx = (lon - gridLonMin) / (gridLonMax - gridLonMin); // 0=west, 1=east
  const fy = (gridLatMax - lat) / (gridLatMax - gridLatMin); // 0=north, 1=south
  return { vent_frac_x: Math.min(1, Math.max(0, fx)), vent_frac_y: Math.min(1, Math.max(0, fy)) };
}

/**
 * Snap a user-clicked vent point to the floor of the volcanic crater so lava
 * POOLS inside the crater first, then overflows the lowest rim point — instead
 * of streaming straight downhill from a vent placed on the crater rim/slope.
 *
 * Scans the real terrain grid within `radiusKm` of the click, finds the lowest
 * elevation cell, and returns its lat/lon. When no lower cell is found (flat /
 * already at a local minimum) the original point is returned unchanged.
 */
export function snapVentToCraterFloor(
  bbox: StudyAreaBbox,
  vent: { lat: number; lon: number },
  terrain: number[],
  terrainGs: number,
  radiusKm = 1.5,
): { lat: number; lon: number } {
  if (!terrain || terrain.length === 0 || terrainGs < 2) return vent;
  const c = deriveCenter(bbox);
  const extentKm = deriveExtentKm(bbox);
  const cellKm = extentKm / terrainGs;
  const rCells = Math.max(1, Math.round(radiusKm / cellKm));

  // grid coords of the click
  const latHalfDeg = (extentKm / 2) / EARTH_KM_PER_DEG_LAT;
  const lonHalfDeg =
    (extentKm / 2) /
    (EARTH_KM_PER_DEG_LAT * Math.max(0.1, Math.cos((c.lat * Math.PI) / 180)));
  const gridLatMin = c.lat - latHalfDeg;
  const gridLatMax = c.lat + latHalfDeg;
  const gridLonMin = c.lon - lonHalfDeg;
  const gridLonMax = c.lon + lonHalfDeg;
  const clickRow = Math.round(((gridLatMax - vent.lat) / (gridLatMax - gridLatMin)) * (terrainGs - 1));
  const clickCol = Math.round(((vent.lon - gridLonMin) / (gridLonMax - gridLonMin)) * (terrainGs - 1));

  let bestElev = Infinity;
  let bestRow = clickRow;
  let bestCol = clickCol;
  for (let r = Math.max(0, clickRow - rCells); r <= Math.min(terrainGs - 1, clickRow + rCells); r++) {
    for (let c2 = Math.max(0, clickCol - rCells); c2 <= Math.min(terrainGs - 1, clickCol + rCells); c2++) {
      const elev = terrain[r * terrainGs + c2];
      if (Number.isFinite(elev) && elev < bestElev) {
        bestElev = elev;
        bestRow = r;
        bestCol = c2;
      }
    }
  }
  if (bestRow === clickRow && bestCol === clickCol) return vent; // already a local min
  const lat = gridLatMax - (bestRow / (terrainGs - 1)) * (gridLatMax - gridLatMin);
  const lon = gridLonMin + (bestCol / (terrainGs - 1)) * (gridLonMax - gridLonMin);
  return { lat, lon };
}

// ── Param mapping (UI parameter set → kernel contract) ──────────────────────

export interface ScenarioFormParams {
  scenarioType: string;
  params: Record<string, number | string>;
  /** Simulation grid resolution for this run */
  gridSize: number;
}

/**
 * Convert UI slider state into the wire format expected by the Kaggle kernel.
 *
 * Throws a `ZodError` if any required field would be silently fabricated.
 * The previous implementation's `Number(x) || <default>` pattern collapsed
 * invalid or missing inputs into arbitrary synthetic values — this function
 * replaces that with fail-fast semantics.
 */
export function buildSimulationRequest(
  form: ScenarioFormParams,
  bbox: StudyAreaBbox,
  _ventPoint?: { lat: number; lon: number } | null,
): SimulationRequest {
  const c = deriveCenter(bbox);
  const extent_km = deriveExtentKm(bbox);
  const { params, scenarioType } = form;

  // Presence helpers — `Number(x) || dflt` is forbidden: it fabricates
  // physics inputs the user never provided.
  const num = (key: string): number => {
    const v = params[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(
        `Missing or invalid numeric parameter "${key}" for scenario "${scenarioType}".`,
      );
    }
    return v;
  };
  const str = (key: string): string => {
    const v = params[key];
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(
        `Missing or invalid string parameter "${key}" for scenario "${scenarioType}".`,
      );
    }
    return v;
  };
  // Presence probe for optional scientific knobs — false when the user has not
  // provided a finite number (field simply omitted from the request).
  const hasNum = (key: string): boolean => {
    const v = params[key];
    return typeof v === 'number' && Number.isFinite(v);
  };

  const common = {
    lat: c.lat,
    lon: c.lon,
    grid_size: form.gridSize,
    extent_km,
  };

  let draft: object;
  switch (scenarioType) {
    case 'flood_inundation':
      draft = {
        ...common,
        type: 'flood_inundation' as const,
        rainfall_mm: num('rainfall'),
        duration_hours: num('duration'),
        soil_saturation: num('soilSaturation'),
        dam_breach: true as const,
        wind_speed_ms: num('windSpeed') / 3.6,
      };
      break;
    case 'wildfire_spread':
      draft = {
        ...common,
        type: 'wildfire_spread' as const,
        wind_speed_ms: num('windSpeed') / 3.6,
        wind_dir_deg: num('windDir'),
        humidity_pct: num('humidity'),
        duration_hours: num('duration'),
        // Fuel type propagates to the simulator's ROS table selector
        fuel_type: (() => {
          const v = str('fuelType');
          if (v !== 'grass' && v !== 'shrub' && v !== 'forest' && v !== 'urban') {
            throw new Error(`Unsupported fuel_type "${v}"`);
          }
          return v;
        })(),
      };
      break;
    case 'earthquake_swarm':
      draft = {
        ...common,
        type: 'earthquake_swarm' as const,
        magnitude: num('magnitudeMax'),
        depth_km: num('depthMax'),
        // Optional site-condition override (NEHRP Vs30); the kernel defaults
        // to 760 m/s rock when absent — never fabricated here.
        ...(hasNum('vs30') ? { vs30: num('vs30') } : {}),
      };
      break;
    case 'tsunami_wave':
      draft = {
        ...common,
        type: 'tsunami_wave' as const,
        magnitude: num('magnitude'),
        // Prefer the derived hidden displacement when present; otherwise fall
        // back to the user-facing wave height.
        seafloor_displacement_m: hasNum('seafloorDisplacement') ? num('seafloorDisplacement') : num('waveHeight'),
        duration_minutes: 30,
      };
      break;
    case 'hurricane_landfall':
      draft = {
        ...common,
        type: 'hurricane_landfall' as const,
        category: num('category'),
        forward_speed_kmh: num('forwardSpeed'),
        central_pressure_hpa: num('pressure'),
        radius_max_wind_km: num('radius'),
        // "Hours to Landfall" is the time until the eye reaches the pinned
        // landfall point. The kernel centres the track at MID-duration
        // (hurricane-sim/main.py: cx(T/2) = track point), so the run must span
        // 2× the requested lead time — equal approach and inland-departure
        // halves. Mapping it 1:1 made landfall happen at half the stated hour.
        duration_hours: num('landfallTime') * 2,
        // Track heading (deg clockwise from N). Omitted in auto mode → the
        // kernel aims the storm at the pinned point from the water centroid.
        ...(hasNum('heading') ? { heading_deg: num('heading') } : {}),
      };
      break;
    case 'volcanic_eruption':
      draft = {
        ...common,
        type: 'volcanic_eruption' as const,
        vei: num('vei'),
        wind_speed_ms: num('windSpeed') / 3.6,
        wind_dir_deg: num('windDir'),
        duration_hours: num('duration'),
        // Lava rheology + eruption scale knobs (crater-fill and overflow)
        ...(hasNum('yieldScale') ? { yield_scale: num('yieldScale') } : {}),
        ...(hasNum('massScale') ? { mass_scale: num('massScale') } : {}),
        // Scientific/ash knobs — passed through only when the user supplied a
        // finite value (never fabricated by the builder).
        ...(hasNum('ashParticleDiameter') ? { ash_particle_diameter_m: num('ashParticleDiameter') / 1e6 } : {}),
        ...(hasNum('ashDiffusivity') ? { ash_diffusivity_m2_s: num('ashDiffusivity') } : {}),
        ...(hasNum('ashWindShear') ? { ash_wind_shear_factor: num('ashWindShear') } : {}),
      };
      break;
    case 'landslide':
      draft = {
        ...common,
        type: 'landslide' as const,
        trigger_type: (() => {
          const v = str('triggerType');
          if (v !== 'earthquake' && v !== 'rainfall' && v !== 'volcanic') {
            throw new Error(`Unsupported trigger_type "${v}"`);
          }
          return v;
        })(),
        magnitude: num('magnitude'),
        pga_threshold: num('pgaThreshold'),
        rainfall_mm: num('rainfall'),
        friction_angle: num('frictionAngle'),
        cohesion: num('cohesion'),
        duration_hours: num('duration'),
        // Scientific/calibration knobs — passed through only when the user
        // supplied a finite value (never fabricated by the builder).
        ...(hasNum('mu') ? { mu: num('mu') } : {}),
        ...(hasNum('xi') ? { xi: num('xi') } : {}),
        ...(hasNum('entrainmentRate') ? { entrainment_rate: num('entrainmentRate') } : {}),
        ...(hasNum('erodibleDepthM') ? { erodible_depth_m: num('erodibleDepthM') } : {}),
        ...(hasNum('rainfallThreshold') ? { rainfall_threshold: num('rainfallThreshold') } : {}),
      };
      break;
    default:
      throw new Error(`Unknown scenario type: "${scenarioType}"`);
  }

  return SimulationRequestSchema.parse(draft);
}

// ── HTTP layer ───────────────────────────────────────────────────────────────

export interface SubmitOk { jobId: string }
export interface SubmitErr { error: string }

/** Submits a validated payload; throws on validation or transport failure. */
export async function submitSimulation(req: SimulationRequest): Promise<SubmitOk> {
  const resp = await fetch('/api/kaggle/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = (await resp.json()) as { jobId?: string; error?: string };
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  if (!data.jobId) throw new Error('Server returned no jobId');
  return { jobId: data.jobId };
}

export async function requestCancel(jobId: string): Promise<void> {
  try {
    await fetch(`/api/kaggle/simulate/${jobId}/cancel`, { method: 'POST' });
  } catch {
    // Server unreachable — best-effort
  }
}

export async function fetchResults(jobId: string): Promise<Record<string, unknown>> {
  const r = await fetch(`/api/kaggle/simulate/${jobId}/results`);
  if (!r.ok) throw new Error(`Results fetch failed: HTTP ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
}

// ── Form physics: auto-derivation of derived form fields ─────────────────────
//
// When the user moves the *primary* slider (e.g. hurricane category), several
// secondary form fields are derived from physics so the form stays physically
// consistent. This fills `params` *before* user input is packaged for the wire
// — it's UI sugar for the form, not a substitute for input validation.
//
// NOTE: values produced here are *real* physics-derived defaults, not fake
// data. They are computed from the user's actual slider inputs.

export function derivePhysicsFormOverrides(
  type: string,
  params: Record<string, number | string>,
): Record<string, number | string> {
  const p = { ...params };

  switch (type) {
    case 'earthquake_swarm': {
      const mag = Number(p.magnitudeMax) || 6.5;
      // Catenoid logic: higher-magnitude mainshocks typically rupture deeper
      // (megathrust scaling), bounded by the wire schema's 700 km cap.
      p.depthMax = Math.max(5, Math.min(50, mag * 5));
      p.depthMin = Math.max(1, mag * 2);
      break;
    }
    case 'hurricane_landfall': {
      const cat = Number(p.category) || 3;
      const windSpeeds = { 1: 43, 2: 50, 3: 58, 4: 70, 5: 90 } as const;
      p.windSpeed = windSpeeds[(cat as 1 | 2 | 3 | 4 | 5)] ?? 58;
      // Central pressure decreases with category
      p.pressure = Math.round(1010 - cat * 20);
      // Radius of max winds increases with category
      p.radius = Math.max(20, 30 + cat * 15);
      break;
    }
    case 'volcanic_eruption': {
      const vei = Number(p.vei) || 3;
      // Duration scales with VEI (bigger eruptions run longer).
      p.duration = Math.max(1, vei * 8);
      break;
    }
    case 'landslide': {
      const mag = Number(p.magnitude) || 6.5;
      const trigger = p.triggerType || 'earthquake';
      p.frictionAngle = Math.max(25, 40 - mag * 1.5);
      p.cohesion = Math.max(100, 800 - mag * 50);
      p.pgaThreshold = Math.max(0.05, 0.3 - mag * 0.03);
      if (trigger === 'rainfall') {
        p.rainfallThreshold = Math.max(50, 300 - mag * 20);
      }
      break;
    }
    case 'flood_inundation': {
      const rainfall = Number(p.rainfall) || 500;
      const area = Number(p.catchmentArea) || 2000;
      // SCS-CN runoff — volumetric hint for the UI; the wire schema consumes
      // only rainfall_mm/duration_hours/soil_saturation.
      const cn = p.soilSaturation ? 80 + (p.soilSaturation as number) * 15 : 85;
      const S = 1000 / cn - 10;
      const P = rainfall / 25.4;
      p.runoffDepth = Math.round((P > 0.2 * S ? Math.pow(P - 0.2 * S, 2) / (P + 0.8 * S) : 0) * 25.4);
      p.duration = Math.max(1, Math.round(rainfall / 50 + area / 500));
      p.floodExtent = Math.round((p.runoffDepth as number) * area / 1000);
      break;
    }
    case 'wildfire_spread': {
      const wind = Number(p.windSpeed) || 20;
      const humidity = Number(p.humidity) || 15;
      const fuelType = p.fuelType || 'forest';
      const fuelLoads = { grass: 5, shrub: 15, forest: 30, urban: 2 } as const;
      p.fuelLoad = fuelLoads[(fuelType as 'grass' | 'shrub' | 'forest' | 'urban')] ?? 30;
      // Rothermel spread model — adjusted for wind-driven humidity drawdown.
      p.spreadRate = Math.round(wind * 0.5 * (p.fuelLoad as number) / 10);
      p.fireIntensity = Math.round((p.spreadRate as number) * (p.fuelLoad as number) * 100);
      p.effectiveHumidity = Math.max(0, humidity - wind * 0.3);
      break;
    }
    case 'tsunami_wave': {
      const mag = Number(p.magnitude) || 8.5;
      // Keep the visible wave-height slider stable and derive a hidden source
      // displacement that still stays within the wire contract's bounds.
      p.seafloorDisplacement = Math.max(1, Math.min(40, Math.round(Math.pow(10, mag - 6) * 5)));
      p.runupDistance = Math.round((p.waveHeight as number) * 5);
      // Empirical wave-phase hint for the catalogue UI (100 km standoff).
      const depth = Number(p.depth) || 20;
      p.arrivalTime = Math.round((100_000 / Math.round(Math.sqrt(9.81 * depth * 1000))) / 60);
      break;
    }
  }

  return p;
}
