import { logger } from '../observability/logger';
import { reasoningVisualizer } from './reasoningVisualizer';
import { evidenceChain } from './evidenceChain';
import { uncertaintyQuantifier } from './uncertaintyQuantifier';
import { biasAuditor } from './biasAuditor';
import { humanOverride } from './humanOverride';

export class Explainability {
  private running = false;

  init(): void {
    reasoningVisualizer.init();
    evidenceChain.init();
    uncertaintyQuantifier.init();
    biasAuditor.init();
    humanOverride.init();
    logger.info('Explainability system initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('Explainability system active — full transparency enabled');
  }

  stop(): void {
    this.running = false;
    logger.info('Explainability system stopped');
  }

  getStatus() {
    return {
      running: this.running,
      reasoning: reasoningVisualizer.getStats(),
      evidence: evidenceChain.getStats(),
      uncertainty: uncertaintyQuantifier.getStats(),
      bias: biasAuditor.getStats(),
      overrides: humanOverride.getStats(),
    };
  }
}

export const explainability = new Explainability();
