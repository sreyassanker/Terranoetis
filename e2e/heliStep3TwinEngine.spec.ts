/**
 * E2E (live): Step 3 — twin T700 powerplant, FADEC limits, OEI.
 *   1. Hover on both engines: TRQ < redline, ITT in a T700 band, HUD shows Ng1/Ng2/ITT1/ITT2.
 *   2. Simulate an engine flameout: the survivor takes the load, Nf droops,
 *      the craft descends — and nothing destroys anything (FADEC-scheduled).
 *   3. HUD annunciates ENG2 OUT.
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
      const base = { collective: 0.6, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true, ...leg.i };
      for (let i = 0; i < Math.round(leg.secs / 0.05); i++) st = sim.update(0.05, base);
      legs.push(st);
    }
    return legs;
  }, plan);

test('twin hover: sane torque, T700 ITT band, both engines live', async ({ page }) => {
  await launchHeli(page);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const s = w.__HELI.simRef.current.state;
    w.__HELI.simRef.current.resetTo({ ...s, altM: s.groundAltM + 120, onGround: false });
  });
  const [st] = await fly(page, [{ secs: 15, i: { collective: 0.77 } }]);
  expect(st.eng1Live).toBe(true);
  expect(st.eng2Live).toBe(true);
  expect(st.torquePct).toBeGreaterThan(55);
  expect(st.torquePct).toBeLessThan(95);
  expect(st.ittLC).toBeGreaterThan(350);
  expect(st.ittLC).toBeLessThan(870);
  expect(st.rotorRpm).toBeGreaterThan(98);
});

test('engine-out (OEI): survivor loads up, Nf droops, controlled descent — no destruction', async ({ page }) => {
  await launchHeli(page);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const s = w.__HELI.simRef.current.state;
    w.__HELI.simRef.current.resetTo({ ...s, altM: s.groundAltM + 220, onGround: false });
    w.__HELI.simRef.current.failEngine('R');
  });
  const [, st] = await fly(page, [
    { secs: 2, i: { collective: 0.77 } },
    { secs: 16, i: { collective: 0.77 } },
  ]);
  expect(st.oei).toBe(true);
  expect(st.eng2Live).toBe(false);
  expect(st.ngRPct).toBeLessThan(10);                     // failed generator spools out
  expect(st.ngLPct).toBeGreaterThan(70);                  // survivor at FADEC schedule
  expect(st.torquePct).toBeGreaterThan(50);               // survivor deep into its rating
  expect(st.ngLPct).toBeGreaterThan(85);                  // FADEC has the lever pushed to the schedule
  expect(st.rotorRpm).toBeLessThan(96);                   // honest power deficit
  expect(st.rotorRpm).toBeGreaterThan(60);                // rotor still driving
  expect(st.vsFpm).toBeLessThan(0);                       // OEI hover settles into a descent
  expect(st.vsFpm).toBeGreaterThan(-3200);                // not a crash
  expect(st.ittLC).toBeLessThan(880);                     // FADEC holds the redline
});

test('cockpit HUD shows the twin quadrants and annunciates the failure', async ({ page }) => {
  await launchHeli(page);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__HELI.simRef.current.failEngine('R');
  });
  // switch into the cockpit view so the full HUD (engine quadrant) mounts
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyC');
  const chip = page.locator('text=ENG2 OUT').first();
  await expect(chip, 'ENG2 OUT annunciator visible after flameout').toBeVisible({ timeout: 60000 });
});
