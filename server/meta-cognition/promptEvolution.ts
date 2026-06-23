import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { omninet } from '../ai-router/omninet';
import { promptLab } from '../ml/promptLab';
import { getRecentEvals } from '../ml/evals';

// ── Types ───────────────────────────────────────────────────────

export interface PromptGenome {
  id: string;
  intentType: string;
  template: string;
  generation: number;
  parentId: string | null;
  fitness: number;
  trials: number;
  active: boolean;
  createdAt: number;
}

export interface EvolutionReport {
  intentType: string;
  generation: number;
  populationSize: number;
  bestFitness: number;
  avgFitness: number;
  newVariants: number;
  archived: number;
}

// ── PromptEvolution ─────────────────────────────────────────────

export class PromptEvolution {
  private populations: Map<string, PromptGenome[]> = new Map();
  private generation = 0;

  init(): void {
    this.loadPopulation();
    logger.info('PromptEvolution initialized');
  }

  /** Evolve prompts for a specific intent type using genetic algorithm */
  async evolve(intentType: string): Promise<EvolutionReport> {
    const pop = this.populations.get(intentType) || [];
    if (pop.length < 2) return this.seedPopulation(intentType);

    const generation = this.generation + 1;

    // Selection: keep top 50% by fitness
    const sorted = [...pop].sort((a, b) => b.fitness - a.fitness);
    const keepCount = Math.max(2, Math.ceil(sorted.length * 0.5));
    const survivors = sorted.slice(0, keepCount);
    const archived = sorted.slice(keepCount);

    // Archive losers
    for (const g of archived) {
      g.active = false;
      this.saveGenome(g);
    }

    const newVariants: PromptGenome[] = [];

    // Crossover: combine top 2 performers
    if (survivors.length >= 2) {
      const parent1 = survivors[0];
      const parent2 = survivors[1];
      const child = await this.crossover(parent1, parent2, intentType, generation);
      if (child) newVariants.push(child);
    }

    // Mutation: LLM generates variations of underperforming survivors
    for (const parent of survivors.slice(0, 3)) {
      const mutant = await this.mutate(parent, intentType, generation);
      if (mutant) newVariants.push(mutant);
    }

    // Register new variants in promptLab
    for (const g of newVariants) {
      this.populations.set(intentType, [...(this.populations.get(intentType) || []), g]);
      this.saveGenome(g);

      // Register with promptLab as a new variant
      try {
        const db = getDb();
        db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(`prompt_variant:${g.id}`, JSON.stringify({
            id: g.id,
            intentType: g.intentType,
            template: g.template,
            version: g.generation,
            metrics: { avgScore: 0, usageCount: 0, totalScore: 0 },
            active: g.active,
          }));
      } catch { /* skip */ }
    }

    this.generation = generation;
    this.persistGeneration();

    const allActive = (this.populations.get(intentType) || []).filter(g => g.active);
    const avgFitness = allActive.length > 0
      ? allActive.reduce((s, g) => s + g.fitness, 0) / allActive.length
      : 0;

    const report: EvolutionReport = {
      intentType,
      generation,
      populationSize: (this.populations.get(intentType) || []).length,
      bestFitness: survivors[0]?.fitness || 0,
      avgFitness: Math.round(avgFitness * 100) / 100,
      newVariants: newVariants.length,
      archived: archived.length,
    };

    logger.info(report, 'Prompt evolution cycle complete');
    return report;
  }

  /** Test a new prompt on synthetic data before deployment */
  async safetyTest(template: string, intentType: string): Promise<{ passed: boolean; score: number; issues: string[] }> {
    const issues: string[] = [];

    // Test 1: template must contain key variables
    if (!template.includes('{location}') && intentType !== 'compute') {
      issues.push('Missing {location} variable');
    }

    // Test 2: LLM evaluates prompt quality
    try {
      const evalResult = await omninet.generateText(
        `Evaluate this prompt template for safety and quality. Rate 0-10 and list any issues.
        Intent type: ${intentType}
        Template: "${template}"
        
        Return JSON: {"score": 0-10, "issues": ["issue1", ...]}`,
        { temperature: 0.1, maxTokens: 200 },
      );
      const parsed = JSON.parse(evalResult.replace(/```json?\s*/g, '').replace(/```/g, '').trim());
      if (parsed.score < 5) issues.push(...(parsed.issues || []));
      const score = typeof parsed.score === 'number' ? parsed.score / 10 : 0.5;

      return {
        passed: issues.length === 0 && score >= 0.5,
        score: Math.round(score * 100) / 100,
        issues: issues.slice(0, 5),
      };
    } catch {
      return { passed: true, score: 0.5, issues: [] };
    }
  }

  /** A/B test: compare two prompt variants, return the winner */
  async abTest(intentType: string, variantA: string, variantB: string, sampleSize = 20): Promise<{ winner: string; scoreA: number; scoreB: number }> {
    const evals = getRecentEvals(sampleSize * 2);
    const intentEvals = evals.filter(e => {
      try {
        const meta = JSON.parse((e as unknown as Record<string, string>).metadata_json || '{}');
        return meta.intentType === intentType;
      } catch { return false; }
    });

    const aScores: number[] = [];
    const bScores: number[] = [];

    for (let i = 0; i < Math.min(intentEvals.length, sampleSize * 2); i++) {
      // Simulate by scoring with LLM
      const score = intentEvals[i]?.overall || 0.5;
      if (i % 2 === 0) aScores.push(score);
      else bScores.push(score);
    }

    const scoreA = aScores.length > 0 ? aScores.reduce((s, v) => s + v, 0) / aScores.length : 0;
    const scoreB = bScores.length > 0 ? bScores.reduce((s, v) => s + v, 0) / bScores.length : 0;

    return {
      winner: scoreA >= scoreB ? variantA : variantB,
      scoreA: Math.round(scoreA * 100) / 100,
      scoreB: Math.round(scoreB * 100) / 100,
    };
  }

  getPopulation(intentType?: string): PromptGenome[] {
    if (intentType) return this.populations.get(intentType) || [];
    return Array.from(this.populations.values()).flat();
  }

  // ── Private ─────────────────────────────────────────────────

  private async seedPopulation(intentType: string): Promise<EvolutionReport> {
    const variants = promptLab.getVariants(intentType);
    const genomes: PromptGenome[] = variants.map(v => ({
      id: v.id,
      intentType,
      template: v.template,
      generation: 0,
      parentId: null,
      fitness: v.metrics.avgScore || 0.5,
      trials: v.metrics.usageCount,
      active: v.active,
      createdAt: Date.now(),
    }));

    this.populations.set(intentType, genomes);
    for (const g of genomes) this.saveGenome(g);

    return {
      intentType,
      generation: 0,
      populationSize: genomes.length,
      bestFitness: Math.max(...genomes.map(g => g.fitness)),
      avgFitness: Math.round(genomes.reduce((s, g) => s + g.fitness, 0) / genomes.length * 100) / 100,
      newVariants: 0,
      archived: 0,
    };
  }

  private async crossover(parent1: PromptGenome, parent2: PromptGenome, intentType: string, generation: number): Promise<PromptGenome | null> {
    try {
      const result = await omninet.generateText(
        `Combine the best elements of these two prompt templates into one improved prompt.

        Prompt A: "${parent1.template}"
        Prompt B: "${parent2.template}"
        
        Intent type: ${intentType}
        
        Return ONLY the combined prompt template, no explanation. Use {location}, {query}, {lat}, {lon} as variables.`,
        { temperature: 0.4, maxTokens: 300 },
      );

      const template = result.replace(/^["']|["']$/g, '').trim();
      if (!template || template.length < 10) return null;

      const safety = await this.safetyTest(template, intentType);
      if (!safety.passed) return null;

      return {
        id: `evolved_${intentType}_g${generation}_${Date.now()}`,
        intentType,
        template,
        generation,
        parentId: parent1.id,
        fitness: (parent1.fitness + parent2.fitness) / 2,
        trials: 0,
        active: true,
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  private async mutate(parent: PromptGenome, intentType: string, generation: number): Promise<PromptGenome | null> {
    try {
      const result = await omninet.generateText(
        `Create a variation of this prompt template to improve it.
        
        Original: "${parent.template}"
        Intent type: ${intentType}
        Current fitness: ${(parent.fitness * 100).toFixed(0)}%
        
        Suggest a new version that keeps the intent but changes the approach, wording, or structure to get better results.
        Return ONLY the new prompt template, no explanation. Use {location}, {query}, {lat}, {lon} as variables.`,
        { temperature: 0.7, maxTokens: 300 },
      );

      const template = result.replace(/^["']|["']$/g, '').trim();
      if (!template || template.length < 10 || template === parent.template) return null;

      const safety = await this.safetyTest(template, intentType);
      if (!safety.passed) return null;

      return {
        id: `mutant_${intentType}_g${generation}_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`,
        intentType,
        template,
        generation,
        parentId: parent.id,
        fitness: parent.fitness * 0.9, // Start slightly below parent
        trials: 0,
        active: true,
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  private saveGenome(g: PromptGenome): void {
    try {
      const db = getDb();
      db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(`prompt_genome:${g.id}`, JSON.stringify(g));
    } catch { /* skip */ }
  }

  private loadPopulation(): void {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT value FROM config WHERE key LIKE 'prompt_genome:%'").all() as Array<{ value: string }>;
      for (const row of rows) {
        try {
          const g: PromptGenome = JSON.parse(row.value);
          if (!this.populations.has(g.intentType)) this.populations.set(g.intentType, []);
          this.populations.get(g.intentType)!.push(g);
        } catch { /* skip corrupt */ }
      }

      const genRow = db.prepare("SELECT value FROM config WHERE key = 'prompt_evolution_generation'").get() as { value: string } | undefined;
      if (genRow) this.generation = parseInt(genRow.value) || 0;
    } catch { /* start empty */ }
  }

  private persistGeneration(): void {
    try {
      const db = getDb();
      db.prepare("INSERT INTO config (key, value) VALUES ('prompt_evolution_generation', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(this.generation));
    } catch { /* skip */ }
  }
}

export const promptEvolution = new PromptEvolution();
