import { logger } from '../observability/logger';
import { satelliteAnalyzer } from './satelliteAnalyzer';
import { seismicProcessor } from './seismicProcessor';
import { radarInterpreter } from './radarInterpreter';
import { sentimentAnalyzer } from './sentimentAnalyzer';
import { multimodalFusion } from './multimodalFusion';

export class Multimodal {
  private running = false;

  async init(): Promise<void> {
    satelliteAnalyzer.init();
    seismicProcessor.init();
    radarInterpreter.init();
    sentimentAnalyzer.init();
    multimodalFusion.init();

    logger.info('Multimodal system initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    satelliteAnalyzer.start();
    seismicProcessor.start();
    radarInterpreter.start();
    sentimentAnalyzer.start();
    multimodalFusion.start();

    logger.info('Multimodal system started — analyzing satellite, seismic, radar, and social signals');
  }

  stop(): void {
    this.running = false;
    satelliteAnalyzer.stop();
    seismicProcessor.stop();
    radarInterpreter.stop();
    sentimentAnalyzer.stop();
    multimodalFusion.stop();
    logger.info('Multimodal system stopped');
  }

  getStatus() {
    return {
      running: this.running,
      satellite: satelliteAnalyzer.getStats(),
      seismic: seismicProcessor.getStats(),
      radar: radarInterpreter.getStats(),
      sentiment: sentimentAnalyzer.getStats(),
      fusion: multimodalFusion.getStats(),
    };
  }
}

export const multimodal = new Multimodal();
