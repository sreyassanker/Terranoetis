import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { getDb } from '../db/index';
import { memoryManagerV2 } from '../memory-v2/memoryManager-v2';
import { causalGraph } from '../world-model/causalGraph';
import { ensemblePredictor } from '../world-model/ensemblePredictor';
import { predictionValidator } from '../world-model/predictionValidator';
import { omninet } from '../ai-router/omninet';
import type { EnrichedEvent } from './streamProcessor';
import type { ProactiveInsight } from './proactiveInsights';

// ── Monitored Region ────────────────────────────────────────────

interface MonitoredRegion {
  key: string;
  lat: number;
  lon: number;
  label: string;
  radiusKm: number;
  lastPredictions: Record<string, { timestamp: number; prediction: string }>;
}

interface PrecomputedResponse {
  query: string;
  response: string;
  timestamp: number;
  confidence: number;
}

// ── AmbientIntelligence ─────────────────────────────────────────

export class AmbientIntelligence {
  private regions: MonitoredRegion[] = [];
  private precomputedCache: Map<string, PrecomputedResponse> = new Map();
  private predictTimers: ReturnType<typeof setInterval>[] = [];
  private running = false;
  private worldModelUpdatedAt = 0;

  init(): void {
    this.loadRegions();
    logger.info('AmbientIntelligence initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // 1h predictions for all regions
    const hourlyTimer = setInterval(() => this.refreshPredictions(), 3600000);
    this.predictTimers.push(hourlyTimer);

    // 6h predictions
    const sixHourTimer = setInterval(() => this.refreshPredictions6h(), 21600000);
    this.predictTimers.push(sixHourTimer);

    // 24h predictions
    const dailyTimer = setInterval(() => this.refreshPredictions24h(), 86400000);
    this.predictTimers.push(dailyTimer);

    // Update world model on enriched events
    pubsub.subscribe('sentinel:enriched', (event: EnrichedEvent) => {
      this.updateWorldModel(event);
    });

    // Pre-compute responses to common questions
    pubsub.subscribe('sentinel:insight', (insight: ProactiveInsight) => {
      if (insight.urgency === 'high') {
        this.precomputeForInsight(insight);
      }
    });

    // Initial refresh
    this.refreshPredictions().catch(() => {});

    logger.info({ regionCount: this.regions.length }, 'AmbientIntelligence started');
  }

  stop(): void {
    this.running = false;
    for (const t of this.predictTimers) clearInterval(t);
    this.predictTimers = [];
    logger.info('AmbientIntelligence stopped');
  }

  // ── World Model Updates ───────────────────────────────────────

  private updateWorldModel(event: EnrichedEvent): void {
    // Update causal graph with observed event
    const hazardName = event.hazardType || event.type;
    causalGraph.learnFromOutcome([hazardName], 'confirmed').catch(() => {});

    // Record in prediction validator
    predictionValidator.recordValidation({
      hazardType: hazardName,
      predictedProb: 0.5,
      actualOccurred: true,
      predictedSeverity: event.severity,
      actualSeverity: event.severity,
      modelUsed: 'sentinel',
    });

    // Update ensemble predictor weights
    ensemblePredictor.recordOutcome(hazardName, {
      hazardType: hazardName,
      probability: 0.5,
      severity: event.severity,
      timeframe: '1h',
      confidence: 0.5,
      confidenceInterval: [0, 0],
      contributingFactors: [`observed_${hazardName}`],
      source: 'sentinel',
    }, true);

    this.worldModelUpdatedAt = Date.now();
  }

  // ── Predictions ───────────────────────────────────────────────

  private async refreshPredictions(): Promise<void> {
    for (const region of this.regions) {
      try {
        const input = {
          location: { lat: region.lat, lon: region.lon, label: region.label },
          layers: ['seismic', 'weather', 'hazards'],
          history: [],
          query: 'next_1h',
        };
        const predictions = ensemblePredictor.predict(input);
        region.lastPredictions['1h'] = {
          timestamp: Date.now(),
          prediction: predictions.map(p =>
            `${p.hazardType}: ${(p.probability * 100).toFixed(0)}% (${p.severity})`
          ).join('; ') || 'No significant risk',
        };

        // Pre-compute responses for common questions about this region
        await this.precomputeForRegion(region, '1h');
      } catch { /* skip region */ }
    }
  }

  private async refreshPredictions6h(): Promise<void> {
    for (const region of this.regions) {
      try {
        const input = {
          location: { lat: region.lat, lon: region.lon, label: region.label },
          layers: ['seismic', 'weather', 'hazards'],
          history: [],
          query: 'next_6h',
        };
        const predictions = ensemblePredictor.predict(input);
        region.lastPredictions['6h'] = {
          timestamp: Date.now(),
          prediction: predictions.map(p =>
            `${p.hazardType}: ${(p.probability * 100).toFixed(0)}%`
          ).join('; ') || 'No significant risk',
        };
      } catch { /* skip */ }
    }
  }

  private async refreshPredictions24h(): Promise<void> {
    for (const region of this.regions) {
      try {
        const input = {
          location: { lat: region.lat, lon: region.lon, label: region.label },
          layers: ['seismic', 'weather', 'hazards', 'space'],
          history: [],
          query: 'next_24h',
        };
        const predictions = ensemblePredictor.predict(input);
        region.lastPredictions['24h'] = {
          timestamp: Date.now(),
          prediction: predictions.map(p =>
            `${p.hazardType}: ${(p.probability * 100).toFixed(0)}%`
          ).join('; ') || 'No significant risk',
        };

        // 7d prediction via LLM
        if (predictions.length > 0) {
          const insight = await omninet.generateText(
            `Given these predictions for ${region.label}: ${JSON.stringify(predictions)}. Summarize the 7-day outlook in 1-2 sentences.`,
            { temperature: 0.2, maxTokens: 200 },
          ).catch(() => '7d prediction unavailable');
          region.lastPredictions['7d'] = { timestamp: Date.now(), prediction: insight };
        }
      } catch { /* skip */ }
    }
  }

  // ── Pre-computed Responses ────────────────────────────────────

  private async precomputeForRegion(region: MonitoredRegion, timeframe: string): Promise<void> {
    const commonQuestions = [
      `What's happening in ${region.label}?`,
      `Is ${region.label} safe?`,
      `Any earthquakes near ${region.label}?`,
      `Weather in ${region.label}?`,
      `Risk assessment for ${region.label}`,
    ];

    const prediction = region.lastPredictions[timeframe]?.prediction || 'No data';

    for (const q of commonQuestions) {
      const key = this.cacheKey(q);
      if (this.precomputedCache.has(key)) continue;

      try {
        const response = await omninet.generateText(
          `You are an ambient intelligence for geographic awareness. User asks: "${q}". Current predictions: ${prediction}. Answer concisely in 1-2 sentences.`,
          { temperature: 0.1, maxTokens: 200 },
        ).catch(() => prediction);

        this.precomputedCache.set(key, {
          query: q,
          response,
          timestamp: Date.now(),
          confidence: 0.7,
        });
      } catch { /* skip */ }
    }

    // Keep cache bounded
    if (this.precomputedCache.size > 200) {
      const entries = Array.from(this.precomputedCache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp);
      const toDelete = entries.slice(0, entries.length - 150);
      for (const [k] of toDelete) this.precomputedCache.delete(k);
    }
  }

  private async precomputeForInsight(insight: ProactiveInsight): Promise<void> {
    const q = `Tell me more about ${insight.title}`;
    const key = this.cacheKey(q);
    if (this.precomputedCache.has(key)) return;

    try {
      const response = await omninet.generateText(
        `Given this insight: "${insight.body}". Generate a detailed but concise explanation (2-3 sentences) of what this means and what to expect.`,
        { temperature: 0.2, maxTokens: 300 },
      ).catch(() => insight.body);

      this.precomputedCache.set(key, {
        query: q,
        response,
        timestamp: Date.now(),
        confidence: 0.6,
      });
    } catch { /* skip */ }
  }

  // ── Query ─────────────────────────────────────────────────────

  getPrecomputed(query: string): PrecomputedResponse | undefined {
    const key = this.cacheKey(query);
    const cached = this.precomputedCache.get(key);
    if (cached && Date.now() - cached.timestamp < 3600000) {
      return cached;
    }
    return undefined;
  }

  getRegionPredictions(key: string): MonitoredRegion | undefined {
    return this.regions.find(r => r.key === key);
  }

  getAllRegions(): MonitoredRegion[] {
    return this.regions;
  }

  // ── Region Management ─────────────────────────────────────────

  addRegion(lat: number, lon: number, label: string, radiusKm = 200): void {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (this.regions.find(r => r.key === key)) return;
    this.regions.push({
      key,
      lat,
      lon,
      label,
      radiusKm,
      lastPredictions: {},
    });
  }

  removeRegion(lat: number, lon: number): void {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    this.regions = this.regions.filter(r => r.key !== key);
  }

  private loadRegions(): void {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT frequent_locations FROM profiles').all() as Array<{ frequent_locations: string }>;
      const seen = new Set<string>();
      for (const row of rows) {
        const locs: Array<{ lat: number; lon: number; label: string }> =
          JSON.parse(row.frequent_locations || '[]');
        for (const loc of locs) {
          const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;
          if (!seen.has(key)) {
            seen.add(key);
            this.addRegion(loc.lat, loc.lon, loc.label || key);
          }
        }
      }
    } catch { /* start with default regions */ }

    // Always monitor key seismic/hazard zones
    this.addRegion(35.68, 139.65, 'Tokyo', 300);
    this.addRegion(34.05, -118.24, 'Los Angeles', 300);
    this.addRegion(-33.87, 151.21, 'Sydney', 300);
    this.addRegion(19.43, -99.13, 'Mexico City', 300);
    this.addRegion(41.01, 28.98, 'Istanbul', 300);
  }

  private cacheKey(q: string): string {
    return q.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 64);
  }

  getStats() {
    return {
      regionCount: this.regions.length,
      precomputedCount: this.precomputedCache.size,
      worldModelUpdatedAt: this.worldModelUpdatedAt,
      running: this.running,
    };
  }
}

export const ambientIntelligence = new AmbientIntelligence();
