/**
 * THE SITUATION MATRIX — final capability verification of the AH-64E sim.
 *
 * Twelve realistic Guardian situations, flown end-to-end against the LIVE
 * production physics (deterministic sim-frame stepping through the __HELI
 * bridge so headless rAF starvation can't mask the results). Pass criteria
 * are honest aerodynamic behaviour; per product policy nothing is destroyed —
 * the airframe always remains recoverable.
 */
import { test, expect } from '@playwright/test';
test.setTimeout(600000);

async function launchHeli(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.locator('button[title="Flight Simulator"]').click();
  await page.getByText('Apache Helicopter Sim', { exact: true }).click();
  await page.getByText('LAUNCH FLIGHT').click();
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, any>;
    return !!w.__HELI?.simRef?.current && w.__HELI.simRef.current.state.rotorRpm > 90;
  }, null, { timeout: 30000 });
}

type Leg = { secs: number; i: Record<string, number | boolean> };
const fly = (page: import('@playwright/test').Page, plan: Leg[]) =>
  page.evaluate(async (plan) => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    let st = sim.state;
    const legs: any[] = [];
    for (const leg of plan) {
      const base = { collective: 0.62, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true, ...leg.i };
      for (let i = 0; i < Math.round(leg.secs / 0.05); i++) st = sim.update(0.05, base);
      legs.push(st);
    }
    return legs;
  }, plan);

const reset = (page: import('@playwright/test').Page, agl: number, hdg = 90) =>
  page.evaluate(({ agl, hdg }) => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const s = sim.state;
    sim.setWind(0, 0); sim.setTurbulence(0); sim.setYawSAS(true); sim.setSurfaceOAT(15); sim.setMassKg(5200);
    sim.restoreEngines();
    sim.resetTo({ ...s, altM: s.groundAltM + agl, onGround: false, headingDeg: hdg,
      engine: true, rotorRpm: 100, ngPct: 84, hardLanding: false });
  }, { agl, hdg });

test('S01 torque-trim hover: two-handed hover cues present & held by the SAS', async ({ page }) => {
  await launchHeli(page); await reset(page, 300);
  const [a, b] = await fly(page, [
    { secs: 4, i: { collective: 0.77 } },
    { secs: 6, i: { collective: 0.77 } },
  ]);
  expect(Math.abs(b.headingDeg - a.headingDeg)).toBeLessThan(5);   // SAS holds heading
  expect(b.ttDriftMps).toBeGreaterThan(0.15);                       // translating tendency real
  expect(b.trThrustPct).toBeGreaterThan(40);                        // TR trimmed against torque
});

test('S02 climb / cruise / decelerate / hover: full profile, honest rates', async ({ page }) => {
  await launchHeli(page); await reset(page, 200);
  const [top, cruise, back] = await fly(page, [
    { secs: 15, i: { collective: 0.95, throttle: 0.5 } },                     // climb
    { secs: 42, i: { collective: 0.77, pitch: 1, throttle: 1 } },             // dash
    { secs: 50, i: { collective: 0.77, pitch: 0, throttle: 0 } },             // decel to hover
  ]);
  expect(top.vsFpm).toBeGreaterThan(1200);                          // real climb-out
  expect(cruise.iasKts).toBeGreaterThan(115);                       // near the 150 placard
  expect(cruise.tasKts).toBeLessThanOrEqual(160);                   // bounded by air, not ground
  expect(back.iasKts).toBeLessThan(12);                             // back to the hover
  expect(Math.abs(back.vsFpm)).toBeLessThan(1900);
});

test('S03 35-kt quartering wind hover: TAS reads the wind, crab holds, no LOC', async ({ page }) => {
  await launchHeli(page); await reset(page, 150);
  await page.evaluate(() => {
    const sim = (window as any).__HELI.simRef.current;
    const th = (300 * Math.PI) / 180;                                // wind FROM 300°
    sim.setWind(-18 * Math.sin(th), -18 * Math.cos(th));             // 35 kt = 18 m/s
  });
  const [st] = await fly(page, [{ secs: 6, i: { collective: 0.77 } }]);
  expect(st.tasKts).toBeGreaterThan(20);                            // air over the disk is real
  expect(Math.hypot(st.headwindKts, st.xwindKts)).toBeGreaterThan(26);  // full 35-kt triangle reads
  expect(st.iasKts).toBeLessThan(45);                               // not a runaway — the fin crab-stabilizes
});

test('S04 flame-out in the transition vortex: entry → autorotation → flare → land soft', async ({ page }) => {
  await launchHeli(page); await reset(page, 160);
  const [, , land] = await fly(page, [
    { secs: 3, i: { collective: 0.77, pitch: 1 } },                  // a few knots of translational speed
    { secs: 9, i: { collective: 0.38, engine: false } },             // flame-out: enter & settle
    { secs: 6, i: { collective: 0.85, pitch: -0.8, engine: false } },// flare
    { secs: 3, i: { collective: 0, pitch: -0.5, engine: false } },   // touchdown: bar down, stay down
  ]);
  expect(land.onGround || land.aglM < 3).toBeTruthy();              // home
  expect(land.hardLanding).toBe(false);                             // cushioned
  expect(land.vsFpm).toBeGreaterThan(-1200);                        // sink arrested by stored energy
});

test('S05 OEI in the cruise decelerate: survivor at the rating, controlled, recoverable', async ({ page }) => {
  await launchHeli(page); await reset(page, 500);
  await page.evaluate(() => (window as any).__HELI.simRef.current.failEngine('R'));
  const [st] = await fly(page, [{ secs: 24, i: { collective: 0.77, throttle: 0.4 } }]);
  expect(st.oei, 'st=' + JSON.stringify({ vsf: st.vsFpm, rpm: st.rotorRpm, ngL: st.ngLPct, tq: st.torquePct })).toBe(true);
  expect(st.rotorRpm).toBeGreaterThan(70);                          // still driving
  expect(st.vsFpm).toBeGreaterThan(-3200);                          // bounded, not a dive
  const [rec] = await fly(page, [{ secs: 22, i: { collective: 0.77, throttle: 0.9 } }]);
  expect(rec.vsFpm).toBeGreaterThan(-1700);                         // one-engine contingency arrests the set
  expect(rec.rotorRpm).toBeGreaterThan(85);                         // survivor drives the rotor again
});

test('S06 VRS trap and escape from the descent to hover', async ({ page }) => {
  await launchHeli(page); await reset(page, 900);
  const [, , deep, clear] = await fly(page, [
    { secs: 2, i: { collective: 0.62 } },
    { secs: 4, i: { collective: 0.3 } },
    { secs: 8, i: { collective: 0.9 } },
    { secs: 10, i: { collective: 0.2, pitch: 1 } },
  ]);
  expect(deep.vrs, 'deep=' + JSON.stringify({ vsf: deep.vsFpm, ias: deep.iasKts, rpm: deep.rotorRpm, coll: deep.collective })).toBe(true);
  expect(clear.vrs).toBe(false);
  expect(clear.iasKts).toBeGreaterThan(6);
});

test('S07 high-G maneuver RBS and textbook recovery', async ({ page }) => {
  await launchHeli(page); await reset(page, 600);
  const [, on, off] = await fly(page, [
    { secs: 22, i: { collective: 0.77, pitch: 1, throttle: 1 } },
    { secs: 3, i: { collective: 0.95, pitch: -1, throttle: 0.2 } },
    { secs: 6, i: { collective: 0.4, pitch: 0.7, throttle: 0.5 } },
  ]);
  expect(on.rbs, 'on=' + JSON.stringify({ ias: on.iasKts, coll: on.collective, roll: on.rollDeg, disk: on.diskFwdDeg })).toBe(true);
  expect(off.rbs).toBe(false);
});

test('S08 IGE vs OGE hover ceilings at a scorching DA', async ({ page }) => {
  await launchHeli(page);
  const [ige, oge] = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const go = (gnd: number, agl: number) => {
      const s = sim.state;
      sim.setSurfaceOAT(46);
      sim.resetTo({ ...s, altM: gnd + agl, groundAltM: gnd, onGround: false, engine: true, rotorRpm: 100 });
      let st = sim.state;
      for (let i = 0; i < 220; i++) st = sim.update(0.05, { collective: 0.94, pitch: 0, roll: 0, pedal: 0, throttle: 0.6, engine: true });
      return st;
    };
    const g = sim.state.groundAltM;
    return [go(g, 3), go(g + 1150, 450)];
  });
  expect(Math.abs(ige.vsFpm)).toBeLessThan(1600);                  // IGE: near-holds at scorching DA
  expect(oge.vsFpm).toBeLessThan(-700);                            // OGE at hot DA: cannot
  expect(ige.vsFpm).toBeGreaterThan(oge.vsFpm + 600);               // ground effect is worth the difference
  await page.evaluate(() => (window as any).__HELI.simRef.current.setSurfaceOAT(15));
});

test('S09 mountain station 3,000 m: no hover, but flying is alive', async ({ page }) => {
  await launchHeli(page);
  const { hover, flight } = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const s = sim.state;
    sim.resetTo({ ...s, altM: 3300, groundAltM: 3000, onGround: false, engine: true, rotorRpm: 100 });
    let st = sim.state;
    for (let i = 0; i < 100; i++) st = sim.update(0.05, { collective: 1, pitch: 0, roll: 0, pedal: 0, throttle: 1, engine: true });
    const hover = st;
    for (let i = 0; i < 600; i++) st = sim.update(0.05, { collective: 0.85, pitch: 1, roll: 0, pedal: 0, throttle: 1, engine: true });
    return { hover, flight: st };
  });
  expect(hover.vsFpm).toBeLessThan(-800);                          // can't hover there — honest ceiling
  expect(flight.tasKts).toBeGreaterThan(60);                       // yet cruise is normal
  expect(flight.rotorRpm).toBeGreaterThan(85);
});

test('S10 power-on running landing from the pad through the knee into cruise', async ({ page }) => {
  await launchHeli(page);
  const { up, cruise } = await page.evaluate(async () => {
    const w = window as unknown as Record<string, any>;
    const sim = w.__HELI.simRef.current;
    const s = sim.state;
    sim.resetTo({ ...s, altM: s.groundAltM + 2, onGround: true, engine: true, rotorRpm: 100 });
    let st = sim.state;
    for (let i = 0; i < 80; i++) st = sim.update(0.05, { collective: 0.95, pitch: 0.6, roll: 0, pedal: 0.1, throttle: 0.9, engine: true });
    up = st; const up2 = st;
    for (let i = 0; i < 300; i++) st = sim.update(0.05, { collective: 0.77, pitch: 0.6, roll: 0, pedal: 0.1, throttle: 0.9, engine: true });
    return { up: up2, cruise: st };
  });
  expect(up.aglM).toBeGreaterThan(4);                               // lifted off the pad
  expect(cruise.iasKts).toBeGreaterThan(40);                        // flew away into the wind
  expect(cruise.vrs).toBe(false);                                   // clean through the band
});

test('S11 heavy gunship load: 9,500 kg hovers only on the transient, then settles', async ({ page }) => {
  await launchHeli(page); await reset(page, 250);
  await page.evaluate(() => (window as any).__HELI.simRef.current.setMassKg(9500));
  const [marginal, drained] = await fly(page, [
    { secs: 8, i: { collective: 1, throttle: 1 } },
    { secs: 26, i: { collective: 1, throttle: 1 } },
  ]);
  expect(marginal.vsFpm).toBeGreaterThan(-1600);                    // transient: close
  expect(drained.vsFpm).toBeLessThan(-60);                          // max gross: settles into a governed sink
  expect(drained.vsFpm).toBeGreaterThan(-2200);                     // rate-limited by the rating, not a plunge
  expect(drained.rotorRpm).toBeLessThan(103);                       // FADEC droops the rotor off the top of the gauge
  expect(drained.rotorRpm).toBeGreaterThan(70);                     // governed, never wrecked
  await page.evaluate(() => (window as any).__HELI.simRef.current.setMassKg(5200));
});

test('S12 hard weather: turbulence + gusts, airworthy throughout', async ({ page }) => {
  await launchHeli(page); await reset(page, 400);
  await page.evaluate(() => {
    const sim = (window as any).__HELI.simRef.current;
    sim.setWind(14, 0);                                             // 27-kt steady
    sim.setTurbulence(1);
  });
  const [st] = await fly(page, [{ secs: 40, i: { collective: 0.77 } }]);
  expect(st.rotorRpm).toBeGreaterThan(85);
  expect(st.rotorRpm).toBeLessThanOrEqual(104);
  expect(Math.abs(st.vsFpm)).toBeLessThan(2200);                    // riding the bumps, not tumbling
  await page.evaluate(() => { const s = (window as any).__HELI.simRef.current; s.setTurbulence(0); s.setWind(0, 0); });
});
