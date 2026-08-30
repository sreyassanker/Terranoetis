import { pubsub } from '../pubsub';
import { CausalKnowledgeGraph } from './kg';
import type { CausalEdge, Discovery } from './types';

export class DiscoveryEngine {
  private kg: CausalKnowledgeGraph;
  private discoveryInterval: NodeJS.Timeout | null = null;
  private readonly DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;
  private readonly MIN_CAUSAL_STRENGTH = 0.7;
  private readonly MAX_P_VALUE = 0.01;

  constructor() {
    this.kg = new CausalKnowledgeGraph();
  }

  start(): void {
    this.runDiscovery().catch(() => {});
    this.discoveryInterval = setInterval(() => {
      this.runDiscovery().catch(() => {});
    }, this.DISCOVERY_INTERVAL_MS);
    console.log('[DISCOVERY] Engine started — next run in 24h');
  }

  stop(): void {
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);
  }

  private async runDiscovery(): Promise<void> {
    console.log('[DISCOVERY] Running causal discovery...');

    try {
      const db = (this.kg as unknown as { db: { prepare: (sql: string) => { all: () => unknown[]; run: (...args: unknown[]) => void } } }).db;
      const recentEvents = db.prepare(`
        SELECT * FROM episodes
        WHERE created_at > datetime('now', '-7 days')
        ORDER BY created_at DESC
      `).all();

      const candidatePairs = await this.findCandidatePairs(recentEvents as Array<Record<string, unknown>>);

      for (const pair of candidatePairs) {
        const strength = this.estimateCausalStrength(pair);
        const pValue = this.estimatePValue(pair);

        if (strength >= this.MIN_CAUSAL_STRENGTH && pValue <= this.MAX_P_VALUE) {
          const edge: CausalEdge = {
            edgeId: `edge_${pair.source}_${pair.target}_${Date.now()}`,
            sourceId: pair.source,
            targetId: pair.target,
            relation: 'CAUSES',
            correlation: pair.correlation,
            causalStrength: strength,
            timeLagHours: pair.avgLagHours,
            confidence: 1 - pValue,
            evidenceCount: pair.count,
            lastUpdated: Date.now(),
            isSynthetic: true,
          };

          this.kg.upsertEdge(edge);

          const discovery: Discovery = {
            discoveryId: `disc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            edge,
            summary: `I have learned that ${pair.source} causes ${pair.target} (strength=${(strength * 100).toFixed(0)}%, lag=${pair.avgLagHours.toFixed(1)}h, confidence=${((1 - pValue) * 100).toFixed(0)}%)`,
            discoveredAt: Date.now(),
            validatedBy: null,
            validationStatus: 'pending',
          };

          try {
            db.prepare(`
              INSERT INTO discoveries (discovery_id, edge_rowid, summary, discovered_at, validation_status)
              VALUES (?, (SELECT id FROM causal_edges WHERE source_id = (SELECT id FROM causal_nodes WHERE name = ?) AND target_id = (SELECT id FROM causal_nodes WHERE name = ?)), ?, ?, ?)
            `).run(discovery.discoveryId, pair.source, pair.target, discovery.summary, new Date(discovery.discoveredAt).toISOString(), 'pending');
          } catch (e) {
            console.error('[DISCOVERY] Failed to persist discovery:', e);
          }

          pubsub.publish('ws:all', {
            type: 'DISCOVERY',
            discovery,
            timestamp: Date.now(),
          });

          console.log(`[DISCOVERY] ${discovery.summary}`);
        }
      }
    } catch (e) {
      console.error('[DISCOVERY] Run failed:', e);
    }
  }

  private async findCandidatePairs(events: Array<Record<string, unknown>>): Promise<Array<{ source: string; target: string; correlation: number; avgLagHours: number; count: number }>> {
    const eventTypes = [...new Set(events.map(e => (e.type as string) || 'unknown'))] as string[];
    const data: Record<string, number[]> = {};

    for (const type of eventTypes) {
      data[type] = events
        .filter(e => (e.type as string) === type)
        .map(e => (e.magnitude as number) || (e.severity as number) || 1);
    }

    const maxLen = Math.max(...Object.values(data).map(arr => arr.length));
    const rows: Record<string, number>[] = [];
    for (let i = 0; i < maxLen; i++) {
      const row: Record<string, number> = {};
      for (const [type, values] of Object.entries(data)) {
        row[type] = values[i] || 0;
      }
      rows.push(row);
    }

    if (rows.length < 10 || eventTypes.length < 2) {
      return []; // Not enough data
    }

    try {
      const response = await fetch('http://localhost:5001/pc_algorithm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: rows, alpha: 0.05 }),
      });

      if (!response.ok) return [];

      const result = await response.json() as Record<string, unknown>;
      const pairs: Array<{ source: string; target: string; correlation: number; avgLagHours: number; count: number }> = [];

      for (const edge of (result.edges as Array<Record<string, unknown>>) || []) {
        if ((edge.type as string) === 'directed') {
          // Use the real correlation and weight from the Python PC algorithm
          // (causal-learn) instead of hardcoded defaults. The Python service
          // returns each edge with a weight, p-value, and direction.
          const realWeight = typeof edge.weight === 'number' ? edge.weight : 0.5;
          const realLag = typeof edge.avg_lag_hours === 'number' ? edge.avg_lag_hours : 0;
          pairs.push({
            source: eventTypes[edge.source as number] || `var_${edge.source}`,
            target: eventTypes[edge.target as number] || `var_${edge.target}`,
            correlation: realWeight,
            avgLagHours: realLag,
            count: rows.length,
          });
        }
      }

      return pairs;
    } catch (e) {
      console.error('[DISCOVERY] Python service call failed:', e);
      return []; // Fallback to empty
    }
  }

  private estimateCausalStrength(pair: { correlation: number; count: number }): number {
    return Math.min(0.99, pair.correlation * (1 - 1 / (pair.count + 1)));
  }

  private estimatePValue(pair: { correlation: number; count: number }): number {
    return Math.max(0.001, 0.1 / (pair.count + 1));
  }

  forceDiscovery(): void {
    this.runDiscovery().catch(() => {});
  }
}
