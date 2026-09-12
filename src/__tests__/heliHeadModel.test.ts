import { describe, expect, it } from 'vitest';
import { PilotHead, HEAD_LIMITS, NEUTRAL_PITCH } from '@/rendering/heliHeadModel';

const env = { nfPct: 100, engineOn: true, time: 0 };

describe('PilotHead', () => {
  it('clamps look to the neck cone', () => {
    const h = new PilotHead();
    for (let i = 0; i < 50; i++) h.look(0.3, 0.3, 0);
    expect(h.yaw).toBeLessThanOrEqual(HEAD_LIMITS.yawMax);
    expect(h.pitch).toBeLessThanOrEqual(HEAD_LIMITS.pitchUpMax);
    for (let i = 0; i < 50; i++) h.look(-0.3, -0.3, 0);
    expect(h.yaw).toBeGreaterThanOrEqual(-HEAD_LIMITS.yawMax);
    expect(h.pitch).toBeGreaterThanOrEqual(-HEAD_LIMITS.pitchDownMax);
  });

  it('springs back toward neutral after hands-off', () => {
    const h = new PilotHead();
    h.look(0.5, 0, 0);
    for (let t = 2; t < 12; t += 0.016) h.update(0.016, t, env);
    expect(Math.abs(h.yaw)).toBeLessThan(0.05);
    expect(Math.abs(h.pitch - NEUTRAL_PITCH)).toBeLessThan(0.05);
  });

  it('does NOT spring back while look input is recent', () => {
    const h = new PilotHead();
    let t = 0;
    for (let i = 0; i < 30; i++) { t += 0.2; h.look(0.02, 0, t); h.update(0.2, t, env); }
    expect(h.yaw).toBeGreaterThan(0.2);
  });

  it('vibration scales with rotor rpm and vanishes when engine off', () => {
    const h = new PilotHead();
    let maxAmp = 0;
    for (let i = 0; i < 200; i++) {
      h.update(1 / 60, i / 60, { nfPct: 100, engineOn: true, time: i / 60 });
      maxAmp = Math.max(maxAmp, Math.abs(h.jitter[2]));
    }
    expect(maxAmp).toBeGreaterThan(0.0005);
    h.update(1 / 60, 4, { nfPct: 0, engineOn: false, time: 4 });
    expect(h.jitter).toEqual([0, 0, 0]);
    expect(maxAmp).toBeLessThan(0.006);   // millimetres, not centimetres
  });

  it('survives NaN dt and huge time', () => {
    const h = new PilotHead();
    h.update(NaN, 1e12, { nfPct: NaN, engineOn: true, time: 1e12 });
    expect(Number.isFinite(h.yaw) && Number.isFinite(h.jitter[0])).toBe(true);
  });

  it('reset returns to neutral instantly', () => {
    const h = new PilotHead();
    h.look(0.4, 0.3, 0);
    h.reset();
    expect(h.yaw).toBe(0); expect(h.pitch).toBe(NEUTRAL_PITCH);
  });
});
