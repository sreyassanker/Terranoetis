export interface BBox {
  latMin: number; latMax: number;
  lonMin: number; lonMax: number;
}

export interface RealDataSnapshot {
  bbox: BBox;
  earthquakes: EQEvent[];
  weather: WeatherAtPoint[];
  fires: FireHotspot[];
  volcanoes: VolcanoAdvisory[];
  eonet: EonetEvent[];
  gdacs: GdacsEvent[];
  netcdf: NetcdfSummary | null;
  gridVars: Record<string, number>;
  fetchedAt: number;
}

export interface EQEvent { lat: number; lon: number; mag: number; depth: number; time: string }
export interface WeatherAtPoint { lat: number; lon: number; temp: number; humidity: number; windSpeed: number; pressure: number; precip: number }
export interface FireHotspot { lat: number; lon: number; brightness: number; frp: number; date: string }
export interface VolcanoAdvisory { volcano: string; lat: number; lon: number; status: string }
export interface EonetEvent { id: string; title: string; category: string; lat: number; lon: number; date: string }
export interface GdacsEvent { title: string; lat: number; lon: number; severity: string; type: string }
export interface NetcdfSummary { variableName: string; valueMin: number; valueMax: number; avgValue: number; sampleCount: number }

function inBBox(lat: number, lon: number, bbox: BBox): boolean {
  return lat >= bbox.latMin && lat <= bbox.latMax && lon >= bbox.lonMin && lon <= bbox.lonMax;
}

function bboxCenter(bbox: BBox): { lat: number; lon: number } {
  return { lat: (bbox.latMin + bbox.latMax) / 2, lon: (bbox.lonMin + bbox.lonMax) / 2 };
}

function parseGeoJsonFeatures(data: unknown): unknown[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.features) return data.features;
  return [];
}

async function cachedFetch(key: string, url: string, ttl: number): Promise<unknown> {
  const cache = global.__realDataCache || (global.__realDataCache = new Map());
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl * 1000) return hit.data;
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`${key} returned ${resp.status}`);
  const data = await resp.json();
  cache.set(key, { data, ts: Date.now() });
  return data;
}

function toRad(v: number): number { return v * Math.PI / 180; }

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchRealDataForBBox(bbox: BBox): Promise<RealDataSnapshot> {
  const center = bboxCenter(bbox);
  const snapshot: RealDataSnapshot = {
    bbox, earthquakes: [], weather: [], fires: [], volcanoes: [],
    eonet: [], gdacs: [], netcdf: null, gridVars: {}, fetchedAt: Date.now(),
  };

  // 1. Fetch earthquakes from USGS (global, filter by bbox)
  try {
    const eqData = await cachedFetch('earthquakes', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', 60);
    for (const f of parseGeoJsonFeatures(eqData)) {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const lon = coords[0]; const lat = coords[1];
      if (inBBox(lat, lon, bbox)) {
        snapshot.earthquakes.push({
          lat, lon,
          mag: f.properties?.mag || 0,
          depth: coords[2] || 10,
          time: f.properties?.time || '',
        });
      }
    }
  } catch { /* noop */ }

  // 2. Fetch weather from Open-Meteo (center of bbox)
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,pressure_msl&timezone=auto`;
    const wData = await cachedFetch(`weather_${center.lat}_${center.lon}`, weatherUrl, 300);
    if (wData?.current) {
      const c = wData.current;
      snapshot.weather.push({
        lat: center.lat, lon: center.lon,
        temp: c.temperature_2m ?? 20,
        humidity: c.relative_humidity_2m ?? 50,
        windSpeed: c.wind_speed_10m ?? 10,
        pressure: c.pressure_msl ?? 1013,
        precip: c.precipitation ?? 0,
      });
    }
  } catch { /* noop */ }

  // 3. Fetch NASA FIRMS fires (global CSV, filter by bbox)
  try {
    const mapKey = process.env.NASA_FIRMS_MAP_KEY;
    if (mapKey) {
      const resp = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/world/1`, {
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const csv = await resp.text();
        for (const line of csv.split('\n').slice(1)) {
          if (!line.trim()) continue;
          const parts = line.split(',');
          const lat = parseFloat(parts[0]); const lon = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lon) && inBBox(lat, lon, bbox)) {
            snapshot.fires.push({
              lat, lon,
              brightness: parseFloat(parts[2]) || 0,
              frp: parseFloat(parts[8]) || 0,
              date: parts[4] || '',
            });
          }
        }
      }
    }
  } catch { /* noop */ }

  // 4. Fetch USGS volcanoes
  try {
    const vData = await cachedFetch('volcanoes', 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated', 300);
    for (const v of Array.isArray(vData) ? vData : []) {
      const lat = Number(v.lat); const lon = Number(v.long);
      if (!isNaN(lat) && !isNaN(lon) && inBBox(lat, lon, bbox)) {
        snapshot.volcanoes.push({ volcano: v.vName || 'Unknown', lat, lon, status: v.alertLevel || 'GREEN' });
      }
    }
  } catch { /* noop */ }

  // 5. Fetch EONET events
  try {
    const eoData = await cachedFetch('eonet', 'https://eonet.gsfc.nasa.gov/api/v3/events?days=30&status=open', 120);
    for (const ev of parseGeoJsonFeatures(eoData)) {
      const coords = ev.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const lon = coords[0]; const lat = coords[1];
      if (inBBox(lat, lon, bbox)) {
        const cats = (ev.categories || []).map((c: unknown) => (c as Record<string, unknown>).title || '').join(',');
        snapshot.eonet.push({
          id: ev.id || '', title: ev.title || '',
          category: cats, lat, lon, date: ev.date || '',
        });
      }
    }
  } catch { /* noop */ }

  // 6. Fetch GDACS alerts (XML, parse basic)
  try {
    const gdacsResp = await fetch('https://www.gdacs.org/xml/rss.xml', { signal: AbortSignal.timeout(10000) });
    if (gdacsResp.ok) {
      const xml = await gdacsResp.text();
      const titleMatches = xml.match(/<title>(.*?)<\/title>/g) || [];
      const latMatches = xml.match(/<geo:lat>(.*?)<\/geo:lat>/g) || [];
      const lonMatches = xml.match(/<geo:long>(.*?)<\/geo:long>/g) || [];
      for (let i = 1; i < titleMatches.length && i <= latMatches.length; i++) {
        const lat = parseFloat(latMatches[i]?.replace(/<\/?geo:lat>/g, '') || '');
        const lon = parseFloat(lonMatches[i]?.replace(/<\/?geo:long>/g, '') || '');
        if (!isNaN(lat) && !isNaN(lon) && inBBox(lat, lon, bbox)) {
          const title = titleMatches[i]?.replace(/<\/?title>/g, '') || '';
          snapshot.gdacs.push({
            title, lat, lon,
            severity: title.includes('Red') ? 'red' : title.includes('Orange') ? 'orange' : 'green',
            type: title.includes('Tropical') ? 'cyclone' : title.includes('Earthquake') ? 'earthquake' : 'unknown',
          });
        }
      }
    }
  } catch { /* noop */ }

  return snapshot;
}

export interface DerivedParams {
  scenarioType: string;
  params: Record<string, unknown>;
  variableName?: string;
  colorValues?: number[];
  valueMin?: number;
  valueMax?: number;
  dataSources: string[];
}

export function deriveParams(snapshot: RealDataSnapshot, hazardType: string): DerivedParams {
  const center = bboxCenter(snapshot.bbox);
  const dataSources: string[] = [];
  const result: DerivedParams = { scenarioType: hazardType, params: { lat: center.lat, lon: center.lon }, dataSources };

  const avgHumidity = snapshot.weather.reduce((s, w) => s + w.humidity, 0) / Math.max(1, snapshot.weather.length);
  const avgWind = snapshot.weather.reduce((s, w) => s + w.windSpeed, 0) / Math.max(1, snapshot.weather.length);
  const avgPressure = snapshot.weather.reduce((s, w) => s + w.pressure, 0) / Math.max(1, snapshot.weather.length);

  if (snapshot.weather.length > 0) dataSources.push('open-meteo');

  if (snapshot.earthquakes.length > 0) dataSources.push('usgs-earthquakes');
  if (snapshot.fires.length > 0) dataSources.push('nasa-firms');
  if (snapshot.volcanoes.length > 0) dataSources.push('usgs-volcanoes');
  if (snapshot.eonet.length > 0) dataSources.push('nasa-eonet');
  if (snapshot.gdacs.length > 0) dataSources.push('gdacs');

  switch (hazardType) {
    case 'earthquake_swarm': {
      const maxMag = snapshot.earthquakes.reduce((m, e) => Math.max(m, e.mag), 0);
      const avgDepth = snapshot.earthquakes.reduce((s, e) => s + e.depth, 0) / Math.max(1, snapshot.earthquakes.length);
      const numEvents = Math.max(10, snapshot.earthquakes.length * 2 || 50);
      result.params = {
        lat: center.lat, lon: center.lon,
        depthRange: [Math.max(0.1, avgDepth - 10), avgDepth + 10],
        magnitudeRange: [Math.max(0, maxMag - 1.5), Math.min(9.5, maxMag + 1)],
        numEvents,
        timeWindow: 168,
        decayModel: 'omori',
      };
      if (snapshot.earthquakes.length === 0) {
        result.params.magnitudeRange = [4.0, 6.0];
        result.params.depthRange = [5, 30];
      }
      break;
    }

    case 'hurricane_landfall': {
      const cat = snapshot.gdacs.find(g => g.type === 'cyclone')
        ? 3 : Math.min(5, Math.max(1, Math.round(avgWind / 15)));
      result.params = {
        lat: center.lat, lon: center.lon,
        category: cat,
        forwardSpeed: avgWind || 15,
        pressure: avgPressure || 950,
        radius: 50 + (cat * 15),
        landfallTime: 24,
      };
      break;
    }

    case 'wildfire_spread': {
      const nearestFire = snapshot.fires.length > 0
        ? snapshot.fires.reduce((a, b) =>
            haversineKm(a.lat, a.lon, center.lat, center.lon) < haversineKm(b.lat, b.lon, center.lat, center.lon) ? a : b
          )
        : null;
      const fireLat = nearestFire?.lat ?? center.lat;
      const fireLon = nearestFire?.lon ?? center.lon;
      const fireCount = snapshot.fires.length;
      result.params = {
        lat: fireLat, lon: fireLon,
        area: 5000 + fireCount * 200,
        windSpeed: avgWind || 20,
        windDir: 270,
        humidity: avgHumidity || 15,
        fuelType: 'forest',
        duration: 72,
      };
      break;
    }

    case 'volcanic_eruption': {
      const nearestVolcano = snapshot.volcanoes.length > 0
        ? snapshot.volcanoes.reduce((a, b) =>
            haversineKm(a.lat, a.lon, center.lat, center.lon) < haversineKm(b.lat, b.lon, center.lat, center.lon) ? a : b
          )
        : null;
      result.params = {
        lat: nearestVolcano?.lat ?? center.lat,
        lon: nearestVolcano?.lon ?? center.lon,
        vei: nearestVolcano?.status === 'RED' ? 4 : nearestVolcano?.status === 'ORANGE' ? 3 : 2,
        ashHeight: 5000 + (nearestVolcano ? 3000 : 0),
        windDir: 260,
        duration: 48,
      };
      break;
    }

    case 'flood_inundation': {
      const rainfall = snapshot.weather[0]?.precip ?? 50;
      result.params = {
        lat: center.lat, lon: center.lon,
        rainfall: Math.max(10, rainfall * 10),
        catchmentArea: 2000 + (snapshot.eonet.filter(e => e.category.includes('Flood')).length * 1000),
        soilSaturation: Math.min(1, Math.max(0, (avgHumidity / 100) * 0.8 + 0.2)),
        duration: 72,
      };
      break;
    }

    case 'tsunami_wave': {
      const nearestEQ = snapshot.earthquakes.length > 0
        ? snapshot.earthquakes.sort((a, b) => b.mag - a.mag)[0]
        : { lat: center.lat, lon: center.lon, mag: 7.5, depth: 20 };
      result.params = {
        epicenterLat: nearestEQ.lat, epicenterLon: nearestEQ.lon,
        magnitude: nearestEQ.mag,
        depth: nearestEQ.depth,
        waveHeight: Math.min(30, Math.max(1, nearestEQ.mag * 2 - 10)),
        arrivalTimes: [15, 30, 45, 60, 90, 120],
      };
      break;
    }
  }

  return result;
}
