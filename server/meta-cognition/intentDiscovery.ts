import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { omninet } from '../ai-router/omninet';
import { IntentRouter } from '../agent';

// ── Types ───────────────────────────────────────────────────────

export interface ProposedIntent {
  id: string;
  name: string;
  description: string;
  exampleQueries: string[];
  confidence: number;
  clusterSize: number;
  status: 'pending' | 'approved' | 'rejected';
  proposedAt: number;
  reviewedAt?: number;
}

export interface UnmatchedQuery {
  query: string;
  timestamp: number;
  userId: string;
  location?: string;
}

// ── IntentDiscovery ─────────────────────────────────────────────

export class IntentDiscovery {
  private unmatchedBuffer: UnmatchedQuery[] = [];
  private proposedIntents: Map<string, ProposedIntent> = new Map();
  private minClusterSize = 5;

  init(): void {
    this.loadProposed();
    logger.info('IntentDiscovery initialized');
  }

  /** Record a query that didn't match any existing intent */
  recordUnmatched(query: string, userId: string, location?: string): void {
    this.unmatchedBuffer.push({ query, timestamp: Date.now(), userId, location });
    if (this.unmatchedBuffer.length > 1000) this.unmatchedBuffer = this.unmatchedBuffer.slice(-500);

    // Store for persistence
    try {
      const db = getDb();
      db.prepare('INSERT INTO unmatched_queries (query, user_id, location) VALUES (?, ?, ?)')
        .run(query.slice(0, 500), userId, location || null);
    } catch { /* skip */ }
  }

  /** Cluster unmatched queries and propose new intents */
  async discover(): Promise<ProposedIntent[]> {
    const newProposals: ProposedIntent[] = [];

    // Load recent unmatched queries from DB
    let recent: UnmatchedQuery[] = [];
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT query, user_id, location FROM unmatched_queries ORDER BY created_at DESC LIMIT 200',
      ).all() as Array<{ query: string; user_id: string; location: string | null }>;
      recent = rows.map(r => ({
        query: r.query,
        timestamp: Date.now(),
        userId: r.user_id,
        location: r.location || undefined,
      }));
    } catch { recent = [...this.unmatchedBuffer]; }

    if (recent.length < this.minClusterSize) return [];

    // Use LLM to cluster queries
    try {
      const sampleQueries = recent.slice(0, 100).map(q => q.query);
      const result = await omninet.generateText(
        `Cluster these user queries into intent categories. Each cluster should contain similar queries that represent a distinct user need.

        Queries:
        ${sampleQueries.map((q, i) => `${i + 1}. "${q}"`).join('\n')}

        For each cluster, propose:
        1. A short intent name (snake_case)
        2. A description of what the user wants
        3. 2-3 representative example queries
        4. Estimated confidence (0-1)

        Return JSON: { "clusters": [{"name": "...", "description": "...", "examples": ["...", "..."], "confidence": 0.0, "size": 5}...] }
        Only return clusters with >= ${this.minClusterSize} similar queries.`,
        { temperature: 0.3, maxTokens: 1000 },
      );

      const cleaned = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.clusters && Array.isArray(parsed.clusters)) {
        for (const cluster of parsed.clusters) {
          const existingIntent = IntentRouter.classify(cluster.examples[0] || '');
          // Skip if existing intent already handles this well
          if (existingIntent.confidence > 0.7) continue;

          const name = (cluster.name as string).toLowerCase().replace(/[^a-z0-9_]/g, '_');
          if (this.proposedIntents.has(name)) continue;

          const proposal: ProposedIntent = {
            id: `intent_${name}_${Date.now()}`,
            name,
            description: cluster.description || '',
            exampleQueries: (cluster.examples as string[]) || [],
            confidence: Math.min(1, Math.max(0, cluster.confidence || 0.5)),
            clusterSize: cluster.size || cluster.examples?.length || 0,
            status: 'pending',
            proposedAt: Date.now(),
          };

          this.proposedIntents.set(name, proposal);
          this.saveProposal(proposal);
          newProposals.push(proposal);

          logger.info({ intentName: name, clusterSize: proposal.clusterSize }, 'New intent proposed');
        }
      }
    } catch (e) {
      logger.warn({ err: e }, 'Intent discovery LLM clustering failed');
    }

    return newProposals;
  }

  /** Approve a proposed intent — creates the intent and auto-generates supporting artifacts */
  async approve(intentName: string): Promise<{ toolChains: string[]; evalCriteria: string[] } | null> {
    const proposal = this.proposedIntents.get(intentName);
    if (!proposal) return null;

    proposal.status = 'approved';
    proposal.reviewedAt = Date.now();
    this.saveProposal(proposal);

    // Auto-generate artifacts
    const toolChains = await this.generateToolChains(proposal);
    const evalCriteria = await this.generateEvalCriteria(proposal);

    // Register intent in system
    try {
      const db = getDb();
      db.prepare('INSERT INTO custom_intents (name, description, example_queries_json, tool_chains_json, eval_criteria_json) VALUES (?, ?, ?, ?, ?)')
        .run(
          proposal.name,
          proposal.description,
          JSON.stringify(proposal.exampleQueries),
          JSON.stringify(toolChains),
          JSON.stringify(evalCriteria),
        );

      // Warm embedding for the new intent
      await IntentRouter.addCustomIntent(proposal.name, proposal.description, proposal.exampleQueries);
    } catch { /* skip */ }

    logger.info({ intentName }, 'Intent approved and registered');
    return { toolChains, evalCriteria };
  }

  /** Reject a proposed intent */
  reject(intentName: string): void {
    const proposal = this.proposedIntents.get(intentName);
    if (!proposal) return;
    proposal.status = 'rejected';
    proposal.reviewedAt = Date.now();
    this.saveProposal(proposal);
  }

  getProposed(): ProposedIntent[] {
    return Array.from(this.proposedIntents.values());
  }

  getPending(): ProposedIntent[] {
    return this.getProposed().filter(p => p.status === 'pending');
  }

  // ── Private ─────────────────────────────────────────────────

  private async generateToolChains(proposal: ProposedIntent): Promise<string[]> {
    try {
      const result = await omninet.generateText(
        `For the intent "${proposal.name}" (${proposal.description}), suggest tool chains.
        Available tools: earthquakes, weather_forecast, storms, wildfires, floods, aircraft, sandbox_python, sandbox_node
        
        Return JSON: { "toolChains": ["step1 → step2 → step3", ...] }`,
        { temperature: 0.3, maxTokens: 300 },
      );
      const cleaned = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return parsed.toolChains || [];
    } catch { return []; }
  }

  private async generateEvalCriteria(proposal: ProposedIntent): Promise<string[]> {
    try {
      const result = await omninet.generateText(
        `For the intent "${proposal.name}" (${proposal.description}), generate 3-5 evaluation criteria to measure response quality.
        Return as JSON array of strings.`,
        { temperature: 0.3, maxTokens: 200 },
      );
      const cleaned = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned) || [];
    } catch { return []; }
  }

  private saveProposal(proposal: ProposedIntent): void {
    try {
      const db = getDb();
      db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(`intent_proposal:${proposal.name}`, JSON.stringify(proposal));
    } catch { /* skip */ }
  }

  private loadProposed(): void {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT value FROM config WHERE key LIKE 'intent_proposal:%'").all() as Array<{ value: string }>;
      for (const row of rows) {
        try {
          const p: ProposedIntent = JSON.parse(row.value);
          this.proposedIntents.set(p.name, p);
        } catch { /* skip corrupt */ }
      }
    } catch { /* start empty */ }
  }
}

export const intentDiscovery = new IntentDiscovery();
