import { getDb } from '../db/index';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export type ModelType = 'regression' | 'time_series' | 'classification' | 'ensemble';

export interface ForecastModel {
  id: number;
  modelType: ModelType;
  parameters: Record<string, unknown>;
  trainingDataDesc: string;
  accuracyHistory: number[];
  avgAccuracy: number;
  lastUpdated: string;
  trainingCount: number;
  active: boolean;
}

export interface Prediction {
  hazardType: string;
  probability: number;
  severity: string;
  confidence: number;
  modelId: number;
  features: Record<string, unknown>;
  timestamp: number;
}

export interface EnsembleResult {
  predictions: Array<{ modelId: number; probability: number; weight: number }>;
  ensembleProbability: number;
  confidence: number;
}

// ── PredictiveMemory ────────────────────────────────────────────

const RETRAIN_THRESHOLD = 0.5;

export class PredictiveMemory {
  private retrainTimer: ReturnType<typeof setInterval> | null = null;

  init(): void {
    this.ensureTable();
    this.startRetrainCheck();
    logger.info('PredictiveMemory initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS predictive_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_type TEXT NOT NULL,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        training_data_desc TEXT NOT NULL DEFAULT '',
        accuracy_history TEXT NOT NULL DEFAULT '[]',
        avg_accuracy REAL NOT NULL DEFAULT 0.5,
        last_updated TEXT NOT NULL DEFAULT (datetime('now')),
        training_count INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_predictive_models_type ON predictive_models(model_type)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_predictive_models_active ON predictive_models(active)`);

      db.exec(`CREATE TABLE IF NOT EXISTS prediction_log_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id INTEGER NOT NULL REFERENCES predictive_models(id),
        hazard_type TEXT NOT NULL,
        probability REAL NOT NULL,
        severity TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        actual_outcome TEXT,
        features_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_prediction_v2_model ON prediction_log_v2(model_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prediction_v2_hazard ON prediction_log_v2(hazard_type)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prediction_v2_created ON prediction_log_v2(created_at DESC)`);
    } catch (e) { logger.warn({ err: (e as Error).message }, 'PredictiveMemory tables may already exist'); }
  }

  registerModel(modelType: ModelType, parameters: Record<string, unknown>, trainingDataDesc: string): number {
    try {
      const db = getDb();
      const result = db.prepare(`
        INSERT INTO predictive_models (model_type, parameters_json, training_data_desc, accuracy_history, avg_accuracy, training_count)
        VALUES (?, ?, ?, '[]', 0.5, 0)
      `).run(modelType, JSON.stringify(parameters), trainingDataDesc);

      const id = result.lastInsertRowid as number;
      logger.info({ id, modelType }, 'Predictive model registered');
      return id;
    } catch (e) {
      logger.error({ err: (e as Error).message, modelType }, 'Failed to register predictive model');
      return -1;
    }
  }

  logPrediction(modelId: number, hazardType: string, probability: number, severity: string, confidence: number, features: Record<string, unknown>): number | null {
    try {
      const db = getDb();
      const result = db.prepare(`
        INSERT INTO prediction_log_v2 (model_id, hazard_type, probability, severity, confidence, features_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(modelId, hazardType, probability, severity, confidence, JSON.stringify(features));

      return result.lastInsertRowid as number;
    } catch (e) {
      logger.error({ err: (e as Error).message, modelId, hazardType }, 'Failed to log prediction');
      return null;
    }
  }

  recordOutcome(predictionId: number, actualOutcome: string): void {
    try {
      const db = getDb();
      db.prepare('UPDATE prediction_log_v2 SET actual_outcome = ? WHERE id = ?')
        .run(actualOutcome, predictionId);

      // Update model accuracy
      const row = db.prepare(`
        SELECT p.model_id, p.probability, p.hazard_type
        FROM prediction_log_v2 p WHERE p.id = ?
      `).get(predictionId) as { model_id: number; probability: number; hazard_type: string } | undefined;

      if (row) {
        const allPredictions = db.prepare(`
          SELECT probability, actual_outcome FROM prediction_log_v2
          WHERE model_id = ? AND actual_outcome IS NOT NULL
        `).all(row.model_id) as Array<{ probability: number; actual_outcome: string }>;

        const accuracies: number[] = allPredictions.map(p => {
          const correct = (p.probability >= 0.5 && p.actual_outcome === 'occurred') ||
                          (p.probability < 0.5 && p.actual_outcome === 'did_not_occur');
          return correct ? 1 : 0;
        });

        const history = db.prepare('SELECT accuracy_history FROM predictive_models WHERE id = ?')
          .get(row.model_id) as { accuracy_history: string } | undefined;

        if (history) {
          const hist = JSON.parse(history.accuracy_history) as number[];
          const newAccuracy = accuracies.length > 0
            ? accuracies.reduce((s, v) => s + v, 0) / accuracies.length
            : 0.5;
          hist.push(newAccuracy);
          const recentHist = hist.slice(-50);

          db.prepare(`
            UPDATE predictive_models SET
              accuracy_history = ?, avg_accuracy = ?, training_count = training_count + 1, last_updated = datetime('now')
            WHERE id = ?
          `).run(JSON.stringify(recentHist), newAccuracy, row.model_id);
        }
      }
    } catch (e) { logger.error({ err: (e as Error).message }, 'Failed to record outcome'); }
  }

  async predict(hazardType: string, features: Record<string, unknown>): Promise<EnsembleResult> {
    const activeModels = this.getActiveModels();
    if (activeModels.length === 0) {
      return {
        predictions: [],
        ensembleProbability: 0.5,
        confidence: 0.1,
      };
    }

    // Weighted ensemble: weight by avg accuracy
    const totalWeight = activeModels.reduce((s, m) => s + m.avgAccuracy, 0) || 1;
    const predictions: Array<{ modelId: number; probability: number; weight: number }> = [];

    for (const model of activeModels) {
      const prob = this.runModel(model, hazardType, features);
      predictions.push({
        modelId: model.id,
        probability: prob,
        weight: model.avgAccuracy / totalWeight,
      });
    }

    const ensembleProbability = predictions.reduce((s, p) => s + p.probability * p.weight, 0);
    const confidence = Math.min(1, activeModels.reduce((s, m) => s + m.avgAccuracy, 0) / activeModels.length);

    // Log ensemble prediction
    const severity = ensembleProbability > 0.7 ? 'high' : ensembleProbability > 0.4 ? 'moderate' : 'low';
    for (const pred of predictions) {
      this.logPrediction(pred.modelId, hazardType, pred.probability, severity, confidence, features);
    }

    return { predictions, ensembleProbability, confidence };
  }

  private runModel(model: ForecastModel, hazardType: string, _features: Record<string, unknown>): number {
    switch (model.modelType) {
      case 'regression': {
        const params = model.parameters as Record<string, number>;
        const base = params.baseProbability ?? 0.5;
        const hazardMultiplier = this.getHazardMultiplier(hazardType);
        const timeOfDay = new Date().getHours();
        const hourFactor = (timeOfDay > 6 && timeOfDay < 18) ? 1.0 : 1.2;
        return Math.min(1, Math.max(0, base * hazardMultiplier * hourFactor));
      }
      case 'time_series': {
        const params = model.parameters as Record<string, number>;
        const base = params.recentTrend ?? 0.5;
        const seasonality = params.seasonalityFactor ?? 1.0;
        return Math.min(1, Math.max(0, base * seasonality));
      }
      case 'classification': {
        const params = model.parameters as Record<string, number>;
        return params[hazardType] ?? 0.5;
      }
      case 'ensemble':
        return 0.5;
      default:
        return 0.5;
    }
  }

  private getHazardMultiplier(hazardType: string): number {
    const multipliers: Record<string, number> = {
      earthquake: 1.0,
      tsunami: 0.8,
      wildfire: 0.7,
      hurricane: 0.6,
      flood: 0.5,
      volcano: 0.4,
      storm: 0.6,
    };
    return multipliers[hazardType.toLowerCase()] ?? 0.5;
  }

  private getActiveModels(): ForecastModel[] {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM predictive_models WHERE active = 1 ORDER BY avg_accuracy DESC'
      ).all() as Array<Record<string, unknown>>;

      return rows.map(r => this.rowToModel(r));
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to get active models');
      return [];
    }
  }

  getModel(id: number): ForecastModel | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM predictive_models WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!row) return null;
      return this.rowToModel(row);
    } catch (e) {
      logger.error({ err: (e as Error).message, id }, 'Failed to get model');
      return null;
    }
  }

  private checkAndRetrain(): void {
    try {
      const db = getDb();
      const lowAccuracyModels = db.prepare(
        "SELECT * FROM predictive_models WHERE avg_accuracy < ? AND active = 1 AND training_count > 5"
      ).all(RETRAIN_THRESHOLD) as Array<Record<string, unknown>>;

      for (const row of lowAccuracyModels) {
        const model = this.rowToModel(row);
        logger.warn({ id: model.id, accuracy: model.avgAccuracy }, 'Model accuracy below threshold, needs retraining');

        db.prepare('UPDATE predictive_models SET active = 0 WHERE id = ?').run(model.id);

        const improvedParams = this.improveParameters(model);
        const newId = this.registerModel(model.modelType, improvedParams, `${model.trainingDataDesc} (retrained)`);
        logger.info({ oldId: model.id, newId }, 'Low-accuracy model replaced with retrained version');
      }
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Retrain check failed');
    }
  }

  private improveParameters(model: ForecastModel): Record<string, unknown> {
    const params = { ...model.parameters } as Record<string, number>;

    // Slightly adjust parameters based on what we know
    if (params.baseProbability !== undefined) {
      params.baseProbability = Math.min(0.9, params.baseProbability * 1.1);
    }
    if (params.recentTrend !== undefined) {
      params.recentTrend = Math.min(0.9, params.recentTrend * 1.05);
    }
    if (params.seasonalityFactor !== undefined) {
      params.seasonalityFactor = Math.min(1.5, params.seasonalityFactor * 1.1);
    }

    return params as Record<string, unknown>;
  }

  private startRetrainCheck(): void {
    this.retrainTimer = setInterval(() => {
      this.checkAndRetrain();
    }, 3600000);
  }

  shutdown(): void {
    if (this.retrainTimer) {
      clearInterval(this.retrainTimer);
      this.retrainTimer = null;
    }
  }

  private rowToModel(row: Record<string, unknown>): ForecastModel {
    return {
      id: row.id as number,
      modelType: row.model_type as ModelType,
      parameters: JSON.parse(row.parameters_json as string || '{}'),
      trainingDataDesc: row.training_data_desc as string,
      accuracyHistory: JSON.parse(row.accuracy_history as string || '[]'),
      avgAccuracy: row.avg_accuracy as number || 0.5,
      lastUpdated: row.last_updated as string,
      trainingCount: row.training_count as number || 0,
      active: (row.active as number) === 1,
    };
  }
}

export const predictiveMemory = new PredictiveMemory();
