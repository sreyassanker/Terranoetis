/**
 * Live FRONTEND smoke test — drives the REAL running app (vite :3000 → server
 * :3001) in headless Chromium (Playwright) and exercises the exact wiring
 * changed for the three 2D local scenarios: start a sim over HTTP, mount its
 * flat overlay via the app's dev hook (window.setKaggleOverlay), and assert
 * the honest-2D imagery layer (`<type>-flat`) is actually added to the live
 * Cesium viewer. Also fails on any uncaught page error.
 * Run: `npx tsx scripts/liveFrontendSmoke.mts`.
 */
import { chromium } from 'playwright';

const APP = 'http://localhost:3000/';
const cases = [
  { type: 'earthquake_swarm', lat: 35.68, lon: 139.65,
    body: { type: 'earthquake_swarm', lat: 35.68, lon: 139.65, grid_size: 256, extent_km: 128, magnitude: 7.0, depth_km: 10 } },
  { type: 'wildfire_spread', lat: 38.5, lon: -121.5,
    body: { type: 'wildfire_spread', lat: 38.5, lon: -121.5, grid_size: 128, extent_km: 10, wind_speed_ms: 10, wind_dir_deg: 270, humidity_pct: 15, duration_hours: 1, fuel_type: 'grass', seed: 42 } },
  { type: 'hurricane_landfall', lat: 29.3, lon: -94.8,
    body: { type: 'hurricane_landfall', lat: 29.3, lon: -94.8, grid_size: 192, extent_km: 240, category: 4, central_pressure_hpa: 946, radius_max_wind_km: 32, forward_speed_kmh: 30, duration_hours: 6 } },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors: string[] = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

let failures = 0;
try {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('!!window.__VIEWER__', null, { timeout: 90000 });
  console.log('app booted, Cesium viewer present');

  for (const c of cases) {
    const jobId = await page.evaluate(async (body) => {
      const r = await fetch('/api/kaggle/simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const { jobId } = await r.json();
      for (let i = 0; i < 400; i++) {
        const s = await (await fetch(`/api/kaggle/simulate/${jobId}`)).json();
        if (s.status === 'complete') return jobId;
        if (s.status === 'error') throw new Error(`job error: ${s.error}`);
        await new Promise((res) => setTimeout(res, 250));
      }
      throw new Error('timeout');
    }, c.body);

    await page.evaluate((o) => {
      (window as any).setKaggleOverlay(o);
    }, { jobId, lat: c.lat, lon: c.lon, scenarioType: c.type });

    const layerName = `${c.type}-flat`;
    let found = true;
    try {
      await page.waitForFunction((name) => {
        const v = (window as any).__VIEWER__;
        if (!v) return false;
        const layers = v.imageryLayers;
        for (let i = 0; i < layers.length; i++) {
          if ((layers.get(i) as any).name === name) return true;
        }
        return false;
      }, layerName, { timeout: 30000 });
    } catch { found = false; }

    // Prove the layer is actually PAINTED (not an empty raster): decode the
    // SingleTileImageryProvider's data URL and count non-transparent pixels.
    let coverage = 0;
    if (found) {
      await page.waitForTimeout(1200); // let the final-frame repaint settle
      coverage = await page.evaluate(async (name) => {
        const v = (window as any).__VIEWER__;
        const layers = v.imageryLayers;
        let layer: any = null;
        for (let i = 0; i < layers.length; i++) {
          if ((layers.get(i) as any).name === name) { layer = layers.get(i); break; }
        }
        if (!layer) return 0;
        const url = layer._imageryProvider?._url ?? layer._imageryProvider?._resource?.url;
        if (typeof url !== 'string' || !url.startsWith('data:')) return -1;
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
        let painted = 0;
        for (let p = 3; p < data.length; p += 4) if (data[p] > 0) painted++;
        return painted / (data.length / 4);
      }, layerName);
    }

    await page.screenshot({ path: `/tmp/fe-${c.type}.png` });
    await page.evaluate(() => (window as any).setKaggleOverlay(null));
    await page.waitForTimeout(500);

    const painted = found && coverage > 0.001;
    console.log(`${painted ? 'PASS' : 'FAIL'} ${c.type}: layer "${layerName}" ${found ? 'present' : 'MISSING'}, painted coverage=${coverage < 0 ? 'n/a' : (coverage * 100).toFixed(1) + '%'} (job ${jobId})`);
    if (!painted) failures++;
  }
} catch (e) {
  console.log('HARNESS ERROR:', (e as Error).message);
  failures++;
}

if (pageErrors.length) {
  console.log(`\nUncaught page errors (${pageErrors.length}):`);
  for (const pe of pageErrors.slice(0, 5)) console.log('  -', pe);
  failures++;
}

console.log(failures === 0 ? '\nALL FRONTEND SMOKE CASES PASSED' : `\n${failures} FAILURE(S)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
