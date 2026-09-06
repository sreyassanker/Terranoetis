import crypto from 'crypto';
import { getDb } from '../db/index';
import { logger } from '../observability/logger';

export interface EvidenceLink {
  claim: string;
  confidence: number;
  sources: EvidenceSource[];
  hash: string;
  previousHash: string;
  timestamp: number;
}

export interface EvidenceSource {
  sourceType: 'api_call' | 'tool_execution' | 'database_query' | 'llm_inference' | 'user_input' | 'sensor';
  sourceName: string;
  endpoint?: string;
  requestParams?: Record<string, unknown>;
  rawResponse?: unknown;
  parsedValue?: unknown;
  responseTimeMs?: number;
  httpStatus?: number;
}

export class EvidenceChain {
  private chains = new Map<string, EvidenceLink[]>();
  private maxChains = 500;

  init(): void {
    this.ensureTables();
    logger.info('EvidenceChain initialized');
  }

  /** Create a new evidence chain for an interaction */
  createChain(interactionId: string): void {
    if (!this.chains.has(interactionId)) {
      this.chains.set(interactionId, []);
    }
  }

  /** Add an evidence link (claim + sources) to the chain */
  addLink(interactionId: string, claim: string, sources: EvidenceSource[], confidence: number): EvidenceLink {
    if (!this.chains.has(interactionId)) {
      this.createChain(interactionId);
    }

    const chain = this.chains.get(interactionId)!;
    const previousHash = chain.length > 0 ? chain[chain.length - 1].hash : '0'.repeat(64);

    const link: EvidenceLink = {
      claim,
      confidence,
      sources,
      hash: this.computeHash(claim, sources, previousHash),
      previousHash,
      timestamp: Date.now(),
    };

    chain.push(link);
    this.persistChain(interactionId, chain);

    // Trim if over limit
    if (this.chains.size > this.maxChains) {
      const oldest = [...this.chains.keys()].sort()[0];
      if (oldest) this.chains.delete(oldest);
    }

    return link;
  }

  /** Verify chain integrity — detect tampering */
  verifyChain(interactionId: string): { valid: boolean; brokenLinks: number[]; tamperedClaims: string[] } {
    const chain = this.getChain(interactionId);
    if (!chain || chain.length === 0) {
      return { valid: true, brokenLinks: [], tamperedClaims: [] };
    }

    const brokenLinks: number[] = [];
    const tamperedClaims: string[] = [];

    for (let i = 0; i < chain.length; i++) {
      const link = chain[i];
      const expectedPreviousHash = i === 0 ? '0'.repeat(64) : chain[i - 1].hash;

      // Check chain continuity
      if (link.previousHash !== expectedPreviousHash) {
        brokenLinks.push(i);
        tamperedClaims.push(link.claim);
        continue;
      }

      // Recompute hash and compare
      const expectedHash = this.computeHash(link.claim, link.sources, link.previousHash);
      if (link.hash !== expectedHash) {
        brokenLinks.push(i);
        tamperedClaims.push(link.claim);
      }
    }

    return {
      valid: brokenLinks.length === 0,
      brokenLinks,
      tamperedClaims,
    };
  }

  /** Get full evidence chain for an interaction */
  getChain(interactionId: string): EvidenceLink[] | null {
    if (this.chains.has(interactionId)) {
      return this.chains.get(interactionId)!;
    }
    return this.loadChain(interactionId);
  }

  /** Add a tool call as evidence source */
  recordToolCallEvidence(
    interactionId: string,
    claim: string,
    toolName: string,
    params: Record<string, unknown>,
    result: unknown,
    confidence: number,
  ): EvidenceLink {
    return this.addLink(interactionId, claim, [{
      sourceType: 'tool_execution',
      sourceName: toolName,
      requestParams: params,
      rawResponse: result,
      parsedValue: result,
    }], confidence);
  }

  /** Add an API call as evidence source */
  recordApiEvidence(
    interactionId: string,
    claim: string,
    endpoint: string,
    params: Record<string, unknown> | undefined,
    response: unknown,
    statusCode: number,
    responseTimeMs: number,
    confidence: number,
  ): EvidenceLink {
    return this.addLink(interactionId, claim, [{
      sourceType: 'api_call',
      sourceName: endpoint,
      endpoint,
      requestParams: params,
      rawResponse: response,
      httpStatus: statusCode,
      responseTimeMs,
    }], confidence);
  }

  /** Generate a plain English summary of the evidence chain */
  summarizeChain(interactionId: string): string {
    const chain = this.getChain(interactionId);
    if (!chain || chain.length === 0) return 'No evidence chain available.';

    const parts: string[] = [];
    for (let i = 0; i < chain.length; i++) {
      const link = chain[i];
      const sourceNames = [...new Set(link.sources.map(s => s.sourceName))].join(', ');
      const confidencePct = (link.confidence * 100).toFixed(0);
      parts.push(`  ${i + 1}. "${link.claim}" — from ${sourceNames} (${confidencePct}% confidence)`);
    }

    const valid = this.verifyChain(interactionId);
    const integrity = valid.valid ? '✓ Chain intact' : '⚠ Chain tampered!';

    return `**Evidence Chain (${chain.length} claims)**
${parts.join('\n')}

${integrity}`;
  }

  private computeHash(claim: string, sources: EvidenceSource[], previousHash: string): string {
    const data = JSON.stringify({ claim, sources, previousHash });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private persistChain(interactionId: string, chain: EvidenceLink[]): void {
    try {
      const db = getDb();
      db.prepare(
        `INSERT OR REPLACE INTO evidence_chains (interaction_id, chain_json, verified, updated_at)
         VALUES (?, ?, ?, datetime('now'))`,
      ).run(interactionId, JSON.stringify(chain), 1);
    } catch { /* ignore */ }
  }

  private loadChain(interactionId: string): EvidenceLink[] | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM evidence_chains WHERE interaction_id = ?').get(interactionId) as Record<string, unknown> | undefined;
      if (!row) return null;
      const chain = JSON.parse(row.chain_json as string) as EvidenceLink[];
      this.chains.set(interactionId, chain);
      return chain;
    } catch { return null; }
  }

  getStats() {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM evidence_chains').get() as { c: number }).c;
      return { totalChains: count, cachedChains: this.chains.size };
    } catch { return { totalChains: 0, cachedChains: this.chains.size }; }
  }

  /** Check chain integrity and return status */
  checkIntegrity(interactionId: string): { hashValid: boolean; chainValid: boolean; claimCount: number } {
    const chain = this.getChain(interactionId);
    if (!chain) return { hashValid: false, chainValid: false, claimCount: 0 };

    const verification = this.verifyChain(interactionId);
    return {
      hashValid: verification.valid,
      chainValid: verification.valid,
      claimCount: chain.length,
    };
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS evidence_chains (
          interaction_id TEXT PRIMARY KEY,
          chain_json TEXT NOT NULL,
          verified INTEGER DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_evidence_updated ON evidence_chains(updated_at DESC);
      `);
    } catch { /* tables exist */ }
  }
}

export const evidenceChain = new EvidenceChain();
