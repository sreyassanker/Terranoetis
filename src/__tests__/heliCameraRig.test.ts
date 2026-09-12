import { describe, expect, it } from 'vitest';
import { ChaseRig, CHASE_CONFIG, type ChaseFrame, type ChaseOutput } from '@/rendering/heliCameraRig';

const frame = (over: Partial<ChaseFrame> = {}): ChaseFrame => ({
  headingRad: 0, tasMps: 0, aglM: 100, yawRateDps: 0, sideslipDeg: 0,
  pitchDeg: 0, rollDeg: 0, ...over,
});

const settle = (rig: ChaseRig, secs: number, f: ChaseFrame, step = 1 / 60): ChaseOutput => {
  let out: ChaseOutput = rig.step(step, f);
  for (let i = 1; i < secs / step; i++) out = rig.step(step, f);
  return out;
};

describe('ChaseRig', () => {
  it('settles behind the airframe and is frame-rate independent', () => {
    const slow = new ChaseRig(); const fast = new ChaseRig();
    const a = settle(slow, 8, frame({ tasMps: 0 }), 1 / 15);
    const b = settle(fast, 8, frame({ tasMps: 0 }), 1 / 90);
    expect(Math.abs(a.az - Math.PI)).toBeLessThan(0.08);
    expect(Math.abs(a.dist - b.dist)).toBeLessThan(0.5);
    expect(Math.abs(a.fov - b.fov)).toBeLessThan(0.01);
  });

  it('framing distance grows with airspeed and altitude', () => {
    const rig = new ChaseRig();
    const hover = settle(rig, 10, frame({ tasMps: 0, aglM: 50 }));
    const cruise = settle(rig, 10, frame({ tasMps: 60, aglM: 50 }));
    const high = settle(rig, 10, frame({ tasMps: 60, aglM: 800 }));
    expect(cruise.dist).toBeGreaterThan(hover.dist * 1.5);
    expect(high.dist).toBeGreaterThan(cruise.dist);
    expect(high.dist).toBeLessThan(270);
  });

  it('FOV widens with distance and adds a speed-rush term, clamped', () => {
    const rig = new ChaseRig();
    const hov = settle(rig, 10, frame({ tasMps: 0 }));
    const crz = settle(rig, 10, frame({ tasMps: 77 }));
    expect(crz.fov).toBeGreaterThan(hov.fov);
    const clamped = settle(rig, 10, frame({ tasMps: 500 }));   // absurd input
    expect(clamped.fov).toBeLessThanOrEqual(1.75);
  });

  it('lags the nose during a hard turn and re-converges afterwards', () => {
    const rig = new ChaseRig();
    settle(rig, 5, frame());
    // sustained +60°/s coordinated turn
    let minAz = Math.PI;
    let hdg = 0;
    for (let i = 0; i < 60 * 4; i++) {
      hdg += (60 * Math.PI / 180) / 60;   // coordinated turn: heading rotates with velocity
      const out = rig.step(1 / 60, frame({ yawRateDps: 60, headingRad: hdg }));
      minAz = Math.min(minAz, out.az);
    }
    const lagDeg = (Math.PI - minAz) * 180 / Math.PI;
    expect(lagDeg).toBeGreaterThan(1);                 // camera visibly trails
    const after = settle(rig, 14, frame({ headingRad: hdg }));   // straighten out (heading held)
    expect(Math.abs(Math.PI - Math.abs(after.az))).toBeLessThan(0.12);  // re-converged behind nose
  });

  it('manual gestures perturb the rig and decay back over ~τ', () => {
    const rig = new ChaseRig();
    settle(rig, 3, frame());
    rig.nudgeAzEl(0.5, 0, 0, 0);
    rig.nudgeZoom(0.6);
    const perturbed = rig.step(1 / 60, frame());
    expect(perturbed.dist).toBeGreaterThan(24);
    const back = settle(rig, 18, frame({ aglM: 0 }));
    expect(Math.abs(back.dist - 58) / 58).toBeLessThan(0.25);
    const backAz = back.az < 0 ? back.az + 2 * Math.PI : back.az;
    expect(Math.abs(backAz - Math.PI)).toBeLessThan(0.2);
  });

  it('trails the velocity vector with sideslip (β)', () => {
    const rig = new ChaseRig();
    const out = settle(rig, 10, frame({ sideslipDeg: 15 }));
    const azN = out.az < 0 ? out.az + 2 * Math.PI : out.az;
    expect(azN).toBeGreaterThan(Math.PI);   // camera moves behind the air track
  });

  it('camera roll follows bank, capped, and level in hover', () => {
    const rig = new ChaseRig();
    const bank = settle(rig, 8, frame({ rollDeg: 24 }));
    expect(bank.rollDeg).toBeGreaterThan(2);
    expect(bank.rollDeg).toBeLessThanOrEqual(12);
    const level = settle(rig, 8, frame({ rollDeg: 0 }));
    expect(Math.abs(level.rollDeg)).toBeLessThan(0.5);
  });

  it('orbit mode passes gestures through with release inertia', () => {
    const rig = new ChaseRig();
    rig.mode = 'orbit';
    rig.setDragging(true);
    rig.nudgeAzEl(0.3, 0, 4, 0);
    rig.setDragging(false);
    const o1 = rig.step(1 / 60, frame());
    const o2 = settle(rig, 2, frame());
    expect(o2.az).toBeGreaterThan(o1.az);      // keeps gliding after release
    expect(o2.rollDeg).toBe(0);
  });

  it('no NaN under extreme or zero dt', () => {
    const rig = new ChaseRig();
    let out = rig.step(0, frame({ tasMps: 1e9, aglM: 1e9, yawRateDps: -1e9, pitchDeg: 1e5, rollDeg: -1e5, sideslipDeg: 1e5 }));
    for (const k of ['az', 'el', 'dist', 'fov', 'rollDeg'] as const) expect(Number.isFinite(out[k])).toBe(true);
    out = rig.step(0.5, frame({ tasMps: NaN, headingRad: NaN }));
    expect(Number.isFinite(out.dist) && Number.isFinite(out.az)).toBe(true);
  });

  it('rigidity knob moves the response stiffness', () => {
    const loose = new ChaseRig(); loose.rigidity = 0.2;
    const taut = new ChaseRig(); taut.rigidity = 1.8;
    const a = settle(loose, 6, frame({ tasMps: 60 }));
    const b = settle(taut, 6, frame({ tasMps: 60 }));
    const cfg = CHASE_CONFIG();
    const target = cfg.d0 + cfg.kv * 60;
    expect(Math.abs(b.dist - target)).toBeLessThan(Math.abs(a.dist - target));
  });

  it('squats with the airframe at low AGL: camera flattens and closes in', () => {
    const high = settle(new ChaseRig(), 10, frame({ tasMps: 60, aglM: 900 }));
    const low = settle(new ChaseRig(), 10, frame({ tasMps: 60, aglM: 60 }));
    // elevation above the target plane collapses toward the flight path…
    expect(low.el).toBeLessThan(high.el * 0.5);
    expect(low.el).toBeLessThan(0.18);
    // …and the camera rides only metres above the airframe, not tens
    expect(low.dist * Math.sin(low.el)).toBeLessThan(high.dist * Math.sin(high.el) * 0.35);
    // framing also tightens at the deck (AGL distance law attenuated)
    expect(low.dist).toBeLessThan(high.dist);
  });

  it('manual zoom in chase mode can never break the framing envelope', () => {
    const rig = new ChaseRig();
    settle(rig, 5, frame({ tasMps: 60 }));
    for (let i = 0; i < 40; i++) rig.nudgeZoom(0.22);      // button-mash zoom out
    const blown = rig.step(1 / 60, frame({ tasMps: 60 }));
    expect(blown.distTarget).toBeLessThanOrEqual(260.5);
    const settled = settle(rig, 12, frame({ tasMps: 60 }));
    expect(settled.dist).toBeLessThanOrEqual(285);   // envelope + small spring overshoot
    for (let i = 0; i < 40; i++) rig.nudgeZoom(-0.22);     // …or dive below dMin
    const sunk = settle(rig, 12, frame({ tasMps: 60 }));
    expect(sunk.dist).toBeGreaterThanOrEqual(10);    // envelope + small spring undershoot
  });
});
