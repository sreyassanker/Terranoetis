import { pubsub } from '../pubsub';
import type { EntropyReading } from './types';

/**
 * EntropyMixer — aggregate planetary anomaly index.
 *
 * This is NOT an autoencoder / neural network. It tracks a rolling window of
 * per-domain anomaly scores published on the pubsub bus and computes a
 * normalized "restlessness" index from how far the latest score deviates from
 * that domain's recent mean. The name "planetary entropy" is product language
 * for this aggregate anomaly index, not a physics or information-theoretic
 * quantity. Kept as a plain windowed tracker on purpose: real autoencoders
 * would add no signal here without a trained model per domain.
 */
export class EntropyMixer {
  private domainTrackers: Map<string, { lastError: number; window: number[] }>;
  private metaTracker: { anomalyScores: number[] };
  private lastReading: EntropyReading | null = null;
  private broadcastInterval: NodeJS.Timeout | null = null;
  private unsubs: Array<() => void> = [];
  private readonly DOMAINS = ['seismic', 'ocean', 'aviation', 'weather', 'satellite', 'hazard', 'geospatial'];

  constructor() {
    this.domainTrackers = new Map();
    this.metaTracker = { anomalyScores: [] };
    for (const d of this.DOMAINS) {
      this.domainTrackers.set(d, { lastError: 0, window: [] });
    }
  }

  start(): void {
    for (const domain of this.DOMAINS) {
      const unsub = pubsub.subscribe(`anomaly:${domain}`, (data: unknown) => {
        this.feedDomain(domain, (data as Record<string, unknown>).score as number || (data as Record<string, unknown>).anomaly as number || 0);
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
    const tracker = this.domainTrackers.get(domain);
    if (!tracker) return;
    tracker.window.push(score);
    if (tracker.window.length > 360) tracker.window.shift();
    const mean = tracker.window.reduce((a, b) => a + b, 0) / tracker.window.length;
    tracker.lastError = Math.abs(score - mean);
  }

  private computeAndBroadcast(): void {
    const domainScores: Record<string, number> = {};
    let totalError = 0;

    for (const [domain, tracker] of this.domainTrackers) {
      const normalized = 1 / (1 + Math.exp(-tracker.lastError * 2));
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
