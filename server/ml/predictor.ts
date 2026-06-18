import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { EmbeddingEngine } from '../embedding';
import { omninet } from '../ai-router/omninet';
import { causalGraph } from '../world-model/causalGraph';
import { ensemblePredictor, type EnsembleInput, type DomainPrediction } from '../world-model/ensemblePredictor';
import { scenarioSimulator } from '../world-model/scenarioSimulator';
import { predictionValidator } from '../world-model/predictionValidator';
import { FlowPredictor, type FlowPredictionInput, type FlowPrediction } from './predictor/flowPredictor';
import { ensembleFlow, type EnsemblePrediction } from './predictor/ensembleFlow';
import { scenarioPredictor, type ScenarioStats } from './predictor/scenarioPrediction';
import { calibrationSystem } from './predictor/calibration';
import { retrainingPipeline } from './predictor/retraining';

interface PredictionInput {
  location: { lat: number; lon: number; label?: string };
  layers: string[];
  history: Array<{ timestamp: string; value: number; type: string }>;
  query?: string;
}

export interface Prediction {
  hazardType: string;
  probability: number;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  timeframe: string;
  confidence: number;
  contributingFactors: string[];
}

interface HistoricalPattern {
  id: number;
  locationId: string;
  pattern: string;
  outcome: string;
  accuracy: number;
  occurrences: number;
}

export class Predictor {
  private patterns: HistoricalPattern[] = [];
  private embeddingEngine: EmbeddingEngine | null = null;
  private flowPredictor: FlowPredictor;
  private flowInitialized = false;

  constructor() {
    this.flowPredictor = new FlowPredictor();
  }

  setEmbeddingEngine(ee: EmbeddingEngine): void {
    this.embeddingEngine = ee;
    causalGraph.setEmbeddingEngine(ee);
  }

  init(): void {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM historical_patterns ORDER BY occurrences DESC LIMIT 1000').all() as HistoricalPattern[];
      this.patterns = rows;
      logger.info({ patternCount: this.patterns.length }, 'Predictor initialized');
    } catch {
      this.patterns = [];
    }

    causalGraph.init().catch(() => {});
    ensemblePredictor.init();
    predictionValidator.init();

    if (!this.flowInitialized) {
      this.flowPredictor.init();
      ensembleFlow.init();
      calibrationSystem.init();
      retrainingPipeline.init();
      this.flowInitialized = true;
    }
  }

  async predict(input: PredictionInput): Promise<Prediction[]> {
    const ensembleInput: EnsembleInput = {
      location: input.location,
      layers: input.layers,
      history: input.history,
      query: input.query,
    };

    const results = await ensemblePredictor.predict(ensembleInput);
    const worldPredictions = this.toPrediction(results);

    if (this.flowInitialized) {
      const flowInput: FlowPredictionInput = {
        location: input.location,
        layers: input.layers,
        history: input.history,
        query: input.query,
      };

      try {
        const flowResults = await this.flowPredictor.predict(flowInput);
        const flowPredictions = flowResults.map(this.flowPredictionToPrediction.bind(this));
        const calibrated = calibrationSystem.calibrate(flowPredictions.map(p => p.probability));
        for (let i = 0; i < flowPredictions.length; i++) {
          flowPredictions[i].probability = calibrated[i] ?? flowPredictions[i].probability;
        }
        return this.mergePredictions(worldPredictions, flowPredictions);
      } catch (e) {
        logger.warn({ err: e }, 'Flow predictor failed, falling back to world model');
        return worldPredictions;
      }
    }

    return worldPredictions;
  }

  async generatePredictionReport(input: PredictionInput, _apiKey?: string): Promise<string> {
    const predictions = await this.predict(input);
    if (predictions.length === 0) {
      return 'No significant predictions at this time.';
    }

    try {
      const prompt = `Given these physics-informed hazard predictions for ${input.location.label || `${input.location.lat},${input.location.lon}`}:\n${
        JSON.stringify(predictions, null, 2)
      }\n\nGenerate a concise risk assessment report with recommendations.`;

      return await omninet.generateText(prompt, { temperature: 0.3, maxTokens: 500 });
    } catch {
      return this.formatPredictionsPlain(predictions);
    }
  }

  recordOutcome(prediction: Prediction, actualOccurred: boolean, severityMatch: boolean): void {
    const accuracy = actualOccurred ? (severityMatch ? 0.9 : 0.6) : 0.1;

    predictionValidator.recordValidation({
      hazardType: prediction.hazardType,
      predictedProb: prediction.probability,
      actualOccurred,
      predictedSeverity: prediction.severity,
      actualSeverity: severityMatch ? prediction.severity : 'unknown',
      modelUsed: 'ensemble',
    });

    ensemblePredictor.recordOutcome(prediction.hazardType, {
      hazardType: prediction.hazardType,
      probability: prediction.probability,
      severity: prediction.severity,
      timeframe: prediction.timeframe,
      confidence: prediction.confidence,
      confidenceInterval: [0, 0],
      contributingFactors: prediction.contributingFactors,
      source: 'statistical',
    }, actualOccurred);

    if (this.flowInitialized) {
      calibrationSystem.record(prediction.probability, actualOccurred, prediction.hazardType);
      ensembleFlow.recordOutcome(prediction.hazardType, prediction.probability, actualOccurred);
    }

    try {
      const db = getDb();
      db.prepare(`
        UPDATE historical_patterns
        SET occurrences = occurrences + 1,
            accuracy = (accuracy * occurrences + ?) / (occurrences + 1)
        WHERE outcome = ?
      `).run(accuracy, prediction.hazardType);

      db.prepare(`
        INSERT INTO prediction_log (hazard_type, probability, severity, accuracy, features_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        prediction.hazardType,
        prediction.probability,
        prediction.severity,
        accuracy,
        JSON.stringify({ actualOccurred, severityMatch, contributingFactors: prediction.contributingFactors }),
      );

      const observedEvents = [prediction.hazardType];
      if (actualOccurred && severityMatch) {
        causalGraph.learnFromOutcome(observedEvents, 'confirmed').catch(() => {});
      }
    } catch (e) {
      logger.error({ err: e }, 'failed to record prediction outcome');
    }

    try {
      const report = predictionValidator.generateReport();
      if (report.improvementNeeded) {
        predictionValidator.autoImprove();
      }
    } catch { /* silent */ }
  }

  storePattern(pattern: string, outcome: string, accuracy: number): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO historical_patterns (pattern, outcome, accuracy, occurrences)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(pattern, outcome) DO UPDATE SET
          occurrences = occurrences + 1,
          accuracy = (accuracy * occurrences + ?) / (occurrences + 1)
      `).run(pattern, outcome, accuracy, accuracy);
    } catch (e) {
      logger.error({ err: e }, 'failed to store pattern');
    }
    this.init();
  }

  runScenario(scenarioName: string, variables: Record<string, number>) {
    return scenarioSimulator.simulate(scenarioName, variables);
  }

  getValidationReport() {
    return predictionValidator.generateReport();
  }

  getCausalGraphDot(): string {
    return causalGraph.toDot();
  }

  async runScenarioPrediction(type: string, params: Record<string, unknown>, numRuns = 100): Promise<ScenarioStats> {
    return scenarioPredictor.predict(type, params, numRuns);
  }

  async runEnsemblePrediction(input: PredictionInput): Promise<EnsemblePrediction[]> {
    const flowInput: FlowPredictionInput = {
      location: input.location,
      layers: input.layers,
      history: input.history,
      query: input.query,
    };
    return ensembleFlow.predict(flowInput);
  }

  runCalibrationReport() {
    return calibrationSystem.generateReport();
  }

  runRetrainingCheck(): Promise<boolean> {
    return retrainingPipeline.maybeRetrain();
  }

  addFlowExperience(
    cloud: Array<{ x: number; y: number; z: number }>,
    conditioning: number[],
    label: string,
    source: string,
  ): void {
    retrainingPipeline.addExperience(cloud, conditioning, label, source);
  }

  private toPrediction(domainPreds: DomainPrediction[]): Prediction[] {
    return domainPreds.map(d => ({
      hazardType: d.hazardType,
      probability: d.probability,
      severity: d.severity,
      timeframe: d.timeframe,
      confidence: d.confidence,
      contributingFactors: d.contributingFactors,
    }));
  }

  private flowPredictionToPrediction(fp: FlowPrediction): Prediction {
    return {
      hazardType: fp.hazardType,
      probability: fp.probability,
      severity: fp.severity,
      timeframe: fp.timeframe,
      confidence: fp.confidence,
      contributingFactors: fp.contributingFactors,
    };
  }

  private mergePredictions(world: Prediction[], flow: Prediction[]): Prediction[] {
    const merged = new Map<string, Prediction>();

    for (const p of world) {
      merged.set(p.hazardType, p);
    }

    for (const p of flow) {
      const existing = merged.get(p.hazardType);
      if (existing) {
        existing.probability = (existing.probability + p.probability) / 2;
        existing.confidence = (existing.confidence + p.confidence) / 2;
        existing.contributingFactors = [...new Set([...existing.contributingFactors, ...p.contributingFactors])];
      } else {
        merged.set(p.hazardType, p);
      }
    }

    return Array.from(merged.values()).sort((a, b) => b.probability - a.probability);
  }

  private formatPredictionsPlain(predictions: Prediction[]): string {
    if (predictions.length === 0) return 'No significant predictions at this time.';
    return predictions.map(p =>
      `• ${p.hazardType.replace(/_/g, ' ')}: ${(p.probability * 100).toFixed(0)}% probability [${(p.confidence * 100).toFixed(0)}% confidence]`
    ).join('\n');
  }
}

export const predictor = new Predictor();
