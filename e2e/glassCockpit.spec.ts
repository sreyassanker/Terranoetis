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

test('scene mode: live in-world instruments animate and honour avionics master', async ({ page }) => {
  await launch(page);
  const probe = () => page.evaluate(() => {
    const i = (window as any).__HELI?.instrRef?.current;
    if (!i) return null;
    const l = i.lastData;
    return { stats: i.stats, last: l ? { ias: l.iasKts, avnDark: l.avnDark, altFt: l.altFt } : null };
  });
  let p = null as Awaited<ReturnType<typeof probe>>;
  for (let i = 0; i < 20; i++) { p = await probe(); if (p?.stats.live && p.stats.frames > 2) break; await page.waitForTimeout(300); }
  expect(p?.stats.live, 'in-scene screens built').toBe(true);
  expect(p!.stats.visible, 'screens visible in cockpit mode').toBe(true);
  expect(p!.stats.screens).toBe(4);
  const f0 = p!.stats.frames;
  let repainted = false;
  for (let i = 0; i < 40 && !repainted; i++) {   // ≥12 extra repaints within ~20 s (load-tolerant)
    await page.waitForTimeout(500);
    const p2 = await probe();
    repainted = !!p2 && p2.stats.frames > f0 + 12;
  }
  expect(repainted, 'instruments keep repainting (30 Hz target)').toBe(true);

  // pixel evidence: same static camera → frames differ because needles dance
  const shot = async () => createHash('sha1').update(await page.locator('canvas').first().screenshot()).digest('hex');
  const s0 = await shot(); await page.waitForTimeout(450); const s1 = await shot();
  expect(s1, 'animated pixels change the framebuffer').not.toBe(s0);

  // avionics master → avnDark flag, standby keeps painting
  await page.getByTestId('hxf-avn').click();
  let dark = null as Awaited<ReturnType<typeof probe>>;
  for (let i = 0; i < 20; i++) { dark = await probe(); if (dark?.last?.avnDark === true) break; await page.waitForTimeout(250); }
  expect(dark!.last!.avnDark, 'glass instruments go dark with AVN off').toBe(true);
  await page.getByTestId('hxf-avn').click();
  for (let i = 0; i < 20; i++) { dark = await probe(); if (dark?.last?.avnDark === false) break; await page.waitForTimeout(250); }
  expect(dark!.last!.avnDark).toBe(false);

  // exit cockpit → screens hidden
  await page.keyboard.press('c');
  await page.waitForTimeout(700);
  const p2 = await probe();
  expect(p2!.stats.visible, 'screens hidden in external mode').toBe(false);
  await page.keyboard.press('Escape');
});

test('DOM mode: panels pin to console geometry and parallax with head motion', async ({ page }) => {
  await launch(page, '/?deckdom=1');
  const deckT = () => page.evaluate(() => {
    const out: Record<string, { opacity: string; transform: string }> = {};
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-deck-id]'))) {
      out[el.dataset.deckId as string] = { opacity: el.style.opacity, transform: el.style.transform };
    }
    return out;
  });
  let d = null as Awaited<ReturnType<typeof deckT>> | null;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    d = await deckT(page);
    if (d.diuLeft?.opacity === '1' && d.ddu?.opacity === '1') break;
  }
  expect(d!.diuLeft.opacity, 'DIU pinned').toBe('1');
  expect(d!.ddu.opacity, 'DDU pinned').toBe('1');
  const before = d!.diuLeft.transform;
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(640, 520, { steps: 8 });
  await page.mouse.up();
  let moved = before;
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(250); moved = (await deckT(page)).diuLeft.transform; if (moved !== before) break; }
  expect(moved, 'deck parallaxes when the pilot looks up').not.toBe(before);

  // let the head spring back to the instrument scan before the avn check
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(300); const d2 = await deckT(page); if (d2.stbyAdi?.opacity === '1' && d2.diuLeft?.opacity === '1') break; }

  await page.getByTestId('hxf-avn').click();
  let dark = d;
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(250); dark = await deckT(page); if (dark.diuLeft.opacity === '0') break; }
  expect(dark!.diuLeft.opacity, 'DIU hides with AVN off').toBe('0');
  expect(dark!.stbyAdi.opacity, 'standby ADI always on').toBe('1');
  await page.keyboard.press('Escape');
});
