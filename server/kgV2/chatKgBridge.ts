import { logger } from '../observability/logger';
import { evolvingGraph } from './evolvingGraph';

/**
 * Audit M1 — wires the temporal knowledge graph (kgV2) into the LIVE chat
 * path. Before this, kgV2 was initialized at boot but only reachable via raw
 * /api/kgV2/* endpoints; chat wrote two flat entities (location + intent) to
 * the V1 graph and read nothing.
 *
 * Write-through: every located chat interaction records
 *   place --queried--> dataset            (per tool used)
 *   place --forecast-risk--> hazard       (per ensemble forecast, boosted)
 *   place --analyzed--> intent            (coarse activity signal)
 * using evolvingGraph.addEdgeWithBoost, so edges DECAY over time (72h
 * time-constant) — recency is first-class, which is the whole point of the
 * temporal KG.
 *
 * Read-through: recallFor(place) returns a compact block of the strongest
 * known relations, injected into the agent prompt so the model can say
 * "you analyzed CO2 here last week" — cross-session, time-aware memory.
 */

interface KGLike {
  ensureEntity(name: string, type: string, metadata?: Record<string, unknown>): Promise<number>;
  getRelations(entityName: string): Array<{ source: string; target: string; relationType: string; weight: number }>;
}

export class ChatKgBridge {
  private kg: KGLike;
  constructor(kg: KGLike) { this.kg = kg; }

  /** Fire-and-forget write-through after a chat interaction completes. */
  async recordInteraction(params: {
    place?: { label: string; lat: number; lon: number };
    intentType: string;
    toolsUsed: string[];
    forecastHazards?: string[];
  }): Promise<void> {
    try {
      const { place, intentType, toolsUsed, forecastHazards } = params;
      if (!place?.label) return;
      await this.kg.ensureEntity(place.label, 'location', { lat: place.lat, lon: place.lon });
      await this.kg.ensureEntity(intentType, 'intent');
      evolvingGraph.addEdgeWithBoost(place.label, intentType, 'analyzed');
      for (const tool of toolsUsed.slice(0, 8)) {
        await this.kg.ensureEntity(tool, 'dataset');
        evolvingGraph.addEdgeWithBoost(place.label, tool, 'queried');
      }
      for (const hz of (forecastHazards || []).slice(0, 4)) {
        await this.kg.ensureEntity(hz, 'hazard');
        evolvingGraph.addEdgeWithBoost(place.label, hz, 'forecast-risk');
      }
    } catch (e) {
      logger.warn({ err: e }, 'ChatKgBridge.recordInteraction failed (non-critical)');
    }
  }

  /** Compact temporal-KG recall for a place. Returns '' when nothing known. */
  recallFor(placeLabel?: string): string {
    if (!placeLabel) return '';
    try {
      const rels = this.kg.getRelations(placeLabel);
      if (rels.length === 0) return '';
      // Strongest first; cap the block so it can never blow the prompt budget.
      const top = rels.slice(0, 10);
      const lines = top.map(r => {
        const other = r.source === placeLabel ? r.target : r.source;
        const dir = r.source === placeLabel ? '→' : '←';
        return `  ${dir} ${r.relationType} ${other} (strength ${Number(r.weight).toFixed(1)})`;
      });
      return `\n[Temporal knowledge graph — what is known about ${placeLabel} (edges decay over ~72h, so high strength = recent activity)]\n${lines.join('\n')}\n`;
    } catch (e) {
      logger.warn({ err: e }, 'ChatKgBridge.recallFor failed');
      return '';
    }
  }
}
