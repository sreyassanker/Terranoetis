import { chromium } from '@playwright/test';
import { writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const MAC_CHROME = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME_PATH = process.env.PW_CHROME_PATH ?? (existsSync(MAC_CHROME) ? MAC_CHROME : undefined);

const ARTIFACT_DIR = '/Users/sreyassanker/.gemini/antigravity/brain/0d7f5cb1-1248-45e6-8b00-8c963e217a6e';

// TRV Airport coordinates (exact bounding box from user run)
const TRV_RECT = {
  lonMin: 76.905,
  lonMax: 76.935,
  latMin: 8.468,
  latMax: 8.495,
};

async function run() {
  console.log('🚀 Launching Chromium for Live App Land Cover Verification...');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: [
      '--enable-webgl',
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
      '--window-size=1600,1000',
    ],
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();

  // Set auth credentials before load so LoginModal never intercepts pointer events
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'dev-live-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'admin', username: 'admin', role: 'admin' }));
  });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('LandCover') || text.includes('studyArea') || text.includes('Pipeline')) {
      console.log(`[Browser Console] ${text}`);
    }
  });

  console.log('🌐 Loading Terranoetis app on http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('⏳ Waiting for Cesium canvas to initialize...');
  await page.waitForSelector('.cesium-widget canvas', { timeout: 60000 });

  // Dismiss ApiVault modal on start
  const skipBtn = page.locator('button:has-text("Skip & Launch Cockpit"), button:has-text("Launch Cockpit")').first();
  if (await skipBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Dismissing ApiVault modal...');
    await skipBtn.click();
    await page.waitForTimeout(500);
  }

  console.log('⏳ Waiting for window.__terranoetisDebug.viewer...');
  await page.waitForFunction(() => {
    const win = window as any;
    return win.__terranoetisDebug?.viewer != null;
  }, { timeout: 60000 });

  console.log('✈️ Framing camera over TRV Airport (Thiruvananthapuram, India)...');
  await page.evaluate(([rect]) => {
    const win = window as any;
    const d = win.__terranoetisDebug;
    const destination = d.Cesium.Rectangle.fromDegrees(
      rect.lonMin,
      rect.latMin,
      rect.lonMax,
      rect.latMax
    );
    d.viewer.camera.setView({
      destination,
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    d.viewer.scene.requestRender();
  }, [TRV_RECT]);

  console.log('⏳ Waiting for satellite tiles to load over TRV Airport...');
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => {
    const win = window as any;
    const d = win.__terranoetisDebug;
    d.viewer.scene.requestRender();
    return d.viewer.scene.globe.tilesLoaded;
  }, { timeout: 60000, polling: 300 });

  await page.waitForTimeout(1500);

  console.log('📸 Capturing initial raw satellite framing over TRV Airport...');
  const rawScene = path.join(ARTIFACT_DIR, 'live_app_01_trv_satellite_raw.png');
  await page.screenshot({ path: rawScene });
  console.log(`Saved: ${rawScene}`);

  console.log('📂 Opening Models & Panels -> Land Cover Mapper...');
  await page.locator('button[title="Models & Panels"]').click();
  await page.waitForTimeout(500);
  await page.locator('.topbar-menu-item', { hasText: 'Land Cover Mapper' }).click();

  console.log('⏳ Waiting for Land Cover Mapper panel...');
  const mapBtn = page.getByRole('button', { name: /Map Land Cover/i });
  await mapBtn.waitFor({ state: 'visible', timeout: 15000 });

  console.log('🎛️ Verifying Opacity slider range starts at 0%...');
  const opacityInput = page.locator('input[type="range"][max="1.0"]');
  const minVal = await opacityInput.getAttribute('min');
  console.log(`Slider min attribute: ${minVal} (0 = starting from 0%)`);

  console.log('⚡ Triggering "Map Land Cover" run on live viewport...');
  await mapBtn.click();

  console.log('⏳ Waiting for pipeline execution to complete (Detect & Surface)...');
  await page.waitForSelector('text=Pushed to globe', { timeout: 60000 }).catch(async () => {
    // If auto-push not done, wait for 'Push to globe' button
    await page.waitForSelector('button:has-text("Push to globe")', { timeout: 60000 });
  });

  await page.waitForTimeout(2000);

  console.log('📸 Capturing live classified overlay (Default Opacity)...');
  const classifiedScene = path.join(ARTIFACT_DIR, 'live_app_02_trv_classified_default.png');
  await page.screenshot({ path: classifiedScene });
  console.log(`Saved: ${classifiedScene}`);

  console.log('🎚️ Testing slider at Opacity 0% (revealing raw imagery)...');
  await page.evaluate(() => {
    const input = document.querySelector('input[type="range"][max="1.0"]') as HTMLInputElement;
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter ? setter.call(input, '0') : (input.value = '0');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(800);
  const opacity0Scene = path.join(ARTIFACT_DIR, 'live_app_03_trv_opacity_0pct.png');
  await page.screenshot({ path: opacity0Scene });
  console.log(`Saved: ${opacity0Scene}`);

  console.log('🎚️ Testing slider at Opacity 100% (full classification overlay)...');
  await page.evaluate(() => {
    const input = document.querySelector('input[type="range"][max="1.0"]') as HTMLInputElement;
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter ? setter.call(input, '1') : (input.value = '1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(800);
  const opacity100Scene = path.join(ARTIFACT_DIR, 'live_app_04_trv_opacity_100pct.png');
  await page.screenshot({ path: opacity100Scene });
  console.log(`Saved: ${opacity100Scene}`);

  console.log('📸 Capturing Land Cover Mapper Panel detailed results...');
  const panel = page.locator('div[style*="position: absolute"]:has-text("Land Cover Mapper")');
  const panelScreenshot = path.join(ARTIFACT_DIR, 'live_app_05_panel_results_card.png');
  await panel.screenshot({ path: panelScreenshot });
  console.log(`Saved: ${panelScreenshot}`);

  await browser.close();
  console.log('🎉 Live App Verification Complete!');
}

run().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
