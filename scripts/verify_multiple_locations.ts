import { chromium } from '@playwright/test';
import { existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const MAC_CHROME = `${homedir()}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME_PATH = process.env.PW_CHROME_PATH ?? (existsSync(MAC_CHROME) ? MAC_CHROME : undefined);

const ARTIFACT_DIR = '/Users/sreyassanker/.gemini/antigravity/brain/0d7f5cb1-1248-45e6-8b00-8c963e217a6e';

interface TargetLocation {
  id: string;
  name: string;
  region: string;
  expectedDominant: string;
  rect: {
    lonMin: number;
    lonMax: number;
    latMin: number;
    latMax: number;
  };
}

const LOCATIONS: TargetLocation[] = [
  {
    id: 'mont_blanc',
    name: 'Mont Blanc Summit & Glaciers',
    region: 'French Alps (High Alpine Cryosphere)',
    expectedDominant: 'Glacier / Snow (#FFFFFF) + Barren Rock (#71577F)',
    rect: {
      lonMin: 6.835,
      lonMax: 6.895,
      latMin: 45.815,
      latMax: 45.855,
    },
  },
  {
    id: 'sf_bay',
    name: 'San Francisco Bay & Port Piers',
    region: 'California, USA (Maritime & Urban Harbor)',
    expectedDominant: 'Deep / Coastal Water (#0077B6 / #00AFEF) + Ships/Piers (#BEBEBE)',
    rect: {
      lonMin: -122.42,
      lonMax: -122.34,
      latMin: 37.79,
      latMax: 37.84,
    },
  },
  {
    id: 'cairo_nile',
    name: 'Cairo & Nile River Delta',
    region: 'Egypt (River Oasis & Desert Metropolis)',
    expectedDominant: 'Nile Water (#00AFEF) + Floodplain Veg + Dense Urban (#E63946)',
    rect: {
      lonMin: 31.20,
      lonMax: 31.26,
      latMin: 30.01,
      latMax: 30.06,
    },
  },
  {
    id: 'central_valley',
    name: 'Central Valley Croplands',
    region: 'California, USA (Intensive Agriculture)',
    expectedDominant: 'Crops (#FFF212) + Bare Soil (#CE8F64)',
    rect: {
      lonMin: -119.92,
      lonMax: -119.82,
      latMin: 36.61,
      latMax: 36.68,
    },
  },
];

async function run() {
  console.log('🚀 Starting Global Multi-Location LULC Verification Pipeline...');
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

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'dev-live-token');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'admin', username: 'admin', role: 'admin' }));
  });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('LandCover') || text.includes('Pipeline') || text.includes('Classify')) {
      console.log(`[Browser Console] ${text}`);
    }
  });

  console.log('🌐 Loading Terranoetis application on http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('⏳ Waiting for Cesium canvas to initialize...');
  await page.waitForSelector('.cesium-widget canvas', { timeout: 60000 });

  const skipBtn = page.locator('button:has-text("Skip & Launch Cockpit"), button:has-text("Launch Cockpit")').first();
  if (await skipBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Dismissing ApiVault modal...');
    await skipBtn.click();
    await page.waitForTimeout(500);
  }

  console.log('⏳ Waiting for Cesium viewer...');
  await page.waitForFunction(() => {
    const win = window as any;
    return win.__terranoetisDebug?.viewer != null;
  }, { timeout: 60000 });

  console.log('📂 Opening Models & Panels -> Land Cover Mapper...');
  await page.locator('button[title="Models & Panels"]').click();
  await page.waitForTimeout(500);
  await page.locator('.topbar-menu-item', { hasText: 'Land Cover Mapper' }).click();

  const mapBtn = page.getByRole('button', { name: /Map Land Cover/i });
  await mapBtn.waitFor({ state: 'visible', timeout: 15000 });

  const resultsSummary: Record<string, any> = {};

  for (const loc of LOCATIONS) {
    console.log(`\n======================================================`);
    console.log(`📍 Evaluating Location: ${loc.name} (${loc.region})`);
    console.log(`🎯 Expected Dominant: ${loc.expectedDominant}`);
    console.log(`======================================================`);

    // 1. Clear any prior overlay
    const clearBtn = page.locator('button[title="Clear globe overlay"]');
    if (await clearBtn.isVisible().catch(() => false)) {
      await clearBtn.click();
      await page.waitForTimeout(400);
    }

    // 2. Set camera view
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
    }, [loc.rect]);

    // 3. Wait for tiles to load
    console.log('⏳ Waiting for high-res satellite tiles to stream...');
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => {
      const win = window as any;
      const d = win.__terranoetisDebug;
      d.viewer.scene.requestRender();
      return d.viewer.scene.globe.tilesLoaded;
    }, { timeout: 60000, polling: 300 });
    await page.waitForTimeout(1500);

    // 4. Capture raw satellite terrain
    const rawFile = path.join(ARTIFACT_DIR, `multi_${loc.id}_01_raw.png`);
    await page.screenshot({ path: rawFile });
    console.log(`📸 Saved Raw Satellite: ${rawFile}`);

    // 5. Trigger Map Land Cover
    console.log('⚡ Running Land Cover Mapper on live viewport...');
    await mapBtn.click();

    // 6. Wait for classification to finish
    await page.waitForSelector('text=Pushed to globe', { timeout: 60000 }).catch(async () => {
      await page.waitForSelector('button:has-text("Push to globe")', { timeout: 60000 });
    });
    await page.waitForTimeout(1500);

    // 7. Set Opacity to 100% to evaluate solid classification
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

    // 8. Capture 100% classification overlay
    const classifiedFile = path.join(ARTIFACT_DIR, `multi_${loc.id}_02_classified_100pct.png`);
    await page.screenshot({ path: classifiedFile });
    console.log(`📸 Saved Classified 100% Overlay: ${classifiedFile}`);

    // 9. Capture panel results card
    const panel = page.locator('div[style*="position: absolute"]:has-text("Land Cover Mapper")');
    const panelFile = path.join(ARTIFACT_DIR, `multi_${loc.id}_03_panel.png`);
    await panel.screenshot({ path: panelFile });
    console.log(`📸 Saved Panel Results Card: ${panelFile}`);

    // 10. Extract stats from panel text & DOM rows
    const breakdown = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div[style*="gap: 4px"] > div[style*="font-size: 11px"]'));
      return rows.map(r => {
        const spans = r.querySelectorAll('span');
        const name = spans[1]?.textContent?.trim() || '';
        const pct = spans[2]?.textContent?.trim() || '';
        return name && pct ? `${name}: ${pct}` : '';
      }).filter(Boolean);
    });

    console.log(`📊 Panel Breakdown for ${loc.name}:\n${breakdown.join('\n')}`);
    resultsSummary[loc.id] = {
      name: loc.name,
      region: loc.region,
      breakdown,
    };
  }

  await browser.close();
  console.log('\n🎉 Multi-Location LULC Verification Completed Successfully!');
  console.log(JSON.stringify(resultsSummary, null, 2));
}

run().catch(err => {
  console.error('❌ Multi-location verification failed:', err);
  process.exit(1);
});
