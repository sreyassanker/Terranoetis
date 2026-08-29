import { sendEmail, isEmailConfigured } from './email';
import { logger } from './observability/logger';
import { runFusionPipeline } from './disasterFusion';

/**
 * Full disaster assessment for a region. Queries every hazard data source
 * (earthquakes, storms, floods, fires, AIS, weather, air quality, etc.)
 * and formats a comprehensive HTML report. Then emails it.
 */

const PORT = Number(process.env.PROXY_PORT ?? 3001);

interface AssessmentInput {
  regionName: string;
  latMin: number; latMax: number;
  lonMin: number; lonMax: number;
  emailTo: string;
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<unknown | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      logger.warn({ url: url.slice(0, 80), ct }, 'Assessment endpoint returned non-JSON — skipping');
      return null;
    }
    return resp.json();
  } catch (e) {
    logger.warn({ err: e, url: url.slice(0, 80) }, 'Assessment fetch failed');
    return null;
  }
}

/** Fetch raw text (used for XML feeds like GDACS RSS). */
async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    return resp.text();
  } catch (e) {
    logger.warn({ err: e, url: url.slice(0, 80) }, 'Assessment text fetch failed');
    return null;
  }
}

// In-memory reverse-geocode cache (1 hour TTL)
const geocodeCache = new Map<string, { name: string; ts: number }>();
const GEOCODE_CACHE_TTL = 3_600_000;

/** Country centroids for a local fallback when Nominatim is unreachable. */
const FALLBACK_COUNTRIES: Array<[number, number, string]> = [
  [20.6, 79.0, 'India'], [28.4, 84.1, 'Nepal'], [30.4, 69.3, 'Pakistan'],
  [23.7, 90.4, 'Bangladesh'], [24.9, 67.0, 'Pakistan'], [33.9, 67.7, 'Afghanistan'],
  [27.5, 90.4, 'Bhutan'], [21.9, 95.9, 'Myanmar'], [35.9, 104.2, 'China'],
  [39.9, 116.4, 'China'], [31.2, 121.5, 'China'], [35.7, 139.7, 'Japan'],
  [37.6, 127.0, 'South Korea'], [13.8, 100.5, 'Thailand'], [14.1, 108.3, 'Vietnam'],
  [3.1, 101.7, 'Malaysia'], [1.4, 103.8, 'Singapore'], [-6.2, 106.8, 'Indonesia'],
  [12.9, 121.8, 'Philippines'], [23.7, 120.9, 'Taiwan'], [42.0, 127.5, 'North Korea'],
  [33.9, 67.7, 'Afghanistan'], [32.4, 53.7, 'Iran'], [33.2, 43.7, 'Iraq'],
  [30.6, 36.2, 'Jordan'], [34.8, 39.0, 'Syria'], [33.9, 35.9, 'Lebanon'],
  [31.0, 34.9, 'Israel'], [24.7, 46.7, 'Saudi Arabia'], [15.6, 48.5, 'Yemen'],
  [23.4, 53.8, 'UAE'], [25.4, 51.2, 'Qatar'], [29.3, 47.6, 'Kuwait'],
  [26.0, 50.6, 'Bahrain'], [21.5, 55.9, 'Oman'], [24.0, 45.1, 'Saudi Arabia'],
  [9.1, 8.7, 'Nigeria'], [26.8, 30.8, 'Egypt'], [9.1, 40.5, 'Ethiopia'],
  [-0.02, 37.9, 'Kenya'], [7.9, -1.0, 'Ghana'], [31.8, -7.1, 'Morocco'],
  [33.9, 9.5, 'Tunisia'], [36.8, 10.2, 'Tunisia'], [28.0, 1.7, 'Algeria'],
  [26.3, 17.2, 'Libya'], [12.9, 30.2, 'Sudan'], [5.9, 12.3, 'Cameroon'],
  [7.5, -5.5, 'Côte d\'Ivoire'], [14.5, -14.5, 'Senegal'], [-4.0, 21.8, 'DR Congo'],
  [-13.1, 27.8, 'Zambia'], [-19.0, 29.2, 'Zimbabwe'], [-22.3, 24.7, 'Botswana'],
  [17.6, 8.1, 'Niger'], [12.4, -1.6, 'Burkina Faso'], [15.5, 18.7, 'Chad'],
  [6.6, 20.9, 'CAR'], [17.6, -4.0, 'Mali'], [9.0, 38.7, 'Ethiopia'],
  [39.8, -98.6, 'United States'], [56.1, -106.3, 'Canada'], [23.6, -102.6, 'Mexico'],
  [14.0, -86.5, 'Honduras'], [15.8, -90.2, 'Guatemala'], [11.0, -74.0, 'Colombia'],
  [-0.5, -78.0, 'Ecuador'], [-12.0, -77.0, 'Peru'], [-14.2, -51.9, 'Brazil'],
  [-34.6, -58.4, 'Argentina'], [-33.4, -70.7, 'Chile'], [-38.4, -63.6, 'Argentina'],
  [51.2, 10.4, 'Germany'], [55.4, -3.4, 'United Kingdom'], [46.2, 2.2, 'France'],
  [41.9, 12.6, 'Italy'], [40.5, -3.7, 'Spain'], [38.9, 35.2, 'Turkey'],
  [61.5, 105.3, 'Russia'], [48.4, 31.2, 'Ukraine'], [52.1, 5.3, 'Netherlands'],
  [50.5, 4.5, 'Belgium'], [47.5, 14.6, 'Austria'], [46.8, 8.2, 'Switzerland'],
  [60.1, 18.6, 'Sweden'], [60.5, 8.5, 'Norway'], [55.2, 23.9, 'Lithuania'],
  [56.9, 24.1, 'Latvia'], [58.6, 25.0, 'Estonia'], [39.1, 21.8, 'Greece'],
  [47.2, 19.5, 'Hungary'], [51.9, 19.1, 'Poland'], [49.8, 6.1, 'Luxembourg'],
  [35.9, 14.4, 'Malta'], [33.4, 35.5, 'Lebanon'], [41.2, 20.2, 'Albania'],
  [44.0, 21.0, 'Serbia'], [43.9, 17.7, 'Bosnia and Herzegovina'],
  [42.7, 25.5, 'Bulgaria'], [45.1, 15.2, 'Croatia'], [46.2, 14.9, 'Slovenia'],
  [48.7, 19.7, 'Slovakia'], [49.8, 15.5, 'Czech Republic'], [45.9, 25.0, 'Romania'],
  [47.4, 28.4, 'Moldova'], [53.7, 27.9, 'Belarus'],
  [-25.3, 133.8, 'Australia'], [-40.9, 174.9, 'New Zealand'],
  [-17.7, 178.1, 'Fiji'], [-6.3, 143.9, 'Papua New Guinea'],
  [15.9, 100.9, 'Thailand'], [4.2, 101.9, 'Malaysia'], [1.4, 103.8, 'Singapore'],
  [46.9, 103.8, 'Mongolia'], [48.0, 68.0, 'Kazakhstan'], [40.4, 64.6, 'Uzbekistan'],
  [38.9, 59.6, 'Turkmenistan'], [41.4, 64.6, 'Uzbekistan'], [38.9, 71.3, 'Tajikistan'],
  [41.2, 74.8, 'Kyrgyzstan'], [50.0, 10.0, 'Germany'],
];

/** Reverse-geocode a lat/lon into an accurate place name (OSM Nominatim, no key).
 *  Retries on rate-limit / transient failures, caches in memory, and falls back
 *  to the nearest country centroid when the API is unreachable. */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.ts < GEOCODE_CACHE_TTL) return cached.name;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=6&accept-language=en`,
        { headers: { 'User-Agent': 'EarthIntelligenceAI/1.0' }, signal: AbortSignal.timeout(10000) },
      );
      if (resp.status === 429) {
        // Rate-limited — wait and retry
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1200)); continue; }
        return null;
      }
      if (!resp.ok) return null;
      const d = await resp.json() as { address?: Record<string, string>; display_name?: string };
      const a = d.address || {};
      const name = a.state || a.province || a.region || a.county || a.country || a.name || d.display_name;
      if (name) {
        geocodeCache.set(key, { name: String(name), ts: Date.now() });
        return String(name);
      }
      return null;
    } catch (e) {
      logger.warn({ err: e, lat, lon, attempt }, 'Reverse geocode attempt failed');
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1200)); continue; }
    }
  }

  // Fallback: nearest country centroid
  let best = '';
  let bestDist = Infinity;
  const toRad = (d: number) => d * Math.PI / 180;
  for (const [clat, clon, name] of FALLBACK_COUNTRIES) {
    const dlat = toRad(lat - clat);
    const dlon = toRad(lon - clon);
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(clat)) * Math.sin(dlon / 2) ** 2;
    const dist = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  if (best && bestDist < 5000) {
    geocodeCache.set(key, { name: best, ts: Date.now() });
    return best;
  }
  return null;
}

export interface AssessmentResult {
  earthquakes: Array<{ title: string; desc: string; severity: string; time: string; lat: number; lon: number }>;
  storms: Array<{ title: string; desc: string; severity: string; time: string }>;
  wildfires: Array<{ title: string; desc: string; severity: string; time: string }>;
  floods: Array<{ title: string; desc: string; severity: string; time: string }>;
  weather: { temp: string; condition: string; humidity: string; wind: string; pressure: string };
  airQuality: { aqi: string; pm25: string; warning: string };
  gdacs: Array<{ title: string; desc: string; severity: string; time: string }>;
  marine: { waveHeight: string; waveHeightM: number | null; swell: string; swellM: number | null; seaState: string; beaufort: string };
  vessels: Array<{ title: string; desc: string; severity: string; time: string }>;
  /** Fused multi-hazard risk (same engine as the Tool Workbench) */
  fusion: {
    causalProbs: Record<string, number>;
    evidence: Record<string, number>;
    topHazards: Array<{ label: string; probability: number }>;
    fusedPoints: number;
    physics: Record<string, number>;
    summary: string;
  };
  summary: string;
}

export async function runDisasterAssessment(input: AssessmentInput): Promise<AssessmentResult | null> {
  const { regionName, latMin, latMax, lonMin, lonMax } = input;
  const midLat = (latMin + latMax) / 2;
  const midLon = (lonMin + lonMax) / 2;
  const base = `http://127.0.0.1:${PORT}`;

  logger.info({ regionName, latMin, latMax, lonMin, lonMax }, 'Starting disaster assessment');

  // Fetch all data sources in parallel. allSettled: one failing endpoint
  // (e.g. XML response, timeout) never aborts the whole report.
  // Wider time window (168h = 7 days) so recent activity is captured.
  const settled = await Promise.allSettled([
    fetchJson(`${base}/api/earthquakes?minLat=${latMin}&maxLat=${latMax}&minLon=${lonMin}&maxLon=${lonMax}&hours=168`),
    fetchJson(`${base}/api/eonet?latMin=${latMin}&latMax=${latMax}&lonMin=${lonMin}&lonMax=${lonMax}`),
    fetchJson(`${base}/api/weather/open-meteo?lat=${midLat}&lon=${midLon}`),
    fetchJson(`${base}/api/weather/air-quality?lat=${midLat}&lon=${midLon}`),
    fetchText(`${base}/api/gdacs/alerts`), // GDACS returns RSS/XML
    fetchJson(`${base}/api/weather/marine?lat=${midLat}&lon=${midLon}`),
    fetchJson(`${base}/api/weather/nhc?lonMin=${lonMin}&lonMax=${lonMax}&latMin=${latMin}&latMax=${latMax}`),
    fetchJson(`${base}/api/firms?latMin=${latMin}&latMax=${latMax}&lonMin=${lonMin}&lonMax=${lonMax}&dayRange=3`),
    fetchJson(`${base}/api/lightning`),
    fetchJson(`${base}/api/ais?latMin=${latMin}&latMax=${latMax}&lonMin=${lonMin}&lonMax=${lonMax}`),
  ]);
  const val = (i: number) => (settled[i].status === 'fulfilled' ? settled[i].value : null);
  const [earthquakesRaw, eonetRaw, weatherRaw, airQualityRaw, gdacsXml, marineRaw, firmsRaw, aisRaw] = [
    val(0), val(1), val(2), val(3), val(4), val(5), val(6), val(7),
  ];

  // Parse earthquakes
  const earthquakes: AssessmentResult['earthquakes'] = [];
  if (earthquakesRaw && typeof earthquakesRaw === 'object' && 'features' in earthquakesRaw) {
    for (const f of (earthquakesRaw as { features: Array<Record<string, unknown>> }).features || []) {
      const p = (f.properties || {}) as Record<string, unknown>;
      const geom = f.geometry as { coordinates?: number[] } | undefined;
      const c = geom?.coordinates || [];
      earthquakes.push({
        title: `M${p.mag ?? '?'} — ${p.place || 'Unknown'}`,
        desc: `Depth ${typeof c[2] === 'number' ? c[2].toFixed(1) : '?'}km`,
        severity: (Number(p.mag) || 0) >= 6 ? 'high' : (Number(p.mag) || 0) >= 5 ? 'medium' : 'low',
        time: new Date(Number(p.time) || Date.now()).toISOString(),
        lat: c[1], lon: c[0],
      });
    }
  }

  // Parse EONET events (wildfires, floods, volcanoes, storms)
  const wildfires: AssessmentResult['wildfires'] = [];
  const floods: AssessmentResult['floods'] = [];
  const storms: AssessmentResult['storms'] = [];
  if (eonetRaw && typeof eonetRaw === 'object' && 'events' in eonetRaw) {
    for (const ev of (eonetRaw as { events: Array<Record<string, unknown>> }).events || []) {
      const evCats = ev.categories as Array<{ title?: string }> | undefined;
      const evGeom = ev.geometries as Array<{ date?: string }> | undefined;
      const cat = ((evCats?.[0])?.title || '').toLowerCase();
      const item = {
        title: String(ev.title || 'Unknown'),
        desc: String(ev.description || ''),
        severity: 'medium' as const,
        time: String(ev.closed || evGeom?.[0]?.date || ''),
      };
      if (cat.includes('fire') || cat.includes('wildfire')) wildfires.push(item);
      if (cat.includes('flood')) floods.push(item);
      if (cat.includes('storm')) storms.push(item);
    }
  }

  // Parse FIRMS satellite fire detections into the wildfire list too
  if (firmsRaw && typeof firmsRaw === 'object') {
    const fr = firmsRaw as { features?: Array<Record<string, unknown>> };
    if (Array.isArray(fr.features)) {
      for (const f of fr.features.slice(0, 20)) {
        const p = (f.properties || {}) as Record<string, unknown>;
        wildfires.push({
          title: `FRP ${Number(p.frp)?.toFixed(1) ?? '?'} MW — ${String(p.acq_date || '')}`,
          desc: 'NASA FIRMS satellite detection',
          severity: Number(p.frp) > 100 ? 'high' : 'medium',
          time: String(p.acq_date || ''),
        });
      }
    }
  }

  // Parse GDACS (RSS XML — extracted via simple regex). Filtered to the region
  // bbox so global alerts don't inflate the count.
  const gdacs: AssessmentResult['gdacs'] = [];
  if (gdacsXml && typeof gdacsXml === 'string') {
    // Simple RSS item parser: extract <item> blocks
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(gdacsXml)) !== null) {
      const block = itemMatch[1];
      const title = (block.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
      const desc = (block.match(/<description>([^<]*)<\/description>/i) || [])[1] || '';
      const severity = (block.match(/<gdacs:severity>([^<]*)<\/gdacs:severity>/i) || [])[1] || '';
      const alertDate = (block.match(/<pubDate>([^<]*)<\/pubDate>/i) || [])[1] || '';
      // Geo coordinates for bbox filtering
      const gLat = parseFloat((block.match(/<geo:lat>([^<]*)<\/geo:lat>/i) || [])[1] || 'NaN');
      const gLon = parseFloat((block.match(/<geo:long>([^<]*)<\/geo:long>/i) || [])[1] || 'NaN');
      const inBbox = isFinite(gLat) && isFinite(gLon)
        && gLat >= latMin && gLat <= latMax && gLon >= lonMin && gLon <= lonMax;
      if (title && inBbox) {
        gdacs.push({
          title: title.slice(0, 80),
          desc: desc.slice(0, 200),
          severity: severity.toLowerCase().includes('orange') || severity.toLowerCase().includes('red') ? 'high' : 'medium',
          time: alertDate,
        });
      }
    }
  }

  // Parse weather
  const weather: AssessmentResult['weather'] = {
    temp: 'N/A', condition: 'N/A', humidity: 'N/A', wind: 'N/A', pressure: 'N/A',
  };
  if (weatherRaw && typeof weatherRaw === 'object') {
    const wr = weatherRaw as { current?: Record<string, unknown> };
    const c = wr.current || {};
    weather.temp = c.temperature_2m != null ? `${c.temperature_2m}°C` : 'N/A';
    weather.condition = c.weather_code != null ? String(c.weather_code) : 'N/A';
    weather.humidity = c.relative_humidity_2m != null ? `${c.relative_humidity_2m}%` : 'N/A';
    weather.wind = c.wind_speed_10m != null ? `${c.wind_speed_10m} km/h` : 'N/A';
    weather.pressure = c.pressure_msl != null ? `${c.pressure_msl} hPa` : 'N/A';
  }

  // Parse air quality
  const airQuality: AssessmentResult['airQuality'] = { aqi: 'N/A', pm25: 'N/A', warning: '' };
  if (airQualityRaw && typeof airQualityRaw === 'object') {
    const d = airQualityRaw as Record<string, unknown>;
    airQuality.aqi = d.aqi != null ? String(d.aqi) : 'N/A';
    airQuality.pm25 = d.pm25 != null ? `${d.pm25} µg/m³` : 'N/A';
    if (d.aqi != null && Number(d.aqi) > 100) airQuality.warning = 'Unhealthy air quality';
  }

  // Parse marine (Open-Meteo daily arrays) with proper Douglas sea-state
  // classification and Beaufort wind scale — no attribution text in fields.
  const marine: AssessmentResult['marine'] = {
    waveHeight: 'N/A', waveHeightM: null, swell: 'N/A', swellM: null,
    seaState: 'N/A', beaufort: 'N/A',
  };
  if (marineRaw && typeof marineRaw === 'object') {
    const mr = marineRaw as { daily?: Record<string, unknown> };
    const daily = mr.daily || {};
    const wv = daily.wave_height_max;
    const sw = daily.swell_wave_height_max;
    let wvM: number | null = null;
    let swM: number | null = null;
    if (Array.isArray(wv) && wv.length > 0 && typeof wv[0] === 'number') {
      wvM = wv[0];
      marine.waveHeight = `${wvM.toFixed(2)} m`;
      marine.waveHeightM = wvM;
    }
    if (Array.isArray(sw) && sw.length > 0 && typeof sw[0] === 'number') {
      swM = sw[0];
      marine.swell = `${swM.toFixed(2)} m`;
      marine.swellM = swM;
    }
    // Douglas Sea State classification (wave height, metres)
    if (wvM != null) {
      if (wvM < 0.1) marine.seaState = 'Calm (Douglas 0)';
      else if (wvM < 0.5) marine.seaState = 'Smooth (Douglas 1)';
      else if (wvM < 1.25) marine.seaState = 'Slight (Douglas 2)';
      else if (wvM < 2.5) marine.seaState = 'Moderate (Douglas 3)';
      else if (wvM < 4) marine.seaState = 'Rough (Douglas 4)';
      else if (wvM < 6) marine.seaState = 'Very Rough (Douglas 5)';
      else if (wvM < 9) marine.seaState = 'High (Douglas 6)';
      else if (wvM < 14) marine.seaState = 'Very High (Douglas 7)';
      else marine.seaState = 'Phenomenal (Douglas 8)';
    }
    // Beaufort wind force from the current wind speed (km/h)
    const windKph = parseFloat((weather.wind || '').replace(/[^\d.]/g, ''));
    if (isFinite(windKph)) {
      const kt = windKph / 1.852;
      if (kt < 1) marine.beaufort = 'Beaufort 0 (Calm)';
      else if (kt < 4) marine.beaufort = 'Beaufort 1 (Light air)';
      else if (kt < 7) marine.beaufort = 'Beaufort 2 (Light breeze)';
      else if (kt < 11) marine.beaufort = 'Beaufort 3 (Gentle breeze)';
      else if (kt < 17) marine.beaufort = 'Beaufort 4 (Moderate breeze)';
      else if (kt < 22) marine.beaufort = 'Beaufort 5 (Fresh breeze)';
      else if (kt < 28) marine.beaufort = 'Beaufort 6 (Strong breeze)';
      else if (kt < 34) marine.beaufort = 'Beaufort 7 (Near gale)';
      else if (kt < 41) marine.beaufort = 'Beaufort 8 (Gale)';
      else if (kt < 48) marine.beaufort = 'Beaufort 9 (Strong gale)';
      else if (kt < 56) marine.beaufort = 'Beaufort 10 (Storm)';
      else if (kt < 64) marine.beaufort = 'Beaufort 11 (Violent storm)';
      else marine.beaufort = 'Beaufort 12 (Hurricane)';
    }
  }

  // Parse AIS vessels (maritime traffic in the region)
  const vessels: AssessmentResult['vessels'] = [];
  if (aisRaw && typeof aisRaw === 'object' && 'vessels' in aisRaw) {
    for (const v of (aisRaw as { vessels: Array<Record<string, unknown>> }).vessels || []) {
      const speed = typeof v.speed === 'number' ? v.speed.toFixed(1) : null;
      const course = typeof v.course === 'number' ? v.course.toFixed(0) : null;
      vessels.push({
        title: String(v.name || v.mmsi || 'Vessel'),
        desc: `${String(v.type || 'ship')}${speed ? ' — ' + speed + ' kn' : ''}${course ? ' · ' + course + '°' : ''}`.trim().replace(/^— /, ''),
        severity: 'low',
        time: '',
      });
    }
  }

  // Generate summary
  const totalHazards = earthquakes.length + wildfires.length + floods.length + storms.length + gdacs.length;
  const highCount = [...earthquakes, ...wildfires, ...floods, ...storms, ...gdacs].filter(e => e.severity === 'high').length;
  const mediumCount = [...earthquakes, ...wildfires, ...floods, ...storms, ...gdacs].filter(e => e.severity === 'medium').length;
  const hazardStatus = totalHazards === 0 ? 'No active hazard events detected — region is currently calm.' : `${totalHazards} active hazard event(s) detected (${highCount} high, ${mediumCount} medium).`;

  // Fused multi-hazard risk — same engine as the Tool Workbench
  // (fetch chain → evidence → physics surrogates → causal BN → GIS fusion)
  let fusion: AssessmentResult['fusion'] = {
    causalProbs: {}, evidence: {}, topHazards: [], fusedPoints: 0, physics: {}, summary: 'Fusion unavailable.',
  };
  try {
    const fused = await runFusionPipeline({ latMin, latMax, lonMin, lonMax });
    const topHazards = Object.entries(fused.causalProbs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, probability]) => ({ label: label.replace(/_/g, ' '), probability: Number((probability).toFixed(2)) }));
    fusion = {
      causalProbs: fused.causalProbs,
      evidence: fused.cumulativeEvidence,
      topHazards,
      fusedPoints: fused.fusedPoints.length,
      physics: {
        liquefaction: fused.cumulativeEvidence.liquefaction ?? 0,
        dispersion: fused.cumulativeEvidence.dispersion ?? 0,
        wildfireSpread: fused.cumulativeEvidence.wildfireSpread ?? 0,
        floodDepth: fused.cumulativeEvidence.floodDepth ?? 0,
      },
      summary: fused.summary,
    };
  } catch (e) {
    logger.warn({ err: e }, 'Fusion pipeline failed — report without fusion');
  }

  const summary = `Assessment for ${regionName} (bbox ${latMin.toFixed(1)}-${latMax.toFixed(1)}N, ${lonMin.toFixed(1)}-${lonMax.toFixed(1)}E). ${hazardStatus} ${earthquakes.length} seismic event(s), ${wildfires.length} wildfire(s), ${floods.length} flood(s), ${storms.length} storm(s), ${gdacs.length} GDACS alert(s). ${vessels.length} vessel(s) tracked in region. Current weather: ${weather.temp}, humidity ${weather.humidity}, wind ${weather.wind}, pressure ${weather.pressure}. Air quality AQI: ${airQuality.aqi}. Marine: ${marine.waveHeight} waves. Fused risk: ${fusion.topHazards.length > 0 ? fusion.topHazards.slice(0, 3).map(h => `${h.label} ${(h.probability * 100).toFixed(0)}%`).join(', ') : 'no significant multi-hazard risk'}.`;

  return { earthquakes, storms, wildfires, floods, weather, airQuality, gdacs, marine, vessels, fusion, summary };
}

/* ── Shared report building blocks (both report builders) ── */

const REPORT_CSS = `
  body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; background:#fff; color:#1e293b; padding:24px; max-width:780px; margin:0 auto; line-height:1.5; font-size:13px; }
  h1 { font-size:20px; font-weight:700; margin:0 0 2px 0; color:#0f172a; }
  .header { border-bottom:1px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px; }
  .header .meta { font-size:11px; color:#64748b; margin:2px 0; }
  .alert-badge { display:inline-block; padding:2px 10px; border-radius:3px; font-size:11px; font-weight:700; color:#fff; }
  h2 { font-size:13px; font-weight:700; color:#1e293b; margin:16px 0 6px 0; padding-bottom:3px; border-bottom:1px solid #e2e8f0; text-transform:uppercase; letter-spacing:0.3px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:8px 0; }
  .card { background:#f8fafc; border-radius:4px; padding:8px 10px; border:1px solid #e2e8f0; }
  .card-label { font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:0.4px; font-weight:600; }
  .card-value { font-size:15px; font-weight:700; color:#0f172a; margin-top:1px; }
  table { width:100%; border-collapse:collapse; margin:6px 0; font-size:12px; }
  th { background:#f1f5f9; padding:5px 8px; text-align:left; font-weight:600; color:#475569; border-bottom:1px solid #e2e8f0; font-size:11px; text-transform:uppercase; letter-spacing:0.3px; }
  td { padding:5px 8px; border-bottom:1px solid #f1f5f9; }
  .callout { background:#f8fafc; border-radius:4px; padding:10px 12px; border:1px solid #e2e8f0; font-size:12px; color:#334155; margin:8px 0; }
  .r-h { color:#dc2626; font-weight:700; }
  .r-m { color:#d97706; font-weight:700; }
  .r-l { color:#16a34a; font-weight:700; }
  .footer { margin-top:24px; padding-top:10px; border-top:1px solid #e2e8f0; font-size:9px; color:#94a3b8; }
  .footer p { margin:1px 0; }
  @media (max-width:480px) { body { padding:12px; } .grid2 { grid-template-columns:1fr; } }
`;

/** IST (UTC+5:30) timestamp string — India Standard Time, no DST. */
function istNowStr(): string {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}

function aoiTagOf(lats: { latMin: number; latMax: number; lonMin: number; lonMax: number }): string {
  return `${lats.latMin.toFixed(1)}\u00b0N, ${lats.latMax.toFixed(1)}\u00b0N | ${lats.lonMin.toFixed(1)}\u00b0E, ${lats.lonMax.toFixed(1)}\u00b0E`;
}

/** Map tool IDs to legitimate hazard-impact vectors */
const HAZARD_LABEL_MAP: Record<string, string> = {
  floods: 'Storm Surge / Inundation',
  flood_forecast: 'Storm Surge / Inundation',
  storms: 'Tropical Cyclone Activity',
  marine: 'Coastal Exposure',
  earthquakes: 'Seismic Hazard',
  weather_forecast: 'Extreme Convective Activity',
  weather_ensemble: 'Severe Weather Potential',
  gfs_forecast: 'Severe Weather Potential',
  seasonal_forecast: 'Seasonal Climate Risk',
  climate_historical: 'Climate Anomaly Baseline',
  air_quality: 'Atmospheric Quality',
  firms_fires: 'Fire / Thermal Anomaly',
  wildfires: 'Fire / Thermal Anomaly',
  seismic_events: 'Seismic Hazard',
  water_resources: 'Hydrological Stress',
  disaster_declarations: 'Regulatory Hazard Status',
  agriculture: 'Agricultural Stress',
  infrastructure: 'Infrastructure Exposure',
  satellite_analyze: 'Remote Sensing Anomaly',
  sentiment_analyze: 'Social Sentiment Indicator',
  gdelt: 'Geo-Event Indicator',
  population: 'Population Exposure',
};

/** Context tools — informational, never hazard-severity drivers. */
const CONTEXT_TOOLS = new Set(['population', 'sentiment_analyze', 'gdelt', 'satellite_analyze', 'infrastructure', 'predict', 'radar_fetch']);

/** Bayesian impact vectors from causal probs — only legitimate physical
 *  hazard vectors, strongest first (same mapping as the legacy report). */
function impactVectorsFromProbs(causalProbs: Record<string, number>): Array<{ label: string; probability: number }> {
  return Object.entries(causalProbs)
    .filter(([id, p]) => HAZARD_LABEL_MAP[id] !== undefined && !CONTEXT_TOOLS.has(id)
      && id !== '_composite' && id !== '_confidence' && typeof p === 'number' && p > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, probability]) => ({ label: HAZARD_LABEL_MAP[id], probability }));
}

/** Beaufort wind force from wind speed in km/h. */
function beaufortScale(windKph: number): string {
  const kt = windKph / 1.852;
  if (kt < 1) return 'Beaufort 0 (Calm)';
  if (kt < 4) return 'Beaufort 1 (Light air)';
  if (kt < 7) return 'Beaufort 2 (Light breeze)';
  if (kt < 11) return 'Beaufort 3 (Gentle breeze)';
  if (kt < 17) return 'Beaufort 4 (Moderate breeze)';
  if (kt < 22) return 'Beaufort 5 (Fresh breeze)';
  if (kt < 28) return 'Beaufort 6 (Strong breeze)';
  if (kt < 34) return 'Beaufort 7 (Near gale)';
  if (kt < 41) return 'Beaufort 8 (Gale)';
  if (kt < 48) return 'Beaufort 9 (Strong gale)';
  if (kt < 56) return 'Beaufort 10 (Storm)';
  if (kt < 64) return 'Beaufort 11 (Violent storm)';
  return 'Beaufort 12 (Hurricane)';
}

/** Douglas Sea State classification from significant wave height (metres). */
function douglasSeaState(waveM: number): string {
  if (waveM < 0.1) return 'Calm (Douglas 0)';
  if (waveM < 0.5) return 'Smooth (Douglas 1)';
  if (waveM < 1.25) return 'Slight (Douglas 2)';
  if (waveM < 2.5) return 'Moderate (Douglas 3)';
  if (waveM < 4) return 'Rough (Douglas 4)';
  if (waveM < 6) return 'Very Rough (Douglas 5)';
  if (waveM < 9) return 'High (Douglas 6)';
  if (waveM < 14) return 'Very High (Douglas 7)';
  return 'Phenomenal (Douglas 8)';
}

export function buildReportHtml(regionName: string, lats: {latMin:number;latMax:number;lonMin:number;lonMax:number}, result: AssessmentResult): string {
  const aoiTag = aoiTagOf(lats);
  const totalHaz = result.earthquakes.length + result.storms.length + result.floods.length + result.gdacs.length;
  const highHaz = [...result.earthquakes, ...result.storms, ...result.floods, ...result.gdacs].filter(e => e.severity === 'high').length;
  const alertLevel = highHaz > 0 ? 'HIGH' : totalHaz > 0 ? 'MODERATE' : 'LOW';
  const alertColor = highHaz > 0 ? '#dc2626' : totalHaz > 0 ? '#d97706' : '#16a34a';
  const impactVectors = impactVectorsFromProbs(result.fusion.causalProbs);
  const seaState = result.marine.seaState;
  const beaufort = result.marine.beaufort;

  // Active hazard feeds — only relevant categories
  const activeFeeds: Array<{ category: string; status: string; count: number; severity: string }> = [];
  if (result.earthquakes.length > 0) activeFeeds.push({ category: 'Seismic Activity', status: 'OBSERVED', count: result.earthquakes.length, severity: result.earthquakes.some(e => e.severity === 'high') ? 'HIGH' : 'MODERATE' });
  if (result.storms.length > 0) activeFeeds.push({ category: 'Tropical Cyclone', status: 'WATCH', count: result.storms.length, severity: 'HIGH' });
  if (result.floods.length > 0) activeFeeds.push({ category: 'Flood / Inundation', status: 'OBSERVED', count: result.floods.length, severity: result.floods.some(e => e.severity === 'high') ? 'HIGH' : 'MODERATE' });
  if (result.gdacs.length > 0) activeFeeds.push({ category: 'GDACS Alert', status: 'ACTIVE', count: result.gdacs.length, severity: result.gdacs.some(e => e.severity === 'high') ? 'HIGH' : 'MODERATE' });
  if (result.marine.waveHeightM != null && result.marine.waveHeightM > 4) activeFeeds.push({ category: 'Marine Warning', status: 'ACTIVE', count: 1, severity: 'HIGH' });
  else if (result.marine.waveHeightM != null && result.marine.waveHeightM > 2.5) activeFeeds.push({ category: 'Marine Warning', status: 'ADVISORY', count: 1, severity: 'MODERATE' });

  const execSummary = `Assessment for ${regionName} — AOI ${aoiTag}. Alert level: ${alertLevel}. ${totalHaz > 0 ? totalHaz + ' active hazard feed(s) detected (' + highHaz + ' high).' : 'No active hazard feeds.'} Wind ${result.weather.wind}, wave height ${result.marine.waveHeight}. Sea state: ${seaState}. ${impactVectors.length > 0 ? 'Leading risk vectors: ' + impactVectors.slice(0, 3).map(v => v.label + ' (' + (v.probability * 100).toFixed(0) + '%)').join(', ') + '.' : ''}`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${REPORT_CSS}</style></head><body>
<div class="header">
<h1>Disaster Assessment Report: ${regionName}</h1>
<div class="meta">AOI: <small>${aoiTag}</small> &middot; ${istNowStr()} IST &middot; <span class="alert-badge" style="background:${alertColor}">${alertLevel} ALERT</span></div>
</div>

<h2>Executive Summary</h2>
<div class="callout">${execSummary}</div>

<h2>Environmental &amp; Oceanographic Parameters</h2>
<div class="grid2">
  <div class="card"><div class="card-label">Sea Surface Temperature</div><div class="card-value">${result.weather.temp}</div></div>
  <div class="card"><div class="card-label">Wind (10 m)</div><div class="card-value">${result.weather.wind} &middot; ${beaufort}</div></div>
  <div class="card"><div class="card-label">Significant Wave Height</div><div class="card-value">${result.marine.waveHeight}</div></div>
  <div class="card"><div class="card-label">Swell Height</div><div class="card-value">${result.marine.swell}</div></div>
  <div class="card"><div class="card-label">Sea State (Douglas)</div><div class="card-value">${seaState}</div></div>
  <div class="card"><div class="card-label">Barometric Pressure</div><div class="card-value">${result.weather.pressure}</div></div>
</div>

<h2>Active Hazard Feeds</h2>
${activeFeeds.length > 0
  ? '<table><tr><th>Category</th><th>Status</th><th>Count</th><th>Severity</th></tr>' +
    activeFeeds.map(f => `<tr><td>${f.category}</td><td>${f.status}</td><td>${f.count}</td><td class="${f.severity === 'HIGH' ? 'r-h' : 'r-m'}">${f.severity}</td></tr>`).join('') +
    '</table>'
  : '<div class="callout">No active hazard feeds at this time.</div>'}

${impactVectors.length > 0
  ? `<h2>Bayesian Hazard Impact Matrix</h2>
<table><tr><th>Risk Vector</th><th>Probability</th></tr>` +
    impactVectors.map(v => `<tr><td>${v.label}</td><td class="${v.probability > 0.6 ? 'r-h' : v.probability > 0.3 ? 'r-m' : 'r-l'}">${(v.probability * 100).toFixed(0)}%</td></tr>`).join('') +
    '</table>'
  : ''}

<div class="footer">
<p>Data sources: USGS, NASA EONET, Open-Meteo, GDACS, FIRMS, NHC &middot; Fused risk via causal Bayesian network (Noisy-OR propagation across 22 hazard nodes)</p>
<p>This is an automated assessment generated by Earth Intelligence AI. Verify with local authorities. Not for operational decision-making without validation.</p>
</div>
</body></html>`;
}

/* ═════════════════════════════════════════════════════════════════
   CHAIN-NATIVE REPORT — built from the Tool Workbench's ACTUAL step
   results (what the panel shows), not a server-side re-fetch.
   ═════════════════════════════════════════════════════════════════ */

export interface ChainStepResult {
  tool: string;
  status: 'success' | 'synthetic' | 'error';
  summary: string;
  metrics: Array<{ label: string; value: string }>;
  latencyMs: number;
  timestamp: string;
}

const TOOL_SOURCE: Record<string, string> = {
  earthquakes: 'USGS', seismic_events: 'USGS', water_resources: 'USGS NWIS',
  weather_forecast: 'Open-Meteo', weather_ensemble: 'Open-Meteo Ensemble',
  seasonal_forecast: 'Open-Meteo Seasonal', climate_historical: 'Open-Meteo Archive',
  air_quality: 'Open-Meteo CAMS', marine: 'Open-Meteo Marine', flood_forecast: 'GloFAS',
  floods: 'NASA EONET', wildfires: 'NASA EONET', storms: 'NOAA NHC',
  firms_fires: 'NASA FIRMS', gfs_forecast: 'NOAA GFS', agriculture: 'NASA POWER',
  gdelt: 'GDELT Project', sentiment_analyze: 'Social Feeds', population: 'WorldPop',
  infrastructure: 'OpenStreetMap', disaster_declarations: 'FEMA',
  satellite_analyze: 'NASA GIBS', space_weather: 'NOAA SWPC', radar_fetch: 'NWS',
  predict: 'Chain Evidence',
};

const COUNT_LABELS = ['Events', 'Hotspots', 'Storms', 'Wildfires', 'Floods', 'Articles', 'Declarations', 'Sites', 'Features', 'Buildings', 'Alerts', 'Population', 'Volume', 'Frames', 'Predictions'];

function toolLabel(tool: string): string {
  return tool.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function metricOf(steps: ChainStepResult[], tools: string[], label: string): string | null {
  for (const tool of tools) {
    const step = steps.find(s => s.tool === tool);
    const m = step?.metrics.find(x => x.label === label);
    if (m && m.value !== 'N/A' && m.value !== '') return m.value;
  }
  return null;
}

function numMetric(steps: ChainStepResult[], tools: string[], label: string): number | null {
  const v = metricOf(steps, tools, label);
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function stepCount(step: ChainStepResult): number | null {
  for (const lbl of COUNT_LABELS) {
    const m = step.metrics.find(x => x.label === lbl);
    if (m) {
      const v = parseFloat(String(m.value).replace(/,/g, ''));
      if (Number.isFinite(v) && v >= 0) return v;
    }
  }
  return null;
}

function formatCount(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

function stepSeverity(step: ChainStepResult, count: number | null, prob: number): 'HIGH' | 'MODERATE' | 'LOW' {
  const n = (label: string) => numMetric([step], [step.tool], label);
  let high = false;
  let moderate = false;
  switch (step.tool) {
    case 'earthquakes': case 'seismic_events': {
      const mag = n('Max Mag');
      high = mag != null && mag >= 6;
      moderate = count != null && count > 0;
      break;
    }
    case 'storms': {
      const wind = n('Max Wind');
      high = wind != null && wind >= 64;
      moderate = count != null && count > 0;
      break;
    }
    case 'marine': {
      const wave = n('Max Wave');
      high = wave != null && wave > 4;
      moderate = wave != null && wave > 2.5;
      break;
    }
    case 'flood_forecast': {
      const p = n('Flood Prob');
      high = p != null && p >= 50;
      moderate = p != null && p >= 20;
      break;
    }
    case 'air_quality': {
      const aqi = n('US AQI');
      high = aqi != null && aqi >= 150;
      moderate = aqi != null && aqi >= 100;
      break;
    }
    case 'firms_fires': {
      high = count != null && count >= 50;
      moderate = count != null && count >= 10;
      break;
    }
    case 'floods': case 'wildfires': case 'space_weather':
      moderate = count != null && count > 0;
      break;
    default:
      moderate = !CONTEXT_TOOLS.has(step.tool) && count != null && count > 0;
  }
  // Causal-network agreement can escalate, never de-flag, a data signal.
  if (prob >= 0.5) high = true;
  return high ? 'HIGH' : moderate ? 'MODERATE' : 'LOW';
}

/** Build the report HTML from the workbench chain's own step results —
 *  exactly what the user sees in the panel, no server-side re-fetch. */
export function buildChainReportHtml(
  regionName: string,
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number },
  steps: ChainStepResult[],
  causalProbs: Record<string, number>,
): string {
  const aoiTag = aoiTagOf(bbox);
  const chainTools = new Set(steps.map(s => s.tool));

  /* Hazard feeds — one honest row per chain step, labelled with the SAME
   * tool name the panel shows (e.g. "Earthquakes", "Seismic Events"). */
  const feedRows = steps.map(step => {
    const count = stepCount(step);
    const prob = typeof causalProbs[step.tool] === 'number' ? causalProbs[step.tool] : 0;
    const status = step.status === 'error' ? 'FAILED' : count != null && count > 0 ? 'OBSERVED' : count != null ? 'NO DATA' : 'REPORTED';
    return {
      tool: step.tool,
      category: toolLabel(step.tool),
      status,
      count: count != null ? formatCount(count) : '\u2014',
      severity: stepSeverity(step, count, prob),
    };
  });
  const observedCount = feedRows.filter(r => r.status === 'OBSERVED' || r.status === 'REPORTED').length;
  const highCount = feedRows.filter(r => r.severity === 'HIGH').length;
  const alertLevel = highCount > 0 ? 'HIGH' : observedCount > 0 ? 'MODERATE' : 'LOW';
  const alertColor = highCount > 0 ? '#dc2626' : observedCount > 0 ? '#d97706' : '#16a34a';

  /* Fused risk assessment — IDENTICAL to the panel's 📊 Fused Risk
   * Assessment: every chain node, sorted desc, top 9, same labels. */
  const fusedRisk = Object.entries(causalProbs)
    .filter(([k]) => k !== '_composite' && k !== '_confidence' && chainTools.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 9)
    .map(([id, prob]) => ({ label: toolLabel(id), probability: prob }));
  const chainNodeCount = Object.keys(causalProbs).filter(k => chainTools.has(k) && !k.startsWith('_')).length;

  /* Environmental parameters — from the chain's own metric values */
  const temp = metricOf(steps, ['weather_forecast', 'weather_ensemble', 'gfs_forecast'], 'Temperature');
  const wind = metricOf(steps, ['weather_forecast', 'weather_ensemble', 'gfs_forecast', 'climate_historical'], 'Wind');
  const humidity = metricOf(steps, ['weather_forecast'], 'Humidity');
  const pressure = metricOf(steps, ['weather_forecast'], 'Pressure');
  const wave = metricOf(steps, ['marine'], 'Max Wave');
  const swell = metricOf(steps, ['marine'], 'Max Swell');
  const aqi = metricOf(steps, ['air_quality'], 'US AQI');
  const windNum = numMetric(steps, ['weather_forecast', 'weather_ensemble', 'gfs_forecast'], 'Wind');
  const waveNum = numMetric(steps, ['marine'], 'Max Wave');

  const cond = metricOf(steps, ['weather_forecast'], 'Conditions');
  const execSummary = `Assessment for ${regionName} — AOI ${aoiTag}. Alert level: ${alertLevel}. ${observedCount} of ${steps.length} chain feed(s) reported data (${highCount} high-severity). `
    + `${temp ? `Temperature ${temp}` : 'Temperature N/A'}${cond ? ` (${cond})` : ''}, wind ${wind ?? 'N/A'}, wave height ${wave ?? 'N/A'}. `
    + `${fusedRisk.length > 0 ? 'Leading risk vectors: ' + fusedRisk.slice(0, 3).map(v => `${v.label} (${(v.probability * 100).toFixed(0)}%)`).join(', ') + '.' : 'No significant risk vectors detected.'}`;

  const sources = [...new Set(steps.map(s => TOOL_SOURCE[s.tool]).filter(Boolean))].join(', ') || 'chain tools';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${REPORT_CSS}</style></head><body>
<div class="header">
<h1>Disaster Assessment Report: ${regionName}</h1>
<div class="meta">AOI: <small>${aoiTag}</small> &middot; ${istNowStr()} IST &middot; <span class="alert-badge" style="background:${alertColor}">${alertLevel} ALERT</span></div>
</div>

<h2>Executive Summary</h2>
<div class="callout">${execSummary}</div>

<h2>Environmental Parameters</h2>
<div class="grid2">
  <div class="card"><div class="card-label">Temperature (2 m)</div><div class="card-value">${temp ?? 'N/A'}</div></div>
  <div class="card"><div class="card-label">Wind (10 m)</div><div class="card-value">${wind ?? 'N/A'}${windNum != null ? ' &middot; ' + beaufortScale(windNum) : ''}</div></div>
  <div class="card"><div class="card-label">Humidity</div><div class="card-value">${humidity ?? 'N/A'}</div></div>
  <div class="card"><div class="card-label">Barometric Pressure</div><div class="card-value">${pressure ?? 'N/A'}</div></div>
  <div class="card"><div class="card-label">Significant Wave Height</div><div class="card-value">${wave ?? 'N/A'}</div></div>
  <div class="card"><div class="card-label">Swell Height</div><div class="card-value">${swell ?? 'N/A'}</div></div>
  <div class="card"><div class="card-label">Sea State (Douglas)</div><div class="card-value">${waveNum != null ? douglasSeaState(waveNum) : 'N/A'}</div></div>
  <div class="card"><div class="card-label">Air Quality (US AQI)</div><div class="card-value">${aqi ?? 'N/A'}</div></div>
</div>

<h2>Chain Hazard Feeds</h2>
${feedRows.length > 0
  ? '<table><tr><th>Tool</th><th>Status</th><th>Count</th><th>Severity</th></tr>' +
    feedRows.map(f => `<tr><td>${f.category}</td><td>${f.status}</td><td>${f.count}</td><td class="${f.severity === 'HIGH' ? 'r-h' : f.severity === 'MODERATE' ? 'r-m' : 'r-l'}">${f.severity}</td></tr>`).join('') +
    '</table>'
  : '<div class="callout">Chain has no executed steps.</div>'}

${fusedRisk.length > 0
  ? `<h2>Fused Risk Assessment</h2>
<div class="callout" style="font-size:11px;color:#64748b;margin-bottom:6px;">Topological-order Noisy-OR propagation across ${chainNodeCount} chain nodes</div>
<table><tr><th>Risk Vector</th><th>Probability</th></tr>` +
    fusedRisk.map(v => `<tr><td>${v.label}</td><td class="${v.probability > 0.6 ? 'r-h' : v.probability > 0.3 ? 'r-m' : 'r-l'}">${(v.probability * 100).toFixed(0)}%</td></tr>`).join('') +
    '</table>'
  : ''}

<div class="footer">
<p>Data sources: ${sources} &middot; Fused risk via causal Bayesian network (Noisy-OR propagation across ${chainNodeCount} chain nodes)</p>
<p>This is an automated assessment generated by Earth Intelligence AI from the executed tool chain. Verify with local authorities. Not for operational decision-making without validation.</p>
</div>
</body></html>`;
}


export async function assessAndEmail(input: AssessmentInput): Promise<{ ok: boolean; summary: string; error?: string }> {
  if (!isEmailConfigured()) {
    return { ok: false, summary: '', error: 'Email not configured. Add GMAIL_SMTP_USER and GMAIL_SMTP_PASS to .env' };
  }

  const result = await runDisasterAssessment(input);
  if (!result) {
    return { ok: false, summary: '', error: 'Assessment data fetch failed' };
  }

  const html = buildReportHtml(input.regionName, {
    latMin: input.latMin, latMax: input.latMax, lonMin: input.lonMin, lonMax: input.lonMax,
  }, result);
  const emailResult = await sendEmail({
    to: input.emailTo,
    subject: `Disaster Assessment Report: ${input.regionName} — ${new Date().toISOString().slice(0, 10)}`,
    html,
  });

  if (!emailResult.ok) {
    return { ok: false, summary: result.summary, error: emailResult.error };
  }

  return { ok: true, summary: result.summary };
}
