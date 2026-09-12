import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACT_DIR = '/Users/sreyassanker/.gemini/antigravity/brain/e9c9adff-b818-4025-aca3-936c7f6f067c';

test.setTimeout(120000);

test('check helicopter framing at ground 0m and high altitude 5000m', async ({ page }) => {
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(6000);

  // Close modal
  const closeMissionModal = page.locator('button[aria-label="Close"], button:has-text("Dismiss"), .lucide-x').first();
  if (await closeMissionModal.isVisible()) {
    await closeMissionModal.click().catch(() => {});
  }

  // Open Flight Simulator panel
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  
  // 1. Check Cold Start / 0m on Ground
  await page.getByTestId('heli-cold').click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForSelector('.hxdock', { timeout: 20000 });
  await page.waitForTimeout(4000);

  // Capture on ground (0m)
  const shotGround = path.join(ARTIFACT_DIR, 'heli_frame_0m_ground.png');
  await page.screenshot({ path: shotGround, fullPage: true });

  const groundProbe = await page.evaluate(() => {
    const w = window as any;
    const v = w.__VIEWER__;
    const st = w.__HELI?.simRef?.current?.state;
    const rig = w.__HELI?.rigRef?.current;
    const pos = w.Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.altM);
    v.scene.render();
    const win = w.Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, pos);
    const dockRect = document.querySelector('.hxdock')?.getBoundingClientRect();
    return {
      aglM: st?.aglM,
      altM: st?.altM,
      dist: rig?.snapshot?.dist,
      el: rig?.snapshot?.el,
      screenPos: win ? { x: win.x, y: win.y } : null,
      dockTop: dockRect ? dockRect.top : null,
      canvasH: v.canvas.clientHeight,
    };
  });
  console.log('GROUND PROBE (0m):', JSON.stringify(groundProbe, null, 2));

  // Exit sim
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // 2. Launch at default altitude (500m)
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForSelector('.hxdock', { timeout: 20000 });
  await page.waitForTimeout(4000);

  const shotNormal = path.join(ARTIFACT_DIR, 'heli_frame_normal_alt.png');
  await page.screenshot({ path: shotNormal, fullPage: true });

  const normalProbe = await page.evaluate(() => {
    const w = window as any;
    const v = w.__VIEWER__;
    const st = w.__HELI?.simRef?.current?.state;
    const rig = w.__HELI?.rigRef?.current;
    const pos = w.Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.altM);
    v.scene.render();
    const win = w.Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, pos);
    const dockRect = document.querySelector('.hxdock')?.getBoundingClientRect();
    return {
      aglM: st?.aglM,
      altM: st?.altM,
      dist: rig?.snapshot?.dist,
      el: rig?.snapshot?.el,
      screenPos: win ? { x: win.x, y: win.y } : null,
      dockTop: dockRect ? dockRect.top : null,
      canvasH: v.canvas.clientHeight,
    };
  });
  console.log('NORMAL PROBE (500m):', JSON.stringify(normalProbe, null, 2));

  // 3. Set altitude to 5000m
  await page.evaluate(() => {
    const w = window as any;
    const sim = w.__HELI?.simRef?.current;
    if (sim) {
      sim.state.altM = 5000;
      sim.state.aglM = 4500;
    }
  });
  await page.waitForTimeout(3000);

  const shot5000 = path.join(ARTIFACT_DIR, 'heli_frame_5000m_alt.png');
  await page.screenshot({ path: shot5000, fullPage: true });

  const highProbe = await page.evaluate(() => {
    const w = window as any;
    const v = w.__VIEWER__;
    const st = w.__HELI?.simRef?.current?.state;
    const rig = w.__HELI?.rigRef?.current;
    const pos = w.Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.altM);
    v.scene.render();
    const win = w.Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, pos);
    const dockRect = document.querySelector('.hxdock')?.getBoundingClientRect();
    return {
      aglM: st?.aglM,
      altM: st?.altM,
      dist: rig?.snapshot?.dist,
      el: rig?.snapshot?.el,
      screenPos: win ? { x: win.x, y: win.y } : null,
      dockTop: dockRect ? dockRect.top : null,
      canvasH: v.canvas.clientHeight,
    };
  });
  console.log('HIGH PROBE (5000m):', JSON.stringify(highProbe, null, 2));
});
