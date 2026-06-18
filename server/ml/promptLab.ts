import { getDb } from '../db/index';
import { logger } from '../observability/logger';

interface VariantMetrics {
  avgScore: number;
  usageCount: number;
  totalScore: number;
}

interface PromptVariant {
  id: string;
  intentType: string;
  template: string;
  version: number;
  metrics: VariantMetrics;
  active: boolean;
}

const CONFIG_PREFIX = 'prompt_variant:';

export class PromptLab {
  private variants = new Map<string, PromptVariant[]>();
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.loadFromDb();
    this.seedDefaults();
    this.initialized = true;
  }

  private loadFromDb(): void {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT value FROM config WHERE key LIKE ?").all(`${CONFIG_PREFIX}%`) as Array<{ value: string }>;
      for (const row of rows) {
        try {
          const v: PromptVariant = JSON.parse(row.value);
          if (!this.variants.has(v.intentType)) this.variants.set(v.intentType, []);
          this.variants.get(v.intentType)!.push(v);
        } catch { /* skip corrupt */ }
      }
    } catch { /* silent */ }
    logger.info({ variantCount: this.getTotalVariants() }, 'PromptLab loaded');
  }

  private seedDefaults(): void {
    const defaults: Record<string, string[]> = {
      quick_scan: [
        'Analyze the current situation at {location}. Provide a concise summary of recent events, weather, and hazards.',
        'Give me a quick status update for {location}. What earthquakes, weather events, or other notable activity is happening there?',
      ],
      weather_check: [
        'What is the current weather at {location}? Include temperature, conditions, and any active alerts.',
        'Show me the weather forecast and any severe weather alerts for {location}.',
      ],
      deep_analysis: [
        'Perform a comprehensive analysis of {location}. Include seismic activity, weather patterns, aviation traffic, and hazard risks.',
        'Give me a detailed intelligence report for {location}. Cover all available data layers and highlight significant patterns.',
      ],
      compute: [
        'Execute the following analysis: {query}. Use the sandbox to compute results and return formatted output.',
        'Run a computational analysis on this data: {query}. Use Python with numpy/pandas if needed.',
      ],
    };

    for (const [intentType, templates] of Object.entries(defaults)) {
      if (!this.variants.has(intentType) || this.variants.get(intentType)!.length === 0) {
        const arr: PromptVariant[] = [];
        for (let i = 0; i < templates.length; i++) {
          arr.push({
            id: `${intentType}_v${i + 1}`,
            intentType,
            template: templates[i],
            version: i + 1,
            metrics: { avgScore: 0, usageCount: 0, totalScore: 0 },
            active: i === 0,
          });
        }
        this.variants.set(intentType, arr);
        for (const v of arr) this.saveVariant(v);
      }
    }
  }

  private saveVariant(v: PromptVariant): void {
    try {
      const db = getDb();
      db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(`${CONFIG_PREFIX}${v.id}`, JSON.stringify(v));
    } catch { /* silent */ }
  }

  selectVariant(intentType: string): PromptVariant {
    this.init();
    const variants = this.variants.get(intentType);
    if (!variants || variants.length === 0) {
      return { id: 'fallback', intentType, template: '{query}', version: 1, metrics: { avgScore: 0, usageCount: 0, totalScore: 0 }, active: true };
    }

    const active = variants.filter(v => v.active);
    if (active.length === 0) return variants[0];

    // 80/20 split: 80% best performer, 20% exploration
    const best = active.reduce((a, b) => a.metrics.avgScore > b.metrics.avgScore ? a : b);
    if (Math.random() < 0.8) return best;

    const others = active.filter(v => v.id !== best.id);
    return others.length > 0 ? others[Math.floor(Math.random() * others.length)] : best;
  }

  recordResult(intentType: string, variantId: string, score: number): void {
    this.init();
    const variants = this.variants.get(intentType);
    if (!variants) return;
    const variant = variants.find(v => v.id === variantId);
    if (!variant) return;

    variant.metrics.usageCount++;
    variant.metrics.totalScore += score;
    variant.metrics.avgScore = Math.round(variant.metrics.totalScore / variant.metrics.usageCount * 100) / 100;
    this.saveVariant(variant);

    // Statistical promotion after 50 samples
    if (variant.metrics.usageCount >= 50 && variant.metrics.avgScore > 0.75) {
      this.promoteVariant(intentType, variant.id);
    }
  }

  private promoteVariant(intentType: string, winnerId: string): void {
    const variants = this.variants.get(intentType);
    if (!variants) return;
    for (const v of variants) {
      v.active = v.id === winnerId;
      this.saveVariant(v);
    }
    logger.info({ intentType, winnerId }, 'PromptLab promoted variant');
  }

  getVariants(intentType?: string): PromptVariant[] {
    this.init();
    if (intentType) return this.variants.get(intentType) || [];
    return Array.from(this.variants.values()).flat();
  }

  private getTotalVariants(): number {
    let count = 0;
    for (const [, arr] of this.variants) count += arr.length;
    return count;
  }

  fillTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, val] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
    }
    return result;
  }
}

export const promptLab = new PromptLab();
