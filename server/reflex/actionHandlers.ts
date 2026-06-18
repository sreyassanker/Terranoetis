/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TERRA UMBRA v3.0 — Phase 2: The Reflex
 * Action Handlers — executes concrete work when reflexes fire.
 *
 * Listens to 'reflex:action' and 'system:trauma' pubsub channels,
 * dispatches DILATE/ALERT/SCAN/FLAG actions to WebSocket clients
 * and persists alerts to the sentinel_alerts table.
 */

import { pubsub } from '../pubsub';
import { getDb } from '../db';

export class ReflexActionHandler {
  private unsubscribers: (() => void)[] = [];

  start(): void {
    const unsub = pubsub.subscribe('reflex:action', (payload: any) => {
      this.handleAction(payload);
    });
    this.unsubscribers.push(unsub);

    const unsubTrauma = pubsub.subscribe('system:trauma', (payload: any) => {
      this.handleTrauma(payload);
    });
    this.unsubscribers.push(unsubTrauma);

    console.log('[REFLEX-ACTION] Handler started');
  }

  stop(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    console.log('[REFLEX-ACTION] Handler stopped');
  }

  private handleAction(payload: any): void {
    const { reflexId, action, triggerData } = payload;
    if (!action) return;

    switch (action.type) {
      case 'DILATE':
        this.handleDilate(reflexId, action, triggerData);
        break;
      case 'ALERT':
        this.handleAlert(reflexId, action, triggerData);
        break;
      case 'SCAN':
        this.handleScan(reflexId, action, triggerData);
        break;
      case 'FLAG':
        this.handleFlag(reflexId, action, triggerData);
        break;
      default:
        console.log(`[REFLEX-ACTION] Unknown action type: ${action.type}`);
    }
  }

  private handleDilate(reflexId: string, action: any, triggerData: any): void {
    pubsub.publish('ws:all', {
      type: 'REFLEX_DILATE',
      reflexId,
      region: action.region,
      target: action.target,
      resolution: action.resolution,
      severity: action.severity,
      timestamp: Date.now(),
      triggerData,
    });
    console.log(
      `[REFLEX-ACTION] DILATE → ${action.target} @ ${action.region?.lat},${action.region?.lon} radius=${action.region?.radiusKm}km`,
    );
  }

  private handleAlert(reflexId: string, action: any, triggerData: any): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO sentinel_alerts (alert_id, anomaly_id, title, body, severity, lat, lon, delivered)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `reflex-${reflexId}-${Date.now()}`,
        triggerData?.id || 'unknown',
        `Reflex Trigger: ${reflexId}`,
        JSON.stringify({ action, triggerData }),
        action.severity || 'YELLOW',
        triggerData?.lat || 0,
        triggerData?.lon || 0,
        0,
      );
    } catch (e) {
      console.error('[REFLEX-ACTION] Failed to persist alert:', e);
    }

    pubsub.publish('ws:all', {
      type: 'REFLEX_ALERT',
      reflexId,
      severity: action.severity,
      channels: action.channels,
      timestamp: Date.now(),
      triggerData,
    });
    console.log(
      `[REFLEX-ACTION] ALERT → ${action.severity} via ${action.channels?.join(',')}`,
    );
  }

  private handleScan(reflexId: string, action: any, _triggerData: any): void {
    pubsub.publish('ws:all', {
      type: 'REFLEX_SCAN',
      reflexId,
      bands: action.bands,
      region: action.region,
      timestamp: Date.now(),
    });
    console.log(
      `[REFLEX-ACTION] SCAN → bands=${action.bands?.join(',')} @ ${action.region?.lat},${action.region?.lon}`,
    );
  }

  private handleFlag(reflexId: string, action: any, _triggerData: any): void {
    pubsub.publish('ws:all', {
      type: 'REFLEX_FLAG',
      reflexId,
      target: action.target,
      region: action.region,
      timestamp: Date.now(),
    });
    console.log(
      `[REFLEX-ACTION] FLAG → ${action.target} in ${action.region?.radiusKm}km radius`,
    );
  }

  private handleTrauma(payload: any): void {
    pubsub.publish('ws:all', {
      type: 'SYSTEM_TRAUMA',
      active: payload.active,
      count: payload.count,
      timestamp: Date.now(),
    });
    console.log(
      `[REFLEX-ACTION] TRAUMA MODE → ${payload.active ? 'ENTERED' : 'EXITED'} (${payload.count} active)`,
    );
  }
}