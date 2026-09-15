/**
 * E2E: Apache Helicopter Flight Simulator.
 *
 * - Opens the topbar Fly menu → Apache Helicopter Sim → LAUNCH FLIGHT.
 * - Asserts the HUD mounts and the sim spawns over the globe.
 * - Holds W (collective) and verifies altitude increases; holds ArrowUp
 *   (cyclic) and verifies indicated airspeed increases.
 * - Waits for the runtime-built Apache glTF to load into the scene and
 *   verifies the main/tail rotor nodes are addressable (they're spun
 *   per-frame from model matrices).
 * - Esc exits and restores camera control.
 */

import { test, expect } from '@playwright/test';

test.setTimeout(240000);

test('Apache helicopter sim launches, flies with keyboard controls, rotors spin', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource|RequestErrorEvent|WebSocket|ResizeObserver|401|403/i.test(t)) {
      consoleErrors.push(t);
    }
  });

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);

  // Open the dedicated Fly menu and launch
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await expect(page.getByText('HELICOPTER FLIGHT SIMULATOR')).toBeVisible({ timeout: 10000 });
  await page.getByText('LAUNCH FLIGHT').click();

  // External mode: compact dock only — the globe stays unobstructed (no HUD)
  await expect(page.locator('.hxdock')).toBeVisible({ timeout: 20000 });
  expect(await page.locator('.hxhud').count(), 'no full HUD in external mode').toBe(0);

  const readState = () => page.evaluate(() => {
    const w = window as unknown as Record<string, { simRef: { current: { state: Record<string, number> } | null } }>;
    return w.__HELI ? w.__HELI.simRef.current?.state ?? null : null;
  });

  const s0 = await readState();
  expect(s0, 'sim state readable via __HELI bridge').toBeTruthy();
  const alt0 = s0!.altM;

  // Climb: hold W (collective up). Headless software rendering can be slow
  // (the sim clamps dt for stability), so poll instead of fixed waits.
  await page.keyboard.down('w');
  let climbed = false;
  for (let i = 0; i < 80 && !climbed; i++) {
    const s = await readState();
    climbed = !!s && s.altM > alt0 + 30;
    if (!climbed) await page.waitForTimeout(250);
  }
  await page.keyboard.up('w');
  const s1 = await readState();
  expect(climbed, `altitude should increase while climbing (${alt0} → ${s1!.altM})`).toBeTruthy();

  // Forward flight: hold ArrowUp (cyclic forward)
  const ias0 = s1!.iasKts;
  await page.keyboard.down('ArrowUp');
  let faster = false;
  for (let i = 0; i < 80 && !faster; i++) {
    const s = await readState();
    faster = !!s && s.iasKts > ias0 + 10;
    if (!faster) await page.waitForTimeout(250);
  }
  await page.keyboard.up('ArrowUp');
  const s2 = await readState();
  expect(faster, `airspeed should increase with forward cyclic (${ias0} → ${s2!.iasKts})`).toBeTruthy();

  // Throttle / acceleration control: hold D, airspeed must build hands-off
  const iasT = (await readState())!.iasKts;
  await page.keyboard.down('d');
  let throttled = false;
  for (let i = 0; i < 80 && !throttled; i++) {
    const s = await readState();
    throttled = !!s && s.iasKts > iasT + 10 && s.throttle > 0.3;
    if (!throttled) await page.waitForTimeout(250);
  }
  await page.keyboard.up('d');
  await page.keyboard.down('a');
  await page.waitForTimeout(1500);
  await page.keyboard.up('a');
  const sT = await readState();
  expect(throttled, `throttle should accelerate (${iasT} → ${sT!.iasKts})`).toBeTruthy();

  // ── orientation: the model must stand upright on the globe and point
  //    along its heading (catches glTF/Cesium axis-mapping regressions —
  //    the nose must NOT dive toward/away from the surface) ──
  const orient = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const Cesium = w.Cesium;
    const st = w.__HELI.simRef.current.state;
    const m = w.__HELI.modelRef.current;
    if (!st || !m) return null;
    const pos = Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.altM);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pos, Cesium.Ellipsoid.WGS84, new Cesium.Matrix4());
    const enuInv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());
    const upCol = Cesium.Matrix4.getColumn(m.modelMatrix, 2, new Cesium.Cartesian4());
    const noseCol = Cesium.Matrix4.getColumn(m.modelMatrix, 1, new Cesium.Cartesian4());
    const upLocal = Cesium.Matrix4.multiplyByPointAsVector(enuInv, new Cesium.Cartesian3(upCol.x, upCol.y, upCol.z), new Cesium.Cartesian3());
    const noseLocal = Cesium.Matrix4.multiplyByPointAsVector(enuInv, new Cesium.Cartesian3(noseCol.x, noseCol.y, noseCol.z), new Cesium.Cartesian3());
    return {
      upDotENU: Cesium.Cartesian3.dot(Cesium.Cartesian3.normalize(upLocal, new Cesium.Cartesian3()), new Cesium.Cartesian3(0, 0, 1)),
      noseAzDeg: (Cesium.Math.toDegrees(Math.atan2(noseLocal.x, noseLocal.y)) + 360) % 360,
      headingDeg: st.headingDeg,
    };
  });
  expect(orient, 'orientation probe available').toBeTruthy();
  // up column ≈ ENU up (tilted only by |pitch|+|roll| ≲ 35°): a sideways
  // or nose-down axis bug collapses this toward 0.
  expect(orient!.upDotENU, `model up must align with surface normal (got ${orient!.upDotENU})`).toBeGreaterThan(0.8);
  let azErr = Math.abs(orient!.noseAzDeg - orient!.headingDeg);
  if (azErr > 180) azErr = 360 - azErr;
  expect(azErr, `nose azimuth ${orient!.noseAzDeg.toFixed(1)}° vs heading ${orient!.headingDeg.toFixed(1)}°`).toBeLessThan(5);

  // ── external free camera: wheel zooms the orbit, drag rotates it ──
  const distBefore = await page.evaluate(() => (window as unknown as Record<string, any>).__HELI.orbitRef.current.distTarget);
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  const distAfter = await page.evaluate(() => (window as unknown as Record<string, any>).__HELI.orbitRef.current.distTarget);
  expect(distAfter, `wheel should zoom in (${distBefore} → ${distAfter})`).toBeLessThan(distBefore * 0.95);

  // horizontal two-finger swipe = orbit (trackpad rotate)
  const azH = await page.evaluate(() => (window as unknown as Record<string, any>).__HELI.orbitRef.current.az);
  await page.mouse.wheel(500, 0);
  await page.waitForTimeout(300);
  const azH2 = await page.evaluate(() => (window as unknown as Record<string, any>).__HELI.orbitRef.current.az);
  expect(Math.abs(azH2 - azH), `horizontal two-finger swipe should orbit (${azH} → ${azH2})`).toBeGreaterThan(0.5);

  const azBefore = await page.evaluate(() => (window as unknown as Record<string, any>).__HELI.orbitRef.current.az);
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(760, 400, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const azAfter = await page.evaluate(() => (window as unknown as Record<string, any>).__HELI.orbitRef.current.az);
  expect(Math.abs(azAfter - azBefore), `drag should orbit camera (${azBefore} → ${azAfter})`).toBeGreaterThan(0.05);

  // Model + rotor nodes ready in the scene
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, { modelRef: { current?: unknown }; mainRotorRef: { current?: unknown }; tailRotorRef: { current?: unknown } }>;
    return !!(w.__HELI?.modelRef?.current && w.__HELI.mainRotorRef?.current && w.__HELI.tailRotorRef?.current);
  }, { timeout: 90000 }).catch(() => { throw new Error('Apache glTF or rotor nodes failed to load in time'); });
  const rotorTypes = await page.evaluate(() => {
    const w = window as unknown as Record<string, { mainRotorRef: { current: { matrix?: unknown } }; tailRotorRef: { current: { matrix?: unknown } } }>;
    return {
      main: w.__HELI.mainRotorRef.current?.matrix !== undefined,
      tail: w.__HELI.tailRotorRef.current?.matrix !== undefined,
    };
  });
  expect(rotorTypes.main, 'mainRotor node exposes a matrix').toBeTruthy();
  expect(rotorTypes.tail, 'tailRotor node exposes a matrix').toBeTruthy();

  // Touchdown: cut collective, let it settle on the terrain — the model
  // origin must sit at gear height above the ground, never buried in the globe
  await page.keyboard.down('s');
  let landed = false;
  for (let i = 0; i < 240 && !landed; i++) {
    // burn 20 live-sim frames per poll: headless rAF starves sim-time, the
    // production input object still carries the held keys through the physics.
    await page.evaluate(() => {
      const w = window as unknown as Record<string, any>;
      const sim = w.__HELI.simRef.current;
      const inp = w.__HELI.inputRef.current;
      for (let k = 0; k < 20; k++) sim.update(0.05, { ...inp });
    });
    const s = await readState();
    landed = !!s && s.aglM < 0.5 && Math.abs(s.vsFpm) < 150;
    if (!landed) await page.waitForTimeout(250);
  }
  await page.keyboard.up('s');
  const sG = await readState();
  expect(landed, `should land and hold on the terrain (aglM ${sG!.aglM})`).toBeTruthy();
  const groundOriginClearance = sG!.altM - sG!.groundAltM;
  expect(groundOriginClearance, `origin must clear terrain by gear height ≈2.9 m (got ${groundOriginClearance.toFixed(2)} m)`).toBeGreaterThan(2.4);
  expect(groundOriginClearance, `gear height must not exceed model scale sanity (${groundOriginClearance.toFixed(2)} m)`).toBeLessThan(4);

  // Cockpit view shows the full glass HUD
  await page.keyboard.press('c');
  await expect(page.locator('.hxhud')).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('c'); // back to external for the dock assertions
  await expect(page.locator('.hxdock')).toBeVisible({ timeout: 10000 });

  // HUD telemetry populated (in cockpit) + full instrument zones exist
  await page.keyboard.press('c');
  await expect(page.getByTestId('hxf-strip')).toContainText('SPD');
  await expect(page.getByTestId('hxf-ra')).toBeVisible();
  await expect(page.getByTestId('hxf-controls')).toBeVisible();
  await expect(page.getByTestId('hxf-sw-engine')).toBeVisible();
  await expect(page.getByTestId('hxf-thr-up')).toBeVisible();

  // One-click THR stepper accelerates the aircraft (throttle state rises)
  const thrBefore = (await readState())!.throttle ?? 0;
  await page.getByTestId('hxf-thr-up').click();
  await page.getByTestId('hxf-thr-up').click();
  let thrOk = false;
  for (let i = 0; i < 20 && !thrOk; i++) {
    const s = await readState();
    thrOk = !!s && (s.throttle ?? 0) > thrBefore + 0.02;
    if (!thrOk) await page.waitForTimeout(200);
  }
  expect(thrOk, 'THR+ button should raise throttle').toBeTruthy();
  const engBefore = (await readState())!.engine;
  await page.getByTestId('hxf-sw-engine').click();
  await page.waitForTimeout(400);
  const engAfter = (await readState())!.engine;
  expect(engAfter, 'ENGINE switch toggles').not.toBe(engBefore);
  await page.getByTestId('hxf-sw-engine').click(); // restore
  await page.getByTestId('hxf-thr-down').click();
  await page.getByTestId('hxf-thr-down').click();
  await page.keyboard.press('c');

  // Escape exits and restores camera
  await page.keyboard.press('Escape');
  await expect(page.locator('.hxhud')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('.hxdock')).toBeHidden({ timeout: 10000 });
  const camEnabled = await page.evaluate(() => {
    const v = (window as unknown as Record<string, { scene: { screenSpaceCameraController: { enableRotate: boolean } } }>).__VIEWER__;
    return !!v && v.scene.screenSpaceCameraController.enableRotate === true;
  });
  expect(camEnabled, 'camera controls restored after exit').toBeTruthy();

  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});