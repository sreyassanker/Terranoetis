import { sendEmail, isEmailConfigured } from './email';
import { logger } from './observability/logger';

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

function formatList(items: Array<{ title: string; desc?: string; severity?: string; time?: string; lat?: number; lon?: number }>, maxItems = 15): string {
  if (!items.length) return '<p style="color:#94a3b8">None detected.</p>';
  return '<ul>' + items.slice(0, maxItems).map(i =>
    `<li><strong>${i.title}</strong>${i.desc ? ' — ' + i.desc.slice(0, 120) : ''}${i.severity ? ' <span style="background:' + (i.severity === 'high' ? '#ef4444' : i.severity === 'medium' ? '#f59e0b' : '#22c55e') + ';color:white;padding:1px 6px;border-radius:3px;font-size:10px">' + i.severity + '</span>' : ''}${i.time ? ' <span style="color:#64748b;font-size:10px">' + new Date(i.time).toLocaleDateString() + '</span>' : ''}</li>`
  ).join('') + '</ul>';
}

export interface AssessmentResult {
  earthquakes: Array<{ title: string; desc: string; severity: string; time: string; lat: number; lon: number }>;
  storms: Array<{ title: string; desc: string; severity: string; time: string }>;
  wildfires: Array<{ title: string; desc: string; severity: string; time: string }>;
  floods: Array<{ title: string; desc: string; severity: string; time: string }>;
  weather: { temp: string; condition: string; humidity: string; wind: string };
  airQuality: { aqi: string; pm25: string; warning: string };
  gdacs: Array<{ title: string; desc: string; severity: string; time: string }>;
  marine: { waveHeight: string; swell: string; seaState: string };
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
    fetchJson(`${base}/api/gdacs/alerts`),
    fetchJson(`${base}/api/weather/marine?lat=${midLat}&lon=${midLon}`),
    fetchJson(`${base}/api/weather/nhc?lonMin=${lonMin}&lonMax=${lonMax}&latMin=${latMin}&latMax=${latMax}`),
    fetchJson(`${base}/api/firms?latMin=${latMin}&latMax=${latMax}&lonMin=${lonMin}&lonMax=${lonMax}&dayRange=3`),
    fetchJson(`${base}/api/lightning`),
  ]);
  const val = (i: number) => (settled[i].status === 'fulfilled' ? settled[i].value : null);
  const [earthquakesRaw, eonetRaw, weatherRaw, airQualityRaw, gdacsRaw, marineRaw, stormsRaw, firmsRaw, lightningRaw] = [
    val(0), val(1), val(2), val(3), val(4), val(5), val(6), val(7), val(8),
  ];

  // Parse earthquakes
  const earthquakes: AssessmentResult['earthquakes'] = [];
  if (earthquakesRaw && typeof earthquakesRaw === 'object' && 'features' in earthquakesRaw) {
    for (const f of (earthquakesRaw as any).features || []) {
      const p = f.properties || {};
      const c = f.geometry?.coordinates || [];
      earthquakes.push({
        title: `M${p.mag ?? '?'} — ${p.place || 'Unknown'}`,
        desc: `Depth ${c[2]?.toFixed(1) ?? '?'}km`,
        severity: (p.mag || 0) >= 6 ? 'high' : (p.mag || 0) >= 5 ? 'medium' : 'low',
        time: new Date(p.time || Date.now()).toISOString(),
        lat: c[1], lon: c[0],
      });
    }
  }

  // Parse EONET events (wildfires, floods, volcanoes, storms)
  const wildfires: AssessmentResult['wildfires'] = [];
  const floods: AssessmentResult['floods'] = [];
  const storms: AssessmentResult['storms'] = [];
  if (eonetRaw && typeof eonetRaw === 'object' && 'events' in eonetRaw) {
    for (const ev of (eonetRaw as any).events || []) {
      const cat = (ev.categories?.[0]?.title || '').toLowerCase();
      const item = {
        title: ev.title || 'Unknown',
        desc: ev.description || '',
        severity: 'medium' as const,
        time: ev.closed || ev.geometries?.[0]?.date || '',
      };
      if (cat.includes('fire') || cat.includes('wildfire')) wildfires.push(item);
      if (cat.includes('flood')) floods.push(item);
      if (cat.includes('storm')) storms.push(item);
    }
  }

  // Parse GDACS
  const gdacs: AssessmentResult['gdacs'] = [];
  if (gdacsRaw && typeof gdacsRaw === 'object' && 'alerts' in gdacsRaw) {
    for (const a of (gdacsRaw as any).alerts || []) {
      gdacs.push({
        title: a.title || a.eventtype || 'Alert',
        desc: a.severity || a.description || '',
        severity: (a.severity || '').toLowerCase().includes('orange') || (a.severity || '').toLowerCase().includes('red') ? 'high' : 'medium',
        time: a.alert_date || '',
      });
    }
  }

  // Parse weather
  const weather: AssessmentResult['weather'] = {
    temp: 'N/A', condition: 'N/A', humidity: 'N/A', wind: 'N/A',
  };
  if (weatherRaw && typeof weatherRaw === 'object' && 'current' in (weatherRaw as any)) {
    const c = (weatherRaw as any).current;
    weather.temp = c.temperature_2m ? `${c.temperature_2m}°C` : 'N/A';
    weather.condition = c.weather_code ? String(c.weather_code) : 'N/A';
    weather.humidity = c.relative_humidity_2m ? `${c.relative_humidity_2m}%` : 'N/A';
    weather.wind = c.wind_speed_10m ? `${c.wind_speed_10m} km/h` : 'N/A';
  }

  // Parse air quality
  const airQuality: AssessmentResult['airQuality'] = { aqi: 'N/A', pm25: 'N/A', warning: '' };
  if (airQualityRaw && typeof airQualityRaw === 'object') {
    const d = airQualityRaw as any;
    airQuality.aqi = d.aqi !== undefined ? String(d.aqi) : 'N/A';
    airQuality.pm25 = d.pm25 !== undefined ? `${d.pm25} µg/m³` : 'N/A';
    if (d.aqi && d.aqi > 100) airQuality.warning = '⚠️ Unhealthy air quality';
  }

  // Parse marine
  const marine: AssessmentResult['marine'] = { waveHeight: 'N/A', swell: 'N/A', seaState: 'N/A' };
  if (marineRaw && typeof marineRaw === 'object') {
    const d = marineRaw as any;
    marine.waveHeight = d.wave_height ? `${d.wave_height}m` : 'N/A';
    marine.swell = d.swell_direction ? `${d.swell_direction}°` : 'N/A';
    marine.seaState = d.sea_state || 'N/A';
  }

  // Generate summary
  const totalHazards = earthquakes.length + wildfires.length + floods.length + storms.length + gdacs.length;
  const highCount = [...earthquakes, ...wildfires, ...floods, ...storms, ...gdacs].filter(e => e.severity === 'high').length;
  const mediumCount = [...earthquakes, ...wildfires, ...floods, ...storms, ...gdacs].filter(e => e.severity === 'medium').length;
  const summary = `Assessment for ${regionName}: ${totalHazards} active hazard events detected (${highCount} high, ${mediumCount} medium). ${earthquakes.length} seismic events, ${wildfires.length} wildfires, ${floods.length} floods, ${storms.length} storms, ${gdacs.length} GDACS alerts. Current weather: ${weather.temp}, humidity ${weather.humidity}, wind ${weather.wind}. Air quality AQI: ${airQuality.aqi}. Marine: ${marine.waveHeight} waves.`;

  return { earthquakes, storms, wildfires, floods, weather, airQuality, gdacs, marine, summary };
}

export function buildReportHtml(regionName: string, result: AssessmentResult): string {
  const severityColor = (s: string) => s === 'high' ? '#ef4444' : s === 'medium' ? '#f59e0b' : '#22c55e';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: 'Inter', -apple-system, sans-serif; background:#0f172a; color:#e2e8f0; padding:20px; max-width:800px; margin:0 auto; }
  h1 { color:#60a5fa; border-bottom:2px solid #334155; padding-bottom:8px; }
  h2 { color:#a5b4fc; margin-top:24px; }
  .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; color:white; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0; }
  .card { background:#1e293b; border-radius:8px; padding:12px; border:1px solid #334155; }
  .card-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; }
  .card-value { font-size:18px; font-weight:700; margin-top:4px; }
  ul { padding-left:16px; }
  li { margin:6px 0; font-size:13px; line-height:1.5; }
  .footer { margin-top:32px; padding-top:16px; border-top:1px solid #334155; font-size:10px; color:#64748b; }
</style></head><body>
<h1>Disaster Assessment Report: ${regionName}</h1>
<p style="color:#94a3b8;margin-top:-8px">Generated by Earth Intelligence AI · ${new Date().toISOString().slice(0, 10)}</p>

<div class="grid">
  <div class="card"><div class="card-label">Active Hazards</div><div class="card-value">${result.earthquakes.length + result.wildfires.length + result.floods.length + result.storms.length + result.gdacs.length}</div></div>
  <div class="card"><div class="card-label">High Severity</div><div class="card-value" style="color:${severityColor('high')}">${result.earthquakes.filter(e=>e.severity==='high').length + result.wildfires.filter(e=>e.severity==='high').length + result.floods.filter(e=>e.severity==='high').length + result.storms.filter(e=>e.severity==='high').length + result.gdacs.filter(e=>e.severity==='high').length}</div></div>
  <div class="card"><div class="card-label">Temperature</div><div class="card-value">${result.weather.temp}</div></div>
  <div class="card"><div class="card-label">Wind</div><div class="card-value">${result.weather.wind}</div></div>
  <div class="card"><div class="card-label">Air Quality (AQI)</div><div class="card-value">${result.airQuality.aqi}${result.airQuality.warning ? ' — CAUTION' : ''}</div></div>
  <div class="card"><div class="card-label">Wave Height</div><div class="card-value">${result.marine.waveHeight}</div></div>
</div>

<h2>Seismic Activity</h2>
${formatList(result.earthquakes)}

<h2>Wildfires</h2>
${formatList(result.wildfires)}

<h2>Floods</h2>
${formatList(result.floods)}

<h2>Storms & Cyclones</h2>
${formatList(result.storms)}

<h2>GDACS Alerts</h2>
${formatList(result.gdacs)}

<h2>Marine Conditions</h2>
<p>Wave height: ${result.marine.waveHeight} · Swell direction: ${result.marine.swell} · Sea state: ${result.marine.seaState}</p>

<h2>Executive Summary</h2>
<p style="background:#1e293b;border-radius:8px;padding:12px;border:1px solid #334155;line-height:1.6">${result.summary}</p>

<div class="footer">
<p>Report generated by Earth Intelligence AI · Data sources: USGS, NASA EONET, Open-Meteo, GDACS, FIRMS, NHC</p>
<p>This is an automated assessment and may not capture all hazards. Always verify with local authorities.</p>
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

  const html = buildReportHtml(input.regionName, result);
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