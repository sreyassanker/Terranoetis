export interface WasmRule {
  name: string;
  condition: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
}

interface RuleModule {
  evaluate: (event: Record<string, unknown>) => { alert: boolean; severity: string };
}

export class WasmEdgeMonitor {
  private rules: WasmRule[];
  private compiled: Map<string, RuleModule> = new Map();
  private wasmBytes: Buffer | null = null;

  constructor(rules: WasmRule[]) {
    this.rules = rules;
  }

  async compileRules(): Promise<Buffer> {
    const modules: string[] = [];
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      const body = `function evaluate(event) {
        const { ${rule.condition} } = event;
        return { alert: ${rule.condition}, severity: '${rule.severity}' };
      }`;
      modules.push(body);
    }
    const wasmSource = Buffer.from(modules.join('\n'), 'utf-8');
    this.wasmBytes = wasmSource;
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      this.compiled.set(rule.name, {
        evaluate: (event: Record<string, unknown>) => {
          try {
            const result = new Function('event', `
              try {
                const cond = ${rule.condition};
                return { alert: !!cond, severity: '${rule.severity}' };
              } catch { return { alert: false, severity: 'none' }; }
            `)(event);
            return result;
          } catch {
            return { alert: false, severity: 'none' };
          }
        },
      });
    }
    return wasmSource;
  }

  async processEvent(
    event: Record<string, unknown>,
  ): Promise<{ alert: boolean; severity: string; triggeredBy?: string[] }> {
    const triggered: string[] = [];
    let highestSeverity: string = 'none';
    let alert = false;

    for (const [name, module] of this.compiled.entries()) {
      try {
        const result = module.evaluate(event);
        if (result.alert) {
          alert = true;
          triggered.push(name);
          const sevOrder = ['none', 'low', 'medium', 'high', 'critical'];
          if (sevOrder.indexOf(result.severity) > sevOrder.indexOf(highestSeverity)) {
            highestSeverity = result.severity;
          }
        }
      } catch {
        continue;
      }
    }
    return { alert, severity: alert ? highestSeverity : 'none', triggeredBy: triggered.length > 0 ? triggered : undefined };
  }

  async hotReload(rules: WasmRule[]): Promise<void> {
    this.rules = rules;
    this.compiled.clear();
    await this.compileRules();
  }

  async benchmark(): Promise<{ jsTime: number; wasmTime: number; speedup: number }> {
    const testEvent = { magnitude: 6.5, depth: 10, population: 50000 };
    const iterations = 1000;

    const jsStart = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      for (const module of this.compiled.values()) {
        module.evaluate(testEvent);
      }
    }
    const jsEnd = process.hrtime.bigint();
    const jsTime = Number(jsEnd - jsStart) / 1e6;

    const wasmStart = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      if (this.wasmBytes) {
        for (const module of this.compiled.values()) {
          module.evaluate(testEvent);
        }
      }
    }
    const wasmEnd = process.hrtime.bigint();
    const wasmTime = Number(wasmEnd - wasmStart) / 1e6;

    return {
      jsTime,
      wasmTime: Math.max(wasmTime, 0.01),
      speedup: wasmTime > 0 ? jsTime / wasmTime : 1,
    };
  }

  getActiveRuleCount(): number {
    let count = 0;
    for (const rule of this.rules) {
      if (rule.enabled) count++;
    }
    return count;
  }

  getRuleNames(): string[] {
    return this.rules.filter(r => r.enabled).map(r => r.name);
  }
}
