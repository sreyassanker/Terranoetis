import { describe, expect, it } from 'vitest';
import { HelicopterSim, HELI_DEFAULT, HOVER_COLLECTIVE, hoverCollectiveAt, type HelicopterInput } from '@/rendering/helicopterSim';

const input = (over: Partial<HelicopterInput> = {}): HelicopterInput => ({
  collective: 0.55, pitch: 0, roll: 0, pedal: 0, throttle: 0, engine: true, ...over,
});

const run = (sim: HelicopterSim, secs: number, inp: HelicopterInput) => {
  let out = sim.state;
  const steps = Math.round(secs * 20);
  for (let i = 0; i < steps; i++) out = sim.update(0.05, inp);
  return out;
};

describe('HelicopterSim', () => {
  it('sinks below hover collective and climbs above it', () => {
    const sim = new HelicopterSim({ lat: 12.97, lon: 77.59, altM: 500, groundAltM: 0 });
    const sink = run(sim, 3, input({ collective: 0.3 }));
    expect(sink.altM).toBeLessThan(500);
    expect(sink.vsFpm).toBeLessThan(0);

    const sim2 = new HelicopterSim({ lat: 12.97, lon: 77.59, altM: 500, groundAltM: 0 });
    const climb = run(sim2, 3, input({ collective: 1.0 }));
    expect(climb.altM).toBeGreaterThan(503);
    expect(climb.vsFpm).toBeGreaterThan(400);
  });

  it('hover equilibrium keeps altitude roughly steady at hover collective', () => {
    const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 800, groundAltM: 0 });
    const hc = hoverCollectiveAt(800);
    expect(hc).toBeGreaterThan(HOVER_COLLECTIVE);          // thin air demands more collective
    run(sim, 6, input({ collective: hc }));
    const st = run(sim, 4, input({ collective: hc }));
    expect(Math.abs(st.vsFpm)).toBeLessThan(500);
  });

  it('forward cyclic accelerates and pitches nose down', () => {
    const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0 });
    const st = run(sim, 6, input({ collective: HOVER_COLLECTIVE, pitch: 1 }));
    expect(st.iasKts).toBeGreaterThan(20);
    expect(st.pitchDeg).toBeLessThan(-5); // nose down
  });

  it('banked turn coordinates the flight path (velocity follows the nose)', () => {
    const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
    run(sim, 4, input({ collective: HOVER_COLLECTIVE, pitch: 1 }));   // cruise east
    const st = run(sim, 4, input({ collective: HOVER_COLLECTIVE, roll: 1 })); // bank right → turn south
    expect(st.headingDeg).toBeGreaterThan(105);  // nose rotated
    expect(st.lat).toBeLessThan(28.61);          // track curved south, not skating sideways east
  });

  it('never exceeds Vne (150 kt)', () => {
    const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
    const st = run(sim, 30, input({ collective: HOVER_COLLECTIVE, pitch: 1, throttle: 1 }));
    expect(st.iasKts).toBeLessThanOrEqual(150.5);
    expect(st.iasKts).toBeGreaterThan(100);
  });

  it('pedals rotate heading; right pedal increases heading', () => {
    const sim = new HelicopterSim({ headingDeg: 90 });
    const st = run(sim, 2, input({ collective: HOVER_COLLECTIVE, pedal: 1 }));
    expect(st.headingDeg).toBeGreaterThan(90);
    expect(st.headingDeg).toBeLessThan(200); // sane rate
  });

  it('clamps to terrain and stays grounded when thrust is low', () => {
    const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 100, groundAltM: 40 });
    const st = run(sim, 10, input({ collective: 0.2 }));
    expect(st.altM).toBeGreaterThanOrEqual(st.groundAltM);
    expect(st.aglM).toBe(0);
  });

  it('engine shutdown bleeds rotor rpm into autorotation descent', () => {
    const sim = new HelicopterSim({ altM: 900, groundAltM: 0 });
    const st = run(sim, 8, input({ collective: 0.4, engine: false }));
    expect(st.rotorRpm).toBeLessThan(60);
    expect(st.vsFpm).toBeLessThan(-1000); // descending
    expect(st.rotorRpm).toBeGreaterThan(5); // but not zero — autorotating
  });

  it('burns fuel and the HUD default state is well-formed', () => {
    const sim = new HelicopterSim();
    const st = run(sim, 10, input({ collective: 1 }));
    expect(st.fuelKg).toBeLessThan(HELI_DEFAULT().fuelKg);
    const d = HELI_DEFAULT();
    expect(d.rotorRpm).toBe(100);
    expect(d.fuelKg).toBe(d.fuelMaxKg);
  });

  it('throttle (acceleration control) speeds the helicopter up hands-off', () => {
    const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
    run(sim, 4, input({ collective: HOVER_COLLECTIVE, throttle: 0 })); // stabilize hover
    const st = run(sim, 6, input({ collective: HOVER_COLLECTIVE, throttle: 1 }));
    expect(st.iasKts).toBeGreaterThan(20);
  });

  it('throttle has no effect with the engine stopped', () => {
    const sim = new HelicopterSim({ altM: 900, groundAltM: 0 });
    const st = run(sim, 5, input({ collective: HOVER_COLLECTIVE, throttle: 1, engine: false }));
    expect(st.iasKts).toBeLessThan(5);
  });

  it('gear offset parks the wheels on the terrain (origin stays gearH above ground)', () => {
    const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 100, groundAltM: 40 }, { gearOffsetM: 9.7 });
    const st = run(sim, 6, input({ collective: 0.2 }));
    expect(st.altM).toBeCloseTo(49.7, 1);
    expect(st.aglM).toBeCloseTo(0, 6);
  });

  it('wraps longitude past 180', () => {
    const sim = new HelicopterSim({ lat: 0, lon: 179.95, altM: 500, groundAltM: 0 });
    const st = run(sim, 4, input({ collective: HOVER_COLLECTIVE, pitch: 1 })); // heading 90 = east
    expect(st.lon).toBeLessThan(180.01);
    expect(st.lon).toBeGreaterThan(-180);
  });
});
describe('HelicopterSim — Phase 1 air data & rotorcraft physics', () => {
  it('splits IAS / TAS / GS in wind (headwind raises IAS above GS)', () => {
    const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 0, groundAltM: 0, headingDeg: 90 });
    sim.setWind(-10, 0); // 19.4 kt headwind from the east (air mass moving west)
    const st = run(sim, 1, input({ collective: 0.55 }));
    expect(st.iasKts).toBeGreaterThan(st.gsKts);
    expect(st.headwindKts).toBeGreaterThan(15);
  });

  it('IAS < TAS at density altitude (ISA correction)', () => {
    const sim = new HelicopterSim({ altM: 3000, groundAltM: 0 });
    const st = run(sim, 2, input({ collective: HOVER_COLLECTIVE, pitch: 0.6 }));
    expect(st.densityRatio).toBeLessThan(0.78);
    expect(st.iasKts).toBeLessThan(st.tasKts);
    expect(st.oatC).toBeLessThan(10);   // ISA lapse: 15 − 1.98·3 km
  });

  it('translational lift (ETL) climbs monotonically through the knee', () => {
    const sim = new HelicopterSim({ altM: 0, groundAltM: 0, headingDeg: 90 });
    let last = -1;
    for (const t of [0, 2, 4, 8, 15, 25]) {
      const st = run(sim, t, input({ collective: HOVER_COLLECTIVE, pitch: 1 }));
      expect(st.etlPct).toBeGreaterThanOrEqual(last - 0.5);
      last = st.etlPct;
    }
    expect(last).toBeGreaterThan(80);            // fully in translation above ~40 kt
  });

  it('ETL reduces the collective needed to hold altitude (hover ceiling relief)', () => {
    const atRest = new HelicopterSim({ altM: 0, groundAltM: 0 });
    run(atRest, 5, input({ collective: 0.85 }));
    const rest = atRest.state.vsFpm;
    const translating = new HelicopterSim({ altM: 0, groundAltM: 0, headingDeg: 90 });
    run(translating, 8, input({ collective: 0.85, pitch: 1 }));   // build ~ETL speed
    const trans = translating.state.vsFpm;
    expect(trans).toBeGreaterThan(rest);
  });

  it('tail-rotor trim holds a no-pedal hover on heading', () => {
    const sim = new HelicopterSim({ altM: 300, groundAltM: 0, headingDeg: 90 });
    const st = run(sim, 4, input({ collective: HOVER_COLLECTIVE }));
    expect(Math.abs(st.headingDeg - 90)).toBeLessThan(2);
    expect(Math.abs(st.ttDriftMps)).toBeLessThan(0.2);
    expect(st.trThrustPct).toBeGreaterThan(40);  // tail rotor is trimmed against torque
  });

  it('right pedal yaws right from a trimmed hover', () => {
    const sim = new HelicopterSim({ altM: 300, groundAltM: 0, headingDeg: 90 });
    const st = run(sim, 4, input({ collective: HOVER_COLLECTIVE, pedal: 0.25 }));
    expect(st.headingDeg).toBeGreaterThan(100);
  });

  it('exposes rotor CT, torque and shaft power with sane hover magnitudes', () => {
    const sim = new HelicopterSim({ altM: 0, groundAltM: 0 });
    const st = run(sim, 4, input({ collective: HOVER_COLLECTIVE }));
    expect(st.torqueCoeff).toBeGreaterThan(0.003);
    expect(st.torqueCoeff).toBeLessThan(0.012);
    expect(st.torqueNm).toBeGreaterThan(20000);
    expect(st.powerShp).toBeGreaterThan(900);
    expect(st.powerShp).toBeLessThan(3000);
  });

  it('CT and torque rise with collective at constant rpm', () => {
    const lo = run(new HelicopterSim({ altM: 0, groundAltM: 0 }), 3, input({ collective: 0.45 }));
    const hi = run(new HelicopterSim({ altM: 0, groundAltM: 0 }), 3, input({ collective: 0.9 }));
    expect(hi.torqueCoeff).toBeGreaterThan(lo.torqueCoeff);
    expect(hi.torqueNm).toBeGreaterThan(lo.torqueNm);
    expect(hi.torquePct).toBeGreaterThan(lo.torquePct);
  });

  it('governor spools Ng up on engine start and holds Nf near 100%', () => {
    const sim = new HelicopterSim({ altM: 0, groundAltM: 0 }, {});
    const st = run(sim, 8, input({ collective: HOVER_COLLECTIVE, engine: true }));
    expect(st.rotorRpm).toBeGreaterThan(95);
    expect(st.ngPct).toBeGreaterThan(70);
  });

  it('reports angular rates during cyclic input and accelerations on onset', () => {
    const sim = new HelicopterSim({ altM: 0, groundAltM: 0 });
    run(sim, 1, input({ collective: HOVER_COLLECTIVE }));
    const st = run(sim, 0.5, input({ collective: HOVER_COLLECTIVE, roll: 1 }));
    expect(st.rollRateDps).toBeGreaterThan(10);
    expect(st.rollAccDps2).toBeGreaterThan(0);
  });

  it('VRS flag sets only in the classic gate (low speed + high sink + power)', () => {
    const sim = new HelicopterSim({ altM: 400, groundAltM: 0 });
    run(sim, 3, input({ collective: 0.3 }));                    // enter a descent hands-off
    const st = run(sim, 3, input({ collective: 0.85 }));        // power up without gaining speed
    expect(st.vsFpm).toBeLessThan(-600);
    if (st.iasKts < 16) expect(st.vrs).toBe(true);
  });

  it('weathervanes the nose into the relative wind at speed', () => {
    const sim = new HelicopterSim({ altM: 200, groundAltM: 0, headingDeg: 90 });
    run(sim, 8, input({ collective: HOVER_COLLECTIVE, pitch: 1 }));  // cruise east
    const before = sim.state.headingDeg;
    const st = run(sim, 4, input({ collective: HOVER_COLLECTIVE })); // pedal-free: velocity holds east
    expect(Math.abs(st.headingDeg - 90)).toBeLessThan(Math.abs(before - 90) + 6);
  });
});

describe('HelicopterSim — HELIDRIVE-X compound profile (benchmarks doc)', () => {

  it('Vne ≈ 250 kt CAS and beats every conventional helicopter (Lynx record 216.4 kt)', async () => {
    const { HelicopterSim, PROFILES } = await import('@/rendering/helicopterSim');
    const sim = new HelicopterSim(
      { lat: 28.61, lon: 77.21, altM: 0, groundAltM: 0, headingDeg: 90 },
      { profile: PROFILES.HELIDRIVE_X },
    );
    const st = run(sim, 40, input({ collective: 0.62, pitch: 1, throttle: 1 }));
    expect(st.vneKts).toBe(250);
    expect(st.tasKts).toBeGreaterThan(245);       // TAS rides the Vne cap
    expect(st.iasKts).toBeGreaterThan(217);        // > Lynx world record (216.4 kt)
    expect(st.iasKts).toBeLessThanOrEqual(251);    // capped
  }, 20000);

  it('coaxial: no torque yaw and no translating tendency in a no-pedal hover', async () => {
    const { HelicopterSim, PROFILES, hoverCollectiveAt } = await import('@/rendering/helicopterSim');
    const sim = new HelicopterSim({ altM: 300, groundAltM: 0, headingDeg: 90 }, { profile: PROFILES.HELIDRIVE_X });
    const st = run(sim, 5, input({ collective: hoverCollectiveAt(300, PROFILES.HELIDRIVE_X) }));
    expect(Math.abs(st.headingDeg - 90)).toBeLessThan(2);   // holds heading hands-off
    expect(Math.abs(st.ttDriftMps)).toBeLessThan(0.6);
    expect(st.trThrustPct).toBe(0);
  });

  it('pusher gives V-280-class acceleration: 0→150 kt in under 12 s', async () => {
    const { HelicopterSim, PROFILES } = await import('@/rendering/helicopterSim');
    const sim = new HelicopterSim({ altM: 500, groundAltM: 0, headingDeg: 90 }, { profile: PROFILES.HELIDRIVE_X });
    let t150 = 0;
    const dt = 0.05;
    let s = sim.state;
    for (let i = 0; i < 240 && t150 === 0; i++) {
      s = sim.update(dt, input({ collective: 0.62, pitch: 1, throttle: 1 }));
      if (s.iasKts >= 150) t150 = (i + 1) * dt;
    }
    expect(t150).toBeGreaterThan(3);
    expect(t150).toBeLessThan(13);
  });

  it('higher climb authority: ≥ 3,200 fpm available', async () => {
    const { HelicopterSim, PROFILES, hoverCollectiveAt } = await import('@/rendering/helicopterSim');
    const sim = new HelicopterSim({ altM: 500, groundAltM: 0 }, { profile: PROFILES.HELIDRIVE_X });
    const st = run(sim, 14, input({ collective: 1 }));
    expect(st.vsFpm).toBeGreaterThan(3200);
    const hc = hoverCollectiveAt(0, PROFILES.HELIDRIVE_X);
    expect(hc).toBeLessThan(hoverCollectiveAt(0));    // fatter hover margin than the Apache
  });

  it('AH-64E profile is untouched by the compound (regression pin)', async () => {
    const { HelicopterSim, PROFILES } = await import('@/rendering/helicopterSim');
    const a = run(new HelicopterSim({ altM: 500, groundAltM: 0, headingDeg: 90 }, { profile: PROFILES.AH64E }), 20,
      input({ collective: HOVER_COLLECTIVE, pitch: 1, throttle: 1 }));
    const b = run(new HelicopterSim({ altM: 500, groundAltM: 0, headingDeg: 90 }), 20,
      input({ collective: HOVER_COLLECTIVE, pitch: 1, throttle: 1 }));
    expect(a.iasKts).toBeCloseTo(b.iasKts, 4);
    expect(a.vneKts).toBe(150);
  });
});
