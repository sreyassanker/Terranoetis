/**
 * localRunner.ts — executes the landslide kernel *locally* via python3.
 *
 * The Kaggle pipeline (push → poll → download) is ~seconds-to-minutes per run,
 * far too slow for calibration (a μ×ξ grid) or Monte-Carlo UQ (N runs). For
 * those the server shells out to `python3`, imports the SAME `simulate_landslide`
 * kernel from `kaggle-kernels/landslide-sim/main.py`, and runs all samples in one
 * process (amortising the numpy import). The kernel is therefore the single
 * source of truth for both the GPU path and the local scientific endpoints.
 *
 * Two modes:
 *   - scalars:   run each trial, return {mu, xi, runout_km, max_depth, area_km2}.
 *   - montecarlo: run N stochastic samples, return aggregated depth maps
 *                 (mean / min / max / exceedance) + a summary of runout/depth.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const KAGGLE_KERNELS_DIR = path.resolve(process.cwd(), 'kaggle-kernels');
const LANDSLIDE_KERNEL_DIR = path.join(KAGGLE_KERNELS_DIR, 'landslide-sim');
const VOLCANIC_KERNEL_DIR = path.join(KAGGLE_KERNELS_DIR, 'volcano-sim');

export type LocalRunMode = 'scalars' | 'montecarlo';

export interface CalibrateRow {
  mu: number;
  xi: number;
  runout_km: number;
  max_depth: number;
  area_km2: number;
}

export interface MonteCarloResult {
  gs: number;
  exceedance_threshold_m: number;
  mean: number[];
  min: number[];
  max: number[];
  exceedance: number[];
  summary: {
    n: number;
    p50_runout_km: number;
    p95_runout_km: number;
    max_runout_km: number;
    mean_max_depth_m: number;
    p95_max_depth_m: number;
    area_exceeded_pct: number;
  };
}

export interface VolcanicEnsembleResult {
  gs: number;
  exceedance_threshold_mm: number;
  /** Per-cell aggregated ash deposit thickness (mm) */
  ash_p5: number[];
  ash_p50: number[];
  ash_p95: number[];
  ash_mean: number[];
  ash_min: number[];
  ash_max: number[];
  ash_exceedance: number[];
  /** Per-cell aggregated lava thickness (m) */
  lava_p5: number[];
  lava_p50: number[];
  lava_p95: number[];
  lava_mean: number[];
  lava_min: number[];
  lava_max: number[];
  lava_exceedance: number[];
  summary: {
    n: number;
    p50_max_ash_mm: number;
    p95_max_ash_mm: number;
    max_ash_mm: number;
    p50_max_lava_m: number;
    p95_max_lava_m: number;
    max_lava_m: number;
    mean_plume_height_km: number;
    p50_plume_height_km: number;
    area_ash_exceeded_pct: number;
    /** Per-member stats */
    member_max_ash_mm: number[];
    member_max_lava_m: number[];
    member_plume_height_km: number[];
    member_settling_velocity_ms: number[];
  };
}

/** A single yield_scale trial for lava rheology calibration. */
export interface VolcanicCalibrateRow {
  yield_scale: number;
  runout_km: number;
  max_lava_m: number;
  affected_area_km2: number;
}

// One-process Python driver. Reads a JSON payload on stdin:
//   { "mode": "scalars"|"montecarlo", "kernel_dir": "...", "runs": [ {...}, ... ],
//     "exceedance_depth_m": 0.5 }
// and prints a single `__RESULT__` / `__ERROR__` line to stdout.
const PYTHON_DRIVER = String.raw`
import json, sys, os, traceback
payload = json.load(sys.stdin)
sys.path.insert(0, payload.get('kernel_dir', os.getcwd()))
import numpy as np
import main as m
runs = payload['runs']
mode = payload.get('mode', 'scalars')
try:
    if mode == 'montecarlo':
        depths = []
        runouts = []
        for p in runs:
            r = m.simulate_landslide(p)
            depths.append(np.asarray(r['final']['landslide_depth'], dtype=float))
            runouts.append(float(r['final']['max_runout_km']))
        d = np.stack(depths)
        thr = float(payload.get('exceedance_depth_m', 0.5))
        runo = np.asarray(runouts)
        out = {
            'gs': int(d.shape[1]),
            'exceedance_threshold_m': thr,
            'mean': d.mean(0).ravel().tolist(),
            'min': d.min(0).ravel().tolist(),
            'max': d.max(0).ravel().tolist(),
            'exceedance': (d > thr).mean(0).ravel().tolist(),
            'summary': {
                'n': int(len(runs)),
                'p50_runout_km': float(np.median(runo)),
                'p95_runout_km': float(np.percentile(runo, 95)),
                'max_runout_km': float(runo.max()),
                'mean_max_depth_m': float(d.max(1).mean()),
                'p95_max_depth_m': float(np.percentile(d.max(1), 95)),
                'area_exceeded_pct': float((d.max(0) > thr).mean()),
            },
        }
    else:
        rows = []
        for p in runs:
            r = m.simulate_landslide(p)
            rows.append({
                'mu': float(p.get('mu', 0.0)),
                'xi': float(p.get('xi', 0.0)),
                'runout_km': float(r['final']['max_runout_km']),
                'max_depth': float(r['final']['max_depth']),
                'area_km2': float(r['final']['affected_area_km2']),
            })
        out = {'trials': rows}
    print('__RESULT__' + json.dumps(out))
except Exception:
    print('__ERROR__' + traceback.format_exc().replace(chr(10), '\\\\n'))
`;

/**
 * Volcano Monte-Carlo Python driver. Reads a JSON payload on stdin:
 *   { "runs": [ {...}, ... ], "exceedance_ash_mm": 0.5 }
 * and prints a single `__RESULT__` / `__ERROR__` line to stdout.
 * Each run is a full volcano simulation request (with terrain, vent, etc.).
 */
const VOLCANIC_PYTHON_DRIVER = String.raw`
import json, sys, os, traceback
payload = json.load(sys.stdin)
sys.path.insert(0, payload.get('kernel_dir', os.getcwd()))
import numpy as np
import main as m
runs = payload['runs']
mode = payload.get('mode', 'volcanic')
try:
    if mode == 'volcanic_calibrate':
        # Scalars mode: fit lava rheology (yield_scale) to an observed runout.
        rows = []
        for p in runs:
            r = m.simulate_volcano(p)
            f = r['final']
            rows.append({
                'yield_scale': float(p.get('yield_scale', 1.0)),
                'runout_km': float(f.get('max_runout_km', 0.0)),
                'max_lava_m': float(f.get('max_lava_thickness_m', 0.0)),
                'affected_area_km2': float(f.get('affected_area_km2', 0.0)),
            })
        out = {'trials': rows}
    else:
        ashes = []
        lavas = []
        col_heights = []
        settling_vels = []
        for p in runs:
            r = m.simulate_volcano(p)
            final = r['final']
            ashes.append(np.asarray(final['ash_deposit'], dtype=np.float64))
            lavas.append(np.asarray(final['lava_thickness'], dtype=np.float64))
            col_heights.append(float(r['metadata'].get('plume_height_m', 0)) / 1000.0)
            settling_vels.append(float(r['metadata'].get('settling_velocity_ms', 0)))
        a = np.stack(ashes)  # convert kg/m² to mm (numerically equal: 1 kg/m² → 1 mm @ 1000 kg/m³)
        l = np.stack(lavas)
        thr = float(payload.get('exceedance_ash_mm', 0.5))
        # Per-member maxima over the full grid (reshape (n, gs, gs) → (n, gs²))
        a_max_member = a.reshape(a.shape[0], -1).max(1)
        l_max_member = l.reshape(l.shape[0], -1).max(1)

        def pct(arr, p):
            return np.percentile(arr, p, axis=0).ravel().tolist()

        out = {
            'gs': int(a.shape[1]),
            'exceedance_threshold_mm': thr,
            'ash_p5': pct(a, 5),
            'ash_p50': pct(a, 50),
            'ash_p95': pct(a, 95),
            'ash_mean': a.mean(0).ravel().tolist(),
            'ash_min': a.min(0).ravel().tolist(),
            'ash_max': a.max(0).ravel().tolist(),
            'ash_exceedance': (a > thr).mean(0).ravel().tolist(),
            'lava_p5': pct(l, 5),
            'lava_p50': pct(l, 50),
            'lava_p95': pct(l, 95),
            'lava_mean': l.mean(0).ravel().tolist(),
            'lava_min': l.min(0).ravel().tolist(),
            'lava_max': l.max(0).ravel().tolist(),
            'lava_exceedance': (l > 0.01).mean(0).ravel().tolist(),
            'summary': {
                'n': int(len(runs)),
                'p50_max_ash_mm': float(np.median(a_max_member)),
                'p95_max_ash_mm': float(np.percentile(a_max_member, 95)),
                'max_ash_mm': float(a_max_member.max()),
                'p50_max_lava_m': float(np.median(l_max_member)),
                'p95_max_lava_m': float(np.percentile(l_max_member, 95)),
                'max_lava_m': float(l_max_member.max()),
                'mean_plume_height_km': float(np.mean(col_heights)),
                'p50_plume_height_km': float(np.median(col_heights)),
                'area_ash_exceeded_pct': float((a.max(0) > thr).mean()),
                'member_max_ash_mm': [float(x) for x in a_max_member.tolist()],
                'member_max_lava_m': [float(x) for x in l_max_member.tolist()],
                'member_plume_height_km': [float(x) for x in col_heights],
                'member_settling_velocity_ms': [float(x) for x in settling_vels],
            },
        }
    print('__RESULT__' + json.dumps(out))
except Exception:
    print('__ERROR__' + traceback.format_exc().replace(chr(10), '\\\\n'))
`;

interface DriverPayload {
  mode: LocalRunMode;
  kernel_dir: string;
  runs: Record<string, unknown>[];
  exceedance_depth_m?: number;
}

function parseResult(stdout: string): Record<string, unknown> {
  for (const line of stdout.split('\n')) {
    if (line.startsWith('__RESULT__')) {
      return JSON.parse(line.slice('__RESULT__'.length)) as Record<string, unknown>;
    }
    if (line.startsWith('__ERROR__')) {
      throw new Error(`Kernel error:\n${line.slice('__ERROR__'.length)}`);
    }
  }
  throw new Error('Kernel produced no result line');
}

/**
 * Run a batch of landslide simulations locally in one python process.
 * `gridSize` overrides each run's resolution so every sample shares one shape.
 */
export async function runLocalBatch(
  mode: LocalRunMode,
  runs: Record<string, unknown>[],
  options: { gridSize?: number; timeoutMs?: number; exceedanceDepthM?: number } = {},
): Promise<Record<string, unknown>> {
  if (runs.length === 0) throw new Error('No runs supplied');
  const gridSize = options.gridSize ?? 128;
  const payload: DriverPayload = {
    mode,
    kernel_dir: LANDSLIDE_KERNEL_DIR,
    runs: runs.map((p) => ({ ...p, grid_size: gridSize, extent_km: p.extent_km ?? 5.0 })),
    ...(mode === 'montecarlo' && options.exceedanceDepthM != null
      ? { exceedance_depth_m: options.exceedanceDepthM } : {}),
  };

  // Write the driver to a temp file and pipe the payload on stdin — avoids all
  // shell-quoting hazards of `python3 -c "..."` (backslashes/newlines).
  const driverPath = path.join(os.tmpdir(), `terranoetis-local-driver-${process.pid}.py`);
  fs.writeFileSync(driverPath, PYTHON_DRIVER);

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn('python3', [driverPath], {
      cwd: LANDSLIDE_KERNEL_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Local kernel batch timed out'));
    }, options.timeoutMs ?? 300_000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.includes('__RESULT__')) {
        reject(new Error(`python3 exited ${code}: ${(err || out).slice(-2000)}`));
        return;
      }
      resolve(out);
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  }).finally(() => {
    try { fs.rmSync(driverPath, { force: true }); } catch { /* best effort */ }
  });

  return parseResult(stdout);
}

/**
 * Run a batch of volcanic simulations locally in one python process.
 *
 * Unlike the landslide batch (which forces `terrain: undefined` so every trial
 * shares a synthetic field), each volcanic run carries its OWN real terrain
 * array + terrain_gs + vent fractions. `gridSize` overrides the grid so every
 * member shares one shape; the kernel bilinearly resamples the real terrain to
 * that grid.
 */
export async function runLocalVolcanicBatch(
  runs: Record<string, unknown>[],
  options: { gridSize?: number; timeoutMs?: number; exceedanceAshMm?: number } = {},
): Promise<VolcanicEnsembleResult> {
  if (runs.length === 0) throw new Error('No runs supplied');
  const gridSize = options.gridSize ?? 128;
  const payload: Record<string, unknown> = {
    mode: 'volcanic',
    kernel_dir: VOLCANIC_KERNEL_DIR,
    runs: runs.map((p) => ({
      ...p,
      grid_size: gridSize,
      extent_km: p.extent_km ?? 10.0,
    })),
  };
  if (options.exceedanceAshMm != null) payload.exceedance_ash_mm = options.exceedanceAshMm;

  const driverPath = path.join(os.tmpdir(), `terranoetis-volcano-driver-${process.pid}.py`);
  fs.writeFileSync(driverPath, VOLCANIC_PYTHON_DRIVER);

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn('python3', [driverPath], {
      cwd: VOLCANIC_KERNEL_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Local volcanic batch timed out'));
    }, options.timeoutMs ?? 300_000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.includes('__RESULT__')) {
        reject(new Error(`python3 exited ${code}: ${(err || out).slice(-2000)}`));
        return;
      }
      resolve(out);
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  }).finally(() => {
    try { fs.rmSync(driverPath, { force: true }); } catch { /* best effort */ }
  });

  return parseResult(stdout) as unknown as VolcanicEnsembleResult;
}

/**
 * Run a batch of volcanic simulations for lava rheology calibration.
 * Sweeps `yield_scale` and returns the modelled runout for each trial.
 */
export async function runLocalVolcanicCalibration(
  runs: Record<string, unknown>[],
  options: { gridSize?: number; timeoutMs?: number } = {},
): Promise<{ trials: VolcanicCalibrateRow[] }> {
  if (runs.length === 0) throw new Error('No runs supplied');
  const gridSize = options.gridSize ?? 128;
  const payload: Record<string, unknown> = {
    mode: 'volcanic_calibrate',
    kernel_dir: VOLCANIC_KERNEL_DIR,
    runs: runs.map((p) => ({
      ...p,
      grid_size: gridSize,
      extent_km: p.extent_km ?? 10.0,
    })),
  };

  const driverPath = path.join(os.tmpdir(), `terranoetis-volcano-calib-${process.pid}.py`);
  fs.writeFileSync(driverPath, VOLCANIC_PYTHON_DRIVER);

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn('python3', [driverPath], {
      cwd: VOLCANIC_KERNEL_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Local volcanic calibration timed out'));
    }, options.timeoutMs ?? 300_000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.includes('__RESULT__')) {
        reject(new Error(`python3 exited ${code}: ${(err || out).slice(-2000)}`));
        return;
      }
      resolve(out);
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  }).finally(() => {
    try { fs.rmSync(driverPath, { force: true }); } catch { /* best effort */ }
  });

  return parseResult(stdout) as unknown as { trials: VolcanicCalibrateRow[] };
}