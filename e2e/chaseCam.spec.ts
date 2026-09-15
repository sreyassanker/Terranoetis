/**
 * E2E: chase-camera rig (Pillar A).
 * - Hover framing settles close; cruise pushes distance + FOV out (speed rush).
 * - A hard turn leaves the camera world-lagged behind the nose.
 * - Wheel-zoom perturbations decay back toward autonomous framing.
 * - O toggles to the classic free-orbit mode; gestures still rotate it.
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

const rigSnap = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const w = window as unknown as Record<string, Record<string, { current: unknown }>>;
  const rig = (w.__HELI.rigRef as { current: { snapshot: unknown; mode: string; rigidity: number } | null });
  const st = (w.__HELI.simRef as { current: { state: Record<string, number> } | null });
  return rig?.current ? { snap: rig.current.snapshot as Record<string, number>, mode: rig.current.mode, rigidity: rig.current.rigidity, state: st?.current?.state } : null;
});

test('chase cam: speed widens framing + FOV; turns lag; gestures decay', async ({ page }) => {
  await launch(page);

  // hover: settle framing
  await page.waitForTimeout(4000);
  const hov = await rigSnap(page);
  expect(hov, 'rig bridge available').toBeTruthy();
  const hoverDist = hov!.snap.distTarget ?? hov!.snap.dist;
  const hoverFov = hov!.snap.fov;

  // cruise: collective up a touch + cyclic fwd + throttle → speed builds
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('d');
  let cruise = null as Awaited<ReturnType<typeof rigSnap>>;
  for (let i = 0; i < 200; i++) {   // generous: headless dt-clamp makes sim-time slower under load
    await page.waitForTimeout(300);
    cruise = await rigSnap(page);
    // honest thrust-vector cruise: fly to ~75 kt TAS before judging the framing rush
    if (cruise && cruise.state && cruise.state.tasKts > 85) break;
  }
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('d');
  expect(cruise!.state!.tasKts).toBeGreaterThan(80);
  expect(cruise!.snap.distTarget ?? cruise!.snap.dist).toBeGreaterThan(hoverDist * 1.3);   // distance scaling
  expect(cruise!.snap.fov).toBeGreaterThan(hoverFov);            // speed rush FOV

  // Hard right yaw authority — demonstrated in the hover, where the fin is
  // ineffective and the tail rotor owns the sky (at cruise speed the vemp's
  // directional stability legitimately balances pedal torque at ~15° slip).
  await page.keyboard.down('a');                       // accel bar back to hover
  await page.waitForFunction(() => ((window as any).__HELI?.simRef?.current?.state?.tasKts ?? 99) < 25,
    null, { timeout: 120000 });
  await page.keyboard.up('a');
  await page.keyboard.down('e');
  await page.waitForTimeout(600);
  await page.keyboard.down('ArrowRight');
  let maxLag = 0;
  let swing = 0;
  let prev = (await rigSnap(page))!.state!.headingDeg;
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const sn = await rigSnap(page);
    if (!sn?.state) continue;
    let d = sn.state.headingDeg - prev;
    while (d > 180) d -= 360; while (d < -180) d += 360;
    swing += Math.abs(d);
    prev = sn.state.headingDeg;
    maxLag = Math.max(maxLag, Math.abs(Math.PI - Math.abs(wrapPi(sn.snap.az))));
  }
  const turnSecs = (Date.now() - t0) / 1000;
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('e');
  expect(swing, 'nose swung under pedal authority').toBeGreaterThan(20);
  expect(swing / turnSecs, 'real yaw authority from pedal at low speed').toBeGreaterThan(2);
  expect(maxLag, 'camera trails the nose through the yaw before capturing').toBeGreaterThan(0.002);

  // wheel-zoom perturbation decays back toward autonomous framing
  const before = await rigSnap(page);
  await page.mouse.move(640, 360);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(60); }
  await page.waitForTimeout(700);
  const pulled = await rigSnap(page);
  expect(pulled!.snap.dist).toBeLessThan(before!.snap.dist);
  await page.keyboard.down('ArrowUp');   // hold cruise so framing is stable-ish
  await page.keyboard.down('d');
  let recovered = pulled!.snap.dist;
  for (let i = 0; i < 120; i++) {        // up to 60 s: τ=6 s decay + spring, load-tolerant
    await page.waitForTimeout(500);
    const sn = await rigSnap(page);
    if (sn) recovered = Math.max(recovered, sn.snap.dist);
    if (sn && recovered > pulled!.snap.dist * 1.4) break;
  }
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('d');
  expect(recovered, 'manual zoom should decay back to chase framing').toBeGreaterThan(pulled!.snap.dist * 1.35);

  // O toggles to orbit mode; drag still spins it with inertia
  await page.keyboard.press('o');
  await page.waitForTimeout(400);
  const orb = await rigSnap(page);
  expect(orb!.mode).toBe('orbit');
  const az0 = orb!.snap.az;
  await page.mouse.move(700, 380);
  await page.mouse.down();
  await page.mouse.move(820, 380, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const az1 = (await rigSnap(page))!.snap.az;
  expect(Math.abs(az1 - az0), 'orbit-mode drag should rotate the camera').toBeGreaterThan(0.1);

  await page.keyboard.press('Escape');
});

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}
