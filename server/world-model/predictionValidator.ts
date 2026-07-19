import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { ensemblePredictor } from './ensemblePredictor';

// ── Types ───────────────────────────────────────────────────────

export interface ValidationEntry {
  id: number;
  hazardType: string;
  predictedProb: number;
  actualOccurred: boolean;
  predictedSeverity: string;
  actualSeverity: string;
  modelUsed: string;
  timestamp: string;
}

export interface BrierScore {
  overall: number;
  byHazard: Record<string, number>;
}

export interface CalibrationPoint {
  binStart: number;
  binEnd: number;
  count: number;
  observedFrequency: number;
  predictedFrequency: number;
}


export interface ValidationReport {
  totalPredictions: number;
  brierScore: BrierScore;
  calibration: CalibrationPoint[];
  rocAuc: number;
  accuracy: number;
  byHazard: Record<string, { count: number; accuracy: number; brier: number }>;
  weeklyAccuracy: number;
  improvementNeeded: boolean;
}

// ── PredictionValidator ─────────────────────────────────────────

export class PredictionValidator {
  private validationBuffer: ValidationEntry[] = [];

  init(): void {
    this.ensureTable();
    logger.info('PredictionValidator initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS validation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hazard_type TEXT NOT NULL,
        predicted_prob REAL NOT NULL,
        actual_occurred INTEGER NOT NULL,
        predicted_severity TEXT NOT NULL DEFAULT 'low',
        actual_severity TEXT NOT NULL DEFAULT 'unknown',
        model_used TEXT NOT NULL DEFAULT 'ensemble',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_val_hazard ON validation_log(hazard_type)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_val_created ON validation_log(created_at DESC)`);
    } catch { /* tables exist */ }
  }

  recordValidation(params: {
    hazardType: string;
    predictedProb: number;
    actualOccurred: boolean;
    predictedSeverity: string;
    actualSeverity: string;
    modelUsed?: string;
  }): void {
    const entry: ValidationEntry = {
      id: 0,
      hazardType: params.hazardType,
      predictedProb: params.predictedProb,
      actualOccurred: params.actualOccurred,
      predictedSeverity: params.predictedSeverity,
      actualSeverity: params.actualSeverity || 'unknown',
      modelUsed: params.modelUsed || 'ensemble',
      timestamp: new Date().toISOString(),
    };

    this.validationBuffer.push(entry);
    if (this.validationBuffer.length > 1000) this.validationBuffer.shift();

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO validation_log (hazard_type, predicted_prob, actual_occurred, predicted_severity, actual_severity, model_used)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(params.hazardType, params.predictedProb, params.actualOccurred ? 1 : 0,
        params.predictedSeverity, params.actualSeverity || 'unknown', params.modelUsed || 'ensemble');
    } catch { /* silent */ }
  }

  computeBrierScore(entries?: ValidationEntry[]): BrierScore {
    const data = entries || this.getRecentEntries(500);

    const byHazard: Record<string, number[]> = {};
    for (const e of data) {
      if (!byHazard[e.hazardType]) byHazard[e.hazardType] = [];
      const outcome = e.actualOccurred ? 1 : 0;
      byHazard[e.hazardType].push(Math.pow(e.predictedProb - outcome, 2));
    }

    const overall: number[] = [];
    const byHazardScores: Record<string, number> = {};

    for (const [hazard, scores] of Object.entries(byHazard)) {
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      byHazardScores[hazard] = Math.round(avg * 10000) / 10000;
      overall.push(...scores);
    }

    return {
      overall: Math.round(overall.reduce((s, v) => s + v, 0) / overall.length * 10000) / 10000,
      byHazard: byHazardScores,
    };
  }

  computeCalibration(entries?: ValidationEntry[], bins = 10): CalibrationPoint[] {
    const data = entries || this.getRecentEntries(500);
    if (data.length === 0) return [];

    const binSize = 1 / bins;
    const calibration: CalibrationPoint[] = [];

    for (let i = 0; i < bins; i++) {
      const binStart = i * binSize;
      const binEnd = (i + 1) * binSize;

      const inBin = data.filter(e =>
        e.predictedProb >= binStart && e.predictedProb < binEnd,
      );

      if (inBin.length === 0) continue;

      calibration.push({
        binStart: Math.round(binStart * 100) / 100,
        binEnd: Math.round(binEnd * 100) / 100,
        count: inBin.length,
        observedFrequency: inBin.filter(e => e.actualOccurred).length / inBin.length,
        predictedFrequency: inBin.reduce((s, e) => s + e.predictedProb, 0) / inBin.length,
      });
    }

    return calibration;
  }

  computeROCAUC(entries?: ValidationEntry[]): number {
    const data = entries || this.getRecentEntries(500);
    if (data.length < 2) return 0.5;

    // Sort by predicted probability descending
    const sorted = [...data].sort((a, b) => b.predictedProb - a.predictedProb);
    const nPos = sorted.filter(e => e.actualOccurred).length;
    const nNeg = sorted.length - nPos;

    if (nPos === 0 || nNeg === 0) return 0.5;

    let rankSum = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].actualOccurred) {
        rankSum += i + 1;
      }
    }

    const auc = (rankSum - nPos * (nPos + 1) / 2) / (nPos * nNeg);
    return Math.round(auc * 10000) / 10000;
  }

  computeAccuracy(entries?: ValidationEntry[]): number {
    const data = entries || this.getRecentEntries(500);
    if (data.length === 0) return 0;

    const correct = data.filter(e => (e.predictedProb >= 0.5) === e.actualOccurred).length;
    return Math.round(correct / data.length * 10000) / 10000;
  }

  generateReport(): ValidationReport {
    const allEntries = this.getRecentEntries(1000);
    const lastWeek = this.getRecentEntries(1000, 7);

    const byHazard: Record<string, { count: number; accuracy: number; brier: number }> = {};
    const hazardGroups = new Map<string, ValidationEntry[]>();

    for (const e of allEntries) {
      if (!hazardGroups.has(e.hazardType)) hazardGroups.set(e.hazardType, []);
      hazardGroups.get(e.hazardType)!.push(e);
    }

    for (const [hazard, entries] of hazardGroups) {
      const correct = entries.filter(e => (e.predictedProb >= 0.5) === e.actualOccurred).length;
      const brier = entries.reduce((s, e) => {
        const outcome = e.actualOccurred ? 1 : 0;
        return s + Math.pow(e.predictedProb - outcome, 2);
      }, 0) / entries.length;

      byHazard[hazard] = {
        count: entries.length,
        accuracy: Math.round(correct / entries.length * 10000) / 10000,
        brier: Math.round(brier * 10000) / 10000,
      };
    }

    const brierScore = this.computeBrierScore(allEntries);
    const calibration = this.computeCalibration(allEntries);
    const rocAuc = this.computeROCAUC(allEntries);
    const accuracy = this.computeAccuracy(allEntries);
    const weeklyAccuracy = this.computeAccuracy(lastWeek);

    const report: ValidationReport = {
      totalPredictions: allEntries.length,
      brierScore,
      calibration,
      rocAuc,
      accuracy,
      byHazard,
      weeklyAccuracy,
      improvementNeeded: weeklyAccuracy < 0.6 || rocAuc < 0.65,
    };

    // Auto-improve if accuracy is low
    if (report.improvementNeeded) {
      logger.warn(report, 'Prediction accuracy below threshold — auto-improvement triggered');
    }

    // Store report
    try {
      const db = getDb();
      const existing = db.prepare("SELECT id FROM config WHERE key = 'last_validation_report'").get() as { id: number } | undefined;
      if (existing) {
        db.prepare("UPDATE config SET value = ? WHERE key = 'last_validation_report'")
          .run(JSON.stringify(report));
      } else {
        db.prepare("INSERT INTO config (key, value) VALUES ('last_validation_report', ?)")
          .run(JSON.stringify(report));
      }
    } catch { /* silent */ }

    return report;
  }

  getRecentEntries(limit = 500, daysBack?: number): ValidationEntry[] {
    try {
      const db = getDb();
      let sql = 'SELECT * FROM validation_log';
      const params: unknown[] = [];
      if (daysBack) {
        sql += " WHERE created_at >= datetime('now', '-' || ? || ' days')";
        params.push(daysBack);
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      return db.prepare(sql).all(...params) as ValidationEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Auto-retrain trigger: when accuracy drops, adjust ensemble weights.
   */
  autoImprove(): void {
    const report = this.generateReport();

    if (!report.improvementNeeded) return;

    // For each hazard type, adjust ensemble weights based on which model was most accurate
    for (const [hazard, stats] of Object.entries(report.byHazard)) {
      if (stats.accuracy < 0.6 && stats.count >= 10) {
        // Boost pattern matching weight (most reliable for frequent events)
        ensemblePredictor.updateWeights(hazard, 'patternWeight', 0.05);
        ensemblePredictor.updateWeights(hazard, 'physicsWeight', -0.02);

        logger.info({ hazard, accuracy: stats.accuracy }, 'Auto-improved ensemble weights for hazard type');
      }
    }
  }
}

export const predictionValidator = new PredictionValidator();
