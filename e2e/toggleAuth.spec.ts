import { test, expect, type APIRequestContext } from '@playwright/test';
test.setTimeout(90000);

async function token(request: APIRequestContext): Promise<string> {
  const r = await request.post('/api/auth/dev-login');
  expect(r.ok()).toBeTruthy();
  const d = await r.json();
  return d.token as string;
}

test('toggle earthquakes on/off (authenticated)', async ({ page, request }) => {
  const TOKEN = await token(request);
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0,200)); });
  page.on('pageerror', (e) => logs.push('PAGEERR: ' + String(e).slice(0,200)));

  await page.addInitScript((tok) => {
    localStorage.setItem('auth_token', tok);
    localStorage.setItem('auth_user', JSON.stringify({ id: 'admin', name: 'admin', role: 'admin' }));
  }, TOKEN);

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(9000);

  const tgl = page.locator('.sidebar-toggle').first();
  if (await tgl.evaluate((el) => el.classList.contains('collapsed')).catch(() => false)) {
    await tgl.click(); await page.waitForTimeout(500);
  }
  for (let i = 0; i < 8; i++) {
    const closed = page.locator('.category:not(.open) .category-header').first();
    if (!(await closed.isVisible().catch(() => false))) break;
    await closed.click(); await page.waitForTimeout(100);
  }

  const eq = page.locator('.layer-item').filter({ hasText: 'Earthquakes' }).first();
  const wasOn = await eq.evaluate((el) => el.classList.contains('active'));
  console.log('wasOn:', wasOn);

  if (!wasOn) { await eq.click(); await page.waitForTimeout(3000); }
  const onInfo = await page.evaluate(() => {
    const v = (window as any).__terranoetisDebug?.viewer;
    if (!v) return { err: 'no viewer' };
    const all = v.entities.values;
    const eq = all.filter((e) => { try { return e.properties?.getValue?.()?.layer === 'earthquakes'; } catch { return false; } });
    return { total: all.length, eq: eq.length };
  });
  console.log('after ON:', JSON.stringify(onInfo));

  if (!wasOn) { await eq.click(); await page.waitForTimeout(1500); }
  const offInfo = await page.evaluate(() => {
    const v = (window as any).__terranoetisDebug?.viewer;
    if (!v) return { err: 'no viewer' };
    const all = v.entities.values;
    const eq = all.filter((e) => { try { return e.properties?.getValue?.()?.layer === 'earthquakes' && e.show !== false; } catch { return false; } });
    return { total: all.length, eq: eq.length };
  });
  console.log('after OFF:', JSON.stringify(offInfo));
  console.log('errors:', logs.slice(0,5));

  expect(onInfo.eq).toBeGreaterThan(0);
  expect(offInfo.eq).toBe(0);
});
