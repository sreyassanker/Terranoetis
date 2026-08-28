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

export function buildReportHtml(regionName: string, lats: {latMin:number;latMax:number;lonMin:number;lonMax:number}, result: AssessmentResult): string {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const bboxStr = `${lats.latMin.toFixed(1)}°N – ${lats.latMax.toFixed(1)}°N, ${lats.lonMin.toFixed(1)}°E – ${lats.lonMax.toFixed(1)}°E`;
  const totalHaz = result.earthquakes.length + result.storms.length + result.floods.length + result.gdacs.length;
  const highHaz = [...result.earthquakes, ...result.storms, ...result.floods, ...result.gdacs].filter(e => e.severity === 'high').length;
  const alertLevel = highHaz > 0 ? 'HIGH' : totalHaz > 0 ? 'MODERATE' : 'LOW';
  const alertColor = highHaz > 0 ? '#dc2626' : totalHaz > 0 ? '#d97706' : '#16a34a';

  // Map tool IDs to legitimate hazard-impact vectors
  const hazardLabelMap: Record<string, string> = {
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

  // Only include legitimate hazard-impact vectors (skip non-physical tools)
  const impactVectors = result.fusion.topHazards
    .filter(h => {
      const id = h.label.replace(/ /g, '_');
      return hazardLabelMap[id] !== undefined && !['sentiment_analyze', 'gdelt', 'population', 'satellite_analyze'].includes(id);
    })
    .map(h => {
      const id = h.label.replace(/ /g, '_');
      return { label: hazardLabelMap[id] || h.label, probability: h.probability };
    });

  // Douglas sea-state description
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

  const execSummary = `Assessment for ${regionName} — ${bboxStr}. Alert level: ${alertLevel}. ${totalHaz > 0 ? totalHaz + ' active hazard feed(s) detected (' + highHaz + ' high).' : 'No active hazard feeds.'} Wind ${result.weather.wind}, wave height ${result.marine.waveHeight}. Sea state: ${seaState}. ${impactVectors.length > 0 ? 'Leading risk vectors: ' + impactVectors.slice(0, 3).map(v => v.label + ' (' + (v.probability * 100).toFixed(0) + '%)').join(', ') + '.' : ''}`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
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
</style></head><body>
<div class="header">
<h1>Disaster Assessment Report: ${regionName}</h1>
<div class="meta">AOI: ${bboxStr} &middot; ${now} UTC &middot; <span class="alert-badge" style="background:${alertColor}">${alertLevel} ALERT</span></div>
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
