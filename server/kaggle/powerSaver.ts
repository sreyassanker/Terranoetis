/**
 * PowerSaver — Energy & Background Daemon Lifecycle Coordinator
 *
 * Coordinates non-essential background engines across both:
 * 1. Kaggle GPU cloud simulation sessions
 * 2. Desktop desktop power state (foreground active vs minimized/standby)
 *
 * Provides idempotent pause/resume state evaluation so rapid minimize/restore
 * or multiple simulation jobs never corrupt engine lifecycle or leave daemons
 * permanently frozen.
 */

import { logger } from '../observability/logger';

export type PowerEngine = {
  name: string;
  pause: () => void;
  resume: () => void;
};

const engines: PowerEngine[] = [];
let isPaused = false;
let desktopStandby = false;
let kaggleSessions = 0;

export function registerPowerEngine(
  name: string,
  pause: () => void,
  resume: () => void,
): void {
  engines.push({ name, pause, resume });
}

function evaluateState(reason: string): void {
  const shouldPause = desktopStandby || kaggleSessions > 0;
  if (shouldPause && !isPaused) {
    isPaused = true;
    logger.info({ reason, engineCount: engines.length }, '[PowerSaver] Pausing background engines');
    for (const e of engines) {
      try {
        e.pause();
      } catch (err) {
        logger.warn({ engine: e.name, err: String(err) }, '[PowerSaver] pause failed');
      }
    }
  } else if (!shouldPause && isPaused) {
    isPaused = false;
    logger.info({ reason, engineCount: engines.length }, '[PowerSaver] Resuming background engines');
    for (const e of engines) {
      try {
        e.resume();
      } catch (err) {
        logger.warn({ engine: e.name, err: String(err) }, '[PowerSaver] resume failed');
      }
    }
  }
}

/**
 * Idempotently sets desktop standby / active mode from UI visibility or system sleep.
 */
export function setDesktopStandby(standby: boolean): void {
  desktopStandby = standby;
  evaluateState(standby ? 'desktop_standby' : 'desktop_active');
}

/**
 * Reference-counted pause for Kaggle simulations.
 */
export function pauseBackgroundEngines(): void {
  kaggleSessions++;
  evaluateState('kaggle_simulation_start');
}

/**
 * Reference-counted resume for Kaggle simulations.
 */
export function resumeBackgroundEngines(): void {
  if (kaggleSessions > 0) kaggleSessions--;
  evaluateState('kaggle_simulation_end');
}

export function isPowerSaverPaused(): boolean {
  return isPaused;
}

export function isDesktopStandby(): boolean {
  return desktopStandby;
}

export function getPowerEngineInventory(): Array<{ name: string; paused: boolean }> {
  return engines.map(e => ({ name: e.name, paused: isPaused }));
}
