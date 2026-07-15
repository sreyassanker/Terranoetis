/**
 * AI Decision Support Engine
 * Provides LLM-powered Course of Action (COA) recommendations,
 * threat assessment scoring, and predictive analysis for military operations.
 *
 * Integrates with the existing AI provider (Gemini/Anthropic/local)
 * through the server's /api/ai endpoint.
 */

export interface ThreatAssessment {
  id: string;
  threatId: string;
  threatName: string;
  category: 'air' | 'surface' | 'subsurface' | 'ground' | 'cyber' | 'space';
  severity: 'critical' | 'high' | 'medium' | 'low';
  score: number;          // 0-100 composite score
  factors: ThreatFactor[];
  recommendation: string;
  timestamp: number;
}

export interface ThreatFactor {
  name: string;
  value: number;          // 0-1
  weight: number;         // 0-1
  description: string;
}

export interface CourseOfAction {
  id: string;
  name: string;
  type: 'offensive' | 'defensive' | 'contingency' | 'stability';
  description: string;
  phases: CoaPhase[];
  riskScore: number;       // 0-100 (lower = less risk)
  successProbability: number; // 0-1
  resourceRequirements: ResourceRequirement[];
  estimatedDuration: string;
  generatedAt: number;
}

export interface CoaPhase {
  name: string;
  description: string;
  tasks: string[];
  duration: string;
}

export interface ResourceRequirement {
  type: string;
  quantity: number;
  unit: string;
  priority: 'immediate' | 'near_term' | 'sustained';
}

export interface PredictiveAnalysis {
  id: string;
  type: 'enemy_movement' | 'escalation' | 'casualty_estimate' | 'logistics';
  prediction: string;
  confidence: number;      // 0-1
  timeHorizon: string;     // e.g., "6 hours", "24 hours"
  factors: string[];
  generatedAt: number;
}

export interface DecisionSupportState {
  assessments: ThreatAssessment[];
  coas: CourseOfAction[];
  predictions: PredictiveAnalysis[];
  isAnalyzing: boolean;
  lastUpdate: number;
}

/**
 * AIService - Client-side interface for AI decision support
 */
export class AIService {
  private apiBase = '/api';
  private analysisCallbacks: Array<(state: DecisionSupportState) => void> = [];
  private state: DecisionSupportState = {
    assessments: [],
    coas: [],
    predictions: [],
    isAnalyzing: false,
    lastUpdate: 0,
  };

  /** Register callback for state updates */
  onStateChange(callback: (state: DecisionSupportState) => void): void {
    this.analysisCallbacks.push(callback);
  }

  /** Get current state */
  getState(): DecisionSupportState {
    return { ...this.state };
  }

  /**
   * Analyze threats and generate threat assessments
   * Uses the server's AI endpoint to analyze current COP data
   */
  async analyzeThreats(threats: any[], assets: any[]): Promise<ThreatAssessment[]> {
    this.state.isAnalyzing = true;
    this.notifyState();

    try {
      const prompt = this.buildThreatAnalysisPrompt(threats, assets);
      const response = await this.callAI(prompt, 'threat_analysis');
      const assessments = this.parseThreatAssessments(response, threats);
      
      this.state.assessments = assessments;
      this.state.lastUpdate = Date.now();
      return assessments;
    } catch (err) {
      console.error('[AI Decision] Threat analysis failed:', err);
      // Fallback to rule-based assessment
      return this.ruleBasedThreatAssessment(threats);
    } finally {
      this.state.isAnalyzing = false;
      this.notifyState();
    }
  }

  /**
   * Generate Course of Action recommendations
   * Analyzes the current tactical situation and suggests COAs
   */
  async generateCoas(situation: {
    threats: any[];
    friendlyForces: any[];
    terrain: string;
    objectives: string[];
  }): Promise<CourseOfAction[]> {
    this.state.isAnalyzing = true;
    this.notifyState();

    try {
      const prompt = this.buildCoaPrompt(situation);
      const response = await this.callAI(prompt, 'coa_generation');
      const coas = this.parseCoas(response);
      
      this.state.coas = coas;
      this.state.lastUpdate = Date.now();
      return coas;
    } catch (err) {
      console.error('[AI Decision] COA generation failed:', err);
      return this.ruleBasedCoas(situation);
    } finally {
      this.state.isAnalyzing = false;
      this.notifyState();
    }
  }

  /**
   * Generate predictive analysis
   * Forecasts enemy actions, escalation patterns, etc.
   */
  async predict(recentEvents: any[], currentPosture: string): Promise<PredictiveAnalysis[]> {
    this.state.isAnalyzing = true;
    this.notifyState();

    try {
      const prompt = this.buildPredictivePrompt(recentEvents, currentPosture);
      const response = await this.callAI(prompt, 'prediction');
      const predictions = this.parsePredictions(response);
      
      this.state.predictions = predictions;
      this.state.lastUpdate = Date.now();
      return predictions;
    } catch (err) {
      console.error('[AI Decision] Prediction failed:', err);
      return [];
    } finally {
      this.state.isAnalyzing = false;
      this.notifyState();
    }
  }

  /* ── Prompt Builders ────────────────────────────────────── */

  private buildThreatAnalysisPrompt(threats: any[], assets: any[]): string {
    return `You are a military threat assessment AI. Analyze the following threats and provide composite threat scores.

THREATS:
${JSON.stringify(threats.slice(0, 20), null, 2)}

FRIENDLY ASSETS:
${JSON.stringify(assets.slice(0, 10), null, 2)}

For each threat, provide:
1. Composite score (0-100) based on: proximity to assets, capability, intent, opportunity
2. Severity rating (critical/high/medium/low)
3. Key contributing factors
4. Recommended response

Return JSON array of assessments.`;
  }

  private buildCoaPrompt(situation: { threats: any[]; friendlyForces: any[]; terrain: string; objectives: string[] }): string {
    return `You are a military Course of Action (COA) planning AI. Generate 2-3 COAs for the current situation.

SITUATION:
- Threats: ${JSON.stringify(situation.threats.slice(0, 10))}
- Friendly Forces: ${JSON.stringify(situation.friendlyForces.slice(0, 10))}
- Terrain: ${situation.terrain}
- Objectives: ${situation.objectives.join(', ')}

For each COA, provide:
1. Name and type (offensive/defensive/contingency/stability)
2. 2-3 phases with tasks
3. Risk score (0-100)
4. Success probability (0-1)
5. Resource requirements
6. Estimated duration

Return JSON array of COAs.`;
  }

  private buildPredictivePrompt(events: any[], posture: string): string {
    return `You are a military predictive analysis AI. Forecast likely enemy actions.

RECENT EVENTS:
${JSON.stringify(events.slice(0, 20), null, 2)}

CURRENT POSTURE: ${posture}

Provide predictions for:
1. Enemy movement (next 6-24 hours)
2. Escalation probability
3. Casualty estimates
4. Logistics impact

Return JSON array of predictions with confidence scores.`;
  }

  /* ── AI API Call ────────────────────────────────────────── */

  private async callAI(prompt: string, task: string): Promise<string> {
    const response = await fetch(`${this.apiBase}/ai/gemini`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, task, system: 'You are a military decision support AI. Always respond with valid JSON.' }),
    });
    if (!response.ok) throw new Error(`AI API error: ${response.status}`);
    const data = await response.json();
    return data.response || data.text || '';
  }

  /* ── Parsers ────────────────────────────────────────────── */

  private parseThreatAssessments(response: string, threats: any[]): ThreatAssessment[] {
    try {
      const json = this.extractJson(response);
      if (Array.isArray(json)) return json;
    } catch { /* fallback */ }
    return this.ruleBasedThreatAssessment(threats);
  }

  private parseCoas(response: string): CourseOfAction[] {
    const json = this.extractJson(response);
    if (Array.isArray(json)) return json.map((c: any) => ({
      ...c,
      id: c.id || `coa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      generatedAt: Date.now(),
    }));
    return [];
  }

  private parsePredictions(response: string): PredictiveAnalysis[] {
    const json = this.extractJson(response);
    if (Array.isArray(json)) return json.map((p: any) => ({
      ...p,
      id: p.id || `pred-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      generatedAt: Date.now(),
    }));
    return [];
  }

  private extractJson(text: string): any {
    // Try to extract JSON from markdown code blocks
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]);
    // Try direct JSON parse
    return JSON.parse(text);
  }

  /* ── Rule-Based Fallbacks ───────────────────────────────── */

  private ruleBasedThreatAssessment(threats: any[]): ThreatAssessment[] {
    return threats.map(t => {
      const severityScore: Record<string, number> = { critical: 90, high: 70, medium: 40, low: 20 };
      const score = severityScore[t.severity] || 50;
      return {
        id: `ta-${t.id}`,
        threatId: t.id,
        threatName: t.name,
        category: t.type || 'unknown',
        severity: t.severity || 'medium',
        score,
        factors: [
          { name: 'Severity', value: score / 100, weight: 0.5, description: `Severity level: ${t.severity}` },
          { name: 'Position', value: 0.5, weight: 0.3, description: 'Position assessed' },
          { name: 'Intent', value: 0.4, weight: 0.2, description: 'Intent inferred from type' },
        ],
        recommendation: score > 70 ? 'Engage immediately' : score > 40 ? 'Monitor closely' : 'Track and reassess',
        timestamp: Date.now(),
      };
    });
  }

  private ruleBasedCoas(situation: { threats: any[]; friendlyForces: any[]; terrain: string; objectives: string[] }): CourseOfAction[] {
    const threatCount = situation.threats.length;
    const forceCount = situation.friendlyForces.length;
    
    return [
      {
        id: `coa-${Date.now()}-1`,
        name: 'Defensive Posture',
        type: 'defensive',
        description: 'Establish defensive positions and prepare for enemy action',
        phases: [
          { name: 'Preparation', description: 'Set up defensive positions', tasks: ['Establish OPs', 'Prepare fighting positions', 'Coordinate fires'], duration: '4 hours' },
          { name: 'Engagement', description: 'Engage enemy forces in defensive zone', tasks: ['Activate direct fire', 'Call indirect fire', 'Coordinate CAS'], duration: '2 hours' },
        ],
        riskScore: 30,
        successProbability: 0.7,
        resourceRequirements: [{ type: 'Infantry', quantity: 2, unit: 'platoons', priority: 'immediate' }],
        estimatedDuration: '6 hours',
        generatedAt: Date.now(),
      },
      {
        id: `coa-${Date.now()}-2`,
        name: 'Active Defense',
        type: 'offensive',
        description: 'Conduct主动 defense with counterattack preparation',
        phases: [
          { name: 'Recon', description: 'Gather intelligence on enemy', tasks: ['ISR tasking', 'Patrol', 'OP reporting'], duration: '2 hours' },
          { name: 'Counterattack', description: 'Exploit enemy weakness', tasks: ['Maneuver to contact', 'Fire and maneuver', 'Consolidate'], duration: '3 hours' },
        ],
        riskScore: 55,
        successProbability: 0.6,
        resourceRequirements: [{ type: 'Armor', quantity: 1, unit: 'platoon', priority: 'immediate' }],
        estimatedDuration: '5 hours',
        generatedAt: Date.now(),
      },
    ];
  }

  private notifyState(): void {
    for (const cb of this.analysisCallbacks) cb(this.state);
  }
}

/** Singleton instance */
export const aiService = new AIService();
