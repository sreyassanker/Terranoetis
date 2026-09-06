import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { predictionValidator } from './predictionValidator';

/**
 * Audit P1 — closes the forecast calibration loop.
 *
 * The chat's hazard forecasts (computeHazardForecast) were shown to users but
 * never recorded, so the ensemble's probabilities could never be checked
 * against what actually happened (validation_log stayed at 0 rows).
 *
 * This ledger:
 *   1. records every chat forecast (hazard, probability, location, timeframe)
 *   2. after the timeframe elapses, resolves it against REAL observations
 *      (USGS for seismic, NASA FIRMS for fire) in the same ±3° box
 *   3. feeds the outcome into predictionValidator → Brier score + calibration
 *
 * Resolution is conservative: "occurred" means at least one event at or above
 * the severity-mapped threshold (low→M4.5, medium→M5.5, high→M6.5,
 * extreme→M7.5; fire: ≥1 FIRMS detection).
 */

const SEVERITY_MAG: Record<string, number> = { low: 4.5, medium: 5.5, high: 6.5, extreme: 7.5 };

function timeframeToDays(tf: string): number {
  const m = /(\d+)\s*(day|hour)/i.exec(tf || '');
  if (!m) return 7;
  const n = Number(m[1]);
  return /hour/i.test(m[2]) ? Math.max(1, Math.ceil(n / 24)) : n;
}

export class ForecastLedger {
  init(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS pending_forecasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hazard_type TEXT NOT NULL,
        predicted_prob REAL NOT NULL,
        severity TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        label TEXT,
        timeframe_days INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        actual_occurred INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pf_due ON pending_forecasts(resolved, due_at)`);
      logger.info('ForecastLedger initialized');
    } catch (e) { logger.warn({ err: e }, 'ForecastLedger init failed'); }
  }

  record(pred: { hazardType: string; probability: number; severity: string; timeframe: string }, location: { lat: number; lon: number; label?: string }): void {
    try {
      const days = timeframeToDays(pred.timeframe);
      const db = getDb();
      db.prepare(`
        INSERT INTO pending_forecasts (hazard_type, predicted_prob, severity, lat, lon, label, timeframe_days, due_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(pred.hazardType, pred.probability, pred.severity, location.lat, location.lon,
        location.label || null, days, Date.now() + days * 86400000);
    } catch (e) { logger.warn({ err: e }, 'ForecastLedger record failed'); }
  }

  /** Resolve due forecasts against real observations. Best-effort per row. */
  async resolveDue(limit = 20): Promise<number> {
    let resolved = 0;
    let rows: Array<Record<string, unknown>> = [];
    try {
      const db = getDb();
      rows = db.prepare(
        'SELECT * FROM pending_forecasts WHERE resolved = 0 AND due_at <= ? LIMIT ?',
      ).all(Date.now(), limit) as Array<Record<string, unknown>>;
    } catch { return 0; }
    if (rows.length === 0) return 0;

    const { dynamicTools } = await import('../toolsV2/toolGenerator');
    for (const r of rows) {
      const lat = Number(r.lat), lon = Number(r.lon);
      const bbox = {
        minLat: Math.max(-90, lat - 3), maxLat: Math.min(90, lat + 3),
        minLon: Math.max(-180, lon - 3), maxLon: Math.min(180, lon + 3),
      };
      const days = Number(r.timeframe_days) || 7;
      const hazard = String(r.hazard_type);
      let occurred = false;
      try {
        if (hazard === 'earthquake' || hazard === 'tsunami') {
          const minMag = SEVERITY_MAG[String(r.severity)] || 5.5;
          const eq = await Promise.race([
            dynamicTools.execute('earthquakes', { ...bbox, hours: days * 24, minMag }, AbortSignal.timeout(8000)),
            new Promise<null>((res) => setTimeout(() => res(null), 9000)),
          ]);
          const feats = (eq as { features?: unknown[] })?.features || [];
          occurred = feats.length > 0;
        } else if (hazard === 'wildfire') {
          const fires = await Promise.race([
            dynamicTools.execute('firms_fires', { ...bbox }, AbortSignal.timeout(8000)),
            new Promise<null>((res) => setTimeout(() => res(null), 9000)),
          ]);
          const feats = (fires as { features?: unknown[] })?.features || [];
          occurred = feats.length > 0;
        } else {
          // Unknown hazard family — cannot verify honestly; mark resolved as
          // unverifiable WITHOUT polluting the Brier score.
          const db = getDb();
          db.prepare('UPDATE pending_forecasts SET resolved = 1, actual_occurred = NULL WHERE id = ?').run(r.id);
          continue;
        }
      } catch (e) {
        logger.warn({ err: (e as Error).message, id: r.id }, 'ForecastLedger resolve failed (will retry)');
        continue; // leave unresolved → retried next sweep
      }
      try {
        predictionValidator.recordValidation({
          hazardType: hazard,
          predictedProb: Number(r.predicted_prob),
          actualOccurred: occurred,
          predictedSeverity: String(r.severity),
          actualSeverity: occurred ? String(r.severity) : 'none',
          modelUsed: 'chat-ensemble',
        });
        const db = getDb();
        db.prepare('UPDATE pending_forecasts SET resolved = 1, actual_occurred = ? WHERE id = ?').run(occurred ? 1 : 0, r.id);
        resolved++;
      } catch (e) { logger.warn({ err: e }, 'ForecastLedger finalize failed'); }
    }
    if (resolved > 0) logger.info({ resolved }, 'ForecastLedger resolved due forecasts into calibration');
    return resolved;
  }

  start(): void {
    const sweep = () => { this.resolveDue().catch(e => logger.warn({ err: e }, 'ForecastLedger sweep failed')); };
    setTimeout(sweep, 90_000);          // first sweep shortly after boot
    setInterval(sweep, 6 * 3600_000);   // then every 6h
  }

  stats(): { pending: number; resolved: number } {
    try {
      const db = getDb();
      const p = (db.prepare('SELECT COUNT(*) c FROM pending_forecasts WHERE resolved = 0').get() as { c: number }).c;
      const r = (db.prepare('SELECT COUNT(*) c FROM pending_forecasts WHERE resolved = 1').get() as { c: number }).c;
      return { pending: p, resolved: r };
    } catch { return { pending: 0, resolved: 0 }; }
  }
}

export const forecastLedger = new ForecastLedger();
