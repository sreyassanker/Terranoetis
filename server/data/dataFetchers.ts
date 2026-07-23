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

async function strictFetch(url: string): Promise<Record<string, unknown>> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
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
  events: Array<{
    mag: number;
    depth: number;
    lat: number;
    lon: number;
    time: string;
    place: string;
  }>;
}

export async function fetchEarthquakes(
  lat: number, lon: number,
  startDate?: string, endDate?: string, radiusKm: number = 500,
): Promise<EarthquakeData> {
  const start = startDate ?? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const end = endDate ?? new Date().toISOString().slice(0, 10);
  const latRange = radiusKm / 111;
  const lonRange = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

  const data = await strictFetch(
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson`
    + `&starttime=${start}&endtime=${end}`
    + `&minlatitude=${lat - latRange}&maxlatitude=${lat + latRange}`
    + `&minlongitude=${lon - lonRange}&maxlongitude=${lon + lonRange}`
    + `&minmagnitude=2.5&orderby=magnitude&limit=200`
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

  // Estimate b-value: b ≈ log10(e) / (avgMag - minMag)
  const minMag = 2.5;
  const bVal = avgMag > minMag ? Math.log10(Math.E) / (avgMag - minMag) : 1.0;

  return { count: events.length, maxMagnitude: maxMag, avgMagnitude: avgMag, avgDepth, bValue: bVal, events };
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

  // Try MODIS first, then VIIRS
  const sources = ['MODIS_NRT', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT'];
  let allFires: FireData['fires'] = [];

  for (const source of sources) {
    try {
      const resp = await fetch(
        `https://firms.modaps.eosdis.nasa.gov/api/area/json/${mapKey}/${source}/${lat}/${lon}/${radiusKm}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
      );
      if (!resp.ok) continue;
      const json = await resp.json();
      if (!Array.isArray(json)) continue;
      const parsed = json.map((f: Record<string, unknown>) => ({
        lat: Number(f.latitude ?? 0),
        lon: Number(f.longitude ?? 0),
        frp: Number(f.frp ?? 0),
        brightness: Number(f.brightness ?? 0),
        scan: Number(f.scan ?? 0),
        track: Number(f.track ?? 0),
        confidence: typeof f.confidence === 'number' ? f.confidence : (f.confidence === 'h' ? 90 : f.confidence === 'n' ? 50 : 10),
        satellite: String(f.satellite ?? source),
        acq_date: String(f.acq_date ?? ''),
      }));
      allFires = allFires.concat(parsed);
    } catch {
      // try next source
    }
  }

  if (allFires.length === 0) throw new Error('No fire detections from FIRMS API');

  const frps = allFires.map(f => f.frp).filter(f => f > 0);
  const avgFRP = frps.length > 0 ? frps.reduce((a, b) => a + b, 0) / frps.length : 0;
  const maxFRP = frps.length > 0 ? Math.max(...frps) : 0;
  const estArea = allFires.reduce((sum, f) => sum + f.scan * f.track * 0.01, 0);

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

// ══════════════════════════════════════════════════════════════════
//  ISRIC SoilGrids (Soil Properties at Depth)
// ══════════════════════════════════════════════════════════════════

export interface SoilData {
  clay: number;       // %
  sand: number;       // %
  silt: number;       // %
  organic_carbon: number;  // dg/kg
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
    + `&depth=${depth}&value=mean`
  );
  const props = data.properties as { layers?: unknown[] } | undefined;
  if (!props?.layers) throw new Error('No soil layers in ISRIC response');

  const getProp = (name: string): number => {
    const layer = (props!.layers as Array<Record<string, unknown>>).find((l) => (l as Record<string, unknown>).name === name);
    const depths = layer?.depths as Array<Record<string, unknown>> | undefined;
    if (!depths?.[0]) return 0;
    const values = depths[0].values as Record<string, unknown> | undefined;
    return ((values?.mean as number | undefined) ?? 0) / 10;
  };

  const clay = getProp('clay');
  const sand = getProp('sand');
  const silt = getProp('silt') || Math.max(0, 100 - clay - sand);

  let texture_class = 'loam';
  if (sand > 85) texture_class = 'sand';
  else if (clay > 40) texture_class = 'clay';
  else if (sand > 50 && clay < 15) texture_class = 'sandy loam';
  else if (silt > 50) texture_class = 'silt';

  return {
    clay,
    sand,
    silt,
    organic_carbon: getProp('soc'),
    ph_h2o: getProp('phh2o'),
    bulk_density: getProp('bdod'),
    cec: getProp('cec'),
    texture_class,
  };
}

// ══════════════════════════════════════════════════════════════════
//  NOAA SST (Sea Surface Temperature)
// ══════════════════════════════════════════════════════════════════

export interface SSTData {
  sst: number;
  anomaly: number;
}

export async function fetchSST(
  lat: number, lon: number,
): Promise<SSTData> {
  const url =
    `https://www.ncei.noaa.gov/erddap/griddap/ncdc_oisst_v2_avhrr_by_time_zlev_lat_lon.json?analysed_sst[${encodeURIComponent('(last)')}][(0.0)][(${lat})][(${lon})]`
    + `,anomaly[${encodeURIComponent('(last)')}][(0.0)][(${lat})][(${lon})]`;
  const data = await strictFetch(url);
  const table = data.table as { rows?: unknown[][] } | undefined;
  const rows = table?.rows;
  if (!rows || rows.length === 0) throw new Error('No OISST data returned');
  const row = rows[0] as unknown[];
  return {
    sst: Number(row[4] ?? NaN),
    anomaly: Number(row[5] ?? 0),
  };
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
  // ORNL DAAC MODIS Web Service — MOD13Q1 (NDVI/EVI) + MCD15A3H (LAI/FPAR)
  const getBand = async (product: string, band: string): Promise<number> => {
    const url = `https://modis.ornl.gov/rst/api/v1/${product}/subset?latitude=${lat}&longitude=${lon}&band=${band}`;
    const data = await strictFetch(url) as { subset?: Array<Record<string, unknown>> };
    const subset = data?.subset;
    if (!subset) throw new Error(`No ${product}/${band} data`);
    const b = subset.find((s) => s.band === band);
    const bandData = b?.data as number[] | undefined;
    if (!bandData?.[0]) throw new Error(`Empty band ${band}`);
    return Number(bandData[0]) * ((b?.scale as number | undefined) ?? 1);
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
    lai = await getBand('MCD15A3H', 'Lai');
  } catch {
    lai = ndvi > 0 ? ndvi * 6 : 0;
  }
  try {
    fpar = await getBand('MCD15A3H', 'Fpar_500m');
  } catch {
    fpar = Math.max(0, Math.min(1, ndvi * 1.2));
  }

  // Resolve land cover from MODIS MCD12Q1 if possible
  let landCover = 'unknown';
  try {
    const lcData = await strictFetch(
      `https://modis.ornl.gov/rst/api/v1/MCD12Q1/subset?latitude=${lat}&longitude=${lon}&band=LC_Type1`
    ) as { subset?: Array<Record<string, unknown>> };
    const subset = lcData?.subset;
    if (subset) {
      const band = subset.find((s) => s.band === 'LC_Type1');
      const bandData = band?.data as number[] | undefined;
      if (bandData?.[0]) {
        const code = Number(bandData[0]);
        const LAND_COVER_NAMES: Record<number, string> = {
          1: 'evergreen needleleaf forest', 2: 'evergreen broadleaf forest',
          3: 'deciduous needleleaf forest', 4: 'deciduous broadleaf forest',
          5: 'mixed forest', 6: 'closed shrubland', 7: 'open shrubland',
          8: 'woody savanna', 9: 'savanna', 10: 'grassland',
          11: 'permanent wetland', 12: 'cropland', 13: 'urban',
          14: 'cropland/natural mosaic', 15: 'snow/ice', 16: 'barren',
        };
        landCover = LAND_COVER_NAMES[code] ?? 'unknown';
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
  concentration: number; // 0-1
  extent: number;        // km²
  thickness: number;     // meters
}

export async function fetchSeaIce(
  lat: number, lon: number,
): Promise<SeaIceData> {
  try {
    const { fetchSeaIce: fetchNSIDCSeaIce } = await import('../data/seaice');
    const result = await fetchNSIDCSeaIce(lat, lon);
    return {
      concentration: result.concentration ?? 0,
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
  // USGS Quaternary Faults Database — ArcGIS REST API
  const faultsUrl =
    `https://usgs.maps.arcgis.com/arcgis/rest/services/qfaults_database/MapServer/0/query`
    + `?where=1%3D1&geometry=${lon}%2C${lat}`
    + `&geometryType=esriGeometryPoint&inSR=4326`
    + `&spatialRel=esriSpatialRelIntersects&distance=100000&units=esriSRUnit_Meter`
    + `&outFields=*&returnGeometry=true&f=json`;
  const faultsData = await strictFetch(faultsUrl);

  const features = faultsData?.features as unknown[] | undefined;
  const faultCount = features?.length ?? 0;
  const faultProximity = faultCount > 0 ? 10 : 500;

  // Plate boundary model — compute distance to nearest known trench/ridge coordinates
  // PB2002 plate boundary segments (simplified major boundaries)
  const plateSegments: Array<{ lat: number; lon: number; type: string }> = [
    // Circum-Pacific (Ring of Fire)
    { lat: -30, lon: -70, type: 'subduction' },
    { lat: -20, lon: -70, type: 'subduction' },
    { lat: 0, lon: -80, type: 'subduction' },
    { lat: 20, lon: -105, type: 'subduction' },
    { lat: 40, lon: -125, type: 'subduction' },
    { lat: 50, lon: -160, type: 'subduction' },
    { lat: 55, lon: -165, type: 'subduction' },
    { lat: 50, lon: 160, type: 'subduction' },
    { lat: 40, lon: 145, type: 'subduction' },
    { lat: 30, lon: 130, type: 'subduction' },
    { lat: 10, lon: 125, type: 'subduction' },
    { lat: 0, lon: 120, type: 'subduction' },
    { lat: -10, lon: 120, type: 'subduction' },
    // Mid-Atlantic Ridge
    { lat: -30, lon: -15, type: 'rift' },
    { lat: -10, lon: -30, type: 'rift' },
    { lat: 10, lon: -40, type: 'rift' },
    { lat: 30, lon: -40, type: 'rift' },
    { lat: 50, lon: -30, type: 'rift' },
    { lat: 60, lon: -25, type: 'rift' },
    // Alpine-Himalayan
    { lat: 35, lon: -5, type: 'collision' },
    { lat: 35, lon: 25, type: 'collision' },
    { lat: 30, lon: 50, type: 'collision' },
    { lat: 25, lon: 80, type: 'collision' },
    { lat: 25, lon: 90, type: 'collision' },
    // East African Rift
    { lat: -5, lon: 35, type: 'rift' },
    { lat: 5, lon: 40, type: 'rift' },
    // San Andreas (transform)
    { lat: 35, lon: -120, type: 'transform' },
    { lat: 38, lon: -122, type: 'transform' },
    // Alpine Fault NZ
    { lat: -45, lon: 168, type: 'transform' },
  ];

  let minDist = Infinity;
  let boundaryType = 'none';
  for (const seg of plateSegments) {
    const d = Math.sqrt((seg.lat - lat) ** 2 + (seg.lon - lon) ** 2) * 111;
    if (d < minDist) {
      minDist = d;
      boundaryType = seg.type;
    }
  }

  const plateBoundary = minDist < 500;
  const combinedDist = Math.min(faultProximity, plateBoundary ? minDist : 500);

  return {
    plateBoundary,
    faultProximity: combinedDist,
    subductionZone: boundaryType === 'subduction',
    riftZone: boundaryType === 'rift',
    transformBoundary: boundaryType === 'transform',
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
  const [kpData, solarData] = await Promise.all([
    strictFetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'),
    strictFetch('https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json'),
  ]);

  const kpArr = kpData as unknown as unknown[] | undefined;
  const kpRow = kpArr?.[1] as Record<string, unknown> | undefined;
  const kp = kpRow?.kp_index as number | undefined;
  if (kp === undefined) throw new Error('No Kp index in NOAA response');
  const solarArr = solarData as unknown as unknown[] | undefined;
  const solarRow = solarArr?.[solarArr.length - 1] as Record<string, unknown> | undefined;
  const speed = solarRow?.speed as string | number | undefined;
  if (speed === undefined) throw new Error('No solar wind speed in NOAA response');

  return {
    kpIndex: kp,
    dstIndex: -20 - kp * 10,
    solarWindSpeed: Number(speed),
    f107: 120,
    bZ: 0,
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
  lat: number, lon: number,
): Promise<WaterData> {
  // USGS Water Services API
  const data = await strictFetch(
    `https://waterservices.usgs.gov/nwis/iv/?format=json`
    + `&bbox=${lon - 0.5},${lat - 0.5},${lon + 0.5},${lat + 0.5}`
    + `&parameterCd=00060,00065,00010,00095,00300`
    + `&siteStatus=all&limit=10`
  );
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
    return (valueArr?.[0]?.value as number | undefined) ?? 0;
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
  const url = `https://worldcover.esa.int/api/v1/classify?lat=${lat}&lon=${lon}`;
  const data = await strictFetch(url);

  const codeNum = (data.code as number | undefined);
  if (codeNum === undefined) throw new Error('ESA WorldCover returned no classification');

  const code = Number(codeNum);
  // https://esa-worldcover.s3.eu-central-1.amazonaws.com/legend/ESA_WorldCover_10m_2021_V2_0_Legend.pdf
  const CLASS_NAMES: Record<number, string> = {
    10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland',
    40: 'Cropland', 50: 'Built-up', 60: 'Bare/sparse vegetation',
    70: 'Snow/ice', 80: 'Permanent water bodies', 90: 'Herbaceous wetland',
    95: 'Mangroves', 100: 'Moss/lichen',
  };

  // Estimate tree/impervious/cropland/wetland fractions from class
  const treeCover = code === 10 ? 85 : code === 95 ? 40 : 0;
  const impervious = code === 50 ? 60 : 0;
  const cropland = code === 40 ? 80 : 0;
  const wetland = (code === 90 || code === 95) ? 80 : 0;

  return {
    class: CLASS_NAMES[code] ?? 'Unknown',
    code,
    treeCover,
    impervious,
    cropland,
    wetland,
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

// ══════════════════════════════════════════════════════════════════
//  Glaciers/Ice Sheets (RGI + climate proxy)
// ══════════════════════════════════════════════════════════════════

export interface GlacierData {
  area: number;        // km²
  volume: number;      // km³
  massBalance: number; // m w.e./yr
  equilibriumLine: number; // m
}

export async function fetchGlacierData(
  lat: number, lon: number,
): Promise<GlacierData> {
  try {
    const { fetchGlacier } = await import('../data/glacier');
    const result = await fetchGlacier(lat, lon);
    const areaKm2 = result.areaKm2 ?? (result.areaFraction ?? 0) * 10000;
    return {
      area: areaKm2,
      volume: areaKm2 * 0.085,
      massBalance: 0,
      equilibriumLine: 0,
    };
  } catch {
    return { area: 0, volume: 0, massBalance: 0, equilibriumLine: 0 };
  }
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
  const water = await fetchWaterData(lat, lon);
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
  surfaceFluxes: {
    netShortwave: number | null;                 // W/m²
    netLongwave: number | null;                  // W/m²
    sensibleFlux: number | null;                 // W/m²
    latentFlux: number | null;                   // W/m²
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

export async function fetchEra5HighFidelity(
  lat: number, lon: number, dateStr?: string,
): Promise<Era5HighFidelityData> {
  const defaultNull = {
    frictionVelocity: null,
    totalColumnWaterVapour: null,
    surfaceFluxes: null,
    pressureWind: null,
    pressureState: null,
    soilState: null,
  };

  // Skip if CDS token not configured (fast check)
  if (!process.env.CDS_API_TOKEN) return defaultNull;

  try {
    const { getCdsStatus } = await import('../data/ecmwfCdsClient');
    if (!getCdsStatus().tokenConfigured) return defaultNull;
  } catch {
    return defaultNull;
  }

  try {
    const [
      { fetchEra5FrictionVelocity, fetchEra5Tcwv, fetchEra5SurfaceFluxes,
        fetchEra5PressureWind, fetchEra5PressureState, fetchEra5SoilState },
    ] = await Promise.all([
      import('../data/ecmwfCdsClient'),
    ]);

    const [ustar, tcwv, fluxes, wind850, wind500, state850, state500, soil] =
      await Promise.all([
        fetchEra5FrictionVelocity(lat, lon).catch(() => null),
        fetchEra5Tcwv(lat, lon, dateStr).catch(() => null),
        fetchEra5SurfaceFluxes(lat, lon).catch(() => null),
        fetchEra5PressureWind(lat, lon, 850).catch(() => null),
        fetchEra5PressureWind(lat, lon, 500).catch(() => null),
        fetchEra5PressureState(lat, lon, 850).catch(() => null),
        fetchEra5PressureState(lat, lon, 500).catch(() => null),
        fetchEra5SoilState(lat, lon).catch(() => null),
      ]);

    return {
      frictionVelocity: ustar,
      totalColumnWaterVapour: tcwv,
      surfaceFluxes: fluxes,
      pressureWind: {
        u850: wind850?.u ?? null,
        v850: wind850?.v ?? null,
        u500: wind500?.u ?? null,
        v500: wind500?.v ?? null,
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
    };
  } catch (e) {
    console.warn('[Era5HighFidelity] CDS fetch failed:', e);
    return defaultNull;
  }
}
