import { getDb } from '../db/index';
import { type ScenarioBase, type ScenarioType } from './templates';
import { safeJsonParse } from '../utils/jsonParse';

interface ScenarioRow {
  id: string;
  type: string;
  params_json: string;
  point_cloud_blob: Buffer | null;
  validation_score: number;
  created_at: string;
}

export class ScenarioDatabase {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS scenarios (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        params_json TEXT NOT NULL,
        point_cloud_blob BLOB,
        validation_score REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_scenarios_type ON scenarios(type);
      CREATE INDEX IF NOT EXISTS idx_scenarios_score ON scenarios(validation_score);
      CREATE INDEX IF NOT EXISTS idx_scenarios_created ON scenarios(created_at);
      CREATE INDEX IF NOT EXISTS idx_scenarios_lat_lon ON scenarios(id);
    `);
    this.initialized = true;
  }

  save(scenario: ScenarioBase): void {
    this.init();
    const db = getDb();
    const blob = Buffer.from(JSON.stringify(scenario.pointCloud), 'utf-8');
    db.prepare(`
      INSERT OR REPLACE INTO scenarios (id, type, params_json, point_cloud_blob, validation_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(scenario.id, scenario.type, JSON.stringify(scenario.params), blob, scenario.validationScore, scenario.createdAt);
  }

  get(id: string): ScenarioBase | null {
    this.init();
    const db = getDb();
    const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as ScenarioRow | undefined;
    if (!row) return null;
    return this.rowToScenario(row);
  }

  search(query: { type?: ScenarioType; lat?: number; lon?: number; limit?: number }): ScenarioBase[] {
    this.init();
    const db = getDb();
    const limit = Math.min(query.limit || 20, 100);

    let sql = 'SELECT * FROM scenarios WHERE 1=1';
    const params: unknown[] = [];

    if (query.type) {
      sql += ' AND type = ?';
      params.push(query.type);
    }

    sql += ' ORDER BY validation_score DESC, created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as ScenarioRow[];
    return rows.map(r => this.rowToScenario(r)).filter(Boolean) as ScenarioBase[];
  }

  findSimilar(lat: number, lon: number, type?: ScenarioType, limit = 10): ScenarioBase[] {
    this.init();
    const results = this.search({ type, limit: limit * 5 });
    return results
      .map(s => ({ scenario: s, dist: haversineDistance(lat, lon, extractLat(s), extractLon(s)) }))
      .filter(s => s.dist < 10)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, limit)
      .map(s => s.scenario);
  }

  delete(id: string): boolean {
    this.init();
    const db = getDb();
    const result = db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
    return result.changes > 0;
  }

  count(type?: ScenarioType): number {
    this.init();
    const db = getDb();
    if (type) {
      return (db.prepare('SELECT COUNT(*) as cnt FROM scenarios WHERE type = ?').get(type) as { cnt: number }).cnt;
    }
    return (db.prepare('SELECT COUNT(*) as cnt FROM scenarios').get() as { cnt: number }).cnt;
  }

  private rowToScenario(row: ScenarioRow): ScenarioBase {
    const params = safeJsonParse<Record<string, unknown>>(row.params_json, {});
    const pointCloud = row.point_cloud_blob
      ? safeJsonParse<unknown[]>(row.point_cloud_blob.toString('utf-8'), [])
      : [];
    return {
      id: row.id,
      type: row.type as ScenarioType,
      params,
      pointCloud,
      validationScore: row.validation_score,
      createdAt: row.created_at,
      metadata: {},
    };
  }
}

function extractLat(s: ScenarioBase): number {
  const p = s.params as Record<string, unknown>;
  return (p.lat as number) || (p.epicenterLat as number) || 0;
}

function extractLon(s: ScenarioBase): number {
  const p = s.params as Record<string, unknown>;
  return (p.lon as number) || (p.epicenterLon as number) || 0;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const scenarioDb = new ScenarioDatabase();
