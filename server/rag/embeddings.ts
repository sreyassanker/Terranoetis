import { memory_search, memory_store, memory_delete } from './memoryBridge';

export const embeddings = {
  async generate(text: string): Promise<number[]> {
    try {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(text.slice(0, 1000));
      const hash = new Float32Array(32);
      for (let i = 0; i < bytes.length && i < 32; i++) {
        hash[i] = bytes[i] / 255;
      }
      for (let i = bytes.length; i < 32; i++) {
        hash[i] = Math.sin(i * 0.1) * 0.5;
      }
      return Array.from(hash);
    } catch {
      return new Array(32).fill(0);
    }
  },

  async search(
    query: string,
    topK: number = 5,
    _threshold: number = 0.5,
    namespace: string = 'default',
  ): Promise<Array<{ key: string; score: number; text?: string; metadata?: Record<string, unknown> }>> {
    try {
      const results = await memory_search(query, topK, namespace);
      return results.map(r => ({
        key: r.key,
        score: r.score || 0,
        text: r.text,
        metadata: r.metadata,
      }));
    } catch {
      return [];
    }
  },

  async store({ key, value, namespace }: {
    key: string;
    value: string;
    namespace: string;
    vector?: number[];
  }): Promise<void> {
    try {
      await memory_store(key, value, namespace);
    } catch {
      // ignore
    }
  },

  async delete(key: string, namespace: string = 'default'): Promise<void> {
    try {
      await memory_delete(key, namespace);
    } catch {
      // ignore
    }
  },
};