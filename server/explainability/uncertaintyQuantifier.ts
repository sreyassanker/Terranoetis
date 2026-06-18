import { getDb } from '../db/index';
import { logger } from '../observability/logger';

export interface PredictionWithUncertainty {
  type: string;
  pointEstimate: number;
  confidenceInterval: [number, number];
  confidenceLevel: number;
  calibrationScore: number;
  isCalibrated: boolean;
  distribution: 'normal' | 'lognormal' | 'binomial' | 'uniform';
  sampleSize: number;
}

export interface CalibrationBin {
  binStart: number;
  binEnd: number;
  predictedCount: number;
  actualCount: number;
  accuracy: number;
}

export class UncertaintyQuantifier {
  private calibrationHistory: Array<{ predicted: number; actual: number; type: string }> = [];
  private maxHistory = 10000;

  init(): void {
    this.ensureTables();
    logger.info('UncertaintyQuantifier initialized');
  }

  /** Compute confidence interval for a prediction */
  computeConfidenceInterval(
    pointEstimate: number,
    sampleSize: number,
    historicalAccuracy: number,
    distribution: 'normal' | 'lognormal' | 'binomial' | 'uniform' = 'normal',
    confidenceLevel = 0.95,
  ): PredictionWithUncertainty {
    const zScore = this.zScoreForConfidence(confidenceLevel);
    const standardError = this.standardError(pointEstimate, sampleSize, distribution);
    const marginOfError = zScore * standardError;

    const ciLow = Math.max(0, pointEstimate - marginOfError);
    const ciHigh = Math.min(1, pointEstimate + marginOfError);

    const calibrationScore = this.computeCalibrationScore(pointEstimate, historicalAccuracy);
    const isCalibrated = calibrationScore > 0.7;

    return {
      type: distribution,
      pointEstimate,
      confidenceInterval: [ciLow, ciHigh],
      confidenceLevel,
      calibrationScore,
      isCalibrated,
      distribution,
      sampleSize,
    };
  }

  /** Bin predictions by confidence level and compute actual accuracy */
  computeCalibration(type?: string): CalibrationBin[] {
    const relevant = type
      ? this.calibrationHistory.filter(r => r.type === type)
      : this.calibrationHistory;

    if (relevant.length < 10) return [];

    const bins: CalibrationBin[] = [];
    const binCount = 10;

    for (let i = 0; i < binCount; i++) {
      const binStart = i / binCount;
      const binEnd = (i + 1) / binCount;
      const inBin = relevant.filter(r => r.predicted >= binStart && r.predicted < binEnd);

      if (inBin.length > 0) {
        const actualCount = inBin.filter(r => r.actual === 1).length;
        bins.push({
          binStart,
          binEnd,
          predictedCount: inBin.length,
          actualCount,
          accuracy: actualCount / inBin.length,
        });
      }
    }

    return bins;
  }

  /** Record a prediction outcome for calibration tracking */
  recordOutcome(predicted: number, actual: number, type: string): void {
    this.calibrationHistory.push({ predicted, actual, type });
    if (this.calibrationHistory.length > this.maxHistory) {
      this.calibrationHistory.shift();
    }

    try {
      const db = getDb();
      db.prepare(
        'INSERT INTO calibration_history (predicted, actual, type, created_at) VALUES (?, ?, ?, datetime("now"))',
      ).run(predicted, actual ? 1 : 0, type);
    } catch { /* ignore */ }
  }

  /** Get calibration curve — how well predictions match reality */
  getCalibrationCurve(type?: string): {
    bins: CalibrationBin[];
    ece: number; // Expected Calibration Error
    mce: number; // Maximum Calibration Error
  } {
    const bins = this.computeCalibration(type);
    if (bins.length === 0) return { bins, ece: 0, mce: 0 };

    let ece = 0;
    let mce = 0;
    let total = 0;

    for (const bin of bins) {
      const binMid = (bin.binStart + bin.binEnd) / 2;
      const diff = Math.abs(bin.accuracy - binMid);
      ece += diff * bin.predictedCount;
      mce = Math.max(mce, diff);
      total += bin.predictedCount;
    }

    ece = total > 0 ? ece / total : 0;

    return { bins, ece, mce };
  }

  /** Format a prediction with uncertainty for display */
  formatPrediction(pred: PredictionWithUncertainty): string {
    const [lo, hi] = pred.confidenceInterval;
    const pct = (pred.pointEstimate * 100).toFixed(1);
    const ciRange = `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}`;
    const cal = pred.isCalibrated ? 'calibrated' : 'uncalibrated';
    const level = (pred.confidenceLevel * 100).toFixed(0);

    return `${pct}% (${level}% CI: ${ciRange}%, ${cal})`;
  }

  /** Color code for uncertainty level */
  uncertaintyColor(confidence: number): 'green' | 'yellow' | 'red' {
    if (confidence >= 0.8) return 'green';
    if (confidence >= 0.5) return 'yellow';
    return 'red';
  }

  /** Get confidence bar: returns visual representation segments */
  confidenceBar(confidence: number): {
    filled: number;
    color: string;
    label: string;
  } {
    const color = this.uncertaintyColor(confidence);
    const labels = { green: 'High confidence', yellow: 'Medium confidence', red: 'Low confidence' };
    return {
      filled: confidence,
      color,
      label: labels[color],
    };
  }

  /** Compute Brier score for a set of predictions */
  computeBrierScore(predictions: Array<{ predicted: number; actual: number }>): number {
    if (predictions.length === 0) return 0;
    return predictions.reduce((sum, p) => sum + (p.predicted - p.actual) ** 2, 0) / predictions.length;
  }

  /** Calibrate a raw model score using Platt scaling */
  plattCalibrate(rawScore: number, a = 1, b = 0): number {
    return 1 / (1 + Math.exp(-(a * rawScore + b)));
  }

  getStats() {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM calibration_history').get() as { c: number }).c;
      const brier = this.computeBrierScore(this.calibrationHistory);
      return { totalRecords: count, brierScore: brier, cachedRecords: this.calibrationHistory.length };
    } catch { return { totalRecords: 0, brierScore: 0, cachedRecords: 0 }; }
  }

  private zScoreForConfidence(confidenceLevel: number): number {
    // Common z-scores
    const scores: Record<number, number> = {
      0.90: 1.645,
      0.95: 1.960,
      0.99: 2.576,
    };
    return scores[confidenceLevel] || 1.960;
  }

  private standardError(estimate: number, n: number, distribution: string): number {
    if (n < 2) return 0.1; // Default uncertainty for small samples
    if (distribution === 'binomial') {
      return Math.sqrt((estimate * (1 - estimate)) / n);
    }
    return Math.sqrt(estimate * (1 - estimate)) / Math.sqrt(n);
  }

  private computeCalibrationScore(predicted: number, historicalAccuracy: number): number {
    if (this.calibrationHistory.length < 10) return 0.5;
    const diff = Math.abs(predicted - historicalAccuracy);
    return Math.max(0, 1 - diff);
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS calibration_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          predicted REAL NOT NULL,
          actual INTEGER NOT NULL,
          type TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_calibration_type ON calibration_history(type);
        CREATE INDEX IF NOT EXISTS idx_calibration_created ON calibration_history(created_at DESC);
      `);
    } catch { /* tables exist */ }
  }
}

export const uncertaintyQuantifier = new UncertaintyQuantifier();
