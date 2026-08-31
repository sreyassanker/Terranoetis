import { describe, it, expect } from 'vitest';
import { evaluateCondition, BUILTIN_REFLEXES } from '../../reflex/reflexes';

describe('evaluateCondition', () => {
  it('simple greater-than', () => {
    expect(evaluateCondition('magnitude > 7.0', { magnitude: 7.5 })).toBe(true);
    expect(evaluateCondition('magnitude > 7.0', { magnitude: 6.0 })).toBe(false);
  });

  it('simple less-than', () => {
    expect(evaluateCondition('sog < 1', { sog: 0.5 })).toBe(true);
    expect(evaluateCondition('sog < 1', { sog: 2.0 })).toBe(false);
  });

  it('AND compound', () => {
    expect(evaluateCondition('sog < 1 AND navStatus == 1', { sog: 0.5, navStatus: 1 })).toBe(true);
    expect(evaluateCondition('sog < 1 AND navStatus == 1', { sog: 0.5, navStatus: 0 })).toBe(false);
  });

  it('OR compound', () => {
    expect(evaluateCondition('magnitude > 7 OR windSpeed > 150', { magnitude: 6, windSpeed: 200 })).toBe(true);
    expect(evaluateCondition('magnitude > 7 OR windSpeed > 150', { magnitude: 6, windSpeed: 100 })).toBe(false);
  });

  it('missing field returns false', () => {
    expect(evaluateCondition('magnitude > 7.0', {})).toBe(false);
  });

  it('equals comparison', () => {
    expect(evaluateCondition('status == 1', { status: 1 })).toBe(true);
    expect(evaluateCondition('status == 1', { status: 2 })).toBe(false);
  });

  it('greater-than-or-equal', () => {
    expect(evaluateCondition('score >= 5', { score: 5 })).toBe(true);
    expect(evaluateCondition('score >= 5', { score: 4 })).toBe(false);
  });
});

describe('BUILTIN_REFLEXES', () => {
  it('seismic-pupillary has correct trigger', () => {
    const reflex = BUILTIN_REFLEXES.find(r => r.reflexId === 'seismic-pupillary');
    expect(reflex).toBeDefined();
    expect(reflex!.trigger.domain).toBe('seismic');
    expect(reflex!.trigger.condition).toBe('magnitude > 7.0');
    expect(reflex!.actions.length).toBeGreaterThan(0);
  });

  it('has all 3 builtin reflexes', () => {
    const ids = BUILTIN_REFLEXES.map(r => r.reflexId).sort();
    expect(ids).toEqual(['maritime-distress', 'seismic-pupillary', 'storm-pupillary']);
  });

  it('each reflex has valid action types', () => {
    const validActions = ['DILATE', 'SCAN', 'FLAG', 'ALERT'];
    for (const reflex of BUILTIN_REFLEXES) {
      for (const action of reflex.actions) {
        expect(validActions).toContain(action.type);
      }
    }
  });
});
