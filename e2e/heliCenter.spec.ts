/**
 * Live probe: is the Apache centered on screen in external (chase) mode?
 * Measures the projected pixel offset of the heli position from the canvas
 * center at hover, at speed, and mid-turn.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });

async function launch(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForSelector('.hxdock', { timeout: 20000 });
}

const centerOffset = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const Cesium = (window as unknown as Record<string, any>).Cesium;
  const w = window as unknown as Record<string, any>;
  const v = w.__VIEWER__;
  const st = w.__HELI?.simRef?.current?.state;
  const rig = w.__HELI?.rigRef?.current;
  if (!v || !st) return null;
  const pos = Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.altM);
  const s = v.scene;
  s.render();
  const win = Cesium.SceneTransforms.worldToWindowCoordinates(s, pos);
  const cw = v.canvas.clientWidth / 2, ch = v.canvas.clientHeight / 2;
  return {
    dx: win ? win.x - cw : null,
    dy: win ? win.y - ch : null,
    behindDist: win && !rig ? null : (rig ? rig.snapshot.az : null),
    tasKts: st.tasKts, aglM: st.aglM, headingDeg: st.headingDeg,
    canvasW: v.canvas.clientWidth, canvasH: v.canvas.clientHeight,
  };
});

test('external mode centering probe', async ({ page }) => {
  await launch(page);

  // settle in hover
  await page.keyboard.down('w');
  await page.waitForTimeout(4000);
  await page.keyboard.up('w');
  await page.waitForTimeout(5000);

  const hov = await centerOffset(page);
  console.log('HOVER offset:', JSON.stringify(hov));
  expect(hov, 'probe available').toBeTruthy();

  // accelerate to cruise
  await page.keyboard.down('d');
  await page.waitForTimeout(2000);
  await page.keyboard.up('d');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(6000);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2500);
  const cruise = await centerOffset(page);
  console.log('CRUISE offset:', JSON.stringify(cruise));

  // hard turn
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(2200);
  const turn = await centerOffset(page);
  console.log('TURN offset:', JSON.stringify(turn));
  await page.keyboard.up('ArrowRight');

  // visual sanity: heli bbox should overlap the center column
  const vis = await page.evaluate(() => {
    const Cesium = (window as unknown as Record<string, any>).Cesium;
    const v = (window as unknown as Record<string, any>).__VIEWER__;
    const m = (window as unknown as Record<string, any>).__HELI.modelRef.current;
    if (!m) return null;
    const bs = m.boundingSphere; // model frame center? Cesium stores world bs after update
    v.scene.render();
    const world = Cesium.BoundingSphere.clone(bs);
    const c = Cesium.Cartesian3.clone(world.center);
    const win = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, c);
    return { bsCenterScreen: win ? { x: win.x - v.canvas.clientWidth / 2, y: win.y - v.canvas.clientHeight / 2 } : null, radius: world.radius };
  });
  console.log('MODEL bbox center:', JSON.stringify(vis));

  // don't assert yet — this run is a measurement; report numbers
});
