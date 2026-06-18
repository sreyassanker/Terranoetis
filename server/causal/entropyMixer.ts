import { pubsub } from '../pubsub';
import type { EntropyReading } from './types';

export class EntropyMixer {
  private domainAutoencoders: Map<string, { lastError: number; window: number[] }>;
  private metaEncoder: { anomalyScores: number[] };
  private lastReading: EntropyReading | null = null;
  private broadcastInterval: NodeJS.Timeout | null = null;
  private unsubs: Array<() => void> = [];
  private readonly DOMAINS = ['seismic', 'ocean', 'aviation', 'weather', 'satellite', 'hazard', 'geospatial'];

  constructor() {
    this.domainAutoencoders = new Map();
    this.metaEncoder = { anomalyScores: [] };
    for (const d of this.DOMAINS) {
      this.domainAutoencoders.set(d, { lastError: 0, window: [] });
    }
  }

  start(): void {
    for (const domain of this.DOMAINS) {
      const unsub = pubsub.subscribe(`anomaly:${domain}`, (data: any) => {
        this.feedDomain(domain, data.score || data.anomaly || 0);
      });
      this.unsubs.push(unsub);
    }

    this.broadcastInterval = setInterval(() => this.computeAndBroadcast(), 60000);
    console.log('[ENTROPY] Mixer started — broadcasting every 60s');
  }

  stop(): void {
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
  }

  private feedDomain(domain: string, score: number): void {
    const encoder = this.domainAutoencoders.get(domain);
    if (!encoder) return;
    encoder.window.push(score);
    if (encoder.window.length > 360) encoder.window.shift();
    const mean = encoder.window.reduce((a, b) => a + b, 0) / encoder.window.length;
    encoder.lastError = Math.abs(score - mean);
  }

  private computeAndBroadcast(): void {
    const domainScores: Record<string, number> = {};
    let totalError = 0;

    for (const [domain, encoder] of this.domainAutoencoders) {
      const normalized = 1 / (1 + Math.exp(-encoder.lastError * 2));
      domainScores[domain] = normalized;
      totalError += normalized;
    }

    const planetaryEntropy = Math.min(1.0, totalError / this.DOMAINS.length);
    const interpretation = this.interpretEntropy(planetaryEntropy);

    const reading: EntropyReading = {
      timestamp: Date.now(),
      domainScores,
      planetaryEntropy,
      interpretation,
    };

    this.lastReading = reading;

    pubsub.publish('entropy:reading', reading);
    pubsub.publish('ws:all', { type: 'ENTROPY_UPDATE', ...reading });

    console.log(`[ENTROPY] Planetary entropy: ${(planetaryEntropy * 100).toFixed(1)}% — ${interpretation.toUpperCase()}`);
  }

  private interpretEntropy(score: number): EntropyReading['interpretation'] {
    if (score < 0.3) return 'baseline';
    if (score < 0.6) return 'restless';
    if (score < 0.9) return 'critical';
    return 'catastrophic';
  }

  getLastReading(): EntropyReading | null { return this.lastReading; }
}
