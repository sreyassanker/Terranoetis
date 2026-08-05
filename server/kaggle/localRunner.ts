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