/**
 * Live Land Cover Mapper test.
 *
 * Heavy path (skipped by default): LULC_HEAVY=1 npx playwright test e2e/landCoverMapper.spec.ts
 * The heavy path flies the camera over the Nile delta (Cairo), runs the default
 * spectral land-cover pipeline, and asserts the grid + legend render. DETR is
 * opt-in (checkbox) and adds no measured accuracy on satellite imagery, so the
 * default run is spectral-only and fast. The light structural test always runs
 * and asserts the panel can open and a run starts.
 */

import { test, expect, chromium } from '@playwright/test';

import { homedir } from 'os';

interface TerranoetisDebug {
  viewer: {
    camera: {
      setView: (options: { destination: unknown; orientation: { heading: number; pitch: number; roll: number } }) => void;
    };
    scene: {
      requestRender: () => void;
      globe: { tilesLoaded: boolean };
    };
    Cesium: {
      Rectangle: {
        fromDegrees: (lonMin: number, latMin: number, lonMax: number, latMax: number) => unknown;
      };
    };
  };
}

const CHROME_PATH = process.env.PW_CHROME_PATH
  ?? `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const APP = 'http://localhost:3000';
// Nile Delta / Cairo: urban + Nile water + irrigated green fields + desert.
const RECT = { lonMin: 30.8, lonMax: 31.5, latMin: 29.85, latMax: 30.35 };

// Known benign startup noise that must not fail the tests:
//  - WebGL/Cesium renderer warnings (headless GPU)
//  - GET /social/stream 401 — the app's collaboration stream requires auth;
//    the unauthenticated boot fetch is a pre-existing app issue, unrelated to LULC.
function seriousErrors(errs: string[]): string[] {
  return errs.filter(e => !e.includes('WebGL')
    && !e.includes('Cesium')
    && !e.includes('401 (Unauthorized)'));
}

async function launch(): Promise<{ browser: import('@playwright/test').Browser; page: import('@playwright/test').Page }> {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ['--enable-webgl', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return { browser, page: await ctx.newPage() };
}

// A Cesium app never stops requesting tiles, so `networkidle` is flaky. Load the
// DOM and wait for the Cesium canvas instead.
async function loadApp(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.cesium-widget canvas', { timeout: 60_000 });
}

async function openPanel(page: import('@playwright/test').Page): Promise<void> {
  // Open the Models & Panels menu (title-only trigger) then click its Land Cover Mapper entry.
  await page.click('button[title="Models & Panels"]');
  await page.locator('.topbar-menu-item', { hasText: 'Land Cover Mapper' }).click({ timeout: 8_000 });
  await page.getByRole('button', { name: /Map Land Cover/i }).waitFor({ state: 'visible', timeout: 8_000 });
}

// Fly the camera top-down over the Cairo rectangle and wait for imagery tiles.
async function frameCairo(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const win = window as Window & { __terranoetisDebug?: TerranoetisDebug };
    return win.__terranoetisDebug?.viewer != null;
  }, { timeout: 60_000 });
  await page.evaluate(([rect]) => {
    const win = window as Window & { __terranoetisDebug?: TerranoetisDebug };
    const d = win.__terranoetisDebug!;
    d.viewer.camera.setView({
      destination: d.Cesium.Rectangle.fromDegrees(rect.lonMin, rect.latMin, rect.lonMax, rect.latMax),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    d.viewer.scene.requestRender();
  }, [RECT]);
  await page.waitForFunction(() => {
    const win = window as Window & { __terranoetisDebug?: TerranoetisDebug };
    const d = win.__terranoetisDebug!;
    d.viewer.scene.requestRender();
    return d.viewer.scene.globe.tilesLoaded;
  }, { timeout: 60_000, polling: 200 });
  await page.waitForTimeout(1500);
}

test('Land Cover Mapper panel renders and begins a run on click', async () => {
  test.setTimeout(90_000);
  const { browser, page } = await launch();
  const consoleErrors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await loadApp(page);
  await openPanel(page);

  // Trigger a run — the step tracker should spring to life.
  await page.getByRole('button', { name: /Map Land Cover/i }).click();
  await expect(page.getByRole('button', { name: /Cancel/i })).toBeVisible({ timeout: 10_000 });

  // No serious console errors (benign WebGL/Cesium + social-stream 401 filtered).
  expect(seriousErrors(consoleErrors)).toEqual([]);
  await browser.close();
});

test('(heavy) run produces a land-cover grid with classes', async () => {
  test.skip(process.env.LULC_HEAVY !== '1');
  test.setTimeout(180_000); // spectral default is fast; keep headroom for DETR opt-in runs
  const { browser, page } = await launch();
  const hits: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error') consoleErrors.push(t);
    if (t.includes('[LandCover]') || t.includes('DETR')) hits.push(t);
  });

  await loadApp(page);
  await frameCairo(page); // top-down over real Cairo imagery (Nile delta: urban + fields + desert)
  await openPanel(page);
  await page.getByRole('button', { name: /Map Land Cover/i }).click();

  // The pipeline pushes its result to the globe once classification completes.
  await page.getByRole('button', { name: /Pushed to globe/i }).waitFor({ timeout: 240_000 });

  // A completed run always renders the REGIONS thumbnail from the class map.
  await expect(page.getByText('REGIONS', { exact: true })).toBeVisible({ timeout: 10_000 });

  // The spectral classifier labels every pixel (≈98% coverage on this scene),
  // so the "%" legend rows always render. (Headless capture is a real image,
  // not black — verified via a capture diagnostic.)
  await expect(page.getByText(/\d+\.\d%/, { exact: false }).first()).toBeVisible({ timeout: 10_000 });

  // Filter out the well-known benign WebGL/Cesium warnings + social-stream 401.
  expect(seriousErrors(consoleErrors)).toEqual([]);
  await browser.close();
});
