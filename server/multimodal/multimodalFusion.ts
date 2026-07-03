import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { memoryManagerV2 } from '../memory-v2/memoryManager-v2';
import { causalGraph } from '../world-model/causalGraph';
import { getDb } from '../db/index';
import { satelliteAnalyzer, type SatelliteObservation } from './satelliteAnalyzer';
import { seismicProcessor, type SeismicEvent } from './seismicProcessor';
import { type DisasterSignal } from './sentimentAnalyzer';
import { type StormCell } from './radarInterpreter';

export interface FusedEvent {
  id: string;
  type: string;
  lat: number;
  lon: number;
  timestamp: number;
  confidence: number;
  modalities: string[];
  sources: Array<{
    modality: string;
    source: string;
    confidence: number;
  }>;
  satelliteData?: SatelliteObservation;
  seismicData?: SeismicEvent;
  radarData?: StormCell;
  socialSignals?: DisasterSignal[];
  timeline: Array<{ modality: string; timestamp: number; source: string }>;
  summary: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface ModalFeedback {
  modality: string;
  source: string;
  eventType: string;
  confidence: number;
  lat: number;
  lon: number;
  timestamp: number;
}

export class MultimodalFusion {
  private running = false;
  private eventBuffer: ModalFeedback[] = [];
  private fusionWindowMs = 300000; // 5-minute fusion window
  private unsubscribeFns: (() => void)[] = [];

  init(): void {
    this.ensureTables();
    logger.info('MultimodalFusion initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Subscribe to all modality event streams
    this.unsubscribeFns.push(
      pubsub.subscribe('seismic:event', (event: SeismicEvent) => {
        this.ingest({ modality: 'seismic', source: 'iris', eventType: 'earthquake', confidence: 0.8, lat: event.lat, lon: event.lon, timestamp: event.time });
      }),
    );

    this.unsubscribeFns.push(
      pubsub.subscribe('satellite:observation', (obs: SatelliteObservation) => {
        this.ingest({ modality: 'satellite', source: 'sentinel-2', eventType: 'observation', confidence: 0.7, lat: obs.lat, lon: obs.lon, timestamp: obs.timestamp });
      }),
    );

    this.unsubscribeFns.push(
      pubsub.subscribe('satellite:change', (data: { lat: number; lon: number; deltaDescription: string }) => {
        this.ingest({ modality: 'satellite', source: 'sentinel-2', eventType: 'change_detection', confidence: 0.75, lat: data.lat, lon: data.lon, timestamp: Date.now() });
      }),
    );

    this.unsubscribeFns.push(
      pubsub.subscribe('radar:storm_alert', (cell: StormCell) => {
        this.ingest({ modality: 'radar', source: 'nexrad', eventType: 'storm_cell', confidence: 0.85, lat: cell.lat, lon: cell.lon, timestamp: Date.now() });
      }),
    );

    this.unsubscribeFns.push(
      pubsub.subscribe('sentiment:disaster_signal', (signal: DisasterSignal) => {
        this.ingest({ modality: 'sentiment', source: signal.source, eventType: signal.type, confidence: signal.confidence, lat: signal.lat, lon: signal.lon, timestamp: signal.timestamp });
      }),
    );

    // Fusion cycle: every 60 seconds, fuse buffered events
    setInterval(() => this.fuseBuffer(), 60000);

    logger.info('MultimodalFusion started — fusing signals from all modalities');
  }

  stop(): void {
    this.running = false;
    for (const unsub of this.unsubscribeFns) unsub();
    this.unsubscribeFns = [];
    logger.info('MultimodalFusion stopped');
  }

  /** Ingest a signal from any modality into the fusion buffer */
  ingest(feedback: ModalFeedback): void {
    this.eventBuffer.push(feedback);
    // Keep buffer trimmed to fusion window
    const cutoff = Date.now() - this.fusionWindowMs;
    this.eventBuffer = this.eventBuffer.filter(e => e.timestamp > cutoff);
  }

  /** Fuse buffered signals into unified events */
  fuseBuffer(): FusedEvent[] {
    if (this.eventBuffer.length < 2) return [];

    const fused: FusedEvent[] = [];
    const processed = new Set<number>();

    // Cluster by spatial proximity (within 1 degree) and temporal proximity (within 30 min)
    for (let i = 0; i < this.eventBuffer.length; i++) {
      if (processed.has(i)) continue;
      const cluster: ModalFeedback[] = [this.eventBuffer[i]];
      processed.add(i);

      for (let j = i + 1; j < this.eventBuffer.length; j++) {
        if (processed.has(j)) continue;
        const a = this.eventBuffer[i];
        const b = this.eventBuffer[j];
        const distDeg = Math.sqrt((a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2);
        const timeDelta = Math.abs(a.timestamp - b.timestamp) / 60000;

        if (distDeg < 1.0 && timeDelta < 30) {
          cluster.push(b);
          processed.add(j);
        }
      }

      if (cluster.length >= 1) {
        const fusedEvent = this.createFusedEvent(cluster);
        fused.push(fusedEvent);
      }
    }

    // Store and publish fused events
    for (const event of fused) {
      if (event.confidence > 0.5) {
        this.storeFusedEvent(event);
        pubsub.publish('multimodal:fused_event', event);

        // Add to causal graph
        causalGraph.addNode(event.id, 'event', 0.5, {
          type: event.type,
          confidence: event.confidence,
          modalities: event.modalities,
          severity: event.severity,
        }).catch(() => {});

        memoryManagerV2.store('episodic', { userId: '', query: 'fused_multimodal_event', response: JSON.stringify(event), intentType: event.type } as unknown as Record<string, unknown>).catch(() => {});
      }
    }

    return fused;
  }

  /** Create a unified event from a cluster of modal signals */
  private createFusedEvent(cluster: ModalFeedback[]): FusedEvent {
    const centroid = cluster.reduce(
      (acc, e) => ({ lat: acc.lat + e.lat / cluster.length, lon: acc.lon + e.lon / cluster.length }),
      { lat: 0, lon: 0 },
    );

    const modalities = [...new Set(cluster.map(e => e.modality))];
    const sources = cluster.map(e => ({ modality: e.modality, source: e.source, confidence: e.confidence }));

    // Confidence = weighted average, higher when multiple modalities agree
    const avgConfidence = cluster.reduce((acc, e) => acc + e.confidence, 0) / cluster.length;
    const modalityBonus = Math.min((modalities.length - 1) * 0.15, 0.3);
    const confidence = Math.min(avgConfidence + modalityBonus, 1.0);

    // Determine event type from majority vote
    const typeCounts = new Map<string, number>();
    for (const e of cluster) {
      typeCounts.set(e.eventType, (typeCounts.get(e.eventType) || 0) + 1);
    }
    const type = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    // Timeline reconstruction
    const timeline = [...cluster]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(e => ({ modality: e.modality, timestamp: e.timestamp, source: e.source }));

    // Severity based on confidence and modalities
    const severity: 'info' | 'warning' | 'critical' =
      confidence > 0.8 && modalities.length >= 2 ? 'critical' :
      confidence > 0.6 ? 'warning' : 'info';

    const summary = this.generateSummary(type, modalities, sources, cluster);

    return {
      id: `fused_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      lat: centroid.lat,
      lon: centroid.lon,
      timestamp: Date.now(),
      confidence,
      modalities: [...modalities],
      sources: [...new Set(sources.map(s => `${s.modality}:${s.source}`))].map(key => {
        const [modality, source] = key.split(':');
        return { modality: modality!, source: source!, confidence: cluster.filter(e => e.modality === modality).reduce((a, e) => a + e.confidence, 0) / cluster.filter(e => e.modality === modality).length };
      }),
      timeline,
      summary,
      severity,
    };
  }

  /** Generate a human-readable summary of the fused event */
  private generateSummary(type: string, modalities: string[], _sources: Array<{ modality: string; source: string; confidence: number }>, _cluster: ModalFeedback[]): string {
    const modalLabels: Record<string, string> = {
      satellite: 'satellite imagery',
      seismic: 'seismic data',
      radar: 'weather radar',
      sentiment: 'social reports',
    };

    const activeLabels = modalities.map(m => modalLabels[m] || m).filter(Boolean);
    const modalStr = activeLabels.length > 1
      ? `${activeLabels.slice(0, -1).join(', ')} and ${activeLabels[activeLabels.length - 1]}`
      : activeLabels[0] || 'unknown sources';

    const eventLabels: Record<string, string> = {
      earthquake: 'Seismic event',
      storm_cell: 'Storm cell',
      observation: 'Satellite observation',
      change_detection: 'Surface change detected',
      flood: 'Flood event',
      fire: 'Fire event',
      tornado: 'Tornado signature',
      hurricane: 'Hurricane/cyclone',
      landslide: 'Landslide',
      tsunami: 'Tsunami warning',
      volcano: 'Volcanic activity',
      general_disaster: 'Disaster event',
    };

    const eventLabel = eventLabels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `${eventLabel} detected via ${modalStr}`;
  }

  /** Fetch enriched context for a fused event from individual modalities */
  async enrichFusedEvent(event: FusedEvent): Promise<FusedEvent> {
    const results = await Promise.allSettled([
      satelliteAnalyzer.analyzeArea(event.lat, event.lon),
      seismicProcessor.fetchEvents(0, 24),
      ...(event.type === 'storm_cell' ? [] : []),
    ]);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const val = result.value;
        if (Array.isArray(val)) {
          const seismicVal = val.find(v => 'magnitude' in v) as SeismicEvent | undefined;
          if (seismicVal) event.seismicData = seismicVal;
        } else if ('sceneId' in val) {
          event.satelliteData = val as SatelliteObservation;
        }
      }
    }

    return event;
  }

  /** Query fused events from DB */
  queryFused(type?: string, limit = 50): FusedEvent[] {
    try {
      const db = getDb();
      if (type) {
        return db.prepare('SELECT * FROM fused_events WHERE type = ? ORDER BY timestamp DESC LIMIT ?').all(type, limit) as FusedEvent[];
      }
      return db.prepare('SELECT * FROM fused_events ORDER BY timestamp DESC LIMIT ?').all(limit) as FusedEvent[];
    } catch { return []; }
  }

  /** Query fused events near a location */
  queryNearby(lat: number, lon: number, radiusDeg = 1, limit = 20): FusedEvent[] {
    try {
      const db = getDb();
      return db.prepare(
        'SELECT * FROM fused_events WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY timestamp DESC LIMIT ?',
      ).all(lat - radiusDeg, lat + radiusDeg, lon - radiusDeg, lon + radiusDeg, limit) as FusedEvent[];
    } catch { return []; }
  }

  private storeFusedEvent(event: FusedEvent): void {
    try {
      const db = getDb();
      db.prepare(
        'INSERT OR IGNORE INTO fused_events (id, type, lat, lon, timestamp, confidence, modalities_json, sources_json, timeline_json, summary, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))',
      ).run(
        event.id, event.type, event.lat, event.lon, event.timestamp, event.confidence,
        JSON.stringify(event.modalities), JSON.stringify(event.sources),
        JSON.stringify(event.timeline), event.summary, event.severity,
      );
    } catch { /* ignore */ }
  }

  getStats() {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM fused_events').get() as { c: number }).c;
      const byType = db.prepare('SELECT type, COUNT(*) as c FROM fused_events GROUP BY type ORDER BY c DESC').all() as Array<{ type: string; c: number }>;
      const bufferSize = this.eventBuffer.length;
      return { totalFused: count, byType, bufferSize, running: this.running };
    } catch { return { totalFused: 0, byType: [], bufferSize: 0, running: this.running }; }
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS fused_events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          timestamp INTEGER NOT NULL,
          confidence REAL,
          modalities_json TEXT,
          sources_json TEXT,
          timeline_json TEXT,
          summary TEXT,
          severity TEXT DEFAULT 'info',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fused_type ON fused_events(type);
        CREATE INDEX IF NOT EXISTS idx_fused_timestamp ON fused_events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_fused_location ON fused_events(lat, lon);
        CREATE INDEX IF NOT EXISTS idx_fused_severity ON fused_events(severity);
      `);
    } catch { /* tables exist */ }
  }
}

export const multimodalFusion = new MultimodalFusion();
