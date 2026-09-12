/**
 * E2E: tactical cockpit controls & cold-start procedure (Pillar D).
 * Cold & Dark spawn → AVN on → ECL IDLE → STARTER (hold) → LIGHT-OFF → RUN →
 * ECL FLIGHT → collective up → airborne. Friction lock then freezes collective.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(300000);

const snap = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const w = window as unknown as Record<string, any>;
  const c = w.__HELI?.ctlRef?.current;
  const s = w.__HELI?.simRef?.current?.state;
  return c ? { ctl: c.snapshot, state: s } : null;
});

test('cold & dark: checklist start, friction lock, ECL flameout', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByTestId('heli-cold').click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForSelector('[data-testid="hxf-tactical"]', { timeout: 20000 });

  // on the pad, dark: no fuel burn, rotors stopped
  let st = await snap(page);
  expect(st, 'ctl bridge').toBeTruthy();
  expect(st!.ctl.engineState).toBe('OFF');
  expect(st!.ctl.ecl).toBe(0);
  expect(st!.ctl.avionicsMaster).toBe(false);
  expect(st!.state.rotorRpm).toBeLessThan(2);

  // starter with ECL at CUTOFF is inhibited
  await page.getByTestId('hxf-starter').dispatchEvent('pointerdown');
  await page.waitForTimeout(500);
  await page.getByTestId('hxf-starter').dispatchEvent('pointerup');
  st = await snap(page);
  expect(st!.ctl.engineState).toBe('OFF');

  // AVN master → ECL IDLE → hold START until RUN
  await page.getByTestId('hxf-avn').click();
  await page.getByTestId('hxf-ecl').click();
  st = await snap(page);
  expect(st!.ctl.ecl).toBe(1);
  await page.getByTestId('hxf-starter').dispatchEvent('pointerdown');
  let ran = false;
  for (let i = 0; i < 120 && !ran; i++) {
    await page.waitForTimeout(250);
    const s = await snap(page);
    ran = !!s && s.ctl.engineState === 'RUNNING';
    if (i === 20) await page.getByTestId('hxf-starter').dispatchEvent('pointerup');  // momentary: cut after light-off
  }
  await page.getByTestId('hxf-starter').dispatchEvent('pointerup').catch(() => {});
  expect(ran, 'engine should reach RUNNING with the starter').toBe(true);
  let spooled = false;
  for (let i = 0; i < 80 && !spooled; i++) {
    st = await snap(page);
    spooled = !!st && st.state.rotorRpm > 90;
    if (!spooled) await page.waitForTimeout(250);
  }
  st = await snap(page);
  expect(st!.ctl.generatorOnline, 'generator online after spool-up').toBe(true);
  expect(spooled, 'rotor should spool to >90% after light-off').toBe(true);

  // ECL → FLIGHT, collective up → airborne (baseline re-taken after terrain
  // streaming settles so the pad datum is current)
  await page.getByTestId('hxf-ecl').click();
  st = await snap(page);
  expect(st!.ctl.ecl).toBe(2);
  const altPad = (await snap(page))!.state.altM;
  await page.keyboard.down('w');
  let airborne = false;
  for (let i = 0; i < 80 && !airborne; i++) {
    await page.waitForTimeout(250);
    const s = await snap(page);
    airborne = !!s && s.state.altM > altPad + 30;
  }
  await page.keyboard.up('w');
  expect(airborne, 'should climb after engine start').toBe(true);

  // friction lock freezes the collective against W
  await page.getByTestId('hxf-fric').click();
  await page.waitForTimeout(200);
  const before = await snap(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  const after = await snap(page);
  expect(after!.ctl.collectiveLocked).toBe(true);
  expect(Math.abs(after!.ctl.collective - before!.ctl.collective)).toBeLessThan(0.001);
  // and the lever widget refuses to move too
  await page.getByTestId('hxf-lever-COL').locator('.hxf-lever-track').click({ position: { x: 12, y: 20 } });
  const after2 = await snap(page);
  expect(Math.abs(after2!.ctl.collective - before!.ctl.collective)).toBeLessThan(0.001);
  await page.getByTestId('hxf-fric').click();

  // ECL back to CUTOFF flames the engine → Nf decays (autorotation available)
  await page.getByTestId('hxf-ecl').click();     // FLIGHT → CUTOFF (cycles)
  let flamed = false;
  for (let i = 0; i < 40 && !flamed; i++) {
    await page.waitForTimeout(250);
    const s = await snap(page);
    flamed = !!s && s.ctl.engineState === 'OFF';
  }
  expect(flamed, 'ECL CUTOFF should flame out the engine').toBe(true);

  await page.keyboard.press('Escape');
});
