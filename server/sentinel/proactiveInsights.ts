import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { broadcastToUser, broadcastToAll } from '../websocket';
import { getDb } from '../db/index';
import { memoryManagerV2 } from '../memory-v2/memoryManager-v2';
import { ensemblePredictor } from '../world-model/ensemblePredictor';
import type { Alert } from './alertIntelligence';
import type { EnrichedEvent } from './streamProcessor';

// ── Types ───────────────────────────────────────────────────────

export interface ProactiveInsight {
  id: string;
  type: 'pattern_spotting' | 'trend_alert' | 'prediction' | 'recommendation';
  title: string;
  body: string;
  confidence: number;
  lat?: number;
  lon?: number;
  userIds: string[];
  urgency: 'low' | 'medium' | 'high';
  timestamp: number;
  delivered: boolean;
}

// ── Insight generators ──────────────────────────────────────────

type InsightGenerator = () => Promise<ProactiveInsight[]>;

// ── ProactiveInsights ───────────────────────────────────────────

export class ProactiveInsights {
  private generators: InsightGenerator[] = [];
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private insightsIssued = 0;
  private running = false;

  init(): void {
    this.registerGenerators();
    logger.info('ProactiveInsights initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Listen for high-severity alerts → generate immediate insight
    pubsub.subscribe('sentinel:alert', (alert: Alert) => {
      if (alert.severity === 'critical') {
        this.insightsIssued++;
        broadcastToAll('sentinel_insight', {
          type: 'trend_alert',
          title: alert.title,
          body: alert.body,
          urgency: 'high',
        });
      }
    });

    // Listen for enriched events → check for patterns
    pubsub.subscribe('sentinel:enriched', (event: EnrichedEvent) => {
      if (event.severity === 'critical') {
        this.checkSwarmPattern(event);
      }
    });

    // Batch non-urgent insights every 5 minutes
    this.batchTimer = setInterval(() => this.generateBatch(), 300000);

    logger.info('ProactiveInsights started');
  }

  stop(): void {
    this.running = false;
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    logger.info('ProactiveInsights stopped');
  }

  // ── Insight Generation ────────────────────────────────────────

  private registerGenerators(): void {
    this.generators.push(() => this.generateSwarmPatterns());
    this.generators.push(() => this.generateStormUpdates());
    this.generators.push(() => this.generateFireTrends());
    this.generators.push(() => this.generatePredictionInsights());
  }

  private async generateBatch(): Promise<void> {
    for (const gen of this.generators) {
      try {
        const insights = await gen();
        for (const insight of insights) {
          if (!insight.urgency || insight.urgency === 'low') continue;
          this.deliverInsight(insight);
        }
      } catch { /* skip failed generator */ }
    }
  }

  private deliverInsight(insight: ProactiveInsight): void {
    this.insightsIssued++;
    insight.delivered = true;

    for (const userId of insight.userIds) {
      broadcastToUser(userId, 'sentinel_insight', insight);
    }
    if (insight.urgency === 'high') {
      broadcastToAll('sentinel_insight', insight);
    }

    pubsub.publish('sentinel:insight', insight);

    try {
      memoryManagerV2.store('sensory', {
        type: 'proactive_insight',
        source: 'proactiveInsights',
        data: insight,
        importanceScore: insight.urgency === 'high' ? 0.8 : insight.urgency === 'medium' ? 0.5 : 0.3,
      });
    } catch { /* non-critical */ }
  }

  // ── Generator: Swarm Patterns ─────────────────────────────────

  private async checkSwarmPattern(event: EnrichedEvent): Promise<void> {
    if (event.type !== 'earthquake') return;

    try {
      const db = getDb();
      const oneHourAgo = new Date(Date.now() - 7200000).toISOString();
      const rows = db.prepare(`
        SELECT COUNT(*) as count FROM sentinel_anomalies
        WHERE type = 'earthquake' AND created_at >= ?
      `).get(oneHourAgo) as { count: number } | undefined;

      const recentCount = rows?.count || 0;
      if (recentCount >= 3) {
        const mag = event.derivedFeatures.magnitude || 0;
        const insight: ProactiveInsight = {
          id: `insight_swarm_${Date.now()}`,
          type: 'pattern_spotting',
          title: 'Possible Swarm Event',
          body: `I noticed ${recentCount} M${mag.toFixed(1)}+ earthquakes in the last 2 hours — possible swarm developing. Monitor closely.`,
          confidence: Math.min(1, recentCount / 10),
          lat: event.lat,
          lon: event.lon,
          userIds: [],
          urgency: 'medium',
          timestamp: Date.now(),
          delivered: false,
        };
        this.deliverInsight(insight);
      }
    } catch { /* skip */ }
  }

  private async generateSwarmPatterns(): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT type, lat, lon, COUNT(*) as count, AVG(score) as avgScore
        FROM sentinel_anomalies
        WHERE created_at >= datetime('now', '-6 hours')
        GROUP BY type, ROUND(lat, 0), ROUND(lon, 0)
        HAVING count >= 3
      `).all() as Array<{ type: string; lat: number; lon: number; count: number; avgScore: number }>;

      for (const row of rows) {
        insights.push({
          id: `insight_swarm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'pattern_spotting',
          title: `Activity cluster: ${row.type.replace(/_/g, ' ')}`,
          body: `${row.count} ${row.type} events detected near ${row.lat.toFixed(1)},${row.lon.toFixed(1)} in the last 6 hours (avg anomaly score: ${row.avgScore.toFixed(2)}).`,
          confidence: row.avgScore,
          lat: row.lat,
          lon: row.lon,
          userIds: [],
          urgency: row.count >= 10 ? 'high' : 'medium',
          timestamp: Date.now(),
          delivered: false,
        });
      }
    } catch { /* empty */ }
    return insights;
  }

  // ── Generator: Storm Updates ──────────────────────────────────

  private async generateStormUpdates(): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM sentinel_anomalies
        WHERE type IN ('storm', 'severe_storm')
          AND created_at >= datetime('now', '-3 hours')
        ORDER BY score DESC LIMIT 5
      `).all() as Array<{ lat: number; lon: number; score: number; event_json: string }>;

      for (const row of rows) {
        const event = JSON.parse(row.event_json || '{}');
        const wind = event.derivedFeatures?.windSpeed || 0;
        const cat = event.derivedFeatures?.category || 0;

        if (cat >= 3) {
          insights.push({
            id: `insight_storm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'trend_alert',
            title: `Storm intensified to Category ${cat}`,
            body: `Storm has intensified to Category ${cat} (${wind}kt). Projected path may affect saved locations.`,
            confidence: Math.min(1, cat / 5),
            lat: row.lat,
            lon: row.lon,
            userIds: [],
            urgency: 'high',
            timestamp: Date.now(),
            delivered: false,
          });
        }
      }
    } catch { /* empty */ }
    return insights;
  }

  // ── Generator: Fire Trends ────────────────────────────────────

  private async generateFireTrends(): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT ROUND(lat, 0) as region, COUNT(*) as count, AVG(score) as avgScore
        FROM sentinel_anomalies
        WHERE type = 'fire' AND created_at >= datetime('now', '-24 hours')
        GROUP BY ROUND(lat, 0)
        HAVING count >= 5
      `).all() as Array<{ region: number; count: number; avgScore: number }>;

      for (const row of rows) {
        insights.push({
          id: `insight_fire_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'trend_alert',
          title: 'Increased fire activity',
          body: `${row.count} fire events detected near latitude ${row.region}° in last 24h — ${row.count > 20 ? 'elevated' : 'above-normal'} activity.`,
          confidence: row.avgScore,
          userIds: [],
          urgency: row.count > 20 ? 'high' : 'medium',
          timestamp: Date.now(),
          delivered: false,
        });
      }
    } catch { /* empty */ }
    return insights;
  }

  // ── Generator: Prediction Insights ────────────────────────────

  private async generatePredictionInsights(): Promise<ProactiveInsight[]> {
    const insights: ProactiveInsight[] = [];
    try {
      // Use short-term predictions from ensemble predictor
      const input = {
        location: { lat: 0, lon: 0, label: 'global' },
        layers: ['seismic', 'weather', 'hazards'],
        history: [],
        query: 'next_24h_risk',
      };
      const predictions = await ensemblePredictor.predict(input);

      for (const pred of predictions) {
        if (pred.probability > 0.6) {
          insights.push({
            id: `insight_pred_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'prediction',
            title: `Elevated ${pred.hazardType.replace(/_/g, ' ')} risk`,
            body: `${pred.hazardType.replace(/_/g, ' ')} probability: ${(pred.probability * 100).toFixed(0)}% (${pred.timeframe}). Factors: ${pred.contributingFactors.slice(0, 3).join(', ')}.`,
            confidence: pred.confidence,
            lat: undefined,
            lon: undefined,
            userIds: [],
            urgency: pred.probability > 0.8 ? 'high' : 'medium',
            timestamp: Date.now(),
            delivered: false,
          });
        }
      }
    } catch { /* empty */ }
    return insights;
  }

  getStats() {
    return { insightsIssued: this.insightsIssued, running: this.running };
  }
}

export const proactiveInsights = new ProactiveInsights();
