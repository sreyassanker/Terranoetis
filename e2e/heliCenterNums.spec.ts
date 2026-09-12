import { test } from '@playwright/test';

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

const probe = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const Cesium = (window as unknown as Record<string, any>).Cesium;
  const w = window as unknown as Record<string, any>;
  const v = w.__VIEWER__;
  const st = w.__HELI.simRef.current.state;
  const rig = w.__HELI.rigRef.current;
  const m = w.__HELI.modelRef.current;
  v.scene.render();
  const cw = v.canvas.clientWidth / 2, ch = v.canvas.clientHeight / 2;
  const halfV = Cesium.Math.toDegrees(Math.atan(Math.tan(v.camera.frustum.fov / 2) / (v.canvas.clientWidth / v.canvas.clientHeight)));
  const pos = Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.altM);
  const a = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, pos);
  let bs: { x: number; y: number } | null = null;
  if (m) {
    const c = Cesium.Cartesian3.clone(m.boundingSphere.center);
    const b = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, c);
    if (b) bs = { x: b.x - cw, y: b.y - ch };
  }
  return {
    offOrigin: a ? { x: +(a.x - cw).toFixed(1), y: +(a.y - ch).toFixed(1) } : null,
    offBbox: bs ? { x: +bs.x.toFixed(1), y: +bs.y.toFixed(1) } : null,
    tasKts: +st.tasKts.toFixed(1), aglM: +st.aglM.toFixed(0),
    dist: rig ? +rig.snapshot.dist.toFixed(1) : null, elDeg: rig ? +Cesium.Math.toDegrees(rig.snapshot.el).toFixed(1) : null,
    halfVFovDeg: +halfV.toFixed(1),
    pctBelowCenter: a ? +(((a.y - ch) / ch) * 100).toFixed(1) : null,
  };
});

const stt = (page: import('@playwright/test').Page) => page.evaluate(() =>
  (window as unknown as Record<string, any>).__HELI.simRef.current.state);

test('centering by numbers', async ({ page }) => {
  await launch(page);
  await page.waitForTimeout(3000);
  console.log('SPAWN  ', JSON.stringify(await probe(page)));

  await page.keyboard.down('w');
  await page.waitForTimeout(3500);
  await page.keyboard.up('w');
  await page.waitForTimeout(2500);
  console.log('HOVER  ', JSON.stringify(await probe(page)));

  await page.keyboard.down('d');
  await page.waitForTimeout(2500);
  await page.keyboard.up('d');
  await page.keyboard.down('ArrowUp');
  for (let i = 0; i < 30; i++) {
    if ((await stt(page)).tasKts > 60) break;
    await page.waitForTimeout(1000);
  }
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2000);
  console.log('CRUISE ', JSON.stringify(await probe(page)));

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(9000);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(1500);
  console.log('FAST   ', JSON.stringify(await probe(page)));
});
