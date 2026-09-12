/**
 * E2E: HELIDRIVE-X compound (benchmarks calibration, internet data).
 * Vne 250 kt exposed on the HUD; reaches >200 kt IAS — impossible for the
 * AH-64E profile — with the pusher under full power.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(300000);

test('HELIDRIVE-X breaks the conventional-rotor speed ceiling', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByTestId('heli-air-HELIDRIVE_X').click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForSelector('.hxdock', { timeout: 20000 });

  const read = () => page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const s = w.__HELI?.simRef?.current?.state;
    return s ? { ias: s.iasKts, vne: s.vneKts, trt: s.trThrustPct, alt: s.altM } : null;
  });
  const s0 = await read();
  expect(s0!.vne, 'HUD Vne is 250 kt for the compound').toBe(250);
  expect(s0!.trt, 'coaxial: no tail-rotor thrust demand').toBe(0);

  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('d');
  let fast: { ias: number } | null = null;
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(300);
    const s = await read();
    if (s && s.ias > 200) { fast = s; break; }
  }
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('d');
  expect(fast, `should exceed 200 kt IAS (got ${fast?.ias ?? (await read())?.ias})`).toBeTruthy();
  expect(errs.filter(e => !/favicon|net::ERR|WebSocket|401|403/i.test(e)), 'no page errors').toEqual([]);
  await page.keyboard.press('Escape');
});
