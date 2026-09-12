import { describe, expect, it } from 'vitest';
import { HeliControls, IDLE_POWER_CAP, type ControlRaw } from '@/rendering/heliControls';
import { HOVER_COLLECTIVE } from '@/rendering/helicopterSim';

const raw = (over: Partial<ControlRaw> = {}): ControlRaw => ({
  collUp: false, collDown: false, collRateUp: 0.45, collRateDown: 0.6,
  throttleDelta: 0, starterHeld: false, onGround: true,
  nfPct: 100, ngPct: 84, fuelKg: 1200, altM: 0, ...over,
});
const cmd = () => ({ collective: 0.55, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true });

/** Drive the controls with a fake sim that ramps Nf/Ng while engine=true. */
function spool(ctl: HeliControls, out: ReturnType<typeof cmd>, secs: number, starter = false) {
  const dt = 1 / 60;
  const r = raw({ starterHeld: starter });
  let t = 0;
  const evs: string[] = [];
  while (t < secs) {
    ctl.update(dt, { ...r, nfPct: out.engine ? r.nfPct : 0 }, out);
    if (out.engine) { r.nfPct = Math.min(100, r.nfPct + 25 * dt); r.ngPct = Math.min(100, r.ngPct + 30 * dt); }
    evs.push(...ctl.drainEvents());
    t += dt;
    if (evs.includes('run')) break;
  }
  return evs;
}

describe('HeliControls', () => {
  it('warm start passes the engine through with ECL FLIGHT', () => {
    const c = new HeliControls(); const o = cmd();
    c.update(1 / 60, raw(), o);
    expect(o.engine).toBe(true);
    expect(c.engineState).toBe('RUNNING');
  });

  it('cold start: starter denied until ECL IDLE, then START → LIGHTOFF → RUN', () => {
    const c = new HeliControls(true); const o = cmd();
    c.update(1 / 60, { ...raw(), starterHeld: true, nfPct: 0, ngPct: 0 }, o);
    expect(c.drainEvents()).toContain('start-denied-ecl');
    c.setEcl(1);
    const evs = spool(c, { ...o, engine: false }, 10, true);
    expect(evs).toContain('start');
    expect(evs).toContain('lightoff');
    expect(evs).toContain('run');
    expect(c.engineState).toBe('RUNNING');
  });

  it('starter is denied without battery', () => {
    const c = new HeliControls(true); c.setEcl(1); c.battery = false;
    const o = cmd();
    c.update(1 / 60, { ...raw(), starterHeld: true, nfPct: 0 }, o);
    expect(c.drainEvents()).toContain('start-denied-battery');
    expect(c.engineState).toBe('OFF');
  });

  it('ECL to CUTOFF flames a running engine', () => {
    const c = new HeliControls(); const o = cmd();
    c.cycleEcl();                       // FLIGHT → CUTOFF (wraps to 0)
    c.update(1 / 60, raw(), o);
    expect(c.drainEvents()).toContain('flameout-ecl');
    expect(o.engine).toBe(false);
  });

  it('fuel starvation trips FLAMEOUT-FUEL and gates the engine', () => {
    const c = new HeliControls(); const o = cmd();
    c.update(1 / 60, raw({ fuelKg: 0.2 }), o);
    expect(c.drainEvents()).toContain('flameout-fuel');
    expect(o.engine).toBe(false);
  });

  it('friction lock freezes the collective against keys and widget input', () => {
    const c = new HeliControls(); c.toggleFriction();
    const o = cmd();
    const before = c.collective;
    c.update(1 / 30, raw({ collUp: true }), o);
    c.setCollective(1);
    expect(c.collective).toBe(before);
    c.toggleFriction();
    c.setCollective(0.8);
    expect(c.collective).toBe(0.8);
  });

  it('collective magnet dwells at the hover detent and breaks away with force', () => {
    const c = new HeliControls(); c.collective = HOVER_COLLECTIVE;
    const o = cmd();
    c.update(1 / 60, raw({ collUp: true }), o);
    expect(c.collective).toBeCloseTo(HOVER_COLLECTIVE, 3);   // held by magnet
    for (let i = 0; i < 20; i++) c.update(1 / 60, raw({ collUp: true }), o);
    expect(c.collective).toBeGreaterThan(HOVER_COLLECTIVE + 0.01); // broke away
  });

  it('ECL IDLE caps delivered throttle; FLIGHT delivers full', () => {
    const c = new HeliControls(); c.setThrottle(0.9);
    c.setEcl(1);
    const o = cmd(); c.update(1 / 60, raw(), o);
    expect(o.throttle).toBeLessThanOrEqual(IDLE_POWER_CAP + 1e-9);
    c.setEcl(2); c.update(1 / 60, raw(), o);
    expect(o.throttle).toBeCloseTo(0.9, 6);
  });

  it('generator comes online above 55% Ng while running', () => {
    const c = new HeliControls(); const o = cmd();
    c.update(1 / 60, raw({ ngPct: 40 }), o);
    expect(c.generatorOnline).toBe(false);
    c.update(1 / 60, raw({ ngPct: 70 }), o);
    expect(c.generatorOnline).toBe(true);
  });

  it('starter releases at light-off even while the key stays held', () => {
    const c = new HeliControls(true); c.setEcl(1);
    const o = cmd();
    const r = raw({ starterHeld: true, nfPct: 0, ngPct: 0 });
    let seen = false;
    for (let i = 0; i < 120 && !seen; i++) {
      c.update(1 / 60, r, o);
      if (o.engine) { r.nfPct = Math.min(100, r.nfPct + 25 / 60); }
      const ev = c.drainEvents();
      if (ev.includes('lightoff')) { seen = true; expect(c.starterEngaged).toBe(false); }
    }
    expect(seen).toBe(true);
  });

  it('collective widget sets absolute position honouring 0..1 clamp', () => {
    const c = new HeliControls();
    c.setCollective(1.4); expect(c.collective).toBe(1);
    c.setCollective(-2); expect(c.collective).toBe(0);
  });
});
