import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import type { EnrichedEvent } from './streamProcessor';

// ── Types ───────────────────────────────────────────────────────

export interface Anomaly {
  id: string;
  source: string;
  type: string;
  method: 'zscore' | 'isolation_forest' | 'graph' | 'ensemble';
  score: number;
  confidence: number;
  description: string;
  lat: number;
  lon: number;
  timestamp: number;
  event: EnrichedEvent;
}

interface TimeSeriesBucket {
  hazardType: string;
  region: string;
  values: number[];
  timestamps: number[];
}

// ── AnomalyDetector ─────────────────────────────────────────────

export class AnomalyDetector {
  private buckets: Map<string, TimeSeriesBucket> = new Map();
  private graphBaseline: Map<string, number> = new Map();
  private anomalyCount = 0;

  init(): void {
    this.loadGraphBaseline();
    logger.info('AnomalyDetector initialized');
  }

  start(): void {
    pubsub.subscribe('sentinel:detect', (event: EnrichedEvent) => {
      this.detect(event);
    });
    logger.info('AnomalyDetector started');
  }

  private detect(event: EnrichedEvent): void {
    const results: Anomaly[] = [];

    // Statistical: z-score for time-series hazards
    const zScore = this.detectZScore(event);
    if (zScore) results.push(zScore);

    // Graph: unusual patterns in knowledge graph
    const graphAnomaly = this.detectGraphAnomaly(event);
    if (graphAnomaly) results.push(graphAnomaly);

    // Ensemble: combine methods
    if (results.length >= 2) {
      const ensembleScore = results.reduce((s, a) => s + a.confidence, 0) / results.length;
      if (ensembleScore > 0.6) {
        const combined: Anomaly = {
          id: `anomaly_ensemble_${Date.now()}`,
          source: event.source,
          type: event.type,
          method: 'ensemble',
          score: ensembleScore,
          confidence: ensembleScore,
          description: `Ensemble anomaly: ${results.map(r => r.description).join('; ')}`,
          lat: event.lat,
          lon: event.lon,
          timestamp: Date.now(),
          event,
        };
        results.push(combined);
      }
    }

    for (const anomaly of results) {
      if (anomaly.confidence < 0.5) continue;
      this.anomalyCount++;

      // Publish to alert intelligence
      pubsub.publish('sentinel:anomaly', anomaly);

      // Store in memory (with dedup)
      try {
        const db = getDb();
        const existing = db.prepare(
          'SELECT id FROM sentinel_anomalies WHERE description = ? AND created_at >= datetime("now", "-1 hour")'
        ).get(anomaly.description) as { id: number } | undefined;
        if (existing) continue;

        db.prepare(`
          INSERT INTO sentinel_anomalies (anomaly_id, source, type, method, score, confidence, description, lat, lon, event_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(anomaly.id, anomaly.source, anomaly.type, anomaly.method, anomaly.score, anomaly.confidence,
          anomaly.description, anomaly.lat, anomaly.lon, JSON.stringify(anomaly.event));
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'Failed to store anomaly');
      }
    }
  }

  // ── Statistical: Z-score ──────────────────────────────────────

  private detectZScore(event: EnrichedEvent): Anomaly | null {
    const key = `${event.hazardType || event.type}_${event.lat.toFixed(1)},${event.lon.toFixed(1)}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { hazardType: event.hazardType || event.type, region: key, values: [], timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // Extract primary value
    const value = this.getPrimaryValue(event);
    if (value === null) return null;

    bucket.values.push(value);
    bucket.timestamps.push(event.timestamp);

    // Keep window of 50
    if (bucket.values.length > 50) {
      bucket.values.shift();
      bucket.timestamps.shift();
    }

    if (bucket.values.length < 10) return null;

    const mean = bucket.values.reduce((s, v) => s + v, 0) / bucket.values.length;
    const std = Math.sqrt(bucket.values.reduce((s, v) => s + (v - mean) ** 2, 0) / bucket.values.length);
    if (std === 0) return null;

    const z = (value - mean) / std;
    if (Math.abs(z) < 2.5) return null;

    const confidence = Math.min(1, Math.abs(z) / 5);
    return {
      id: `anomaly_zscore_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      source: event.source,
      type: event.type,
      method: 'zscore',
      score: Math.abs(z),
      confidence,
      description: `${event.hazardType || event.type} z-score=${z.toFixed(2)} (${confidence > 0.8 ? 'extreme' : 'unusual'} deviation from baseline)`,
      lat: event.lat,
      lon: event.lon,
      timestamp: Date.now(),
      event,
    };
  }

  // ── Graph-based anomaly detection ─────────────────────────────

  private detectGraphAnomaly(event: EnrichedEvent): Anomaly | null {
    const key = `${event.hazardType || event.type}`;
    const current = this.graphBaseline.get(key) || 0;
    const rate = this.estimateArrivalRate(event, key);

    if (rate === 0) return null;

    // If arrival rate is >3x baseline, flag as graph anomaly
    if (current > 0 && rate / current > 3) {
      return {
        id: `anomaly_graph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        source: event.source,
        type: event.type,
        method: 'graph',
        score: rate / current,
        confidence: Math.min(1, (rate / current - 3) / 3),
        description: `Sudden surge in ${event.hazardType || event.type} events (${rate.toFixed(1)}/hr vs baseline ${current.toFixed(1)}/hr)`,
        lat: event.lat,
        lon: event.lon,
        timestamp: Date.now(),
        event,
      };
    }

    this.graphBaseline.set(key, rate);
    return null;
  }

  private estimateArrivalRate(event: EnrichedEvent, _key: string): number {
    const db = getDb();
    try {
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const rows = db.prepare(`
        SELECT COUNT(*) as count FROM sentinel_anomalies
        WHERE type = ? AND created_at >= ?
      `).get(event.type, oneHourAgo) as { count: number } | undefined;
      return (rows?.count || 0) + 1;
    } catch {
      return 1;
    }
  }

  private loadGraphBaseline(): void {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT type, COUNT(*) as cnt FROM sentinel_anomalies
        WHERE created_at >= datetime('now', '-24 hours')
        GROUP BY type
      `).all() as Array<{ type: string; cnt: number }>;
      for (const row of rows) {
        this.graphBaseline.set(row.type, row.cnt / 24);
      }
    } catch { /* empty */ }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private getPrimaryValue(event: EnrichedEvent): number | null {
    const features = event.derivedFeatures;
    if (features.magnitude !== undefined) return features.magnitude;
    if (features.windSpeed !== undefined) return features.windSpeed;
    if (features.frp !== undefined) return features.frp;
    if (features.intensity !== undefined) return features.intensity;
    return null;
  }

  getStats() {
    return { anomalyCount: this.anomalyCount, activeBuckets: this.buckets.size };
  }
}

export const anomalyDetector = new AnomalyDetector();
