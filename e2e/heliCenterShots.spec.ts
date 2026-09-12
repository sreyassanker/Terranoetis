import { test } from '@playwright/test';

test.setTimeout(300000);

async function launch(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForSelector('.hxdock', { timeout: 20000 });
}

const st = (page: import('@playwright/test').Page) => page.evaluate(() =>
  (window as unknown as Record<string, any>).__HELI.simRef.current.state);

test('screens: external hover + cruise', async ({ page }) => {
  await launch(page);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/heli_ext_spawn.png' });

  await page.keyboard.down('w');
  await page.waitForTimeout(3500);
  await page.keyboard.up('w');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/heli_ext_hover.png' });

  await page.keyboard.down('d');
  await page.waitForTimeout(2500);
  await page.keyboard.up('d');
  await page.keyboard.down('ArrowUp');
  for (let i = 0; i < 40; i++) {
    const s = await st(page);
    if (s.tasKts > 55) break;
    await page.waitForTimeout(1000);
  }
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2000);
  console.log('cruise state:', JSON.stringify({ tasKts: (await st(page)).tasKts }));
  await page.screenshot({ path: '/tmp/heli_ext_cruise.png' });

  // sustained high speed
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(8000);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(1500);
  console.log('fast state:', JSON.stringify({ tasKts: (await st(page)).tasKts }));
  await page.screenshot({ path: '/tmp/heli_ext_fast.png' });
});
