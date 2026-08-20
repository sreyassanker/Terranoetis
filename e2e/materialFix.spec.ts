/**
 * Live regression test for the materialProperty.getType crash.
 *
 * The bug: ScenarioVisualizers assigned a raw Cesium.CallbackProperty to the
 * `material` slot of polygon/polyline graphics. Cesium's MaterialProperty.getValue
 * calls materialProperty.getType(time), and CallbackProperty has no getType, so
 * rendering threw "materialProperty.getType is not a function" and stopped.
 *
 * This test drives the real dev client: it generates one scenario of each type
 * that uses a specialized visualizer, opens the Scenario Gallery, selects the
 * scenario, waits for several render frames, and asserts no material error was
 * thrown and the canvas still renders.
 */

import { test, expect, chromium, type Browser, type Page, type BrowserContext, type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const SCENARIO_TYPES = [
  'volcanic_eruption',
  'wildfire_spread',
  'hurricane_landfall',
  'earthquake_swarm',
  'landslide',
  'tsunami_wave',
];

async function getToken(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE_URL}/api/auth/dev-login`);
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.token).toBeTruthy();
  return data.token as string;
}

async function generateScenario(request: APIRequestContext, token: string, type: string): Promise<any> {
  const params = { lat: 29.76, lon: -95.37 };
  const resp = await request.post(`${BASE_URL}/api/scenarios/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type, params },
  });
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data.scenario?.id).toBeTruthy();
  return data.scenario;
}

test('specialized scenario visualizers render without material.getType crash', async ({ request }) => {
  test.setTimeout(480_000);
  const token = await getToken(request);
  const generatedScenarios: any[] = [];
  for (const type of SCENARIO_TYPES) {
    try {
      const scenario = await generateScenario(request, token, type);
      generatedScenarios.push(scenario);
      console.log(`[materialFix] generated ${type} → ${scenario.id}`);
    } catch (e) {
      console.warn(`[materialFix] skip ${type}: ${e}`);
    }
  }
  expect(generatedScenarios.length).toBeGreaterThan(0);

  const launchOptions = {
    args: ['--enable-webgl', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
    headless: true,
    executablePath: process.env.PW_CHROME_PATH
      || '/Users/sreyassanker/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  };
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.cesium-widget', { timeout: 30_000 }).catch(async () => {
    await page.waitForSelector('canvas', { timeout: 30_000 });
  });

  const materialErrors: string[] = [];
  const otherErrors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      if (/getType|MaterialProperty/.test(text)) materialErrors.push(text);
      else if (!/favicon|net::ERR|Failed to load resource/i.test(text)) otherErrors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    if (/getType|MaterialProperty/.test(String(err))) materialErrors.push(String(err));
    else otherErrors.push(String(err));
  });

  for (const scenario of generatedScenarios) {
    const type = scenario.type;
    const t0 = Date.now();

    // Reload for a clean state (previous scenario selection closes the viewer).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 20_000 });
    await page.waitForTimeout(1500);

    // Inject the generated scenario directly into the viewer via the DEV-only
    // bridge. The gallery can't be used reliably here: its search only returns
    // the top-10 scenarios by validation score, so our generated scenarios are
    // not guaranteed to be listed.
    await page.evaluate((scenarioData) => {
      const w = window as unknown as Record<string, unknown>;
      const setScenario = w.setScenarioOverlay as ((s: any) => void) | undefined;
      if (typeof setScenario !== 'function') throw new Error('setScenarioOverlay bridge not available (DEV build only)');
      setScenario(scenarioData);
    }, scenario);

    // Wait for the ScenarioViewer panel + a few render frames
    await page.waitForSelector('text=SCENARIO VIEWER', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(4000);

    const raised = materialErrors.length;
    console.log(`[materialFix] ${type} → materialErrors=${materialErrors.length} otherErrors=${otherErrors.length} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);

    if (raised > 0) break;
  }

  // Canvas should still be alive and rendering (non-black)
  const stats = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.cesium-widget') as HTMLCanvasElement | null
      || document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return { hasCanvas: false };
    const temp = document.createElement('canvas');
    temp.width = Math.max(1, Math.floor(canvas.width / 8));
    temp.height = Math.max(1, Math.floor(canvas.height / 8));
    const ctx = temp.getContext('2d');
    if (!ctx) return { hasCanvas: true, no2d: true };
    ctx.drawImage(canvas, 0, 0, temp.width, temp.height);
    const d = ctx.getImageData(0, 0, temp.width, temp.height).data;
    let nonBlack = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) nonBlack++;
    }
    return { hasCanvas: true, nonBlackPixels: nonBlack, total: temp.width * temp.height };
  });

  expect(materialErrors, `material getType errors:\n${materialErrors.join('\n')}`).toHaveLength(0);
  console.log(`[materialFix] otherErrors:\n${otherErrors.join('\n')}`);
  if (!stats.hasCanvas) {
    await page.screenshot({ path: '/tmp/materialfix-nocanvas.png' });
    const body = (await page.evaluate(() => document.body.innerText)).slice(0, 500);
    console.warn(`[materialFix] no canvas. body="${body}"`);
  }
  expect(stats.hasCanvas).toBe(true);
  expect(stats.nonBlackPixels).toBeGreaterThan(0);

  await page.close();
  await browser.close();
});
