/**
 * TERRA UMBRA v3.0 — Phase 2: The Reflex
 * Reflex Engine — the autonomic nervous system.
 *
 * Monitors domain pubsub channels (seismic, weather, ais, adsb, sentinel),
 * evaluates condition thresholds, and dispatches autonomic actions
 * (DILATE, SCAN, FLAG, ALERT, ZOOM, LAYER_TOGGLE).
 *
 * Includes trauma mode: when >= 3 reflexes fire simultaneously,
 * the system enters elevated alert state.
 */

import { pubsub } from '../pubsub';
import { BUILTIN_REFLEXES, evaluateCondition } from './reflexes';
import type { ReflexDefinition, ReflexState, ReflexAction } from './types';

export class ReflexEngine {
  private reflexes: Map<string, ReflexDefinition>;
  private states: Map<string, ReflexState>;
  private traumaMode: boolean = false;
  private activeReflexCount: number = 0;
  private readonly TRAUMA_THRESHOLD = 3;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.reflexes = new Map();
    this.states = new Map();
    this.loadBuiltinReflexes();
  }

  /**
   * Load the BUILTIN_REFLEXES into the engine's registry.
   * Each reflex is initialized with an IDLE state.
   */
  private loadBuiltinReflexes(): void {
    for (const r of BUILTIN_REFLEXES) {
      this.reflexes.set(r.reflexId, r);
      this.states.set(r.reflexId, {
        reflexId: r.reflexId,
        status: 'IDLE',
        triggeredAt: null,
        lastEvaluatedAt: 0,
        triggerCount: 0,
        context: {},
      });
    }
  }

  /**
   * Start the engine. Subscribes to all domain channels and begins recovery polling.
   * Publishes actions to 'reflex:action' and reflex-specific channels.
   */
  start(): void {
    const channels = ['seismic', 'weather', 'ais', 'adsb', 'sentinel'];
    for (const channel of channels) {
      const unsub = pubsub.subscribe(channel, (data: Record<string, unknown>) => {
        this.onDomainMessage(channel, data);
      });
      this.unsubscribers.push(unsub);
    }
    this.checkInterval = setInterval(() => this.checkRecoveries(), 5000);
    console.log('[REFLEX] Engine started — listening on channels:', channels);
  }

  /**
   * Stop the engine. Unsubscribes from all channels and clears intervals.
   * Does not throw if pubsub is unavailable.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // subscriber may have been removed already
      }
    }
    this.unsubscribers = [];
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('[REFLEX] Engine stopped');
  }

  /**
   * Handle an incoming message on a domain channel.
   * Routes to all reflexes whose trigger domain matches the channel.
   */
  private onDomainMessage(channel: string, data: Record<string, unknown>): void {
    for (const [reflexId, reflex] of this.reflexes) {
      if (reflex.trigger.domain !== channel) continue;
      if (!reflex.enabled) continue;
      this.evaluate(reflexId, data);
    }
  }

  /**
   * Evaluate a single reflex against incoming data.
   * If the condition matches and the reflex is IDLE, it transitions to ACTIVE
   * and all associated actions are dispatched.
   */
  private evaluate(reflexId: string, data: Record<string, unknown>): void {
    const reflex = this.reflexes.get(reflexId);
    const state = this.states.get(reflexId);
    if (!reflex || !state) return;
    if (state.status === 'ACTIVE' || state.status === 'RECOVERING') return;

    const matches = evaluateCondition(reflex.trigger.condition, data);
    state.lastEvaluatedAt = Date.now();

    if (matches) {
      state.status = 'ACTIVE';
      state.triggeredAt = Date.now();
      state.triggerCount++;
      state.context = { ...data, triggeredAt: Date.now() };
      this.activeReflexCount++;
      this.checkTraumaMode();
      this.executeActions(reflexId, data);
    }
  }

  /**
   * Dispatch all actions for a triggered reflex.
   * Enriches region coordinates from trigger data when available.
   * Publishes to 'reflex:action' broadcast channel and reflex-specific channel.
   */
  private executeActions(reflexId: string, triggerData: Record<string, unknown>): void {
    const reflex = this.reflexes.get(reflexId);
    if (!reflex) return;

    for (const action of reflex.actions) {
      const enrichedAction: ReflexAction = { ...action };
      if (
        enrichedAction.region &&
        triggerData.lat != null &&
        triggerData.lon != null
      ) {
        enrichedAction.region = {
          ...enrichedAction.region,
          lat: Number(triggerData.lat),
          lon: Number(triggerData.lon),
        };
      }

      pubsub.publish('reflex:action', {
        reflexId,
        action: enrichedAction,
        timestamp: Date.now(),
        triggerData,
      });

      pubsub.publish(`reflex:${reflexId}`, {
        type: 'action',
        action: enrichedAction,
        timestamp: Date.now(),
      });
    }

    console.log(
      `[REFLEX] ${reflexId} TRIGGERED — ${reflex.actions.length} actions dispatched`,
    );
  }

  /**
   * Periodically check for reflexes that have exceeded their recovery window.
   * Transitions ACTIVE → RECOVERING → (after 5s) → IDLE.
   */
  private checkRecoveries(): void {
    const now = Date.now();
    for (const [reflexId, state] of this.states) {
      if (state.status !== 'ACTIVE' || !state.triggeredAt) continue;
      const reflex = this.reflexes.get(reflexId);
      if (!reflex) continue;
      const elapsedSec = (now - state.triggeredAt) / 1000;
      if (elapsedSec >= reflex.recovery.afterSeconds) {
        state.status = 'RECOVERING';
        this.activeReflexCount = Math.max(0, this.activeReflexCount - 1);
        this.checkTraumaMode();
        pubsub.publish('reflex:recovery', { reflexId, timestamp: now });

        setTimeout(() => {
          state.status = 'IDLE';
          state.triggeredAt = null;
          state.context = {};
          console.log(`[REFLEX] ${reflexId} RECOVERED → IDLE`);
        }, 5000);
      }
    }
  }

  /**
   * Evaluate trauma mode threshold.
   * Enter trauma mode when activeReflexCount >= TRAUMA_THRESHOLD.
   * Exit when count drops below threshold.
   * Publishes 'system:trauma' events on state change.
   */
  private checkTraumaMode(): void {
    const entering = this.activeReflexCount >= this.TRAUMA_THRESHOLD;
    if (entering && !this.traumaMode) {
      this.traumaMode = true;
      pubsub.publish('system:trauma', {
        active: true,
        count: this.activeReflexCount,
      });
      console.log(
        `[REFLEX] 🚨 TRAUMA MODE ENTERED — ${this.activeReflexCount} active reflexes`,
      );
    } else if (!entering && this.traumaMode) {
      this.traumaMode = false;
      pubsub.publish('system:trauma', {
        active: false,
        count: this.activeReflexCount,
      });
      console.log('[REFLEX] TRAUMA MODE EXITED');
    }
  }

  /**
   * Get the current state of a specific reflex by ID.
   */
  getState(reflexId: string): ReflexState | undefined {
    return this.states.get(reflexId);
  }

  /**
   * Get all reflex states as an array.
   */
  getAllStates(): ReflexState[] {
    return Array.from(this.states.values());
  }

  /**
   * Check if the engine is currently in trauma mode.
   */
  isTraumaMode(): boolean {
    return this.traumaMode;
  }

  /**
   * Get the count of currently active reflexes.
   */
  getActiveCount(): number {
    return this.activeReflexCount;
  }
}