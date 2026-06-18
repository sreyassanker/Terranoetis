import { getDb } from '../../db/index';
import { logger } from '../../observability/logger';

export interface CalibrationRecord {
  predictedProb: number;
  actualOutcome: boolean;
  timestamp: string;
  hazardType: string;
  bin: number;
}

export interface ReliabilityBin {
  binLower: number;
  binUpper: number;
  count: number;
  empiricalFrequency: number;
  predictedFrequency: number;
  gap: number;
}

export interface CalibrationReport {
  brierScore: number;
  reliabilityBins: ReliabilityBin[];
  averageConfidence: number;
  averageAccuracy: number;
  sampleSize: number;
  needsRecalibration: boolean;
}

const NUM_BINS = 10;

export class CalibrationSystem {
  private records: CalibrationRecord[] = [];
  private maxRecords = 10000;

  init(): void {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT predicted_prob, actual_outcome, timestamp, hazard_type FROM prediction_log ORDER BY timestamp DESC LIMIT ?',
      ).all(this.maxRecords) as Array<{ predicted_prob: number; actual_outcome: number; timestamp: string; hazard_type: string }>;

      this.records = rows.map(r => ({
        predictedProb: r.predicted_prob,
        actualOutcome: r.actual_outcome === 1,
        timestamp: r.timestamp,
        hazardType: r.hazard_type,
        bin: Math.floor(r.predicted_prob * NUM_BINS),
      }));

      logger.info({ recordCount: this.records.length }, 'Calibration system initialized');
    } catch {
      this.records = [];
    }
  }

  record(predictedProb: number, actualOccurred: boolean, hazardType: string): void {
    this.records.push({
      predictedProb,
      actualOutcome: actualOccurred,
      timestamp: new Date().toISOString(),
      hazardType,
      bin: Math.floor(predictedProb * NUM_BINS),
    });

    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO prediction_log (hazard_type, probability, severity, accuracy, features_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        hazardType,
        predictedProb,
        actualOccurred ? 'high' : 'low',
        actualOccurred ? predictedProb : 1 - predictedProb,
        JSON.stringify({ calibration: true, actualOccurred }),
      );
    } catch { /* db write best-effort */ }
  }

  generateReport(): CalibrationReport {
    if (this.records.length === 0) {
      return {
        brierScore: 0,
        reliabilityBins: [],
        averageConfidence: 0,
        averageAccuracy: 0,
        sampleSize: 0,
        needsRecalibration: false,
      };
    }

    const bins: Map<number, { predicted: number[]; actual: boolean[] }> = new Map();
    for (let i = 0; i < NUM_BINS; i++) bins.set(i, { predicted: [], actual: [] });

    for (const r of this.records) {
      const bin = bins.get(r.bin);
      if (bin) {
        bin.predicted.push(r.predictedProb);
        bin.actual.push(r.actualOutcome);
      }
    }

    const reliabilityBins: ReliabilityBin[] = [];
    for (const [binIdx, data] of bins) {
      if (data.predicted.length === 0) continue;
      const predictedFreq = data.predicted.reduce((s, p) => s + p, 0) / data.predicted.length;
      const empiricalFreq = data.actual.filter(a => a).length / data.actual.length;
      reliabilityBins.push({
        binLower: binIdx / NUM_BINS,
        binUpper: (binIdx + 1) / NUM_BINS,
        count: data.predicted.length,
        empiricalFrequency: empiricalFreq,
        predictedFrequency: predictedFreq,
        gap: predictedFreq - empiricalFreq,
      });
    }

    const brierScore = this.records.reduce((s, r) => {
      return s + (r.predictedProb - (r.actualOutcome ? 1 : 0)) ** 2;
    }, 0) / this.records.length;

    const avgConfidence = this.records.reduce((s, r) => s + r.predictedProb, 0) / this.records.length;
    const avgAccuracy = this.records.filter(r => {
      const correct = r.actualOutcome ? r.predictedProb > 0.5 : r.predictedProb <= 0.5;
      return correct;
    }).length / this.records.length;

    const maxGap = Math.max(...reliabilityBins.map(b => Math.abs(b.gap)));

    return {
      brierScore,
      reliabilityBins,
      averageConfidence: avgConfidence,
      averageAccuracy: avgAccuracy,
      sampleSize: this.records.length,
      needsRecalibration: maxGap > 0.15,
    };
  }

  calibrate(probabilities: number[]): number[] {
    const report = this.generateReport();
    if (!report.needsRecalibration) return probabilities;

    return probabilities.map(rawProb => {
      const bin = Math.floor(rawProb * NUM_BINS);
      const binData = report.reliabilityBins.find(b => bin >= b.binLower && bin < b.binUpper);
      if (!binData || binData.count < 5) return rawProb;
      return rawProb * (binData.empiricalFrequency / Math.max(0.01, binData.predictedFrequency));
    }).map(p => Math.max(0, Math.min(1, p)));
  }

  getStats(): { totalRecords: number; brierScore: number; needsRecalibration: boolean } {
    const report = this.generateReport();
    return {
      totalRecords: this.records.length,
      brierScore: report.brierScore,
      needsRecalibration: report.needsRecalibration,
    };
  }
}

export const calibrationSystem = new CalibrationSystem();
