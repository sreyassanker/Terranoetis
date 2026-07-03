import { coordsToH3, getNeighbors } from './h3Index';
import { randomUUID } from 'crypto';

export interface StreamConfig {
  kafkaBrokers?: string[];
  groupId?: string;
  bufferSize?: number;
  flushIntervalMs?: number;
}

interface EnrichedEvent {
  id: string;
  h3: string;
  h3Res: number;
  neighbors: string[];
  geocode?: { city: string; country: string };
  kgCrossReferences?: Record<string, string[]>;
  original: unknown;
  timestamp: Date;
}

type EventCallback = (event: EnrichedEvent) => void;

export class H3StreamProcessor {
  private config: StreamConfig;
  private subscribers: Map<string, EventCallback[]> = new Map();
  private buffer: EnrichedEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: StreamConfig) {
    this.config = {
      bufferSize: 100,
      flushIntervalMs: 5000,
      ...config,
    };
    if ((this.config.flushIntervalMs ?? 0) > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
    }
  }

  async ingest(source: string, event: { lat?: number; lon?: number; [key: string]: unknown }): Promise<string> {
    const resolution = (event.h3Res as number) || 6;
    const h3 = (event.lat != null && event.lon != null)
      ? coordsToH3(event.lat as number, event.lon as number, resolution)
      : coordsToH3(0, 0, resolution);
    const enriched: EnrichedEvent = {
      id: randomUUID(),
      h3,
      h3Res: resolution,
      neighbors: getNeighbors(h3, 1),
      original: event,
      timestamp: new Date(),
      geocode: await this.reverseGeocode(h3),
      kgCrossReferences: await this.crossReferenceKG(h3, source),
    };
    this.buffer.push(enriched);
    this.notifySubscribers(h3, enriched);
    for (const n of enriched.neighbors) {
      this.notifySubscribers(n, enriched);
    }
    if (this.buffer.length >= (this.config.bufferSize || 100)) {
      await this.flush();
    }
    return h3;
  }

  subscribe(
    h3Index: string,
    callback: EventCallback,
  ): () => void {
    const existing = this.subscribers.get(h3Index) || [];
    existing.push(callback);
    this.subscribers.set(h3Index, existing);
    return () => {
      const updated = this.subscribers.get(h3Index)?.filter(cb => cb !== callback);
      if (updated && updated.length > 0) {
        this.subscribers.set(h3Index, updated);
      } else {
        this.subscribers.delete(h3Index);
      }
    };
  }

  subscribeRegion(
    h3Indices: string[],
    callback: EventCallback,
  ): () => void {
    const unsubs = h3Indices.map(h3 => this.subscribe(h3, callback));
    return () => unsubs.forEach(u => u());
  }

  async enrich(event: { lat?: number; lon?: number; [key: string]: unknown }): Promise<EnrichedEvent> {
    const resolution = (event.h3Res as number) || 6;
    const h3 = (event.lat != null && event.lon != null)
      ? coordsToH3(event.lat as number, event.lon as number, resolution)
      : coordsToH3(0, 0, resolution);
    return {
      id: randomUUID(),
      h3,
      h3Res: resolution,
      neighbors: getNeighbors(h3, 1),
      original: event,
      timestamp: new Date(),
      geocode: await this.reverseGeocode(h3),
      kgCrossReferences: await this.crossReferenceKG(h3, 'enrich'),
    };
  }

  private notifySubscribers(h3: string, event: EnrichedEvent): void {
    const subs = this.subscribers.get(h3);
    if (subs) {
      for (const cb of subs) {
        try { cb(event); } catch { /* subscriber error */ }
      }
    }
  }

  private async reverseGeocode(h3: string): Promise<{ city: string; country: string } | undefined> {
    return { city: 'h3-' + h3.slice(0, 5), country: 'Earth' };
  }

  private async crossReferenceKG(
    h3: string,
    source: string,
  ): Promise<Record<string, string[]>> {
    return {
      sources: [source],
      relatedH3: getNeighbors(h3, 1),
    };
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    console.log(`[H3StreamProcessor] flushed ${batch.length} events`);
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.subscribers.clear();
    this.buffer = [];
  }
}
