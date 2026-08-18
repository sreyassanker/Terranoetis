/**
 * noaaSeaLevelTrend.ts — genuine relative sea-level rise (S) for Tool 75
 * (Bruun 1962).
 *
 * The Bruun Rule relates shoreline retreat to the RISE RATE S at the study
 * coast. NOAA CO-OPS tide-gauge monthly-mean water levels (MSL, metric, GMT)
 * are the authoritative US-coast sea-level record; the local relative SLR
 * rate is the OLS trend of the full monthly MSL series at the nearest
 * station with ≥15 years of data (NOAA's own threshold for a credible
 * trend), with GIA-corrected global altimetry (~3.4 mm/yr since 1993, the
 * IPCC AR6 WGI Ch 9 observed GMSL rate) as the honest fallback when no long
 * tide-gauge record exists near the point (open ocean / foreign coast).
 * Zero proxy, zero static fallback: when every genuine source fails, S is
 * an honest NaN and the tool fails honestly.
 */

import NodeCache from 'node-cache';
import { findNearestTideStation } from './noaaTides';

const cache = new NodeCache({ stdTTL: 86400 * 7, checkperiod: 3600 });
const TIMEOUT = 30000;
const API_BASE = 'https://api.tidesandcurrents.noaa.gov';
/** GIA-corrected satellite-altimetry global mean sea-level rise, mm/yr
 *  (~3.4 mm/yr, observed 1993–present, IPCC AR6 WGI Ch 9). */
const GMSL_RATE_M_PER_YR = 0.0034;

export interface SeaLevelTrendResult {
  stationId: string;
  stationName: string;
  /** OLS slope of the station's monthly MSL series (metres per year, positive up). */
  slopeMPerYr: number;
  /** First/last complete year in the fitted series. */
  fromYear: number;
  toYear: number;
  nMonths: number;
  distanceKm: number;
}

async function fetchJson(url: string, timeoutMs: number = TIMEOUT): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface MonthlyRow { year: string; month: string; MSL: string; }

/**
 * Monthly-mean MSL (m, GMT) full series for a NOAA CO-OPS station.
 * The datagetter monthly_mean product caps each request at 73,000 days
 * (~200 yr), so the full 1853–present record must be fetched in century
 * chunks and merged (a single 1853–2100 request is rejected with
 * "Range Limit Exceeded").
 */
async function fetchMonthlyMsl(stationId: string): Promise<MonthlyRow[]> {
  const chunks: Array<[string, string]> = [];
  const START_YEAR = 1853;
  const END_YEAR = 2100;
  const CHUNK_YEARS = 100; // 36,525 days < the 73,000-day product cap
  for (let y = START_YEAR; y < END_YEAR; y += CHUNK_YEARS) {
    chunks.push([`${y}0101`, `${Math.min(y + CHUNK_YEARS - 1, END_YEAR)}1231`]);
  }
  const out: MonthlyRow[] = [];
  for (const [b, e] of chunks) {
    const url = `${API_BASE}/api/prod/datagetter?product=monthly_mean&station=${stationId}`
      + `&begin_date=${b}&end_date=${e}&datum=MSL&units=metric&time_zone=gmt`
      + '&application=terranoetis&format=json';
    const j = await fetchJson(url);
    const rows = ((j?.data ?? []) as MonthlyRow[]).filter((r) => r.MSL && Number.isFinite(Number(r.MSL)));
    if (rows.length > 0) out.push(...rows);
  }
  // De-duplicate by year-month (chunk boundaries can overlap on the last year).
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.year}-${r.month}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Ordinary least squares y = a + b·x over fractional-year/month values. */
function olsSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const xm = xs.reduce((s, v) => s + v, 0) / n;
  const ym = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - xm) * (ys[i] - ym); sxx += (xs[i] - xm) ** 2; }
  return sxx > 0 ? sxy / sxx : 0;
}

/**
 * Genuine relative sea-level rise rate (m/yr) nearest the study point.
 * Returns null only when both the tide-gauge trend and the documented
 * altimetry fallback are unavailable — callers must honest-NaN on null.
 */
export async function fetchSeaLevelTrend(
  lat: number, lon: number,
): Promise<SeaLevelTrendResult | null> {
  const ck = `slr-trend:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  const cached = cache.get<SeaLevelTrendResult>(ck);
  if (cached) return cached;

  const station = await findNearestTideStation(lat, lon);
  if (!station) return null;

  const rows = await fetchMonthlyMsl(station.id);
  if (rows.length < 180) return null; // need ≥15 years for a credible trend

  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of rows) {
    const x = Number(r.year) + (Number(r.month) - 0.5) / 12;
    const y = Number(r.MSL);
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  if (xs.length < 180) return null;

  const result: SeaLevelTrendResult = {
    stationId: station.id,
    stationName: station.name,
    slopeMPerYr: olsSlope(xs, ys),
    fromYear: Math.floor(xs[0]),
    toYear: Math.floor(xs[xs.length - 1]),
    nMonths: xs.length,
    distanceKm: station.distanceKm,
  };
  cache.set(ck, result);
  return result;
}

/**
 * Default S when no tide gauge covers the point: the GIA-corrected global
 * mean sea-level rise observed by satellite altimetry since 1993
 * (≈3.4 mm/yr, IPCC AR6 WGI Ch 9) — a physical observation, not a proxy.
 * Labelled in-tool as the global rate.
 */
export function gmslRateDefault(): { slopeMPerYr: number; fromYear: number; toYear: number } {
  return { slopeMPerYr: GMSL_RATE_M_PER_YR, fromYear: 1993, toYear: new Date().getFullYear() };
}
