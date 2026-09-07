/**
 * Time-series comparison math (roadmap item 5) — pure, unit-tested helpers
 * so the SERVER computes deltas instead of the LLM doing arithmetic on raw
 * arrays (the failure mode of handing it 90 daily POWER values).
 */

// ── Earthquake period comparison ──────────────────────────────────

export interface QuakeFeatureLite {
  properties?: { time?: number | string; mag?: number | null };
}
export interface PeriodStats {
  count: number;
  maxMag: number | null;
  avgMag: number | null;
}

function toMs(t: unknown): number | null {
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  if (typeof t === 'string') {
    const n = Date.parse(t);
    if (!Number.isNaN(n)) return n;
    const asNum = Number(t);
    if (Number.isFinite(asNum)) return asNum;
  }
  return null;
}

function statsOf(timesMags: Array<{ mag: number }>): PeriodStats {
  if (timesMags.length === 0) return { count: 0, maxMag: null, avgMag: null };
  const mags = timesMags.map(t => t.mag);
  return {
    count: timesMags.length,
    maxMag: Math.round(Math.max(...mags) * 10) / 10,
    avgMag: Math.round((mags.reduce((s, m) => s + m, 0) / mags.length) * 100) / 100,
  };
}

/**
 * Split USGS features into "current" (time >= splitMs) and "previous"
 * (splitMs > time >= splitMs - periodMs) buckets. Features without a usable
 * time or magnitude are ignored (never guessed).
 */
export function bucketQuakePeriods(
  features: QuakeFeatureLite[],
  splitMs: number,
  periodMs: number,
): { current: PeriodStats; previous: PeriodStats } {
  const cur: Array<{ mag: number }> = [];
  const prev: Array<{ mag: number }> = [];
  for (const f of features || []) {
    const t = toMs(f?.properties?.time);
    const mag = f?.properties?.mag;
    if (t === null || typeof mag !== 'number' || !Number.isFinite(mag)) continue;
    if (t >= splitMs) cur.push({ mag });
    else if (t >= splitMs - periodMs) prev.push({ mag });
  }
  return { current: statsOf(cur), previous: statsOf(prev) };
}

export function quakeDelta(current: PeriodStats, previous: PeriodStats): { deltaCount: number; pctChange: number | null } {
  const deltaCount = current.count - previous.count;
  const pctChange = previous.count > 0
    ? Math.round((deltaCount / previous.count) * 1000) / 10
    : null; // no baseline → refuse to invent a percentage
  return { deltaCount, pctChange };
}

// ── NASA POWER daily series ───────────────────────────────────────

/** POWER returns { "20260901": 28.7, ... } with -99/-999 sentinels for missing. */
export function powerMean(series: Record<string, number> | undefined | null): { mean: number | null; n: number; min: number | null; max: number | null } {
  const vals = Object.values(series || {}).filter(v =>
    typeof v === 'number' && Number.isFinite(v) && v > -90, // drop -99/-999 missing sentinels
  );
  if (vals.length === 0) return { mean: null, n: 0, min: null, max: null };
  return {
    mean: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10,
    n: vals.length,
    min: Math.round(Math.min(...vals) * 10) / 10,
    max: Math.round(Math.max(...vals) * 10) / 10,
  };
}

// ── NSIDC sea-ice annual means ────────────────────────────────────

export interface SeaIceAnnualMean { year: number; meanExtentMkm2: number; days: number }

/**
 * NSIDC daily CSV rows: [year, month, day, extent, ...]. Averages extent per
 * calendar year; keeps every year with >= 30 days of data (partial current
 * year included but flagged by its low day count).
 */
export function annualMeansFromNsidc(lines: string[]): SeaIceAnnualMean[] {
  const byYear = new Map<number, { sum: number; n: number }>();
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
    if (parts.length < 4) continue;
    const year = parseInt(parts[0], 10);
    const extent = parseFloat(parts[3]);
    if (!Number.isFinite(year) || year < 1970 || !Number.isFinite(extent) || extent < 0) continue;
    const cur = byYear.get(year) || { sum: 0, n: 0 };
    cur.sum += extent; cur.n++;
    byYear.set(year, cur);
  }
  return [...byYear.entries()]
    .filter(([, v]) => v.n >= 30)
    .map(([year, v]) => ({ year, meanExtentMkm2: Math.round((v.sum / v.n) * 100) / 100, days: v.n }))
    .sort((a, b) => a.year - b.year);
}
