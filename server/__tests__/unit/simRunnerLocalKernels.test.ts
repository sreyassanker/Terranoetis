import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * End-to-end tests for the LOCAL kernel path with the REAL python3 kernels
 * (no child_process mocks). These are the workflow gate for the three
 * 2D local scenario types — earthquake ShakeMap, wildfire Rothermel, and
 * hurricane wind+surge — proving they run on a laptop CPU in seconds,
 * produce the .npy fields the overlays fetch, and pass their embedded
 * physics sanity gates.
 */

const RESULTS_DIR = path.resolve(process.cwd(), 'kaggle-kernels', 'results');

let pythonOk = false;
try {
  execFileSync('python3', ['-c', 'import numpy'], { stdio: 'pipe', timeout: 30_000 });
  pythonOk = true;
} catch {
  pythonOk = false;
}

interface JobStatus { status: string; error?: string }

let simRunner: { getJobStatus: (id: string) => JobStatus | undefined };
let startSimulation: (p: any) => Promise<{ id: string }>;

beforeAll(async () => {
  const mod = await import('../../kaggle/simRunner');
  simRunner = mod as unknown as typeof simRunner;
  startSimulation = mod.startSimulation as unknown as typeof startSimulation;
});

afterAll(() => {
  for (const dir of fs.readdirSync(RESULTS_DIR)) {
    fs.rmSync(path.join(RESULTS_DIR, dir), { recursive: true, force: true });
  }
});

function readF32(jobDir: string, name: string): { data: Float32Array | Float64Array; shape: number[] } {
  const buf = fs.readFileSync(path.join(jobDir, `${name}.npy`));
  const major = buf[6];
  const headerLen = major >= 2 ? buf.readUInt32LE(8) : buf.readUInt16LE(8);
  const headerStart = major >= 2 ? 12 : 10;
  const header = buf.slice(headerStart, headerStart + headerLen).toString('latin1');
  const shape = header.match(/'shape':\s*\(([^)]*)\)/)![1]
    .split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const dtypeMatch = header.match(/'descr':\s*'([^']+)'/);
  const dtype = dtypeMatch ? dtypeMatch[1] : '<f4';
  const bytes = dtype === '<f8' || dtype === '|f8' ? 8 : 4;
  const off = buf.byteOffset + headerStart + headerLen;
  const count = (buf.length - headerStart - headerLen) / bytes;
  const data = bytes === 8 ? new Float64Array(buf.buffer, off, count)
    : new Float32Array(buf.buffer, off, count);
  return { data, shape };
}

function fieldMax(jobDir: string, name: string): number {
  const { data } = readF32(jobDir, name);
  let m = -Infinity;
  for (let i = 0; i < data.length; i++) if (data[i] > m) m = data[i];
  return m;
}

async function runToCompletion(params: any, timeoutMs: number): Promise<string> {
  const job = await startSimulation(params);
  await vi.waitFor(
    () => {
      const j = simRunner.getJobStatus(job.id);
      expect(j?.status).toBe('complete');
    },
    { timeout: timeoutMs, interval: 100 },
  );
  return job.id;
}

describe.skipIf(!pythonOk)('local kernels — real python3 end-to-end', () => {
  it('earthquake GMPE ShakeMap completes fast with physical PGA/PGV/MMI', async () => {
    const t0 = Date.now();
    const id = await runToCompletion({
      type: 'earthquake_swarm', lat: 35.68, lon: 139.65,
      grid_size: 256, extent_km: 128, magnitude: 7.0, depth_km: 10,
    }, 30_000);
    const elapsed = Date.now() - t0;
    const dir = path.join(RESULTS_DIR, id);
    for (const f of ['pga_cm_s2', 'pgv_cm_s', 'sa_1s_cm_s2', 'mmi',
                     'snapshots_pga', 'snapshot_times']) {
      expect(fs.existsSync(path.join(dir, `${f}.npy`)), `${f}.npy missing`).toBe(true);
    }
    // ShakeMovie arrival animation: the final frame must equal the static peak
    // map (no regression), and an early frame must be a strict subset (the
    // wavefront has not yet reached the whole domain).
    const snaps = readF32(dir, 'snapshots_pga');
    const staticPga = readF32(dir, 'pga_cm_s2');
    const [F, R, C] = snaps.shape;
    const lastOff = (F - 1) * R * C;
    let maxDiff = 0;
    for (let i = 0; i < R * C; i++) maxDiff = Math.max(maxDiff, Math.abs(snaps.data[lastOff + i] - staticPga.data[i]));
    expect(maxDiff).toBeLessThan(1e-2);
    const nz = (off: number) => { let c = 0; for (let i = 0; i < R * C; i++) if (snaps.data[off + i] > 0.01) c++; return c; };
    expect(nz(0)).toBeLessThan(nz(lastOff)); // frame 0 is a partial reveal
    // BSSA14 (Boore et al. 2014) median for M7 @ 10 km hypocentral, Vs30=760
    // rock: PGA ~0.25g (~246 cm/s²), PGV ~24 cm/s, instrumental intensity ~VII.
    // Assert the published-order medians AND PGA<->PGV<->MMI consistency.
    const pga = fieldMax(dir, 'pga_cm_s2');
    expect(pga).toBeGreaterThan(150);
    expect(pga).toBeLessThan(500);
    const pgv = fieldMax(dir, 'pgv_cm_s');
    expect(pgv).toBeGreaterThan(15);
    expect(pgv).toBeLessThan(60);
    // PGV/PGA ratio must be physical (~0.05-0.2 s) — catches unit slips.
    expect(pgv / pga).toBeGreaterThanOrEqual(0.05);
    expect(pgv / pga).toBeLessThanOrEqual(0.2);
    const mmi = fieldMax(dir, 'mmi');
    expect(mmi).toBeGreaterThanOrEqual(6);
    expect(mmi).toBeLessThanOrEqual(8);
    expect(elapsed).toBeLessThan(20_000);
  });

  it('wildfire Rothermel spreads on real (or synthetic) terrain and burns cells', async () => {
    const id = await runToCompletion({
      type: 'wildfire_spread', lat: 38.5, lon: -121.5,
      grid_size: 128, extent_km: 10, wind_speed_ms: 10, wind_dir_deg: 270,
      humidity_pct: 15, duration_hours: 1, fuel_type: 'grass', seed: 42,
    }, 60_000);
    const dir = path.join(RESULTS_DIR, id);
    for (const f of ['fire_state', 'fire_intensity', 'snapshots_intensity', 'snapshot_times']) {
      expect(fs.existsSync(path.join(dir, `${f}.npy`)), `${f}.npy missing`).toBe(true);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    const extent = meta.final_stats.burned_cells + meta.final_stats.burning_cells;
    // A grassland fire at 10 m/s must spread well beyond the ignition cell.
    expect(extent).toBeGreaterThan(100);
    expect(meta.completed).toBe(true);
    expect(meta.metadata.terrain_source).toBeTruthy();
  });

  it('earthquake epicenter pin radiates the field from the clicked point', async () => {
    // Pin the epicentre to the SW-ish quadrant (frac x=0.2 east, y=0.8 south);
    // the PGA peak must land there, not at the box centre.
    const id = await runToCompletion({
      type: 'earthquake_swarm', lat: 37.0, lon: 15.0,
      grid_size: 128, extent_km: 64, magnitude: 7.0, depth_km: 10,
      epi_frac_x: 0.2, epi_frac_y: 0.8,
    }, 30_000);
    const dir = path.join(RESULTS_DIR, id);
    const { data, shape } = readF32(dir, 'pga_cm_s2');
    const gs = shape[0];
    let peak = 0, pi = 0, pj = 0;
    for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) {
      const v = data[i * gs + j]; if (v > peak) { peak = v; pi = i; pj = j; }
    }
    expect(pj / (gs - 1)).toBeCloseTo(0.2, 1); // east fraction
    expect(pi / (gs - 1)).toBeCloseTo(0.8, 1); // south fraction
  });

  it('hurricane Holland+SWE kernel runs locally, passes its physics gate, and is fast', async () => {
    const t0 = Date.now();
    const id = await runToCompletion({
      type: 'hurricane_landfall', lat: 29.3, lon: -94.8,
      grid_size: 192, extent_km: 240, category: 4,
      central_pressure_hpa: 946, radius_max_wind_km: 32,
      forward_speed_kmh: 30, duration_hours: 6,
    }, 120_000);
    const elapsed = Date.now() - t0;
    const dir = path.join(RESULTS_DIR, id);
    for (const f of ['wind_speed', 'wind_direction', 'surge_height', 'wave_setup',
                     'wave_height', 'rainfall', 'runoff', 'snapshots_wind',
                     'snapshots_surge', 'snapshot_times']) {
      expect(fs.existsSync(path.join(dir, `${f}.npy`)), `${f}.npy missing`).toBe(true);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(meta.completed).toBe(true);
    // Cat-4 Holland Vmax = 70 m/s: max observed wind must be within the
    // gradient-wind + translation window (never below 0.9·Vmax, never above
    // Vmax + forward speed + tolerance).
    const vmax = 70;
    const fwd = 30 / 3.6;
    const maxWind = meta.final_stats.max_wind_ms;
    expect(maxWind).toBeGreaterThan(vmax * 0.9);
    expect(maxWind).toBeLessThanOrEqual(vmax + fwd + 5);
    // Surge: physically bounded (SLOSH extreme landfall < ~10 m).
    expect(meta.final_stats.max_surge_m).toBeGreaterThan(0.2);
    expect(meta.final_stats.max_surge_m).toBeLessThan(12);
    // Rain must feed runoff: both nonzero, runoff ≤ rainfall (SCS-CN mass balance).
    expect(meta.final_stats.max_rainfall_mm).toBeGreaterThan(10);
    expect(meta.final_stats.max_runoff_mm).toBeLessThanOrEqual(meta.final_stats.max_rainfall_mm);
    // Lonfat-2007 footprint: rain extends to ~500 km, so a 240-km domain is
    // broadly wetted (the old 60-km exponential left most of the box dry).
    const rain = readF32(dir, 'rainfall');
    const wetFrac = Array.from(rain.data).filter((v) => v > 1).length / rain.data.length;
    expect(wetFrac).toBeGreaterThan(0.5);
    // Peak 6-h accumulation for a Cat-4 in a physical band (tens–hundreds of mm).
    expect(meta.final_stats.max_rainfall_mm).toBeGreaterThan(50);
    expect(meta.final_stats.max_rainfall_mm).toBeLessThan(1200);
    // "No PC heating" contract: a 6 h landfall finishes in well under a minute.
    expect(elapsed).toBeLessThan(60_000);
    expect(meta.metadata.elapsed_seconds).toBeLessThan(55);
  });

  it('hurricane honors real Cesium terrain when shipped in params', async () => {
    // 192×192 synthetic-but-real-shaped DEM: ocean west (negative), land east.
    const gs = 192;
    const terrain: number[] = [];
    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) {
        const x = c / (gs - 1);
        terrain.push(x < 0.4 ? -40 * (0.4 - x) / 0.4 * 5 : 2 + 60 * (x - 0.4));
      }
    }
    const id = await runToCompletion({
      type: 'hurricane_landfall', lat: 29.3, lon: -94.8,
      grid_size: gs, extent_km: 240, category: 3,
      central_pressure_hpa: 965, radius_max_wind_km: 40,
      forward_speed_kmh: 25, duration_hours: 3,
      terrain, terrain_gs: gs,
    }, 120_000);
    const dir = path.join(RESULTS_DIR, id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(meta.metadata.terrain_source).toBe('cesium_globe');
    const elev = readF32(dir, 'terrain');
    expect(elev.shape).toEqual([gs, gs]);
    expect(elev.data[0]).toBeLessThan(0); // ocean corner preserved
  });

  it('hurricane landfall pin moves the eye to the pinned track point at mid-run', async () => {
    const gs = 128;
    const id = await runToCompletion({
      type: 'hurricane_landfall', lat: 29.3, lon: -94.8,
      grid_size: gs, extent_km: 240, category: 4,
      central_pressure_hpa: 946, radius_max_wind_km: 32,
      forward_speed_kmh: 30, duration_hours: 6, heading_deg: 90,
      track_frac_x: 0.25, track_frac_y: 0.5,
    }, 120_000);
    const dir = path.join(RESULTS_DIR, id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
    expect(meta.params.track_frac_x).toBeCloseTo(0.25, 2);
    expect(meta.params.track_frac_y).toBeCloseTo(0.5, 2);
    // The mid-run snapshot's strongest winds must sit nearer the pinned track
    // point than the box centre (the eye passes the pin at mid-duration; the
    // residual offset is the physical right-front wind asymmetry).
    const snaps = readF32(dir, 'snapshots_wind');
    const times = readF32(dir, 'snapshot_times');
    const [F, R, C] = snaps.shape;
    let mid = 0; let best = Infinity;
    for (let f = 0; f < F; f++) { const d = Math.abs(times.data[f] - 3.0); if (d < best) { best = d; mid = f; } }
    let peak = -1, pi = 0, pj = 0;
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const v = snaps.data[(mid * R + i) * C + j]; if (v > peak) { peak = v; pi = i; pj = j; }
    }
    const fx = pj / (C - 1), fy = pi / (R - 1);
    const dPin = Math.hypot(fx - 0.25, fy - 0.5);
    const dCtr = Math.hypot(fx - 0.5, fy - 0.5);
    expect(dPin).toBeLessThan(dCtr);
  });
});
