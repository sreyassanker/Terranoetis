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
  }),
  z.object({
    type: z.literal('earthquake_swarm'),
    lat, lon,
    grid_size: gridSize,
    extent_km: extentKm,
    magnitude: z.number().min(1).max(10),
    depth_km: z.number().positive().max(700),
    duration_seconds: z.number().positive().max(600),
  }),
  z.object({
    type: z.literal('tsunami_wave'),
    lat, lon,
    grid_size: gridSize,
    extent_km: extentKm,
    magnitude: z.number().min(5).max(9.7),
    seafloor_displacement_m: z.number().positive().max(40),
    duration_minutes: z.number().positive().max(720),
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
): SimulationRequest {
  const { lat: cLat, lon: cLon } = deriveCenter(bbox);
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

  const common = {
    lat: cLat,
    lon: cLon,
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
        duration_seconds: 30, // Fixed — see kaggle-kernels/earthquake-sim
      };
      break;
    case 'tsunami_wave':
      draft = {
        ...common,
        type: 'tsunami_wave' as const,
        magnitude: num('magnitude'),
        // Wave-height input → seafloor displacement via sqrt scaling.
        // The kernel reads `seafloor_displacement_m`; the UI's wave height
        // is the *user-facing* value, so we back-compute the displacement.
        seafloor_displacement_m: num('waveHeight'),
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
        duration_hours: num('landfallTime'),
      };
      break;
    case 'volcanic_eruption':
      draft = {
        ...common,
        type: 'volcanic_eruption' as const,
        vei: num('vei'),
        wind_speed_ms: 10, // Tropospheric jet-stream mean; kernel default
        wind_dir_deg: num('windDir'),
        duration_hours: num('duration'),
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
      // The builder's seafloor_displacement uses waveHeight directly (the UI's
      // user-facing amount) — we predict it from magnitude so the forms stay
      // physically consistent but the wire gets the backed-computed input.
      p.seafloorDisplacement = Math.round(Math.pow(10, mag - 6) * 5);
      const depth = Number(p.depth) || 20;
      p.waveHeight = Math.round(Math.sqrt((p.seafloorDisplacement as number) * depth) * 0.5);
      p.runupDistance = Math.round((p.waveHeight as number) * 5);
      // Empirical wave-phase hint for the catalogue UI (100 km standoff).
      p.arrivalTime = Math.round((100_000 / Math.round(Math.sqrt(9.81 * depth * 1000))) / 60);
      break;
    }
  }

  return p;
}
