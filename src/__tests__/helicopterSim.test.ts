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

  it('engine failure settles into sustained autorotation (Apache slot: ~100% NR, ~3,000 fpm)', () => {
    const sim = new HelicopterSim({ altM: 2200, groundAltM: 0 });
    run(sim, 2, input({ collective: 0.4 }));
    const st = run(sim, 14, input({ collective: 0.4, engine: false }));
    expect(st.vsFpm).toBeLessThan(-1800);          // descending
    expect(st.rotorRpm).toBeGreaterThan(85);       // rotor still driving in the low green…
    expect(st.rotorRpm).toBeLessThanOrEqual(104);
    expect(st.vsFpm).toBeGreaterThan(-5200);       // sustained, not accelerating — energy balance holds
    expect(st.altM).toBeGreaterThan(1500);
  });

  it('collective is the autorotation trade: pitch brake bleeds NR, flatter bites it back', () => {
    const eq = (c: number) => {
      const sim = new HelicopterSim({ altM: 3000, groundAltM: 0 });
      run(sim, 2, input({ collective: c }));
      return run(sim, 26, input({ collective: c, engine: false }));
    };
    const flat = eq(0.25), braked = eq(0.62);
    expect(flat.rotorRpm).toBeGreaterThan(braked.rotorRpm + 10);  // flat blades spin the rotor up…
    expect(flat.rotorRpm).toBeGreaterThan(100);                   // …to the 104% ceiling
    expect(Math.abs(braked.vsFpm)).toBeLessThan(Math.abs(flat.vsFpm)); // …trade-off: less brake = more sink
    expect(braked.rotorRpm).toBeLessThan(90);                     // deep brake near-stalls the rotor
  });

  it('aft cyclic raises rpm in autorotation, forward cyclic blows it back (FAA Ch.11)', () => {
    const sim = new HelicopterSim({ altM: 3000, groundAltM: 0, headingDeg: 90 });
    run(sim, 10, input({ collective: 0.77, pitch: 1 }));          // cruise
    run(sim, 6, input({ collective: 0.4, engine: false }));        // enter, settle
    const before = { rpm: sim.state.rotorRpm, ias: sim.state.iasKts };
    const aft = run(sim, 4, input({ collective: 0.4, pitch: -1, engine: false }));
    expect(aft.rotorRpm).toBeGreaterThan(before.rpm);              // aft cyclic: rpm up
    expect(aft.iasKts).toBeLessThan(before.ias);                   // and airspeed bleeds in the flare
  });

  it('power recovery rejoins: throttle in re-drives the rotor from autorotation', () => {
    const sim = new HelicopterSim({ altM: 1200, groundAltM: 0 });
    run(sim, 10, input({ collective: 0.35, engine: false }));
    const rec = run(sim, 12, input({ collective: 0.85, throttle: 0.7, engine: true }));
    expect(rec.rotorRpm).toBeGreaterThan(100);                     // back to governed speed
    expect(rec.vsFpm).toBeGreaterThan(-400);                       // descent arrested, about to climb
  });

  it('VRS is a developing, self-sustaining state — escape needs airspeed, not just less power', () => {
    const sim = new HelicopterSim({ altM: 2000, groundAltM: 0 });
    run(sim, 3, input({ collective: 0.3 }));                       // start a sink
    const deep = run(sim, 8, input({ collective: 0.9 }));          // power into the ring: it worsens
    expect(deep.vrs).toBe(true);
    expect(deep.vsFpm).toBeLessThan(-1800);                        // honest VRS sink (not arrested by coll alone)
    const escape = run(sim, 6, input({ collective: 0.2, pitch: 1 })); // FAA: lower nose through the band
    expect(escape.vrs).toBe(false);
    expect(escape.vsFpm).toBeLessThan(-1500);                      // trading height for airspeed
  });

  it('operates without fuel depletion and HUD default state is well-formed', () => {
    const sim = new HelicopterSim();
    const st = run(sim, 10, input({ collective: 1 }));
    expect(st.fuelKg).toBe(st.fuelMaxKg); // infinite fuel, no depletion
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
describe('HelicopterSim — twin T700 powerplant, FADEC limits, OEI', () => {
  it('steady hover: twin torque ~80% with ITT in a sane T700 band', () => {
    const sim = new HelicopterSim({ altM: 30, groundAltM: 0 });
    const st = run(sim, 20, input({ collective: HOVER_COLLECTIVE }));
    expect(st.torquePct).toBeGreaterThan(60);
    expect(st.torquePct).toBeLessThan(95);                 // below the redline in a normal hover
    expect(st.eng1Live && st.eng2Live).toBe(true);
    expect(st.oei).toBe(false);
    expect(st.ittLC).toBeGreaterThan(400);                 // hot section running
    expect(st.ittLC).toBeLessThan(870);                    // under the redline
    expect(st.ngLPct).toBeGreaterThan(75);
  });

  it('OEI: one engine flames out, the survivor takes the load and the FADEC schedules', () => {
    const sim = new HelicopterSim({ altM: 30, groundAltM: 0 });
    run(sim, 8, input({ collective: HOVER_COLLECTIVE }));
    sim.failEngine('R');
    const mid = run(sim, 8, input({ collective: HOVER_COLLECTIVE }));
    expect(mid.oei).toBe(true);
    expect(mid.eng2Live).toBe(false);
    expect(mid.ngRPct).toBeLessThan(45);                   // dead generator spooling out…
    expect(mid.ngLPct).toBeGreaterThan(60);                // survivor FADEC-scheduled (ITT backs it off…
    expect(mid.rotorRpm).toBeLessThan(96);                 // Nf droops under the power deficit…
    expect(mid.rotorRpm).toBeGreaterThan(60);              // …but the rotor keeps driving
    expect(mid.torquePct).toBeGreaterThan(60);             // the survivor carries every newton…
    expect(mid.vsFpm).toBeLessThan(900);                   // OEI at 5.2 t: no meaningful climb-out…
    expect(mid.vsFpm).toBeGreaterThan(-3200);              // …but a marginal hover, not a drop
    expect(mid.ittLC).toBeGreaterThan(600);                // survivor carries the whole load
    expect(mid.ittLC).toBeLessThan(880);                   // FADEC holds the temperature
    // …and ground effect catches it before it gets far — IGE OEI hover is where
    // this airframe is designed to survive (no destruction by policy).
    const st = run(sim, 14, input({ collective: HOVER_COLLECTIVE }));
    expect(st.ngRPct).toBeLessThan(5);                    // …fully spooled by now
    expect(st.ngLPct).toBeGreaterThan(80);                // temperature settles → survivor re-advances
    // With the contingency rating the survivor arrests the set near the deck:
    // controlled, cushioned, nothing destroyed (product policy).
    expect(st.vsFpm).toBeGreaterThan(-1800);
    expect(st.altM).toBeGreaterThan(0);
    expect(st.vsFpm).toBeGreaterThan(-2600);
  });

  it('FADEC ratings: transient torque first, then it decays to continuous', () => {
    const sim = new HelicopterSim({ altM: 30, groundAltM: 0 });
    const early = run(sim, 15, input({ collective: 1, throttle: 1 }));
    expect(early.rotorRpm).toBeGreaterThan(90);            // transient reserve sustains full power…
    expect(early.ittLC).toBeLessThan(880);                 // …temperature capped throughout
    const late = run(sim, 150, input({ collective: 1, throttle: 1 }));
    expect(late.rotorRpm).toBeLessThan(early.rotorRpm);    // reserve spent → continuous limit governs
    expect(late.rotorRpm).toBeGreaterThan(75);             // never a runaway or wreck
  });

  it('ITT: starter light-off spike, decay on shutdown', () => {
    const sim = new HelicopterSim({ altM: 30, groundAltM: 0, engine: false, rotorRpm: 20, ngPct: 0 });
    run(sim, 3, input({ engine: false }));
    const lit = run(sim, 10, input({ collective: 0.3, throttle: 0.2, engine: true }));
    expect(lit.ittLC).toBeGreaterThan(300);                // light-off heats the section
    const off = run(sim, 60, input({ engine: false }));
    expect(off.ittLC).toBeLessThan(120);                   // cools toward ambient
  });

  it('hot & high: torque limit caps climb performance at density altitude', () => {
    const sim = new HelicopterSim({ altM: 2000, groundAltM: 0 });
    const hc = hoverCollectiveAt(2000);
    const st = run(sim, 20, input({ collective: hc, throttle: 0.8, pitch: 1 }));
    expect(st.torquePct).toBeGreaterThan(65);              // working high on the schedule
    expect(st.vsFpm).toBeGreaterThan(-600);                // hovers near its limit…
    expect(st.vsFpm).toBeLessThan(1800);                  // …but the margin is gone
    // And just a kilometre higher, full collective cannot hover: the ceiling is real.
    const high = run(new HelicopterSim({ altM: 3500, groundAltM: 0 }), 15, input({ collective: 1 }));
    expect(high.vsFpm).toBeLessThan(-800);
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

  it('YAW SAS: heading held hands-off through drift; pedal re-trims; banking steers freely', () => {
    const sim = new HelicopterSim({ altM: 300, groundAltM: 0, headingDeg: 90 });
    run(sim, 6, input({ collective: HOVER_COLLECTIVE }));
    const held = sim.state;
    expect(Math.abs(held.headingDeg - 90)).toBeLessThan(3);      // SAS holds while drifting right
    expect(held.ttDriftMps).toBeGreaterThan(0.2);                // the drift itself remains (honest)
    run(sim, 2, input({ collective: HOVER_COLLECTIVE, pedal: 0.4 }));   // pedal steers
    run(sim, 3, input({ collective: HOVER_COLLECTIVE }));               // release: new heading held
    const turned = sim.state;
    expect(Math.abs(turned.headingDeg - 90)).toBeGreaterThan(5);
    const stable = run(sim, 4, input({ collective: HOVER_COLLECTIVE }));
    expect(Math.abs(stable.headingDeg - turned.headingDeg)).toBeLessThan(2);
    // SAS OFF: raw torque/weathervane physics rules
    const raw = new HelicopterSim({ altM: 300, groundAltM: 0, headingDeg: 90 });
    raw.setYawSAS(false);
    const off = run(raw, 6, input({ collective: HOVER_COLLECTIVE }));
    expect(Math.abs(off.headingDeg - 90)).toBeGreaterThan(1);    // drift weathervanes the nose
  });

  it('trimmed hover: torque balance holds heading, translating tendency drifts right', () => {
    // FAA Ch.2/4: TR thrust balances torque at trim (no yaw) but acts right of the
    // CG, sliding the airframe right — the pilot holds left cyclic to stop it.
    const sim = new HelicopterSim({ altM: 300, groundAltM: 0, headingDeg: 90 });
    const st = run(sim, 4, input({ collective: HOVER_COLLECTIVE }));
    // torque trim holds heading near-neutral; the fin weathervanes the nose a few
    // degrees INTO the translating-tendency drift it produced (raw physics —
    // without a yaw SAS the drift itself is relative wind).
    expect(Math.abs(st.headingDeg - 90)).toBeLessThan(8);
    expect(st.ttDriftMps).toBeGreaterThan(0.1);   // honest: real aircraft drifts right
    expect(st.ttDriftMps).toBeLessThan(0.9);
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

describe('HelicopterSim — wind, shear, turbulence, live temperature', () => {
  it('boundary-layer shear: the hub feels more wind at 100 m than near the deck', () => {
    const low = new HelicopterSim({ altM: 1, groundAltM: 0, headingDeg: 90 });
    low.setWind(0, -10);                                     // 19 kt air mass moving north
    const l = run(low, 0.15, input({ collective: HOVER_COLLECTIVE }));   // before drift eats TAS
    const high = new HelicopterSim({ altM: 100, groundAltM: 0, headingDeg: 90 });
    high.setWind(0, -10);
    const h = run(high, 0.15, input({ collective: HOVER_COLLECTIVE }));
    expect(h.tasKts).toBeGreaterThan(l.tasKts * 1.2);        // stronger aloft (log profile)
    expect(l.iasKts).toBeGreaterThan(8);                     // hub still sees wind near the deck
  });

  it('a hovering helicopter weathervanes its nose INTO a beam wind', () => {
    const sim = new HelicopterSim({ altM: 120, groundAltM: 0, headingDeg: 90 });
    sim.setWind(0, -10);                                     // wind FROM the north
    const st = run(sim, 6, input({ collective: HOVER_COLLECTIVE }));
    expect(st.headingDeg).toBeLessThan(75);                  // nose swung toward north
    expect(st.headingDeg).toBeGreaterThan(0);
  });

  it('headwind hover equals ground hover on instruments; GS shows the difference', () => {
    const sim = new HelicopterSim({ altM: 300, groundAltM: 0, headingDeg: 0 });
    sim.setWind(0, -10);                                     // air mass moving south… wait: north
    const st = run(sim, 3, input({ collective: HOVER_COLLECTIVE }));
    expect(st.headwindKts).toBeGreaterThan(15);              // ~19 kt into the nose (hub-profile scaled)
    expect(Math.abs(st.xwindKts)).toBeLessThan(4);           // aligned with the wind: no beam component
    expect(Math.abs(st.sideslipDeg)).toBeLessThan(10);       // nose stays reasonably into it
  });

  it('turbulence toggle shakes the air mass with bounded, coherent gusts', () => {
    const sim = new HelicopterSim({ altM: 400, groundAltM: 0, headingDeg: 90 });
    sim.setTurbulence(1);
    let maxDev = 0; let prev = 0;
    for (let i = 0; i < 2000; i++) {
      const st = sim.update(0.05, input({ collective: HOVER_COLLECTIVE }));
      const dev = Math.abs(st.windE) + Math.abs(st.windN);
      maxDev = Math.max(maxDev, dev);
      prev = st.rotorRpm;
    }
    expect(maxDev).toBeGreaterThan(1.5);                     // real gusting
    expect(maxDev).toBeLessThan(16);                         // bounded, coherent
    expect(prev).toBeGreaterThan(60);                        // airworthiness maintained
  });

  it('live OAT shifts the hover ceiling story (hot day = less density)', () => {
    const cool = new HelicopterSim({ altM: 1500, groundAltM: 0 });
    cool.setSurfaceOAT(0);                                   // cold day
    const hot = new HelicopterSim({ altM: 1500, groundAltM: 0 });
    hot.setSurfaceOAT(40);                                   // scorching
    const c = run(cool, 8, input({ collective: 0.85 }));
    const h = run(hot, 8, input({ collective: 0.85 }));
    expect(c.densityRatio).toBeGreaterThan(h.densityRatio * 1.05);
    expect(c.vsFpm).toBeGreaterThan(h.vsFpm + 100);          // cold air climbs harder — honest
    expect(h.oatC).toBeGreaterThan(25);
  });
});

describe('HelicopterSim — RBS, transverse flow, IGE/OGE, gross weight', () => {
  it('a normal hover never threatens the retreating blade', () => {
    const sim = new HelicopterSim({ altM: 300, groundAltM: 0 });
    const st = run(sim, 20, input({ collective: HOVER_COLLECTIVE }));
    expect(st.rbs).toBe(false);
  });

  it('speed + abrupt aft cyclic + high collective retreating-blade stalls', () => {
    const sim = new HelicopterSim({ altM: 300, groundAltM: 0, headingDeg: 90 });
    run(sim, 24, input({ collective: HOVER_COLLECTIVE, pitch: 1, throttle: 1 }));   // build speed
    expect(sim.state.iasKts).toBeGreaterThan(90);
    const st = run(sim, 2.5, input({ collective: 0.95, pitch: -1, throttle: 1 }));  // slam aft
    expect(st.rbs).toBe(true);
    expect(st.vsFpm).toBeLessThan(3500);                    // lift is bleeding in the stall
  });

  it('hands-off through the transverse-flow band, the Apache rolls right', () => {
    const sim = new HelicopterSim({ altM: 400, groundAltM: 0, headingDeg: 90 });
    let rollMax = -99;
    for (let i = 0; i < 240; i++) {                         // gently accelerate through ~15 kt
      const st = sim.update(0.05, input({ collective: HOVER_COLLECTIVE, pitch: i < 90 ? 0.7 : 0 }));
      if (st.iasKts > 9 && st.iasKts < 18) rollMax = Math.max(rollMax, st.rollDeg);
    }
    expect(rollMax).toBeGreaterThan(0.4);                   // right roll tendency (CCW rotor)
    // …and left cyclic beats it, per the handbook's correction
    const held = new HelicopterSim({ altM: 400, groundAltM: 0, headingDeg: 90 });
    let heldRoll = -99;
    for (let i = 0; i < 240; i++) {
      const st = held.update(0.05, input({ collective: HOVER_COLLECTIVE, pitch: i < 90 ? 0.7 : 0, roll: -0.3 }));
      if (st.iasKts > 9 && st.iasKts < 18) heldRoll = Math.max(heldRoll, st.rollDeg);
    }
    expect(heldRoll).toBeLessThan(rollMax);
  });

  it('the hover ceiling is IGE at altitudes where OGE cannot hold', () => {
    // Density altitude ~2,600 m: thin. In ground effect the disk still flies.
    const ige = new HelicopterSim({ altM: 2600, groundAltM: 2598, headingDeg: 90 });
    const gi = run(ige, 6, input({ collective: 0.92 }));
    expect(Math.abs(gi.vsFpm)).toBeLessThan(900);
    // Same DA, out of ground effect: the same collective cannot hover.
    const oge = new HelicopterSim({ altM: 2600, groundAltM: 2000, headingDeg: 90 });
    const go = run(oge, 6, input({ collective: 0.92 }));
    expect(go.vsFpm).toBeLessThan(-900);
  });

  it('gross weight spends the thrust margin: max gross hovers marginal, light hauls ass', () => {
    const heavy = new HelicopterSim({ altM: 500, groundAltM: 0 });
    heavy.setMassKg(9500);
    const light = new HelicopterSim({ altM: 500, groundAltM: 0 });
    light.setMassKg(4500);
    const h8 = run(heavy, 8, input({ collective: 1 }));     // marginal hover on transient torque…
    expect(h8.vsFpm).toBeGreaterThan(-1400);
    expect(h8.vsFpm).toBeLessThan(1500);
    const h = run(heavy, 10, input({ collective: 1 }));     // …then the rating drains to continuous and max gross CANNOT hold the hover
    expect(h.vsFpm).toBeLessThan(-2000);
    const l = run(light, 15, input({ collective: 1 }));
    expect(l.vsFpm).toBeGreaterThan(h.vsFpm + 1000);        // featherweight: climbs hard
    // …and max gross at high DA cannot hover even IN ground effect: honest,
    // it settles back onto the pad rather than defying physics.
    const deck = new HelicopterSim({ altM: 2200, groundAltM: 2198 });
    deck.setMassKg(9500);
    const d = run(deck, 8, input({ collective: 1 }));
    expect(d.onGround).toBe(true);
    expect(d.aglM).toBe(0);
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

  describe('Direct Intuitive Flight Controls', () => {
    it('FRONT moves forward only', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      const st = run(sim, 3, input({ collective: HOVER_COLLECTIVE, pitch: 1, roll: 0, throttle: 0 }));
      expect(sim.velocity.e).toBeGreaterThan(5); // heading 90 = east
      expect(Math.abs(sim.velocity.n)).toBeLessThan(1); // no lateral deviation
      expect(st.pitchDeg).toBeLessThan(0); // slight nose down
    });

    it('BACK moves backward only', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      const st = run(sim, 3, input({ collective: HOVER_COLLECTIVE, pitch: -1, roll: 0, throttle: 0 }));
      expect(sim.velocity.e).toBeLessThan(-5); // moves west (backward from east)
      expect(Math.abs(sim.velocity.n)).toBeLessThan(1);
      expect(st.pitchDeg).toBeGreaterThan(0); // slight nose up
    });

    it('LEFT moves left only with heading preserved in hover', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      const st = run(sim, 3, input({ collective: HOVER_COLLECTIVE, roll: -1, pitch: 0, throttle: 0 }));
      expect(sim.velocity.n).toBeGreaterThan(4); // heading 90 (east): left is north (+N)
      // honest: raising collective to hover briefly yaws as torque passes TR trim
      // (pilot stays ahead of it with pedal); no sustained yaw spin.
      expect(Math.abs(st.headingDeg - 90)).toBeLessThan(3.5);
    });

    it('RIGHT moves right only with heading preserved in hover', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      const st = run(sim, 3, input({ collective: HOVER_COLLECTIVE, roll: 1, pitch: 0, throttle: 0 }));
      expect(sim.velocity.n).toBeLessThan(-4); // heading 90 (east): right is south (-N)
      expect(Math.abs(st.headingDeg - 90)).toBeLessThan(3.5); // no sustained yaw spin
    });

    it('ACCEL bar at 0 holds position (only translating-tendency creep); raising it accelerates to max', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      const stop = run(sim, 4, input({ collective: HOVER_COLLECTIVE, throttle: 0, pitch: 0 }));
      // honest FAA Ch.2: a trimmed hover still creeps right under TR thrust (~1 kt)
      expect(stop.iasKts).toBeLessThan(2.5);

      const fast = run(sim, 8, input({ collective: HOVER_COLLECTIVE, throttle: 1, pitch: 0 }));
      expect(fast.iasKts).toBeGreaterThan(40);
    });

    it('PULL UP bar lifts off from the ground, and PULL DOWN to 0 reaches the ground at 0m', () => {
      // 1. On the pad: collective must exceed hover thrust to lift off — no magic assist
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 100, groundAltM: 100, onGround: true });
      expect(sim.state.aglM).toBe(0);
      const stuck = run(sim, 2, input({ collective: 0.35 }));
      expect(stuck.aglM).toBe(0);                            // 35% thrust cannot beat gravity
      const lifted = run(sim, 5, input({ collective: 0.9 }));
      expect(lifted.aglM).toBeGreaterThan(0.5);              // lifted off from ground!
      expect(lifted.onGround).toBe(false);

      // 2. In air, pulling bar down to 0 lands and reaches ground at 0m
      const landed = run(sim, 10, input({ collective: 0 }));
      expect(landed.aglM).toBe(0);
      expect(landed.onGround).toBe(true);
    });

    it('FRONT + LEFT curves left smoothly with banked turn and heading rotation', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      // Start flying forward + rolling left
      const st = run(sim, 3, input({ collective: HOVER_COLLECTIVE, pitch: 1, roll: -1 }));
      // Heading should have turned counter-clockwise (left) from 90° towards North (0°)
      const hdgDiff = ((90 - st.headingDeg + 540) % 360) - 180;
      expect(hdgDiff).toBeGreaterThan(30); // turned at least 30° left in 3 seconds
      expect(st.rollDeg).toBeLessThan(-10); // banked into the turn
      expect(st.iasKts).toBeGreaterThan(10); // thrust-vector accel: real helis build speed over seconds
    });

    it('FRONT + RIGHT curves right smoothly with banked turn and heading rotation', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      // Start flying forward + rolling right
      const st = run(sim, 3, input({ collective: HOVER_COLLECTIVE, pitch: 1, roll: 1 }));
      // Heading should have turned clockwise (right) from 90° towards South (180°)
      const hdgDiff = ((st.headingDeg - 90 + 540) % 360) - 180;
      expect(hdgDiff).toBeGreaterThan(30); // turned at least 30° right in 3 seconds
      expect(st.rollDeg).toBeGreaterThan(10); // banked right into the turn
      expect(st.iasKts).toBeGreaterThan(10); // thrust-vector accel: real helis build speed over seconds
    });

    it('Releasing LEFT after curving settles forward flight on the new heading', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      // Curve left for 3 seconds (a real turn: speed builds, nose weathervanes onto track)
      run(sim, 3, input({ collective: HOVER_COLLECTIVE, pitch: 1, roll: -1 }));
      const turnedHdg = sim.state.headingDeg;
      // Release roll, continue FRONT
      const finalSt = run(sim, 2.5, input({ collective: HOVER_COLLECTIVE, pitch: 1, roll: 0 }));
      expect(Math.abs(finalSt.rollDeg)).toBeLessThan(3);                    // wings level
      expect(Math.abs(finalSt.headingDeg - turnedHdg)).toBeLessThan(12);    // converges onto flight path, no runaway orbit
    });

    it('BACK + LEFT translates diagonally backward and left with stable heading', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      // Heading 90° is East. Backward is West (-E), Left is North (+N).
      const st = run(sim, 2.5, input({ collective: HOVER_COLLECTIVE, pitch: -1, roll: -1 }));
      // Heading should remain locked near 90° (no violent spin-out)
      const hdgDiff = Math.abs(((st.headingDeg - 90 + 540) % 360) - 180);
      expect(hdgDiff).toBeLessThan(15);
      // vN (North) should be positive (left of 90° East)
      expect(sim.velocity.n).toBeGreaterThan(5);
      // vE (East) should be negative (backward from 90° East)
      expect(sim.velocity.e).toBeLessThan(-5);
      expect(st.iasKts).toBeGreaterThan(15);
    });

    it('BACK + RIGHT translates diagonally backward and right with stable heading', () => {
      const sim = new HelicopterSim({ lat: 28.61, lon: 77.21, altM: 500, groundAltM: 0, headingDeg: 90 });
      // Heading 90° is East. Backward is West (-E), Right is South (-N).
      const st = run(sim, 2.5, input({ collective: HOVER_COLLECTIVE, pitch: -1, roll: 1 }));
      // Heading should remain locked near 90° (no violent spin-out)
      const hdgDiff = Math.abs(((st.headingDeg - 90 + 540) % 360) - 180);
      expect(hdgDiff).toBeLessThan(15);
      // vN (North) should be negative (right of 90° East = South)
      expect(sim.velocity.n).toBeLessThan(-5);
      // vE (East) should be negative (backward from 90° East)
      expect(sim.velocity.e).toBeLessThan(-5);
      expect(st.iasKts).toBeGreaterThan(15);
    });
  });
});

