import NodeCache from 'node-cache';
import { omninet } from './ai-router/omninet';

export class EmbeddingEngine {
  private cache: NodeCache;
  private embedQueue: Array<{ text: string; resolve: (v: Float32Array) => void; reject: (e: Error) => void }> = [];
  private processing = false;
  private activeCount = 0;
  private maxConcurrent: number;

  constructor(_apiKey?: string, maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
    this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
  }

  async embed(text: string): Promise<Float32Array> {
    if (!text) return new Float32Array(768);
    const cached = this.cache.get<Float32Array>(text);
    if (cached) return cached;
    return this.enqueueEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (const t of texts) {
      results.push(await this.embed(t));
    }
    return results;
  }

  private enqueueEmbed(text: string): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      this.embedQueue.push({ text, resolve, reject });
      if (!this.processing) this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    const drain = (): void => {
      while (this.embedQueue.length > 0 && this.activeCount < this.maxConcurrent) {
        const item = this.embedQueue.shift()!;
        this.activeCount++;
        this.embedOne(item).finally(() => {
          this.activeCount--;
          drain();
        });
      }
      if (this.activeCount === 0) {
        this.processing = false;
      }
    };
    drain();
  }

  private async embedOne(
    item: { text: string; resolve: (v: Float32Array) => void; reject: (e: Error) => void },
  ): Promise<void> {
    try {
      const result = await omninet.generateEmbedding(item.text);
      this.cache.set(item.text, result);
      item.resolve(result);
    } catch (e) {
      item.reject(e as Error);
    }
  }

  clearCache(): void {
    this.cache.flushAll();
  }

  getCacheSize(): number {
    return this.cache.keys().length;
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function embeddingToBuffer(emb: Float32Array): Buffer {
  return Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength);
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
