/**
 * TERRA UMBRA v3.0 — Phase 2: The Reflex
 * Type definitions for the Reflex Engine autonomic nervous system.
 */

export interface ReflexTrigger {
  domain: string;           // e.g., 'seismic', 'weather', 'ais'
  condition: string;        // e.g., 'magnitude > 7.0'
  windowSeconds: number;    // sliding window for evaluation
}

export interface ReflexAction {
  type: 'DILATE' | 'SCAN' | 'FLAG' | 'ALERT' | 'ZOOM' | 'LAYER_TOGGLE';
  target: string;           // e.g., 'satellite', 'radio', 'ais', 'websocket'
  region?: { lat: number; lon: number; radiusKm: number };
  severity?: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  channels?: string[];      // for ALERT type
  resolution?: string;      // for DILATE type
  bands?: string[];         // for SCAN type
  layerId?: string;         // for LAYER_TOGGLE
  payload?: Record<string, unknown>;
}

export interface ReflexRecovery {
  afterSeconds: number;
  action: 'RESET' | 'DIMINISH';
}

export interface ReflexDefinition {
  reflexId: string;
  trigger: ReflexTrigger;
  actions: ReflexAction[];
  recovery: ReflexRecovery;
  enabled: boolean;
}

export interface ReflexState {
  reflexId: string;
  status: 'IDLE' | 'ARMED' | 'ACTIVE' | 'RECOVERING';
  triggeredAt: number | null;  // epoch ms
  lastEvaluatedAt: number;       // epoch ms
  triggerCount: number;
  context: Record<string, unknown>;  // snapshot of triggering event
}