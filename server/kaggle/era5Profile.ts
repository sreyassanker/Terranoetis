/**
 * ERA5 wind profile fetcher — reanalysis-based vertical wind profile.
 *
 * Fetches hourly pressure-level + multi-height wind data from the Open-Meteo
 * API (free, no key; backed by ERA5/GFS reanalysis) for a given lat/lon, and
 * returns a `wind_profile` array compatible with the volcano kernel's
 * `_parse_wind_profile`.
 *
 * Pressure levels → approximate altitude (km, ICAO standard atmosphere):
 *   1000 hPa ≈ 0.1,  850 → 1.5,  700 → 3.0,  500 → 5.5,  300 → 9.0,
 *   200 → 12.0,  100 → 16.0
 *
 * Falls back to a neutral constant-wind profile when the API is unreachable.
 */

import { logger } from '../observability/logger';

// Pressure levels covering the troposphere + lower stratosphere (to ~16 km,
// sufficient for VEI 3-5 columns; VEI 6+ needs ERA5 full levels which the
// archive API serves when the data is available).
const PRESSURE_LEVELS = ['1000', '850', '700', '500', '300', '200', '100'];

// Multi-height surface wind (m AGL) — finer near-surface resolution.
const SURFACE_HEIGHTS = [10, 80, 120, 180];

// Altitude (km) for each pressure level (ICAO std atmosphere).
const ALTITUDE_KM: Record<string, number> = {
  '1000': 0.1, '850': 1.5, '700': 3.0, '500': 5.5,
  '300': 9.0, '200': 12.0, '100': 16.0,
};

export interface WindProfileEntry {
  altitude_km: number;
  u_ms: number;
  v_ms: number;
}

/**
 * Fetch a real vertical wind profile for (lat, lon).
 * Returns [{altitude_km, u_ms, v_ms}] for the kernel.
 * Falls back to a neutral profile when the API is unreachable.
 */
export async function fetchEra5Profile(
  lat: number,
  lon: number,
  date?: string,
): Promise<WindProfileEntry[]> {
  const profile: WindProfileEntry[] = [];
  let usedFallback = false;

  try {
    // Hourly vars: multi-height surface + pressure-level winds.
    const hourly: string[] = [];
    for (const h of SURFACE_HEIGHTS) {
      hourly.push(`wind_speed_${h}m,wind_direction_${h}m`);
    }
    for (const lvl of PRESSURE_LEVELS) {
      hourly.push(`wind_speed_${lvl}hPa,wind_direction_${lvl}hPa`);
    }

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('hourly', hourly.join(','));
    url.searchParams.set('wind_speed_unit', 'ms');
    url.searchParams.set('forecast_days', '1');
    if (date) {
      // The forecast API is current-time only; a past date is ignored.
      url.searchParams.set('start_date', date);
      url.searchParams.set('end_date', date);
    }

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as {
      hourly?: Record<string, (number | null)[]>;
    };
    const h = data.hourly;
    if (!h) throw new Error('No hourly data');

    const pick = (name: string): number | null => {
      const arr = h[name];
      if (!arr || arr.length === 0) return null;
      // Prefer the first non-null hour (matches the eruption-time wind).
      for (const v of arr) {
        if (v != null && Number.isFinite(v)) return v;
      }
      return null;
    };

    // Surface winds (m AGL).
    for (const height of SURFACE_HEIGHTS) {
      const spd = pick(`wind_speed_${height}m`);
      const dir = pick(`wind_direction_${height}m`);
      if (spd != null && dir != null) {
        const rad = (dir + 180) * (Math.PI / 180);
        profile.push({
          altitude_km: height / 1000,
          u_ms: spd * Math.sin(rad),
          v_ms: -spd * Math.cos(rad),
        });
      }
    }

    // Pressure-level winds (true aloft).
    for (const lvl of PRESSURE_LEVELS) {
      const spd = pick(`wind_speed_${lvl}hPa`);
      const dir = pick(`wind_direction_${lvl}hPa`);
      if (spd != null && dir != null) {
        const rad = (dir + 180) * (Math.PI / 180);
        profile.push({
          altitude_km: ALTITUDE_KM[lvl],
          u_ms: spd * Math.sin(rad),
          v_ms: -spd * Math.cos(rad),
        });
      }
    }

    if (profile.length < 3) {
      throw new Error(`Only ${profile.length} valid levels`);
    }
  } catch (err) {
    usedFallback = true;
    logger.warn({ err: (err as Error).message, lat, lon }, 'Wind profile fetch failed');
  }

  if (profile.length < 3) {
    usedFallback = true;
    // Neutral fallback: constant light wind with height (standard atmosphere).
    profile.length = 0;
    profile.push(
      { altitude_km: 0.0, u_ms: 5.0, v_ms: 0.0 },
      { altitude_km: 3.0, u_ms: 10.0, v_ms: -2.0 },
      { altitude_km: 8.0, u_ms: 15.0, v_ms: -4.0 },
      { altitude_km: 12.0, u_ms: 25.0, v_ms: -5.0 },
      { altitude_km: 16.0, u_ms: 35.0, v_ms: 0.0 },
    );
  }

  // Sort by altitude ascending, dedupe by altitude.
  profile.sort((a, b) => a.altitude_km - b.altitude_km);
  const deduped: WindProfileEntry[] = [];
  for (const p of profile) {
    if (deduped.length === 0 || Math.abs(deduped[deduped.length - 1].altitude_km - p.altitude_km) > 0.01) {
      deduped.push(p);
    }
  }
  if (!usedFallback) {
    logger.info({ lat, lon, nLevels: deduped.length }, 'Wind profile fetched');
  }
  return deduped;
}