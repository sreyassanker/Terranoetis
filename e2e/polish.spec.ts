/**
 * E2E: Phase 6 polish — audio engine correlates to Nf, FPS telemetry chip,
 * camera-mode crossfade flash.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(300000);

test('audio + fps + mode fade hooks', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForSelector('.hxdock', { timeout: 20000 });

  const a = await page.evaluate(() => (window as any).__HELI?.audioRef?.current?.status ?? null);
  expect(a, 'audio engine created').toBeTruthy();
  expect(a.started, 'audio graph started').toBe(true);

  // fps chip renders a live number
  const chip = page.getByTestId('hxf-fps');
  await expect(chip).toBeVisible({ timeout: 10000 });
  const fpsN = parseInt((await chip.textContent() ?? '0').replace(/\D/g, ''), 10);
  expect(fpsN, 'fps > 0 (MEASURED headless)').toBeGreaterThan(0);

  // toggling camera modes flashes the crossfade layer
  await page.keyboard.press('c');
  await expect(page.getByTestId('hxf-flash')).toBeAttached({ timeout: 5000 });
  await page.keyboard.press('c');
  await page.waitForTimeout(700);
  // U mute hook doesn't crash and reflects in status
  await page.keyboard.press('u');
  const b = await page.evaluate(() => (window as any).__HELI.audioRef.current.status);
  expect(b.muted).toBe(true);
  await page.keyboard.press('u');
  const c = await page.evaluate(() => (window as any).__HELI.audioRef.current.status);
  expect(c.muted).toBe(false);

  await page.keyboard.press('Escape');
});
