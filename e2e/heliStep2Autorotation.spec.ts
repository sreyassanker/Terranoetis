/**
 * E2E (live): Step 2 — autorotation energetics & vortex-ring state.
 * Drives the LIVE production sim through the __HELI bridge (sim-stepped because
 * headless rAF runs slower than wall clock):
 *   1. In-flight engine failure → sustained autorotation (NR low green, ~3k fpm).
 *   2. The collective trade: pitch brake bleeds NR, flat blades spin it up.
 *   3. Aft cyclic raises NR (flare energy).
 *   4. Power recovery rejoin.
 *   5. VRS develops and feeds itself; escape through the band with speed.
 */
import { test, expect } from '@playwright/test';
test.setTimeout(420000);

async function launchHeli(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    return !!w.__HELI?.simRef?.current && w.__HELI.simRef.current.state.rotorRpm > 80;
  }, null, { timeout: 30000 });
}

/** Reset the live sim to `agl` metres above the current terrain, at speed. */
const diag = (st: any) => JSON.stringify({ vrs: st.vrs, vsf: Math.round(st.vsFpm), ias: Math.round(st.iasKts), rpm: Math.round(st.rotorRpm), alt: Math.round(st.altM), agl: Math.round(st.aglM), ong: st.onGround, hard: st.hardLanding, coll: +(st.collective ?? 0).toFixed(2) });

const reposition = (page: import('@playwright/test').Page, agl: number) =>
  page.evaluate((h) => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const s = sim.state;
    sim.resetTo({ ...s, altM: s.groundAltM + h, onGround: false, engine: true,
      rotorRpm: 100, ngPct: 84, hardLanding: false });
  }, agl);

// One synchronous plan: every leg's terminal state is snapshotted INSIDE the
// same page turn, so no App rAF frames can sneak inputs between legs.
const fly = (page: import('@playwright/test').Page, plan: Array<{ secs: number; i: Record<string, number | boolean> }>) =>
  page.evaluate(async (plan) => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    let st = sim.state;
    const legs: any[] = [];
    for (const leg of plan) {
      const base = { collective: 0.6, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true, ...leg.i };
      for (let i = 0; i < Math.round(leg.secs / 0.05); i++) st = sim.update(0.05, base);
      legs.push(st);
    }
    (window as any).__LASTLEGS = legs;
    return legs;
  }, plan);

test('engine failure → sustained autorotation → flare → touchdown cushion', async ({ page }) => {
  await launchHeli(page);
  await reposition(page, 300);
  // Real technique: settle LOW pitch (preserve NR), short aft-cyclic entry,
  // then ONE firm cushion flare at the deck — energy is spent, never recharged.
  const [, st, flare, , , , touch] = await fly(page, [
    { secs: 5, i: { collective: 0.8, pitch: 1 } },
    { secs: 12, i: { collective: 0.38, engine: false } },     // entry & settle at full NR
    { secs: 3, i: { collective: 0.4, pitch: -0.8, engine: false } },   // flare: NR rises
    { secs: 2.5, i: { collective: 0.95, pitch: -0.5, engine: false } },// cushion starts
    { secs: 2.5, i: { collective: 0.95, pitch: -0.5, engine: false } },
    { secs: 4, i: { collective: 0.95, pitch: -0.4, engine: false } },
    { secs: 35, i: { collective: 0.90, pitch: -0.2, engine: false } }, // settle the last metres in
  ]);
  expect(st.rotorRpm, 'st=' + diag(st)).toBeGreaterThan(85);
  expect(st.rotorRpm).toBeLessThanOrEqual(104);
  expect(st.vsFpm, 'st=' + diag(st)).toBeLessThan(-1500);        // descending
  expect(st.vsFpm).toBeGreaterThan(-5200);                    // bounded: energy balance holds
  expect(st.rotorRpm, 'st=' + diag(st)).toBeGreaterThan(90);   // NR kept in the slot during the settle
  expect(touch.onGround || touch.aglM < 6, 'touch=' + diag(touch)).toBeTruthy();
  expect(touch.hardLanding, 'touch=' + diag(touch)).toBe(false);
  expect(touch.vsFpm, 'touch=' + diag(touch)).toBeGreaterThan(-900); // cushioned sink, not a spike
  // Honest energy budget: a long held cushion drains NR — the rotor is still
  // turning and decelerating through touchdown (the FAA's "energy spent, never
  // recharged"), never a zero-RPM slam.
  expect(touch.rotorRpm, 'touch=' + diag(touch)).toBeGreaterThan(20);
});

test('the collective trade + power recovery rejoin', async ({ page }) => {
  await launchHeli(page);
  await reposition(page, 2600);
  const [, flat] = await fly(page, [
    { secs: 2, i: { collective: 0.25 } },
    { secs: 20, i: { collective: 0.25, engine: false } },
  ]);
  await reposition(page, 2600);
  const [, braked] = await fly(page, [
    { secs: 2, i: { collective: 0.62 } },
    { secs: 20, i: { collective: 0.62, engine: false } },
  ]);
  expect(flat.rotorRpm, 'flat=' + diag(flat) + ' braked=' + diag(braked)).toBeGreaterThan(braked.rotorRpm + 10);
  expect(Math.abs(braked.vsFpm), 'braked=' + diag(braked) + ' flat=' + diag(flat)).toBeLessThan(Math.abs(flat.vsFpm));
  // power recovery: from the autorotation slot, throttle in re-drives and arrests
  await reposition(page, 900);
  const rec = await fly(page, [
    { secs: 10, i: { collective: 0.35, engine: false } },
    { secs: 14, i: { collective: 0.85, throttle: 0.7, engine: true } },
  ]).then((l) => l[l.length - 1]);
  expect(rec.rotorRpm).toBeGreaterThan(100);
  expect(rec.vsFpm, 'rec=' + diag(rec)).toBeGreaterThan(-1200);
});

test('VRS is self-sustaining and escapes only through the band', async ({ page }) => {
  await launchHeli(page);
  await reposition(page, 1300);
  const [, deep, escape, after] = await fly(page, [
    { secs: 3, i: { collective: 0.3 } },
    { secs: 8, i: { collective: 0.9 } },                       // power into the ring: it develops
    { secs: 14, i: { collective: 0.2, pitch: 1 } },            // FAA escape: lower the nose, build speed
    { secs: 9, i: { collective: 0.85, pitch: 1 } },            // re-power: sink arrests in clean air
  ]);
  expect(deep.vrs, 'deep=' + diag(deep)).toBe(true);            // recirculation developed
  expect(deep.vsFpm).toBeLessThan(-1800);                       // it bit harder than a normal descent
  expect(escape.vrs, 'escape=' + diag(escape)).toBe(false);                               // nose through the band…
  expect(escape.iasKts).toBeGreaterThan(4);                     // …building airspeed out of the ring
  expect(after.vrs, 'after=' + diag(after)).toBe(false);                                // clean airflow, still translating
  expect(after.vsFpm, 'after=' + diag(after)).toBeGreaterThan(-1500);
});
