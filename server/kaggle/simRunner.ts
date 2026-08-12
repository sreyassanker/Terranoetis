/**
 * Kaggle GPU Integration — Batch physics simulation backend
 *
 * Workflow:
 * 1. Write params.json to kernel folder
 * 2. `kaggle kernels push` (triggers run on GPU)
 * 3. Poll `kaggle kernels status` until complete
 * 4. `kaggle kernels output` to download results
 * 5. Load results into frontend
 */

import { execFile, type ExecFileException } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { logger } from '../observability/logger';
import { pauseBackgroundEngines, resumeBackgroundEngines } from './powerSaver';
import { sampleLandCoverGrid, compactLandCover } from './landCover';
import { sampleBathymetryGrid, compactBathymetry } from './bathymetry';

const KAGGLE_KERNELS_DIR = path.resolve(process.cwd(), 'kaggle-kernels');
const RESULTS_DIR = path.resolve(process.cwd(), 'kaggle-kernels', 'results');
const POLL_INTERVAL_MS = Number(process.env.KAGGLE_POLL_INTERVAL_MS) || 15_000; // 15 s between status checks
const JOB_CLEANUP_AGE_MS = 3600_000; // 1 hour — remove completed jobs after this
const MAX_POLL_MS = 45 * 60_000; // 45 min hard cap on a Kaggle run
const MAX_CONSECUTIVE_POLL_ERRORS = 10; // give up polling after repeated transient failures
const POST_PUSH_SETTLE_MS = Number(process.env.KAGGLE_POST_PUSH_SETTLE_MS) || 8_000; // let the new run register before polling
// Tolerate a pre-start "error" from the status API for this long. Because every
// push reuses the same kernel slug and Kaggle's status endpoint is only
// eventually consistent, a freshly-pushed run can be reported with the PREVIOUS
// run's terminal 'error' for a couple of minutes until the new version registers.
const STALE_ERROR_GRACE_MS = Number(process.env.KAGGLE_STALE_ERROR_GRACE_MS) || 180_000; // 3 min
const NOAA_TIDE_FETCH_LIMIT = 8;

// ═════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════

export type SimulationType =
  | 'flood_inundation'
  | 'wildfire_spread'
  | 'earthquake_swarm'
  | 'tsunami_wave'
  | 'hurricane_landfall'
  | 'volcanic_eruption'
  | 'landslide';

export interface SimulationParams {
  type: SimulationType;
  lat: number;
  lon: number;
  /** Grid resolution (default 512) */
  grid_size?: number;
  /** Duration in hours */
  duration_hours?: number;
  /** Type-specific params */
  [key: string]: unknown;
}

export interface SimulationJob {
  id: string;
  type: SimulationType;
  status: 'pending' | 'pushing' | 'running' | 'downloading' | 'complete' | 'error';
  params: SimulationParams;
  createdAt: string;
  completedAt?: string;
  kernelSlug?: string;
  error?: string;
  resultPath?: string;
  cancelled?: boolean;
}

type StatusListener = (status: SimulationJob['status'], detail?: string, jobId?: string) => void;

// SSE listeners — fan-out, so multiple clients can subscribe to the same job.
const jobListeners = new Map<string, Set<StatusListener>>();

function notifyStatus(job: SimulationJob, status: SimulationJob['status'], detail?: string): void {
  const set = jobListeners.get(job.id);
  if (!set) return;
  for (const listener of set) {
    try { listener(status, detail, job.id); } catch { /* swallow client errors */ }
  }
}

function addJobListener(jobId: string, listener: StatusListener): () => void {
  let set = jobListeners.get(jobId);
  if (!set) {
    set = new Set();
    jobListeners.set(jobId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) jobListeners.delete(jobId);
  };
}

function updateJobStatus(job: SimulationJob, status: SimulationJob['status'], detail?: string) {
  job.status = status;
  if (status === 'error') job.error = detail ?? job.error;
  notifyStatus(job, status, detail);
  logger.info({ jobId: job.id, type: job.type, status, detail }, 'Simulation job status');
}

// Map simulation types to kernel folders AND their actual Kaggle slugs
// The slug is auto-generated from the title in kernel-metadata.json
const KERNEL_REGISTRY: Record<SimulationType, { folder: string; slug: string }> = {
  flood_inundation:     { folder: 'flood-sim',     slug: 'terranoetis-flood-swe-simulation' },
  wildfire_spread:      { folder: 'fire-sim',       slug: 'terranoetis-wildfire-spread-simulation' },
  earthquake_swarm:     { folder: 'earthquake-sim',  slug: 'terranoetis-earthquake-shakemap-simulation' },
  tsunami_wave:         { folder: 'tsunami-sim',     slug: 'terranoetis-tsunami-wave-propagation-simulation' },
  hurricane_landfall:   { folder: 'hurricane-sim',   slug: 'terranoetis-hurricane-wind-surge-simulation' },
  volcanic_eruption:    { folder: 'volcano-sim',     slug: 'terranoetis-volcanic-eruption-simulation' },
  landslide:            { folder: 'landslide-sim',   slug: 'terranoetis-landslide-debris-flow-simulation' },
};

// In-memory job tracking (with automatic cleanup)
const activeJobs = new Map<string, SimulationJob>();

// ═════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchNoaaTideStations(): Promise<Array<{ id: string; name: string; lat: number; lon: number; state?: string }>> {
  const resp = await fetch(
    'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels',
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!resp.ok) return [];
  const body = await resp.json() as { stations?: Array<Record<string, unknown>> };
  return (body.stations ?? [])
    .map((s) => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      lat: Number(s.lat ?? NaN),
      lon: Number(s.lng ?? NaN),
      state: String(s.state ?? ''),
    }))
    .filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

async function fetchNoaaWaterLevelSeries(stationId: string): Promise<{ observed_times_min: number[]; observed_eta_m: number[] } | null> {
  try {
    const resp = await fetch(
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${encodeURIComponent(stationId)}&product=water_level&date=today&datum=MLLW&units=metric&format=json&time_zone=gmt`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!resp.ok) return null;
    const body = await resp.json() as { data?: Array<{ t?: string; v?: string }> };
    const data = body.data ?? [];
    if (data.length < 2) return null;
    const first = new Date(`${data[0].t}Z`).getTime();
    const observed_times_min: number[] = [];
    const observed_eta_m: number[] = [];
    for (const row of data.slice(0, 240)) {
      if (!row.t || row.v === undefined || row.v === 'null') continue;
      const ts = new Date(`${row.t}Z`).getTime();
      const eta = Number.parseFloat(row.v);
      if (!Number.isFinite(ts) || !Number.isFinite(eta)) continue;
      observed_times_min.push((ts - first) / 60000);
      observed_eta_m.push(eta);
    }
    if (observed_times_min.length < 2) return null;
    return { observed_times_min, observed_eta_m };
  } catch (err) {
    logger.warn({ err, stationId }, 'NOAA water level fetch failed');
    return null;
  }
}

async function attachAutoTideBenchmarks(embedded: Record<string, unknown>): Promise<void> {
  if (Array.isArray(embedded.benchmark_stations) && embedded.benchmark_stations.length > 0) return;
  const { lat, lon } = embedded;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lon !== 'number' || !Number.isFinite(lon)) return;

  try {
    const stations = await fetchNoaaTideStations();
    if (stations.length === 0) return;
    const nearby = stations
      .map((s) => ({ ...s, distanceKm: haversineKm(lat, lon, s.lat, s.lon) }))
      .filter((s) => s.distanceKm <= 2500)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, NOAA_TIDE_FETCH_LIMIT);

    const benchmarks: Array<Record<string, unknown>> = [];
    for (const station of nearby) {
      const series = await fetchNoaaWaterLevelSeries(station.id);
      if (!series) continue;
      benchmarks.push({
        name: `${station.name}${station.state ? `, ${station.state}` : ''}`,
        row: 0,
        col: 0,
        observed_times_min: series.observed_times_min,
        observed_eta_m: series.observed_eta_m,
        arrival_threshold_m: Math.max(0.05, 0.1 * Math.max(...series.observed_eta_m.map((v) => Math.abs(v)))),
        station_id: station.id,
        station_lat: station.lat,
        station_lon: station.lon,
        distance_km: Number(station.distanceKm.toFixed(1)),
        source: 'NOAA CO-OPS',
      });
    }

    if (benchmarks.length > 0) {
      embedded.benchmark_stations = benchmarks;
      logger.info({ count: benchmarks.length }, 'Attached NOAA tide benchmark stations for tsunami sim');
    }
  } catch (err) {
    logger.warn({ err }, 'Auto NOAA tide benchmark attachment failed');
  }
}

/**
 * Periodically clean up old completed/errored jobs to prevent memory leaks.
 */
function startJobCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of activeJobs) {
      if (job.status === 'complete' || job.status === 'error') {
        const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : now;
        if (now - completedAt > JOB_CLEANUP_AGE_MS) {
          activeJobs.delete(id);
          logger.debug({ jobId: id }, 'Cleaned up old job');
        }
      }
    }
  }, JOB_CLEANUP_AGE_MS);
}
if (process.env.NODE_ENV !== 'test') startJobCleanup();

// ═════════════════════════════════════════════════════════════════
// KAGGLE CLI WRAPPER
// ═════════════════════════════════════════════════════════════════

let kaggleBinCache: string | null = null;
let kaggleBinResolved = false;

/**
 * Resolve the `kaggle` CLI binary to an absolute path.
 *
 * The server is often launched via npm, which sanitises PATH (dropping
 * `~/.local/bin`), so `kaggle` may not be resolvable through the shell. We
 * therefore search known install locations explicitly and cache the result.
 */
function resolveKaggleBin(): string {
  if (kaggleBinResolved) return kaggleBinCache!;
  kaggleBinResolved = true;

  const candidates = [
    process.env.KAGGLE_BIN,
    path.join(process.env.HOME || '~', '.local', 'bin', 'kaggle'),
    path.join(process.env.HOME || '~', 'bin', 'kaggle'),
    '/usr/local/bin/kaggle',
    '/opt/homebrew/bin/kaggle',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      kaggleBinCache = candidate;
      return candidate;
    }
  }

  // Last resort: rely on PATH lookup.
  kaggleBinCache = 'kaggle';
  return kaggleBinCache;
}

/**
 * Run a Kaggle CLI command via execFile (no shell), so PATH quirks from the
 * hosting process can't break `kaggle kernels push` et al.
 *
 * Wrapped manually (not via promisify) because execFile delivers the child's
 * stdout/stderr as separate callback args — promisify discards them on failure,
 * and Kaggle CLI v2.x prints actionable errors to STDOUT, leaving err.message
 * as a useless bare "Command failed: ...". We capture both streams and surface
 * them in the thrown error.
 */
function runKaggle(args: string[], timeoutMs = 120_000): Promise<string> {
  const bin = resolveKaggleBin();
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        timeout: timeoutMs, // 2 min for push commands
        env: { ...process.env, KAGGLE_CONFIG_DIR: path.join(process.env.HOME || '~', '.kaggle') },
      },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        if (err) {
          const detail = [stdout, stderr].filter(Boolean).join('\n').trim();
          const message = detail ? `${err.message}\n${detail}` : err.message;
          const wrapped = new Error(message) as Error & { code?: string | number | null; signal?: string | null };
          wrapped.code = err.code;
          wrapped.signal = err.signal;
          reject(wrapped);
          return;
        }
        if (stderr && !stderr.includes('Warning')) {
          logger.warn({ cmd: `${bin} ${args.join(' ')}`, stderr }, 'Kaggle CLI stderr');
        }
        resolve(stdout.trim());
      },
    );
  });
}

async function kaggleCommand(args: string[]): Promise<string> {
  const bin = resolveKaggleBin();
  const cmd = `${bin} ${args.join(' ')}`;
  try {
    return await runKaggle(args);
  } catch (err: unknown) {
    logger.error({ cmd, error: err instanceof Error ? err.message : String(err) }, 'Kaggle CLI error');
    throw new Error(`Kaggle command failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function pushKernel(kernelDir: string): Promise<void> {
  await kaggleCommand(['kernels', 'push', '-p', kernelDir]);
}

/**
 * Compact a 256×256 real-terrain grid so the embedded kernel stays under
 * Kaggle's upload size limit. A raw float array balloons main.py to ~1.2 MB
 * and Kaggle's SaveKernel API rejects it with 400 Bad Request. Quantizing each
 * cell to uint16 (min/span-normalized — sub-decimetre vertical precision over a
 * typical box) and base64-encoding it shrinks the payload to ~175 KB.
 *
 * Decoded on the kernel side from `terrain_b64` + `terrain_min` + `terrain_span`
 * (kept alongside the existing `terrain_gs`). Returns null when there is
 * nothing usable to ship (empty/all-non-finite), so the caller falls back to
 * the kernel's synthetic terrain.
 */
function compactTerrain(terrain: number[]): { terrain_b64: string; terrain_min: number; terrain_span: number } | null {
  if (!Array.isArray(terrain) || terrain.length === 0) {
    return null;
  }
  let min = Infinity;
  let max = -Infinity;
  let finite = 0;
  let sum = 0;
  for (const v of terrain) {
    if (Number.isFinite(v)) {
      finite++;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
  }
  if (finite === 0) {
    return null;
  }
  // Clamp NaN/undefined heights to the minimum valid height (never 0/sea level).
  // Encoding them as 0 would produce flat synthetic terrain on the kernel side.
  const safeMin = min;
  const span = max - min || 1;
  const buf = Buffer.alloc(terrain.length * 2);
  for (let i = 0; i < terrain.length; i++) {
    const v = terrain[i];
    const q = Number.isFinite(v)
      ? Math.round(((v - min) / span) * 65534)
      : Math.round(((safeMin - min) / span) * 65534); // clamp to min, not sentinel
    buf.writeUInt16LE(q, i * 2);
  }
  const mean = sum / finite;
  const b64 = buf.toString('base64');
  logger.info(
    { grid: `${Math.round(Math.sqrt(terrain.length))}x${Math.round(Math.sqrt(terrain.length))}`,
      elevMin: min, elevMax: max, elevMean: mean, base64Len: b64.length },
    '[simRunner] terrain compacted',
  );
  return {
    terrain_b64: b64,
    terrain_min: min,
    terrain_span: span,
  };
}

/**
 * Enforce a hard wall-clock on a best-effort side fetch so a slow third-party
 * datasource (ESA S3) can never delay the kernel push.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

const LANDCOVER_FETCH_TIMEOUT_MS = 25_000;

/**
 * Attach a per-cell ESA WorldCover land-cover grid to a flood run so the
 * kernel can use spatially variable Manning's n instead of one constant.
 *
 * Precedence:
 *   1. An explicit `landcover` array from the client (sampled + compacted).
 *   2. Automatic server-side sampling of the study box from ESA WorldCover.
 *   3. Nothing — the kernel falls back to its constant Manning's n.
 *
 * The fetch is best-effort and never blocks the push on failure.
 */
async function attachLandCover(embedded: Record<string, unknown>): Promise<boolean> {
  if (Array.isArray(embedded.landcover)) {
    const compact = compactLandCover(embedded.landcover as number[]);
    delete embedded.landcover;
    if (compact) {
      embedded.landcover_b64 = compact.landcover_b64;
      embedded.landcover_gs = compact.landcover_gs;
    }
    return Boolean(compact);
  }

  const { lat, lon, extent_km, grid_size } = embedded;
  if (
    typeof lat !== 'number' || !Number.isFinite(lat) ||
    typeof lon !== 'number' || !Number.isFinite(lon) ||
    typeof extent_km !== 'number' || !Number.isFinite(extent_km) || extent_km <= 0
  ) {
    return false;
  }
  const gs = typeof grid_size === 'number' && grid_size > 0 ? grid_size : 256;

  try {
    const grid = await withTimeout(
      sampleLandCoverGrid({ lat, lon, extentKm: extent_km, gs }),
      LANDCOVER_FETCH_TIMEOUT_MS,
    );
    if (!grid) {
      logger.warn({ lat, lon, extentKm: extent_km }, 'Land cover unavailable — kernel will use constant Manning n');
      return false;
    }
    const compact = compactLandCover(grid.classes);
    if (!compact) return false;
    embedded.landcover_b64 = compact.landcover_b64;
    embedded.landcover_gs = compact.landcover_gs;
    const top = Object.entries(grid.histogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name} ${Math.round((count / grid.classes.length) * 100)}%`);
    logger.info(
      { lat, lon, grid: `${grid.gs}x${grid.gs}`, coveragePct: Number(grid.coveragePct.toFixed(1)), top },
      'Land cover sampled for flood sim',
    );
    return true;
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Land cover fetch failed — kernel will use constant Manning n',
    );
    return false;
  }
}

const BATHYMETRY_FETCH_TIMEOUT_MS = 25_000;

/**
 * Attach a real GEBCO 2020 bathymetry grid to a tsunami run so the kernel
 * propagates over the actual seafloor instead of a synthetic parabolic bowl.
 *
 * Precedence:
 *   1. An explicit `bathymetry` array from the client (sampled + compacted).
 *   2. Automatic server-side sampling of the study box from GEBCO 2020.
 *   3. Nothing — the kernel falls back to its synthetic bathymetry.
 *
 * The fetch is best-effort and never blocks the push on failure.
 */
async function attachBathymetry(embedded: Record<string, unknown>): Promise<boolean> {
  if (Array.isArray(embedded.bathymetry)) {
    const compact = compactBathymetry(embedded.bathymetry as number[]);
    delete embedded.bathymetry;
    if (compact) {
     embedded.bathy_b64 = compact.bathy_b64;
     embedded.bathy_gs = compact.bathy_gs;
     embedded.bathy_min = compact.bathy_min;
     embedded.bathy_span = compact.bathy_span;
      return true;
    }
    return false;
  }

  const { lat, lon, extent_km, grid_size } = embedded;
  if (
    typeof lat !== 'number' || !Number.isFinite(lat) ||
    typeof lon !== 'number' || !Number.isFinite(lon) ||
    typeof extent_km !== 'number' || !Number.isFinite(extent_km) || extent_km <= 0
  ) {
    return false;
  }
  const gs = typeof grid_size === 'number' && grid_size > 0 ? grid_size : 256;

  try {
    const grid = await withTimeout(
      sampleBathymetryGrid({ lat, lon, extentKm: extent_km, gs }),
      BATHYMETRY_FETCH_TIMEOUT_MS,
    );
    if (!grid) {
      logger.warn({ lat, lon, extentKm: extent_km }, 'Bathymetry unavailable — tsunami run requires a real GEBCO grid');
      return false;
    }
    const compact = compactBathymetry(grid.depth);
    if (!compact) return false;
    embedded.bathy_b64 = compact.bathy_b64;
    embedded.bathy_gs = compact.bathy_gs;
    embedded.bathy_min = compact.bathy_min;
    embedded.bathy_span = compact.bathy_span;
    logger.info(
      { lat, lon, grid: `${grid.sampleGs}x${grid.sampleGs}`,
        coveragePct: Number(grid.coveragePct.toFixed(1)) },
      'Bathymetry sampled for tsunami sim',
    );
    return true;
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Bathymetry fetch failed — tsunami run requires a real GEBCO grid',
    );
    return false;
  }
}

// Measured rates (simulated hours per wall-clock second) for each kernel on a
// Kaggle GPU at grid 256. Flood is calibrated empirically: a 256² / 12 h run
// advanced 7.384 h in 480 s → 0.01538 h/s. Other types reuse flood's rate as a
// starting point until they are benchmarked individually.
const GRID_REF = 256;
const WALLCLOCK_RATES_H_PER_S: Record<string, number> = {
  flood_inundation: 0.01538,
};
// Floor != the kernel's 480 s default: anything ≤ 480 reproduces the old
// truncated "Partial ⚠️" behavior. Ceiling bounds Kaggle GPU quota burn.
const WALLCLOCK_MIN_SEC = 480;
const WALLCLOCK_MAX_SEC = 1500;

/**
 * Compute a wall-clock budget (seconds) long enough for the kernel to finish
 * the requested duration. Without this, every kernel falls back to its 480 s
 * default cap and every app run returns `completed: false` → "Partial".
 * Adds ~25% headroom + boot time and clamps to [480, 1500]s.
 */
function estimateWallclockSeconds(params: SimulationParams): number {
  const gs = params.grid_size || GRID_REF;
  const durationHours = params.duration_hours || 12;
  const rate =
    (WALLCLOCK_RATES_H_PER_S[params.type] ?? WALLCLOCK_RATES_H_PER_S.flood_inundation) *
    (GRID_REF / gs) ** 2;
  const needed = (durationHours / Math.max(rate, 1e-6)) * 1.25 + 30;
  return Math.round(Math.min(WALLCLOCK_MAX_SEC, Math.max(WALLCLOCK_MIN_SEC, needed)));
}

/**
 * Kaggle's CLI only uploads the code file + kernel-metadata.json — sibling
 * files such as params.json never reach the runner. So we bake the run's
 * params directly into the code: replace the `EMBEDDED_PARAMS = None` marker
 * line in main.py, stage a temp kernel folder, and push from there.
 */
async function pushKernelWithParams(kernelDir: string, params: SimulationParams): Promise<void> {
  const metadataPath = path.join(kernelDir, 'kernel-metadata.json');
  const mainPyPath = path.join(kernelDir, 'main.py');
  if (!fs.existsSync(mainPyPath) || !fs.existsSync(metadataPath)) {
    throw new Error(`Kernel folder incomplete (missing main.py or kernel-metadata.json): ${kernelDir}`);
  }

  const code = fs.readFileSync(mainPyPath, 'utf-8');
  const marker = 'EMBEDDED_PARAMS = None';
  if (!code.includes(marker)) {
    throw new Error(`Kernel ${kernelDir} is missing the EMBEDDED_PARAMS marker`);
  }
  // Shrink large payloads before embedding: a 256×256 real-terrain grid as a
  // JSON float array would exceed Kaggle's kernel size limit (400 Bad Request).
  const embedded: Record<string, unknown> = { ...params };
  embedded.wallclock_max_sec = estimateWallclockSeconds(params);
  if (Array.isArray(embedded.terrain)) {
    const compact = compactTerrain(embedded.terrain as number[]);
    delete embedded.terrain;
    if (compact) {
      embedded.terrain_b64 = compact.terrain_b64;
      embedded.terrain_min = compact.terrain_min;
      embedded.terrain_span = compact.terrain_span;
    }
  }
  // Real land cover → per-cell Manning's n (flood only, best-effort).
  if (params.type === 'flood_inundation') {
    await attachLandCover(embedded);
  }
  // Real GEBCO 2020 bathymetry → real seafloor (tsunami only, best-effort).
  if (params.type === 'tsunami_wave') {
    const attached = await attachBathymetry(embedded);
    if (!attached) {
      throw new Error('Real GEBCO bathymetry is required for tsunami runs; synthetic fallback is disabled.');
    }
    await attachAutoTideBenchmarks(embedded);
  }
  // Embed the params as a JSON *string literal*. A raw `JSON.stringify` dump
  // is not valid Python (lowercase `true`/`false`/`null` crash the kernel with
  // NameError — every flood run sets `dam_breach: true`). `JSON.stringify` on
  // the outer string escapes `"`/`\`/newlines, so the payload always parses as
  // a Python string, and `json.loads` on the kernel side restores the dict.
  const injected = code.replace(
    marker,
    `EMBEDDED_PARAMS = json.loads(${JSON.stringify(JSON.stringify(embedded))})`,
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaggle-push-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'main.py'), injected);
    fs.copyFileSync(metadataPath, path.join(tmpDir, 'kernel-metadata.json'));
    await pushKernel(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function getKernelStatus(ownerSlug: string): Promise<string> {
  const output = await kaggleCommand(['kernels', 'status', ownerSlug]);
  // Kaggle CLI v2.x outputs: "owner/kernel has status \"KernelWorkerStatus.COMPLETE\""
  // Older versions output just: "complete"
  const match = output.match(/KernelWorkerStatus\.(\w+)/i);
  if (match) {
    return match[1].toLowerCase();
  }
  return output.toLowerCase().trim();
}

async function downloadOutput(ownerSlug: string, outputDir: string): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  await kaggleCommand(['kernels', 'output', ownerSlug, '-p', outputDir, '--force']);
}

async function cancelKernel(ownerSlug: string): Promise<void> {
  try {
    await kaggleCommand(['kernels', 'cancel', ownerSlug]);
  } catch {
    logger.warn({ ownerSlug }, 'Failed to cancel Kaggle kernel (may already be done)');
  }
}

/**
 * After a genuine Kaggle kernel failure, pull the kernel's working-dir output
 * and surface the real crash reason. The kernel's main() writes the Python
 * traceback to `/kaggle/working/error.log` before re-raising (which is what
 * flips the job status to 'error'), so downloading the output turns Kaggle's
 * bare "error" status into an actionable message. Falls back gracefully when
 * the kernel produced no harvestable output.
 */
async function harvestErrorDetail(ownerSlug: string, status: string, context?: string): Promise<string> {
  const base = `Kaggle kernel ${status}`;
  const fallback = (): string => (context ? `${base} — ${context}` : base);
  let dlDir: string | null = null;
  try {
    dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaggle-err-'));
    await downloadOutput(ownerSlug, dlDir);
    const files = fs.readdirSync(dlDir);
    const errorLog = files.find(f => f.toLowerCase() === 'error.log');
    if (errorLog) {
      const trace = fs.readFileSync(path.join(dlDir, errorLog), 'utf-8').trim();
      if (trace) {
        const tail = trace.split('\n').slice(-12).join('\n');
        logger.error({ ownerSlug, trace: trace.slice(0, 4000) }, 'Kaggle kernel failure trace captured');
        return `${base} — kernel crashed:\n${tail}`;
      }
    }
    return files.length > 0 ? `${base} — ran but failed (${files.length} output file(s), no error.log)` : fallback();
  } catch (err) {
    logger.warn(
      { ownerSlug, error: err instanceof Error ? err.message : String(err) },
      'Failed to harvest Kaggle kernel error output',
    );
    return fallback();
  } finally {
    if (dlDir) fs.rmSync(dlDir, { recursive: true, force: true });
  }
}

// ═════════════════════════════════════════════════════════════════
// SIMULATION JOB MANAGEMENT
// ═════════════════════════════════════════════════════════════════

/**
 * Start a simulation job on Kaggle GPU.
 * Returns the job ID immediately; results come asynchronously.
 */
export async function startSimulation(params: SimulationParams): Promise<SimulationJob> {
  const jobId = `sim_${randomUUID().slice(0, 8)}`;
  const registry = KERNEL_REGISTRY[params.type];

  if (!registry) {
    throw new Error(`Unknown simulation type: ${params.type}`);
  }

  const { folder: kernelFolder, slug: kernelSlug } = registry;
  const kernelDir = path.join(KAGGLE_KERNELS_DIR, kernelFolder);
  if (!fs.existsSync(kernelDir)) {
    throw new Error(`Kernel directory not found: ${kernelDir}`);
  }

  const ownerSlug = `sreyassanker/${kernelSlug}`;
  const job: SimulationJob = {
    id: jobId,
    type: params.type,
    status: 'pending',
    params,
    createdAt: new Date().toISOString(),
    kernelSlug: ownerSlug,
  };

  activeJobs.set(jobId, job);

  // Suspend non-essential background engines so the local machine stays cool
  // while the GPU work runs on Kaggle.
  pauseBackgroundEngines();

  // Run the pipeline async (don't await — return job immediately)
  runPipeline(job, kernelDir, ownerSlug)
    .catch(err => {
      job.status = 'error';
      job.error = err.message;
      job.completedAt = new Date().toISOString();
      updateJobStatus(job, 'error', err.message);
    })
    .finally(() => {
      // Detach listeners after terminal state so SSE clients get the final write.
      resumeBackgroundEngines();
    });

  return job;
}

/**
 * Get the status of a running simulation job.
 */
export function getJobStatus(jobId: string): SimulationJob | undefined {
  return activeJobs.get(jobId);
}

/**
 * Get all active jobs.
 */
export function getAllJobs(): SimulationJob[] {
  return Array.from(activeJobs.values());
}

/**
 * Cancel a running simulation: cancels the Kaggle kernel and stops polling.
 */
export function cancelJob(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  if (job.status === 'complete' || job.status === 'error') return false;
  job.cancelled = true;
  // Mark terminal right away — do NOT wait up to one full poll tick.
  // We stay truthful about the Kaggle-side cancellation (fire-and-forget)
  // by letting the poll loop's next iteration call cancelKernel().
  updateJobStatus(job, 'error', 'Simulation cancelled by user');
  return true;
}

/**
 * Load simulation results from disk.
 */
export function loadResults(jobId: string): Record<string, unknown> | null {
  const job = activeJobs.get(jobId);
  if (!job?.resultPath || !fs.existsSync(job.resultPath)) return null;

  const metaPath = path.join(job.resultPath, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════
// PIPELINE: push → poll → download
// ═════════════════════════════════════════════════════════════════

async function runPipeline(
  job: SimulationJob,
  kernelDir: string,
  ownerSlug: string,
): Promise<void> {
  const startTime = Date.now();

  try {
    // ── Step 1: Push kernel with params embedded in the code file ──
    updateJobStatus(job, 'pushing', 'Uploading to Kaggle GPU...');
    await pushKernelWithParams(kernelDir, job.params);
    updateJobStatus(job, 'running', 'Kernel pushed. Kaggle GPU booting...');
    logger.info({ jobId: job.id, ownerSlug }, 'Kernel pushed to Kaggle');

    // ── Step 3: Poll for completion with a hard timeout so a hung kernel
    //    doesn't burn Kaggle GPU quota (and the local machine) forever. ──
    //
    // RACE-CONDITION GUARD: `kaggle kernels push` reuses the same kernel slug,
    // so immediately after a push the status endpoint may still report the
    // PREVIOUS run's terminal state (e.g. "error" from a stale run) before the
    // new run has started. We therefore:
    //   1. Wait a few seconds after push before the first poll.
    //   2. Track whether we've seen the kernel in a non-error state. If an
    //      "error" arrives BEFORE any non-error status, it's almost certainly
    //      stale (or an early crash) — tolerate it up to STALE_ERROR_GRACE_MS
    //      instead of failing the new run with a false negative.
    //   3. If "error" arrives AFTER we've seen "running"/"queue", the kernel
    //      actually ran and failed — fail immediately and harvest error.log so
    //      the user sees the real Python traceback.
    let lastStatus = '';
    let sawComplete = false;
    let consecutiveErrors = 0;
    let sawNonErrorState = false; // have we seen running/queue/complete?
    let staleErrorSince: number | null = null; // when the current pre-start error streak began

    // Give the freshly-pushed kernel time to register on Kaggle's status API.
    // Without this, the first poll can return the previous run's status.
    await sleep(POST_PUSH_SETTLE_MS);

    while (true) {
      if (job.cancelled) {
        await cancelKernel(ownerSlug);
        updateJobStatus(job, 'error', 'Simulation cancelled by user');
        return;
      }
      if (Date.now() - startTime > MAX_POLL_MS) {
        await cancelKernel(ownerSlug);
        updateJobStatus(job, 'error', `Kaggle kernel timed out after ${MAX_POLL_MS / 60000} min — cancelled`);
        return;
      }

      await sleep(POLL_INTERVAL_MS);

      try {
        const status = await getKernelStatus(ownerSlug);
        consecutiveErrors = 0;
        if (status !== lastStatus) {
          updateJobStatus(job, 'running', `Kaggle status: ${status}`);
          lastStatus = status;
        }

        if (status === 'complete') {
          sawComplete = true;
          break;
        }
        // 'queue' is a non-terminal pre-run state — the kernel is waiting for
        // a GPU. Treat it as "running" for staleness-tracking purposes.
        if (status === 'running' || status === 'queue' || status === 'queued') {
          sawNonErrorState = true;
          staleErrorSince = null; // the new run is visibly starting — fresh slate
        }
        if (status === 'error' || status === 'cancel') {
          if (!sawNonErrorState) {
            // Error before we ever saw the new run start. Since the push reuses
            // the same kernel slug and Kaggle's status API is eventually
            // consistent, this is usually the PREVIOUS run's stale terminal
            // state lingering until the new version registers — OR a kernel
            // that crashed within its first poll window. Tolerate it for a
            // generous grace window instead of failing a run that may still be
            // starting.
            if (staleErrorSince === null) staleErrorSince = Date.now();
            if (Date.now() - staleErrorSince < STALE_ERROR_GRACE_MS) {
              const waited = Math.round((Date.now() - staleErrorSince) / 1000);
              logger.warn(
                { jobId: job.id, status, waitedSec: waited, graceSec: STALE_ERROR_GRACE_MS / 1000 },
                'Kaggle kernel error before run started — likely stale status, still waiting for the new run',
              );
              updateJobStatus(job, 'running', `Waiting for new run to start (stale status)… ${waited}s`);
              continue;
            }
            // The new run never registered (or crashed before appearing as
            // running) — tell the user which, using whatever the kernel wrote.
            const msg = await harvestErrorDetail(
              ownerSlug,
              status,
              `no run start detected after ${Math.round(STALE_ERROR_GRACE_MS / 1000)}s (stale status or early crash)`,
            );
            updateJobStatus(job, 'error', msg);
            return;
          }
          // We saw the kernel start (running/queue), then it errored — this is
          // a genuine run failure. Pull the kernel's error.log so the user sees
          // the real Python traceback instead of a bare "error".
          const msg = await harvestErrorDetail(ownerSlug, status);
          updateJobStatus(job, 'error', msg);
          return;
        }
      } catch (err: unknown) {
        // Transient errors during polling — retry a bounded number of times
        consecutiveErrors++;
        logger.warn({ jobId: job.id, error: err instanceof Error ? err.message : String(err) }, 'Poll error, retrying...');
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          await cancelKernel(ownerSlug);
          updateJobStatus(job, 'error', 'Kaggle kernel polling failed repeatedly — cancelled');
          return;
        }
      }
    }

    if (!sawComplete) {
      updateJobStatus(job, 'error', 'Simulation ended without completion');
      return;
    }

    // ── Step 4: Download results ──
    updateJobStatus(job, 'downloading', 'Downloading results from Kaggle...');
    const resultDir = path.join(RESULTS_DIR, job.id);
    await downloadOutput(ownerSlug, resultDir);

    job.resultPath = resultDir;
    job.status = 'complete';
    job.completedAt = new Date().toISOString();
    updateJobStatus(job, 'complete', `Done in ${((Date.now() - startTime) / 1000).toFixed(0)}s`);

    logger.info({ jobId: job.id, resultDir, elapsed: Date.now() - startTime }, 'Simulation complete');
  } finally {
    // (no params.json cleanup needed — params are embedded in the pushed code)
  }
}

// ═════════════════════════════════════════════════════════════════
// SSE STREAMING (Server-Sent Events for real-time status)
// ═════════════════════════════════════════════════════════════════

/**
 * Set up SSE stream for a job. The client receives status updates in real-time.
 */
export function streamJobStatus(jobId: string, res: import('express').Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const job = activeJobs.get(jobId);
  if (!job) {
    res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
    res.end();
    return;
  }

  // Send current status immediately
  res.write(`data: ${JSON.stringify({ status: job.status, detail: '', jobId })}\n\n`);

  // If already done, close immediately
  if (job.status === 'complete' || job.status === 'error') {
    res.end();
    return;
  }

  // Fan-out listener — multiple SSE clients can subscribe to the same job.
  const remove = addJobListener(jobId, (status, detail) => {
    try {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ status, detail: detail || '', jobId })}\n\n`);
      if (status === 'complete' || status === 'error') {
        setTimeout(() => { try { res.end(); } catch { /* ignore */ } }, 100);
      }
    } catch {
      // Client disconnected
    }
  });

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      if (res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      res.write(`:heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 30_000);

  res.on('close', () => {
    clearInterval(heartbeat);
    remove();
  });
}
