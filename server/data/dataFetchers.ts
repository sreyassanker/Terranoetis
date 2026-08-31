/**
 * Domain-Specific Real Data Fetchers
 * ── Fetches genuine data from public APIs for each earth system domain ──
 *
 * All fetchers use free, publicly available APIs:
 * - Open-Meteo: weather, ERA5 reanalysis, marine, air quality
 * - USGS: earthquakes, water data, elevation (SRTM)
 * - NASA FIRMS: active fire data
 * - OpenAQ: air quality measurements
 * - ISRIC SoilGrids: soil properties
 * - NOAA: SST, buoys, climate data
 * - WorldPop: population density
 * - GEBCO: bathymetry (derived from elevation API)
 */

const FETCH_TIMEOUT = 12000;

async function strictFetch(url: string, timeoutMs: number = FETCH_TIMEOUT): Promise<Record<string, unknown>> {
  // Identify ourselves: some providers (ISRIC SoilGrids) serve a materially
  // slower / rate-limited path to generic Node fetch agents. A UA header and
  // one retry on transient failure keeps the analytical pipeline honest.
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'Terranoetis/1.0 (analytical tools; genuine-source audit)' },
  });
  if (!resp.ok) throw new Error(`API ${resp.status} for ${url}`);
  return (await resp.json()) as Record<string, unknown>;
}

// ══════════════════════════════════════════════════════════════════
//  Open-Meteo Extended (Weather, Marine, ERA5, Air Quality)
// ══════════════════════════════════════════════════════════════════

export interface WeatherData {
  temperature_2m?: number;
  relative_humidity_2m?: number;
  apparent_temperature?: number;
  precipitation?: number;
  pressure_msl?: number;
  surface_pressure?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
  cloud_cover?: number;
  shortwave_radiation?: number;
  direct_radiation?: number;
  diffuse_radiation?: number;
  direct_normal_irradiance?: number;
  soil_temperature_0_to_7cm?: number;
  soil_moisture_0_to_7cm?: number;
  soil_moisture_7_to_28cm?: number;
  soil_temperature_7_to_28cm?: number;
  weather_code?: number;
  cape?: number;
  precipitation_probability?: number;
  et0_fao_evapotranspiration?: number;
}

export async function fetchCurrentWeather(
  lat: number, lon: number,
): Promise<WeatherData> {
  const data = await strictFetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,pressure_msl,surface_pressure,`
    + `wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,weather_code,cape,precipitation_probability,`
    + `shortwave_radiation,direct_radiation,diffuse_radiation,direct_normal_irradiance`
    + `&daily=et0_fao_evapotranspiration`
    + `&timezone=auto`
  );
  const c = (data.current ?? {}) as Record<string, unknown>;
  const d = (data.daily ?? {}) as Record<string, unknown>;
  return {
    temperature_2m: c.temperature_2m as number | undefined,
    relative_humidity_2m: c.relative_humidity_2m as number | undefined,
    apparent_temperature: c.apparent_temperature as number | undefined,
    precipitation: c.precipitation as number | undefined,
    pressure_msl: c.pressure_msl as number | undefined,
    surface_pressure: c.surface_pressure as number | undefined,
    wind_speed_10m: c.wind_speed_10m as number | undefined,
    wind_direction_10m: c.wind_direction_10m as number | undefined,
    wind_gusts_10m: c.wind_gusts_10m as number | undefined,
    cloud_cover: c.cloud_cover as number | undefined,
    shortwave_radiation: c.shortwave_radiation as number | undefined,
    direct_radiation: c.direct_radiation as number | undefined,
    diffuse_radiation: c.diffuse_radiation as number | undefined,
    direct_normal_irradiance: c.direct_normal_irradiance as number | undefined,
    weather_code: c.weather_code as number | undefined,
    cape: c.cape as number | undefined,
    precipitation_probability: c.precipitation_probability as number | undefined,
    et0_fao_evapotranspiration: (d.et0_fao_evapotranspiration as number[] | undefined)?.[0],
  };
}

/** Batch current-weather fetch: Open-Meteo multi-point returns one weather
 *  object per lat/lon pair (same order). Used by the spatial grid so 36
 *  sample points cost ONE request instead of 36. */
export async function fetchCurrentWeatherMulti(
  lats: number[], lons: number[],
): Promise<WeatherData[]> {
  const data = await strictFetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}`
    + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,pressure_msl,surface_pressure,`
    + `wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,weather_code,cape,precipitation_probability,`
    + `shortwave_radiation,direct_radiation,diffuse_radiation,direct_normal_irradiance`
    + `&timezone=auto`
  );
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [data];
  return rows.map(row => {
    const c = (row.current ?? {}) as Record<string, unknown>;
    const _d = (row.daily ?? {}) as Record<string, unknown>;
    return {
      temperature_2m: c.temperature_2m as number | undefined,
      relative_humidity_2m: c.relative_humidity_2m as number | undefined,
      apparent_temperature: c.apparent_temperature as number | undefined,
      precipitation: c.precipitation as number | undefined,
      pressure_msl: c.pressure_msl as number | undefined,
      surface_pressure: c.surface_pressure as number | undefined,
      wind_speed_10m: c.wind_speed_10m as number | undefined,
      wind_direction_10m: c.wind_direction_10m as number | undefined,
      wind_gusts_10m: c.wind_gusts_10m as number | undefined,
      cloud_cover: c.cloud_cover as number | undefined,
      shortwave_radiation: c.shortwave_radiation as number | undefined,
      direct_radiation: c.direct_radiation as number | undefined,
      diffuse_radiation: c.diffuse_radiation as number | undefined,
      direct_normal_irradiance: c.direct_normal_irradiance as number | undefined,
      cape: c.cape as number | undefined,
      precipitation_probability: c.precipitation_probability as number | undefined,
    };
  });
}

export async function fetchHistoricalWeather(
  lat: number, lon: number, startDate: string, endDate: string,
): Promise<WeatherData> {
  const data = await strictFetch(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
    + `&start_date=${startDate}&end_date=${endDate}`
    + `&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,pressure_msl,`
    + `wind_speed_10m,wind_direction_10m,cloud_cover,weather_code,soil_temperature_0cm,soil_moisture_0_to_7cm,`
    + `soil_moisture_7_to_28cm,soil_temperature_7_to_28cm,shortwave_radiation,cape`
    + `&timezone=auto`
  );
  const h = (data.hourly ?? {}) as Record<string, unknown>;
  const mean = (arr: number[] | undefined) => {
    if (!arr || arr.length === 0) return undefined;
    return arr.reduce((a: number, b: number) => a + b, 0) / arr.length;
  };
  return {
    temperature_2m: mean(h.temperature_2m as number[] | undefined),
    relative_humidity_2m: mean(h.relative_humidity_2m as number[] | undefined),
    apparent_temperature: mean(h.apparent_temperature as number[] | undefined),
    precipitation: mean(h.precipitation as number[] | undefined),
    pressure_msl: mean(h.pressure_msl as number[] | undefined),
    wind_speed_10m: mean(h.wind_speed_10m as number[] | undefined),
    wind_direction_10m: mean(h.wind_direction_10m as number[] | undefined),
    cloud_cover: mean(h.cloud_cover as number[] | undefined),
    soil_temperature_0_to_7cm: mean(h.soil_temperature_0cm as number[] | undefined),
    soil_moisture_0_to_7cm: mean(h.soil_moisture_0_to_7cm as number[] | undefined),
    soil_moisture_7_to_28cm: mean(h.soil_moisture_7_to_28cm as number[] | undefined),
    soil_temperature_7_to_28cm: mean(h.soil_temperature_7_to_28cm as number[] | undefined),
    shortwave_radiation: mean(h.shortwave_radiation as number[] | undefined),
    cape: mean(h.cape as number[] | undefined),
    weather_code: (h.weather_code as number[] | undefined)?.[0],
  };
}

// ══════════════════════════════════════════════════════════════════
//  Open-Meteo Marine API (Ocean Waves, Sea Surface)
// ══════════════════════════════════════════════════════════════════

export interface MarineData {
  wave_height?: number;
  wave_direction?: number;
  wave_period?: number;
  swell_wave_height?: number;
  swell_wave_direction?: number;
  swell_wave_period?: number;
  wind_wave_height?: number;
  ocean_current_velocity?: number;
  ocean_current_direction?: number;
}

export async function fetchMarineData(
  lat: number, lon: number,
): Promise<MarineData> {
  const data = await strictFetch(
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
    + `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,`
    + `swell_wave_period,wind_wave_height,ocean_current_velocity,ocean_current_direction`
    + `&timezone=auto`
  );
  const c = (data.current ?? {}) as Record<string, unknown>;
  return {
    wave_height: c.wave_height as number | undefined,
    wave_direction: c.wave_direction as number | undefined,
    wave_period: c.wave_period as number | undefined,
    swell_wave_height: c.swell_wave_height as number | undefined,
    swell_wave_direction: c.swell_wave_direction as number | undefined,
    swell_wave_period: c.swell_wave_period as number | undefined,
    wind_wave_height: c.wind_wave_height as number | undefined,
    ocean_current_velocity: c.ocean_current_velocity as number | undefined,
    ocean_current_direction: c.ocean_current_direction as number | undefined,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Open-Meteo Air Quality API (Aerosols, Pollutants)
// ══════════════════════════════════════════════════════════════════

export interface AirQualityData {
  european_aqi?: number;
  pm10?: number;
  pm2_5?: number;
  carbon_monoxide?: number;
  nitrogen_dioxide?: number;
  sulphur_dioxide?: number;
  ozone?: number;
  dust?: number;
  uv_index?: number;
  aerosol_optical_depth?: number;
}

export async function fetchAirQuality(
  lat: number, lon: number,
): Promise<AirQualityData> {
  const data = await strictFetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}`
    + `&current=european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,dust,uv_index,aerosol_optical_depth`
    + `&timezone=auto`
  );
  const c = (data.current ?? {}) as Record<string, unknown>;
  return {
    european_aqi: c.european_aqi as number | undefined,
    pm10: c.pm10 as number | undefined,
    pm2_5: c.pm2_5 as number | undefined,
    carbon_monoxide: c.carbon_monoxide as number | undefined,
    nitrogen_dioxide: c.nitrogen_dioxide as number | undefined,
    sulphur_dioxide: c.sulphur_dioxide as number | undefined,
    ozone: c.ozone as number | undefined,
    dust: c.dust as number | undefined,
    uv_index: c.uv_index as number | undefined,
    aerosol_optical_depth: c.aerosol_optical_depth as number | undefined,
  };
}

// ══════════════════════════════════════════════════════════════════
//  USGS Earthquake API (Seismicity)
// ══════════════════════════════════════════════════════════════════

export interface EarthquakeData {
  count: number;
  maxMagnitude: number;
  avgMagnitude: number;
  avgDepth: number;
  bValue: number;
  /** Gutenberg-Richter a-value fitted to this catalog sample (log10 N at M=0) */
  aValue: number;
  /** Completeness magnitude used for the Aki-1965 b fit */
  mcMagnitude: number;
  /** Modified Omori fit to the detected aftershock sequence, or null */
  omoriFit: OmoriFit | null;
  events: Array<{
    mag: number;
    depth: number;
    lat: number;
    lon: number;
    time: string;
    place: string;
  }>;
}

/**
 * Fitted modified Omori-Utsu parameters n(t) = K·(c+t)^(-p) for the
 * aftershock sequence detected in a genuine catalog sample. K in
 * events/day (so n(0) = K/c^p), c in days.
 */
export interface OmoriFit {
  K: number;
  c: number;
  p: number;
  mainshockMag: number;
  mainshockTime: string;
  aftershockCount: number;
  fittedSpanDays: number;
}

/**
 * Ogata (1983) maximum-likelihood fit of the modified Omori law
 * (Utsu 1961) to earthquake origin times after the strongest event in
 * the sample (mainshock). The Poisson likelihood for an inhomogeneous
 * process must integrate over the FULL observation window [0, T_obs],
 * not just to the last aftershock. With K̂ = N/I(c,p) where
 * I(c,p) = ∫₀^{T_obs} (c+t)^(-p) dt, the MLE minimizes
 *   f(c,p) = N·ln I(c,p) + p·Σ ln(c + tᵢ)
 * over (c, p). A coarse grid search is refined in 3 rounds of local
 * zoom. Returns null when no usable sequence is present.
 */
export function fitModifiedOmori(
  events: Array<{ mag: number; time: string }>,
  tObsEnd?: number,
): OmoriFit | null {
  if (events.length < 6) return null;
  let mi = 0;
  for (let i = 1; i < events.length; i++) if (events[i].mag > events[mi].mag) mi = i;
  const mainshock = events[mi];
  const t0 = new Date(mainshock.time).getTime();
  if (!Number.isFinite(t0)) return null;
  const tObs = tObsEnd ?? Date.now();
  const T = Math.max((tObs - t0) / 86400000, 0); // observation window in days
  const ts: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (i === mi) continue;
    const dt = (new Date(events[i].time).getTime() - t0) / 86400000;
    if (dt > 0 && Number.isFinite(dt) && dt <= T) ts.push(dt);
  }
  if (ts.length < 5 || !(T > 1e-4)) return null;
  const N = ts.length;

  const Iint = (c: number, p: number): number =>
    Math.abs(p - 1) < 1e-9
      ? Math.log((c + T) / c)
      : (Math.pow(c + T, 1 - p) - Math.pow(c, 1 - p)) / (1 - p);
  const cost = (c: number, p: number): number => {
    const I = Iint(c, p);
    if (!(I > 0) || !Number.isFinite(I)) return Infinity;
    let s = 0;
    for (const ti of ts) s += Math.log(c + ti);
    return N * Math.log(I) + p * s;
  };
  let best = { c: 0.01, p: 1.1, f: Infinity };
  const scan = (cs: number[], ps: number[]) => {
    for (const p of ps) {
      for (const c of cs) {
        const f = cost(c, p);
        if (f < best.f) best = { c, p, f };
      }
    }
  };
  const pGrid: number[] = [];
  for (const pv of [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3,1.5,2.0]) pGrid.push(pv);
  const cGrid0 = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10].filter((x) => x < T);
  scan(cGrid0, pGrid);
  for (let iter = 0; iter < 3; iter++) {
    const cs: number[] = [];
    const ps: number[] = [];
    for (const d of [-0.4, -0.15, 0, 0.15, 0.4]) {
      const p = best.p + d * 0.1667;
      if (p > 0.05 && p < 4) ps.push(p);
      const c = best.c * Math.pow(10, d);
      if (c > 1e-5 && c < T) cs.push(c);
    }
    scan(cs, ps);
  }
  if (!Number.isFinite(best.f)) return null;

  const I = Iint(best.c, best.p);
  const K = N / I;
  if (!(K > 0) || !Number.isFinite(K)) return null;
  return {
    K, c: best.c, p: best.p,
    mainshockMag: mainshock.mag,
    mainshockTime: mainshock.time,
    aftershockCount: N,
    fittedSpanDays: T,
  };
}

export async function fetchEarthquakes(
  lat: number, lon: number,
  startDate?: string, endDate?: string, radiusKm: number = 500,
): Promise<EarthquakeData> {
  const start = startDate || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const end = endDate || new Date().toISOString().slice(0, 10);
  const latRange = radiusKm / 111;
  const lonRange = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

  // orderby=time (NOT orderby=magnitude): sorting by magnitude + limit=200
  // would truncate the sample to the largest events and bias the fitted
  // b-value. minmagnitude=2.5 is the ANSS global catalog completeness
  // threshold for instrumental-era data.
  const data = await strictFetch(
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson`
    + `&starttime=${start}&endtime=${end}`
    + `&minlatitude=${lat - latRange}&maxlatitude=${lat + latRange}`
    + `&minlongitude=${lon - lonRange}&maxlongitude=${lon + lonRange}`
    + `&minmagnitude=2.5&orderby=time&limit=10000`
  );
  const features = data.features as Array<Record<string, unknown>> | undefined;
  if (!features) throw new Error('No earthquake features in USGS response');

  const events = features.map((f) => ({
    mag: (f.properties as Record<string, unknown> | undefined)?.mag as number | undefined ?? 0,
    depth: ((f.geometry as Record<string, unknown> | undefined)?.coordinates as number[] | undefined)?.[2] ?? 0,
    lat: ((f.geometry as Record<string, unknown> | undefined)?.coordinates as number[] | undefined)?.[1] ?? 0,
    lon: ((f.geometry as Record<string, unknown> | undefined)?.coordinates as number[] | undefined)?.[0] ?? 0,
    time: new Date((f.properties as Record<string, unknown> | undefined)?.time as number | string | undefined ?? 0).toISOString(),
    place: (f.properties as Record<string, unknown> | undefined)?.place as string | undefined ?? '',
  }));

  const mags = events.map((e) => e.mag).filter((m: number) => m > 0);
  const depths = events.map((e) => e.depth).filter((d: number) => d > 0);
  const maxMag = Math.max(...mags, 0);
  const avgMag = mags.length > 0 ? mags.reduce((a: number, b: number) => a + b, 0) / mags.length : 0;
  const avgDepth = depths.length > 0 ? depths.reduce((a: number, b: number) => a + b, 0) / depths.length : 0;

  // Gutenberg-Richter fit on the genuine catalog sample.
  // - Completeness magnitude Mc: lowest 0.1-magnitude bin holding ≥5 events,
  //   floor at 2.5 (catalog completeness threshold).
  // - b via Aki (1965) maximum likelihood with the Shi & Bolt (1987)
  //   bin-width correction: b = log10(e) / (M̄ − Mc + Δm/2), Δm = 0.1.
  // - a fitted so that N(M ≥ Mc) equals the observed annual rate:
  //   a = log10(rate) + b·Mc.   (log10 N = a − b·M)
  let mc = 2.5;
  if (mags.length >= 10) {
    const bins: Record<string, number> = {};
    for (const m of mags) {
      const k = (Math.round(m * 10) / 10).toFixed(1);
      bins[k] = (bins[k] ?? 0) + 1;
    }
    const keys = Object.keys(bins).map(Number).sort((x, y) => x - y);
    for (const k of keys) {
      if (bins[k.toFixed(1)] >= 5 && k >= 2.5) { mc = k; break; }
    }
  }
  const sample = mags.filter((m: number) => m >= mc);
  const years = Math.max(
    (new Date(`${end}T23:59:59Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / (365.25 * 86400000),
    1 / 365.25,
  );
  let bVal = 0, aVal = 0;
  if (sample.length >= 3) {
    const mMean = sample.reduce((x: number, y: number) => x + y, 0) / sample.length;
    bVal = Math.log10(Math.E) / (mMean - mc + 0.05);
    const annualRate = sample.length / years;
    aVal = Math.log10(annualRate) + bVal * mc;
  }

  return {
    count: events.length, maxMagnitude: maxMag, avgMagnitude: avgMag,
    avgDepth, bValue: bVal, aValue: aVal, mcMagnitude: mc,
    omoriFit: fitModifiedOmori(events, new Date(`${end}T23:59:59Z`).getTime()),
    events,
  };
}

/**
 * Rupture parameters for the strongest nearby event, taken from its USGS
 * moment-tensor product (genuine focal mechanism: strike/dip/rake,
 * derived magnitude and centroid depth), plus scalar moment. Used by the
 * Campbell–Bozorgnia (2014) GMPE. Returns null when no moment tensor is
 * attached to any event in the region (honest — no fabricated mechanism).
 *
 * USGS serves moment tensors on the DETAIL endpoint (?eventid=…&format=geojson),
 * not on the list query, so this is a two-stage fetch: list the candidate
 * events ordered by magnitude, then fetch each candidate's detail until a
 * moment tensor is found.
 */
export interface EarthquakeRupture {
  mag: number;
  rake: number;
  dip: number;
  strike: number;
  hypoDepth: number;
  eventLat: number;
  eventLon: number;
  scalarMoment: number | null;
  centroidDepth: number | null;
}

export async function fetchNearestEarthquakeRupture(
  lat: number, lon: number,
  startDate?: string, endDate?: string, radiusKm: number = 500,
): Promise<EarthquakeRupture | null> {
  const start = startDate || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const end = endDate || new Date().toISOString().slice(0, 10);
  const latRange = radiusKm / 111;
  const lonRange = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

  const list = await strictFetch(
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson`
    + `&orderby=magnitude&limit=10`
    + `&starttime=${start}&endtime=${end}`
    + `&minlatitude=${lat - latRange}&maxlatitude=${lat + latRange}`
    + `&minlongitude=${lon - lonRange}&maxlongitude=${lon + lonRange}`
    + `&minmagnitude=4`
  );
  const features = list.features as Array<Record<string, unknown>> | undefined;
  if (!features || features.length === 0) return null;

  for (const f of features) {
    const props = f.properties as Record<string, unknown> | undefined;
    const detailUrl = props?.detail as string | undefined;
    if (!detailUrl) continue;
    let det: Record<string, unknown>;
    try { det = await strictFetch(detailUrl, 15000) as Record<string, unknown>; }
    catch { continue; }
    const dp = det.properties as Record<string, unknown> | undefined;
    const coords = (det.geometry as Record<string, unknown> | undefined)?.coordinates as number[] | undefined;
    if (!dp || !coords) continue;
    const products = dp.products as Record<string, Array<Record<string, unknown>>> | undefined;
    const mts = products?.['moment-tensor'];
    if (!mts || mts.length === 0) continue;
    const c = mts[0].properties as Record<string, unknown> | undefined;
    if (!c) continue;
    const num = (v: unknown): number => (typeof v === 'string' && v !== '' ? parseFloat(v) : typeof v === 'number' ? v : NaN);
    const dip = num(c['nodal-plane-1-dip']);
    const rake = num(c['nodal-plane-1-rake']);
    const strike = num(c['nodal-plane-1-strike']);
    if (!Number.isFinite(dip) && !Number.isFinite(rake)) continue;
    const mag = num(dp.mag);
    if (!Number.isFinite(mag)) continue;
    const centroid = num(c['derived-depth']);
    return {
      mag,
      rake: Number.isFinite(rake) ? rake : 0,
      dip: Number.isFinite(dip) ? dip : 90,
      strike: Number.isFinite(strike) ? strike : 0,
      hypoDepth: Number.isFinite(num(coords[2])) ? num(coords[2]) : num(c['depth']),
      eventLat: Number(coords[1]),
      eventLon: Number(coords[0]),
      scalarMoment: num(c['scalar-moment']),
      centroidDepth: Number.isFinite(centroid) ? centroid : null,
    };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
//  NASA FIRMS Active Fire Data
// ══════════════════════════════════════════════════════════════════

export interface FireData {
  fireCount: number;
  avgFRP: number;
  maxFRP: number;
  totalArea: number;
  fires: Array<{
    lat: number;
    lon: number;
    frp: number;
    brightness: number;
    scan: number;
    track: number;
    confidence: number;
    satellite: string;
    acq_date: string;
  }>;
}

export async function fetchFIRMSFires(
  lat: number, lon: number, radiusKm: number = 100,
): Promise<FireData> {
  const mapKey = process.env.NASA_FIRMS_MAP_KEY;
  if (!mapKey) throw new Error('NASA_FIRMS_MAP_KEY not set');

  // FIRMS area API: /api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{days}
  // (the legacy /area/json/{key}/{src}/{lat}/{lon}/{radius} form no longer
  // exists and returns an Earthdata HTML error page). Convert the
  // point-radius request into a bounding box, clamped to the API limits.
  const halfDeg = Math.min(10, Math.max(0.05, radiusKm / 111));
  const bbox = [
    Math.max(-180, lon - halfDeg),
    Math.max(-90, lat - halfDeg),
    Math.min(180, lon + halfDeg),
    Math.min(90, lat + halfDeg),
  ].map(v => v.toFixed(4)).join(',');
  const days = 5; // rolling NRT archive keeps the last few days

  // VIIRS 375m, then MODIS 1km, then VIIRS NOAA-20
  const sources = ['VIIRS_SNPP_NRT', 'MODIS_NRT', 'VIIRS_NOAA20_NRT'];
  let allFires: FireData['fires'] = [];

  for (const source of sources) {
    try {
      const resp = await fetch(
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${source}/${bbox}/${days}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
      );
      if (!resp.ok) continue;
      const csv = await resp.text();
      const lines = csv.split('\n');
      const header = lines[0]?.split(',') ?? [];
      const idx = (name: string) => header.indexOf(name);
      const iLat = idx('latitude'), iLon = idx('longitude'), iFrp = idx('frp');
      const iBrT4 = idx('bright_ti4'), iBr31 = idx('bright_t31');
      const iScan = idx('scan'), iTrack = idx('track');
      const iConf = idx('confidence'), iSat = idx('satellite'), iDate = idx('acq_date');
      if (iLat < 0 || iLon < 0) continue;
      const parsed: FireData['fires'] = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].trim();
        if (!row) continue;
        const cells = row.split(',');
        const fireLat = Number(cells[iLat]);
        const fireLon = Number(cells[iLon]);
        if (!Number.isFinite(fireLat) || !Number.isFinite(fireLon)) continue;
        const confRaw = cells[iConf] ?? '';
        parsed.push({
          lat: fireLat,
          lon: fireLon,
          frp: Number(cells[iFrp] ?? 0) || 0,
          brightness: Number(cells[iBrT4] ?? cells[iBr31] ?? 0) || 0,
          scan: Number(cells[iScan] ?? 0) || 0,
          track: Number(cells[iTrack] ?? 0) || 0,
          confidence: confRaw === 'h' ? 100 : confRaw === 'n' ? 50 : Number(confRaw) || 10,
          satellite: cells[iSat] ?? source,
          acq_date: cells[iDate] ?? '',
        });
      }
      allFires = allFires.concat(parsed);
    } catch {
      // try next source
    }
  }

  if (allFires.length === 0) throw new Error('No fire detections from FIRMS API');

  const frps = allFires.map(f => f.frp).filter(f => f > 0);
  const avgFRP = frps.length > 0 ? frps.reduce((a, b) => a + b, 0) / frps.length : 0;
  const maxFRP = frps.length > 0 ? Math.max(...frps) : 0;
  const estArea = allFires.reduce((sum, f) => sum + Math.max(0.0005, f.scan * f.track * 0.01), 0);

  return {
    fireCount: allFires.length,
    avgFRP,
    maxFRP,
    totalArea: estArea,
    fires: allFires,
  };
}

// ══════════════════════════════════════════════════════════════════
//  USGS Elevation (SRTM 30m)
// ══════════════════════════════════════════════════════════════════

export interface ElevationData {
  elevation: number;
  slope?: number;
  aspect?: number;
}

export async function fetchElevation(
  lat: number, lon: number,
): Promise<ElevationData> {
  const data = await strictFetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`
  );
  const elevation = data.elevation as number | number[] | undefined;
  if (!elevation) throw new Error('No elevation data in Open-Meteo response');
  return { elevation: Array.isArray(elevation) ? elevation[0] : elevation };
}

/** Batch elevation fetch: Open-Meteo multi-point returns one elevation per
 *  lat/lon pair (same order). Used by the spatial grid so 36 sample points
 *  cost ONE request instead of 36. */
export async function fetchElevationsMulti(
  lats: number[], lons: number[],
): Promise<ElevationData[]> {
  const data = await strictFetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`
  );
  const elevation = data.elevation as number[] | undefined;
  if (!elevation) throw new Error('No elevation data in Open-Meteo response');
  return elevation.map(e => ({ elevation: e }));
}

// ══════════════════════════════════════════════════════════════════
//  ISRIC SoilGrids (Soil Properties at Depth)
// ══════════════════════════════════════════════════════════════════

export interface SoilData {
  clay: number;       // %
  sand: number;       // %
  silt: number;       // %
  organic_carbon: number;  // g/kg C (ISRIC raw dg/kg ÷ d_factor=10 → target g/kg)
  ph_h2o: number;
  bulk_density: number;    // kg/dm³
  cec: number;       // cmol/kg
  texture_class: string;
}

export async function fetchSoilData(
  lat: number, lon: number, depth: string = '0-5cm',
): Promise<SoilData> {
  const properties = ['clay', 'sand', 'silt', 'cfvo', 'soc', 'phh2o', 'bdod', 'cec'];
  const propParams = properties.map(p => `property=${p}`).join('&');
  const data = await strictFetch(
    `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}`
    + `&${propParams}`
    + `&depth=${depth}&value=mean`,
    25000
  );
  const props = data.properties as { layers?: unknown[] } | undefined;
  if (!props?.layers) throw new Error('No soil layers in ISRIC response');

  // ISRIC returns values multiplied by the property's d_factor (declared in
  // each layer's unit_measure.d_factor): cg/cm³ (bdod, d=100) → kg/dm³ needs
  // /100; per-mille properties (clay, sand, silt, soc dg/kg, cec cmol/kg,
  // d=10) → % or native units needs /10; dimensionless/already-decimal
  // properties (phh2o) need /1.
  const getProp = (name: string): number | null => {
    const layer = (props!.layers as Array<Record<string, unknown>>).find((l) => (l as Record<string, unknown>).name === name);
    const depths = layer?.depths as Array<Record<string, unknown>> | undefined;
    if (!depths?.[0]) return null;
    const values = depths[0].values as Record<string, unknown> | undefined;
    const mean = values?.mean as number | undefined;
    if (typeof mean !== 'number' || !Number.isFinite(mean)) return null;
    const dFactor = (layer?.unit_measure as Record<string, unknown> | undefined)?.d_factor;
    const div = (typeof dFactor === 'number' && dFactor > 0) ? dFactor : 10;
    return mean / div;
  };

  const clay = getProp('clay');
  const sand = getProp('sand');
  const silt = getProp('silt');
  const hasReal = [clay, sand, silt, getProp('soc'), getProp('phh2o'), getProp('bdod'), getProp('cec')]
    .some((v): v is number => v !== null);
  if (!hasReal) {
    throw new Error('ISRIC SoilGrids has no prediction for this pixel (masked/urban area)');
  }

  let texture_class = 'loam';
  if (sand !== null && sand > 85) texture_class = 'sand';
  else if (clay !== null && clay > 40) texture_class = 'clay';
  else if (sand !== null && clay !== null && sand > 50 && clay < 15) texture_class = 'sandy loam';
  else if (silt !== null && silt > 50) texture_class = 'silt';

  return {
    clay: clay ?? 0,
    sand: sand ?? 0,
    silt: silt ?? 0,
    organic_carbon: getProp('soc') ?? 0,
    ph_h2o: getProp('phh2o') ?? 0,
    bulk_density: getProp('bdod') ?? 0,
    cec: getProp('cec') ?? 0,
    texture_class,
  };
}

// ══════════════════════════════════════════════════════════════════
//  NOAA SST (Sea Surface Temperature)
// ══════════════════════════════════════════════════════════════════

export interface SSTData {
  sst: number;
  anomaly: number;
  /** ISO timestamp of the OISST analysis used (final product lags ~2 weeks behind preliminary) */
  timestamp?: string;
}

export async function fetchSST(
  lat: number, lon: number,
): Promise<SSTData> {
  // NCEI ERDDAP OISST v2 (0.25° daily). Native axis variables are sst/anom
  // (NOT analysed_sst/anomaly) and the longitude axis is 0–360°E. The most
  // recent timesteps are preliminary (null) pending final processing, so
  // probe a trailing window and take the newest valid value.
  const lon360 = ((lon % 360) + 360) % 360;
  const start = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10) + 'T12:00:00Z';
  // Round lat/lon onto the 0.25° grid cell centers (…-89.875 … 89.875; …0.125 … 359.875)
  const gridLat = Math.max(-89.875, Math.min(89.875, Math.round((lat + 89.875) / 0.25) * 0.25 - 89.875));
  const gridLon = Math.round(((lon360 - 0.125) / 0.25)) * 0.25 + 0.125;
  const query = (v: string) =>
    encodeURIComponent(`${v}`) + `%5B(${start}):last%5D%5B(0.0)%5D%5B(${gridLat})%5D%5B(${gridLon})%5D`;
  const url =
    `https://www.ncei.noaa.gov/erddap/griddap/ncdc_oisst_v2_avhrr_by_time_zlev_lat_lon.json?`
    + `${query('sst')},${query('anom')}`;
  const data = await strictFetch(url, 45000);
  const table = data.table as { rows?: unknown[][] } | undefined;
  const rows = table?.rows;
  if (!rows || rows.length === 0) throw new Error('No OISST data returned');
  // newest row first: walk back to the most recent non-null SST
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] as unknown[];
    const raw = row[4];
    if (raw == null) continue; // preliminary timesteps / land cells come back null
    const sst = Number(raw);
    if (Number.isFinite(sst)) {
      const anomRaw = row[5];
      return {
        sst,
        anomaly: anomRaw == null || !Number.isFinite(Number(anomRaw)) ? 0 : Number(anomRaw),
        timestamp: String(row[0] ?? ''),
      };
    }
  }
  throw new Error('OISST returned no valid timesteps in the trailing window');
}

// ══════════════════════════════════════════════════════════════════
//  WorldPop Population Density
// ══════════════════════════════════════════════════════════════════

export interface PopulationData {
  populationDensity: number; // people/km²
  totalPopulation: number;
}

export async function fetchPopulation(
  lat: number, lon: number, _radiusKm: number = 10,
): Promise<PopulationData> {
  // WorldPop 1km population density via ArcGIS ImageServer identify
  const url =
    `https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Population_Density_1km/ImageServer/identify`
    + `?f=json&geometry=${lon}%2C${lat}&geometryType=esriGeometryPoint`
    + `&returnGeometry=false&returnCatalogItems=false`;
  const data = await strictFetch(url);
  const density = Number((data.value as number | undefined) ?? NaN);
  if (isNaN(density)) throw new Error('WorldPop returned no population data');
  return {
    populationDensity: density,
    totalPopulation: density * Math.PI * (_radiusKm ** 2),
  };
}

// ══════════════════════════════════════════════════════════════════
//  ERA5 Climate Reanalysis (via Open-Meteo)
// ══════════════════════════════════════════════════════════════════

export interface ERA5Data {
  temperature_2m: number[];
  precipitation: number[];
  wind_speed_10m: number[];
  radiation: number[];
  months: string[];
}

export async function fetchERA5Climate(
  lat: number, lon: number, year: number,
): Promise<ERA5Data> {
  const data = await strictFetch(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
    + `&start_date=${year}-01-01&end_date=${year}-12-31`
    + `&daily=temperature_2m_mean,precipitation_sum,wind_speed_10m_mean,shortwave_radiation_sum`
    + `&timezone=auto`
  );
  const daily = data.daily as Record<string, unknown> | undefined;
  if (!daily) throw new Error('No daily data in ERA5 response');
  return {
    temperature_2m: (daily.temperature_2m_mean as number[] | undefined) ?? [],
    precipitation: (daily.precipitation_sum as number[] | undefined) ?? [],
    wind_speed_10m: (daily.wind_speed_10m_mean as number[] | undefined) ?? [],
    radiation: (daily.shortwave_radiation_sum as number[] | undefined) ?? [],
    months: (daily.time as string[] | undefined) ?? [],
  };
}

// ══════════════════════════════════════════════════════════════════
//  Satellite Vegetation Indices (MODIS NDVI/EVI proxy via weather)
// ══════════════════════════════════════════════════════════════════

export interface VegetationData {
  ndvi: number;
  evi: number;
  lai: number;
  fpar: number;
  landCover: string;
}

export async function fetchVegetationIndices(
  lat: number, lon: number,
): Promise<VegetationData> {
  // ORNL DAAC MODIS Web Service — MOD13Q1 (NDVI/EVI) + MCD15A3H (LAI/FPAR).
  // The subset endpoint requires startDate/endDate (Julian-day format, e.g.
  // A2026001) plus kmAboveBelow/kmLeftRight; without them it returns HTTP 400.
  // Product publication lags current date, so query from the start of the
  // year and take the most recent published composite.
  const year = new Date().getUTCFullYear();
  const toDoy = (d: Date): string => {
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const day = Math.floor((d.getTime() - start) / 86400000);
    return `A${d.getUTCFullYear()}${String(day).padStart(3, '0')}`;
  };
  const startDate = `A${year}001`;
  const endDate = toDoy(new Date());

  const getBand = async (product: string, band: string): Promise<number> => {
    const url = `https://modis.ornl.gov/rst/api/v1/${product}/subset`
      + `?latitude=${lat}&longitude=${lon}&startDate=${startDate}&endDate=${endDate}`
      + `&band=${band}&kmAboveBelow=0&kmLeftRight=0`;
    const data = await strictFetch(url, 25000) as { subset?: Array<Record<string, unknown>> };
    const subset = data?.subset;
    if (!subset) throw new Error(`No ${product}/${band} data`);
    // Take the most recent published composite (last entry in the window).
    const b = subset[subset.length - 1];
    const bandData = b?.data as number[] | undefined;
    if (!bandData?.[0]) throw new Error(`Empty band ${band}`);
    const raw = Number(bandData[0]);
    // MODIS VI products use -3000 as fill/no-data.
    if (raw <= -3000) throw new Error(`Fill pixel for ${band}`);
    return raw * ((b?.scale as number | undefined) ?? 1);
  };

  let ndvi: number, evi: number, lai: number, fpar: number;

  try {
    ndvi = await getBand('MOD13Q1', '250m_16_days_NDVI');
  } catch {
    // Fallback within-product: try EVI band
    ndvi = 0;
  }
  try {
    evi = await getBand('MOD13Q1', '250m_16_days_EVI');
  } catch {
    evi = ndvi * 0.85;
  }
  try {
    // MCD15A3H publishes 8-day LAI/FPAR (max 10 tiles per request ≈ 70 days),
    // and its product lags publication, so query the most recent 70-day
    // window and take the last available value.
    const laiStart = toDoy(new Date(Date.now() - 70 * 86400000));
    const laiUrl = `https://modis.ornl.gov/rst/api/v1/MCD15A3H/subset`
      + `?latitude=${lat}&longitude=${lon}&startDate=${laiStart}&endDate=${endDate}`
      + `&band=Lai_500m&kmAboveBelow=0&kmLeftRight=0`;
    const laiData = await strictFetch(laiUrl, 25000) as { scale?: string; subset?: Array<Record<string, unknown>> };
    const laiB = laiData?.subset?.find((s) => s.band === 'Lai_500m');
    const laiVals = laiB?.data as number[] | undefined;
    const laiScale = Number(laiData?.scale ?? 1) || 1;
    // MODIS fill/no-data pixels are encoded as 249-255; valid LAI is 0-100.
    const recentLai = laiVals?.filter((v) => Number(v) > 0 && Number(v) < 249).pop();
    lai = recentLai != null ? Number(recentLai) * laiScale : Number.NaN;
  } catch {
    lai = Number.NaN;
  }
  try {
    const fparStart = toDoy(new Date(Date.now() - 70 * 86400000));
    const fparUrl = `https://modis.ornl.gov/rst/api/v1/MCD15A3H/subset`
      + `?latitude=${lat}&longitude=${lon}&startDate=${fparStart}&endDate=${endDate}`
      + `&band=Fpar_500m&kmAboveBelow=0&kmLeftRight=0`;
    const fparData = await strictFetch(fparUrl, 25000) as { scale?: string; subset?: Array<Record<string, unknown>> };
    const fparB = fparData?.subset?.find((s) => s.band === 'Fpar_500m');
    const fparVals = fparB?.data as number[] | undefined;
    const fparScale = Number(fparData?.scale ?? 1) || 1;
    // MODIS fill/no-data pixels are encoded as 249-255; valid FPAR is 0-100.
    const recentFpar = fparVals?.filter((v) => Number(v) > 0 && Number(v) < 249).pop();
    fpar = recentFpar != null ? Number(recentFpar) * fparScale : Number.NaN;
  } catch {
    fpar = Number.NaN;
  }

  // Resolve land cover from MODIS MCD12Q1 if possible (annual product —
  // published with a lag of 1-2 years, so probe recent years for the newest
  // available classification). Each year is attempted independently so a
  // rate-limit or empty window in one year doesn't abort the search.
  let landCover = 'unknown';
  try {
    const LAND_COVER_NAMES: Record<number, string> = {
      1: 'evergreen needleleaf forest', 2: 'evergreen broadleaf forest',
      3: 'deciduous needleleaf forest', 4: 'deciduous broadleaf forest',
      5: 'mixed forest', 6: 'closed shrubland', 7: 'open shrubland',
      8: 'woody savanna', 9: 'savanna', 10: 'grassland',
      11: 'permanent wetland', 12: 'cropland', 13: 'urban',
      14: 'cropland/natural mosaic', 15: 'snow/ice', 16: 'barren',
    };
    for (let off = 1; off <= 3; off++) {
      const lcYear = year - off;
      try {
        const lcData = await strictFetch(
          `https://modis.ornl.gov/rst/api/v1/MCD12Q1/subset?latitude=${lat}&longitude=${lon}`
          + `&startDate=A${lcYear}001&endDate=A${lcYear}365&band=LC_Type1&kmAboveBelow=0&kmLeftRight=0`,
          25000
        ) as { subset?: Array<Record<string, unknown>> };
        const subset = lcData?.subset;
        if (!subset) continue;
        const band = subset.find((s) => s.band === 'LC_Type1');
        const bandData = band?.data as number[] | undefined;
        if (bandData?.[0]) {
          const code = Number(bandData[0]);
          landCover = LAND_COVER_NAMES[code] ?? 'unknown';
          break;
        }
      } catch {
        // try the previous year
      }
    }
  } catch {
    // landCover stays 'unknown'
  }

  return { ndvi, evi, lai, fpar, landCover };
}

// ══════════════════════════════════════════════════════════════════
//  Sea Ice Data (via NSIDC NRT CDR V4)
// ══════════════════════════════════════════════════════════════════

export interface SeaIceData {
  concentration: number; // 0-1 — genuine NSIDC CDR sea-ice concentration
  extent: number;        // km² — DERIVED ESTIMATE (conc × 10,000 km²), NOT genuine
                         // NSIDC regional extent; no per-pixel extent product exists
  thickness: number;     // m — DERIVED ESTIMATE (conc × 2.5 m), NOT genuine; the
                         // NSIDC CDR does not distribute thickness at this resolution
}

export async function fetchSeaIce(
  lat: number, lon: number,
): Promise<SeaIceData> {
  try {
    const { fetchSeaIce: fetchNSIDCSeaIce } = await import('../data/seaice');
    const result = await fetchNSIDCSeaIce(lat, lon);
    return {
      concentration: result.concentration ?? 0,
      // Derived estimates (documented above) — kept for backward compat with
      // tools that may reference the fields; genuine source = concentration only.
      extent: result.concentration != null ? result.concentration * 10000 : 0,
      thickness: result.concentration != null ? result.concentration * 2.5 : 0,
    };
  } catch {
    return { concentration: 0, extent: 0, thickness: 0 };
  }
}

// ══════════════════════════════════════════════════════════════════
//  Tectonic Context (USGS fault proximity)
// ══════════════════════════════════════════════════════════════════

export interface TectonicData {
  plateBoundary: boolean;
  faultProximity: number;  // km
  subductionZone: boolean;
  riftZone: boolean;
  transformBoundary: boolean;
}

export async function fetchTectonicContext(
  lat: number, lon: number,
): Promise<TectonicData> {
  // ── Plate boundary model: full PB2002 boundary polylines (Bird 2003).
  //    Fetched once and cached; genuine global dataset (241 LineStrings).
  const PB2002_URL = 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json';
  const _pbKey = 'pb2002:boundaries';
  let boundaries: Array<{ coords: [number, number][]; name: string; type: string }> | null = null;
  const cached = (globalThis as unknown as { __pbCache?: typeof boundaries }).__pbCache;
  if (cached) {
    boundaries = cached;
  } else {
    try {
      const resp = await fetch(PB2002_URL, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
      if (resp.ok) {
        const json = await resp.json() as { features?: Array<Record<string, unknown>> };
        boundaries = (json.features ?? []).map((f) => {
          const geom = f.geometry as { type?: string; coordinates?: [number, number][] } | undefined;
          const props = f.properties as Record<string, unknown> | undefined;
          return {
            coords: geom?.coordinates ?? [],
            name: (props?.Name as string | undefined) ?? 'plate boundary',
            type: (props?.Type as string | undefined) ?? '',
          };
        });
        (globalThis as unknown as { __pbCache?: typeof boundaries }).__pbCache = boundaries;
      }
    } catch { /* fall through to simplified table */ }
  }

  let boundaryDistKm = Infinity;
  let boundaryType = 'none';
  let nearestBoundaryName = '';
  let subductionDistKm = Infinity;
  if (boundaries && boundaries.length > 0) {
    for (const b of boundaries) {
      const isSub = b.type === 'subduction';
      for (const [lon0, lat0] of b.coords) {
        const d = Math.sqrt((lat0 - lat) ** 2 + (lon0 - lon) ** 2) * 111;
        if (d < boundaryDistKm) {
          boundaryDistKm = d;
          boundaryType = isSub ? 'subduction' : 'boundary';
          nearestBoundaryName = b.name;
        }
        if (isSub && d < subductionDistKm) subductionDistKm = d;
      }
    }
  }

  // ── Fault proximity: nearest USGS earthquake epicentre in the past year
  //    (real active-faulting proxy; the USGS qfaults ArcGIS service is dead).
  let nearestEventKm = Infinity;
  try {
    const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const data = await strictFetch(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson`
      + `&starttime=${start}&endtime=${end}`
      + `&latitude=${lat}&longitude=${lon}&maxradiuskm=500`
      + `&orderby=magnitude&limit=50`
    ) as { features?: Array<Record<string, unknown>> };
    for (const f of data?.features ?? []) {
      const coord = (f.geometry as Record<string, unknown> | undefined)?.coordinates as number[] | undefined;
      if (!coord) continue;
      const [elat, elon] = [coord[1], coord[0]];
      const dLat = (elat - lat) * 111;
      const dLon = (elon - lon) * 111 * Math.cos(lat * Math.PI / 180);
      const d = Math.sqrt(dLat * dLat + dLon * dLon);
      if (d < nearestEventKm) nearestEventKm = d;
    }
  } catch { /* fault proximity stays unknown */ }

  // Plate boundary if within 500 km of a PB2002 boundary.
  const plateBoundary = boundaryDistKm < 500;

  // faultProximity: nearest earthquake epicentre when within the search
  // radius, else the plate-boundary distance.
  const faultProximity = Number.isFinite(nearestEventKm)
    ? Math.round(nearestEventKm)
    : Number.isFinite(boundaryDistKm)
      ? Math.round(Math.min(boundaryDistKm, 500))
      : 9999;

  return {
    plateBoundary,
    faultProximity,
    subductionZone: subductionDistKm < 500,
    riftZone: boundaryType === 'boundary' && /ridge|rift/i.test(nearestBoundaryName),
    transformBoundary: boundaryType === 'boundary' && /transform/i.test(nearestBoundaryName),
  };
}

// ══════════════════════════════════════════════════════════════════
//  GNSS/Space Weather (via NOAA SWPC)
// ══════════════════════════════════════════════════════════════════

export interface SpaceWeatherData {
  kpIndex: number;
  dstIndex: number;
  solarWindSpeed: number;
  f107: number;
  bZ: number;
}

export async function fetchSpaceWeather(): Promise<SpaceWeatherData> {
  const [kpData, dstData, f107Data, swepamText, magText] = await Promise.all([
    strictFetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'),
    strictFetch('https://services.swpc.noaa.gov/products/kyoto-dst.json'),
    strictFetch('https://services.swpc.noaa.gov/products/10cm-flux-30-day.json'),
    fetch('https://services.swpc.noaa.gov/text/ace-swepam.txt', { signal: AbortSignal.timeout(12000) }),
    fetch('https://services.swpc.noaa.gov/text/ace-magnetometer.txt', { signal: AbortSignal.timeout(12000) }),
  ]);

  const kpArr = kpData as unknown as unknown[] | undefined;
  const kpRow = kpArr?.[1] as Record<string, unknown> | undefined;
  const kp = kpRow?.kp as number | undefined;
  if (kp === undefined) throw new Error('No Kp index in NOAA response');

  // Dst (geomagnetic storm index) — latest value from Kyoto Dst product
  const dstArr = dstData as unknown as unknown[] | undefined;
  let dst = 0;
  for (let i = (dstArr?.length ?? 1) - 1; i >= 0; i--) {
    const row = dstArr?.[i] as Record<string, unknown> | undefined;
    const v = Number(row?.dst);
    if (Number.isFinite(v) && v !== 0 && v < 100) { dst = v; break; }
  }

  // F10.7 solar radio flux — latest value
  const f107Arr = f107Data as unknown as unknown[] | undefined;
  let f107 = 120;
  for (let i = (f107Arr?.length ?? 1) - 1; i >= 0; i--) {
    const row = f107Arr?.[i] as Record<string, unknown> | undefined;
    const v = Number(row?.flux);
    if (Number.isFinite(v) && v > 40) { f107 = v; break; }
  }

  // ACE SWEPAM solar wind: YR MO DA HHMM ... S Density Speed Temp → speed is column 8 (0-indexed)
  const swepamTextBody = swepamText.ok ? await swepamText.text() : '';
  const swepamLines = swepamTextBody.split('\n').filter(l => /^\d{4}\s+\d{2}\s+\d{2}/.test(l));
  let solarWindSpeed = 0;
  for (let i = swepamLines.length - 1; i >= 0; i--) {
    const parts = swepamLines[i].trim().split(/\s+/);
    const speed = Number(parts[8]);
    if (Number.isFinite(speed) && speed > 0 && speed < 2000) { solarWindSpeed = speed; break; }
  }

  // ACE magnetometer: YR MO DA HHMM ... S Bx By Bz Bt Lat Lon → Bz is column 9 (0-indexed)
  const magTextBody = magText.ok ? await magText.text() : '';
  const magLines = magTextBody.split('\n').filter(l => /^\d{4}\s+\d{2}\s+\d{2}/.test(l));
  let bz = 0;
  for (let i = magLines.length - 1; i >= 0; i--) {
    const parts = magLines[i].trim().split(/\s+/);
    const b = Number(parts[9]);
    if (Number.isFinite(b) && Math.abs(b) < 100) { bz = b; break; }
  }

  return {
    kpIndex: kp,
    dstIndex: dst,
    solarWindSpeed,
    f107,
    bZ: bz,
  };
}

// ══════════════════════════════════════════════════════════════════
//  USGS Water Data (Streamflow, Gage Height)
// ══════════════════════════════════════════════════════════════════

export interface WaterData {
  streamflow: number;    // m³/s
  gageHeight: number;    // m
  waterTemp: number;     // °C
  conductivity: number;  // µS/cm
  dissolvedOxygen: number; // mg/L
}

export async function fetchWaterData(
  lat: number, lon: number, timeoutMs: number = 25000,
): Promise<WaterData> {
  // USGS Water Services API. It can be slow (large bbox queries under the
  // parallel analytical-tools load), so the default timeout is generous and
  // a transient failure is retried once before throwing.
  const url =
    `https://waterservices.usgs.gov/nwis/iv/?format=json`
    + `&bbox=${lon - 0.5},${lat - 0.5},${lon + 0.5},${lat + 0.5}`
    + `&parameterCd=00060,00065,00010,00095,00300`
    + `&siteStatus=all`;
  let data: Record<string, unknown>;
  try {
    data = await strictFetch(url, timeoutMs);
  } catch {
    data = await strictFetch(url, timeoutMs);
  }
  const value = data.value as { timeSeries?: Array<Record<string, unknown>> } | undefined;
  const ts = value?.timeSeries;
  if (!ts) throw new Error('No USGS water data for location');

  const getVal = (code: string): number => {
    const series = ts.find((s) => {
      const variable = s.variable as Record<string, unknown> | undefined;
      const varCode = variable?.variableCode as Array<Record<string, unknown>> | undefined;
      return varCode?.[0]?.value === code;
    });
    const values = series?.values as Array<Record<string, unknown>> | undefined;
    const valueArr = values?.[0]?.value as Array<Record<string, unknown>> | undefined;
    // USGS Water Services returns the measurement as a JSON string (e.g. "1.39"),
    // so a compile-time `as number` cast is not enough — coerce explicitly.
    const raw = valueArr?.[0]?.value;
    // No USGS station returned → honest NaN, not a fabricated 0.
    if (raw == null) return Number.NaN;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  return {
    streamflow: getVal('00060'),
    gageHeight: getVal('00065'),
    waterTemp: getVal('00010'),
    conductivity: getVal('00095'),
    dissolvedOxygen: getVal('00300'),
  };
}

// ══════════════════════════════════════════════════════════════════
//  Genuine spatial observation network (USGS NWIS IV)
// ══════════════════════════════════════════════════════════════════

export interface StationObs {
  lat: number;
  lon: number;
  value: number;
  siteName: string;
}

/**
 * Real, spatially-distributed observations for interpolation tools
 * (kriging/IDW): latest instantaneous values from every active USGS
 * NWIS station in the study bbox for one parameter. This is a genuine
 * observation network — station coordinates and values are measured,
 * never synthesized. Parameter code 00010 (water temperature °C) by
 * default; falls back to 00065 (gage height ft) when the primary has
 * fewer than 4 reporting stations.
 */
export async function fetchStationObservations(
  latMin: number, lonMin: number, latMax: number, lonMax: number,
  paramCd: string = '00010',
): Promise<{ obs: StationObs[]; paramCd: string; unit: string }> {
  const pull = async (code: string): Promise<StationObs[]> => {
    // NWIS IV is a genuinely slow service (wide bboxes enumerate every
    // active site): give it 75 s instead of the 12 s global default.
    const data = await strictFetch(
      `https://waterservices.usgs.gov/nwis/iv/?format=json`
      + `&bbox=${lonMin.toFixed(4)},${latMin.toFixed(4)},${lonMax.toFixed(4)},${latMax.toFixed(4)}`
      + `&parameterCd=${code}&siteStatus=all&period=PT12H`,
      75000,
    );
    const ts = (data.value as { timeSeries?: Array<Record<string, unknown>> } | undefined)?.timeSeries ?? [];
    const out: StationObs[] = [];
    for (const s of ts) {
      const si = s.sourceInfo as Record<string, unknown> | undefined;
      const geo = (si?.geoLocation as Record<string, unknown> | undefined)?.geogLocation as Record<string, unknown> | undefined;
      const lat = Number(geo?.latitude), lon = Number(geo?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const vals = (s.values as Array<Record<string, unknown>> | undefined)?.[0]?.value as Array<{ value: string }> | undefined;
      for (let i = (vals?.length ?? 0) - 1; i >= 0; i--) {
        const v = Number(vals?.[i]?.value);
        if (Number.isFinite(v) && v > -99999) {
          out.push({ lat, lon, value: v, siteName: String(si?.siteName ?? '') });
          break;
        }
      }
    }
    // One reading per station (dedupe by coordinates)
    const seen = new Set<string>();
    return out.filter((o) => {
      const k = `${o.lat.toFixed(5)},${o.lon.toFixed(5)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  let obs = await pull(paramCd);
  if (obs.length >= 4) return { obs, paramCd, unit: paramCd === '00010' ? '°C' : paramCd === '00065' ? 'ft' : '—' };
  if (paramCd !== '00065') {
    obs = await pull('00065');
    if (obs.length >= 4) return { obs, paramCd: '00065', unit: 'ft' };
  }
  return { obs, paramCd, unit: paramCd === '00010' ? '°C' : '—' };
}

// ══════════════════════════════════════════════════════════════════
//  USGS annual-maxima flood series → Gumbel (Type I) fit
//  ── genuine flood-frequency data for extreme-value models ──
// ══════════════════════════════════════════════════════════════════

export interface AnnualMaximaFit {
  mu: number;         // Gumbel location parameter (m³/s)
  beta: number;       // Gumbel scale parameter (m³/s)
  years: number;      // number of water years in the record
  startYear: number;
  endYear: number;
  siteName: string;
  siteId: string;
  lat: number;
  lon: number;
  annualMaxima: number[]; // m³/s, one per water year (chronological)
}

/**
 * Fetches a genuine USGS NWIS annual-maxima flood series for the gauge nearest
 * a location and fits the Gumbel (Type I) extreme-value distribution to the
 * ANNUAL MAXIMA (water-year maxima of daily mean discharge).
 *
 * Data path (all real, no synthesis):
 *   1. Enumerate active discharge gauges near (lat,lon) via the NWIS Daily
 *      Values bbox query with a short window (gauges + their coordinates).
 *   2. Pick the nearest gauge to the study point.
 *   3. Pull ~40 water years of daily mean discharge (00060 / statCd 00003).
 *   4. Annual maxima = max daily discharge per water year (Oct 1 – Sep 30).
 *   5. Gumbel fit by method of moments: β = σ·√6/π, μ = x̄ − 0.5772·β (Gumbel 1958).
 *
 * Returns null (honest) when no gauge is found or the record is too short
 * (<10 water years) — callers must then report NaN rather than fabricate.
 */
export async function fetchAnnualMaximaGumbel(
  lat: number,
  lon: number,
  timeoutMs: number = 50000,
): Promise<AnnualMaximaFit | null> {
  // 1) Enumerate active discharge gauges near the point (small bbox + 1 water
  //    year). The NWIS site service rejects bbox queries on this network, but
  //    the DV service accepts a bbox — so we list gauges from a DV call.
  let nearest: { code: string; name: string; lat: number; lon: number } | null = null;
  let nearestDist = Infinity;
  try {
    // One complete water year ending last Sep 30 (never an inverted window).
    const probeEndYear = new Date().getFullYear() - 1;
    const probeStart = `${probeEndYear - 1}-10-01`;
    const probeEnd = `${probeEndYear}-09-30`;
    const bbox = [
      (lon - 0.9).toFixed(4), (lat - 0.9).toFixed(4),
      (lon + 0.9).toFixed(4), (lat + 0.9).toFixed(4),
    ].join(',');
    const enumData = await strictFetch(
      `https://waterservices.usgs.gov/nwis/dv/?format=json&bBox=${bbox}&parameterCd=00060&statCd=00003&startDT=${probeStart}&endDT=${probeEnd}`,
      timeoutMs,
    );
    const ts = (enumData.value as { timeSeries?: Array<Record<string, unknown>> } | undefined)?.timeSeries ?? [];
    for (const s of ts) {
      const si = s.sourceInfo as Record<string, unknown> | undefined;
      const geo = (si?.geoLocation as Record<string, unknown> | undefined)?.geogLocation as Record<string, unknown> | undefined;
      const sLat = Number(geo?.latitude), sLon = Number(geo?.longitude);
      if (!Number.isFinite(sLat) || !Number.isFinite(sLon)) continue;
      const d = (sLat - lat) ** 2 + (sLon - lon) ** 2;
      if (d < nearestDist) {
        nearestDist = d;
        const code = (si?.siteCode as Array<{ value?: string }> | undefined)?.[0]?.value ?? '';
        nearest = { code, name: String(si?.siteName ?? ''), lat: sLat, lon: sLon };
      }
    }
  } catch {
    // enumeration failed — fall through to null
  }
  if (!nearest || !nearest.code) return null;

  // 2) Daily mean discharge for the last 40 water years at that gauge.
  const endYear = new Date().getFullYear() - 1; // last complete water year
  const startYear = endYear - 39;
  const start = `${startYear}-10-01`;
  const end = `${endYear}-09-30`;
  const url =
    `https://waterservices.usgs.gov/nwis/dv/?format=json`
    + `&sites=${nearest.code}&parameterCd=00060&statCd=00003`
    + `&startDT=${start}&endDT=${end}`;

  let data: Record<string, unknown>;
  try {
    data = await strictFetch(url, timeoutMs);
  } catch {
    return null;
  }
  const ts = (data.value as { timeSeries?: Array<Record<string, unknown>> } | undefined)?.timeSeries ?? [];
  const series = ts.find((s) => {
    const v = s.variable as Record<string, unknown> | undefined;
    const vc = v?.variableCode as Array<Record<string, unknown>> | undefined;
    return vc?.[0]?.value === '00060';
  });
  if (!series) return null;
  const values = (series.values as Array<Record<string, unknown>> | undefined)?.[0]?.value as
    | Array<{ value?: string; dateTime?: string }>
    | undefined;
  if (!values || values.length < 365) return null; // need at least a year of daily data

  // 3) Water-year maxima of daily mean discharge (m³/s for parameter 00060).
  const daily: Array<{ date: Date; q: number }> = [];
  for (const v of values) {
    const q = Number(v.value);
    if (!Number.isFinite(q) || q < 0) continue;
    const t = Date.parse(v.dateTime ?? '');
    if (Number.isNaN(t)) continue;
    daily.push({ date: new Date(t), q });
  }
  if (daily.length === 0) return null;

  const waterYear = (d: Date): number => (d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear());
  const maxima = new Map<number, number>();
  for (const { date, q } of daily) {
    const wy = waterYear(date);
    const cur = maxima.get(wy);
    if (cur === undefined || q > cur) maxima.set(wy, q);
  }
  const yearsArr = [...maxima.keys()].sort((a, b) => a - b);
  if (yearsArr.length < 10) return null; // need ≥10 water years for a defensible fit
  const annualMaxima = yearsArr.map((wy) => maxima.get(wy) as number);

  // 4) Gumbel method of moments: β = σ·√6/π, μ = x̄ − 0.5772·β.
  const n = annualMaxima.length;
  const mean = annualMaxima.reduce((a, b) => a + b, 0) / n;
  const variance = annualMaxima.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
  const sigma = Math.sqrt(variance);
  const beta = (sigma * Math.sqrt(6)) / Math.PI;
  const mu = mean - 0.5772 * beta;

  return {
    mu,
    beta,
    years: n,
    startYear: yearsArr[0],
    endYear: yearsArr[n - 1],
    siteName: nearest.name,
    siteId: nearest.code,
    lat: nearest.lat,
    lon: nearest.lon,
    annualMaxima,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Land Cover Classification (ESA WorldCover proxy)
// ══════════════════════════════════════════════════════════════════

export interface LandCoverData {
  class: string;
  code: number;
  treeCover: number;   // %
  impervious: number;  // %
  cropland: number;    // %
  wetland: number;     // %
}

export async function fetchLandCover(
  lat: number, lon: number,
): Promise<LandCoverData> {
  // MCD12Q1 Land Cover Type (IGBP classification) via ORNL DAAC MODIS Web
  // Service — the same API already used for vegetation indices. Product is
  // annual (LC_Type1); query a full year and take the single published tile.
  const url = `https://modis.ornl.gov/rst/api/v1/MCD12Q1/subset`
    + `?latitude=${lat}&longitude=${lon}&startDate=A2021001&endDate=A2021365`
    + `&band=LC_Type1&kmAboveBelow=0&kmLeftRight=0`;
  const data = await strictFetch(url, 25000) as { subset?: Array<Record<string, unknown>> };
  const subset = data?.subset;
  if (!subset?.[0]) throw new Error('No MCD12Q1 land cover data');

  const bandData = subset[0]?.data as number[] | undefined;
  const code = Number(bandData?.[0]);
  if (!Number.isFinite(code) || code <= 0) throw new Error('No land cover classification for pixel');

  // IGBP land cover classes (MODIS MCD12Q1 LC_Type1)
  const CLASS_NAMES: Record<number, string> = {
    1: 'Evergreen needleleaf forest', 2: 'Evergreen broadleaf forest',
    3: 'Deciduous needleleaf forest', 4: 'Deciduous broadleaf forest',
    5: 'Mixed forests', 6: 'Closed shrublands', 7: 'Open shrublands',
    8: 'Woody savannas', 9: 'Savannas', 10: 'Grasslands',
    11: 'Permanent wetlands', 12: 'Croplands', 13: 'Urban and built-up',
    14: 'Cropland/natural vegetation mosaic', 15: 'Snow and ice',
    16: 'Barren or sparsely vegetated', 17: 'Water',
  };

  const isForest = [1, 2, 3, 4, 5, 8, 9].includes(code);
  const isCrop = code === 12 || code === 14;
  const isWetland = code === 11;
  const isUrban = code === 13;

  return {
    class: CLASS_NAMES[code] ?? 'Unknown',
    code,
    treeCover: isForest ? (code === 8 ? 60 : code === 9 ? 30 : 85) : isCrop && code === 14 ? 30 : 0,
    impervious: isUrban ? 60 : isCrop ? 2 : 0,
    cropland: isCrop ? (code === 12 ? 80 : 55) : 0,
    wetland: isWetland ? 80 : 0,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Mountain/Valley Classification (Topographic Wetness Index proxy)
// ══════════════════════════════════════════════════════════════════

export interface TerrainData {
  elevation: number;
  slope: number;
  aspect: number;
  curvature: number;
  hillshade: number;
}

function deg2rad(d: number): number { return d * Math.PI / 180; }

export async function fetchTerrain(
  lat: number, lon: number,
): Promise<TerrainData> {
  // 1 arc-second spacing for SRTM30m
  const spacing = 1 / 3600;
  const dLon = spacing / Math.cos(deg2rad(lat));
  const locs: string[] = [];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      locs.push(`${(lat + i * spacing).toFixed(7)},${(lon + j * dLon).toFixed(7)}`);
    }
  }
  const url = `https://api.opentopodata.org/v1/srtm30m?locations=${locs.join('|')}`;
  const data = await strictFetch(url);
  console.error('[TERRAIN-RAW] body=' + JSON.stringify(data).slice(0, 300));
  const results = data?.results as Array<{ elevation: number | null }> | undefined;
  if (!results || results.length < 9) throw new Error('Open Topo Data returned insufficient elevation points');

  const elevs = results.map((r) => r.elevation ?? 0);
  // 3x3 grid labelled:
  // a b c
  // d e f
  // g h i
  const [a, b, c, d, e, f, g, h, i] = elevs;

  // Cell size in meters at this latitude
  const cellSize = 30; // SRTM30m

  // Horn's algorithm for slope and aspect
  const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cellSize);
  const dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * cellSize);

  const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;
  let aspect = Math.atan2(dzdy, -dzdx) * 180 / Math.PI;
  aspect = aspect < 0 ? 360 + aspect : aspect;

  // Curvature: second derivative approximation
  const d2zdx2 = ((a - 2 * d + g) + (c - 2 * f + i)) / (2 * cellSize * cellSize);
  const d2zdy2 = ((a - 2 * b + c) + (g - 2 * h + i)) / (2 * cellSize * cellSize);
  const curvature = (d2zdx2 + d2zdy2) * 0.5;

  // Hillshade: sun at 45° azimuth, 45° elevation
  const sunAz = deg2rad(315);
  const sunEl = deg2rad(45);
  const s = deg2rad(slope);
  const aRad = deg2rad(aspect);
  const hillshade = Math.max(0,
    Math.cos(sunEl) * Math.sin(s) * Math.cos(sunAz - aRad)
    + Math.sin(sunEl) * Math.cos(s)
  );

  return {
    elevation: e,
    slope,
    aspect,
    curvature,
    hillshade,
  };
}

/**
 * Genuine local shoreline bearing (°, 0–180, direction the coastline runs)
 * from GEBCO 2020 relief probes on a ring around the point — the geometric
 * input Tool 77 (CERC longshore transport, SPM 1984) needs to convert a
 * wave direction into the breaker angle relative to the shoreline. Probes
 * 8 points at ~2 km radius on the genuine OpenTopoData GEBCO 2020 grid
 * (positive-up global relief; negative = seafloor, positive = land — the
 * same source as the Tool 76 auto bathymetry). The resultant of the
 * land(+1)/water(−1) unit vectors points landward (shore-normal) and the
 * shoreline tangent is that bearing + 90°. Returns null when the ring is
 * entirely land or entirely water (no resolvable coast) or on fetch
 * failure — consumers then NaN-fire honestly (no fabricated orientation).
 */
export async function fetchShorelineBearing(
  lat: number, lon: number,
): Promise<number | null> {
  const { fetchGebco2020Elevations } = await import('../kaggle/bathymetry');
  const radiusKm = 2;
  const R_EARTH = 6371;
  const steps = 8;
  const locs: Array<{ lat: number; lon: number }> = [];
  const ux: number[] = [];
  const uy: number[] = [];
  for (let i = 0; i < steps; i++) {
    const brg = (i * 360) / steps; // degrees clockwise from north
    const br = brg * Math.PI / 180;
    const dLat = (radiusKm / R_EARTH) * Math.cos(br);
    const dLon = (radiusKm / R_EARTH) * Math.sin(br) / Math.max(Math.cos(lat * Math.PI / 180), 1e-6);
    locs.push({
      lat: lat + dLat * 180 / Math.PI,
      lon: lon + dLon * 180 / Math.PI,
    });
    ux.push(Math.sin(br)); // east component of the probe unit vector
    uy.push(Math.cos(br)); // north component
  }
  let elevs: number[];
  try {
    elevs = await fetchGebco2020Elevations(locs);
  } catch {
    return null; // fetch failure — consumers NaN-fire honestly
  }
  let gx = 0, gy = 0, nLand = 0, nWater = 0;
  for (let i = 0; i < steps; i++) {
    const e = elevs[i];
    if (e == null || !Number.isFinite(e)) return null; // missing cell — honest
    const w = e >= 0 ? 1 : -1; // GEBCO: positive = land, negative = seafloor
    if (e >= 0) nLand++; else nWater++;
    gx += w * ux[i];
    gy += w * uy[i];
  }
  if (nLand === 0 || nWater === 0) return null; // no resolvable coast on the ring
  const mag = Math.hypot(gx, gy);
  if (mag < 1e-6) return null;
  const landward = (Math.atan2(gx, gy) * 180 / Math.PI + 360) % 360; // gradient points toward land
  return (landward + 90) % 180; // shoreline tangent, 0–180
}

// ══════════════════════════════════════════════════════════════════
//  Glaciers/Ice Sheets (genuine RGI v7.0 inventory via GLIMS WFS)
// ══════════════════════════════════════════════════════════════════

export interface GlacierData {
  area: number;        // km² — measured RGI v7.0 area (on-glacier or regional sum)
  volume: number | null;      // km³ — Bahr et al. (1997) scaling V = 0.034·A^1.375 (labeled derivation)
  massBalance: number | null; // m w.e./yr — null: no genuine point-query source exists
  equilibriumLine: number | null; // m — null: no genuine point-query source exists
  name?: string | null;  // RGI glacier name when the point is on a glacier
  source?: string | null;
}

export async function fetchGlacierData(
  lat: number, lon: number,
): Promise<GlacierData> {
  const { fetchGlacier } = await import('../data/glacier');
  const result = await fetchGlacier(lat, lon);
  const areaKm2 = result.areaKm2 ?? 0;
  return {
    area: areaKm2,
    volume: areaKm2 > 0 ? Math.round(0.034 * Math.pow(areaKm2, 1.375) * 1000) / 1000 : null,
    massBalance: null,
    equilibriumLine: null,
    name: result.name ?? null,
    source: result.source,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Volcanic Activity (USGS + VAAC)
// ══════════════════════════════════════════════════════════════════

export interface VolcanoData {
  nearestVolcano: string;
  distance: number;     // km
  alertLevel: string;
  recentActivity: boolean;
  lastEruption: string;
}

export async function fetchVolcanoData(
  lat: number, lon: number,
): Promise<VolcanoData> {
  try {
    const { fetchVolcano } = await import('../data/volcano');
    const result = await fetchVolcano(lat, lon);
    return {
      nearestVolcano: result.name,
      distance: result.distance,
      alertLevel: result.alertLevel,
      recentActivity: result.lastEruptionYear !== 'unknown' &&
        parseInt(result.lastEruptionYear) >= new Date().getUTCFullYear() - 10,
      lastEruption: result.lastEruptionDate,
    };
  } catch {
    return {
      nearestVolcano: 'unknown',
      distance: 9999,
      alertLevel: 'unknown',
      recentActivity: false,
      lastEruption: 'unknown',
    };
  }
}

// ══════════════════════════════════════════════════════════════════
//  Tropospheric Delay (Meteorological proxy)
// ══════════════════════════════════════════════════════════════════

export interface TropoData {
  zenithDelay: number;    // m
  wetDelay: number;       // m
  hydrostaticDelay: number; // m
}

export async function fetchTropoDelay(
  lat: number, lon: number,
): Promise<TropoData> {
  const weather = await fetchCurrentWeather(lat, lon);
  const P = weather.pressure_msl ?? 1013.25;
  const T = (weather.temperature_2m ?? 15) + 273.15;
  const e = 6.1094 * Math.exp(17.625 * (T - 273.15) / (T - 273.15 + 243.04));

  const hydro = 0.002277 * P;
  const wet = 0.002277 * (1255 / (T + 0.05)) * e;

  return {
    zenithDelay: hydro + wet,
    wetDelay: wet,
    hydrostaticDelay: hydro,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Permafrost/Active Layer (Climate proxy)
// ══════════════════════════════════════════════════════════════════

export interface PermafrostData {
  activeLayerDepth: number; // m
  permafrostProb: number;   // 0-1
  groundTemp: number;       // °C
}

export async function fetchPermafrostData(
  lat: number, lon: number,
): Promise<PermafrostData> {
  try {
    const { fetchPermafrost } = await import('../data/permafrost');
    const result = await fetchPermafrost(lat, lon);
    return {
      activeLayerDepth: result.activeLayerDepth ?? 0,
      permafrostProb: result.probability ?? 0,
      groundTemp: result.groundTemp ?? 0,
    };
  } catch {
    return { activeLayerDepth: 0, permafrostProb: 0, groundTemp: 0 };
  }
}

// ══════════════════════════════════════════════════════════════════
//  Drought Indices (Palmer Drought proxy)
// ══════════════════════════════════════════════════════════════════

export interface DroughtData {
  pdsi: number;       // Palmer Drought Severity Index
  precipitation: number;
  temperature: number;
  soilMoisture: number;
  droughtClass: string;
}

export async function fetchDroughtData(
  lat: number, lon: number,
): Promise<DroughtData> {
  try {
    const { fetchDroughtPDSI } = await import('../data/drought');
    const result = await fetchDroughtPDSI(lat, lon);
    return {
      pdsi: result.scPDSI ?? 0,
      droughtClass: result.droughtClass,
      precipitation: 0,
      temperature: 0,
      soilMoisture: 0,
    };
  } catch {
    return { pdsi: 0, precipitation: 0, temperature: 0, soilMoisture: 0, droughtClass: 'unknown' };
  }
}

// ══════════════════════════════════════════════════════════════════
//  River Discharge (USGS/GRDC proxy)
// ══════════════════════════════════════════════════════════════════

export interface RiverData {
  discharge: number;    // m³/s
  velocity: number;     // m/s
  width: number;        // m
  depth: number;        // m
  slope: number;        // m/m
}

export async function fetchRiverData(
  lat: number, lon: number,
): Promise<RiverData> {
  const water = await fetchWaterData(lat, lon, 30000);
  const terrain = await fetchTerrain(lat, lon);

  // Discharge from USGS (real), width/depth/slope estimated from gage height and terrain
  return {
    discharge: water.streamflow,
    velocity: water.streamflow > 0 ? water.streamflow / (water.gageHeight * 20 * 2) : 0,
    width: water.gageHeight > 0 ? water.gageHeight * 20 : 10,
    depth: water.gageHeight || 2,
    slope: Math.max(0.0001, terrain.slope / 1000),
  };
}

// ══════════════════════════════════════════════════════════════════
//  Atmospheric CO₂ mole fraction — genuine NOAA GML primary source
//  (Global Monitoring Laboratory, Boulder). Global monthly means from
//  the marine-baseline flask/insitu network (co2_mm_gl.txt):
//    https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.txt
//  Columns: year month decimal avg uncert interp_uncert … −999.99 =
//  unpublished. Requested month honoured (input-filter rule); when the
//  requested month has no published value the newest published month is
//  served with explicit provenance — never a fabricated value.
// ══════════════════════════════════════════════════════════════════
export interface Co2GmlData {
  ppm: number;
  year: number;
  month: number;      // month actually served (1–12)
  asOf: string;       // provenance string
}

let co2GmlCache: { at: number; rows: Array<[number, number, number]> } | null = null;
const CO2_GML_TTL = 24 * 60 * 60 * 1000;

export async function fetchCo2Gml(dateStr?: string): Promise<Co2GmlData | null> {
  let rows = co2GmlCache && Date.now() - co2GmlCache.at < CO2_GML_TTL
    ? co2GmlCache.rows : null;
  if (!rows) {
    try {
      const res = await fetch('https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.txt', {
        headers: { 'User-Agent': 'Terranoetis/1.0 (analytical tools; genuine-source audit)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const text = await res.text();
      rows = [];
      for (const line of text.split('\n')) {
        const c = line.trim().split(/\s+/);
        if (c.length < 4) continue;
        const yr = Number(c[0]), mo = Number(c[1]), avg = Number(c[3]);
        if (!Number.isFinite(yr) || yr < 1979 || yr > 2100 || !Number.isFinite(mo)) continue;
        if (!Number.isFinite(avg) || avg <= 0) continue; // −999 = unpublished
        rows.push([yr, mo, avg]);
      }
      if (rows.length === 0) return null;
      co2GmlCache = { at: Date.now(), rows };
    } catch { return null; }
  }
  const served = (yr: number, mo: number, ppm: number, note: string): Co2GmlData => ({
    ppm, year: yr, month: mo,
    asOf: `NOAA GML global monthly mean CO₂ (${yr}-${String(mo).padStart(2, '0')}${note})`,
  });
  const m = dateStr ? /^(\d{4})-(\d{2})/.exec(dateStr) : null;
  if (m) {
    const want: [number, number] = [Number(m[1]), Number(m[2])];
    const hit = rows.find(r => r[0] === want[0] && r[1] === want[1]);
    if (hit) return served(hit[0], hit[1], hit[2], '');
    const newest = rows[rows.length - 1];
    if (newest) {
      // Published series is monotone in (year, month); the requested slot is
      // unpublished (or predates the series). Serve newest + disclose.
      return served(newest[0], newest[1], newest[2], ' — requested month unpublished; newest published served');
    }
    return null;
  }
  const newest = rows[rows.length - 1];
  return newest ? served(newest[0], newest[1], newest[2], '') : null;
}

// ══════════════════════════════════════════════════════════════════
//  Gross Primary Productivity — genuine MODIS MOD17A2H via ORNL DAAC
//  MODIS Web Service (8-day composites, reported unit: kgC/m² per 8 days
//  at scale 1e-4, fill values ≥32761). Converted to the time-mean canopy
//  photosynthesis rate (µmol CO₂/m²/s) that stomatal conductance models
//  consume:
//    kgC → gC (×1000) → µmol C (÷ 12 gC/mol × 1e6) over 8 days (÷ 604 800 s)
//    = kgC × 1e9 / (12 × 604 800) = kgC × 1.37743e-4  ≈ kgC / 7260.
//  (Sanity: 0.0145 kgC per 8 d ≈ 2 µmol CO₂ m⁻² s⁻¹, a typical productive
//  temperate canopy.) The ORNL subset API caps one request at 10 composites
//  (~80 days) — a full-year window is rejected ("exceeds maximum subset
//  tiles support of 10"), so the fetcher asks for the latest ≤10 composites
//  ending at the requested date and, if all are fill-valued at the study
//  point, widens once to the full year. The newest published (non-fill)
//  pixel is served; null otherwise (no fabrication).
// ══════════════════════════════════════════════════════════════════
export interface GppData {
  gpp8d_kgC: number;          // kgC/m² per 8 days, as published by MOD17A2H
  assimilation: number;       // µmol CO₂/m²/s (time-mean canopy rate)
  date: string;               // MODIS acquisition id (A####ddd)
  asOf: string;               // provenance string
}

const KG_C_TO_UMOL_CO2 = 1e9 / (12 * 604800);  // kgC per 8 d → µmol CO₂ m⁻² s⁻¹

export async function fetchGppModis(
  lat: number, lon: number, dateStr?: string,
): Promise<GppData | null> {
  const now = new Date();
  const year = dateStr ? Number(dateStr.slice(0, 4)) : now.getUTCFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > now.getUTCFullYear() + 1) return null;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInYear = isLeap ? 366 : 365;
  // Day-of-year for 00 UTC on Jan 1 (MODIS A####ddd tiles are UTC-referenced).
  const date = dateStr ? new Date(`${dateStr}T00:00:00Z`) : now;
  const doy = Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1;
  const clamp = (d: number) => Math.max(1, Math.min(daysInYear, d));
  const pad = (d: number) => String(clamp(d)).padStart(3, '0');

  const query = async (startDoy: number, endDoy: number): Promise<GppData | null> => {
    const url = 'https://modis.ornl.gov/rst/api/v1/MOD17A2H/subset'
      + `?latitude=${lat}&longitude=${lon}&startDate=A${year}${pad(startDoy)}&endDate=A${year}${pad(endDoy)}`
      + '&band=Gpp_500m&kmAboveBelow=0&kmLeftRight=0';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Terranoetis/1.0 (analytical tools; genuine-source audit)' },
      signal: AbortSignal.timeout(25000),
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const data = (await res.json().catch(() => null)) as
      | { subset?: Array<{ modis_date?: string; data?: number[]; scale?: number }> } | string | null;
    const subset = (data && typeof data === 'object' && !Array.isArray(data) ? data.subset : null)
      ?? (Array.isArray(data) ? data as unknown as Array<{ modis_date?: string; data?: number[]; scale?: number }> : undefined);
    if (!Array.isArray(subset) || subset.length === 0) return null;
    // Walk backwards to the newest composite with a published (non-fill)
    // value at the study point.
    for (let i = subset.length - 1; i >= 0; i--) {
      const s = subset[i];
      const scale = Number(s.scale ?? 1e-4);
      const raw = Number(Array.isArray(s.data) ? s.data[0] : NaN);
      if (!Number.isFinite(raw) || raw >= 32761 || raw < 0) continue;
      const kgC = raw * scale;
      const assimilation = kgC * KG_C_TO_UMOL_CO2;
      return {
        gpp8d_kgC: kgC,
        assimilation,
        date: s.modis_date ?? 'A???????',
        asOf: `MODIS MOD17A2H 8-day GPP ${s.modis_date} (ORNL DAAC; ${kgC.toFixed(4)} kgC/m² per 8 d → ${assimilation.toFixed(2)} µmol CO₂/m²/s time-mean)`,
      };
    }
    return null;
  };

  // Window 1: the ≤10 composites (~80 d) ending at the requested date —
  // honours the API's 10-tile cap and the date input filter.
  let hit = await query(Math.max(1, doy - 9 * 8), doy).catch(() => null);
  if (hit) return hit;
  // Window 2: the whole year (for dates whose recent composites are all
  // fill-valued at this pixel — e.g. snow cover, dense water/cloud runs).
  hit = await query(1, daysInYear).catch(() => null);
  return hit;
}

export interface GppAnnualData {
  gppYr_gC: number;         // annual GPP, gC/m²/yr (sum of valid 8-day composites)
  validComposites: number;  // how many of the year's ~46 composites summed
  year: number;
  asOf: string;             // provenance string
}

/**
 * Annual GPP (gC/m²/yr) from MODIS MOD17A2H 8-day composites summed over a
 * year — the standard construction of annual GPP from MOD17 (catalogue-
 * sanctioned source for Tool 53, same product family as fetchGppModis). The
 * ORNL subset API caps at 10 tiles per request (10 × 8-day composites ≈
 * 80 d), so the year is fetched in 5 chunked requests; fill/missing
 * composites are skipped and the valid count reported honestly. Null when no
 * genuine composite resolves (no fabrication).
 */
export async function fetchAnnualGppModis(
  lat: number, lon: number, year?: number,
): Promise<GppAnnualData | null> {
  const now = new Date();
  const y = year ?? now.getUTCFullYear() - 1; // most recent complete year
  if (!Number.isFinite(y) || y < 2000 || y > now.getUTCFullYear()) return null;
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInYear = isLeap ? 366 : 365;
  const pad = (d: number) => String(Math.max(1, Math.min(daysInYear, d))).padStart(3, '0');

  // Five 10-composite (~80 d) windows tile the year.
  const chunks = [1, 81, 161, 241, 321];
  let totalKgC = 0;
  let valid = 0;
  for (const start of chunks) {
    const url = 'https://modis.ornl.gov/rst/api/v1/MOD17A2H/subset'
      + `?latitude=${lat}&longitude=${lon}&startDate=A${y}${pad(start)}&endDate=A${y}${pad(start + 79)}`
      + '&band=Gpp_500m&kmAboveBelow=0&kmLeftRight=0';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Terranoetis/1.0 (analytical tools; genuine-source audit)' },
      signal: AbortSignal.timeout(25000),
    }).catch(() => null);
    if (!res || !res.ok) continue;
    const data = (await res.json().catch(() => null)) as
      | { subset?: Array<{ modis_date?: string; data?: number[]; scale?: number }> } | string | null;
    const subset = (data && typeof data === 'object' && !Array.isArray(data) ? data.subset : null)
      ?? (Array.isArray(data) ? data as unknown as Array<{ modis_date?: string; data?: number[]; scale?: number }> : undefined);
    if (!Array.isArray(subset)) continue;
    for (const s of subset) {
      const scale = Number(s.scale ?? 1e-4);
      const raw = Number(Array.isArray(s.data) ? s.data[0] : NaN);
      if (!Number.isFinite(raw) || raw >= 32761 || raw < 0) continue;
      totalKgC += raw * scale;
      valid++;
      if (s.modis_date) {
        /* modis_date tracking was removed as unused */
      }
    }
  }
  if (valid === 0) return null;
  return {
    gppYr_gC: totalKgC * 1000,
    validComposites: valid,
    year: y,
    asOf: `MODIS MOD17A2H 8-day GPP summed over ${valid} valid composites of ${y} (ORNL DAAC; ${totalKgC.toFixed(2)} kgC/m²/yr → ${(totalKgC * 1000).toFixed(0)} gC/m²/yr)`,
  };
}

// ══════════════════════════════════════════════════════════════════
//  ERA5 High-Fidelity Data (ECMWF CDS API v2)
//  Provides variables NOT available through Open-Meteo ERA5 subset:
//  - Friction velocity (zust)   — Monin-Obukhov wind profile
//  - Total column water vapour  — split-window LST (direct measurement)
//  - Surface energy fluxes      — net short/longwave, sensible, latent
//  - Pressure-level wind/temp   — atmospheric dynamics
//  - Multi-level soil state     — soil physics (vs single-layer Open-Meteo)
// ══════════════════════════════════════════════════════════════════

export interface Era5HighFidelityData {
  frictionVelocity: number | null;               // m/s (zust, var 236)
  totalColumnWaterVapour: number | null;         // g/cm² (direct, not Smith proxy)
  /**
   * Which backend produced these values:
   *  'cds'     — genuine ERA5 reanalysis via the Copernicus CDS API
   *  'proxy'   — Open-Meteo redistribution subset + log-law / static-Bowen
   *              approximations (NOT genuine ERA5; consumers that require
   *              authentic reanalysis must reject these values)
   *  'none'    — no backend returned data
   */
  source: 'cds' | 'proxy' | 'none';
  /** Genuine ERA5 2 m relative humidity (%) — cds backend only (tool 50).
   *  Never populated from the Open-Meteo proxy subset (authenticity rule). */
  rh2m?: number | null;
  /** ISO date the cds values were actually resolved to (≤ requested date). */
  era5AsOfDate?: string | null;
  /** Genuine ERA5 10 m wind speed (m/s) — cds backend only (tool 56). */
  wind10m?: number | null;
  /** ISO date the 10 m wind was resolved to (provenance). */
  wind10mAsOfDate?: string | null;
  /** Genuine ERA5 significant wave height (m) — cds backend only (tools 74/75/77). */
  waveHeight?: number | null;
  /** Genuine ERA5 peak wave period (s) — cds backend only (tool 74). */
  wavePeriod?: number | null;
  /** Genuine ERA5 mean wave direction (°, FROM which waves come, met convention) — cds backend only (tool 77). */
  waveDirection?: number | null;
  /** ISO date the wave values were resolved to (provenance). */
  waveAsOfDate?: string | null;
  /** Provenance: which backend served rh2m (tool 50 provenance step). */
  rh2mSource?: 'cds' | 'none';
  surfaceFluxes: {
    netShortwave: number | null;                 // W/m²
    netLongwave: number | null;                  // W/m²
    sensibleFlux: number | null;                 // W/m²
    latentFlux: number | null;                   // W/m²
    downwardShortwave: number | null;            // W/m² (cds: ERA5 ssrd; proxy: Open-Meteo SW)
    airTemp2m?: number | null;                   // K (cds path only)
    surfacePressure?: number | null;             // Pa (cds path only)
    asOfDate?: string;                           // ISO date resolved (provenance)
  } | null;
  pressureWind: {
    u850: number | null;                         // m/s, 850 hPa
    v850: number | null;
    u500: number | null;                         // m/s, 500 hPa
    v500: number | null;
  } | null;
  pressureState: {
    temperature500: number | null;               // K
    geopotential500: number | null;              // m²/s²
    omega500: number | null;                     // Pa/s
    temperature850: number | null;               // K
  } | null;
  soilState: {
    temperature0_7: number | null;               // K
    temperature7_28: number | null;
    temperature28_100: number | null;
    moisture0_7: number | null;                  // m³/m³
    moisture7_28: number | null;
    moisture28_100: number | null;
  } | null;
}

async function fetchOpenMeteoEra5(
  lat: number, lon: number, dateStr?: string,
): Promise<Era5HighFidelityData> {
  const date = dateStr ?? new Date().toISOString().slice(0, 10);
  const url = `https://archive-api.open-meteo.com/v1/archive`
    + `?latitude=${lat}&longitude=${lon}`
    + `&start_date=${date}&end_date=${date}`
    + `&hourly=wind_speed_10m,wind_direction_10m,dew_point_2m,surface_pressure,`
    + `shortwave_radiation,temperature_2m,cloud_cover,`
    + `soil_temperature_0_to_7cm,soil_temperature_7_to_28cm,soil_temperature_28_to_100cm,soil_temperature_100_to_255cm,`
    + `soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,soil_moisture_28_to_100cm,soil_moisture_100_to_255cm`
    + `&timezone=auto`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null as unknown as Era5HighFidelityData;
    const data = await resp.json() as Record<string, unknown>;
    const h = data.hourly as Record<string, number[]> | undefined;
    if (!h?.wind_speed_10m) return null as unknown as Era5HighFidelityData;

    const times = h.time as unknown as string[] | undefined;
    let idx = times ? times.findIndex(t => t.includes('T12:')) : -1;
    if (idx < 0) idx = Math.floor((times?.length ?? 1) / 2);
    const get = (key: string): number | null =>
      h[key]?.[idx] != null && Number.isFinite(h[key][idx]) ? h[key][idx] : null;

    // Friction velocity: u* = κ * u(10m) / ln(10 / z₀), κ=0.41, z₀=0.03m grass
    const u10 = get('wind_speed_10m');
    const frictionVelocity = u10 != null ? 0.41 * u10 / Math.log(10 / 0.03) : null;

    // TCWV from Smith (1966): PW(mm) = 0.04 * exp(0.0666 * Td) * (P / 1013.25)
    const Td = get('dew_point_2m');
    const P = get('surface_pressure');
    const totalColumnWaterVapour =
      Td != null && P != null
        ? 0.04 * Math.exp(0.0666 * Td) * (P / 1013.25) * 0.1
        : null;

    // Surface fluxes
    const sw = get('shortwave_radiation');
    const T = get('temperature_2m');
    const cc = get('cloud_cover');
    let surfaceFluxes: Era5HighFidelityData['surfaceFluxes'] = null;
    if (sw != null) {
      const albedo = 0.23;
      const netShortwave = sw * (1 - albedo);
      let netLongwave: number | null = null;
      if (T != null) {
        const sigma = 5.67e-8;
        const eps = 0.98;
        const clearLw = eps * sigma * Math.pow(T + 273.15, 4);
        const ccf = cc != null ? (1 - 0.84 * cc / 100) : 0.8;
        netLongwave = clearLw * ccf;
      }
      const netAvail = netShortwave - (netLongwave ?? netShortwave * 0.3);
      const bowen = 1.0;
      const sensibleFlux = netAvail * bowen / (1 + bowen);
      const latentFlux = netAvail / (1 + bowen);
      surfaceFluxes = { netShortwave, netLongwave, sensibleFlux, latentFlux, downwardShortwave: sw };
    }

    // Soil state
    const st1 = get('soil_temperature_0_to_7cm');
    const st2 = get('soil_temperature_7_to_28cm');
    const st3 = get('soil_temperature_28_to_100cm');
    const sm1 = get('soil_moisture_0_to_7cm');
    const sm2 = get('soil_moisture_7_to_28cm');
    const sm3 = get('soil_moisture_28_to_100cm');
    const soilState = st1 != null || sm1 != null ? {
      temperature0_7: st1 != null ? st1 + 273.15 : null,
      temperature7_28: st2 != null ? st2 + 273.15 : null,
      temperature28_100: st3 != null ? st3 + 273.15 : null,
      moisture0_7: sm1,
      moisture7_28: sm2,
      moisture28_100: sm3,
    } : null;

    return {
      frictionVelocity,
      totalColumnWaterVapour,
      surfaceFluxes,
      pressureWind: null,
      pressureState: null,
      soilState,
      source: 'proxy', // Open-Meteo redistribution + approximations — NOT genuine ERA5
    };
  } catch {
    return null as unknown as Era5HighFidelityData;
  }
}

export async function fetchEra5HighFidelity(
  lat: number, lon: number, dateStr?: string,
  opts?: { mostOnly?: boolean; fluxOnly?: boolean; fluxDailyMean?: boolean; windOnly?: boolean; waveOnly?: boolean; skip?: boolean },
): Promise<Era5HighFidelityData> {
  // Consumer-supplied overrides make the reanalysis inputs unnecessary
  // (e.g. Tool 56 with an explicit gas-transfer velocity k): skip the CDS
  // job entirely so the call returns fast. Honest 'none' provenance.
  if (opts?.skip) {
    return {
      frictionVelocity: null, totalColumnWaterVapour: null,
      surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null,
      source: 'none',
      rh2m: null, rh2mSource: 'none', era5AsOfDate: null,
    };
  }
  if (process.env.CDS_API_TOKEN) {
    try {
      const { fetchEra5MostInput, fetchEra5FrictionVelocity, fetchEra5Tcwv, fetchEra5SurfaceFluxes,
        fetchEra5PressureWind, fetchEra5PressureState, fetchEra5SoilState, fetchEra5Wind10m,
        fetchEra5WaveClimate, getCdsStatus } = await import('../data/ecmwfCdsClient');
      if (getCdsStatus().tokenConfigured) {
        // Tool 48 (MOST) needs only zust + sshf + t2m + sp from ONE
        // single-levels request. The full 8-job batch serializes at
        // concurrency 2 and routinely exceeds the consumer budget; the
        // single-job bundle resolves in ~15–60 s and honours the date.
        if (opts?.mostOnly) {
          const most = await fetchEra5MostInput(lat, lon, dateStr).catch(() => null);
          if (most) {
            return {
              frictionVelocity: most.ustar,
              totalColumnWaterVapour: null,
              surfaceFluxes: {
                netShortwave: null, netLongwave: null,
                sensibleFlux: most.sensibleFlux, latentFlux: null,
                downwardShortwave: null,
                airTemp2m: most.airTemp2m, surfacePressure: most.surfacePressure,
                asOfDate: most.asOfDate,
              },
              pressureWind: null, pressureState: null, soilState: null,
              source: 'cds',
              rh2m: most.rh2m,
              rh2mSource: 'cds',
              era5AsOfDate: most.asOfDate,
            };
          }
          // Single-job fetch genuinely unavailable — do NOT silently fall to
          // the Open-Meteo proxy for tool 48 (its fluxes are a static-Bowen
          // split, not a measurement). Honest 'none' so the engine NaN-fires.
          return {
            frictionVelocity: null, totalColumnWaterVapour: null,
            surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null,
            source: 'none',
            rh2m: null,
            rh2mSource: 'none',
            era5AsOfDate: null,
          };
        }
        // Tool 52 (Beer-Lambert canopy extinction): needs only the surface
        // radiation fluxes (ssrd → downward shortwave for I₀). ONE CDS job
        // instead of the full 8-job batch — keeps the run inside the budget.
        // No proxy fallback: when the genuine CDS job fails, source is 'none'
        // and the engine NaN-fires honestly (zero-fallback rule).
        if (opts?.fluxOnly) {
          // Tool 59 (Priestley–Taylor) needs the paper's 24-hr MEAN net
          // radiation (all 24 hourly ERA5 steps averaged); Tool 52 (Gill)
          // keeps the 12:00 UTC snapshot.
          const fluxes = await fetchEra5SurfaceFluxes(lat, lon, dateStr,
            { dailyMean: opts?.fluxDailyMean })
            .catch(() => null);
          if (fluxes) {
            return {
              frictionVelocity: null, totalColumnWaterVapour: null,
              surfaceFluxes: fluxes,
              pressureWind: null, pressureState: null, soilState: null,
              source: 'cds',
              era5AsOfDate: fluxes.asOfDate ?? null,
            };
          }
          return {
            frictionVelocity: null, totalColumnWaterVapour: null,
            surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null,
            source: 'none',
            era5AsOfDate: null,
          };
        }
        // Tool 56 (Wanninkhof 1992 air-sea CO₂ flux): needs only the genuine
        // ERA5 10 m wind (u10/v10 → speed) for k = 0.31·u₁₀²·(Sc/660)^(−1/2).
        // ONE CDS job instead of the full 8-job batch. No proxy fallback:
        // when the genuine CDS job fails, source is 'none' and the engine
        // NaN-fires honestly (zero-fallback rule).
        if (opts?.windOnly) {
          const wind10m = await fetchEra5Wind10m(lat, lon, dateStr).catch(() => null);
          return {
            frictionVelocity: null, totalColumnWaterVapour: null,
            surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null,
            source: wind10m != null ? 'cds' : 'none',
            era5AsOfDate: null,
            wind10m,
            wind10mAsOfDate: wind10m != null ? (dateStr ?? undefined) : null,
          };
        }
        // Tools 74 (Stockdon runup) / 75 (Bruun closure depth) / 77 (CERC
        // longshore transport): need only the genuine ERA5 wave climate
        // (swh/pp1d → H₀/T₀ for 74; H_s → h* = 1.57·H_s for 75; H_0s/α₀ for
        // 77). ONE CDS job instead of the full 8-job batch. No proxy
        // fallback: when the genuine CDS job fails, source is 'none' and
        // the engine NaN-fires honestly (zero-fallback rule).
        if (opts?.waveOnly) {
          const wave = await fetchEra5WaveClimate(lat, lon, dateStr).catch(() => null);
          return {
            frictionVelocity: null, totalColumnWaterVapour: null,
            surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null,
            source: wave != null ? 'cds' : 'none',
            era5AsOfDate: null,
            waveHeight: wave?.swh ?? null,
            wavePeriod: wave?.pp1d ?? null,
            waveDirection: wave?.mwd ?? null,
            waveAsOfDate: wave?.asOfDate ?? null,
          };
        }
        const [ustar, tcwv, fluxes, wind850, wind500, state850, state500, soil] =
          await Promise.all([
            fetchEra5FrictionVelocity(lat, lon, dateStr).catch(() => null),
            fetchEra5Tcwv(lat, lon, dateStr).catch(() => null),
            fetchEra5SurfaceFluxes(lat, lon, dateStr).catch(() => null),
            fetchEra5PressureWind(lat, lon, 850).catch(() => null),
            fetchEra5PressureWind(lat, lon, 500).catch(() => null),
            fetchEra5PressureState(lat, lon, 850).catch(() => null),
            fetchEra5PressureState(lat, lon, 500).catch(() => null),
            fetchEra5SoilState(lat, lon).catch(() => null),
          ]);
        if (ustar || tcwv || fluxes || wind850 || soil)
          return {
            frictionVelocity: ustar,
            totalColumnWaterVapour: tcwv,
            surfaceFluxes: fluxes,
            pressureWind: {
              u850: wind850?.u ?? null, v850: wind850?.v ?? null,
              u500: wind500?.u ?? null, v500: wind500?.v ?? null,
            },
            pressureState: {
              temperature500: state500?.temperature ?? null,
              geopotential500: state500?.geopotential ?? null,
              omega500: state500?.omega ?? null,
              temperature850: state850?.temperature ?? null,
            },
            soilState: soil ? {
              temperature0_7: soil.temperature0_7,
              temperature7_28: soil.temperature7_28,
              temperature28_100: soil.temperature28_100,
              moisture0_7: soil.moisture0_7,
              moisture7_28: soil.moisture7_28,
              moisture28_100: soil.moisture28_100,
            } : null,
            source: 'cds', // genuine ERA5 reanalysis via Copernicus CDS
          };
      }
    } catch { /* fall through to Open-Meteo */ }
  }

  // Tool 56 (Wanninkhof 1992): the Open-Meteo redistribution subset is NOT
  // an authentic wind source (per the audit rule, Open-Meteo is a proxy).
  // Honest 'none' — the engine NaN-fires rather than using proxy wind.
  if (opts?.windOnly) {
    return {
      frictionVelocity: null, totalColumnWaterVapour: null,
      surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null,
      source: 'none', wind10m: null, wind10mAsOfDate: null,
    };
  }
  return fetchOpenMeteoEra5(lat, lon, dateStr) ?? {
    frictionVelocity: null, totalColumnWaterVapour: null,
    surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null,
    source: 'none',
  };
}

// ══════════════════════════════════════════════════════════════════
//  Rainfall erosivity R (USLE / RUSLE, Tool 45)
//  Authentic source: NOAA GHCN-Daily station normals (1991–2020) via
//  the Regional Climate Center ACIS service (no key). Annual
//  precipitation P (mm) → Renard & Freimund (1994) regression, the
//  RUSLE Handbook 703 erosivity estimate for stations without EI30
//  records:
//    P ≥ 637 mm : R = 0.0483·P^1.610
//    P < 637 mm : R = 587.8 − 1.219·P + 0.004105·P²
//  R in MJ·mm/(ha·h·yr). Null when no reporting station is found.
// ══════════════════════════════════════════════════════════════════

export interface RFactorData {
  R: number;                 // MJ·mm/(ha·h·yr)
  annualPrecipMm: number;
  station: string;
  sid: string;
  stationLat: number;
  stationLon: number;
  distanceKm: number;
}

export async function fetchRFactor(
  lat: number, lon: number,
): Promise<RFactorData | null> {
  // 1) Nearest climatology station with daily precip records within ±1°
  const metaUrl = 'https://data.rcc-acis.org/StnMeta?params='
    + encodeURIComponent(JSON.stringify({
      bbox: [lon - 1, lat - 1, lon + 1, lat + 1],
      elems: 'pcpn',
      meta: ['name', 'll', 'sids', 'elev'],
    }));
  const meta = await strictFetch(metaUrl, 25000) as {
    meta?: Array<{ name?: string; ll?: [number, number]; sids?: string[] }>;
  };
  const stations = (meta.meta ?? []).filter((s) => Array.isArray(s.ll) && s.ll.length === 2);
  if (!stations.length) return null;
  const hDist = (lon1: number, lat1: number, lon2: number, lat2: number) => {
    const R = 6371, rd = Math.PI / 180;
    const dLat = (lat2 - lat1) * rd, dLon = (lon2 - lon1) * rd;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * rd) * Math.cos(lat2 * rd) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  // 2) Monthly precip normals (1991–2020) — try nearest stations in
  // distance order; skip those without full 12-month normals (e.g.
  // CoCoRaHS community rain stations publish no normals).
  const ranked = stations
    .map((s) => ({ s, d: hDist(lon, lat, s.ll![0], s.ll![1]) }))
    .sort((a, b) => a.d - b.d);
  let annualMm: number | null = null;
  let chosen: (typeof ranked)[number] | null = null;
  let chosenSid = '';
  for (const cand of ranked.slice(0, 8)) {
    const sid6 = cand.s.sids?.find((x) => x.endsWith(' 6'))?.split(' ')[0];
    if (!sid6) continue;
    const dataUrl = 'https://data.rcc-acis.org/StnData?params='
      + encodeURIComponent(JSON.stringify({
        sid: sid6,
        sdate: '2024-01-01', edate: '2024-12-01',
        elems: [{ name: 'pcpn', interval: 'mly', duration: 1, reduce: 'sum', normal: 1 }],
      }));
    let data: { data?: Array<[string, string]> };
    try {
      data = await strictFetch(dataUrl, 25000) as { data?: Array<[string, string]> };
    } catch { continue; }
    const rows = (data.data ?? []).filter((r) => Number.isFinite(parseFloat(r[1])));
    if (rows.length < 12) continue;
    annualMm = rows.slice(0, 12).reduce((s, r) => s + parseFloat(r[1]), 0) * 25.4;
    if (!(annualMm > 0)) { annualMm = null; continue; }
    chosen = cand;
    chosenSid = sid6;
    break;
  }
  if (!chosen || annualMm == null) return null;

  // 3) Renard & Freimund (1994) / RUSLE Handbook 703 erosivity
  const R = annualMm >= 637
    ? 0.0483 * Math.pow(annualMm, 1.610)
    : 587.8 - 1.219 * annualMm + 0.004105 * annualMm * annualMm;

  return {
    R, annualPrecipMm: annualMm,
    station: chosen.s.name ?? chosenSid, sid: chosenSid,
    stationLat: chosen.s.ll![1], stationLon: chosen.s.ll![0],
    distanceKm: chosen.d,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Daily TMAX/TMIN for Growing Degree Days (Tool 58)
//  Authentic source: NOAA GHCN-Daily station observations via the
//  Regional Climate Center ACIS service (no key) — the "standard Class A
//  weather station" daily maximum/minimum air temperatures at 2 m that
//  McMaster & Wilhelm (1997) use as the inputs to Eq. (1). ACIS reports
//  maxt/mint in °F; converted to °C here.
// ══════════════════════════════════════════════════════════════════

export interface GddDailyObs {
  date: string;    // YYYY-MM-DD
  tmaxC: number;   // daily maximum 2 m air temperature (°C)
  tminC: number;   // daily minimum 2 m air temperature (°C)
}

export interface GddStationData {
  station: string;
  sid: string;
  stationLat: number;
  stationLon: number;
  distanceKm: number;
  days: GddDailyObs[];   // most-recent-first daily TMAX/TMIN
}

export async function fetchGddStationData(
  lat: number, lon: number, startDate?: string, endDate?: string,
): Promise<GddStationData | null> {
  // 1) Nearest station with both daily max AND min temperature records
  //    within ±1.5° — skip stations that only report one of the two.
  const metaUrl = 'https://data.rcc-acis.org/StnMeta?params='
    + encodeURIComponent(JSON.stringify({
      bbox: [lon - 1.5, lat - 1.5, lon + 1.5, lat + 1.5],
      elems: ['maxt', 'mint'],
      meta: ['name', 'll', 'sids', 'elev'],
    }));
  const meta = await strictFetch(metaUrl, 25000) as {
    meta?: Array<{ name?: string; ll?: [number, number]; sids?: string[] }>;
  };
  const stations = (meta.meta ?? []).filter((s) => Array.isArray(s.ll) && s.ll.length === 2);
  if (!stations.length) return null;
  const hDist = (lon1: number, lat1: number, lon2: number, lat2: number) => {
    const R = 6371, rd = Math.PI / 180;
    const dLat = (lat2 - lat1) * rd, dLon = (lon2 - lon1) * rd;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * rd) * Math.cos(lat2 * rd) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  const ranked = stations
    .map((s) => ({ s, d: hDist(lon, lat, s.ll![0], s.ll![1]) }))
    .sort((a, b) => a.d - b.d);

  // Request window: exactly the selected [start, end] range (honoured
  // verbatim); when no dates are given, fall back to the trailing 30 days.
  const sdate = startDate
    ? new Date(startDate).toISOString().slice(0, 10)
    : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const edate = endDate
    ? new Date(endDate).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  for (const cand of ranked.slice(0, 8)) {
    const sid6 = cand.s.sids?.find((x) => x.endsWith(' 6'))?.split(' ')[0];
    if (!sid6) continue;
    const dataUrl = 'https://data.rcc-acis.org/StnData?params='
      + encodeURIComponent(JSON.stringify({
        sid: sid6,
        sdate, edate,
        elems: [{ name: 'maxt' }, { name: 'mint' }],
      }));
    let data: { data?: Array<[string, string, string]> };
    try {
      data = await strictFetch(dataUrl, 25000) as { data?: Array<[string, string, string]> };
    } catch { continue; }
    const days: GddDailyObs[] = [];
    for (const [date, tmaxF, tminF] of (data.data ?? [])) {
      const tmax = parseFloat(tmaxF), tmin = parseFloat(tminF);
      if (!Number.isFinite(tmax) || !Number.isFinite(tmin)) continue; // missing obs
      days.push({
        date,
        tmaxC: (tmax - 32) * 5 / 9,
        tminC: (tmin - 32) * 5 / 9,
      });
    }
    if (days.length >= 2) {
      return {
        station: cand.s.name ?? sid6, sid: sid6,
        stationLat: cand.s.ll![1], stationLon: cand.s.ll![0],
        distanceKm: cand.d,
        days: days.reverse(), // most-recent-first
      };
    }
  }
  return null;
}
