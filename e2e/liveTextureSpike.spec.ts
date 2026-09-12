/**
 * PHASE 0 SPIKE (kept as regression evidence for B-Full): go/no-go for in-scene LIVE instrument textures.
 * Evidence-based: compile/render success + animated pixel changes in screenshots.
 */
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

test.setTimeout(240000);

test('B-Full feasibility: live canvas texture on an in-scene quad', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const d = (window as any).__terranoetisDebug;
    return d?.viewer != null && d?.Cesium != null;
  }, { timeout: 60000 });

  const build = (variant: 'A1' | 'A2' | 'A3') => `(() => {
    const { viewer, Cesium } = window.__terranoetisDebug;
    const scene = viewer.scene;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    window.__spikeCanvas = canvas;
    let phase = 0;
    const draw = () => {
      ctx.fillStyle = 'hsl(' + ((phase * 47) % 360) + ' 90% 45%)';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#000'; ctx.font = '64px monospace';
      ctx.fillText(String(phase % 10), 90, 160);
      phase++;
    };
    draw();
    const eye = Cesium.Cartesian3.fromDegrees(0, 0, 400);
    viewer.camera.setView({ destination: eye, orientation: {
      heading: 0, pitch: Cesium.Math.toRadians(-30), roll: 0 } });
    const target = new Cesium.Cartesian3(0, 0, -1);
    Cesium.Matrix4.multiplyByPoint(
      Cesium.Transforms.eastNorthUpToFixedFrame(eye, Cesium.Ellipsoid.WGS84, new Cesium.Matrix4()),
      new Cesium.Cartesian3(0, 200, -60), target);
    let material = null; let err = '';
    try {
      if ('${variant}' === 'A1') {
        material = new Cesium.Material({ fabric: { type: 'Image', uniforms: { image: canvas } } });
      } else if ('${variant}' === 'A2') {
        material = new Cesium.Material({ fabric: {
          type: 'SpikeA2', uniforms: { live: canvas },
          components: { diffuse: 'texture(live, materialInput.st).rgb', alpha: '1.0' },
        } });
      } else {
        material = new Cesium.Material({ fabric: {
          type: 'SpikeA3', uniforms: { live: canvas },
          components: { diffuse: 'texture(live, materialInput.st).rgb', alpha: '1.0',
                        emission: 'texture(live, materialInput.st).rgb * 0.5' },
        } });
      }
    } catch (e) { return { ok: false, err: 'mat: ' + String(e) }; }
    const e1 = new Cesium.Cartesian3(25, 0, 0);
    const e2 = new Cesium.Cartesian3(0, 12, 25);
    const corners = [
      Cesium.Cartesian3.add(Cesium.Cartesian3.subtract(target, e1, new Cesium.Cartesian3()), e2, new Cesium.Cartesian3()),
      Cesium.Cartesian3.add(Cesium.Cartesian3.add(target, e1, new Cesium.Cartesian3()), e2, new Cesium.Cartesian3()),
      Cesium.Cartesian3.subtract(Cesium.Cartesian3.add(target, e1, new Cesium.Cartesian3()), e2, new Cesium.Cartesian3()),
      Cesium.Cartesian3.subtract(Cesium.Cartesian3.subtract(target, e1, new Cesium.Cartesian3()), e2, new Cesium.Cartesian3()),
    ];
    const packed = new Float64Array(12);
    corners.forEach((cc, i) => { packed[i * 3] = cc.x; packed[i * 3 + 1] = cc.y; packed[i * 3 + 2] = cc.z; });
    const geom = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: packed }),
        st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) }),
      },
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(packed, undefined, 3),
    });
    const primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: geom }),
      appearance: new Cesium.MaterialAppearance({ material, faceForward: true }),
      asynchronous: false,
    });
    scene.primitives.add(primitive);
    scene.requestRender();
    window.__spike = { frames: 0, t0: performance.now(), on: true };
    const loop = () => {
      const S = window.__spike;
      if (!S || !S.on) return;
      draw();
      S.frames++;
      scene.requestRender();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return { ok: true, variant: '${variant}' };
  })()`;

  let winner: string | null = null;
  for (const v of ['A2', 'A1', 'A3'] as const) {
    const built = await page.evaluate(build(v)).catch((e) => ({ ok: false, err: String(e) }));
    console.log('spike', v, JSON.stringify(built));
    if (!built.ok) continue;
    await page.waitForTimeout(1500); // let tiles/camera settle
    const hashes: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(350);
      const buf = await page.locator('canvas').first().screenshot();
      hashes.push(createHash('sha1').update(buf).digest('hex'));
    }
    const distinct = new Set(hashes).size;
    const st = await page.evaluate(() => (window as any).__spike);
    console.log('spike', v, 'distinct:', distinct, 'frames:', st.frames);
    if (distinct >= 4) { winner = v; break; }
    await page.evaluate(() => { (window as any).__spike.on = false; });
  }
  expect(winner, 'no live-texture path produced animated pixels — B-Full = NO-GO').not.toBeNull();
});
