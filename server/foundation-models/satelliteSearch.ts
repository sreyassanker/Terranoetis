import { getDb } from '../db/index';

export const LAND_COVER_KEYWORDS: Record<string, string[]> = {
  water: ['water', 'ocean', 'sea', 'lake', 'river', 'bay', 'coast', 'beach', 'flood', 'submerged', 'marine', 'aquatic'],
  trees: ['forest', 'tree', 'woods', 'jungle', 'rainforest', 'timber', 'woodland', 'mangrove', 'taiga', 'boreal'],
  grass: ['grass', 'grassland', 'meadow', 'prairie', 'savanna', 'pasture', 'steppe', 'lawn', 'herbaceous'],
  flooded_vegetation: ['wetland', 'marsh', 'swamp', 'bog', 'flooded', 'mangrove', 'delta', 'estuary'],
  crops: ['farm', 'crop', 'agriculture', 'field', 'plantation', 'orchard', 'vineyard', 'rice', 'wheat', 'corn', 'soy', 'cultivated', 'farmland'],
  built_area: ['city', 'urban', 'town', 'building', 'road', 'highway', 'development', 'suburb', 'settlement', 'industrial', 'residential', 'infrastructure', 'concrete', 'pavement'],
  bare_ground: ['desert', 'sand', 'rock', 'mountain', 'bare', 'barren', 'dirt', 'arid', 'drought', 'erosion', 'gravel', 'quarry', 'mine'],
  snow_ice: ['snow', 'ice', 'glacier', 'frozen', 'arctic', 'antarctic', 'permafrost', 'alpine', 'frost'],
  clouds: ['cloud', 'fog', 'overcast', 'storm', 'hurricane', 'typhoon', 'atmosphere'],
};

const CLASS_SYNONYMS: Record<string, string> = {
  forest: 'trees',
  ocean: 'water',
  sea: 'water',
  lake: 'water',
  river: 'water',
  desert: 'bare_ground',
  mountain: 'bare_ground',
  city: 'built_area',
  urban: 'built_area',
  farm: 'crops',
  agriculture: 'crops',
  wetland: 'flooded_vegetation',
  marsh: 'flooded_vegetation',
  glacier: 'snow_ice',
  ice: 'snow_ice',
};

function resolveClass(text: string): string | null {
  const lower = text.toLowerCase().trim();
  for (const [cls, keywords] of Object.entries(LAND_COVER_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return cls;
    }
  }
  if (CLASS_SYNONYMS[lower]) return CLASS_SYNONYMS[lower];
  return null;
}

export interface SearchQuery {
  text?: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  classLabel?: string;
  minConfidence?: number;
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
}

export interface SearchResult {
  lat: number;
  lon: number;
  classLabel: string;
  confidence: number;
  similarity?: number;
  imageUrl?: string;
  fetchedAt: string;
  source: 'prithvi' | 'sentinel' | 'search';
  thumbnailUrl?: string;
}

export class SatelliteSearcher {
  private textEncoder: ((text: string, opts: { pooling: string; normalize: boolean }) => { data: Float32Array }) | null = null;
  private encoderLoading = false;
  private encoderInitAttempted = false;

  async init(): Promise<void> {
    this.encoderLoading = false;
    this.encoderInitAttempted = false;
  }

  private async ensureEncoder(): Promise<void> {
    if (this.textEncoder || this.encoderInitAttempted) return;
    this.encoderInitAttempted = true;
    this.encoderLoading = true;
    try {
      const { pipeline } = await import('@xenova/transformers');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      this.textEncoder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true,
      }) as unknown as (text: string, opts: { pooling: string; normalize: boolean }) => { data: Float32Array };
      clearTimeout(timeout);
    } catch (err) {
      console.warn('[SatelliteSearch] Text encoder unavailable, using keyword search:', String(err));
    } finally {
      this.encoderLoading = false;
    }
  }

  isReady(): boolean {
    return !this.encoderLoading;
  }

  async search(query: SearchQuery): Promise<{ results: SearchResult[]; total: number }> {
    const limit = Math.min(query.limit || 20, 100);
    const offset = query.offset || 0;
    const db = getDb();

    let classFilter: string | null = query.classLabel || null;
    if (query.text && !classFilter) {
      classFilter = resolveClass(query.text);
    }

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (classFilter) {
      conditions.push('e.class_label = ?');
      params.push(classFilter);
    }

    if (query.lat != null && query.lon != null && query.radiusKm != null) {
      const latRange = query.radiusKm / 111.0;
      const lonRange = query.radiusKm / (111.0 * Math.cos((query.lat * Math.PI) / 180));
      conditions.push('e.lat BETWEEN ? AND ?');
      params.push(query.lat - latRange, query.lat + latRange);
      conditions.push('e.lon BETWEEN ? AND ?');
      params.push(query.lon - lonRange, query.lon + lonRange);
    }

    if (query.since) {
      conditions.push('e.fetched_at >= ?');
      params.push(query.since);
    }
    if (query.until) {
      conditions.push('e.fetched_at <= ?');
      params.push(query.until);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM prithvi_embeddings e ${whereClause}`).get(...params) as { cnt: number };
    const total = countRow.cnt;

    const rows = db.prepare(
      `SELECT e.lat, e.lon, e.class_label, e.embedding, e.fetched_at
       FROM prithvi_embeddings e ${whereClause}
       ORDER BY e.fetched_at DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as Array<{
      lat: number; lon: number; class_label: string; embedding: string; fetched_at: string;
    }>;

    let results: SearchResult[] = rows.map(r => ({
      lat: r.lat,
      lon: r.lon,
      classLabel: r.class_label,
      confidence: 0.85,
      fetchedAt: r.fetched_at,
      source: 'prithvi' as const,
    }));

    if (query.text) {
      const textEmbedding = await this.computeTextEmbedding(query.text);
      if (textEmbedding) {
        for (const result of results) {
          const row = rows.find(r => r.lat === result.lat && r.lon === result.lon);
          if (row) {
            const emb = JSON.parse(row.embedding) as number[];
            result.similarity = this.cosineSimilarity(textEmbedding, emb);
          }
        }
        results = results.filter(r => r.similarity != null);
        results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
      } else if (classFilter) {
        results.sort((a, b) => a.classLabel === classFilter ? -1 : b.classLabel === classFilter ? 1 : 0);
      }
    }

    if (query.lat != null && query.lon != null && !query.radiusKm) {
      for (const result of results) {
        const dlat = result.lat - query.lat;
        const dlon = (result.lon - query.lon) * Math.cos((query.lat * Math.PI) / 180);
        result.similarity = Math.exp(-(dlat * dlat + dlon * dlon) * 1000);
      }
      results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    }

    return { results: results.slice(0, limit), total };
  }

  async computeTextEmbedding(text: string): Promise<number[] | null> {
    await this.ensureEncoder();
    if (this.textEncoder) {
      try {
        const output = await this.textEncoder(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data) as number[];
      } catch { /* ignore */ }
    }
    return null;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
  }
}

export const satelliteSearcher = new SatelliteSearcher();
