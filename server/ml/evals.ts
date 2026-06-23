import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { omninet } from '../ai-router/omninet';

export interface EvalScores {
  relevance: number;
  factualAccuracy: number;
  helpfulness: number;
  conciseness: number;
  overall: number;
}

const EVAL_PROMPT = `You are an impartial evaluator. Rate the following AI response on four criteria (0.0 to 1.0):
- relevance: How well does the response address the user's query?
- factualAccuracy: Is the response factually correct and consistent with known data?
- helpfulness: Does it provide actionable, useful information?
- conciseness: Is it well-structured without unnecessary verbosity?

Return ONLY a JSON object: { "relevance": 0.0-1.0, "factualAccuracy": 0.0-1.0, "helpfulness": 0.0-1.0, "conciseness": 0.0-1.0 }`;

export async function evaluateResponse(
  query: string,
  response: string,
  _context: { intentType?: string; location?: string; modelTier?: string },
  _apiKey?: string,
): Promise<EvalScores> {
  if (!response) {
    return { relevance: 0.5, factualAccuracy: 0.5, helpfulness: 0.5, conciseness: 0.5, overall: 0.5 };
  }

  try {
    const result = await callOmninetEval(query, response);
    const overall = Math.round(
      (result.relevance + result.factualAccuracy + result.helpfulness + result.conciseness) / 4 * 100,
    ) / 100;
    return { ...result, overall };
  } catch {
    return { relevance: 0.5, factualAccuracy: 0.5, helpfulness: 0.5, conciseness: 0.5, overall: 0.5 };
  }
}

async function callOmninetEval(query: string, response: string): Promise<Omit<EvalScores, 'overall'>> {
  const text = await omninet.generateText(
    `${EVAL_PROMPT}\n\nQuery: ${query.slice(0, 1000)}\n\nResponse: ${response.slice(0, 2000)}`,
    { temperature: 0.1, maxTokens: 200 },
  );
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return {
    relevance: clamp(parsed.relevance),
    factualAccuracy: clamp(parsed.factualAccuracy),
    helpfulness: clamp(parsed.helpfulness),
    conciseness: clamp(parsed.conciseness),
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, typeof v === 'number' ? v : 0.5));
}

export function storeEval(
  episodeId: string | null,
  query: string,
  scores: EvalScores,
  metadata?: Record<string, unknown>,
): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO eval_scores (episode_id, query, relevance, factual_accuracy, helpfulness, conciseness, overall, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      episodeId,
      query.slice(0, 500),
      scores.relevance,
      scores.factualAccuracy,
      scores.helpfulness,
      scores.conciseness,
      scores.overall,
      metadata ? JSON.stringify(metadata) : null,
    );
  } catch (e) {
    logger.error({ err: e }, 'failed to store eval score');
  }
}

export function getRecentEvals(limit = 100): Array<EvalScores & { query: string; createdAt: string }> {
  try {
    const db = getDb();
    return db.prepare(
      'SELECT query, relevance, factual_accuracy, helpfulness, conciseness, overall, created_at FROM eval_scores ORDER BY created_at DESC LIMIT ?',
    ).all(limit) as Array<EvalScores & { query: string; createdAt: string }>;
  } catch {
    return [];
  }
}

export function getAvgScoresByIntent(): Record<string, { count: number; avgOverall: number }> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT COALESCE(json_extract(metadata_json, '$.intentType'), 'unknown') as intent,
             COUNT(*) as count, AVG(overall) as avg_overall
      FROM eval_scores GROUP BY intent
    `).all() as Array<{ intent: string; count: number; avg_overall: number }>;
    const result: Record<string, { count: number; avgOverall: number }> = {};
    for (const r of rows) {
      result[r.intent] = { count: r.count, avgOverall: Math.round(r.avg_overall * 100) / 100 };
    }
    return result;
  } catch {
    return {};
  }
}
