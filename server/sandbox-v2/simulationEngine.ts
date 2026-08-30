import { randomUUID } from 'crypto';
import { logger } from '../observability/logger';
import { safeJsonParse } from '../utils/jsonParse';
import type { SandboxManager, CodeExecutionRequest } from '../sandboxManager';

export interface SimulationConfig {
  model: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  memoryLimitMb: number;
}

export interface SimulationResult {
  id: string;
  status: 'running' | 'complete' | 'error';
  result: unknown;
  logs: string[];
  durationMs: number;
}

interface ModelSchema {
  name: string;
  description: string;
  inputs: Array<{ name: string; type: string; description: string; required: boolean }>;
  outputs: Array<{ name: string; type: string; description: string }>;
}

const MODEL_SCHEMAS: ModelSchema[] = [
  {
    name: 'farsite-lite',
    description: 'Wildfire 2D cellular automata with Rothermel spread model',
    inputs: [
      { name: 'dem', type: 'number[][]', description: 'Digital elevation model grid', required: true },
      { name: 'fuelModel', type: 'number[][]', description: 'Fuel model classification grid', required: true },
      { name: 'windSpeed', type: 'number', description: 'Wind speed in km/h', required: true },
      { name: 'windDir', type: 'number', description: 'Wind direction in degrees', required: true },
      { name: 'moisture', type: 'number', description: 'Fuel moisture content 0-1', required: true },
      { name: 'ignitionPoint', type: '[number,number]', description: 'Ignition [row,col] in grid', required: true },
      { name: 'duration', type: 'number', description: 'Simulation duration in minutes', required: true },
    ],
    outputs: [
      { name: 'firePerimeters', type: '[number,number][][]', description: 'Fire perimeter polygons over time' },
      { name: 'spreadRate', type: 'number[][]', description: 'Rate of spread grid' },
      { name: 'intensity', type: 'number[][]', description: 'Fire intensity grid' },
      { name: 'timeSteps', type: 'number', description: 'Number of simulation time steps' },
    ],
  },
  {
    name: 'adcirc-lite',
    description: 'Shallow water equations for tsunami simulation',
    inputs: [
      { name: 'bathymetry', type: 'number[][]', description: 'Bathymetry grid in meters', required: true },
      { name: 'magnitude', type: 'number', description: 'Earthquake magnitude', required: true },
      { name: 'depth', type: 'number', description: 'Earthquake depth in km', required: true },
      { name: 'epicenter', type: '[number,number]', description: 'Epicenter [row,col] in grid', required: true },
      { name: 'duration', type: 'number', description: 'Simulation duration in seconds', required: true },
    ],
    outputs: [
      { name: 'waveHeights', type: 'number[][]', description: 'Maximum wave height grid' },
      { name: 'arrivalTimes', type: 'number[][]', description: 'Wave arrival time grid' },
      { name: 'inundationMap', type: 'number[][]', description: 'Inundation depth grid' },
    ],
  },
  {
    name: 'wrf-lite',
    description: 'Simplified atmospheric primitive equations (2D finite difference)',
    inputs: [
      { name: 'initialConditions', type: 'object', description: 'Initial atmospheric state', required: true },
      { name: 'boundaryConditions', type: 'object', description: 'Boundary forcing', required: true },
      { name: 'terrain', type: 'number[][]', description: 'Terrain elevation grid', required: true },
      { name: 'duration', type: 'number', description: 'Forecast duration in hours', required: true },
    ],
    outputs: [
      { name: 'wind', type: 'number[][][]', description: 'U/V wind fields over time' },
      { name: 'pressure', type: 'number[][][]', description: 'Pressure fields over time' },
      { name: 'temperature', type: 'number[][][]', description: 'Temperature fields over time' },
      { name: 'precipitation', type: 'number[][]', description: 'Total precipitation grid' },
    ],
  },
  {
    name: 'hysplit-lite',
    description: 'Gaussian puff volcanic ash dispersion model',
    inputs: [
      { name: 'eruptionHeight', type: 'number', description: 'Eruption plume height in km', required: true },
      { name: 'ashMass', type: 'number', description: 'Total ash mass in tonnes', required: true },
      { name: 'windFields', type: 'any[]', description: 'Wind field profiles at altitudes', required: true },
      { name: 'duration', type: 'number', description: 'Dispersion duration in hours', required: true },
    ],
    outputs: [
      { name: 'ashConcentration', type: 'number[][][]', description: 'Ash concentration over time and space' },
      { name: 'depositionMap', type: 'number[][]', description: 'Ash deposition grid' },
    ],
  },
  {
    name: 'fno-surrogate',
    description: 'Fourier Neural Operator surrogate for fast weather prediction',
    inputs: [
      { name: 'lat', type: 'number', description: 'Center latitude', required: true },
      { name: 'lon', type: 'number', description: 'Center longitude', required: true },
      { name: 'leadDays', type: 'number', description: 'Forecast lead days (1-10)', required: true },
    ],
    outputs: [
      { name: 'temperature', type: 'number[][]', description: 'Temperature forecast grid' },
      { name: 'precipitation', type: 'number[][]', description: 'Precipitation forecast grid' },
      { name: 'windSpeed', type: 'number[][]', description: 'Wind speed forecast grid' },
      { name: 'confidence', type: 'number', description: 'Model confidence score 0-1' },
    ],
  },
];

export class SimulationEngine {
  private sandboxManager: SandboxManager;
  private activeSimulations: Map<string, { config: SimulationConfig; startTime: number; logs: string[] }> = new Map();

  constructor(sandboxManager: SandboxManager) {
    this.sandboxManager = sandboxManager;
  }

  async runSimulation(config: SimulationConfig): Promise<SimulationResult> {
    const id = randomUUID();
    const startTime = Date.now();
    const logs: string[] = [];

    logs.push(`[${new Date().toISOString()}] Starting simulation: ${config.model}`);
    logs.push(`[${new Date().toISOString()}] Params: ${JSON.stringify(config.params)}`);

    this.activeSimulations.set(id, { config, startTime, logs });

    try {
      const validation = this.validateParams(config.model, config.params);
      if (!validation.valid) {
        logs.push(`[${new Date().toISOString()}] Validation failed: ${validation.errors.join(', ')}`);
        return { id, status: 'error', result: null, logs, durationMs: Date.now() - startTime };
      }

      const sandboxCode = this.buildSandboxCode(config.model, config.params);
      logs.push(`[${new Date().toISOString()}] Sandbox code generated (${sandboxCode.length} chars)`);

      const execRequest: CodeExecutionRequest = {
        language: 'python',
        code: sandboxCode,
        timeout: config.timeoutMs,
      };

      logs.push(`[${new Date().toISOString()}] Executing in sandbox...`);
      const result = await this.sandboxManager.execute(execRequest);

      logs.push(`[${new Date().toISOString()}] Sandbox exit code: ${result.exitCode}`);

      if (result.stdout) {
        logs.push(`[${new Date().toISOString()}] stdout (${result.stdout.length} chars)`);
      }
      if (result.stderr) {
        logs.push(`[${new Date().toISOString()}] stderr: ${result.stderr.slice(0, 500)}`);
      }

      if (result.exitCode !== 0) {
        logs.push(`[${new Date().toISOString()}] Simulation failed with exit code ${result.exitCode}`);
        return { id, status: 'error', result: result.outputJson || { stderr: result.stderr }, logs, durationMs: Date.now() - startTime };
      }

      logs.push(`[${new Date().toISOString()}] Simulation complete`);
      return {
        id,
        status: 'complete',
        result: result.outputJson || safeJsonParse(result.stdout || '{}', {}),
        logs,
        durationMs: Date.now() - startTime,
      };
    } catch (e) {
      logs.push(`[${new Date().toISOString()}] Error: ${(e as Error).message}`);
      logger.error({ err: (e as Error).message, model: config.model }, 'Simulation failed');
      return { id, status: 'error', result: { error: (e as Error).message }, logs, durationMs: Date.now() - startTime };
    } finally {
      this.activeSimulations.delete(id);
    }
  }

  validateParams(model: string, params: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const schema = MODEL_SCHEMAS.find(s => s.name === model);
    if (!schema) return { valid: false, errors: [`Unknown model: ${model}`] };

    const errors: string[] = [];
    for (const input of schema.inputs) {
      if (input.required && (params[input.name] === undefined || params[input.name] === null)) {
        errors.push(`Missing required parameter: ${input.name}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  getModelSchema(model: string): object | null {
    const schema = MODEL_SCHEMAS.find(s => s.name === model);
    return schema || null;
  }

  listModels(): string[] {
    return MODEL_SCHEMAS.map(s => s.name);
  }

  listModelSchemas(): ModelSchema[] {
    return MODEL_SCHEMAS;
  }

  private buildSandboxCode(model: string, params: Record<string, unknown>): string {
    const imports = `import json, sys, math, time, random
import numpy as np
`;
    switch (model) {
      case 'farsite-lite': return imports + this.buildFarsiteCode(params);
      case 'adcirc-lite': return imports + this.buildAdcircCode(params);
      case 'wrf-lite': return imports + this.buildWrfCode(params);
      case 'hysplit-lite': return imports + this.buildHysplitCode(params);
      case 'fno-surrogate': return this.buildFnoCode(params);
      default: return `print(json.dumps({"error": "unknown model: ${model}"}))`;
    }
  }

  private validateNumericArray(arr: unknown): boolean {
    if (!Array.isArray(arr)) return false;
    for (const row of arr) {
      if (!Array.isArray(row)) return false;
      for (const val of row) {
        if (typeof val !== 'number' || !Number.isFinite(val)) return false;
      }
    }
    return true;
  }

  private buildFarsiteCode(params: Record<string, unknown>): string {
    const safeDem = JSON.stringify(params.dem);
    const safeFuel = JSON.stringify(params.fuelModel);
    const safeIgnition = JSON.stringify(params.ignitionPoint ?? [0, 0]);
    const windSpeed = typeof params.windSpeed === 'number' && Number.isFinite(params.windSpeed) ? params.windSpeed : 0;
    const windDir = typeof params.windDir === 'number' && Number.isFinite(params.windDir) ? params.windDir : 0;
    const moisture = typeof params.moisture === 'number' && Number.isFinite(params.moisture) ? params.moisture : 0.5;
    const duration = typeof params.duration === 'number' && Number.isFinite(params.duration) ? params.duration : 60;

    if (params.dem && !this.validateNumericArray(params.dem)) {
      return `print(json.dumps({"error": "dem must be a 2D numeric array"}))`;
    }
    if (params.fuelModel && !this.validateNumericArray(params.fuelModel)) {
      return `print(json.dumps({"error": "fuelModel must be a 2D numeric array"}))`;
    }

    return `
dem = np.array(${safeDem})
fuel = np.array(${safeFuel})
wind_speed = ${windSpeed}
wind_dir = ${windDir}
moisture = ${moisture}
ig_row, ig_col = ${safeIgnition}
duration = ${duration}

rows, cols = dem.shape
R = np.ones((rows, cols)) * 0.1
R *= (1.0 + wind_speed / 20.0 * np.cos(np.deg2rad(wind_dir - 90)))
R *= (1.0 - moisture * 0.6)
R *= np.clip(1.0 + fuel * 0.5, 0.1, 5.0)

burned = np.zeros((rows, cols), dtype=bool)
fire_front = np.zeros((rows, cols), dtype=float)
fire_front[ig_row, ig_col] = 1.0
burned[ig_row, ig_col] = True

perimeters = []
timeSteps = min(int(duration / 5), 200)
for t in range(timeSteps):
    new_front = np.zeros((rows, cols), dtype=float)
    for i in range(1, rows - 1):
        for j in range(1, cols - 1):
            if fire_front[i, j] > 0 and not burned[i, j]:
                burned[i, j] = True
                for di in [-1, 0, 1]:
                    for dj in [-1, 0, 1]:
                        ni, nj = i + di, j + dj
                        if 0 <= ni < rows and 0 <= nj < cols and not burned[ni, nj]:
                            spread = R[i, j] * (1.0 + abs(di) * 0.3) * (1.0 + abs(dj) * 0.3)
                            if random.random() < spread * 0.1:
                                new_front[ni, nj] = spread
                                burned[ni, nj] = True
    fire_front = new_front
    front_pts = np.argwhere(fire_front > 0)
    if len(front_pts) > 2:
        perimeters.append(front_pts.tolist())

intensity = R * 5000 * (1.0 - moisture)
result = {
    "firePerimeters": perimeters,
    "spreadRate": R.tolist(),
    "intensity": intensity.tolist(),
    "timeSteps": len(perimeters)
}
print(json.dumps(result))
`;
  }

  private buildAdcircCode(params: Record<string, unknown>): string {
    // Validate bathymetry array
    if (params.bathymetry && !this.validateNumericArray(params.bathymetry)) {
      return `print(json.dumps({"error": "bathymetry must be a 2D numeric array"}))`;
    }
    const safeBathy = JSON.stringify(params.bathymetry);
    const safeEpicenter = JSON.stringify(params.epicenter ?? [0, 0]);
    const magnitude = typeof params.magnitude === 'number' && Number.isFinite(params.magnitude) ? params.magnitude : 7.0;
    const depth = typeof params.depth === 'number' && Number.isFinite(params.depth) ? params.depth : 10;
    const duration = typeof params.duration === 'number' && Number.isFinite(params.duration) ? params.duration : 3600;

    return `
bathy = np.array(${safeBathy})
magnitude = ${magnitude}
depth = ${depth}
epi_row, epi_col = ${safeEpicenter}
duration = ${duration}

rows, cols = bathy.shape
g = 9.81
manning = 0.025
dx = 1000.0

init_amp = 10.0 ** (0.5 * magnitude - 3.0)
init_amp *= min(1.0, max(0.1, 30.0 / max(depth, 1)))

eta = np.zeros((rows, cols))
u = np.zeros((rows, cols))
v = np.zeros((rows, cols))

r2 = (np.arange(rows)[:, None] - epi_row) ** 2 + (np.arange(cols)[None, :] - epi_col) ** 2
eta = init_amp * np.exp(-r2 / 100.0)

max_eta = np.zeros((rows, cols))
arrival = np.full((rows, cols), duration)

dt = 2.0
timeSteps = min(int(duration / dt), 3000)
for t in range(timeSteps):
    if t % 100 == 0:
        pass
    de_dx = np.zeros((rows, cols))
    de_dy = np.zeros((rows, cols))
    de_dx[:, 1:-1] = (eta[:, 2:] - eta[:, :-2]) / (2 * dx)
    de_dy[1:-1, :] = (eta[2:, :] - eta[:-2, :]) / (2 * dx)
    depth_total = np.maximum(bathy + eta, 0.1)
    u -= dt * g * de_dx
    v -= dt * g * de_dy
    u_flux = u * depth_total
    v_flux = v * depth_total
    dudx = np.zeros((rows, cols)); dvdy = np.zeros((rows, cols))
    dudx[:, 1:-1] = (u_flux[:, 2:] - u_flux[:, :-2]) / (2 * dx)
    dvdy[1:-1, :] = (v_flux[2:, :] - v_flux[:-2, :]) / (2 * dx)
    eta -= dt * (dudx + dvdy)
    eta *= 0.999
    max_eta = np.maximum(max_eta, np.abs(eta))
    arriving = (np.abs(eta) > 0.01) & (arrival == duration)
    arrival[arriving] = t * dt

inundation = np.maximum(max_eta - np.maximum(bathy, 0), 0)
result = {
    "waveHeights": max_eta.tolist(),
    "arrivalTimes": arrival.tolist(),
    "inundationMap": inundation.tolist()
}
print(json.dumps(result))
`;
  }

  private buildWrfCode(params: Record<string, unknown>): string {
    // Validate terrain array
    if (params.terrain && !this.validateNumericArray(params.terrain)) {
      return `print(json.dumps({"error": "terrain must be a 2D numeric array"}))`;
    }
    const safeTerrain = JSON.stringify(params.terrain ?? []);
    const duration = typeof params.duration === 'number' && Number.isFinite(params.duration) ? params.duration : 24;

    return `
init = ${JSON.stringify(params.initialConditions ?? {})}
boundary = ${JSON.stringify(params.boundaryConditions ?? {})}
terrain = np.array(${safeTerrain})
duration = ${duration}

rows, cols = terrain.shape
nx, ny = rows, cols
dx = 5000.0
dt = 30.0
f = 1e-4
g = 9.81
H = 5000.0

u = np.random.randn(nx, ny) * 0.1
v = np.random.randn(nx, ny) * 0.1
T = np.ones((nx, ny)) * 288.0
p = np.ones((nx, ny)) * 101325.0
qv = np.ones((nx, ny)) * 0.005

if "temperature" in init:
    T += np.array(init["temperature"])
if "pressure" in init:
    p += np.array(init["pressure"])

wind_out = []
pressure_out = []
temp_out = []

timeSteps = min(int(duration * 3600 / dt), 2000)
for t in range(timeSteps):
    if t > 0:
        du_dx = np.zeros((nx, ny)); du_dy = np.zeros((nx, ny))
        dv_dx = np.zeros((nx, ny)); dv_dy = np.zeros((nx, ny))
        du_dx[:, 1:-1] = (u[:, 2:] - u[:, :-2]) / (2 * dx)
        du_dy[1:-1, :] = (u[2:, :] - u[:-2, :]) / (2 * dx)
        dv_dx[:, 1:-1] = (v[:, 2:] - v[:, :-2]) / (2 * dx)
        dv_dy[1:-1, :] = (v[2:, :] - v[:-2, :]) / (2 * dx)
        u -= dt * (u * du_dx + v * du_dy - f * v + g * np.gradient(p, dx, axis=1) / p)
        v -= dt * (u * dv_dx + v * dv_dy + f * u + g * np.gradient(p, dx, axis=0) / p)
        u *= 0.999; v *= 0.999

    if t % int(timeSteps / 10 + 1) == 0 or t == timeSteps - 2:
        wind_out.append([u.tolist(), v.tolist()])
        pressure_out.append(p.tolist())
        temp_out.append(T.tolist())

precip = np.maximum(qv * 1000 - 5, 0) * 10
result = {
    "wind": wind_out,
    "pressure": pressure_out,
    "temperature": temp_out,
    "precipitation": precip.tolist()
}
print(json.dumps(result))
`;
  }

  private buildHysplitCode(params: Record<string, unknown>): string {
    const eruptionHeight = typeof params.eruptionHeight === 'number' && Number.isFinite(params.eruptionHeight) ? params.eruptionHeight : 10;
    const ashMass = typeof params.ashMass === 'number' && Number.isFinite(params.ashMass) ? params.ashMass : 1000;
    const duration = typeof params.duration === 'number' && Number.isFinite(params.duration) ? params.duration : 24;
    const lat0 = typeof params.lat === 'number' && Number.isFinite(params.lat) ? params.lat : 8.0;
    const lon0 = typeof params.lon === 'number' && Number.isFinite(params.lon) ? params.lon : 72.0;

    return `
eruption_height = ${eruptionHeight}
ash_mass = ${ashMass}
wind_fields = ${JSON.stringify(params.windFields ?? [])}
duration = ${duration}
lat0 = ${lat0}
lon0 = ${lon0}

# ── Grid ────────────────────────────────────────────────────────────────
# Vectorized 3-D advection–diffusion. The previous implementation used a
# Python triple-nested loop (O(n^3) per step) that never completed inside
# the 60 s budget; this runs fully vectorized on numpy in a few seconds.
nx, ny, nz = 81, 81, 20
dx = dy = 3000.0
dz = 500.0
K_h = 1000.0
K_v = 20.0
dt = 60.0
timeSteps = min(int(duration * 3600.0 / dt), 1440)

cell_area = dx * dy
mass_kg = ash_mass * 1000.0

# ── Wind profile: interpolate (speed, direction) vs altitude ─────────────
wfs = sorted(wind_fields, key=lambda w: w['altitude'])
alts = [w['altitude'] for w in wfs]
speeds = [w['speed'] for w in wfs]
dirs = [w['direction'] for w in wfs]

def wind_at(z):
    if z <= alts[0]:
        return speeds[0], dirs[0]
    if z >= alts[-1]:
        return speeds[-1], dirs[-1]
    for a in range(len(alts) - 1):
        if alts[a] <= z <= alts[a + 1]:
            f = (z - alts[a]) / max(alts[a + 1] - alts[a], 1e-9)
            return speeds[a] + f * (speeds[a + 1] - speeds[a]), dirs[a] + f * (dirs[a + 1] - dirs[a])
    return speeds[-1], dirs[-1]

# Wind direction is reported as the FROM bearing (meteorological convention);
# ash is transported in the TO direction (bearing + 180). u = east, v = north.
u_k = np.zeros(nz)
v_k = np.zeros(nz)
for k in range(nz):
    sp, d = wind_at(k * dz)
    to_rad = math.radians(d + 180.0)
    u_k[k] = sp * math.sin(to_rad)
    v_k[k] = sp * math.cos(to_rad)

# Gravitational settling: tephra falls at its terminal velocity, so apply a
# constant downward (toward the surface) vertical advection. Without this the
# ash stays aloft and essentially no ashfall is produced, which is unphysical.
w_settle = 1.5
w_k = np.full(nz, -w_settle)

# ── Seed the eruption column ─────────────────────────────────────────────
C = np.zeros((nx, ny, nz))
plume_top = min(int(eruption_height * 1000.0 / dz), nz - 1)
cx, cy = nx // 2, ny // 2
vz0 = max(0, plume_top - 1); vz1 = min(nz, plume_top + 1)
vent = (slice(cx - 2, cx + 3), slice(cy - 2, cy + 3), slice(vz0, vz1))
nvox = (vent[0].stop - vent[0].start) * (vent[1].stop - vent[1].start) * (vent[2].stop - vent[2].start)
C[vent] = mass_kg / max(nvox, 1)

deposition = np.zeros((nx, ny))  # kg/m^2 (numerically == mm at 1000 kg/m^3)

def advect_axis(C, vel, axis, dt, d):
    # Wind varies with altitude (z), so align the velocity with axis 2.
    s = [1] * C.ndim
    s[2] = vel.shape[0]
    v = vel.reshape(s)
    c_roll = np.roll(C, 1, axis=axis)
    c_back = np.roll(C, -1, axis=axis)
    grad = np.where(v > 0, (C - c_roll) / d, (c_back - C) / d)
    return -v * grad * dt

for t in range(timeSteps):
    lap_x = np.gradient(np.gradient(C, dx, axis=0), dx, axis=0)
    lap_y = np.gradient(np.gradient(C, dy, axis=1), dy, axis=1)
    lap_z = np.gradient(np.gradient(C, dz, axis=2), dz, axis=2)
    diff = K_h * (lap_x + lap_y) + K_v * lap_z
    adv_x = advect_axis(C, u_k, 0, dt, dx)
    adv_y = advect_axis(C, v_k, 1, dt, dy)
    adv_z = advect_axis(C, w_k, 2, dt, dz)
    C = C + dt * diff + adv_x + adv_y + adv_z
    C = np.maximum(C, 0.0)
    # Ground-level ash settles onto the surface (mass-conserving).
    settle = C[:, :, 0] * 0.002 * dt
    deposition += settle / cell_area
    C[:, :, 0] -= settle
    C = np.maximum(C, 0.0)

ash_series = []
for ts in range(min(10, timeSteps)):
    idx = int(ts * (timeSteps - 1) / max(min(10, timeSteps) - 1, 1))
    ash_series.append(C[:, :, nz // 2].tolist())

dlat = dx / 111320.0
dlon = dx / (111320.0 * math.cos(math.radians(lat0)))

result = {
    "ashConcentration": ash_series,
    "depositionMap": deposition.tolist(),
    "lat0": lat0, "lon0": lon0, "dlat": dlat, "dlon": dlon,
}
print(json.dumps(result))
`;
  }

  private buildFnoCode(params: Record<string, unknown>): string {
    const lat = typeof params.lat === 'number' ? params.lat : 0;
    const lon = typeof params.lon === 'number' ? params.lon : 0;
    const leadDays = typeof params.leadDays === 'number' ? Math.min(Math.max(params.leadDays, 1), 10) : 1;

    // Use Open-Meteo API for real weather data instead of random noise
    return `
import json, urllib.request
lat = ${lat}
lon = ${lon}
lead_days = ${leadDays}

try:
    url = f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&forecast_days={lead_days}&timezone=auto'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    daily = data.get('daily', {})
    temp_max = daily.get('temperature_2m_max', [])
    temp_min = daily.get('temperature_2m_min', [])
    precip = daily.get('precipitation_sum', [])
    wind = daily.get('wind_speed_10m_max', [])
    avg_temp = [(a + b) / 2 for a, b in zip(temp_max, temp_min)] if temp_max and temp_min else [288.0]
    conf = 0.85 - lead_days * 0.05
    result = {
        "temperature": [avg_temp],
        "precipitation": [precip if precip else [0]],
        "windSpeed": [wind if wind else [0]],
        "confidence": round(max(0.1, conf), 3),
        "source": "open-meteo",
        "synthetic": False
    }
except Exception as e:
    # Fallback: return climatological estimate based on latitude
    base_temp = 288.0 - abs(lat) * 0.5
    result = {
        "temperature": [[base_temp + lead_days * 0.1] * 64],
        "precipitation": [[2.0] * 64],
        "windSpeed": [[5.0] * 64],
        "confidence": 0.3,
        "source": "climatological-fallback",
        "synthetic": True,
        "warning": str(e)
    }
print(json.dumps(result))
`;
  }
}
