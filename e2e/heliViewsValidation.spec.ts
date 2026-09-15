import { test, expect } from '@playwright/test';

test.setTimeout(240000);

test('validate 2 external views and internal cockpit view', async ({ page }) => {
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(6000);

  // Close any onboarding modal
  const closeMissionModal = page.locator('button[aria-label="Close"], button:has-text("Dismiss"), .lucide-x').first();
  if (await closeMissionModal.isVisible()) {
    await closeMissionModal.click().catch(() => {});
  }

  // Open Flight Simulator panel
  const flyBtn = page.locator('button[title="Flight Simulator"]');
  await flyBtn.waitFor({ state: 'visible', timeout: 10000 });
  await flyBtn.click();

  // Select Apache Helicopter Sim & Launch
  const heliOption = page.getByText('Apache Helicopter Sim', { exact: true });
  await heliOption.waitFor({ state: 'visible', timeout: 5000 });
  await heliOption.click();

  const launchBtn = page.getByText('LAUNCH FLIGHT');
  await launchBtn.waitFor({ state: 'visible', timeout: 5000 });
  await launchBtn.click();

  // Wait for flight dock to mount
  await page.waitForSelector('.hxdock', { timeout: 20000 });
  await page.waitForTimeout(3000);

  // ─── 1. External View 1: Close Gaming Chase View ───
  await page.screenshot({ path: '/tmp/heli_view_1_close_chase.png', fullPage: true });

  const closeProbe = await page.evaluate(() => {
    const w = window as any;
    const v = w.__VIEWER__;
    const st = w.__HELI?.simRef?.current?.state;
    const rig = w.__HELI?.rigRef?.current;
    const m = w.__HELI?.modelRef?.current;
    if (!v || !st) return null;

    const pos = w.Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.altM);
    v.scene.render();
    const win = w.Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, pos);
    const cw = v.canvas.clientWidth / 2;
    const ch = v.canvas.clientHeight / 2;

    return {
      mode: w.__HELI?.modeRef?.current,
      dist: rig?.snapshot?.dist,
      dx: win ? win.x - cw : null,
      dy: win ? win.y - ch : null,
      dockHeight: document.querySelector('.hxdock')?.clientHeight,
      sidebarVisible: !document.querySelector('.sidebar')?.classList.contains('collapsed'),
    };
  });

  console.log('VIEW 1 (CLOSE CHASE):', JSON.stringify(closeProbe, null, 2));
  expect(closeProbe).toBeTruthy();
  expect(closeProbe!.mode).toBe('chase-close');
  expect(closeProbe!.dist).toBeLessThan(35); // Close gaming distance (~21m)
  expect(closeProbe!.dockHeight).toBeLessThan(220); // Sleek, non-intrusive dock

  // ─── 2. External View 2: Wide Tactical Chase View ───
  const wideBtn = page.locator('button[data-testid="hxf-sw-wide"]');
  await wideBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/heli_view_2_wide_chase.png', fullPage: true });

  const wideProbe = await page.evaluate(() => {
    const w = window as any;
    const rig = w.__HELI?.rigRef?.current;
    return {
      mode: w.__HELI?.modeRef?.current,
      dist: rig?.snapshot?.dist,
    };
  });
  console.log('VIEW 2 (WIDE CHASE):', JSON.stringify(wideProbe, null, 2));
  expect(wideProbe.mode).toBe('chase-wide');
  expect(wideProbe.dist).toBeGreaterThan(45); // Tactical overview distance (~60m)

  // ─── 3. Internal View: Cockpit View ───
  const cpitBtn = page.locator('button[data-testid="hxf-sw-cpit"]');
  await cpitBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/heli_view_3_cockpit.png', fullPage: true });

  const cpitProbe = await page.evaluate(() => {
    const w = window as any;
    const head = w.__HELI?.headRef?.current;
    const v = w.__VIEWER__;
    return {
      mode: w.__HELI?.modeRef?.current,
      headPitch: head?.pitch,
      camPitch: v.camera.pitch,
      hudVisible: !!document.querySelector('.hxf-ihadss'),
      deckVisible: !!document.querySelector('.hxf-deck'),
    };
  });
  console.log('VIEW 3 (COCKPIT):', JSON.stringify(cpitProbe, null, 2));
  expect(cpitProbe.mode).toBe('cockpit');
  expect(cpitProbe.hudVisible).toBe(true);
  // Camera pitch should be looking forward toward the horizon (not straight down at -29°!)
  expect(cpitProbe.camPitch).toBeGreaterThan(-0.35); // within -20° of horizon

  // ─── 4. Test Flight in Close Chase Mode ───
  await page.keyboard.press('KeyC'); // Toggle back to close chase
  await page.waitForTimeout(1500);

  // Climb and accelerate
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');

  await page.keyboard.down('ArrowUp');
  // honest thrust-vector acceleration: poll the sim, don't guess wall-time
  await page.waitForFunction(() => ((window as any).__HELI?.simRef?.current?.state?.iasKts ?? 0) > 18,
    null, { timeout: 150000 });
  await page.keyboard.up('ArrowUp');

  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/heli_view_flying.png', fullPage: true });

  const flightProbe = await page.evaluate(() => {
    const w = window as any;
    const st = w.__HELI?.simRef?.current?.state;
    const v = w.__VIEWER__;
    const pos = w.Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.altM);
    v.scene.render();
    const win = w.Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, pos);
    return {
      iasKts: st?.iasKts,
      altM: st?.altM,
      screenPos: win ? { x: win.x, y: win.y } : null,
      canvasH: v.canvas.clientHeight,
    };
  });
  console.log('FLIGHT PROBE:', JSON.stringify(flightProbe, null, 2));
  expect(flightProbe.iasKts).toBeGreaterThan(15);
  // Helicopter must be on screen and above the dock
  expect(flightProbe.screenPos).toBeTruthy();
  expect(flightProbe.screenPos!.y).toBeLessThan(flightProbe.canvasH - 80);
});
