interface DriftReport {
  intent: string;
  currentAccuracy: number;
  baselineAccuracy: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface MetricRecord {
  intent: string;
  latency: number;
  accuracy: number;
  timestamp: Date;
}

export class PerfMonitor {
  private baseline: Map<string, { accuracy: number; samples: number }> = new Map();
  private recent: Map<string, MetricRecord[]> = new Map();
  private windowSize: number = 100;
  private driftThreshold: number = 0.1;

  constructor() {}

  track(intent: string, latency: number, accuracy: number): void {
    const record: MetricRecord = { intent, latency, accuracy, timestamp: new Date() };
    const existing = this.recent.get(intent) || [];
    existing.push(record);
    if (existing.length > this.windowSize) existing.shift();
    this.recent.set(intent, existing);

    if (!this.baseline.has(intent)) {
      this.baseline.set(intent, { accuracy, samples: 1 });
    } else {
      const base = this.baseline.get(intent)!;
      const newSamples = base.samples + 1;
      base.accuracy = (base.accuracy * base.samples + accuracy) / newSamples;
      base.samples = newSamples;
    }
  }

  detectDrift(): DriftReport[] {
    const reports: DriftReport[] = [];
    for (const [intent, records] of this.recent.entries()) {
      if (records.length < 10) continue;
      const baselineAcc = this.baseline.get(intent)?.accuracy || 0;
      const recentAcc = records.reduce((s, r) => s + r.accuracy, 0) / records.length;
      const diff = baselineAcc - recentAcc;
      if (diff > this.driftThreshold) {
        const severity = diff > 0.3 ? 'critical' : diff > 0.2 ? 'high' : diff > 0.15 ? 'medium' : 'low';
        reports.push({
          intent,
          currentAccuracy: recentAcc,
          baselineAccuracy: baselineAcc,
          severity: severity as DriftReport['severity'],
        });
      }
    }
    return reports;
  }

  async triggerAutoFix(drift: DriftReport): Promise<void> {
    console.log(`[PerfMonitor] auto-fix triggered for ${drift.intent}: accuracy drop ${drift.baselineAccuracy} -> ${drift.currentAccuracy}`);
  }

  getLatencyPercentiles(intent: string): { p50: number; p95: number; p99: number } {
    const records = this.recent.get(intent) || [];
    const latencies = records.map(r => r.latency).sort((a, b) => a - b);
    if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0 };
    return {
      p50: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      p99: latencies[Math.floor(latencies.length * 0.99)],
    };
  }

  getAccuracyTrend(intent: string): { current: number; baseline: number; change: number } {
    const records = this.recent.get(intent) || [];
    const current = records.length > 0
      ? records.reduce((s, r) => s + r.accuracy, 0) / records.length
      : 0;
    const base = this.baseline.get(intent)?.accuracy || 0;
    return { current, baseline: base, change: current - base };
  }

  getAverageLatency(intent: string): number {
    const records = this.recent.get(intent) || [];
    if (records.length === 0) return 0;
    return records.reduce((s, r) => s + r.latency, 0) / records.length;
  }

  getTotalRequests(): number {
    let total = 0;
    for (const records of this.recent.values()) {
      total += records.length;
    }
    return total;
  }

  getIntents(): string[] {
    return Array.from(this.recent.keys());
  }

  setDriftThreshold(threshold: number): void {
    this.driftThreshold = threshold;
  }

  getLatencyHeatmap(): Map<string, { min: number; max: number; avg: number; p95: number }> {
    const heatmap = new Map<string, { min: number; max: number; avg: number; p95: number }>();
    for (const [intent, records] of this.recent.entries()) {
      const latencies = records.map(r => r.latency).sort((a, b) => a - b);
      if (latencies.length === 0) continue;
      heatmap.set(intent, {
        min: latencies[0],
        max: latencies[latencies.length - 1],
        avg: latencies.reduce((s, v) => s + v, 0) / latencies.length,
        p95: latencies[Math.floor(latencies.length * 0.95)],
      });
    }
    return heatmap;
  }

  detectAnomalies(intent: string): Array<{ timestamp: Date; latency: number; zScore: number }> {
    const records = this.recent.get(intent) || [];
    if (records.length < 5) return [];
    const latencies = records.map(r => r.latency);
    const mean = latencies.reduce((s, v) => s + v, 0) / latencies.length;
    const std = Math.sqrt(latencies.reduce((s, v) => s + (v - mean) ** 2, 0) / latencies.length);
    const anomalies: Array<{ timestamp: Date; latency: number; zScore: number }> = [];
    for (const r of records) {
      const z = std > 0 ? (r.latency - mean) / std : 0;
      if (Math.abs(z) > 3) anomalies.push({ timestamp: r.timestamp, latency: r.latency, zScore: z });
    }
    return anomalies;
  }

  getSystemHealth(): { status: 'healthy' | 'degraded' | 'critical'; issues: string[] } {
    const drifts = this.detectDrift();
    const criticalDrifts = drifts.filter(d => d.severity === 'critical');
    const highDrifts = drifts.filter(d => d.severity === 'high');
    if (criticalDrifts.length > 0) {
      return { status: 'critical', issues: criticalDrifts.map(d => `${d.intent}: accuracy ${d.currentAccuracy}`) };
    }
    if (highDrifts.length > 0) {
      return { status: 'degraded', issues: highDrifts.map(d => `${d.intent}: accuracy ${d.currentAccuracy}`) };
    }
    return { status: 'healthy', issues: [] };
  }

  async autoHeal(intent: string): Promise<{ action: string; result: string }> {
    const drift = this.detectDrift().find(d => d.intent === intent);
    if (!drift) return { action: 'none', result: 'No drift detected' };
    await this.triggerAutoFix(drift);
    return { action: 'autoFix', result: `Triggered fix for ${intent}: ${drift.currentAccuracy} -> ${drift.baselineAccuracy}` };
  }
}
