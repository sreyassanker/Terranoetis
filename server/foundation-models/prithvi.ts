import ort from 'onnxruntime-node';
import { downloadModel, getModelPath, isModelDownloaded } from './modelDownloader';
import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { memoryManagerV2 } from '../memory-v2/memoryManager-v2';

const HLS_BAND_MEANS = [1087, 1342, 1433, 2734, 1958, 1363];
const HLS_BAND_STDS = [2248, 2179, 2178, 1850, 1242, 1049];

const ES_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';

// WGS84 constants for UTM conversion
const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const DEG2RAD = Math.PI / 180;

interface PrithviInput {
  lat: number;
  lon: number;
  radiusKm?: number;
  bands?: Float32Array;
}

interface PrithviOutput {
  embedding: number[];
  lat: number;
  lon: number;
  timestamp: number;
  confidence: number;
  classLabel: string;
  classProbabilities: Record<string, number>;
}

interface CachedEmbedding {
  lat: number;
  lon: number;
  embedding: string;
  classLabel: string;
  fetchedAt: string;
}

const LAND_COVER_CLASSES = [
  'water', 'trees', 'grass', 'flooded_vegetation', 'crops',
  'built_area', 'bare_ground', 'snow_ice', 'clouds',
];

const REFERENCE_CENTROIDS: Record<string, number[]> = {
  water: [],
  trees: [],
  built_area: [],
  bare_ground: [],
  crops: [],
};

export class PrithviEngine {
  private session: ort.InferenceSession | null = null;
  private ready = false;
  private loading = false;
  private modelPath: string | null = null;
  private embeddingCache: Map<string, CachedEmbedding> = new Map();
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    try {
      this.ensureTables();
      this.loadReferenceCentroids();
      this.loadCachedEmbeddings();

      if (isModelDownloaded('prithvi-eo-tiny')) {
        this.modelPath = getModelPath('prithvi-eo-tiny');
      } else {
        logger.info('Prithvi model not cached, downloading...');
        this.modelPath = await downloadModel('prithvi-eo-tiny');
      }

      this.session = await ort.InferenceSession.create(this.modelPath!, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });

      this.ready = true;
      logger.info('Prithvi engine ready');
    } catch (err) {
      logger.error({ err }, 'Failed to init Prithvi');
      this.initPromise = null;
      throw err;
    }
  }

  isReady(): boolean {
    return this.ready && this.session !== null;
  }

  getStatus() {
    return {
      ready: this.ready,
      loading: this.loading,
      modelPath: this.modelPath,
      cachedEmbeddings: this.embeddingCache.size,
      referenceClasses: Object.keys(REFERENCE_CENTROIDS).filter(k => REFERENCE_CENTROIDS[k].length > 0).length,
    };
  }

  async analyze(input: PrithviInput): Promise<PrithviOutput> {
    await this.init();

    const cacheKey = this.cacheKey(input.lat, input.lon);
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      return {
        embedding: JSON.parse(cached.embedding),
        lat: input.lat,
        lon: input.lon,
        timestamp: Date.now(),
        confidence: 0.85,
        classLabel: cached.classLabel || 'unknown',
        classProbabilities: cached.classLabel ? { [cached.classLabel]: 0.85 } : {},
      };
    }

    const bands = input.bands || await this.fetchBands(input.lat, input.lon, input.radiusKm || 10);
    const normalized = this.normalizeBands(bands);
    const embedding = await this.runInference(normalized);

    // Classify: centroid-based first, spectral fallback
    let classLabel: string;
    let probabilities: Record<string, number>;
    const centroids = REFERENCE_CENTROIDS;
    if (Object.keys(centroids).length > 0) {
      const embArr = Array.from(embedding);
      // Nearest-centroid: cosine similarity to each class centroid
      let bestSim = -1;
      let bestClass = 'unknown';
      const sims: Record<string, number> = {};
      for (const [cls, centroid] of Object.entries(centroids)) {
        const sim = this.cosineSimilarity(embArr, centroid);
        sims[cls] = sim;
        if (sim > bestSim) { bestSim = sim; bestClass = cls; }
      }
      // If best similarity is very low, check against all cached embeddings via kNN
      if (bestSim < 0.3 && this.embeddingCache.size > 10) {
        const db = getDb();
        try {
          const allRows = db.prepare(
            'SELECT class_label, embedding FROM prithvi_embeddings',
          ).all() as Array<{ class_label: string; embedding: string }>;
          const classSims: Record<string, number[]> = {};
          for (const row of allRows) {
            const refEmb = JSON.parse(row.embedding) as number[];
            const sim = this.cosineSimilarity(embArr, refEmb);
            if (!classSims[row.class_label]) classSims[row.class_label] = [];
            classSims[row.class_label].push(sim);
          }
          // Top-3 average per class
          for (const [cls, simList] of Object.entries(classSims)) {
            simList.sort((a, b) => b - a);
            const topK = simList.slice(0, Math.min(3, simList.length));
            const avgSim = topK.reduce((s, v) => s + v, 0) / topK.length;
            sims[cls] = Math.max(sims[cls] || -1, avgSim);
          }
          bestSim = -1; bestClass = 'unknown';
          for (const [cls, sim] of Object.entries(sims)) {
            if (sim > bestSim) { bestSim = sim; bestClass = cls; }
          }
        } catch { /* fall through to centroid result */ }
      }
      classLabel = bestSim > 0.2 ? bestClass : 'unknown';
      // Convert similarities to probabilities via softmax
      const expSims: Record<string, number> = {};
      let total = 0;
      for (const [cls, sim] of Object.entries(sims)) {
        const e = Math.exp((sim - bestSim) * 8); // sharpen more
        expSims[cls] = e;
        total += e;
      }
      probabilities = {};
      for (const [cls, e] of Object.entries(expSims)) {
        probabilities[cls] = e / total;
      }
      // If centroid confidence is very low, blend with spectral
      if (bestSim < 0.25) {
        const spectral = this.classifySpectral(bands);
        for (const [cls, prob] of Object.entries(spectral.probabilities)) {
          probabilities[cls] = (probabilities[cls] || 0) * 0.3 + prob * 0.7;
        }
        // Re-normalize
        const normTotal = Object.values(probabilities).reduce((s, v) => s + v, 0);
        if (normTotal > 0) {
          for (const cls of Object.keys(probabilities)) {
            probabilities[cls] /= normTotal;
          }
        }
        classLabel = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
      }
    } else {
      const spectral = this.classifySpectral(bands);
      classLabel = spectral.classLabel;
      probabilities = spectral.probabilities;
    }

    this.cacheEmbedding(cacheKey, input.lat, input.lon, embedding, classLabel);

    const output: PrithviOutput = {
      embedding: Array.from(embedding),
      lat: input.lat,
      lon: input.lon,
      timestamp: Date.now(),
      confidence: Math.max(...Object.values(probabilities), 0.5),
      classLabel,
      classProbabilities: probabilities,
    };

    try { memoryManagerV2.store('episodic', { name: 'prithvi_analysis', data: output, tags: ['prithvi', 'fm', classLabel] } as Record<string, unknown>); } catch { /* memory not available */ }
    try { pubsub.publish('prithvi:analysis', { lat: input.lat, lon: input.lon, classLabel }); } catch { /* pubsub not available */ }

    return output;
  }

  async getSimilar(
    lat: number,
    lon: number,
    topK = 5,
  ): Promise<Array<{ lat: number; lon: number; classLabel: string; similarity: number }>> {
    const result = await this.analyze({ lat, lon });
    const queryEmbedding = result.embedding;

    const db = getDb();
    const rows = db.prepare(
      'SELECT lat, lon, embedding, class_label FROM prithvi_embeddings ORDER BY RANDOM() LIMIT 200',
    ).all() as Array<{ lat: number; lon: number; embedding: string; class_label: string }>;

    const similarities: Array<{
      lat: number; lon: number; classLabel: string; similarity: number;
    }> = [];

    for (const row of rows) {
      if (row.lat === lat && row.lon === lon) continue;
      try {
        const emb = JSON.parse(row.embedding) as number[];
        const sim = this.cosineSimilarity(queryEmbedding, emb);
        similarities.push({ lat: row.lat, lon: row.lon, classLabel: row.class_label, similarity: sim });
      } catch { continue; }
    }

    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, topK);
  }

  async detectChange(lat: number, lon: number): Promise<{
    changed: boolean;
    deltaDescription: string;
    previousClass?: string;
    currentClass: string;
  }> {
    const current = await this.analyze({ lat, lon });

    const db = getDb();
    const previous = db.prepare(
      "SELECT embedding, class_label FROM prithvi_embeddings WHERE lat = ? AND lon = ? AND fetched_at < datetime('now') ORDER BY fetched_at DESC LIMIT 1",
    ).get(lat, lon) as { embedding: string; class_label: string } | undefined;

    if (!previous) {
      return { changed: false, deltaDescription: 'No baseline for comparison', currentClass: current.classLabel };
    }

    const prevEmb = JSON.parse(previous.embedding) as number[];
    const sim = this.cosineSimilarity(current.embedding, prevEmb);
    const changed = sim < 0.85;

    let deltaDescription = 'No significant change';
    if (changed) {
      deltaDescription = `Spectral shift detected (similarity: ${(sim * 100).toFixed(0)}%). ${previous.class_label} → ${current.classLabel}`;
    }

    if (changed) {
      try { memoryManagerV2.store('episodic', { name: 'prithvi_change', data: { lat, lon, similarity: sim, previousClass: previous.class_label, currentClass: current.classLabel }, tags: ['prithvi', 'change_detection'] } as Record<string, unknown>); } catch { /* memory not available */ }
      try { pubsub.publish('prithvi:change', { lat, lon, previousClass: previous.class_label, currentClass: current.classLabel }); } catch { /* pubsub not available */ }
    }

    return { changed, deltaDescription, previousClass: previous.class_label, currentClass: current.classLabel };
  }

  private async runInference(normalizedBands: Float32Array): Promise<Float32Array> {
    if (!this.session) throw new Error('Model not loaded');

    const inputTensor = new ort.Tensor('float32', normalizedBands, [1, 6, 1, 224, 224]);
    const results = await this.session.run({ 'pixel_values': inputTensor });
    const output = results['embeddings'] as ort.Tensor;
    return output.data as Float32Array;
  }

  private async fetchBands(lat: number, lon: number, _radiusKm: number): Promise<Float32Array> {
    return await this.fetchSentinelBands(lat, lon);
  }

  private utmZone(lon: number): number {
    return Math.floor((lon + 180) / 6) + 1;
  }

  private latLonToUTM(lat: number, lon: number): { easting: number; northing: number; zone: number } {
    const zone = this.utmZone(lon);
    const lon0 = (zone * 6 - 183) * DEG2RAD;
    const e2 = 2 * F - F * F;
    const phi = lat * DEG2RAD;
    const lam = lon * DEG2RAD;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const tanPhi = Math.tan(phi);
    const N = A / Math.sqrt(1 - e2 * sinPhi * sinPhi);
    const T = tanPhi * tanPhi;
    const C = e2 / (1 - e2) * cosPhi * cosPhi;
    const A_ = (lam - lon0) * cosPhi;

    const M = A * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
      - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
      + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
      - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi));

    const easting = K0 * N * (A_ + (1 - T + C) * A_ * A_ * A_ / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * e2) * A_ * A_ * A_ * A_ * A_ / 120) + 500000;

    const northing = K0 * (M + N * tanPhi * (A_ * A_ / 2
      + (5 - T + 9 * C + 4 * C * C) * A_ * A_ * A_ * A_ / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * e2) * A_ * A_ * A_ * A_ * A_ * A_ / 720));

    return { easting, northing: northing + (lat < 0 ? 10000000 : 0), zone };
  }

  private async fetchSentinelBands(lat: number, lon: number): Promise<Float32Array> {
    // 1. Search Earth Search STAC for best scene
    const bboxPad = 0.04;
    const searchBody = {
      collections: ['sentinel-2-l2a'],
      bbox: [lon - bboxPad, lat - bboxPad, lon + bboxPad, lat + bboxPad],
      limit: 1,
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
      query: { 'eo:cloud_cover': { lt: 50 } },
    };

    const searchResp = await fetch(ES_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody),
      signal: AbortSignal.timeout(15000),
    });
    if (!searchResp.ok) throw new Error(`STAC search failed: ${searchResp.status}`);

    const searchData = await searchResp.json() as { features?: Array<Record<string, unknown>> };
    const features = searchData.features || [];
    if (features.length === 0) throw new Error('No suitable Sentinel-2 scene found');

    const scene = features[0];
    const assetUrls: Record<string, string> = {};
    const bandKeys = ['coastal', 'blue', 'green', 'red', 'nir', 'swir16'];
    const bandMap: Record<string, number> = { coastal: 0, blue: 1, green: 2, red: 3, nir: 4, swir16: 5 };

    for (const key of bandKeys) {
      const asset = (scene.assets as Record<string, unknown>)[key];
      if (!asset) throw new Error(`Band ${key} not found in scene`);
      assetUrls[key] = (asset as Record<string, unknown>).href as string;
    }

    // 2. Convert lat/lon to UTM pixel coords in the GeoTIFF
    const utm = this.latLonToUTM(lat, lon);

    // 3. Read each band COG
    const totalPixels = 224 * 224;
    const bands = new Float32Array(6 * totalPixels);
    const half = 112;

    for (const key of bandKeys) {
      const bandIdx = bandMap[key];
      const url = assetUrls[key];

      const data = await this.readCOGTile(url, utm.easting, utm.northing, half, 224);
      for (let i = 0; i < totalPixels; i++) {
        bands[bandIdx * totalPixels + i] = data[i];
      }
    }

    if (bands[0] === 0 && bands[bands.length - 1] === 0) {
      throw new Error('All bands returned zero — possible georeferencing issue');
    }

    logger.info({ lat, lon, scene: scene.id }, 'Real Sentinel-2 bands fetched successfully');
    return bands;
  }

  private async readCOGTile(
    url: string, targetEasting: number, targetNorthing: number,
    halfSize: number, outSize: number,
  ): Promise<Float32Array> {
    // TIFF helper: read bytes from a URL range
    const readRange = async (offset: number, length: number): Promise<ArrayBuffer> => {
      const resp = await fetch(url, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`COG read failed at ${offset}: ${resp.status}`);
      return resp.arrayBuffer();
    };

    // Read TIFF header (first 512 bytes)
    const headerBuf = await readRange(0, 512);
    const dv = new DataView(headerBuf);
    const le = String.fromCharCode(dv.getUint8(0), dv.getUint8(1)) === 'II';
    if (dv.getUint16(2, le) !== 42) throw new Error('Not a valid TIFF');
    const ifdOff = dv.getUint32(4, le);

    // Parse IFD
    const readIFD = async (offset: number): Promise<{ tags: Map<number, { type: number; count: number; valueOffset: number }>; nextIFD: number }> => {
      const buf = await readRange(offset, 2 + 12 * 64 + 4); // header + 64 entries + next offset
      const d = new DataView(buf);
      const num = d.getUint16(0, le);
      const tags = new Map<number, { type: number; count: number; valueOffset: number }>();
      for (let i = 0; i < num; i++) {
        const entryOff = 2 + i * 12;
        const tag = d.getUint16(entryOff, le);
        const type = d.getUint16(entryOff + 2, le);
        const count = d.getUint32(entryOff + 4, le);
        const valueOffset = d.getUint32(entryOff + 8, le);
        tags.set(tag, { type, count, valueOffset });
      }
      const nextIFD = d.getUint32(2 + num * 12, le);
      return { tags, nextIFD };
    };

    const readTagValues = async (tag: { type: number; count: number; valueOffset: number }): Promise<number[]> => {
      const typeSizes: Record<number, number> = { 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8, 13: 4 };
      const elemSize = typeSizes[tag.type] || 1;
      const totalBytes = elemSize * tag.count;

      let buf: ArrayBuffer;
      if (totalBytes <= 4) {
        // Value stored inline in the 4-byte valueOffset field
        buf = new ArrayBuffer(4);
        new DataView(buf).setUint32(0, tag.valueOffset, le);
      } else {
        buf = await readRange(tag.valueOffset, totalBytes);
      }

      const d = new DataView(buf);
      const values: number[] = [];
      for (let i = 0; i < tag.count; i++) {
        if (tag.type === 3) values.push(d.getUint16(i * 2, le));
        else if (tag.type === 4) values.push(d.getUint32(i * 4, le));
        else if (tag.type === 11) values.push(d.getFloat32(i * 4, le));
        else if (tag.type === 12) values.push(d.getFloat64(i * 8, le));
        else values.push(d.getUint8(i)); // BYTE or unknown
      }
      return values;
    };

    const { tags } = await readIFD(ifdOff);

    const imgW = (await readTagValues(tags.get(256)!))[0];
    const imgH = (await readTagValues(tags.get(257)!))[0];
    const tileW = tags.has(322) ? (await readTagValues(tags.get(322)!))[0] : 512;
    const tileH = tags.has(323) ? (await readTagValues(tags.get(323)!))[0] : 512;
    const bitsPerSample = (await readTagValues(tags.get(258)!))[0];
    const compression = tags.has(259) ? (await readTagValues(tags.get(259)!))[0] : 1;

    const predictor = tags.has(317) ? (await readTagValues(tags.get(317)!))[0] : 1;

    const tileOffsetsV = await readTagValues(tags.get(324)!);
    const tileByteCountsV = await readTagValues(tags.get(325)!);

    // Read georeferencing
    let tieX = 0, tieY = 0, scaleX = 10, scaleY = -10;
    if (tags.has(33922)) {
      const tieValues = await readTagValues(tags.get(33922)!);
      if (tieValues.length >= 6) {
        tieX = tieValues[3];
        tieY = tieValues[4];
      }
    }
    if (tags.has(33550)) {
      const scaleValues = await readTagValues(tags.get(33550)!);
      if (scaleValues.length >= 2) {
        scaleX = scaleValues[0];
        scaleY = scaleValues[1];
      }
    }

    // Compute target pixel coordinates in the full image
    // GeoTIFF convention: scaleY is negative for north-up images
    // (TIFF Y increases downward, northing increases upward).
    // Earth Search COGs store scaleY as positive — negate for correct coords.
    if (scaleX === 0) scaleX = 10;
    if (scaleY >= 0) scaleY = -Math.abs(scaleY);
    const centerPX = Math.round((targetEasting - tieX) / scaleX);
    const centerPY = Math.round((targetNorthing - tieY) / scaleY);

    const x0 = Math.max(0, Math.min(centerPX - halfSize, imgW - outSize));
    const y0 = Math.max(0, Math.min(centerPY - halfSize, imgH - outSize));

    const tilesX = Math.ceil(imgW / tileW);
    const tileStartX = Math.floor(x0 / tileW);
    const tileStartY = Math.floor(y0 / tileH);
    const tileEndX = Math.floor((x0 + outSize - 1) / tileW);
    const tileEndY = Math.floor((y0 + outSize - 1) / tileH);

    const result = new Float32Array(outSize * outSize);

    for (let ty = tileStartY; ty <= tileEndY; ty++) {
      for (let tx = tileStartX; tx <= tileEndX; tx++) {
        const tileIdx = ty * tilesX + tx;
        if (tileIdx >= tileOffsetsV.length) continue;

        const tOff = tileOffsetsV[tileIdx];
        const tLen = tileByteCountsV[tileIdx];

        const tileBuf = await readRange(tOff, tLen);
        let tileData: Buffer;

        if (compression === 8) {
          const zlib = await import('zlib');
          // Try standard zlib (with header) first; fall back to raw
          try {
            tileData = zlib.inflateSync(Buffer.from(tileBuf));
          } catch {
            tileData = zlib.inflateRawSync(Buffer.from(tileBuf));
          }
        } else if (compression === 1 || compression === 5) {
          tileData = Buffer.from(tileBuf);
        } else {
          throw new Error(`Unsupported COG compression: ${compression}`);
        }

        // Undo horizontal differencing (Predictor=2) if present
        if (predictor === 2 && bitsPerSample === 16) {
          for (let row = 0; row < tileH; row++) {
            const rowStart = row * tileW;
            let prev = tileData.readUInt16LE(rowStart * 2);
            for (let col = 1; col < tileW; col++) {
              const idx = rowStart + col;
              const delta = tileData.readInt16LE(idx * 2);
              const val = prev + delta;
              prev = val;
              tileData.writeUInt16LE(val, idx * 2);
            }
          }
        }

        // Copy pixels from this tile to the output
        for (let row = 0; row < tileH; row++) {
          for (let col = 0; col < tileW; col++) {
            const imgX = tx * tileW + col;
            const imgY = ty * tileH + row;
            if (imgX < x0 || imgX >= x0 + outSize || imgY < y0 || imgY >= y0 + outSize) continue;

            const tilePixelIdx = (row * tileW + col);
            let pixelVal = 0;
            if (bitsPerSample <= 8) {
              pixelVal = tileData[tilePixelIdx];
            } else {
              pixelVal = tileData.readUInt16LE(tilePixelIdx * 2);
            }

            const outX = imgX - x0;
            const outY = imgY - y0;
            result[outY * outSize + outX] = pixelVal;
          }
        }
      }
    }

    return result;
  }

  private normalizeBands(bands: Float32Array): Float32Array {
    const normalized = new Float32Array(bands.length);
    const pixelsPerBand = 224 * 224;
    for (let b = 0; b < 6; b++) {
      const mean = HLS_BAND_MEANS[b];
      const std = HLS_BAND_STDS[b];
      for (let i = 0; i < pixelsPerBand; i++) {
        normalized[b * pixelsPerBand + i] = (bands[b * pixelsPerBand + i] - mean) / std;
      }
    }
    return normalized;
  }

  private classifySpectral(bands: Float32Array): {
    classLabel: string;
    probabilities: Record<string, number>;
  } {
    // Compute mean reflectance per band from the 224x224 area
    // Band order: [coastal(B01), blue(B02), green(B03), red(B04), nir(B08), swir1(B11)]
    const numPixels = 224 * 224;
    const means = [0, 0, 0, 0, 0, 0];
    for (let b = 0; b < 6; b++) {
      let sum = 0;
      for (let p = 0; p < numPixels; p++) {
        sum += bands[b * numPixels + p];
      }
      means[b] = sum / numPixels;
    }

    const [coastal, blue, green, red, nir, swir1] = means;

    // Spectral indices (using reflectance scaled 0-10000)
    const ndvi = (nir - red) / (nir + red + 0.001);
    const ndwi = (green - nir) / (green + nir + 0.001);
    const ndbi = (swir1 - nir) / (swir1 + nir + 0.001);
    const brightness = (coastal + blue + green + red + nir + swir1) / 60000;
    const bandSpread = Math.max(...means) - Math.min(...means);

    // Log spectral info for debugging
    logger.info({ means: means.map(v => Math.round(v)), ndvi: Math.round(ndvi * 1000) / 1000, brightness: Math.round(brightness * 1000) / 1000, spread: Math.round(bandSpread) }, 'Spectral signature');

    const scores: Record<string, number> = {};

    // Clouds: extremely bright in ALL bands, uniform spectrum (low band spread), negative to low NDVI
    if (brightness > 0.55 && ndvi < 0.15 && bandSpread < 3000) {
      scores['clouds'] = Math.min(0.95, (brightness - 0.45) * 2);
    }

    // Snow/Ice: very bright across all bands, NDVI near zero or negative
    if (brightness > 0.3 && ndvi < 0.08 && bandSpread < 2000) {
      scores['snow_ice'] = Math.min(0.85, (brightness - 0.25) * 2);
    }

    // Water: positive NDWI, low NIR, low SWIR
    if (ndwi > 0.05 && nir < 2000 && swir1 < 2000) {
      scores['water'] = Math.min(0.9, ndwi * 3);
    }

    // Trees: high NDVI, high NIR significantly higher than red
    if (ndvi > 0.45) {
      scores['trees'] = Math.min(0.9, (ndvi - 0.35) * 2);
    }

    // Grass: moderate NDVI
    if (ndvi > 0.2 && ndvi <= 0.5) {
      scores['grass'] = Math.min(0.7, (ndvi - 0.15) * 2);
    }

    // Crops: moderate NDVI with higher SWIR (soil exposure)
    if (ndvi > 0.25 && ndvi <= 0.55 && swir1 > 2500) {
      scores['crops'] = Math.min(0.65, (ndvi - 0.2) * 1.5);
    }

    // Flooded vegetation: moderate NDVI with water influence
    if (ndvi > 0.1 && ndvi < 0.45 && ndwi > -0.15) {
      scores['flooded_vegetation'] = Math.min(0.6, ndvi * 0.5 + (ndwi + 0.15) * 2);
    }

    // Built area: high NDBI, moderate brightness, low NDVI
    if (ndbi > 0.05 && ndvi < 0.35) {
      scores['built_area'] = Math.min(0.85, ndbi * 2.5);
    }
    // Mixed urban: NIR ≈ SWIR1, red ≥ green, low-moderate NDVI
    const nirSwirRatio = (nir + 1) / (swir1 + 1);
    if (ndbi > -0.02 && ndvi < 0.35 && red >= green && nirSwirRatio < 1.15 && nirSwirRatio > 0.85) {
      const urbanScore = Math.min(0.6, Math.max(0, 0.3 - ndvi * 0.5) + Math.max(0, ndbi + 0.02) * 3);
      scores['built_area'] = Math.max(scores['built_area'] || 0, urbanScore);
    }

    // Bare ground: moderate brightness, low NDVI, moderate band spread
    if (ndvi < 0.2 && brightness > 0.15 && bandSpread > 1000) {
      scores['bare_ground'] = Math.min(0.6, (brightness - 0.1) * 1.5);
    }

    // Find the highest scoring class
    let bestScore = 0;
    let bestLabel = 'bare_ground';
    for (const [cls, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestLabel = cls;
      }
    }

    // Build probabilities: boost the selected class, spread remainder
    const probs: Record<string, number> = {};
    const otherClasses = LAND_COVER_CLASSES.filter(c => c !== bestLabel);
    for (const cls of otherClasses) probs[cls] = Math.max(0.01, 1 - bestScore) / otherClasses.length;
    probs[bestLabel] = bestScore;

    return { classLabel: bestLabel, probabilities: probs };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  private loadReferenceCentroids(): void {
    const db = getDb();
    try {
      const rows = db.prepare(
        'SELECT class_label, embedding FROM prithvi_embeddings GROUP BY class_label HAVING COUNT(*) > 2',
      ).all() as Array<{ class_label: string; embedding: string }>;

      const groups: Record<string, number[][]> = {};
      for (const row of rows) {
        if (!groups[row.class_label]) groups[row.class_label] = [];
        groups[row.class_label].push(JSON.parse(row.embedding) as number[]);
      }

      for (const [cls, embs] of Object.entries(groups)) {
        if (embs.length === 0) continue;
        const centroid = new Array(embs[0].length).fill(0);
        for (const emb of embs) {
          for (let i = 0; i < emb.length; i++) centroid[i] += emb[i];
        }
        for (let i = 0; i < centroid.length; i++) centroid[i] /= embs.length;
        REFERENCE_CENTROIDS[cls] = centroid;
      }

      logger.info({ classes: Object.keys(groups).length, total: rows.length }, 'Reference centroids loaded');
    } catch { /* skip */ }
  }

  private loadCachedEmbeddings(): void {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT lat, lon, embedding, class_label, fetched_at FROM prithvi_embeddings ORDER BY fetched_at DESC LIMIT 5000',
      ).all() as Array<{ lat: number; lon: number; embedding: string; class_label: string; fetched_at: string }>;
      for (const row of rows) {
        this.embeddingCache.set(this.cacheKey(row.lat, row.lon), {
          lat: row.lat,
          lon: row.lon,
          embedding: row.embedding,
          classLabel: row.class_label || 'unknown',
          fetchedAt: row.fetched_at,
        });
      }
      logger.info({ count: rows.length }, 'Cached embeddings loaded');
    } catch { /* skip */ }
  }

  private cacheEmbedding(key: string, lat: number, lon: number, embedding: Float32Array, classLabel: string): void {
    try {
      const db = getDb();
      db.prepare(
        "INSERT OR REPLACE INTO prithvi_embeddings (lat, lon, embedding, class_label, fetched_at) VALUES (?, ?, ?, ?, datetime('now'))",
      ).run(lat, lon, JSON.stringify(Array.from(embedding)), classLabel);
      this.embeddingCache.set(key, {
        lat, lon, embedding: JSON.stringify(Array.from(embedding)), classLabel,
        fetchedAt: new Date().toISOString(),
      });
    } catch { /* skip */ }
  }

  private cacheKey(lat: number, lon: number): string {
    return `${lat.toFixed(4)},${lon.toFixed(4)}`;
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS prithvi_embeddings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          embedding TEXT NOT NULL,
          class_label TEXT NOT NULL DEFAULT 'unknown',
          fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_prithvi_embeddings_loc ON prithvi_embeddings(lat, lon);
        CREATE INDEX IF NOT EXISTS idx_prithvi_embeddings_class ON prithvi_embeddings(class_label);
        CREATE INDEX IF NOT EXISTS idx_prithvi_embeddings_fetched ON prithvi_embeddings(fetched_at DESC);
        CREATE TABLE IF NOT EXISTS prithvi_scenes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          scene_json TEXT NOT NULL,
          fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch { /* skip */ }
  }
}

export const prithviEngine = new PrithviEngine();
