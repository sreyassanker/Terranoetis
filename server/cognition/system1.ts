import { getDb } from '../db/index';
import { ensureReasoningTracesTable } from '../db/reasoningTraces';
import { omninet } from '../ai-router/omninet';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export interface System1Match {
  query: string;
  intent: string;
  confidence: number;
  responseTemplate: string;
  similarity: number;
}

export interface System1Result {
  match: System1Match | null;
  isAnomaly: boolean;
  queryEmbedding: Float32Array | null;
  latencyMs: number;
}

// ── Query Pattern Generator ─────────────────────────────────────

const CITIES = [
  'tokyo', 'delhi', 'new york', 'london', 'paris', 'mumbai', 'shanghai', 'beijing',
  'moscow', 'cairo', 'los angeles', 'istanbul', 'sydney', 'singapore', 'dubai',
  'seoul', 'bangkok', 'toronto', 'san francisco', 'chicago', 'berlin', 'madrid',
  'rome', 'mexico city', 'sao paulo', 'jakarta', 'lagos', 'nairobi', 'cape town',
  'mumbai', 'kolkata', 'chennai', 'bangalore', 'hong kong', 'kuala lumpur',
  'manila', 'ho chi minh', 'taipei', 'osaka', 'melbourne', 'auckland',
  'buenos aires', 'santiago', 'lima', 'bogota', 'lisbon', 'vienna', 'warsaw',
  'stockholm', 'oslo', 'helsinki', 'dublin', 'athens', 'prague', 'budapest',
];

const QUERY_TEMPLATES: Array<{
  intent: string;
  templates: string[];
  responseTemplate: string;
  confidence: number;
}> = [
  {
    intent: 'weather_check',
    templates: [
      'what is the weather in {city}',
      'weather forecast {city}',
      'temperature in {city}',
      'is it raining in {city}',
      'current conditions {city}',
      'humidity in {city}',
      'wind speed {city}',
      'weather report {city}',
    ],
    responseTemplate: 'Current weather in {city}: {conditions}. Temperature: {temp}°C, humidity: {humidity}%, wind: {wind} km/h. Forecast: {forecast}.',
    confidence: 0.92,
  },
  {
    intent: 'earthquake_check',
    templates: [
      'recent earthquakes near {city}',
      'earthquake activity {city}',
      'seismic activity near {city}',
      'latest quakes {city} region',
      'earthquake risk {city}',
      'are there earthquakes near {city}',
      'magnitude of recent quakes {city}',
      'fault lines near {city}',
    ],
    responseTemplate: 'Recent seismic activity near {city}: {quakeCount} earthquakes detected in the past 24h. Largest: M{magnitude} at {depth} depth. Risk level: {riskLevel}.',
    confidence: 0.90,
  },
  {
    intent: 'fly_to',
    templates: [
      'fly to {city}',
      'go to {city}',
      'zoom to {city}',
      'take me to {city}',
      'navigate to {city}',
      'show me {city} on the globe',
      'focus on {city}',
      'center on {city}',
    ],
    responseTemplate: 'Flying to {city} ({lat}°, {lon}°). Showing aerial view with relevant data layers.',
    confidence: 0.95,
  },
  {
    intent: 'toggle_layer',
    templates: [
      'show earthquakes',
      'enable flight tracking',
      'turn on wildfire layer',
      'display volcanoes',
      'show me aircraft',
      'enable storm tracking',
      'turn on wildfires',
      'show satellite imagery',
      'display ship traffic',
      'turn on weather radar',
      'show earthquake data',
      'enable fire detection',
      'display tectonic plates',
    ],
    responseTemplate: 'Toggling {layerName} layer. Data source: {source}. {count} active {layerType} detected.',
    confidence: 0.88,
  },
  {
    intent: 'quick_scan',
    templates: [
      'what is happening in {city}',
      'check hazards near {city}',
      'scan for issues in {city}',
      'find events near {city}',
      'is there anything happening near {city}',
      'what threats near {city}',
      'analyze risks in {city}',
      'check danger zones {city}',
      'status report {city}',
      'situation overview {city}',
    ],
    responseTemplate: 'Quick scan for {city}: {eventCount} active events. Top hazard: {topHazard}. Weather: {weather}. Seismic: {seismic}.',
    confidence: 0.85,
  },
  {
    intent: 'deep_analysis',
    templates: [
      'compare earthquake patterns in {city}',
      'detailed analysis of {city} region',
      'research seismic activity {city}',
      'study volcanic patterns {city}',
      'investigate climate trends {city}',
      'correlation between earthquakes and {city}',
      'comprehensive report {city} region',
      'in depth analysis of {city} geohazards',
    ],
    responseTemplate: 'Deep analysis for {city} region. {analysisSummary}. Confidence: {confidence}%.',
    confidence: 0.82,
  },
  {
    intent: 'compute',
    templates: [
      'analyze earthquake patterns',
      'compute statistics',
      'calculate average magnitude',
      'run correlation analysis',
      'cluster seismic events',
      'predict aftershocks',
      'simulate tsunami propagation',
      'process geospatial data',
      'run statistical analysis',
      'calculate risk metrics',
    ],
    responseTemplate: 'Analysis complete. Computed {metricName}: {metricValue}. Statistical significance: {significance}.',
    confidence: 0.85,
  },
  {
    intent: 'hazard_query',
    templates: [
      'are there wildfires near {city}',
      'volcanic activity {city}',
      'tsunami risk {city}',
      'flood warnings {city}',
      'storm alerts {city}',
      'hurricane risk near {city}',
      'air quality {city}',
      'radiation levels {city}',
      'landslide risk {city}',
    ],
    responseTemplate: 'Hazard assessment for {city}: {hazardType} risk is {riskLevel}. Current alerts: {alertCount}. Advisory: {advisory}.',
    confidence: 0.87,
  },
  {
    intent: 'space_weather',
    templates: [
      'solar activity report',
      'aurora forecast',
      'kp index',
      'solar flare alert',
      'geomagnetic storm status',
      'space weather conditions',
    ],
    responseTemplate: 'Space weather: Kp index {kpIndex}. Solar wind: {solarWind}. Aurora activity: {auroraLevel}.',
    confidence: 0.85,
  },
  {
    intent: 'aviation',
    templates: [
      'flights near {city}',
      'air traffic {city}',
      'aircraft positions',
      'planes overhead',
      'flight tracking',
    ],
    responseTemplate: 'Air traffic near {city}: {flightCount} aircraft detected. Altitudes: {altitudeRange} ft.',
    confidence: 0.84,
  },
];

// ── System 1 ─────────────────────────────────────────────────────

export class System1 {
  private patterns: Array<{
    query: string;
    intent: string;
    confidence: number;
    responseTemplate: string;
    embedding: Float32Array | null;
  }> = [];
  private initialized = false;
  private warming = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.ensureTable();
    await this.warmCache();
    this.initialized = true;
    logger.info({ patternCount: this.patterns.length }, 'System 1 initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS system1_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_hash TEXT NOT NULL UNIQUE,
        query TEXT NOT NULL,
        intent TEXT NOT NULL,
        confidence REAL NOT NULL,
        response_template TEXT NOT NULL,
        embedding BLOB,
        hit_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      ensureReasoningTracesTable(db);
    } catch { /* tables exist */ }
  }

  async warmCache(): Promise<void> {
    if (this.warming) return;
    this.warming = true;

    const db = getDb();
    const cachedCount = db.prepare('SELECT COUNT(*) as count FROM system1_cache').get() as { count: number };
    if (cachedCount.count > 100) {
      this.loadFromDb();
      this.warming = false;
      return;
    }

    const patterns: Array<{
      query: string;
      intent: string;
      confidence: number;
      responseTemplate: string;
    }> = [];

    for (const cat of QUERY_TEMPLATES) {
      for (const template of cat.templates) {
        if (template.includes('{city}')) {
          for (const city of CITIES) {
            patterns.push({
              query: template.replace(/\{city\}/g, city),
              intent: cat.intent,
              confidence: cat.confidence,
              responseTemplate: cat.responseTemplate.replace(/\{city\}/g, city),
            });
          }
        } else {
          patterns.push({
            query: template,
            intent: cat.intent,
            confidence: cat.confidence,
            responseTemplate: cat.responseTemplate,
          });
        }
      }
    }

    const insert = db.prepare(
      `INSERT OR IGNORE INTO system1_cache (query_hash, query, intent, confidence, response_template)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const batch = db.transaction((items: typeof patterns) => {
      for (const item of items) {
        const hash = this.hashQuery(item.query);
        insert.run(hash, item.query, item.intent, item.confidence, item.responseTemplate);
      }
    });

    batch(patterns);
    this.loadFromDb();

    logger.info({ total: this.patterns.length }, 'System 1 cache warmed');
    this.warming = false;

    this.computeEmbeddingsBackground();
  }

  private async computeEmbeddingsBackground(): Promise<void> {
    const db = getDb();
    const unembedded = db.prepare(
      'SELECT id, query FROM system1_cache WHERE embedding IS NULL LIMIT 200',
    ).all() as Array<{ id: number; query: string }>;

    if (unembedded.length === 0) return;

    const update = db.prepare('UPDATE system1_cache SET embedding = ? WHERE id = ?');
    const batch = db.transaction(
      (items: Array<{ id: number; embedding: Buffer }>) => {
        for (const item of items) {
          update.run(item.embedding, item.id);
        }
      },
    );

    const embeddings: Array<{ id: number; embedding: Buffer }> = [];
    for (const row of unembedded) {
      try {
        const emb = await omninet.generateEmbedding(row.query);
        const buf = Buffer.from(emb.buffer);
        embeddings.push({ id: row.id, embedding: buf });

        const pattern = this.patterns.find(p => p.query === row.query);
        if (pattern) pattern.embedding = emb;

        if (embeddings.length >= 50) {
          batch(embeddings);
          embeddings.length = 0;
        }
      } catch {
        // skip failed embeddings
      }
    }

    if (embeddings.length > 0) {
      batch(embeddings);
    }

    logger.info({ computed: unembedded.length }, 'System 1 background embeddings computed');
  }

  private loadFromDb(): void {
    const db = getDb();
    const rows = db.prepare(
      'SELECT query, intent, confidence, response_template, embedding FROM system1_cache',
    ).all() as Array<{
      query: string;
      intent: string;
      confidence: number;
      response_template: string;
      embedding: Buffer | null;
    }>;

    this.patterns = rows.map(r => ({
      query: r.query,
      intent: r.intent,
      confidence: r.confidence,
      responseTemplate: r.response_template,
      embedding: r.embedding
        ? new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)
        : null,
    }));

    logger.info({ loaded: this.patterns.length }, 'System 1 patterns loaded from DB');
  }

  async classify(query: string): Promise<System1Result> {
    const start = Date.now();
    await this.ensureReady();

    const queryEmb = await omninet.generateEmbedding(query);

    let bestMatch: System1Match | null = null;
    let totalSimilarity = 0;
    let nearCount = 0;

    for (const pattern of this.patterns) {
      if (!pattern.embedding) continue;
      const sim = this.cosineSimilarity(queryEmb, pattern.embedding);
      totalSimilarity += sim;
      nearCount++;

      if (sim > (bestMatch?.similarity ?? 0)) {
        bestMatch = {
          query: pattern.query,
          intent: pattern.intent,
          confidence: pattern.confidence,
          responseTemplate: pattern.responseTemplate,
          similarity: sim,
        };
      }
    }

    const avgSimilarity = nearCount > 0 ? totalSimilarity / nearCount : 0;
    const isAnomaly = bestMatch ? bestMatch.similarity < 0.6 : avgSimilarity < 0.6;

    const latencyMs = Date.now() - start;

    if (bestMatch && bestMatch.similarity >= 0.92) {
      const db = getDb();
      db.prepare('UPDATE system1_cache SET hit_count = hit_count + 1 WHERE query_hash = ?')
        .run(this.hashQuery(bestMatch.query));
    }

    return {
      match: bestMatch && bestMatch.similarity >= 0.6 ? bestMatch : null,
      isAnomaly,
      queryEmbedding: queryEmb,
      latencyMs,
    };
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) await this.init();
    const hasEmbeddings = this.patterns.some(p => p.embedding !== null);
    if (!hasEmbeddings) {
      await this.computeEmbeddingsBackground();
    }
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  private hashQuery(query: string): string {
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const chr = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return `${hash}`;
  }
}

export const system1 = new System1();
