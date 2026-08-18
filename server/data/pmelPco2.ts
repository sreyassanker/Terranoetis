/**
 * NOAA PMEL CO₂ mooring pCO₂ — genuine observational source for the
 * air–sea CO₂ flux (Tool 56, Wanninkhof 1992).
 *
 * Source: NOAA PMEL ERDDAP tabledap `all_pmel_co2_moorings` — the
 * aggregation of the autonomous surface-ocean pCO₂ mooring network
 * (Sutton et al. 2019, "Autonomous seawater pCO2 and pH time series from
 * 40 surface buoys and the emergence of anthropogenic trends", Earth
 * System Science Data 11:421–439, https://doi.org/10.5194/essd-11-421-2019).
 * Each mooring reports in-situ seawater pCO₂ (pCO2_sw, µatm), air pCO₂
 * (pCO2_air, µatm), SST (°C) and SSS (PSU) at ~hourly resolution. These
 * are direct measurements of the exact quantities Wanninkhof (1992)
 * requires: the air–sea partial-pressure gradient ΔpCO₂ and the
 * temperature/salinity fields for the Schmidt number and CO₂ solubility.
 *
 * Two-stage ERDDAP query: (1) the distinct station list (small), then
 * (2) the nearest station's time series over a ±90-day window around the
 * requested date (or the most recent ~180 days when no date is given).
 * The sample closest in time to the request that carries a finite
 * pCO2_sw is returned. A null is returned (never a fabricated value) when
 * no station is within 1000 km or no sample has data in the window.
 */

const PMEL_BASE =
  'https://data.pmel.noaa.gov/pmel/erddap/tabledap/all_pmel_co2_moorings.json';
const MAX_STATION_DISTANCE_KM = 1000;
const WINDOW_DAYS = 90;
const RECENT_WINDOW_DAYS = 180;

interface Station {
  station: string;
  lat: number;
  lon: number;
}

export interface PmelPco2Sample {
  station: string;
  lat: number;
  lon: number;
  distanceKm: number;
  /** Absolute time offset of the served sample from the requested date (days). */
  dtDays: number;
  /** ISO timestamp of the served sample. */
  time: string;
  /** In-situ seawater pCO₂ (µatm) — measured at the mooring intake. */
  pCO2_sw: number;
  /** In-situ air pCO₂ (µatm) — measured at the mooring mast. */
  pCO2_air: number;
  /** Sea surface temperature (°C) at the mooring. */
  SST: number;
  /** Sea surface salinity (PSU) at the mooring. */
  SSS: number;
}

interface ErddapTable {
  table?: { columnNames: string[]; rows: (string | number | null)[][] };
}

let stationCache: { at: number; stations: Station[] } | null = null;
const STATION_TTL_MS = 24 * 60 * 60 * 1000;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchJson(url: string, timeoutMs = 40000): Promise<ErddapTable | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Terranoetis/1.0 (analytical tools; genuine-source audit)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null; // 404 = no matching rows (valid empty result)
    const text = await res.text();
    const data = JSON.parse(text) as ErddapTable;
    if (!data.table || !Array.isArray(data.table.rows)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Stage 1 — the distinct mooring station list (lat/lon only, cached 24 h). */
async function fetchPmelStations(): Promise<Station[] | null> {
  if (stationCache && Date.now() - stationCache.at < STATION_TTL_MS) return stationCache.stations;
  const data = await fetchJson(`${PMEL_BASE}?station_id,latitude,longitude&distinct()`);
  if (!data) return null;
  const cols = data.table!.columnNames;
  const iSt = cols.indexOf('station_id');
  const iLat = cols.indexOf('latitude');
  const iLon = cols.indexOf('longitude');
  if (iSt < 0 || iLat < 0 || iLon < 0) return null;
  const stations: Station[] = [];
  for (const row of data.table!.rows) {
    const lat = Number(row[iLat]);
    const lon = Number(row[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stations.push({ station: String(row[iSt]), lat, lon });
  }
  if (stations.length === 0) return null;
  stationCache = { at: Date.now(), stations };
  return stations;
}

function isoWindow(date: Date, daysBefore: number, daysAfter: number): { start: string; end: string } {
  const start = new Date(date.getTime() - daysBefore * 86400000);
  const end = new Date(date.getTime() + daysAfter * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10) + 'T00:00:00Z';
  return { start: fmt(start), end: fmt(end) };
}

/**
 * Fetch the nearest NOAA PMEL mooring pCO₂ sample for a point/date.
 * Returns null (honest no-data) when no mooring is within 1000 km or no
 * sample carries finite pCO₂ in the window. Never fabricates a value.
 */
export async function fetchPmelPco2(
  lat: number,
  lon: number,
  dateStr?: string,
): Promise<PmelPco2Sample | null> {
  const stations = await fetchPmelStations();
  if (!stations) return null;

  // Nearest station by haversine distance.
  let best: Station | null = null;
  let bestD = Infinity;
  for (const st of stations) {
    const d = haversineKm(lat, lon, st.lat, st.lon);
    if (d < bestD) { bestD = d; best = st; }
  }
  if (!best || bestD > MAX_STATION_DISTANCE_KM) return null;

  // Time window: ±90 days around the requested date; else the most recent
  // ~180 days (mooring deployments rotate, so recent data is the default).
  const ref = dateStr ? new Date(dateStr) : new Date();
  const win = Number.isNaN(ref.getTime())
    ? isoWindow(new Date(), RECENT_WINDOW_DAYS, 0)
    : isoWindow(ref, WINDOW_DAYS, WINDOW_DAYS);

  const url =
    `${PMEL_BASE}?time,latitude,longitude,pCO2_sw,pCO2_air,SST,SSS` +
    `&time%3E=${win.start}&time%3C=${win.end}` +
    `&station_id=%22${encodeURIComponent(best.station)}%22`;
  const data = await fetchJson(url);
  if (!data) return null;

  const cols = data.table!.columnNames;
  const iTime = cols.indexOf('time');
  const iLat = cols.indexOf('latitude');
  const iLon = cols.indexOf('longitude');
  const iSw = cols.indexOf('pCO2_sw');
  const iAir = cols.indexOf('pCO2_air');
  const iSst = cols.indexOf('SST');
  const iSss = cols.indexOf('SSS');
  if (iTime < 0 || iLat < 0 || iSw < 0) return null;

  // Pick the sample closest in time that has a finite pCO2_sw (walk the
  // whole window; moorings can drop out for maintenance).
  let bestRow: (string | number | null)[] | null = null;
  let bestDt = Infinity;
  for (const row of data.table!.rows) {
    const t = new Date(String(row[iTime]));
    if (Number.isNaN(t.getTime())) continue;
    const sw = row[iSw] == null ? Number.NaN : Number(row[iSw]);
    if (!Number.isFinite(sw)) continue;
    const dt = Math.abs(t.getTime() - ref.getTime()) / 86400000;
    if (dt < bestDt) { bestDt = dt; bestRow = row; }
  }
  if (!bestRow) return null;

  const sw = Number(bestRow[iSw]);
  const air = iAir >= 0 && bestRow[iAir] != null ? Number(bestRow[iAir]) : Number.NaN;
  const sst = iSst >= 0 && bestRow[iSst] != null ? Number(bestRow[iSst]) : Number.NaN;
  const sss = iSss >= 0 && bestRow[iSss] != null ? Number(bestRow[iSss]) : Number.NaN;
  const tLat = iLat >= 0 ? Number(bestRow[iLat]) : best.lat;
  const tLon = iLon >= 0 ? Number(bestRow[iLon]) : best.lon;

  return {
    station: best.station,
    lat: tLat,
    lon: tLon,
    distanceKm: bestD,
    dtDays: bestDt,
    time: String(bestRow[iTime]),
    pCO2_sw: sw,
    pCO2_air: air,
    SST: sst,
    SSS: sss,
  };
}
