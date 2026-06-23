import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { causalGraph, type InferenceEvidence } from './causalGraph';
import { physicsNN } from './physicsNN';
import { omninet } from '../ai-router/omninet';
import { tryJsonParse } from '../utils/jsonParse';

// ── Types ───────────────────────────────────────────────────────

export interface DomainPrediction {
  hazardType: string;
  probability: number;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  timeframe: string;
  confidence: number;
  confidenceInterval: [number, number];
  contributingFactors: string[];
  source: 'physics' | 'statistical' | 'pattern' | 'causal' | 'llm';
}

export interface EnsembleInput {
  location: { lat: number; lon: number; label?: string };
  layers: string[];
  history: Array<{ timestamp: string; value: number; type: string }>;
  query?: string;
}

interface ModelWeight {
  domain: string;
  physicsWeight: number;
  statisticalWeight: number;
  patternWeight: number;
  causalWeight: number;
  llmWeight: number;
  lastUpdated: number;
}

// ── EnsemblePredictor ───────────────────────────────────────────

const DEFAULT_WEIGHTS: ModelWeight = {
  domain: 'default',
  physicsWeight: 0.3,
  statisticalWeight: 0.25,
  patternWeight: 0.25,
  causalWeight: 0.1,
  llmWeight: 0.1,
  lastUpdated: Date.now(),
};

const DOMAIN_WEIGHTS: Record<string, Partial<ModelWeight>> = {
  earthquake: { physicsWeight: 0.4, statisticalWeight: 0.2, patternWeight: 0.2, causalWeight: 0.15, llmWeight: 0.05 },
  tsunami: { physicsWeight: 0.35, statisticalWeight: 0.15, patternWeight: 0.15, causalWeight: 0.25, llmWeight: 0.1 },
  wildfire: { physicsWeight: 0.25, statisticalWeight: 0.2, patternWeight: 0.3, causalWeight: 0.1, llmWeight: 0.15 },
  severe_weather: { physicsWeight: 0.3, statisticalWeight: 0.25, patternWeight: 0.15, causalWeight: 0.15, llmWeight: 0.15 },
  flood: { physicsWeight: 0.2, statisticalWeight: 0.3, patternWeight: 0.25, causalWeight: 0.15, llmWeight: 0.1 },
};

export class EnsemblePredictor {
  private weights = new Map<string, ModelWeight>();
  private patterns: Array<{ pattern: string; outcome: string; accuracy: number; occurrences: number }> = [];

  init(): void {
    this.loadWeights();
    this.loadPatterns();
    logger.info('EnsemblePredictor initialized');
  }

  async predict(input: EnsembleInput): Promise<DomainPrediction[]> {
    const predictions: DomainPrediction[] = [];

    // 1. Physics model
    const physicsPreds = this.runPhysics(input);
    predictions.push(...physicsPreds);

    // 2. Statistical (trend analysis)
    const statPreds = this.runStatistical(input);
    predictions.push(...statPreds);

    // 3. Pattern matching
    const patternPreds = this.runPatternMatch(input);
    predictions.push(...patternPreds);

    // 4. Causal inference
    const causalPreds = await this.runCausalInference(input);
    predictions.push(...causalPreds);

    // 5. LLM reasoning (only for query-based)
    if (input.query) {
      const llmPreds = await this.runLLMReasoning(input);
      predictions.push(...llmPreds);
    }

    // Ensemble: merge by hazard type with weighted average
    const merged = this.ensembleMerge(predictions);

    // Add confidence intervals
    for (const pred of merged) {
      pred.confidenceInterval = this.computeConfidenceInterval(pred);
    }

    return merged.slice(0, 8);
  }

  private runPhysics(input: EnsembleInput): DomainPrediction[] {
    const results: DomainPrediction[] = [];

    const layers = new Set(input.layers.map(l => l.toLowerCase()));

    if (layers.has('seismic') || layers.has('earthquake')) {
      const seismicPreds = physicsNN.predictSeismic(6.0, 10, 30);
      for (const sp of seismicPreds) {
        results.push({
          hazardType: sp.hazardType,
          probability: physicsNN.hybridPredict(sp, 0.6, 0),
          severity: sp.probability > 0.5 ? 'high' : sp.probability > 0.3 ? 'medium' : 'low',
          timeframe: '7 days',
          confidence: sp.physicsConfidence * 0.7 + 0.1,
          confidenceInterval: [0, 0],
          contributingFactors: sp.equations,
          source: 'physics',
        });
      }
    }

    if (layers.has('weather') || layers.has('storms')) {
      const weatherPreds = physicsNN.predictWeather(25, 60, 1010, 10);
      for (const wp of weatherPreds) {
        results.push({
          hazardType: wp.hazardType,
          probability: physicsNN.hybridPredict(wp, 0.5, 0),
          severity: wp.probability > 0.4 ? 'medium' : 'low',
          timeframe: '24-48 hours',
          confidence: wp.physicsConfidence,
          confidenceInterval: [0, 0],
          contributingFactors: wp.equations,
          source: 'physics',
        });
      }
    }

    if (layers.has('fire_risk') || layers.has('wildfires')) {
      const firePreds = physicsNN.predictFire(30, 25, 15, 10, 300);
      for (const fp of firePreds) {
        results.push({
          hazardType: fp.hazardType,
          probability: physicsNN.hybridPredict(fp, 0.55, 0),
          severity: fp.probability > 0.5 ? 'high' : fp.probability > 0.3 ? 'medium' : 'low',
          timeframe: '72 hours',
          confidence: fp.physicsConfidence,
          confidenceInterval: [0, 0],
          contributingFactors: fp.equations,
          source: 'physics',
        });
      }
    }

    return results;
  }

  private runStatistical(input: EnsembleInput): DomainPrediction[] {
    const results: DomainPrediction[] = [];
    const byType = new Map<string, number[]>();

    for (const h of input.history) {
      if (!byType.has(h.type)) byType.set(h.type, []);
      byType.get(h.type)!.push(h.value);
    }

    for (const [type, values] of byType) {
      if (values.length < 3) continue;
      const recent = values.slice(-3);
      const trend = recent[recent.length - 1] - recent[0];
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
      const stdDev = Math.sqrt(variance);

      if (Math.abs(trend) > stdDev * 1.2) {
        const prob = Math.min(0.85, 0.2 + Math.abs(trend) / (avg || 1) * 0.4);
        const weight = this.getEnsembleWeight(type);
        results.push({
          hazardType: `${type}_trend`,
          probability: Math.round(prob * weight.statisticalWeight * 100) / 100,
          severity: prob > 0.6 ? 'high' : prob > 0.4 ? 'medium' : 'low',
          timeframe: '6-12 hours',
          confidence: Math.min(0.7, 0.2 + values.length * 0.03),
          confidenceInterval: [0, 0],
          contributingFactors: [
            `${type} ${trend > 0 ? 'up' : 'down'} ${Math.abs(trend).toFixed(2)} over ${values.length} points`,
            `mean=${avg.toFixed(2)}, std=${stdDev.toFixed(2)}`,
          ],
          source: 'statistical',
        });
      }
    }

    return results;
  }

  private runPatternMatch(_input: EnsembleInput): DomainPrediction[] {
    const results: DomainPrediction[] = [];

    for (const pattern of this.patterns) {
      if (pattern.occurrences < 2) continue;

      const prob = pattern.accuracy * (1 - 1 / (pattern.occurrences + 2));
      if (prob > 0.2) {
        const hazardType = pattern.outcome.toLowerCase().replace(/\s+/g, '_');
        const weight = this.getEnsembleWeight(hazardType);
        const weightedProb = prob * (weight.patternWeight * 2 + 0.5);

        results.push({
          hazardType,
          probability: Math.min(0.95, Math.round(weightedProb * 100) / 100),
          severity: weightedProb > 0.6 ? 'high' : weightedProb > 0.4 ? 'medium' : 'low',
          timeframe: '24-48 hours',
          confidence: Math.min(0.85, pattern.accuracy * 0.7 + Math.log10(pattern.occurrences + 1) * 0.1),
          confidenceInterval: [0, 0],
          contributingFactors: [
            `matches "${pattern.pattern.slice(0, 80)}" (${pattern.occurrences}x)`,
            `historical accuracy: ${(pattern.accuracy * 100).toFixed(0)}%`,
          ],
          source: 'pattern',
        });
      }
    }

    return results;
  }

  private async runCausalInference(input: EnsembleInput): Promise<DomainPrediction[]> {
    const results: DomainPrediction[] = [];
    const evidence: InferenceEvidence[] = [];

    // Build evidence from input
    const layers = new Set(input.layers.map(l => l.toLowerCase()));
    if (layers.has('seismic')) {
      evidence.push({ nodeName: 'plate_stress', observed: true, confidence: 0.5 });
    }
    if (layers.has('weather') || layers.has('storms')) {
      evidence.push({ nodeName: 'low_pressure', observed: true, confidence: 0.4 });
    }
    if (layers.has('fire_risk') || layers.has('wildfires')) {
      evidence.push({ nodeName: 'high_temperature', observed: true, confidence: 0.5 });
      evidence.push({ nodeName: 'drought', observed: true, confidence: 0.4 });
    }

    if (evidence.length === 0) return results;

    const posteriors = causalGraph.infer(evidence);
    for (const post of posteriors) {
      const severity: DomainPrediction['severity'] =
        post.posterior > 0.6 ? 'high' : post.posterior > 0.35 ? 'medium' : 'low';

      results.push({
        hazardType: post.nodeName,
        probability: Math.min(0.95, Math.round(post.posterior * 100) / 100),
        severity,
        timeframe: 'variable',
        confidence: post.confidence,
        confidenceInterval: [Math.max(0, post.posterior - 0.15), Math.min(1, post.posterior + 0.15)],
        contributingFactors: post.contributingPaths.slice(0, 3).map(p => p.path),
        source: 'causal',
      });
    }

    return results;
  }

  private async runLLMReasoning(input: EnsembleInput): Promise<DomainPrediction[]> {
    if (!input.query) return [];

    const prompt = `You are a hazard prediction analyst. Based on the following information, predict likely hazards.

Location: ${input.location.label || `${input.location.lat},${input.location.lon}`}
Active data layers: ${input.layers.join(', ') || 'none'}
User query: "${input.query.replace(/"/g, '\\"')}"

Return ONLY valid JSON array of predictions:
[{"hazardType":"...","probability":0.0,"severity":"low|medium|high|extreme","timeframe":"...","reasoning":"..."}]

Maximum 3 predictions. Base on earth science knowledge.`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.2, maxTokens: 1024 });
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = tryJsonParse<Array<{ hazardType: string; probability: number; severity: string; timeframe: string; reasoning: string }>>(jsonMatch[0]);
      if (!parsed) return [];
      return parsed.slice(0, 3).map(p => ({
        hazardType: p.hazardType.toLowerCase().replace(/\s+/g, '_'),
        probability: Math.min(0.95, Math.max(0.05, p.probability)),
        severity: p.severity as DomainPrediction['severity'],
        timeframe: p.timeframe || 'unknown',
        confidence: 0.3,
        confidenceInterval: [Math.max(0, p.probability - 0.2), Math.min(1, p.probability + 0.2)],
        contributingFactors: [p.reasoning],
        source: 'llm' as const,
      }));
    } catch {
      return [];
    }
  }

  private ensembleMerge(predictions: DomainPrediction[]): DomainPrediction[] {
    const byHazard = new Map<string, DomainPrediction[]>();

    for (const pred of predictions) {
      if (!byHazard.has(pred.hazardType)) byHazard.set(pred.hazardType, []);
      byHazard.get(pred.hazardType)!.push(pred);
    }

    const merged: DomainPrediction[] = [];
    for (const [hazardType, preds] of byHazard) {
      const weight = this.getEnsembleWeight(hazardType);
      let totalWeight = 0;
      let weightedProb = 0;
      let maxConfidence = 0;
      let worstSeverity: DomainPrediction['severity'] = 'low';
      const allFactors: string[] = [];

      for (const pred of preds) {
        let w = 0;
        switch (pred.source) {
          case 'physics': w = weight.physicsWeight; break;
          case 'statistical': w = weight.statisticalWeight; break;
          case 'pattern': w = weight.patternWeight; break;
          case 'causal': w = weight.causalWeight; break;
          case 'llm': w = weight.llmWeight; break;
        }

        totalWeight += w;
        weightedProb += pred.probability * w;
        maxConfidence = Math.max(maxConfidence, pred.confidence);
        allFactors.push(...pred.contributingFactors);

        const severityOrder = ['low', 'medium', 'high', 'extreme'];
        if (severityOrder.indexOf(pred.severity) > severityOrder.indexOf(worstSeverity)) {
          worstSeverity = pred.severity;
        }
      }

      const finalProb = totalWeight > 0 ? weightedProb / totalWeight : 0.5;
      merged.push({
        hazardType,
        probability: Math.min(0.99, Math.round(finalProb * 100) / 100),
        severity: worstSeverity,
        timeframe: preds[0]?.timeframe || 'unknown',
        confidence: maxConfidence,
        confidenceInterval: [0, 0],
        contributingFactors: [...new Set(allFactors)].slice(0, 5),
        source: 'statistical',
      });
    }

    return merged.sort((a, b) => b.probability - a.probability);
  }

  private computeConfidenceInterval(prediction: DomainPrediction): [number, number] {
    const halfWidth = (1 - prediction.confidence) * 0.3;
    return [
      Math.max(0, Math.round((prediction.probability - halfWidth) * 100) / 100),
      Math.min(1, Math.round((prediction.probability + halfWidth) * 100) / 100),
    ];
  }

  private getEnsembleWeight(domain: string): ModelWeight {
    const key = Object.keys(DOMAIN_WEIGHTS).find(d => domain.includes(d)) || 'default';
    const domainW = DOMAIN_WEIGHTS[key] || {};
    const cached = this.weights.get(domain);
    if (cached) return cached;

    const weight: ModelWeight = {
      ...DEFAULT_WEIGHTS,
      ...domainW,
      domain,
      lastUpdated: Date.now(),
    };
    this.weights.set(domain, weight);
    return weight;
  }

  updateWeights(domain: string, source: keyof ModelWeight, delta: number): void {
    const weight = this.getEnsembleWeight(domain);
    const oldVal = weight[source] as number;
    (weight as Record<string, unknown>)[source] = Math.max(0.05, Math.min(0.8, oldVal + delta));

    // Normalize
    const total = weight.physicsWeight + weight.statisticalWeight + weight.patternWeight + weight.causalWeight + weight.llmWeight;
    weight.physicsWeight /= total;
    weight.statisticalWeight /= total;
    weight.patternWeight /= total;
    weight.causalWeight /= total;
    weight.llmWeight /= total;
    weight.lastUpdated = Date.now();

    this.weights.set(domain, weight);
    this.persistWeights();
  }

  private loadWeights(): void {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT * FROM config WHERE key LIKE 'ensemble_weight_%'").all() as Array<{ key: string; value: string }>;
      for (const row of rows) {
        const domain = row.key.replace('ensemble_weight_', '');
        this.weights.set(domain, tryJsonParse(row.value, 0) as number);
      }
    } catch { /* no weights yet */ }
  }

  private persistWeights(): void {
    try {
      const db = getDb();
      for (const [domain, weight] of this.weights) {
        db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run(`ensemble_weight_${domain}`, JSON.stringify(weight));
      }
    } catch { /* silent */ }
  }

  private loadPatterns(): void {
    try {
      const db = getDb();
      this.patterns = db.prepare('SELECT * FROM historical_patterns WHERE occurrences > 1 ORDER BY occurrences DESC LIMIT 500').all() as Array<{ pattern: string; outcome: string; accuracy: number; occurrences: number }>;
    } catch {
      this.patterns = [];
    }
  }

  recordOutcome(hazardType: string, predicted: DomainPrediction, actualOccurred: boolean): void {
    const correct = (predicted.probability >= 0.5) === actualOccurred;

    // Adjust weights based on prediction accuracy
    if (correct) {
      this.updateWeights(hazardType, predicted.source as keyof ModelWeight, 0.02);
    } else {
      this.updateWeights(hazardType, predicted.source as keyof ModelWeight, -0.01);
    }
  }
}

export const ensemblePredictor = new EnsemblePredictor();
