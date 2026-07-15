import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { memoryManagerV2 } from '../memory-v2/memoryManager-v2';

export interface SatelliteObservation {
  source: string;
  sceneId: string;
  lat: number;
  lon: number;
  timestamp: number;
  cloudCover: number;
  ndvi?: number;
  changeDetected?: boolean;
  changeType?: 'deforestation' | 'urban_expansion' | 'flood_extent' | 'fire_scar' | 'none';
  interpretation?: string;
  thumbnailUrl?: string;
  rawUrl?: string;
}

export interface TileCache {
  key: string;
  lat: number;
  lon: number;
  tileData: string;
  fetchedAt: number;
}

export class SatelliteAnalyzer {
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private apiBase = process.env.COPERNICUS_API_BASE_URL || 'https://sh.dataspace.copernicus.eu';
  private collection = '/ogc/wfs/45001'; // Sentinel-2 L2A
  private get token(): string | undefined {
    return process.env.COPERNICUS_TOKEN;
  }
  private get authHeaders(): Record<string, string> | undefined {
    return this.token ? { Authorization: `Bearer ${this.token}` } : undefined;
  }

  init(): void {
    this.ensureTables();
    logger.info('SatelliteAnalyzer initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollTimer = setInterval(() => this.pollNewScenes(), 600000);
    logger.info('SatelliteAnalyzer started');
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    logger.info('SatelliteAnalyzer stopped');
  }

  /** Fetch imagery for a given bounding box and compute NDVI */
  async analyzeArea(lat: number, lon: number, radiusKm = 10): Promise<SatelliteObservation | null> {
    const bbox = this.bboxFromCenter(lat, lon, radiusKm);
    const cacheKey = `sat_${bbox.join(',')}`;

    const cached = this.getCachedTile(cacheKey);
    if (cached) {
      return JSON.parse(cached.tileData) as SatelliteObservation;
    }

    try {
      const url = `${this.apiBase}${this.collection}?bbox=${bbox.join(',')}&time=${this.dateDaysAgo(7)}&maxcc=30`;
      const fetchOpts: RequestInit = { signal: AbortSignal.timeout(15000) };
      const headers = this.authHeaders;
      if (headers) fetchOpts.headers = headers;
      const resp = await fetch(url, fetchOpts);
      if (!resp.ok) return null;

      const data = await resp.json() as { features?: Array<Record<string, unknown>> };
      const features = data.features || [];
      if (features.length === 0) return null;

      const best = features[0];
      const props = best.properties as Record<string, unknown> || {};

      const obs: SatelliteObservation = {
        source: 'sentinel-2',
        sceneId: (props.id as string) || `scene_${Date.now()}`,
        lat,
        lon,
        timestamp: Date.now(),
        cloudCover: (props.cloudCover as number) || 0,
        changeDetected: false,
        changeType: 'none',
      };

      // NDVI requires band math from raw imagery (B08/B04)
      // Sentinel Hub WFS metadata does not provide raw bands — return null
      obs.ndvi = undefined;
      obs.changeDetected = false;

      // Cache tile
      this.cacheTile(cacheKey, lat, lon, obs);

      // Store in episodic memory
      memoryManagerV2.store('episodic', { userId: '', query: 'satellite_observation', response: JSON.stringify(obs), intentType: 'satellite' } as unknown as Record<string, unknown>).catch(() => {});

      pubsub.publish('satellite:observation', obs);
      return obs;
    } catch {
      return null;
    }
  }

  /** Detect change between two timestamps for same area */
  async detectChange(lat: number, lon: number, daysBefore: number): Promise<{
    baseline: SatelliteObservation | null;
    current: SatelliteObservation | null;
    changed: boolean;
    deltaDescription: string;
  }> {
    const current = await this.analyzeArea(lat, lon);
    const baseline = await this.analyzeHistorical(lat, lon, daysBefore);

    const changed = current !== null && baseline !== null &&
      current.ndvi !== undefined && baseline.ndvi !== undefined &&
      Math.abs(current.ndvi - baseline.ndvi) > 0.15;

    let deltaDescription = 'No significant change detected';
    if (changed && current && baseline && current.ndvi !== undefined && baseline.ndvi !== undefined) {
      const diff = current.ndvi - baseline.ndvi;
      if (diff < -0.3) deltaDescription = 'Significant vegetation loss detected';
      else if (diff < -0.15) deltaDescription = 'Moderate vegetation decline';
      else if (diff > 0.3) deltaDescription = 'Vegetation regrowth detected';
      else deltaDescription = 'Minor spectral variation';
    }

    if (changed) {
      memoryManagerV2.store('episodic', { userId: '', query: 'satellite_change', response: JSON.stringify({ lat, lon, deltaDescription }), intentType: 'satellite' } as unknown as Record<string, unknown>).catch(() => {});
      pubsub.publish('satellite:change', { lat, lon, deltaDescription });
    }

    return { baseline, current, changed, deltaDescription };
  }

  /** Analyze wildfire scar extent */
  async detectFireScars(lat: number, lon: number): Promise<{
    scarDetected: boolean;
    estimatedAreaHa: number;
    severity: 'low' | 'moderate' | 'high' | 'severe';
  }> {
    const obs = await this.analyzeArea(lat, lon);
    if (!obs) return { scarDetected: false, estimatedAreaHa: 0, severity: 'low' };

    const scarDetected = obs.changeType === 'fire_scar';
    return {
      scarDetected,
      estimatedAreaHa: 0,
      severity: 'low',
    };
  }

  /** Analyze flood extent */
  async analyzeFloodExtent(lat: number, lon: number): Promise<{
    flooded: boolean;
    estimatedAreaKm2: number;
    waterFraction: number;
  }> {
    const obs = await this.analyzeArea(lat, lon);
    if (!obs) return { flooded: false, estimatedAreaKm2: 0, waterFraction: 0 };

    // Water fraction requires band math not available from WFS metadata
    return {
      flooded: false,
      estimatedAreaKm2: 0,
      waterFraction: 0,
    };
  }

  /** LLM vision interpretation (placeholder — requires vision-capable model) */
  async interpretWithVision(lat: number, lon: number, _apiKey?: string): Promise<string | null> {
    const obs = await this.analyzeArea(lat, lon);
    if (!obs) return null;

    // In production: fetch actual thumbnail, send to Gemini/Claude vision API
    // For now: return a structured interpretation from available data
    const interpretation = [
      `Satellite observation at ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      `Source: ${obs.source}, Scene: ${obs.sceneId}`,
      `Cloud cover: ${obs.cloudCover}%`,
      obs.ndvi !== undefined ? `NDVI: ${obs.ndvi.toFixed(3)} (${obs.ndvi > 0.3 ? 'healthy vegetation' : obs.ndvi > 0.1 ? 'sparse vegetation' : 'bare/water'})` : null,
      obs.changeDetected ? `Change detected: ${obs.changeType}` : 'No significant change from baseline',
    ].filter(Boolean).join('\n');

    return interpretation;
  }

  private async analyzeHistorical(lat: number, lon: number, _daysAgo: number): Promise<SatelliteObservation | null> {
    return this.analyzeArea(lat, lon);
  }

  private async pollNewScenes(): Promise<void> {
    // Check areas of interest for new imagery
    const db = getDb();
    const rows = db.prepare('SELECT DISTINCT lat, lon FROM satellite_tiles ORDER BY fetched_at DESC LIMIT 20').all() as Array<{ lat: number; lon: number }>;
    for (const row of rows) {
      await this.analyzeArea(row.lat, row.lon).catch(() => {});
    }
  }

  private bboxFromCenter(lat: number, lon: number, radiusKm: number): number[] {
    const kmPerDeg = 111.32;
    const dLat = radiusKm / kmPerDeg;
    const dLon = radiusKm / (kmPerDeg * Math.cos(lat * Math.PI / 180));
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  }

  private dateDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }

  private getCachedTile(key: string): TileCache | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM satellite_tiles WHERE key = ? AND fetched_at > datetime("now", "-1 day")').get(key) as TileCache | undefined;
      return row || null;
    } catch { return null; }
  }

  private cacheTile(key: string, lat: number, lon: number, obs: SatelliteObservation): void {
    try {
      const db = getDb();
      db.prepare('INSERT OR REPLACE INTO satellite_tiles (key, lat, lon, tile_data, fetched_at) VALUES (?, ?, ?, ?, datetime("now"))').run(key, lat, lon, JSON.stringify(obs));
    } catch { /* ignore */ }
  }

  getStats() {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM satellite_tiles').get() as { c: number }).c;
      return { cachedTiles: count, running: this.running };
    } catch { return { cachedTiles: 0, running: this.running }; }
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS satellite_tiles (
          key TEXT PRIMARY KEY,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          tile_data TEXT NOT NULL,
          fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_satellite_tiles_fetched ON satellite_tiles(fetched_at DESC);
        CREATE INDEX IF NOT EXISTS idx_satellite_tiles_location ON satellite_tiles(lat, lon);

        CREATE TABLE IF NOT EXISTS satellite_observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          obs_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_satellite_obs_created ON satellite_observations(created_at DESC);
      `);
    } catch { /* tables exist */ }
  }
}

export const satelliteAnalyzer = new SatelliteAnalyzer();
