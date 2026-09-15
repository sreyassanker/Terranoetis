/**
 * E2E (live): Step 1 — torque, tail-rotor balance, thrust-vector disk.
 *
 * Verifies against the running app (not unit-mock) the FAA Ch.2/3 force paths:
 *   1. Trimmed hover: heading holds, airframe drifts RIGHT (translating tendency).
 *   2. Power above trim yaws the nose right; power below trim yaws left.
 *   3. Right pedal (less TR thrust) yaws the nose right.
 *   4. Cyclic tilts the ROTOR DISK, the disk pitches the airframe, and the
 *      tilted thrust vector accelerates the aircraft (disk leads attitude).
 *   5. Vne is an AIRSPEED limit: with a tailwind, GS may exceed Vne but IAS can't.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(300000);

async function launchHeli(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForSelector('[data-testid="hxf-tactical"], .hxdock', { timeout: 30000 });
  const ready = await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    const st = w.__HELI?.simRef?.current?.state;
    return !!st && st.rotorRpm > 80;
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  expect(ready, 'sim bridge ready & rotor at speed').toBe(true);
}

const setColl = (page: import('@playwright/test').Page, v: number) =>
  page.evaluate((val) => {
    const w = window as unknown as Record<string, any>;
    const c = w.__HELI.ctlRef.current;
    c.collective = val; c.collectiveLocked = false;
    c.setCollective(val);
  }, v);

const keys = (page: import('@playwright/test').Page, over: Record<string, number | boolean>) =>
  page.evaluate((k) => {
    const w = window as unknown as Record<string, any>;
    Object.assign(w.__HELI.keysRef.current, k);
  }, over);

/** Advance the LIVE production sim deterministically (headless fps can't burn sim-time). */
const simStep = (page: import('@playwright/test').Page, secs: number,
  inp: Partial<{ collective: number; pitch: number; roll: number; pedal: number; throttle: number; engine: boolean }>) =>
  page.evaluate(({ secs, inp }) => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const base = { ...w.__HELI.inputRef.current, ...inp };
    const steps = Math.round(secs / 0.05);
    let st = sim.state;
    for (let i = 0; i < steps; i++) st = sim.update(0.05, base);
    return { ...st, vN: sim.velocity.n, vE: sim.velocity.e };
  }, { secs, inp });

const snap = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const w = window as unknown as Record<string, any>;
  const s = w.__HELI?.simRef?.current;
  if (!s) return null;
  const st = s.state;
  return { ...st, vN: s.velocity.n, vE: s.velocity.e };
});

test('trimmed hover holds heading but drifts right (translating tendency)', async ({ page }) => {
  await launchHeli(page);
  await page.waitForTimeout(1500);
  await setColl(page, 0.77);
  await keys(page, { pitch: 0, roll: 0, pedal: 0, w: false, s: false, thr: 0 });
  await page.waitForTimeout(3000);
  const a = await snap(page)!;
  expect(a).not.toBeNull();
  expect(a!.onGround).toBe(false);
  const b = await page.waitForFunction(() => {
    const s = (window as unknown as Record<string, any>).__HELI.simRef.current.state;
    return s.ttDriftMps > 0.35 ? s : false;                   // right-of-nose drift accumulates…
  }, null, { timeout: 90000 }).then((h) => h.jsonValue());
  // …heading still holds near trim, drift bounded by fin damping
  expect(Math.abs((b as any).headingDeg - a!.headingDeg)).toBeLessThan(5);
  expect((b as any).ttDriftMps).toBeGreaterThan(0.35);
  expect((b as any).ttDriftMps).toBeLessThan(3.5);   // terminal slide: TR force vs vemp side damping
  expect(Math.abs((b as any).altM - a!.altM)).toBeLessThan(35);   // altitude near-holds
});

test('torque step: power up yaws nose right, power down yaws left', async ({ page }) => {
  await launchHeli(page);
  await setColl(page, 0.77);
  await page.waitForTimeout(4000);
  await setColl(page, 1.0);                                   // climb power: torque > trim TRT
  const yawUp = await page.waitForFunction(() =>
    (window as unknown as Record<string, any>).__HELI.simRef.current.state.yawRateDps > 1.0,
    null, { timeout: 90000 });
  expect(yawUp).toBeTruthy();                                 // nose right
  await setColl(page, 0.77);
  await page.waitForFunction(() =>
    Math.abs((window as unknown as Record<string, any>).__HELI.simRef.current.state.yawRateDps) < 0.8,
    null, { timeout: 90000 });                                 // settle back
  await keys(page, { w: false, s: false });
  await setColl(page, 0.35);                                  // low power: TRT > torque
  const yawDn = await page.waitForFunction(() =>
    (window as unknown as Record<string, any>).__HELI.simRef.current.state.yawRateDps < -1.0,
    null, { timeout: 90000 });
  expect(yawDn).toBeTruthy();                                 // nose left
});

test('right pedal yaws the nose right', async ({ page }) => {
  await launchHeli(page);
  await setColl(page, 0.77);
  await page.waitForTimeout(4000);
  await keys(page, { pedal: 0.6 });
  const a = await page.evaluate(() =>
    (window as unknown as Record<string, any>).__HELI.simRef.current.state.headingDeg);
  const b = await page.waitForFunction((h0) => {
    const h = (window as unknown as Record<string, any>).__HELI.simRef.current.state.headingDeg;
    const d = ((h - (h0 as number) + 540) % 360) - 180;
    return d > 5 ? h : false;
  }, a, { timeout: 90000 }).then((h) => h.jsonValue());
  await keys(page, { pedal: 0 });
  const d = (((b as number) - a + 540) % 360) - 180;
  expect(d).toBeGreaterThan(5);                               // rotated right
  expect(d).toBeLessThan(120);
});

test('cyclic tilts the disk first; attitude follows; thrust vector accelerates', async ({ page }) => {
  await launchHeli(page);
  await setColl(page, 0.77);
  await page.waitForTimeout(2000);
  const mid = await simStep(page, 1.0, { collective: 0.77, pitch: 1 });
  // disk is already tilting and leading; the fuselage hinges onto it
  expect(mid.diskFwdDeg).toBeGreaterThan(6);
  expect(-mid.pitchDeg).toBeLessThan(mid.diskFwdDeg * 1.25 + 1);
  const st = await simStep(page, 5.0, { collective: 0.77, pitch: 1 });
  expect(st.iasKts).toBeGreaterThan(10);                      // honest: builds over seconds
  expect(st.pitchDeg).toBeLessThan(-8);                       // nose down with the disk
  expect(st.vE).toBeGreaterThan(3);                           // moved (spawn heading east)
  await keys(page, { pitch: 0 });
});

test('Vne limits airspeed, not ground: tailwind can push GS past 150', async ({ page }) => {
  await launchHeli(page);
  const st = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const hc = w.__HELI.ctlRef.current.hoverDetent;      // density-altitude hover detent
    // crewed profile: stabilize, accelerate to cruise, THEN encounter the tailwind
    // yaw SAS keeps the line straight while the (real) torque/translational
    // tendencies try to wander it — pilot commands, SAS holds.
    // collective trimmed near hover for level flight; throttle speed-SAS holds TAS
    let s = sim.state;
    const leg = (secs: number, pitch: number) => {
      for (let i = 0; i < secs / 0.05; i++) {
        const st0 = sim.state;
        const sig = Math.pow(1 - 2.25577e-5 * Math.max(0, Math.min(11000, st0.altM)), 4.2568);
        const c = Math.max(0.4, Math.min(1, 1 / (1.3 * sig)) - 0.04);
        // pilot foot: more power needs more right pedal — the test flies the
        // torque schedule honestly instead of pretending it away
        let dH = 90 - st0.headingDeg; while (dH > 180) dH -= 360; while (dH < -180) dH += 360;
        const ped = Math.max(-0.5, Math.min(0.5, dH * 0.02));
        const base = { ...w.__HELI.inputRef.current, collective: c, pitch, roll: 0, pedal: ped, throttle: 0.85, engine: true };
        s = sim.update(0.05, base);
      }
    };
    leg(20, 0.4);
    const tasBefore = s.tasKts;
    sim.setWind(30, 0);                                          // 58-kt tailwind from the west
    leg(70, 0.4);                                                // 70 s downwind
    return { ...s, tasBefore, vE: sim.velocity.e };
  });
  expect(st.tasBefore).toBeGreaterThan(50);                       // real cruise before the wind
  expect(st.iasKts).toBeLessThanOrEqual(152);                     // IAS can NEVER pass the placard
  expect(st.tasKts).toBeLessThanOrEqual(160);                     // TAS bounded by the air, not the ground
  expect(st.gsKts).toBeGreaterThan(155);                          // ground track rides the wind past it
  expect(st.gsKts - st.tasKts).toBeGreaterThan(40);               // the whole delta IS the wind
  expect(Math.abs(st.vsFpm)).toBeLessThan(2000);                  // crew-managed climb state
});

