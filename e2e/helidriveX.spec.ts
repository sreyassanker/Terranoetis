/**
 * E2E: airframe selection regression.
 * The product is the AH-64E Guardian: the spawn panel must expose exactly that
 * airframe. The experimental HELIDRIVE-X compound profile remains physics-tested
 * in unit benchmarks (src/__tests__/helicopterSim.test.ts) but is NOT selectable.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(180000);

test('spawn panel pins the AH-64E airframe (compound not selectable)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  const badge = page.getByTestId('heli-air-AH64E');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/AH-64E/i);
  await expect(page.getByTestId('heli-air-HELIDRIVE_X')).toHaveCount(0);
  // launch it: HUD reports the AH-64E Vne placard
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    const s = w.__HELI?.simRef?.current?.state;
    return !!s && s.vneKts === 150;
  }, null, { timeout: 40000 });
  await page.keyboard.press('Escape');
});
