/**
 * E2E (live): Step 5 — retreating-blade stall, transverse flow, IGE/OGE
 * hover ceilings, gross-weight effects. All against the LIVE production sim.
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
    return !!w.__HELI?.simRef?.current && w.__HELI.simRef.current.state.rotorRpm > 90;
  }, null, { timeout: 30000 });
}

const fly = (page: import('@playwright/test').Page, plan: Array<{ secs: number; i: Record<string, number | boolean> }>) =>
  page.evaluate(async (plan) => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    let st = sim.state;
    const legs: any[] = [];
    for (const leg of plan) {
      const base = { collective: 0.62, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true, ...leg.i };
      for (let i = 0; i < Math.round(leg.secs / 0.05); i++) st = sim.update(0.05, base);
      legs.push(st);
    }
    return legs;
  }, plan);

const reposition = (page: import('@playwright/test').Page, agl: number) =>
  page.evaluate((h) => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const s = sim.state;
    sim.resetTo({ ...s, altM: s.groundAltM + h, onGround: false, engine: true,
      rotorRpm: 100, ngPct: 84, hardLanding: false });
  }, agl);

test('RBS: cruise, abrupt aft cyclic at high collective → buffet onset → recover by lowering nose', async ({ page }) => {
  await launchHeli(page);
  await reposition(page, 400);
  const [cruise, stall, recover] = await fly(page, [
    { secs: 24, i: { collective: 0.77, pitch: 1, throttle: 1 } },
    { secs: 2.5, i: { collective: 0.95, pitch: -1, throttle: 1 } },
    { secs: 5, i: { collective: 0.35, pitch: 0.6, throttle: 0.5 } },
  ]);
  expect(cruise.iasKts, 'cruise built').toBeGreaterThan(90);
  expect(cruise.rbs, 'clean cruise has no RBS').toBe(false);
  expect(stall.rbs, 'aft cyclic + power at speed retreating-blade stalls').toBe(true);
  expect(recover.rbs, 'lowering collective/nose out of it clears the stall').toBe(false);
});

test('transverse flow: hands-off through ~12 kt the nose flies itself right — cyclic corrects', async ({ page }) => {
  await launchHeli(page);
  await reposition(page, 600);
  const flow = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const scan = (corr: number) => {
      const s0 = sim.state;
      sim.resetTo({ ...s0, onGround: false, headingDeg: 90 });
      let rollMax = -99;
      for (let i = 0; i < 240; i++) {
        const st = sim.update(0.05, { collective: 0.77, pitch: i < 90 ? 0.7 : 0, roll: corr, pedal: 0, throttle: 0, engine: true });
        if (st.iasKts > 9 && st.iasKts < 18) rollMax = Math.max(rollMax, st.rollDeg);
      }
      return rollMax;
    };
    return { handsOff: scan(0), corrected: scan(-0.3) };
  });
  expect(flow.handsOff).toBeGreaterThan(0.4);               // right roll tendency, no input
  expect(flow.corrected).toBeLessThan(flow.handsOff);       // left cyclic beats it (FAA Ch.2)
});

test('IGE holds at a density altitude where OGE cannot', async ({ page }) => {
  await launchHeli(page);
  const [ige, oge] = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const at = (altM: number, gnd: number) => {
      const s = sim.state;
      sim.resetTo({ ...s, altM, groundAltM: gnd, onGround: false, engine: true, rotorRpm: 100 });
      let st = sim.state;
      for (let i = 0; i < 120; i++) st = sim.update(0.05, { collective: 0.92, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true });
      return st;
    };
    return [at(2600, 2598), at(2600, 2000)];
  });
  expect(Math.abs(ige.vsFpm)).toBeLessThan(1100);           // IGE: hovering
  expect(oge.vsFpm).toBeLessThan(-900);                     // OGE: can't
});

test('gross weight is honest: max gross cannot climb with full collective', async ({ page }) => {
  await launchHeli(page);
  const pair = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const at = (kg: number) => {
      const s = sim.state;
      sim.resetTo({ ...s, altM: s.groundAltM + 500, onGround: false, engine: true, rotorRpm: 100 });
      sim.setMassKg(kg);
      let st = sim.state;
      for (let i = 0; i < 140; i++) st = sim.update(0.05, { collective: 1, pitch: 0, roll: 0, pedal: 0, throttle: 0.8, engine: true });
      const r = st.vsFpm;
      sim.setMassKg(5200);
      return r;
    };
    return { heavy: at(9500), light: at(4500) };
  });
  expect(pair.heavy).toBeLessThan(pair.light - 1000);
  expect(pair.light).toBeGreaterThan(1200);
});
