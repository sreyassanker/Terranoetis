import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { causalGraph } from '../world-model/causalGraph';
import { memoryManagerV2 } from '../memory-v2/memoryManager-v2';
// ── Event envelope ──────────────────────────────────────────────

export interface RawEvent {
  source: string;
  type: string;
  timestamp: number;
  lat: number;
  lon: number;
  payload: Record<string, unknown>;
  raw?: unknown;
}

export interface EnrichedEvent extends RawEvent {
  enriched: true;
  city?: string;
  region?: string;
  country?: string;
  hazardType?: string;
  severity: 'info' | 'warning' | 'critical';
  derivedFeatures: Record<string, number>;
  kGraphRelations: string[];
}

// ── Source definitions ──────────────────────────────────────────

interface SourcePoller {
  name: string;
  intervalMs: number;
  poll(): Promise<RawEvent[]>;
}

// ── StreamProcessor ─────────────────────────────────────────────

export class StreamProcessor {
  private pollers: SourcePoller[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private running = false;
  private eventCount = 0;

  init(): void {
    logger.info('StreamProcessor initialized');
  }

  registerSource(poller: SourcePoller): void {
    this.pollers.push(poller);
    logger.info({ source: poller.name, intervalMs: poller.intervalMs }, 'Stream source registered');
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    for (const poller of this.pollers) {
      poller.poll().then(events => {
        for (const e of events) this.ingest(e);
      }).catch(() => {});
      const timer = setInterval(() => {
        poller.poll().then(events => {
          for (const e of events) this.ingest(e);
        }).catch(() => {});
      }, poller.intervalMs);
      this.timers.push(timer);
    }

    // Subscribe to events from other sentinel subsystems
    pubsub.subscribe('sentinel:raw', (event: RawEvent) => this.ingest(event));

    logger.info({ sourceCount: this.pollers.length }, 'StreamProcessor started');
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    logger.info('StreamProcessor stopped');
  }

  /** Process one event through filter → enrich → detect → route */
  private async ingest(raw: RawEvent): Promise<void> {
    this.eventCount++;

    // Filter: skip stale events (>24h)
    if (Date.now() - raw.timestamp > 86400000) return;

    // Enrich
    const enriched = await this.enrich(raw);

    // Store in sensory buffer
    try {
      memoryManagerV2.store('sensory', {
        type: `sentinel_${raw.source}`,
        source: raw.source,
        data: { eventType: raw.type, lat: raw.lat, lon: raw.lon, ...raw.payload },
        importanceScore: this.calcImportance(enriched),
      });
    } catch { /* non-critical */ }

    // Publish enriched event
    pubsub.publish('sentinel:enriched', enriched);

    // Route to anomaly detection for high-severity events
    if (enriched.severity !== 'info') {
      pubsub.publish('sentinel:detect', enriched);
    }
  }

  private async enrich(raw: RawEvent): Promise<EnrichedEvent> {
    const features: Record<string, number> = {};
    const kgRelations: string[] = [];

    // Geocoding via knowledge graph
    let city: string | undefined;
    let region: string | undefined;
    let country: string | undefined;
    const locLabel = `${raw.lat.toFixed(2)},${raw.lon.toFixed(2)}`;
    try {
      const entity = causalGraph.getNodeByName(locLabel);
      if (entity) kgRelations.push(entity.name);
    } catch { /* skip */ }

    // Compute derived features
    const derived = this.computeDerivedFeatures(raw, features);
    const severity = this.inferSeverity(raw);

    return {
      ...raw,
      enriched: true,
      city,
      region,
      country,
      hazardType: this.inferHazardType(raw),
      severity,
      derivedFeatures: derived,
      kGraphRelations: kgRelations,
    };
  }

  private computeDerivedFeatures(raw: RawEvent, base: Record<string, number>): Record<string, number> {
    switch (raw.type) {
      case 'earthquake': {
        const mag = Number(raw.payload.mag ?? 0);
        return {
          ...base,
          magnitude: mag,
          energy: Math.pow(10, 1.5 * mag + 4.8),
          depth: Number(raw.payload.depth ?? 10),
          intensity: this.mmiFromMag(mag, Number(raw.payload.depth ?? 10)),
        };
      }
      case 'storm': {
        const wind = Number(raw.payload.windSpeed ?? 0);
        return {
          ...base,
          windSpeed: wind,
          category: this.saffirSimpson(wind),
          pressure: Number(raw.payload.pressure ?? 1013),
        };
      }
      case 'fire': {
        const frp = Number(raw.payload.frp ?? 0);
        return {
          ...base,
          frp,
          intensity: frp / 100,
          spreadRisk: frp > 500 ? 0.8 : frp > 200 ? 0.5 : 0.2,
        };
      }
      default:
        return base;
    }
  }

  private inferSeverity(raw: RawEvent): 'info' | 'warning' | 'critical' {
    const mag = Number(raw.payload.mag ?? 0);
    const wind = Number(raw.payload.windSpeed ?? 0);
    const frp = Number(raw.payload.frp ?? 0);
    const type = raw.type;

    if (type === 'earthquake' && mag >= 7) return 'critical';
    if (type === 'earthquake' && mag >= 6) return 'warning';
    if (type === 'storm' && wind >= 100) return 'critical';
    if (type === 'storm' && wind >= 60) return 'warning';
    if (type === 'fire' && frp >= 500) return 'critical';
    if (type === 'fire' && frp >= 100) return 'warning';
    if (type === 'tsunami') return 'critical';
    return 'info';
  }

  private inferHazardType(raw: RawEvent): string | undefined {
    const map: Record<string, string> = {
      earthquake: 'earthquake',
      storm: 'severe_storm',
      fire: 'wildfire',
      flood: 'flood',
      tsunami: 'tsunami',
      volcano: 'volcano',
      lightning: 'lightning',
    };
    return map[raw.type];
  }

  private calcImportance(enriched: EnrichedEvent): number {
    const severityMap: Record<string, number> = { info: 0.3, warning: 0.6, critical: 0.9 };
    return severityMap[enriched.severity] ?? 0.3;
  }

  getStats() {
    return { eventCount: this.eventCount, sourceCount: this.pollers.length, running: this.running };
  }

  // ── Helpers ─────────────────────────────────────────────────

  private mmiFromMag(mag: number, depth: number): number {
    if (depth <= 0) return 0;
    const dist = Math.max(depth, 5);
    return Math.max(1, Math.min(12, 1.5 * mag - 3.5 * Math.log10(dist) + 3.0));
  }

  private saffirSimpson(windKt: number): number {
    if (windKt >= 137) return 5;
    if (windKt >= 113) return 4;
    if (windKt >= 96) return 3;
    if (windKt >= 83) return 2;
    if (windKt >= 64) return 1;
    return 0;
  }
}

export const streamProcessor = new StreamProcessor();
