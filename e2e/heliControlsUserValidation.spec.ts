import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACT_DIR = path.resolve('e2e/screenshots');
const BRAIN_DIR = '/Users/sreyassanker/.gemini/antigravity/brain/e9c9adff-b818-4025-aca3-936c7f6f067c';

test('validate clear cockpit view and interactive dual bars + directional arrows', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(4000);

  // Close onboarding modal
  const closeMissionModal = page.locator('button[aria-label="Close"], button:has-text("Dismiss"), .lucide-x').first();
  if (await closeMissionModal.isVisible()) {
    await closeMissionModal.click().catch(() => {});
  }

  // Open Flight Simulator panel
  const flyBtn = page.locator('button[title="Flight Simulator"]');
  await flyBtn.waitFor({ state: 'visible', timeout: 10000 });
  await flyBtn.click();

  // Select Apache Helicopter Sim & Launch
  const heliOption = page.getByText('Apache Helicopter Sim', { exact: true });
  await heliOption.waitFor({ state: 'visible', timeout: 5000 });
  await heliOption.click();

  const launchBtn = page.getByText('LAUNCH FLIGHT');
  await launchBtn.waitFor({ state: 'visible', timeout: 5000 });
  await launchBtn.click();

  // Wait for flight dock to mount
  await page.waitForSelector('.hxdock', { timeout: 20000 });
  await page.waitForTimeout(3000);

  // ─── 1. EXTERNAL VIEW: 2 BARS & DIRECTIONAL ARROWS ───
  const pullBar = page.getByTestId('hxf-lever-COL');
  const accelBar = page.getByTestId('hxf-lever-THR');
  const dpad = page.getByTestId('hxf-dpad');
  const dpadFront = page.getByTestId('hxf-dpad-front');
  const dpadLeft = page.getByTestId('hxf-dpad-left');
  const dpadRight = page.getByTestId('hxf-dpad-right');
  const dpadBack = page.getByTestId('hxf-dpad-back');

  await expect(pullBar).toBeVisible();
  await expect(accelBar).toBeVisible();
  await expect(dpad).toBeVisible();
  await expect(dpadFront).toBeVisible();
  await expect(dpadLeft).toBeVisible();
  await expect(dpadRight).toBeVisible();
  await expect(dpadBack).toBeVisible();

  // Capture clean external screenshot
  const extShot = path.join(ARTIFACT_DIR, 'heli_01_external_dual_bars.png');
  await page.screenshot({ path: extShot, fullPage: true });

  // Test Pull Up step button
  const btnPullUp = page.getByTestId('btn-pull-up');
  await btnPullUp.click();
  await page.waitForTimeout(200);

  // Test Accel step button
  const btnAccelUp = page.getByTestId('btn-accel-up');
  await btnAccelUp.click();
  await page.waitForTimeout(200);

  // Test Move FRONT button (forward flight) — thrust-vector accel builds speed over
  // seconds, and headless frames run sim-time slower than wall-time: poll the sim.
  await dpadFront.dispatchEvent('pointerdown', { pointerId: 1 });
  await page.waitForFunction(() => ((window as any).__HELI?.simRef?.current?.state?.iasKts ?? 0) > 14,
    null, { timeout: 150000 });
  await dpadFront.dispatchEvent('pointerup', { pointerId: 1 });
  await page.waitForTimeout(400);

  const extFlyingShot = path.join(ARTIFACT_DIR, 'heli_02_external_flying_front.png');
  await page.screenshot({ path: extFlyingShot, fullPage: true });

  const speedCheck = await page.evaluate(() => {
    const w = window as any;
    return w.__HELI?.simRef?.current?.state?.iasKts ?? 0;
  });
  console.log('External Speed after Move FRONT:', speedCheck);
  expect(speedCheck).toBeGreaterThan(10);

  // ─── 2. COCKPIT VIEW: NO GREEN SCREEN, NO STEEL ROD, DUAL BARS MOUNTED ───
  const cpitBtn = page.locator('button[data-testid="hxf-sw-cpit"]');
  await cpitBtn.click();
  await page.waitForTimeout(2500);

  const cpitShot = path.join(ARTIFACT_DIR, 'heli_03_cockpit_clear_view.png');
  await page.screenshot({ path: cpitShot, fullPage: true });

  // Check Cockpit controls quadrant
  const cpitControls = page.getByTestId('hxf-cockpit-controls');
  await expect(cpitControls).toBeVisible();
  await expect(cpitControls.getByTestId('hxf-lever-COL')).toBeVisible();
  await expect(cpitControls.getByTestId('hxf-lever-THR')).toBeVisible();
  await expect(cpitControls.getByTestId('hxf-dpad')).toBeVisible();

  // Test Keyboard ArrowUp in Cockpit (poll sim speed, not the wall clock)
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => ((window as any).__HELI?.simRef?.current?.state?.iasKts ?? 0) > 20,
    null, { timeout: 150000 });
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(400);

  const cpitFlyingShot = path.join(ARTIFACT_DIR, 'heli_04_cockpit_flying_forward.png');
  await page.screenshot({ path: cpitFlyingShot, fullPage: true });

  const cpitSpeedCheck = await page.evaluate(() => {
    const w = window as any;
    return {
      iasKts: w.__HELI?.simRef?.current?.state?.iasKts ?? 0,
      mode: w.__HELI?.modeRef?.current,
      modelVisible: w.__HELI?.modelRef?.current?.show,
    };
  });
  console.log('Cockpit Probe:', cpitSpeedCheck);
  expect(cpitSpeedCheck.mode).toBe('cockpit');
  expect(cpitSpeedCheck.modelVisible).toBe(false); // Airframe hidden in cockpit to prevent green screen/steel rods!
  expect(cpitSpeedCheck.iasKts).toBeGreaterThan(15);
});
