/**
 * PowerSaver — Suspends non-essential background engines while a
 * Kaggle GPU simulation is running so the local machine stays cool.
 *
 * Kaggle compute happens in the cloud, but the local Node server runs
 * dozens of background pollers (sentinel, satellite, seismic, ML,
 * self-improvement loops, etc.). While a simulation is active these are
 * paused and resumed when it finishes.
 *
 * Reference-counted so concurrent simulations only pause once and only
 * resume after the last one finishes.
 */

import { logger } from '../observability/logger';

type PowerEngine = {
  name: string;
  pause: () => void;
  resume: () => void;
};

const engines: PowerEngine[] = [];
let activeSessions = 0;

export function registerPowerEngine(
  name: string,
  pause: () => void,
  resume: () => void,
): void {
  engines.push({ name, pause, resume });
}

export function pauseBackgroundEngines(): void {
  activeSessions++;
  if (activeSessions > 1) return; // already paused by another sim
  logger.info({ count: engines.length }, '[PowerSaver] Pausing background engines during Kaggle simulation');
  for (const e of engines) {
    try {
      e.pause();
    } catch (err) {
      logger.warn({ engine: e.name, err: String(err) }, '[PowerSaver] pause failed');
    }
  }
}

export function resumeBackgroundEngines(): void {
  if (activeSessions === 0) return;
  activeSessions--;
  if (activeSessions > 0) return; // another sim still running
  logger.info({ count: engines.length }, '[PowerSaver] Resuming background engines');
  for (const e of engines) {
    try {
      e.resume();
    } catch (err) {
      logger.warn({ engine: e.name, err: String(err) }, '[PowerSaver] resume failed');
    }
  }
}

export function isPowerSaverPaused(): boolean {
  return activeSessions > 0;
}
