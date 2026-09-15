/**
 * E2E: immersive glass cockpit (Pillar B).
 *  Scene mode (default, Phase 5 B-Full): live canvas instruments on the console.
 *  DOM mode (?deckdom=1, Phase 4 hybrid): projected DOM panels — parallax.
 *  Both: avionics master darks the glass instruments; standby survives.
 */
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

test.setTimeout(300000);

async function launch(page: import('@playwright/test').Page, url = '/') {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForSelector('.hxdock', { timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press(' ');          // hover assist keeps the deck steady
  await page.waitForTimeout(600);
  await page.keyboard.press('c');
  await page.waitForSelector('.hxhud', { timeout: 10000 });
}

test('production deck is the DOM glass path; scene instruments are flag-gated', async ({ page }) => {
  await launch(page);
  // HELI_DOM_DECK = true ships the fixed DOM console; the in-world canvas
  // instruments (CockpitScreenMgr) are opt-in only and must NOT be live.
  const probe = () => page.evaluate(() => ({
    instr: !!((window as any).__HELI?.instrRef?.current),
    domPanels: document.querySelectorAll('[data-deck-id]').length,
  }));
  let p = null as Awaited<ReturnType<typeof probe>> | null;
  for (let i = 0; i < 20; i++) { p = await probe(); if (p.domPanels > 0) break; await page.waitForTimeout(300); }
  expect(p!.domPanels, 'DOM console panels mounted in cockpit').toBeGreaterThanOrEqual(4);
  expect(p!.instr, 'in-scene manager stays off on the production flag').toBe(false);
  await page.keyboard.press('c');
});


test('DOM deck: fixed readable glass panels stay pinned and honour avionics', async ({ page }) => {
  await launch(page, '/?deckdom=1');
  const vis = () => page.evaluate(() => {
    const out: Record<string, { opacity: string; rect: { x: number; y: number; w: number } }> = {};
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-deck-id]'))) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out[el.dataset.deckId as string] = { opacity: cs.opacity, rect: { x: r.x, y: r.y, w: r.width } };
    }
    return out;
  });
  let d = null as Awaited<ReturnType<typeof vis>> | null;
  for (let i = 0; i < 30; i++) {
    d = await vis();
    if ((d.diuLeft?.opacity ?? '0') !== '0' && (d.ddu?.opacity ?? '0') !== '0') break;
    await page.waitForTimeout(300);
  }
  expect(d!.diuLeft.opacity, 'DIU visible on the deck').toBe('1');
  expect(d!.ddu.opacity, 'DDU visible on the deck').toBe('1');
  expect(d!.diuLeft.rect.w, 'DIU sized for readability').toBeGreaterThan(150);
  // Fixed-glass policy: the deck does NOT parallax with the head — it stays put
  const before = d!.diuLeft.rect;
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(640, 520, { steps: 8 });
  await page.waitForTimeout(1200);
  await page.mouse.up();
  const after = (await vis()).diuLeft.rect;
  expect(Math.abs(after.y - before.y), 'deck stays pinned (fixed glass)').toBeLessThan(120);
  // standby survives even with avionics dark
  await page.getByTestId('hxf-avn').click();
  await page.waitForTimeout(900);
  const dark = await vis();
  expect(dark.stbyAdi?.opacity, 'standby ADI survives AVN off').toBe('1');
  await page.getByTestId('hxf-avn').click();
  await page.keyboard.press('Escape');
});

