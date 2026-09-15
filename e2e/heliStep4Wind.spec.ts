/**
 * E2E (live): Step 4 — real wind: boundary-layer shear, weathervaning into a
 * beam wind, coherent turbulence, live OAT, HUD wind readout.
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

test('beam wind: hover weathervanes the nose toward the wind source', async ({ page }) => {
  await launchHeli(page);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const s = sim.state;
    sim.resetTo({ ...s, altM: s.groundAltM + 150, onGround: false, headingDeg: 90 });
    sim.setYawSAS(false);                                  // raw airframe response (no SAS crab-hold)
    sim.setWind(0, -10);                                   // 19 kt wind FROM the north
  });
  const [a, b] = await fly(page, [
    { secs: 2, i: { collective: 0.77 } },
    { secs: 10, i: { collective: 0.77 } },
  ]);
  expect(a.iasKts).toBeGreaterThan(8);                    // hub airspeed from the wind
  const distToWind = Math.min(b.headingDeg, 360 - b.headingDeg);
  expect(distToWind, 'nose must swing toward the wind source (north=0°)').toBeLessThan(45);
  await page.evaluate(() => { (window as any).__HELI.simRef.current.setYawSAS(true); });

});

test('wind shear: the rotor sees stronger flow at 100 m than at the deck', async ({ page }) => {
  await launchHeli(page);
  const [low, high] = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const s0 = sim.state;
    const plan = (agl: number) => {
      sim.resetTo({ ...s0, altM: s0.groundAltM + agl, onGround: false, headingDeg: 90 });
      sim.setWind(0, -10);
      const base = { collective: 0.77, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true };
      let st = sim.state;
      for (let i = 0; i < 4; i++) st = sim.update(0.05, base);   // before drift equalizes TAS
      return st;
    };
    return [plan(1), plan(100)];
  });
  expect(high.tasKts).toBeGreaterThan(low.tasKts * 1.15);
});

test('turbulence ON: coherent bounded gusts, still airworthy', async ({ page }) => {
  await launchHeli(page);
  const st = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const s = sim.state;
    sim.resetTo({ ...s, altM: s.groundAltM + 300, onGround: false });
    sim.setTurbulence(0.8);
    const base = { collective: 0.77, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true };
    let maxWind = 0; let s2 = sim.state;
    for (let i = 0; i < 800; i++) {
      s2 = sim.update(0.05, base);
      maxWind = Math.max(maxWind, Math.hypot(s2.windE, s2.windN));
    }
    sim.setTurbulence(0);
    return { maxWind, st: s2 };
  });
  expect(st.maxWind).toBeGreaterThan(1.2);                 // it actually gusts
  expect(st.maxWind).toBeLessThan(16);                    // bounded
  expect(st.st.rotorRpm).toBeGreaterThan(85);             // governed through the bumps
});

test('hot day: OAT reads live-ish and the hover margin shrinks', async ({ page }) => {
  await launchHeli(page);
  const pair = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const mk = (oat: number) => {
      const s = sim.state;
      sim.resetTo({ ...s, altM: s.groundAltM + 1500, onGround: false });
      sim.setSurfaceOAT(oat);
      const base = { collective: 0.85, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true };
      let st = sim.state;
      for (let i = 0; i < 160; i++) st = sim.update(0.05, base);
      return st;
    };
    return { cold: mk(0), hot: mk(40) };
  });
  expect(pair.hot.oatC).toBeGreaterThan(25);
  expect(pair.cold.densityRatio).toBeGreaterThan(pair.hot.densityRatio * 1.04);
  expect(pair.cold.vsFpm).toBeGreaterThan(pair.hot.vsFpm);   // cold air lifts — honesty
});

test('HUD dock shows the live WIND readout', async ({ page }) => {
  await launchHeli(page);
  await page.waitForTimeout(6000);                         // let the spawn-time weather fetch land
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__HELI.simRef.current.setWind(8, 0);                 // air mass pushing east
  });
  const chip = page.locator('[data-testid="hxf-wind"]');
  await expect(chip, 'WIND chip in dock').toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="hxf-wind"]');
    const m = (el.textContent ?? '').match(/(\d+)kt/);
    return !!m && Number(m[1]) >= 14 && Number(m[1]) <= 22;      // 8 m/s ≈ 16 kt, ×shear profile at hover alt
  }, null, { timeout: 30000 });
});
