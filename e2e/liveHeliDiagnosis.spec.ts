import { test, expect } from '@playwright/test';

test.setTimeout(180000);

test('diagnose helicopter simulation views and issues', async ({ page }) => {
  // Capture browser console logs and errors
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(6000);

  // Dismiss any onboarding modals if present
  const closeMissionModal = page.locator('button[aria-label="Close"], button:has-text("Dismiss"), .lucide-x').first();
  if (await closeMissionModal.isVisible()) {
    await closeMissionModal.click().catch(() => {});
  }

  // Open Flight Simulator panel
  const flyBtn = page.locator('button[title="Flight Simulator"]');
  await flyBtn.waitFor({ state: 'visible', timeout: 10000 });
  await flyBtn.click();

  // Select Apache Helicopter Sim
  const heliOption = page.getByText('Apache Helicopter Sim', { exact: true });
  await heliOption.waitFor({ state: 'visible', timeout: 5000 });
  await heliOption.click();

  // Click LAUNCH FLIGHT
  const launchBtn = page.getByText('LAUNCH FLIGHT');
  await launchBtn.waitFor({ state: 'visible', timeout: 5000 });
  await launchBtn.click();

  // Wait for flight dock to mount
  await page.waitForSelector('.hxdock', { timeout: 20000 });
  await page.waitForTimeout(3000);

  // Take screenshot of current default External View
  await page.screenshot({ path: '/tmp/heli_diag_external_default.png', fullPage: true });

  // Test Switching to Cockpit View
  const cpitBtn = page.locator('button:has-text("CPIT"), button[data-testid="hxf-sw-cpit"]').first();
  if (await cpitBtn.isVisible()) {
    await cpitBtn.click();
  } else {
    await page.keyboard.press('KeyC');
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/heli_diag_cockpit.png', fullPage: true });

  // Probe telemetry and model state
  const state = await page.evaluate(() => {
    const w = window as any;
    const Cesium = w.Cesium;
    const v = w.__VIEWER__;
    const st = w.__HELI?.simRef?.current?.state;
    const rig = w.__HELI?.rigRef?.current;
    const model = w.__HELI?.modelRef?.current;
    const mode = w.__HELI?.modeRef?.current || 'unknown';
    
    let modelBBoxCenter = null;
    let heliScreenPos = null;
    if (v && st) {
      const pos = Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.altM);
      v.scene.render();
      const win = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, pos);
      if (win) {
        heliScreenPos = { x: win.x, y: win.y, screenW: v.canvas.clientWidth, screenH: v.canvas.clientHeight };
      }
    }

    return {
      mode,
      st,
      rigSnapshot: rig?.snapshot,
      heliScreenPos,
      dockVisible: !!document.querySelector('.hxdock'),
      hudVisible: !!document.querySelector('.hxhud'),
      dockHeight: document.querySelector('.hxdock')?.clientHeight,
      dockWidth: document.querySelector('.hxdock')?.clientWidth,
    };
  });

  console.log('DIAGNOSTIC STATE:', JSON.stringify(state, null, 2));

  // Switch back to external view
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(2000);

  // Apply some collective (W) and cyclic (ArrowUp) to test flight dynamics
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(4000);
  await page.keyboard.up('ArrowUp');

  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/heli_diag_external_flying.png', fullPage: true });
});
