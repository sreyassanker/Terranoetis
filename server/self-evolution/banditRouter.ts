interface Context {
  complexity: 'low' | 'medium' | 'high';
  userHistory?: string[];
  timeOfDay?: number;
  providerHealth?: Record<string, number>;
}

interface ArmStats {
  arm: string;
  pulls: number;
  rewards: number;
  estimatedValue: number;
}

export class BanditRouter {
  private arms: string[];
  private successes: Map<string, number> = new Map();
  private failures: Map<string, number> = new Map();
  private totalPulls: number = 0;

  constructor(arms: string[]) {
    this.arms = arms;
    for (const arm of arms) {
      this.successes.set(arm, 1);
      this.failures.set(arm, 1);
    }
  }

  selectArm(context: Context): string {
    const scores = this.arms.map(arm => {
      const alpha = this.successes.get(arm) || 1;
      const beta = this.failures.get(arm) || 1;
      const sampled = this.sampleBeta(alpha, beta);
      const complexityBonus = this.complexityBonus(arm, context.complexity);
      const timeBonus = this.timeBonus(context.timeOfDay);
      const healthPenalty = context.providerHealth
        ? (context.providerHealth[arm] ?? 1)
        : 1;
      return { arm, score: sampled * complexityBonus * timeBonus * healthPenalty };
    });
    scores.sort((a, b) => b.score - a.score);
    return scores[0].arm;
  }

  selectTopK(k: number, context: Context): string[] {
    const scores = this.arms.map(arm => {
      const alpha = this.successes.get(arm) || 1;
      const beta = this.failures.get(arm) || 1;
      const sampled = this.sampleBeta(alpha, beta);
      return { arm, score: sampled };
    });
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, k).map(s => s.arm);
  }

  updateReward(arm: string, reward: number): void {
    this.totalPulls++;
    if (reward > 0) {
      this.successes.set(arm, (this.successes.get(arm) || 1) + reward);
    } else {
      this.failures.set(arm, (this.failures.get(arm) || 1) + 1);
    }
  }

  updateRewardBatch(updates: Array<{ arm: string; reward: number }>): void {
    for (const u of updates) {
      this.updateReward(u.arm, u.reward);
    }
  }

  getStats(): ArmStats[] {
    return this.arms.map(arm => {
      const alpha = this.successes.get(arm) || 1;
      const beta = this.failures.get(arm) || 1;
      const pulls = alpha + beta - 2;
      const rewards = alpha - 1;
      return {
        arm,
        pulls,
        rewards,
        estimatedValue: pulls > 0 ? alpha / (alpha + beta) : 0,
      };
    });
  }

  addArm(arm: string): void {
    if (!this.arms.includes(arm)) {
      this.arms.push(arm);
      this.successes.set(arm, 1);
      this.failures.set(arm, 1);
    }
  }

  removeArm(arm: string): void {
    this.arms = this.arms.filter(a => a !== arm);
    this.successes.delete(arm);
    this.failures.delete(arm);
  }

  private sampleBeta(alpha: number, beta: number): number {
    const alphaSample = this.sampleGamma(alpha);
    const betaSample = this.sampleGamma(beta);
    return alphaSample / (alphaSample + betaSample);
  }

  private sampleGamma(shape: number): number {
    if (shape < 1) {
      const u = Math.random();
      return this.sampleGamma(1 + shape) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x: number;
      let v: number;
      do {
        x = this.sampleNormal();
        v = 1 + c * x;
      } while (v <= 0);
      const v3 = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v3;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v3 + Math.log(v3))) return d * v3;
    }
  }

  private sampleNormal(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private complexityBonus(arm: string, complexity: string): number {
    const base = this.arms.indexOf(arm) / this.arms.length;
    if (complexity === 'high') return 1 + base * 0.3;
    if (complexity === 'medium') return 1 + base * 0.15;
    return 1;
  }

  private timeBonus(hour?: number): number {
    if (hour == null) return 1;
    if (hour >= 9 && hour <= 17) return 1.2;
    if (hour >= 6 && hour <= 22) return 1.0;
    return 0.8;
  }

  reset(): void {
    for (const arm of this.arms) {
      this.successes.set(arm, 1);
      this.failures.set(arm, 1);
    }
    this.totalPulls = 0;
  }
}
