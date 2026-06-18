/**
 * TERRA UMBRA v3.0 — Phase 2: The Reflex
 * Built-in reflex definitions and condition evaluator.
 */

import type { ReflexDefinition } from './types';

/**
 * Parse and evaluate a simple condition string against a data object.
 *
 * Supports these patterns:
 * - "field > value"  → data.field > value
 * - "field < value"  → data.field < value
 * - "field >= value" → data.field >= value
 * - "field <= value" → data.field <= value
 * - "field == value" → data.field == value (loose equality for numbers)
 * - "field1 op1 value1 AND field2 op2 value2" → both must match
 * - "field1 op1 value1 OR field2 op2 value2" → either must match
 *
 * Value parsing: if value looks like a number (regex /^-?\d+(\.\d+)?$/), parse as float.
 * Otherwise treat as string. If field does not exist in data, return false.
 */
export function evaluateCondition(condition: string, data: Record<string, unknown>): boolean {
  const trimmed = condition.trim();

  // Check for AND / OR logical combinations
  const andIdx = trimmed.indexOf(' AND ');
  const orIdx = trimmed.indexOf(' OR ');

  if (andIdx !== -1) {
    const left = trimmed.slice(0, andIdx);
    const right = trimmed.slice(andIdx + 5);
    return evaluateCondition(left, data) && evaluateCondition(right, data);
  }

  if (orIdx !== -1) {
    const left = trimmed.slice(0, orIdx);
    const right = trimmed.slice(orIdx + 4);
    return evaluateCondition(left, data) || evaluateCondition(right, data);
  }

  // Single condition: field op value
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 3) return false;

  const [field, op, rawValue] = parts;

  if (!(field in data)) return false;

  const parsedValue = parseValue(rawValue);
  const fieldValue = data[field];

  return compareValues(fieldValue, op, parsedValue);
}

/**
 * Parse a raw string value into a number or string.
 */
function parseValue(raw: string): number | string {
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return parseFloat(raw);
  }
  return raw;
}

/**
 * Compare a data field value against an expected value using an operator.
 */
function compareValues(
  fieldValue: unknown,
  op: string,
  expected: number | string,
): boolean {
  if (typeof expected === 'number' && typeof fieldValue === 'number') {
    switch (op) {
      case '>': return fieldValue > expected;
      case '<': return fieldValue < expected;
      case '>=': return fieldValue >= expected;
      case '<=': return fieldValue <= expected;
      case '==': return fieldValue == expected;
      default: return false;
    }
  }

  if (typeof expected === 'string') {
    const fieldStr = String(fieldValue ?? '');
    switch (op) {
      case '==': return fieldStr === expected;
      case '!=': return fieldStr !== expected;
      default: return false;
    }
  }

  // Mixed types: convert field to string and compare as string
  if (op === '==') {
    return String(fieldValue ?? '') === String(expected);
  }

  return false;
}

/**
 * Built-in reflex definitions covering seismic, weather, and maritime domains.
 * Each reflex monitors a domain channel and dispatches autonomic actions
 * (DILATE, SCAN, FLAG, ALERT) when thresholds are breached.
 */
export const BUILTIN_REFLEXES: ReflexDefinition[] = [
  {
    reflexId: 'seismic-pupillary',
    trigger: { domain: 'seismic', condition: 'magnitude > 7.0', windowSeconds: 60 },
    actions: [
      { type: 'DILATE', target: 'satellite', region: { lat: 0, lon: 0, radiusKm: 500 }, resolution: 'MAX' },
      { type: 'SCAN', target: 'radio', region: { lat: 0, lon: 0, radiusKm: 200 }, bands: ['emergency', 'maritime'] },
      { type: 'FLAG', target: 'ais', region: { lat: 0, lon: 0, radiusKm: 300 } },
      { type: 'ALERT', target: 'websocket', severity: 'RED', channels: ['websocket', 'push'] },
    ],
    recovery: { afterSeconds: 3600, action: 'RESET' },
    enabled: true,
  },
  {
    reflexId: 'storm-pupillary',
    trigger: { domain: 'weather', condition: 'windSpeed > 150', windowSeconds: 300 },
    actions: [
      { type: 'DILATE', target: 'satellite', region: { lat: 0, lon: 0, radiusKm: 300 }, resolution: 'HIGH' },
      { type: 'ALERT', target: 'websocket', severity: 'ORANGE', channels: ['websocket'] },
    ],
    recovery: { afterSeconds: 1800, action: 'RESET' },
    enabled: true,
  },
  {
    reflexId: 'maritime-distress',
    trigger: { domain: 'ais', condition: 'sog < 1 AND navStatus == 1', windowSeconds: 600 },
    actions: [
      { type: 'DILATE', target: 'satellite', region: { lat: 0, lon: 0, radiusKm: 50 }, resolution: 'MAX' },
      { type: 'ALERT', target: 'websocket', severity: 'YELLOW', channels: ['websocket'] },
    ],
    recovery: { afterSeconds: 7200, action: 'RESET' },
    enabled: true,
  },
];