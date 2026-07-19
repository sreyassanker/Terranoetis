/**
 * Anomaly Correlation Engine
 * 
 * Cross-correlates multiple real data streams to detect anomalies that
 * no single source would reveal. This is the core intelligence synthesis layer.
 * 
 * Data streams correlated:
 * - USGS Earthquakes
 * - NWS Weather Alerts
 * - NASA FIRMS Fire Detections
 * - NASA EONET Events
 * - Military Flights (ADSB.lol)
 * - UCDP Conflict Events
 * - GDACS Disaster Alerts
 * 
 * Correlation Rules:
 * - Activity Surge: flight traffic drop + nearby activity increase
 * - Escalation Precursor: military flights near conflict zones
 * - Disaster Cascade: earthquake + weather + fire in same region
 * - Conflict Escalation: UCDP events + military aircraft concentration
 */

import { haversineDistance } from '../utils/geo';
import { pubsub } from '../pubsub.js';
// Uses crypto.randomUUID() — no external dependency needed
import type Database from 'better-sqlite3';

// ─── Types ────────────────────────────────────────────────────────────

export interface CorrelatedEvent {
  id: string;
  source: string;
  type: string;
  lat: number;
  lon: number;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface CorrelationAnomaly {
  id: string;
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;       // 0-1
  title: string;
  description: string;
  lat: number;
  lon: number;
  radius: number;           // meters — affected area
  sources: string[];        // which data streams contributed
  events: string[];         // IDs of correlated events
  createdAt: number;
  acknowledged: boolean;
}

interface TimeWindow {
  events: CorrelatedEvent[];
  lastPrune: number;
}

// ─── Constants ────────────────────────────────────────────────────────

const WINDOW_SIZE_MS = 30 * 60 * 1000;  // 30-minute sliding window
const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // Prune stale events every 5 min
const CORRELATION_INTERVAL_MS = 60 * 1000; // Run correlation every 60s
const REGION_RADIUS_KM = 500;             // 500km radius for "same region" checks

// ─── Correlation Rules ────────────────────────────────────────────────

interface CorrelationRule {
  name: string;
  description: string;
  requiredSources: string[];
  minEvents: number;
  evaluate: (window: TimeWindow) => CorrelationAnomaly[];
}

// ─── Helper Functions ─────────────────────────────────────────────────

function eventsInRegion(events: CorrelatedEvent[], lat: number, lon: number, radiusKm: number): CorrelatedEvent[] {
  return events.filter(e => haversineDistance(lat, lon, e.lat, e.lon) <= radiusKm);
}

function eventsBySource(events: CorrelatedEvent[], source: string): CorrelatedEvent[] {
  return events.filter(e => e.source === source);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function latestEventTime(events: CorrelatedEvent[]): number {
  if (events.length === 0) return 0;
  return Math.max(...events.map(e => e.timestamp));
}

// ─── Rule: Disaster Cascade ───────────────────────────────────────────
// Detects when earthquake + weather alert + fire detection occur in
// the same region within the time window — a cascading disaster.

const DisasterCascadeRule: CorrelationRule = {
  name: 'disaster_cascade',
  description: 'Earthquake + weather alert + fire in same region indicates cascading disaster',
  requiredSources: ['usgs_earthquakes', 'nws_alerts', 'nasa_firms'],
  minEvents: 2,
  evaluate: (window) => {
    const anomalies: CorrelationAnomaly[] = [];
    const eqEvents = eventsBySource(window.events, 'usgs_earthquakes');
    const weatherEvents = eventsBySource(window.events, 'nws_alerts');
    const fireEvents = eventsBySource(window.events, 'nasa_firms');

    // For each earthquake, check if weather/fire events are nearby
    for (const eq of eqEvents) {
      const nearbyWeather = eventsInRegion(weatherEvents, eq.lat, eq.lon, REGION_RADIUS_KM);
      const nearbyFire = eventsInRegion(fireEvents, eq.lat, eq.lon, REGION_RADIUS_KM);

      if (nearbyWeather.length + nearbyFire.length >= 2) {
        const mag = (eq.payload.magnitude as number) || 0;
        const severity = mag >= 7 ? 'critical' : mag >= 5 ? 'high' : mag >= 3 ? 'medium' : 'low';
        const sources = new Set(['usgs_earthquakes']);
        if (nearbyWeather.length > 0) sources.add('nws_alerts');
        if (nearbyFire.length > 0) sources.add('nasa_firms');

        anomalies.push({
          id: crypto.randomUUID(),
          rule: 'disaster_cascade',
          severity,
          confidence: Math.min(0.95, 0.5 + (nearbyWeather.length + nearbyFire.length) * 0.15),
          title: `Disaster Cascade: M${mag} earthquake + ${nearbyWeather.length} weather alerts + ${nearbyFire.length} fire detections`,
          description: `Magnitude ${mag} earthquake near [${eq.lat.toFixed(2)}, ${eq.lon.toFixed(2)}] has triggered cascading effects: ${nearbyWeather.length} weather alerts and ${nearbyFire.length} fire detections within ${REGION_RADIUS_KM}km.`,
          lat: eq.lat,
          lon: eq.lon,
          radius: REGION_RADIUS_KM * 1000,
          sources: [...sources],
          events: [eq.id, ...nearbyWeather.map(e => e.id), ...nearbyFire.map(e => e.id)],
          createdAt: Date.now(),
          acknowledged: false,
        });
      }
    }
    return anomalies;
  },
};

// ─── Rule: Escalation Precursor ───────────────────────────────────────
// Detects when military aircraft appear near active conflict zones.
// This is a strong signal of potential military escalation.

const EscalationPrecursorRule: CorrelationRule = {
  name: 'escalation_precursor',
  description: 'Military aircraft near active conflict zone indicates potential escalation',
  requiredSources: ['military_flights', 'ucdp_conflicts'],
  minEvents: 2,
  evaluate: (window) => {
    const anomalies: CorrelationAnomaly[] = [];
    const flightEvents = eventsBySource(window.events, 'military_flights');
    const conflictEvents = eventsBySource(window.events, 'ucdp_conflicts');

    // For each conflict event, check for military flights nearby
    for (const conflict of conflictEvents) {
      const nearbyFlights = eventsInRegion(flightEvents, conflict.lat, conflict.lon, REGION_RADIUS_KM);
      
      if (nearbyFlights.length >= 2) {
        const deaths = (conflict.payload.deaths as number) || 0;
        const severity = deaths > 100 ? 'critical' : deaths > 10 ? 'high' : 'medium';

        anomalies.push({
          id: crypto.randomUUID(),
          rule: 'escalation_precursor',
          severity,
          confidence: Math.min(0.9, 0.4 + nearbyFlights.length * 0.1),
          title: `Escalation Precursor: ${nearbyFlights.length} military aircraft near active conflict`,
          description: `${nearbyFlights.length} military aircraft detected within ${REGION_RADIUS_KM}km of an active conflict zone (${deaths} reported deaths). This pattern often precedes military escalation.`,
          lat: conflict.lat,
          lon: conflict.lon,
          radius: REGION_RADIUS_KM * 1000,
          sources: ['military_flights', 'ucdp_conflicts'],
          events: [conflict.id, ...nearbyFlights.map(e => e.id)],
          createdAt: Date.now(),
          acknowledged: false,
        });
      }
    }
    return anomalies;
  },
};

// ─── Rule: Conflict Surge ─────────────────────────────────────────────
// Detects when multiple conflict events cluster in the same region
// within the time window — indicates intensifying fighting.

const ConflictSurgeRule: CorrelationRule = {
  name: 'conflict_surge',
  description: 'Multiple conflict events in same region indicates intensifying fighting',
  requiredSources: ['ucdp_conflicts'],
  minEvents: 3,
  evaluate: (window) => {
    const anomalies: CorrelationAnomaly[] = [];
    const conflictEvents = eventsBySource(window.events, 'ucdp_conflicts');

    // Simple clustering: find regions with 3+ conflict events
    const processed = new Set<string>();
    for (const event of conflictEvents) {
      if (processed.has(event.id)) continue;
      
      const cluster = eventsInRegion(conflictEvents, event.lat, event.lon, REGION_RADIUS_KM);
      if (cluster.length >= 3) {
        const totalDeaths = cluster.reduce((sum, e) => sum + ((e.payload.deaths as number) || 0), 0);
        const severity = totalDeaths > 500 ? 'critical' : totalDeaths > 50 ? 'high' : 'medium';
        
        // Calculate centroid
        const avgLat = cluster.reduce((s, e) => s + e.lat, 0) / cluster.length;
        const avgLon = cluster.reduce((s, e) => s + e.lon, 0) / cluster.length;

        anomalies.push({
          id: crypto.randomUUID(),
          rule: 'conflict_surge',
          severity,
          confidence: Math.min(0.95, 0.3 + cluster.length * 0.15),
          title: `Conflict Surge: ${cluster.length} events, ${totalDeaths} deaths in region`,
          description: `${cluster.length} conflict events detected within ${REGION_RADIUS_KM}km of each other, totaling ${totalDeaths} reported deaths. This indicates intensifying hostilities.`,
          lat: avgLat,
          lon: avgLon,
          radius: REGION_RADIUS_KM * 1000,
          sources: ['ucdp_conflicts'],
          events: cluster.map(e => e.id),
          createdAt: Date.now(),
          acknowledged: false,
        });

        cluster.forEach(e => processed.add(e.id));
      }
    }
    return anomalies;
  },
};

// ─── Rule: Seismic Cluster ────────────────────────────────────────────
// Detects earthquake swarms that may indicate volcanic activity
// or precursors to a larger event.

const SeismicClusterRule: CorrelationRule = {
  name: 'seismic_cluster',
  description: 'Earthquake swarm may indicate volcanic activity or precursor to larger event',
  requiredSources: ['usgs_earthquakes'],
  minEvents: 5,
  evaluate: (window) => {
    const anomalies: CorrelationAnomaly[] = [];
    const eqEvents = eventsBySource(window.events, 'usgs_earthquakes');

    // Simple clustering: find regions with 5+ earthquakes
    const processed = new Set<string>();
    for (const event of eqEvents) {
      if (processed.has(event.id)) continue;
      
      const cluster = eventsInRegion(eqEvents, event.lat, event.lon, 100); // 100km for seismic clusters
      if (cluster.length >= 5) {
        const maxMag = Math.max(...cluster.map(e => (e.payload.magnitude as number) || 0));
        const avgMag = cluster.reduce((s, e) => s + ((e.payload.magnitude as number) || 0), 0) / cluster.length;
        const severity = maxMag >= 6 ? 'critical' : maxMag >= 4.5 ? 'high' : maxMag >= 3 ? 'medium' : 'low';

        const avgLat = cluster.reduce((s, e) => s + e.lat, 0) / cluster.length;
        const avgLon = cluster.reduce((s, e) => s + e.lon, 0) / cluster.length;

        anomalies.push({
          id: crypto.randomUUID(),
          rule: 'seismic_cluster',
          severity,
          confidence: Math.min(0.9, 0.3 + cluster.length * 0.05),
          title: `Seismic Cluster: ${cluster.length} earthquakes (max M${maxMag.toFixed(1)})`,
          description: `${cluster.length} earthquakes detected within 100km of each other in the past ${WINDOW_SIZE_MS / 60000} minutes. Maximum magnitude: ${maxMag.toFixed(1)}, average: ${avgMag.toFixed(1)}. This may indicate volcanic activity or a precursor to a larger event.`,
          lat: avgLat,
          lon: avgLon,
          radius: 100_000, // 100km
          sources: ['usgs_earthquakes'],
          events: cluster.map(e => e.id),
          createdAt: Date.now(),
          acknowledged: false,
        });

        cluster.forEach(e => processed.add(e.id));
      }
    }
    return anomalies;
  },
};

// ─── Rule: Fire Storm ─────────────────────────────────────────────────
// Detects rapid fire spread — multiple fire detections in the same
// region within the time window.

const FireStormRule: CorrelationRule = {
  name: 'fire_storm',
  description: 'Multiple fire detections in same region indicates rapid fire spread',
  requiredSources: ['nasa_firms'],
  minEvents: 3,
  evaluate: (window) => {
    const anomalies: CorrelationAnomaly[] = [];
    const fireEvents = eventsBySource(window.events, 'nasa_firms');

    const processed = new Set<string>();
    for (const event of fireEvents) {
      if (processed.has(event.id)) continue;
      
      const cluster = eventsInRegion(fireEvents, event.lat, event.lon, 200); // 200km for fire spread
      if (cluster.length >= 3) {
        const avgLat = cluster.reduce((s, e) => s + e.lat, 0) / cluster.length;
        const avgLon = cluster.reduce((s, e) => s + e.lon, 0) / cluster.length;
        const severity = cluster.length >= 10 ? 'critical' : cluster.length >= 5 ? 'high' : 'medium';

        anomalies.push({
          id: crypto.randomUUID(),
          rule: 'fire_storm',
          severity,
          confidence: Math.min(0.85, 0.3 + cluster.length * 0.05),
          title: `Fire Storm: ${cluster.length} fire detections in region`,
          description: `${cluster.length} fire detections within 200km of each other in the past ${WINDOW_SIZE_MS / 60000} minutes. This pattern indicates rapid fire spread and potential wildfire emergency.`,
          lat: avgLat,
          lon: avgLon,
          radius: 200_000, // 200km
          sources: ['nasa_firms'],
          events: cluster.map(e => e.id),
          createdAt: Date.now(),
          acknowledged: false,
        });

        cluster.forEach(e => processed.add(e.id));
      }
    }
    return anomalies;
  },
};

// ─── Rule: Weather Emergency ──────────────────────────────────────────
// Detects severe weather events that overlap with populated areas
// or critical infrastructure.

const WeatherEmergencyRule: CorrelationRule = {
  name: 'weather_emergency',
  description: 'Severe weather overlapping with conflict or disaster zones',
  requiredSources: ['nws_alerts'],
  minEvents: 1,
  evaluate: (window) => {
    const anomalies: CorrelationAnomaly[] = [];
    const weatherEvents = eventsBySource(window.events, 'nws_alerts');
    const eqEvents = eventsBySource(window.events, 'usgs_earthquakes');
    const conflictEvents = eventsBySource(window.events, 'ucdp_conflicts');

    for (const weather of weatherEvents) {
      // Check if severe weather overlaps with earthquake or conflict zones
      const nearbyEq = eventsInRegion(eqEvents, weather.lat, weather.lon, REGION_RADIUS_KM);
      const nearbyConflict = eventsInRegion(conflictEvents, weather.lat, weather.lon, REGION_RADIUS_KM);

      if (nearbyEq.length > 0 || nearbyConflict.length > 0) {
        const severity = 'high';
        const sources = ['nws_alerts'];
        if (nearbyEq.length > 0) sources.push('usgs_earthquakes');
        if (nearbyConflict.length > 0) sources.push('ucdp_conflicts');

        anomalies.push({
          id: crypto.randomUUID(),
          rule: 'weather_emergency',
          severity,
          confidence: 0.7,
          title: `Weather Emergency: severe weather near ${nearbyEq.length > 0 ? 'earthquake' : 'conflict'} zone`,
          description: `Severe weather alert detected near an active ${nearbyEq.length > 0 ? 'earthquake zone' : 'conflict zone'}. Combined hazards increase risk to affected populations.`,
          lat: weather.lat,
          lon: weather.lon,
          radius: REGION_RADIUS_KM * 1000,
          sources,
          events: [weather.id, ...nearbyEq.map(e => e.id), ...nearbyConflict.map(e => e.id)],
          createdAt: Date.now(),
          acknowledged: false,
        });
      }
    }
    return anomalies;
  },
};

// ─── All Rules ────────────────────────────────────────────────────────

const ALL_RULES: CorrelationRule[] = [
  DisasterCascadeRule,
  EscalationPrecursorRule,
  ConflictSurgeRule,
  SeismicClusterRule,
  FireStormRule,
  WeatherEmergencyRule,
];

// ─── Correlation Engine ───────────────────────────────────────────────

export class CorrelationEngine {
  private window: TimeWindow = { events: [], lastPrune: Date.now() };
  private anomalyHistory: CorrelationAnomaly[] = [];
  private running = false;
  private correlationTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private db: Database.Database | null = null;
  private onUpdate: ((anomalies: CorrelationAnomaly[]) => void) | null = null;
  private externalFetchTimer: ReturnType<typeof setInterval> | null = null;
  private ingestedIds = new Set<string>();

  constructor(db: Database.Database) {
    this.db = db;
  }

  private ensureTables(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS correlation_anomalies (
        id TEXT PRIMARY KEY,
        rule TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence REAL NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        radius REAL NOT NULL,
        sources TEXT NOT NULL,
        events TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        acknowledged INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_corr_anomalies_rule ON correlation_anomalies(rule);
      CREATE INDEX IF NOT EXISTS idx_corr_anomalies_severity ON correlation_anomalies(severity);
      CREATE INDEX IF NOT EXISTS idx_corr_anomalies_created ON correlation_anomalies(created_at DESC);
    `);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.ensureTables();

    // Fetch external sources immediately and every 5 minutes
    this.ingestFromExternalSources().catch(() => {});
    this.externalFetchTimer = setInterval(() => {
      if (this.running) this.ingestFromExternalSources().catch(() => {});
    }, 5 * 60 * 1000);

    // Subscribe to all data streams
    pubsub.subscribe('sentinel:raw', (data: unknown) => {
      this.ingestEvent(data as CorrelatedEvent);
    });

    // Run correlation periodically
    this.correlationTimer = setInterval(() => {
      if (this.running) this.runCorrelation();
    }, CORRELATION_INTERVAL_MS);

    // Prune stale events
    this.pruneTimer = setInterval(() => {
      this.pruneWindow();
    }, PRUNE_INTERVAL_MS);

    console.log('[CorrelationEngine] Started — monitoring 6 data streams with 6 rules');
  }

  stop(): void {
    this.running = false;
    if (this.correlationTimer) { clearInterval(this.correlationTimer); this.correlationTimer = null; }
    if (this.pruneTimer) { clearInterval(this.pruneTimer); this.pruneTimer = null; }
    if (this.externalFetchTimer) { clearInterval(this.externalFetchTimer); this.externalFetchTimer = null; }
    console.log('[CorrelationEngine] Stopped');
  }

  ingestEvent(event: CorrelatedEvent): void {
    if (!event || typeof event.lat !== 'number' || typeof event.lon !== 'number' || !event.source) return;
    
    // Dedup by ID
    if (event.id && this.ingestedIds.has(event.id)) return;
    if (event.id) this.ingestedIds.add(event.id);

    // Add to sliding window
    this.window.events.push({
      ...event,
      timestamp: event.timestamp || Date.now(),
    });

    // Keep dedup set bounded
    if (this.ingestedIds.size > 50000) {
      this.ingestedIds.clear();
    }

    // Keep window bounded
    if (this.window.events.length > 10000) {
      this.window.events = this.window.events.slice(-5000);
    }
  }

  private pruneWindow(): void {
    const cutoff = Date.now() - WINDOW_SIZE_MS;
    this.window.events = this.window.events.filter(e => e.timestamp > cutoff);
    this.window.lastPrune = Date.now();
  }

  private runCorrelation(): void {
    this.pruneWindow();

    const allAnomalies: CorrelationAnomaly[] = [];

    for (const rule of ALL_RULES) {
      // Check if we have events from required sources
      const hasRequiredSources = rule.requiredSources.some(
        src => eventsBySource(this.window.events, src).length > 0
      );
      if (!hasRequiredSources) continue;

      try {
        const anomalies = rule.evaluate(this.window);
        allAnomalies.push(...anomalies);
      } catch (err) {
        console.error(`[CorrelationEngine] Rule ${rule.name} failed:`, err);
      }
    }

    // Deduplicate — keep highest confidence per rule+region
    const deduped = this.deduplicateAnomalies(allAnomalies);

    // Store and broadcast new anomalies
    if (deduped.length > 0) {
      for (const anomaly of deduped) {
        this.storeAnomaly(anomaly);
        this.anomalyHistory.push(anomaly);
      }

      // Keep history bounded
      if (this.anomalyHistory.length > 500) {
        this.anomalyHistory = this.anomalyHistory.slice(-300);
      }

      // Publish to WebSocket
      pubsub.publish('correlation:alerts', {
        type: 'anomaly_batch',
        anomalies: deduped,
        timestamp: Date.now(),
      });

      // Notify UI callback
      if (this.onUpdate) this.onUpdate(this.getRecentAnomalies());
    }
  }

  private deduplicateAnomalies(anomalies: CorrelationAnomaly[]): CorrelationAnomaly[] {
    const seen = new Map<string, CorrelationAnomaly>();
    
    for (const anomaly of anomalies) {
      // Key by rule + rounded region (1 degree grid)
      const regionKey = `${anomaly.rule}_${Math.round(anomaly.lat)}_${Math.round(anomaly.lon)}`;
      const existing = seen.get(regionKey);
      
      if (!existing || anomaly.confidence > existing.confidence) {
        seen.set(regionKey, anomaly);
      }
    }

    return [...seen.values()];
  }

  private storeAnomaly(anomaly: CorrelationAnomaly): void {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO correlation_anomalies (id, rule, severity, confidence, title, description, lat, lon, radius, sources, events, created_at, acknowledged)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        anomaly.id, anomaly.rule, anomaly.severity, anomaly.confidence,
        anomaly.title, anomaly.description, anomaly.lat, anomaly.lon,
        anomaly.radius, JSON.stringify(anomaly.sources), JSON.stringify(anomaly.events),
        anomaly.createdAt, anomaly.acknowledged ? 1 : 0
      );
    } catch (err) {
      console.error('[CorrelationEngine] Failed to store anomaly:', err);
    }
  }

  getRecentAnomalies(limit = 50): CorrelationAnomaly[] {
    return this.anomalyHistory.slice(-limit);
  }

  getAllAnomalies(limit = 100): CorrelationAnomaly[] {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(
        'SELECT * FROM correlation_anomalies ORDER BY created_at DESC LIMIT ?'
      ).all(limit) as Array<{
        id: string; rule: string; severity: string; confidence: number;
        title: string; description: string; lat: number; lon: number;
        radius: number; sources: string; events: string;
        created_at: number; acknowledged: number;
      }>;

      return rows.map(r => ({
        id: r.id,
        rule: r.rule,
        severity: r.severity as CorrelationAnomaly['severity'],
        confidence: r.confidence,
        title: r.title,
        description: r.description,
        lat: r.lat,
        lon: r.lon,
        radius: r.radius,
        sources: JSON.parse(r.sources),
        events: JSON.parse(r.events),
        createdAt: r.created_at,
        acknowledged: r.acknowledged === 1,
      }));
    } catch {
      return [];
    }
  }

  acknowledgeAnomaly(id: string): void {
    if (!this.db) return;
    this.db.prepare('UPDATE correlation_anomalies SET acknowledged = 1 WHERE id = ?').run(id);
    const anomaly = this.anomalyHistory.find(a => a.id === id);
    if (anomaly) anomaly.acknowledged = true;
  }

  getStatus(): { running: boolean; windowEvents: number; anomalyCount: number; ruleCount: number } {
    return {
      running: this.running,
      windowEvents: this.window.events.length,
      anomalyCount: this.anomalyHistory.length,
      ruleCount: ALL_RULES.length,
    };
  }

  setUpdateCallback(cb: (anomalies: CorrelationAnomaly[]) => void): void {
    this.onUpdate = cb;
  }

  /**
   * Manually ingest events from external sources (flights, UCDP, GDACS).
   * These aren't in the stream processor yet, so we pull them on demand.
   */
  async ingestFromExternalSources(): Promise<void> {
    // Fetch military flights
    try {
      const resp = await fetch('https://api.adsb.lol/v2/mil', { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const data = await resp.json() as { aircraft?: Array<{ lat: number; lon: number; altitude: number; heading: number; speed: number; icao24: string; callsign: string; }> };
        if (data.aircraft) {
          for (const ac of data.aircraft.slice(0, 100)) { // Limit to 100
            if (ac.lat && ac.lon) {
              this.ingestEvent({
                id: `adsb_${ac.icao24}_${Date.now()}`,
                source: 'military_flights',
                type: 'position',
                lat: ac.lat,
                lon: ac.lon,
                timestamp: Date.now(),
                payload: {
                  altitude: ac.altitude,
                  heading: ac.heading,
                  speed: ac.speed,
                  icao24: ac.icao24,
                  callsign: ac.callsign,
                },
              });
            }
          }
        }
      }
    } catch (err) { console.warn('[CorrelationEngine] ADSB fetch failed:', err); }

    // Fetch UCDP conflict events (last 7 days)
    try {
      const year = new Date().getFullYear();
      const resp = await fetch(`https://ucdpapi.pcr.uu.se/api/battledeaths/${year}?pagesize=50`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json() as { Result?: Array<{ latitude: number; longitude: number; deaths_best: number; side_a: string; side_b: string; country: string; }> };
        if (data.Result) {
          for (const event of data.Result) {
            if (event.latitude && event.longitude) {
              this.ingestEvent({
                id: `ucdp_${event.country}_${Date.now()}`,
                source: 'ucdp_conflicts',
                type: 'battle_death',
                lat: event.latitude,
                lon: event.longitude,
                timestamp: Date.now(),
                payload: {
                  deaths: event.deaths_best,
                  sideA: event.side_a,
                  sideB: event.side_b,
                  country: event.country,
                },
              });
            }
          }
        }
      }
    } catch (err) { console.warn('[CorrelationEngine] UCDP fetch failed:', err); }

    // Fetch GDACS alerts
    try {
      const resp = await fetch('https://www.gdacs.org/xml/rss.xml', { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const text = await resp.text();
        // Simple XML parsing for GDACS
        const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const item of items.slice(0, 20)) {
          const latMatch = item.match(/<geo:lat>([\d.-]+)<\/geo:lat>/);
          const lonMatch = item.match(/<geo:long>([\d.-]+)<\/geo:long>/);
          const titleMatch = item.match(/<title>(.*?)<\/title>/);
          if (latMatch && lonMatch) {
            this.ingestEvent({
              id: `gdacs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              source: 'gdacs_disasters',
              type: 'disaster_alert',
              lat: parseFloat(latMatch[1]),
              lon: parseFloat(lonMatch[1]),
              timestamp: Date.now(),
              payload: {
                title: titleMatch?.[1] || 'GDACS Alert',
              },
            });
          }
        }
      }
    } catch (err) { console.warn('[CorrelationEngine] GDACS fetch failed:', err); }
  }
}
