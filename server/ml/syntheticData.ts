import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { omninet } from '../ai-router/omninet';

interface TrainingExample {
  query: string;
  response: string;
  intentType: string;
  tags: string[];
}

const GEN_PROMPT = `You are a disaster intelligence data generator. Generate a diverse training example for a geospatial AI assistant.

Return ONLY a JSON object with:
- query: a realistic user question about disasters, weather, aviation, or geospatial intelligence
- response: a detailed AI response with specific data, analysis, and recommendations
- intentType: one of: quick_scan, weather_check, deep_analysis, compute, hazard_forecast
- tags: array of 2-4 relevant tags like earthquake, aviation, weather, wildfire, flood, etc.

The examples should be realistic and cover real-world disaster scenarios.`;

export async function generateTrainingExample(_apiKey?: string): Promise<TrainingExample | null> {
  try {
    const result = await callOmninetGen();
    storeSyntheticData(result);
    return result;
  } catch (e) {
    logger.error({ err: e }, 'synthetic data generation failed');
    return null;
  }
}

async function callOmninetGen(): Promise<TrainingExample> {
  const text = await omninet.generateText(GEN_PROMPT, { temperature: 0.9, maxTokens: 1024 });
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed: TrainingExample = JSON.parse(cleaned);
  return {
    query: parsed.query || '',
    response: parsed.response || '',
    intentType: parsed.intentType || 'general',
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}

export function storeSyntheticData(example: TrainingExample): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO synthetic_data (query, response, intent_type, tags_json)
      VALUES (?, ?, ?, ?)
    `).run(example.query.slice(0, 2000), example.response.slice(0, 10000), example.intentType, JSON.stringify(example.tags));
  } catch (e) {
    logger.error({ err: e }, 'failed to store synthetic data');
  }
}

export function getSyntheticData(limit = 100, intentType?: string): TrainingExample[] {
  try {
    const db = getDb();
    let sql = 'SELECT query, response, intent_type, tags_json FROM synthetic_data';
    const params: unknown[] = [];
    if (intentType) {
      sql += ' WHERE intent_type = ?';
      params.push(intentType);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params) as Array<{ query: string; response: string; intent_type: string; tags_json: string }>;
    return rows.map(r => ({ query: r.query, response: r.response, intentType: r.intent_type, tags: JSON.parse(r.tags_json || '[]') }));
  } catch {
    return [];
  }
}

let generationInterval: ReturnType<typeof setInterval> | null = null;

export function startSyntheticDataGeneration(apiKey: string, intervalMs = 3600000): void {
  stopSyntheticDataGeneration();
  generationInterval = setInterval(async () => {
    await generateTrainingExample(apiKey);
  }, intervalMs);
  logger.info({ intervalMs }, 'synthetic data generation started');
}

export function stopSyntheticDataGeneration(): void {
  if (generationInterval) {
    clearInterval(generationInterval);
    generationInterval = null;
  }
}
