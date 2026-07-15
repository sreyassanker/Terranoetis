import { logger } from '../observability/logger';
import { getDb } from '../db/index';
import { streamProcessor, type RawEvent } from './streamProcessor';
import { anomalyDetector } from './anomalyDetector';
import { alertIntelligence } from './alertIntelligence';
import { proactiveInsights } from './proactiveInsights';
import { ambientIntelligence } from './ambientIntelligence';

// ── Built-in Source Pollers ─────────────────────────────────────

const EARTHQUAKE_SOURCE = {
  name: 'usgs_earthquakes',
  intervalMs: 60000,
  async poll(): Promise<RawEvent[]> {
    try {
      const resp = await fetch(
        'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
        { signal: AbortSignal.timeout(10000) },
      );
      if (!resp.ok) return [];
      const data = await resp.json() as { features?: Array<Record<string, unknown>> };
      return (data.features || []).map((f: Record<string, unknown>) => {
        const props = f.properties as Record<string, unknown> || {};
        const coords = (f.geometry as Record<string, unknown>)?.coordinates as number[] || [];
        return {
          source: 'usgs',
          type: 'earthquake',
          timestamp: (props.time as number) || Date.now(),
          lat: coords[1] || 0,
          lon: coords[0] || 0,
          payload: {
            mag: props.mag,
            depth: coords[2],
            place: props.place,
            id: `${props.net}_${props.code}`,
          },
        };
      }).filter(e => e.lat !== 0 || e.lon !== 0);
    } catch (e) { logger.warn({ err: e }, 'Sentinel USGS poll failed'); return []; }
  },
};

const EONET_SOURCE = {
  name: 'nasa_eonet',
  intervalMs: 120000,
  async poll(): Promise<RawEvent[]> {
    try {
      const resp = await fetch(
        'https://eonet.gsfc.nasa.gov/api/v3/events?days=1&status=open',
        { signal: AbortSignal.timeout(10000) },
      );
      if (!resp.ok) return [];
      const data = await resp.json() as { events?: Array<Record<string, unknown>> };
      return ((data.events || []) as Array<Record<string, unknown>>).flatMap((e: Record<string, unknown>) => {
        const geom = (e.geometry as Array<Record<string, unknown>>)?.[0] || {};
        const coords = geom.coordinates as number[] || [];
        const cats = (e.categories as Array<Record<string, unknown>>) || [];
        const catTitle = (cats[0]?.title as string) || 'unknown';
        return {
          source: 'eonet',
          type: catTitle.toLowerCase().replace(/\s+/g, '_'),
          timestamp: (geom.date as number) || Date.now(),
          lat: coords[1] || 0,
          lon: coords[0] || 0,
          payload: { title: e.title, category: catTitle, id: e.id },
        };
      }).filter(e => e.lat !== 0 || e.lon !== 0);
    } catch (e) { logger.warn({ err: e }, 'Sentinel EONET poll failed'); return []; }
  },
};

const FIRMS_SOURCE = {
  name: 'nasa_firms',
  intervalMs: 180000,
  async poll(): Promise<RawEvent[]> {
    const mapKey = process.env.NASA_FIRMS_MAP_KEY;
    if (!mapKey) return [];
    try {
      const resp = await fetch(
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/world/1`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!resp.ok) return [];
      const text = await resp.text();
      const lines = text.split('\n').filter(Boolean);
      if (lines.length < 2) return [];
      const headers = lines[0].split(',');
      const latIdx = headers.indexOf('latitude');
      const lonIdx = headers.indexOf('longitude');
      const frpIdx = headers.indexOf('frp');
      if (latIdx < 0 || lonIdx < 0) return [];

      return lines.slice(1, 50).map(line => {
        const parts = line.split(',');
        return {
          source: 'firms',
          type: 'fire',
          timestamp: Date.now(),
          lat: parseFloat(parts[latIdx]) || 0,
          lon: parseFloat(parts[lonIdx]) || 0,
          payload: {
            frp: frpIdx >= 0 ? parseFloat(parts[frpIdx]) || 0 : 0,
          },
        };
      }).filter(e => e.lat !== 0 || e.lon !== 0);
    } catch (e) { logger.warn({ err: e }, 'Sentinel FIRMS poll failed'); return []; }
  },
};

const WEATHER_ALERTS_SOURCE = {
  name: 'nws_alerts',
  intervalMs: 120000,
  async poll(): Promise<RawEvent[]> {
    try {
      const resp = await fetch(
        'https://api.weather.gov/alerts/active?limit=50',
        { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'LiveGlobe/1.0' } },
      );
      if (!resp.ok) return [];
      const data = await resp.json() as { features?: Array<Record<string, unknown>> };
      return ((data.features || []) as Array<Record<string, unknown>>).map((f: Record<string, unknown>) => {
        const props = f.properties as Record<string, unknown> || {};
        const coords = (f.geometry as Record<string, unknown>)?.coordinates as number[] || [];
        const severity = (props.severity as string) || '';
        return {
          source: 'nws',
          type: 'weather_alert',
          timestamp: new Date((props.effective as string) || Date.now()).getTime(),
          lat: coords[1] || 0,
          lon: coords[0] || 0,
          payload: {
            event: props.event,
            headline: props.headline,
            severity,
            urgency: props.urgency,
          },
        };
      }).filter(e => e.lat !== 0 || e.lon !== 0);
    } catch (e) { logger.warn({ err: e }, 'Sentinel NWS poll failed'); return []; }
  },
};

// ── Sentinel Orchestrator ───────────────────────────────────────

export class Sentinel {
  private running = false;

  async init(): Promise<void> {
    this.ensureTables();

    streamProcessor.init();
    anomalyDetector.init();
    alertIntelligence.init();
    proactiveInsights.init();
    ambientIntelligence.init();

    logger.info('Sentinel system initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Register data source pollers with stream processor
    streamProcessor.registerSource(EARTHQUAKE_SOURCE);
    streamProcessor.registerSource(EONET_SOURCE);
    if (process.env.NASA_FIRMS_MAP_KEY) {
      streamProcessor.registerSource(FIRMS_SOURCE);
    }
    streamProcessor.registerSource(WEATHER_ALERTS_SOURCE);

    // Start all subsystems
    streamProcessor.start();
    anomalyDetector.start();
    alertIntelligence.start();
    proactiveInsights.start();
    ambientIntelligence.start();

    logger.info('Sentinel system started — continuous monitoring active');
  }

  stop(): void {
    this.running = false;
    streamProcessor.stop();
    proactiveInsights.stop();
    ambientIntelligence.stop();
    logger.info('Sentinel system stopped');
  }

  // ── Schema ────────────────────────────────────────────────────

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS sentinel_anomalies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          anomaly_id TEXT NOT NULL UNIQUE,
          source TEXT NOT NULL,
          type TEXT NOT NULL,
          method TEXT NOT NULL,
          score REAL NOT NULL,
          confidence REAL NOT NULL,
          description TEXT,
          lat REAL,
          lon REAL,
          event_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_sentinel_anomalies_type ON sentinel_anomalies(type);
        CREATE INDEX IF NOT EXISTS idx_sentinel_anomalies_created ON sentinel_anomalies(created_at DESC);

        CREATE TABLE IF NOT EXISTS sentinel_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          alert_id TEXT NOT NULL UNIQUE,
          anomaly_id TEXT,
          user_id TEXT,
          title TEXT,
          body TEXT,
          severity TEXT NOT NULL DEFAULT 'info',
          lat REAL,
          lon REAL,
          type TEXT,
          delivered INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_user ON sentinel_alerts(user_id);
        CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_severity ON sentinel_alerts(severity);
        CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_created ON sentinel_alerts(created_at DESC);
      `);
    } catch (e) { logger.warn({ err: e }, 'Sentinel DB tables already exist'); }
  }

  getStatus() {
    return {
      running: this.running,
      stream: streamProcessor.getStats(),
      anomalies: anomalyDetector.getStats(),
      alerts: alertIntelligence.getStats(),
      insights: proactiveInsights.getStats(),
      ambient: ambientIntelligence.getStats(),
    };
  }
}

export const sentinel = new Sentinel();
