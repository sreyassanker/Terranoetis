import { getDb } from '../db/index';
import { EmbeddingEngine } from '../embedding';
import { logger } from '../observability/logger';
import { sensoryBuffer, type PerceptualEvent } from './sensoryBuffer';
import { workingMemory, type WorkingMemoryContext } from './workingMemory';
import { EpisodicMemoryV2, type EpisodeV2 } from './episodicMemory-v2';
import { SemanticMemory, type InferenceResult } from './semanticMemory';
import { proceduralMemoryV2, type ProcedureTemplate, type ToolStep } from './proceduralMemory-v2';
import { predictiveMemory, type EnsembleResult } from './predictiveMemory';

// ── Types ───────────────────────────────────────────────────────

export interface RichContext {
  sensory: PerceptualEvent[];
  working: WorkingMemoryContext;
  episodes: EpisodeV2[];
  inferences: InferenceResult[];
  procedures: ProcedureTemplate[];
  prediction: EnsembleResult | null;
  summary: string;
}

export type MemoryTier = 'sensory' | 'working' | 'episodic' | 'semantic' | 'procedural' | 'predictive';

// ── MemoryManagerV2 ─────────────────────────────────────────────

export class MemoryManagerV2 {
  sensoryBuffer = sensoryBuffer;
  workingMemory = workingMemory;
  episodicMemory!: EpisodicMemoryV2;
  semanticMemory!: SemanticMemory;
  proceduralMemory = proceduralMemoryV2;
  predictiveMemory = predictiveMemory;
  private embedder: EmbeddingEngine | null = null;
  private initialized = false;

  constructor(embedder?: EmbeddingEngine) {
    if (embedder) this.setEmbedder(embedder);
  }

  setEmbedder(embedder: EmbeddingEngine): void {
    this.embedder = embedder;
    this.episodicMemory = new EpisodicMemoryV2(embedder);
    this.semanticMemory = new SemanticMemory(embedder);
  }

  init(): void {
    if (this.initialized) return;
    this.sensoryBuffer.init();
    this.workingMemory.init();
    this.episodicMemory?.init();
    this.semanticMemory?.init();
    this.proceduralMemory.init();
    this.predictiveMemory.init();
    this.migrateLegacyData();
    this.initialized = true;
    logger.info('MemoryManagerV2 initialized — all tiers active');
  }

  async store(tier: string, params: Record<string, unknown>): Promise<void> {
    if (tier === 'sensory') {
      await this.sensoryBuffer.push(params as unknown as PerceptualEvent);
      return;
    }
    if (tier === 'episodic' && this.episodicMemory) {
      await this.episodicMemory.add(params as unknown as Parameters<typeof this.episodicMemory.add>[0]);
      return;
    }
    // Full interaction store (legacy callers that don't pass a tier)
    const p = params as unknown as {
      userId: string; query: string; response: string; intentType: string;
      location?: { lat: number; lon: number; label?: string };
      layersToggled?: string[]; tokensUsed?: number; latencyMs?: number;
      modelTier?: string; outcome?: EpisodeV2['outcome'];
      emotionalValence?: number; toolChain?: ToolStep[];
    };
    if (!p?.query) return;

    await this.sensoryBuffer.push({
      type: 'user_query',
      source: 'user',
      data: p.query.slice(0, 500),
      importanceScore: p.query.length > 50 ? 0.7 : 0.4,
      metadata: { intentType: p.intentType, location: p.location?.label },
    });

    await this.workingMemory.addMessage('user', p.query);
    await this.workingMemory.addMessage('assistant', p.response);

    const epId = await this.episodicMemory.add({
      userId: p.userId,
      query: p.query,
      response: p.response,
      intentType: p.intentType,
      location: p.location,
      layersToggled: p.layersToggled ?? [],
      emotionalValence: p.emotionalValence ?? 0,
      outcome: p.outcome ?? 'unknown',
      tokensUsed: p.tokensUsed ?? 0,
      latencyMs: p.latencyMs ?? 0,
      modelTier: p.modelTier ?? 'unknown',
    });

    if (p.location) {
      await this.semanticMemory.addEntity(p.location.label || `${p.location.lat},${p.location.lon}`, 'city',
        { lat: p.location.lat, lon: p.location.lon });
    }

    if (p.toolChain && p.toolChain.length > 0) {
      this.proceduralMemory.record(p.toolChain, p.outcome === 'success', p.latencyMs ?? 0);
    }

    if (p.outcome && epId) {
      this.episodicMemory.updateOutcome(epId, p.outcome);
    }
    if (p.emotionalValence !== undefined && epId) {
      this.episodicMemory.updateValence(epId, p.emotionalValence);
    }
  }

  async retrieve(
    userId: string,
    query: string,
    options?: { tiers?: MemoryTier[]; limit?: number },
  ): Promise<RichContext> {
    const tiers = options?.tiers ?? ['sensory', 'working', 'episodic', 'semantic', 'procedural', 'predictive'];
    const limit = options?.limit ?? 5;

    const result: RichContext = {
      sensory: [],
      working: this.workingMemory.getContext(),
      episodes: [],
      inferences: [],
      procedures: [],
      prediction: null,
      summary: '',
    };

    if (tiers.includes('sensory')) {
      result.sensory = this.sensoryBuffer.topByImportance(limit);
    }

    if (tiers.includes('episodic')) {
      result.episodes = await this.episodicMemory.search(query, userId, { limit });
    }

    if (tiers.includes('semantic')) {
      result.inferences = await this.semanticMemory.query(query);
    }

    if (tiers.includes('procedural')) {
      result.procedures = this.proceduralMemory.find(query, limit);
    }

    if (tiers.includes('predictive')) {
      const hazardTypes = ['earthquake', 'tsunami', 'wildfire', 'hurricane', 'flood'];
      const lower = query.toLowerCase();
      const matched = hazardTypes.find(h => lower.includes(h));
      if (matched) {
        result.prediction = await this.predictiveMemory.predict(matched, { query });
      }
    }

    // Update working memory attention
    const wmContext = await this.workingMemory.computeAttention(query);
    result.working = wmContext;
    result.summary = await this.workingMemory.summarize();

    return result;
  }

  async buildContext(userId: string, query: string): Promise<string> {
    const context = await this.retrieve(userId, query);

    const parts: string[] = ['<cognitive_context>'];

    // Working memory summary
    if (context.working.summary) {
      parts.push(`  <current_context>${this.escapeXml(context.working.summary)}</current_context>`);
    }
    if (context.working.activeGoal) {
      parts.push(`  <active_goal>${this.escapeXml(context.working.activeGoal.content)}</active_goal>`);
    }

    // Recent messages
    if (context.working.recentMessages.length > 0) {
      parts.push('  <recent_conversation>');
      for (const msg of context.working.recentMessages.slice(-4)) {
        parts.push(`    <message>${this.escapeXml(msg.content.slice(0, 200))}</message>`);
      }
      parts.push('  </recent_conversation>');
    }

    // Similar past episodes
    if (context.episodes.length > 0) {
      parts.push('  <similar_experiences>');
      for (const ep of context.episodes.slice(0, 3)) {
        parts.push(`    <episode intent="${ep.intentType}" outcome="${ep.outcome}">`);
        parts.push(`      <query>${this.escapeXml(ep.query)}</query>`);
        parts.push(`      <response>${this.escapeXml(ep.response.slice(0, 200))}</response>`);
        parts.push('    </episode>');
      }
      parts.push('  </similar_experiences>');
    }

    // Semantic inferences
    if (context.inferences.length > 0) {
      parts.push('  <inferences>');
      for (const inf of context.inferences.slice(0, 3)) {
        parts.push(`    <inference confidence="${inf.confidence.toFixed(2)}">${this.escapeXml(inf.conclusion)}</inference>`);
      }
      parts.push('  </inferences>');
    }

    // Procedures
    if (context.procedures.length > 0) {
      parts.push('  <procedures>');
      for (const proc of context.procedures.slice(0, 2)) {
        parts.push(`    <procedure rate="${proc.successRate.toFixed(2)}" uses="${proc.usageCount}">`);
        parts.push(`      <trigger>${this.escapeXml(proc.triggerCondition)}</trigger>`);
        parts.push(`      <steps>${this.escapeXml(proc.toolChain.join(' → '))}</steps>`);
        parts.push('    </procedure>');
      }
      parts.push('  </procedures>');
    }

    // Predictions
    if (context.prediction) {
      parts.push(`  <prediction confidence="${context.prediction.confidence.toFixed(2)}">`);
      parts.push(`    <probability>${(context.prediction.ensembleProbability * 100).toFixed(1)}%</probability>`);
      parts.push('  </prediction>');
    }

    parts.push('</cognitive_context>');

    return parts.join('\n');
  }

  async consolidate(): Promise<void> {
    const facts = await this.episodicMemory.consolidate(50);
    for (const fact of facts) {
      await this.semanticMemory.addEntity(fact, 'fact');
    }
    logger.info({ factsAdded: facts.length }, 'Consolidation cycle complete');
  }

  async predict(hazardType: string, features: Record<string, unknown>): Promise<EnsembleResult> {
    const result = await this.predictiveMemory.predict(hazardType, features);

    await this.sensoryBuffer.push({
      type: 'data_update',
      source: 'predictive_memory',
      data: `Prediction for ${hazardType}: ${(result.ensembleProbability * 100).toFixed(0)}%`,
      importanceScore: result.ensembleProbability > 0.6 ? 0.8 : 0.4,
    });

    return result;
  }

  getTrace(traceId: string): unknown {
    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT * FROM reasoning_traces WHERE trace_id = ?'
      ).get(traceId) as Record<string, unknown> | undefined;
      return row ?? null;
    } catch (e) {
      logger.error({ err: (e as Error).message, traceId }, 'Failed to get trace');
      return null;
    }
  }

  getTierStatus(): Record<MemoryTier, { active: boolean; itemCount: number }> {
    return {
      sensory: { active: true, itemCount: this.sensoryBuffer.count() },
      working: { active: true, itemCount: this.workingMemory.getContext().itemCount },
      episodic: { active: true, itemCount: this.episodicMemory.count() },
      semantic: { active: true, itemCount: 0 },
      procedural: { active: true, itemCount: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      predictive: { active: true, itemCount: (this.predictiveMemory as any).getActiveModels().length },
    };
  }

  shutdown(): void {
    this.sensoryBuffer.shutdown();
    this.episodicMemory.shutdown();
    this.predictiveMemory.shutdown();
  }

  private migrateLegacyData(): void {
    try {
      const db = getDb();

      // Migrate episodes → episodic_v2
      const episodeCount = db.prepare('SELECT COUNT(*) as cnt FROM episodes').get() as { cnt: number };
      const v2Count = db.prepare('SELECT COUNT(*) as cnt FROM episodic_v2').get() as { cnt: number };

      if (episodeCount.cnt > 0 && v2Count.cnt === 0) {
        const episodes = db.prepare('SELECT * FROM episodes').all() as Array<Record<string, unknown>>;
        const insert = db.prepare(`
          INSERT OR IGNORE INTO episodic_v2 (id, user_id, query, response, intent_type, tags_json,
            location_lat, location_lon, location_label, layers_toggled, tokens_used, latency_ms, model_tier, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const batch = db.transaction((items: Array<Record<string, unknown>>) => {
          for (const row of items) {
            const epId = `ep2_migrated_${row.episode_id as string}`;
            const tags = JSON.stringify([row.intent_type as string]);
            insert.run(
              epId, row.user_id, row.query, row.response, row.intent_type, tags,
              row.location_lat, row.location_lon, row.location_label,
              row.layers_toggled, row.tokens_used ?? 0, row.latency_ms ?? 0,
              row.model_tier ?? 'flash', row.created_at,
            );
          }
        });

        batch(episodes);
        logger.info({ migrated: episodes.length }, 'Legacy episodes migrated to episodic_v2');
      }

      // Migrate facts → semantic entities
      const factCount = db.prepare('SELECT COUNT(*) as cnt FROM facts').get() as { cnt: number };
      const semanticCount = db.prepare('SELECT COUNT(*) as cnt FROM semantic_entities').get() as { cnt: number };

      if (factCount.cnt > 0 && semanticCount.cnt === 0) {
        const facts = db.prepare('SELECT * FROM facts').all() as Array<Record<string, unknown>>;
        const insert = db.prepare(`
          INSERT OR IGNORE INTO semantic_entities (name, type, embedding, metadata_json)
          VALUES (?, 'fact', ?, ?)
        `);

        const batch = db.transaction((items: Array<Record<string, unknown>>) => {
          for (const row of items) {
            insert.run(
              (row.fact_text as string).slice(0, 500),
              row.embedding ?? null,
              JSON.stringify({ source: 'fact_migration', confidence: row.confidence, factId: row.id }),
            );
          }
        });

        batch(facts);
        logger.info({ migrated: facts.length }, 'Legacy facts migrated to semantic entities');
      }

      // Migrate procedural_patterns → procedural_v2
      const patternCount = db.prepare('SELECT COUNT(*) as cnt FROM procedural_patterns').get() as { cnt: number };
      const procV2Count = db.prepare('SELECT COUNT(*) as cnt FROM procedural_v2').get() as { cnt: number };

      if (patternCount.cnt > 0 && procV2Count.cnt === 0) {
        const patterns = db.prepare('SELECT * FROM procedural_patterns').all() as Array<Record<string, unknown>>;
        const insert = db.prepare(`
          INSERT OR IGNORE INTO procedural_v2 (trigger_condition, tool_chain_json, success_rate, usage_count, last_used, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        const batch = db.transaction((items: Array<Record<string, unknown>>) => {
          for (const row of items) {
            const chain = JSON.stringify([row.intent_type as string]);
            insert.run(
              row.intent_type as string,
              chain,
              (row.success_count as number) / Math.max((row.success_count as number), 1),
              row.success_count,
              row.last_used,
              row.created_at,
            );
          }
        });

        batch(patterns);
        logger.info({ migrated: patterns.length }, 'Legacy procedural patterns migrated to procedural_v2');
      }
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Legacy data migration failed');
    }
  }

  private escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
}

export const memoryManagerV2 = new MemoryManagerV2();
