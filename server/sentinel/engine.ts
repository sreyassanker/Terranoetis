/**
 * SentinelEngine — Background Monitoring & Alert Generator
 *
 * Continuously polls configured data layers within each watch zone,
 * compares current state to stored baselines, and generates alerts
 * when significant changes are detected.
 *
 * Uses the existing tool API endpoints (earthquakes, weather, fires, etc.)
 * to fetch real-time data for each zone.
 */

import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { randomUUID } from 'crypto';
import { pubsub } from '../pubsub';

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

interface WatchZone {
  id: string;
  name: string;
  bbox_min_lat: number;
  bbox_max_lat: number;
  bbox_min_lon: number;
  bbox_max_lon: number;
  layers: string[];
  thresholds: Record<string, number>;
  poll_interval_ms: number;
  enabled: boolean;
}

interface Alert {
  alert_id: string;
  zone_id: string;
  zone_name: string;
  layer_id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  body: string;
  significance: number;
  lat?: number;
  lon?: number;
}

/* ═══════════════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════════════ */

/** Default thresholds per hazard type (overridable per zone) */
const DEFAULT_THRESHOLDS: Record<string, number> = {
  earthquakes: 4.0,       // Magnitude threshold
  wildfires: 50,          // FIRMS hotspot count
  floods: 3,              // Flood event count
  storms: 50,             // Wind speed (knots)
  air_quality: 100,       // AQI threshold
  fires_firms: 10,        // Fire radiative power
};

/** Layer-to-API endpoint mapping */
const LAYER_API_MAP: Record<string, (zone: WatchZone) => { path: string; method?: string; body?: any }> = {
  earthquakes: (z) => ({
    path: `/api/earthquakes?minLat=${z.bbox_min_lat}&maxLat=${z.bbox_max_lat}&minLon=${z.bbox_min_lon}&maxLon=${z.bbox_max_lon}&minMag=2`,
  }),
  weather: (z) => ({
    path: `/api/weather/open-meteo?lat=${(z.bbox_min_lat + z.bbox_max_lat) / 2}&lon=${(z.bbox_min_lon + z.bbox_max_lon) / 2}`,
  }),
  wildfires: (z) => ({
    path: `/api/eonet?category=wildfires&status=open&limit=20&bbox=${z.bbox_min_lon},${z.bbox_min_lat},${z.bbox_max_lon},${z.bbox_max_lat}`,
  }),
  floods: (z) => ({
    path: `/api/eonet?category=floods&status=open&limit=20&bbox=${z.bbox_min_lon},${z.bbox_min_lat},${z.bbox_max_lon},${z.bbox_max_lat}`,
  }),
  firms_fires: (z) => ({
    path: `/api/firms?latMin=${z.bbox_min_lat}&latMax=${z.bbox_max_lat}&lonMin=${z.bbox_min_lon}&lonMax=${z.bbox_max_lon}`,
  }),
  air_quality: (z) => ({
    path: `/api/weather/air-quality?lat=${(z.bbox_min_lat + z.bbox_max_lat) / 2}&lon=${(z.bbox_min_lon + z.bbox_max_lon) / 2}`,
  }),
  storms: (z) => ({
    path: `/api/weather/nhc?latMin=${z.bbox_min_lat}&latMax=${z.bbox_max_lat}&lonMin=${z.bbox_min_lon}&lonMax=${z.bbox_max_lon}`,
  }),
};

/* ═══════════════════════════════════════════════════════════════════
   ENGINE STATE
   ═══════════════════════════════════════════════════════════════════ */

let pollTimers: ReturnType<typeof setInterval>[] = [];
let running = false;

/* ═══════════════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════════════ */

let zoneRefreshTimer: ReturnType<typeof setInterval> | null = null;

export function startSentinelEngine(): void {
  if (running) return;
  running = true;
  logger.info('[Sentinel] Engine started — polling enabled zones');

  // Start polling for each enabled zone
  refreshPollers();

  // Re-discover zones every 60s so zones created after startup get polled
  zoneRefreshTimer = setInterval(() => {
    if (running) {
      try {
        refreshPollers();
      } catch (err) {
        logger.error({ err: String(err) }, '[Sentinel] Zone refresh failed');
      }
    }
  }, 60_000);
}

export function stopSentinelEngine(): void {
  running = false;
  for (const t of pollTimers) clearInterval(t);
  pollTimers = [];
  if (zoneRefreshTimer) { clearInterval(zoneRefreshTimer); zoneRefreshTimer = null; }
  logger.info('[Sentinel] Engine stopped');
}

export function refreshPollers(): void {
  if (!running) return;

  // Clear existing timers
  for (const t of pollTimers) clearInterval(t);
  pollTimers = [];

  try {
    const db = getDb();
    const zones = db.prepare('SELECT * FROM watch_zones WHERE enabled = 1').all() as any[];

    for (const zone of zones) {
      const parsed: WatchZone = {
        ...zone,
        layers: JSON.parse(zone.layers || '[]'),
        thresholds: { ...DEFAULT_THRESHOLDS, ...JSON.parse(zone.thresholds || '{}') },
        enabled: Boolean(zone.enabled),
      };

      // Poll each zone at its configured interval
      const timer = setInterval(() => {
        pollZone(parsed).catch(err => {
          logger.error({ err, zoneId: parsed.id }, '[Sentinel] Poll error');
        });
      }, parsed.poll_interval_ms);

      pollTimers.push(timer);

      // Initial poll after 30 seconds
      setTimeout(() => {
        pollZone(parsed).catch(err => {
          logger.error({ err, zoneId: parsed.id }, '[Sentinel] Initial poll error');
        });
      }, 30000 + Math.random() * 10000);
    }

    logger.info({ count: zones.length }, '[Sentinel] Started pollers for zones');
  } catch (err) {
    logger.error({ err }, '[Sentinel] Failed to load zones');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   POLLING LOGIC
   ═══════════════════════════════════════════════════════════════════ */

async function pollZone(zone: WatchZone): Promise<void> {
  const db = getDb();
  const alerts: Alert[] = [];

  for (const layer of zone.layers) {
    const apiEntry = LAYER_API_MAP[layer];
    if (!apiEntry) continue;

    try {
      const { path } = apiEntry(zone);
      // Use internal fetch (localhost)
      const resp = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3001}${path}`, {
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) continue;
      const data = await resp.json() as Record<string, unknown>;

      // Compare to baseline
      const baseline = getBaseline(zone.id, layer);
      const significance = evaluateSignificance(layer, data, baseline, zone.thresholds);

      if (significance > 0.3) {
        // Generate alert
        const alert = generateAlert(zone, layer, data, significance);
        alerts.push(alert);

        // Store alert
        storeAlert(db, alert);
      }

      // Update baseline
      updateBaseline(zone.id, layer, data);
    } catch {
      // Skip failed polls silently
    }
  }

  // If any alerts were generated, update risk snapshot and notify via WebSocket
  if (alerts.length > 0) {
    updateRiskSnapshot(db, zone, alerts);
    pushAlerts(alerts);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   BASELINE MANAGEMENT
   ═══════════════════════════════════════════════════════════════════ */

function getBaseline(zoneId: string, layerId: string): Record<string, unknown> {
  const db = getDb();
  const row = db.prepare('SELECT baseline_value FROM sentinel_baselines WHERE zone_id = ? AND layer_id = ?')
    .get(zoneId, layerId) as any;
  return row ? JSON.parse(row.baseline_value || '{}') : {};
}

function updateBaseline(zoneId: string, layerId: string, data: Record<string, unknown>): void {
  const db = getDb();
  const summary = summarizeData(layerId, data);
  db.prepare(`
    INSERT INTO sentinel_baselines (zone_id, layer_id, baseline_value, sample_count, last_checked_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(zone_id, layer_id) DO UPDATE SET
      baseline_value = excluded.baseline_value,
      sample_count = sample_count + 1,
      last_checked_at = excluded.last_checked_at,
      updated_at = excluded.updated_at
  `).run(zoneId, layerId, JSON.stringify(summary), new Date().toISOString(), new Date().toISOString());
}

/** Extract a numeric summary from API response for comparison */
function summarizeData(layerId: string, data: Record<string, unknown>): Record<string, unknown> {
  switch (layerId) {
    case 'earthquakes': {
      const features = (data.features as any[]) ?? [];
      return {
        count: features.length,
        maxMagnitude: features.length > 0 ? Math.max(...features.map((f: any) => f.properties?.mag ?? 0)) : 0,
        avgMagnitude: features.length > 0
          ? features.reduce((s: number, f: any) => s + (f.properties?.mag ?? 0), 0) / features.length
          : 0,
      };
    }
    case 'firms_fires': {
      const hotspots = (data.hotspots as any[]) ?? [];
      return {
        count: hotspots.length,
        maxFrp: hotspots.length > 0 ? Math.max(...hotspots.map((h: any) => h.bright_ti4 ?? 0)) : 0,
      };
    }
    case 'wildfires':
    case 'floods': {
      const events = (data.events as any[]) ?? [];
      return { count: events.length };
    }
    case 'weather': {
      const current = (data.current as Record<string, any>) ?? {};
      return {
        temperature: current.temperature_2m ?? 0,
        wind_speed: current.wind_speed_10m ?? 0,
        humidity: current.relative_humidity_2m ?? 0,
      };
    }
    case 'air_quality': {
      const current = (data.current as Record<string, any>) ?? {};
      return { aqi: current.us_aqi ?? current.european_aqi ?? 0 };
    }
    case 'storms': {
      const storms = Array.isArray(data) ? data : (data.storms as any[]) ?? [];
      return { count: storms.length, maxWind: 0 };
    }
    default:
      return { raw: data };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SIGNIFICANCE EVALUATION
   ═══════════════════════════════════════════════════════════════════ */

function evaluateSignificance(
  layerId: string,
  current: Record<string, unknown>,
  baseline: Record<string, unknown>,
  thresholds: Record<string, number>,
): number {
  const cur = summarizeData(layerId, current);
  const base = baseline as Record<string, number>;

  switch (layerId) {
    case 'earthquakes': {
      const mag = cur.maxMagnitude as number ?? 0;
      const threshold = thresholds.earthquakes ?? 4.0;
      if (mag >= threshold) return Math.min(1, mag / 8);
      const count = cur.count as number ?? 0;
      const baseCount = (base.count as number) ?? 0;
      if (count > baseCount * 2 && count >= 3) return 0.5; // swarm detected
      return 0;
    }
    case 'firms_fires': {
      const count = cur.count as number ?? 0;
      const baseCount = (base.count as number) ?? 0;
      if (count >= (thresholds.fires_firms ?? 10)) return Math.min(1, count / 100);
      if (count > baseCount * 3 && count >= 5) return 0.5;
      return 0;
    }
    case 'wildfires':
    case 'floods': {
      const count = cur.count as number ?? 0;
      const baseCount = (base.count as number) ?? 0;
      if (count > 0 && count > baseCount) return Math.min(1, count / 20);
      return 0;
    }
    case 'weather': {
      const wind = cur.wind_speed as number ?? 0;
      const threshold = thresholds.storms ?? 50;
      if (wind >= threshold) return Math.min(1, wind / 140);
      return 0;
    }
    case 'air_quality': {
      const aqi = cur.aqi as number ?? 0;
      const threshold = thresholds.air_quality ?? 100;
      if (aqi >= threshold) return Math.min(1, aqi / 300);
      return 0;
    }
    case 'storms': {
      const count = cur.count as number ?? 0;
      if (count > 0) return Math.min(1, count / 5);
      return 0;
    }
    default:
      return 0;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   ALERT GENERATION
   ═══════════════════════════════════════════════════════════════════ */

function generateAlert(zone: WatchZone, layerId: string, data: Record<string, unknown>, significance: number): Alert {
  const severity = significance >= 0.8 ? 'critical' : significance >= 0.6 ? 'high' : significance >= 0.4 ? 'medium' : 'low';
  const cur = summarizeData(layerId, data);

  let title = '';
  let body = '';

  switch (layerId) {
    case 'earthquakes': {
      const mag = cur.maxMagnitude as number ?? 0;
      const count = cur.count as number ?? 0;
      title = `Seismic Activity — ${zone.name}`;
      body = `M${mag.toFixed(1)} earthquake detected in ${zone.name}. ${count} events in monitoring window.`;
      break;
    }
    case 'firms_fires': {
      const count = cur.count as number ?? 0;
      title = `Fire Detection — ${zone.name}`;
      body = `${count} thermal anomalies detected via NASA FIRMS in ${zone.name}.`;
      break;
    }
    case 'wildfires': {
      const count = cur.count as number ?? 0;
      title = `Wildfire Events — ${zone.name}`;
      body = `${count} active wildfire events near ${zone.name}.`;
      break;
    }
    case 'floods': {
      const count = cur.count as number ?? 0;
      title = `Flood Events — ${zone.name}`;
      body = `${count} flood events detected near ${zone.name}.`;
      break;
    }
    case 'weather': {
      const wind = cur.wind_speed as number ?? 0;
      title = `Weather Alert — ${zone.name}`;
      body = `Wind speed ${wind.toFixed(0)} km/h detected in ${zone.name}.`;
      break;
    }
    case 'air_quality': {
      const aqi = cur.aqi as number ?? 0;
      const label = aqi > 200 ? 'Very Unhealthy' : aqi > 150 ? 'Unhealthy' : aqi > 100 ? 'Unhealthy for Sensitive Groups' : 'Moderate';
      title = `Air Quality — ${zone.name}`;
      body = `AQI ${aqi.toFixed(0)} (${label}) in ${zone.name}.`;
      break;
    }
    case 'storms': {
      title = `Tropical Storm — ${zone.name}`;
      body = `Active tropical cyclone detected near ${zone.name}.`;
      break;
    }
    default:
      title = `Alert — ${layerId} — ${zone.name}`;
      body = `Significant change detected in ${layerId} for ${zone.name}.`;
  }

  return {
    alert_id: randomUUID().slice(0, 12),
    zone_id: zone.id,
    zone_name: zone.name,
    layer_id: layerId,
    severity,
    title,
    body,
    significance,
    lat: (zone.bbox_min_lat + zone.bbox_max_lat) / 2,
    lon: (zone.bbox_min_lon + zone.bbox_max_lon) / 2,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   STORAGE & NOTIFICATION
   ═══════════════════════════════════════════════════════════════════ */

function storeAlert(db: any, alert: Alert): void {
  db.prepare(`
    INSERT INTO sentinel_alerts (alert_id, anomaly_id, user_id, title, body, severity, lat, lon, type, delivered, created_at)
    VALUES (?, NULL, 'local-user', ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(alert.alert_id, alert.title, alert.body, alert.severity, alert.lat, alert.lon, alert.zone_id, new Date().toISOString());
}

function updateRiskSnapshot(db: any, zone: WatchZone, alerts: Alert[]): void {
  // Compute composite score from alerts
  const maxSeverity = alerts.reduce((max, a) => {
    const val = a.severity === 'critical' ? 100 : a.severity === 'high' ? 75 : a.severity === 'medium' ? 50 : 25;
    return Math.max(max, val);
  }, 0);

  const hazardScores: Record<string, number> = {};
  for (const alert of alerts) {
    const val = alert.severity === 'critical' ? 100 : alert.severity === 'high' ? 75 : alert.severity === 'medium' ? 50 : 25;
    hazardScores[alert.layer_id] = Math.max(hazardScores[alert.layer_id] ?? 0, val);
  }

  db.prepare(`
    INSERT INTO risk_snapshots (zone_id, composite_score, hazard_scores, alert_count, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(zone.id, maxSeverity, JSON.stringify(hazardScores), alerts.length, new Date().toISOString());
}

function pushAlerts(alerts: Alert[]): void {
  try {
    pubsub.publish('sentinel:alerts', {
      type: 'alerts',
      alerts,
      timestamp: Date.now(),
    });
  } catch {
    // Channel may not be initialized yet
  }
}
