import { FlowPredictor, type FlowPrediction, type FlowPredictionInput } from './flowPredictor';
import { logger } from '../../observability/logger';

export interface EnsembleMember {
  name: string;
  weight: number;
  accuracy: number;
  recentAccuracy: number[];
  domain: string;
}

export interface EnsemblePrediction {
  hazardType: string;
  ensembleProbability: number;
  memberPredictions: Array<{ member: string; probability: number; weight: number }>;
  variance: number;
  confidence: number;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  contributingFactors: string[];
}

export class EnsembleFlow {
  private members: EnsembleMember[] = [];
  private predictors: Map<string, FlowPredictor> = new Map();

  constructor() {
    const domains = ['seismic', 'weather', 'fire', 'flood'];
    for (const domain of domains) {
      const predictor = new FlowPredictor();
      this.predictors.set(domain, predictor);
      this.members.push({
        name: `EarthGen-${domain}`,
        weight: 1 / domains.length,
        accuracy: 0.7,
        recentAccuracy: [],
        domain,
      });
    }
  }

  init(): void {
    for (const [, pred] of this.predictors) {
      pred.init();
    }
    logger.info({ memberCount: this.members.length }, 'EnsembleFlow initialized');
  }

  async predict(input: FlowPredictionInput): Promise<EnsemblePrediction[]> {
    const allPredictions: Map<string, Array<{ member: string; pred: FlowPrediction; weight: number }>> = new Map();

    for (const member of this.members) {
      const pred = this.predictors.get(member.domain);
      if (!pred) continue;

      try {
        const results = await pred.predict(input);
        for (const result of results) {
          if (!allPredictions.has(result.hazardType)) {
            allPredictions.set(result.hazardType, []);
          }
          allPredictions.get(result.hazardType)!.push({
            member: member.name,
            pred: result,
            weight: member.weight,
          });
        }
      } catch (e) {
        logger.warn({ member: member.name, err: e }, 'Ensemble member prediction failed');
      }
    }

    const ensemblePredictions: EnsemblePrediction[] = [];

    for (const [hazardType, memberPreds] of allPredictions) {
      const totalWeight = memberPreds.reduce((s, m) => s + m.weight, 0);
      const weightedProb = memberPreds.reduce((s, m) => s + m.pred.probability * m.weight, 0) / totalWeight;

      const probabilities = memberPreds.map(m => m.pred.probability);
      const mean = probabilities.reduce((s, p) => s + p, 0) / probabilities.length;
      const variance = probabilities.reduce((s, p) => s + (p - mean) ** 2, 0) / probabilities.length;

      const avgConfidence = memberPreds.reduce((s, m) => s + m.pred.confidence * m.weight, 0) / totalWeight;
      const ensembleConfidence = avgConfidence * (1 - variance * 2);

      const severities = memberPreds.map(m => m.pred.severity);
      const severityOrder = { low: 0, medium: 1, high: 2, extreme: 3 };
      const avgSeverity = severities.reduce((s, sev) => s + severityOrder[sev], 0) / severities.length;
      const ensembleSeverity: 'low' | 'medium' | 'high' | 'extreme' =
        avgSeverity > 2.5 ? 'extreme' : avgSeverity > 1.5 ? 'high' : avgSeverity > 0.5 ? 'medium' : 'low';

      const allFactors = [...new Set(memberPreds.flatMap(m => m.pred.contributingFactors))];

      ensemblePredictions.push({
        hazardType,
        ensembleProbability: weightedProb,
        memberPredictions: memberPreds.map(m => ({
          member: m.member,
          probability: m.pred.probability,
          weight: m.weight,
        })),
        variance,
        confidence: ensembleConfidence,
        severity: ensembleSeverity,
        contributingFactors: allFactors,
      });
    }

    return ensemblePredictions.sort((a, b) => b.ensembleProbability - a.ensembleProbability);
  }

  recordOutcome(domain: string, actualProbability: number, occurred: boolean): void {
    const member = this.members.find(m => m.domain === domain);
    if (!member) return;

    const error = Math.abs(actualProbability - (occurred ? 1 : 0));
    const accuracy = 1 - error;
    member.recentAccuracy.push(accuracy);
    if (member.recentAccuracy.length > 50) member.recentAccuracy.shift();

    member.accuracy = member.recentAccuracy.reduce((s, a) => s + a, 0) / Math.max(1, member.recentAccuracy.length);
    member.weight = member.accuracy / this.members.reduce((s, m) => s + m.accuracy, 0);

    logger.info({ domain, accuracy: member.accuracy, weight: member.weight }, 'Ensemble weight updated');
  }

  getWeights(): Array<{ member: string; weight: number; accuracy: number; domain: string }> {
    return this.members.map(m => ({
      member: m.name,
      weight: m.weight,
      accuracy: m.accuracy,
      domain: m.domain,
    }));
  }
}

export const ensembleFlow = new EnsembleFlow();
