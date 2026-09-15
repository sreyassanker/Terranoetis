/**
 * Helicopter flight model — AH-64 style for the Terranoetis globe.
 *
 * A compact rotorcraft dynamic model built on real force paths (FAA-H-8083-21B
 * Ch.2/3), exposing honest aerospace terminology:
 *   - Collective (0..1) → main-rotor thrust; Ng (gas producer) governs Nf (rotor).
 *   - Cyclic (pitch/roll stick) → rotor-disk tilt (flapping lag) → thrust-vector
 *     tilt → forward/lateral accel; the airframe hinges onto the disk.
 *   - Pedals trim tail-rotor thrust against main-rotor torque: power above trim
 *     yaws right, below trim yaws left; TR thrust drifts the airframe right
 *     (translating tendency) and gains efficiency at speed (translational thrust).
 *   - ISA air data: IAS (CAS) / EAS / TAS / GS split by density altitude + wind;
 *     Vne limits AIRSPEED, not ground track.
 *   - Translational lift (ETL), ground effect, VRS caution, rotor CT & power.
 *   - Attitude + angular rates and their accelerations.
 *
 * Units: SI internally (m, m/s, rad); HUD telemetry in kts / fpm / % / °.
 */

export interface HelicopterInput {
  collective: number;    // 0..1 (W/S or PgUp/PgDn) — commanded climb/hover thrust
  pitch: number;         // -1..1 cyclic: +1 = stick forward (fly forward), -1 = aft (fly backward)
  roll: number;          // -1..1 cyclic: +1 = stick right (bank/slide right)
  pedal: number;         // -1..1 (tail-rotor / yaw): +1 = nose right
  throttle: number;      // 0..1 engine power (A/D) — Ng demand / acceleration control
  engine: boolean;       // run/stop
}

export interface HeliState {
  lat: number;           // degrees
  lon: number;           // degrees
  altM: number;          // height above WGS-84 (metres)
  headingDeg: number;    // 0..360
  pitchDeg: number;      // positive = nose up
  rollDeg: number;       // positive = right bank
  iasKts: number;        // indicated airspeed (knots CAS) — air-mass speed × √σ
  easKts: number;        // equivalent airspeed
  tasKts: number;        // true airspeed (knots) — |vAir|
  gsKts: number;         // ground speed (knots) — |vGnd|
  vsFpm: number;         // vertical speed ft/min
  rotorRpm: number;      // Nf — rotor speed % of nominal (100 = 269 rpm)
  ngPct: number;         // Ng — gas producer speed %
  torquePct: number;     // engine/drivetrain torque % of limit
  torqueCoeff: number;   // rotor thrust coefficient CT (dimensionless, ~0.006 hover)
  powerShp: number;      // rotor shaft power (shaft horsepower)
  torqueNm: number;      // rotor torque (N·m)
  collective: number;
  throttle: number;      // 0..1 engine power (Ng demand)
  fuelKg: number;
  fuelMaxKg: number;
  engine: boolean;
  groundAltM: number;    // terrain altitude below (metres)
  aglM: number;          // height above ground
  onGround: boolean;     // wheels loaded
  hardLanding: boolean;  // true only in the frame of a >8 m/s touchdown
  // ── air data & environment ──
  densityRatio: number;  // σ = ρ/ρ0 (ISA)
  oatC: number;          // outside air temperature °C (ISA)
  windE: number;         // wind velocity east component (m/s, direction air mass moves)
  windN: number;         // wind velocity north component (m/s)
  windFromDeg: number;   // wind direction FROM (met convention, deg)
  headwindKts: number;   // component along the nose (+head)
  xwindKts: number;      // component from the right (+)
  // ── rates & accelerations ──
  pitchRateDps: number;  // °/s (nose-up +)
  rollRateDps: number;   // °/s (right-bank +)
  yawRateDps: number;    // °/s (nose-right +)
  pitchAccDps2: number;  // °/s² (filtered)
  rollAccDps2: number;
  yawAccDps2: number;
  sideslipDeg: number;   // β: airspeed vector vs nose (+ = airflow from right)
  // ── rotorcraft cues ──
  etlPct: number;        // translational-lift efficiency 0..100 (knee ~18 kt)
  ttDriftMps: number;    // translating-tendency lateral drift rate (m/s, +right)
  trThrustPct: number;   // tail-rotor thrust demand (% of authority)
  diskFwdDeg: number;    // rotor-disk longitudinal tilt (+ forward) — thrust-vector origin
  diskLatDeg: number;    // rotor-disk lateral tilt (+ right)
  trTrimPct: number;     // tail-rotor thrust needed to balance main-rotor torque (trim datum)
  vrs: boolean;          // vortex-ring state condition
  rbs: boolean;          // retreating-blade stall onset (buffet)
  massKg: number;        // gross weight — settable load state
  vneKts: number;        // never-exceed speed (IAS)
  // ── powerplant: twin T700-701D ──
  ngLPct: number;        // left gas producer Ng (%)
  ngRPct: number;        // right gas producer Ng (%)
  ittLC: number;         // left turbine inlet temperature (°C)
  ittRC: number;         // right turbine inlet temperature (°C)
  eng1Live: boolean;     // left engine driving the transmission
  eng2Live: boolean;     // right engine driving the transmission
  torqueLimitPct: number;// FADEC continuous torque limit: twin 87% / OEI contingency 66%
  oei: boolean;          // one engine inoperative
}

/* ── airframe performance profiles (calibrated in docs/helicopter-benchmarks.md) ── */
export interface RotorcraftProfile {
  id: 'AH64E' | 'HELIDRIVE_X';
  label: string;
  thrustPerWeight: number;    // hover margin
  vneMs: number;              // never-exceed, ground-track authority
  maxVsMs: number;            // vertical speed cap
  trt: boolean;               // tail-rotor effects (torque yaw + drift)
  pusherAccel: number;        // m/s² of pusher-prop authority (0 = none)
  pusherShare: number;        // fraction of rotor load shed to wing+pusher in high speed
  wingOffload: number;        // fraction of weight carried by wing above the knee
  vsDrag: number;             // vertical-drag coefficient (climb terminal limiter)
}
export const PROFILES: Record<RotorcraftProfile['id'], RotorcraftProfile> = {
  AH64E: { id: 'AH64E', label: 'AH-64E APACHE', thrustPerWeight: 1.30, vneMs: 77, maxVsMs: 15,
           trt: true, pusherAccel: 0, pusherShare: 0, wingOffload: 0, vsDrag: 0.022 },
  // experimental compound: coaxial rigid rotors + pusher + speed wing.
  // Vne 250 kt CAS beats S-97 (240) & Lynx record (216); = SB-1 cruise target; below V-280 (300, tiltrotor).
  HELIDRIVE_X: { id: 'HELIDRIVE_X', label: 'HELIDRIVE-X COMPOUND', thrustPerWeight: 1.62, vneMs: 128.6,
                 maxVsMs: 17.5, trt: false, pusherAccel: 8.2, pusherShare: 0.45, wingOffload: 0.18, vsDrag: 0.0125 },
};

/* ── tuning (AH-64E: Vne 150 kt, ROC ~2,000 fpm, hover ≈ coll 0.77) ── */
const GRAVITY = 9.81;
const MAX_THRUST_PER_WEIGHT = 1.30;   // hover margin; HOVER_COLLECTIVE = 1/this
export const HOVER_COLLECTIVE = 1 / MAX_THRUST_PER_WEIGHT;
/** Hover collective at a density altitude — thin air costs thrust (T ∝ σ). */
export function hoverCollectiveAt(altM: number, profile?: RotorcraftProfile): number {
  return hoverCollectiveAtMass(altM, MASS_REF, profile);
}
/** Hover collective for a given gross weight (power-fraction margin). */
export function hoverCollectiveAtMass(altM: number, massKg: number, profile?: RotorcraftProfile): number {
  const tpw = profile?.thrustPerWeight ?? MAX_THRUST_PER_WEIGHT;
  return Math.min(1, (1 / tpw) * Math.pow(massKg / MASS_REF, 0.38) / sigmaAt(Math.max(0, altM)));
}
const ROTOR_TORQUE_K = 75;            // %/s Nf per unit normalized torque imbalance
const NG_RATE = 1.1;                  // gas-generator response toward demand (1/s)
export const NG_HOVER = 84;           // Ng needed to hold 100% Nf at hover collective
// Vne / climb caps / vertical drag are profile fields now (see PROFILES)
/* Drag retuned for thrust-vector dynamics: terminal speed at full disk tilt
   must sit above Vne so the aircraft CAN reach the placard (FAA Ch.2 forces). */
const DRAG_COEF = 0.00046;
const THROTTLE_ACCEL = 4.6;           // m/s² at full throttle — power-surplus acceleration
/* rotor-disk mechanics — the cyclic tilts the disk; the disk tilts the thrust
   vector; the thrust vector flies the aircraft (dissymmetry of lift + flapping) */
const MAX_DISK_FWD = 12;              // deg longitudinal cyclic authority (disk tilt)
const MAX_DISK_LAT = 12;              // deg lateral cyclic authority
const MAX_DISK_TOTAL = 16;            // deg total disk tilt (cyclic stop ring)
const FLAP_RATE = 4.0;                // 1/s — disk response lag to cyclic (flapping hinge)
const SAS_GAIN = 0.35;                // deg disk per m/s speed error (speed-hold SAS on accel bar)
const SAS_MAX = 16;                   // deg — max SAS disk demand
/* tail rotor / torque (CCW main rotor → torque yaws nose right, TRT pushes right) */
const TR_K = 2.2;                     // rad/s yaw rate per unit TRT-vs-torque imbalance (÷(1+YZ) after damping)
const YAW_DAMP = 1.0;                 // yaw rate damping: equilibrium ψ̇ = (TR+WV)/(1+YZ)
const YAW_LAG_RATE = 4;               // 1/s — yaw inertia time constant
const TR_TRANS = 0.30;                // translational thrust: TR efficiency gain at speed (FAA 2-22)
const TT_K = 0.30;                    // m/s² translating-tendency lateral force per unit TRT
const FIN_SIDE = 0.22;                // 1/s — vemp/fuselage SIDE translation damping; most
                                      // fin force becomes the yawing moment (WEATHERVANE)
const YAW_RATE = 0.5;                 // rad/s per unit pedal — coaxial reaction control only
const YAW_AUTH = 0.75;                // rad/s — total tail-rotor yaw authority ceiling (~43°/s)
const WEATHERVANE = 6.0;              // rad/s per rad β — fin directional stability at fore airflow
const TL_GAIN = 0.13;                 // translational-lift efficiency at full knee
const TL_SPEED_MS = 7.7;              // ETL onset (~15 kt); knee 18–20 kt
/* Fuel is deliberately infinite in this sim (product decision): the tanks stay
   full, the engine never starves, and no fuel state feeds the dynamics. */
/* rotor geometry (AH-64: 4-blade, R = 7.31 m, 269 rpm → Ω = 28.2 rad/s) */
const ROTOR_R = 7.31;
const ROTOR_OMEGA = 28.2;
const ROTOR_DISK = Math.PI * ROTOR_R * ROTOR_R;
const RHO0 = 1.225;                   // ISA sea-level density
const MASS_REF = 5200;                // hover-datum gross weight (kg)

export const HELI_DEFAULT = (): HeliState => ({
  lat: 28.61, lon: 77.21, altM: 500,
  headingDeg: 90, pitchDeg: 0, rollDeg: 0,
  iasKts: 0, easKts: 0, tasKts: 0, gsKts: 0,
  vsFpm: 0, rotorRpm: 100, ngPct: NG_HOVER, torquePct: 0,
  torqueCoeff: 0, powerShp: 0, torqueNm: 0,
  collective: 0.5, throttle: 0, fuelKg: 1200, fuelMaxKg: 1200,
  engine: true, groundAltM: 0, aglM: 500, onGround: false, hardLanding: false,
  densityRatio: 1, oatC: 15, windE: 0, windN: 0, windFromDeg: 0,
  headwindKts: 0, xwindKts: 0,
  pitchRateDps: 0, rollRateDps: 0, yawRateDps: 0,
  pitchAccDps2: 0, rollAccDps2: 0, yawAccDps2: 0, sideslipDeg: 0,
  etlPct: 0, ttDriftMps: 0, trThrustPct: 0, vrs: false, vneKts: 150, rbs: false, massKg: 5200,
  diskFwdDeg: 0, diskLatDeg: 0, trTrimPct: 50,
  ngLPct: NG_HOVER, ngRPct: NG_HOVER, ittLC: 15, ittRC: 15,
  eng1Live: true, eng2Live: true, torqueLimitPct: 87, oei: false,
});

/** ISA density ratio σ at geometric altitude (m). Valid to ~11 km. */
function sigmaAt(altM: number): number {
  const h = Math.max(0, Math.min(11000, altM));
  return Math.pow(1 - 2.25577e-5 * h, 4.2568);
}
function oatDegC(altM: number, surfC = 15): number {
  return surfC - 1.98 * (Math.max(0, altM) / 1000);
}
/** Atmospheric-boundary-layer logarithmic wind profile, z₀ = 0.25 m
    (open terrain): 1.0 at the 10 m reference, stronger aloft, calmer behind
    surface friction — the wind gradient helicopters actually feel. */
function windAtFactor(aglM: number): number {
  const z = Math.max(1.5, aglM + 5.5);   // measured at the ROTOR HUB, ~5.5 m above the gear
  return Math.max(0.5, Math.min(1.3, Math.log(z / 0.5) / Math.log(20)));
}
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.2;

export class HelicopterSim {
  readonly profile: RotorcraftProfile;
  private st: HeliState;
  private vN = 0;   // ground speed north (m/s)
  private vE = 0;   // ground speed east (m/s)
  private vU = 0;   // vertical speed (m/s, +up)
  private wN = 0;   // reference wind at 10 m AGL (m/s, air-mass motion)
  private wE = 0;
  private wNf = 0;  // effective wind at the aircraft (log profile + gusts)
  private wEf = 0;
  private gustE = 0; private gustN = 0;   // OU turbulence states (m/s)
  private gustW = 0;                       // vertical gust acceleration (m/s²)
  private turb = 0;                        // turbulence intensity 0..1
  private oatSurfC = 15;                   // surface OAT °C (live weather aware)
  private massKg = 5200;                   // gross weight (hover-datum mass)
  private buffetPhase = 0;                 // RBS / transverse-flow buffet clock
  private yawSas = true;                   // AH-64 stability augmentation: yaw attitude hold
  private hdgRef = 0;                      // SAS heading reference (deg)
  private trans = 1;                       // FADEC transient torque rating remaining (1 → 0)
  private rotorRpm = 100;   // Nf %
  private ngL = NG_HOVER;   // left T700 gas producer %
  private ngR = NG_HOVER;   // right T700 gas producer %
  private ittL = 15;        // left turbine inlet temp °C
  private ittR = 15;        // right turbine inlet temp °C
  private engL = true;      // left engine driving the transmission
  private engR = true;      // right engine driving the transmission
  private torque = 0;
  private collectiveSmooth = 0.5;
  private diskFwd = 0;      // rotor disk longitudinal tilt, deg (+ forward)
  private diskLat = 0;      // rotor disk lateral tilt, deg (+ right)
  private yawRateState = 0; // rad/s — heading rate (damped first-order state)
  private vrsDepth = 0;     // 0..1 — vortex-ring recirculation development (self-sustaining)
  private gearH: number;    // model-origin height above the wheels (m)
  // rate filtering state
  private pPitchD = 0; private pRollD = 0; private pHdgD = 0;
  private pPitchRate = 0; private pRollRate = 0; private pHdgRate = 0;

  private wingFrac = 0;
  /** true airspeed (m/s) through the current air mass */
  private airMassSpeed(): number { return Math.hypot(this.vN - this.wNf, this.vE - this.wEf); }

  constructor(init?: Partial<HeliState>, opts?: { gearOffsetM?: number; profile?: RotorcraftProfile }) {
    this.profile = opts?.profile ?? PROFILES.AH64E;
    this.st = { ...HELI_DEFAULT(), ...init };
    this.gearH = Math.max(0, opts?.gearOffsetM ?? 0);
    this.st.aglM = this.st.onGround ? 0 : Math.max(0, this.st.altM - this.st.groundAltM - this.gearH);
    this.rotorRpm = this.st.engine ? this.st.rotorRpm : 0;
    this.ngL = this.st.engine ? this.st.ngPct : 0;
    this.ngR = this.st.engine ? this.st.ngPct : 0;
    this.collectiveSmooth = this.st.collective;
    this.wEf = this.wE; this.wNf = this.wN;
    this.hdgRef = this.st.headingDeg;
    this.pPitchD = this.st.pitchDeg;
    this.pRollD = this.st.rollDeg;
    this.pHdgD = this.st.headingDeg;
  }

  get state(): HeliState {
    return {
      ...this.st, rotorRpm: this.rotorRpm,
      ngPct: Math.max(this.ngL, this.ngR), torquePct: this.torque * 100,
      ngLPct: this.ngL, ngRPct: this.ngR, ittLC: this.ittL, ittRC: this.ittR,
      eng1Live: this.engL, eng2Live: this.engR,
    };
  }

  /** Simulate an uncommanded flameout on one engine (test/event hook). */
  failEngine(side: 'L' | 'R' = 'L') {
    if (side === 'L') this.engL = false; else this.engR = false;
  }

  /** Bring the failed engine back (restart on the ground / maintenance). */
  restoreEngines() { this.engL = true; this.engR = true; }

  get enginesLive(): number { return (this.engL ? 1 : 0) + (this.engR ? 1 : 0); }

  setGroundAlt(m: number) {
    this.st.groundAltM = m;
  }

  /** Ground-speed velocity vector (m/s) — for camera lead & wind triangles. */
  get velocity(): { n: number; e: number; u: number } { return { n: this.vN, e: this.vE, u: this.vU }; }

  /** Set the reference wind (m/s velocity of the air mass at 10 m AGL).
      The boundary-layer logarithmic profile scales it with height (FAA Ch.11:
      wind gradient / shear), OU turbulence adds coherent gusts on top. */
  setWind(wE: number, wN: number) {
    this.wE = wE; this.wN = wN;
  }

  /** Surface OAT (°C). Deviating from ISA shifts the density-altitude story. */
  setSurfaceOAT(c: number) { this.oatSurfC = Math.max(-40, Math.min(50, c)); }

  /** Turbulence intensity 0..1 (Dryden-ish smoothed gusts, FAA Ch.11 gusts). */
  setTurbulence(i: number) { this.turb = Math.max(0, Math.min(1, i)); }

  /** Gross weight (kg). Heavier = less thrust margin: ceilings, rates, RBS, OEI. */
  setMassKg(kg: number) { this.massKg = Math.max(4200, Math.min(9500, kg)); }

  /** AH-64 SAS (yaw channel) ON/OFF. With SAS on, a hands-off, pedal-off
      heading is held — like the real airframe's stability augmentation. */
  setYawSAS(on: boolean) { this.yawSas = on; }

  get massLimitFrac(): number { return MASS_REF / this.massKg; }

  /** Legacy discrete gust poke (kept for compatibility / test injection). */
  addGust(dE: number, dN: number, dU: number) {
    this.gustE += dE; this.gustN += dN; this.vU += dU;
  }

  resetTo(init: Partial<HeliState>) {
    this.st = { ...HELI_DEFAULT(), ...init };
    this.vN = 0; this.vE = 0; this.vU = 0;
    this.wN = this.st.windN; this.wE = this.st.windE;
    this.wNf = this.wN; this.wEf = this.wE;
    this.rotorRpm = this.st.engine ? 100 : 0;
    this.ngL = this.st.engine ? NG_HOVER : 0;
    this.ngR = this.st.engine ? NG_HOVER : 0;
    this.ittL = 15; this.ittR = 15;
    this.engL = true; this.engR = true;
    this.trans = 1;
    this.torque = 0;
    this.collectiveSmooth = this.st.collective;
    this.diskFwd = 0; this.diskLat = 0; this.vrsDepth = 0; this.yawRateState = 0;
    this.gustE = 0; this.gustN = 0; this.gustW = 0; this.turb = 0;
    this.hdgRef = this.st.headingDeg;
    this.pPitchRate = 0; this.pRollRate = 0; this.pHdgRate = 0;
    this.pPitchD = this.st.pitchDeg; this.pRollD = this.st.rollDeg; this.pHdgD = this.st.headingDeg;
  }

  /** Advance one fixed step. `dt` clamped to avoid explode on tab-switch. */
  update(dtRaw: number, input: HelicopterInput): HeliState {
    const dt = Math.min(Math.max(dtRaw, 0.0001), 0.05);
    const s = this.st;

    /* ── wind: boundary-layer profile + coherent OU gusts ── */
    const aglW = Math.max(0, s.altM - s.groundAltM);
    const zw = windAtFactor(aglW);
    {
      const tau = 1.6;                                   // ~1.6 s gust correlation
      const sigma = this.turb * 4.2;                     // m/s gust σ at full intensity
      const a = Math.min(1, dt / tau);
      this.gustE += -this.gustE * a + gauss() * sigma * Math.sqrt(dt / tau) * 0.9;
      this.gustN += -this.gustN * a + gauss() * sigma * Math.sqrt(dt / tau) * 0.9;
      this.gustW += -this.gustW * a + gauss() * this.turb * 0.9 * Math.sqrt(dt / tau);
      this.gustE = Math.max(-14, Math.min(14, this.gustE));
      this.gustN = Math.max(-14, Math.min(14, this.gustN));
      this.gustW = Math.max(-2.4, Math.min(2.4, this.gustW));
    }
    this.wEf = this.wE * zw + this.gustE;
    this.wNf = this.wN * zw + this.gustN;

    /* ── air data: ISA shape, live surface OAT shifts density ── */
    const sigma = sigmaAt(s.altM) * (288.15 - 0.0065 * Math.max(0, Math.min(11000, s.altM)))
      / (273.15 + oatDegC(s.altM, this.oatSurfC));
    const rho = RHO0 * sigma;
    const sqrtSigma = Math.sqrt(sigma);

    /* ── powerplant: twin T700-701D ──
       ECL/engine → Ng demand per live engine; a FADEC schedules each generator
       back on total-torque or ITT exceedance (continuous 87% twin / 66% OEI
       contingency, ITT redline 870 °C) — limits power, never destroys it. ── */
    const engineRun = input.engine;
    const liveCount = (this.engL ? 1 : 0) + (this.engR ? 1 : 0);
    const rpm0 = this.rotorRpm / 100;
    const tqRaw0 = engineRun && liveCount > 0
      ? 0.12 + this.collectiveSmooth * 0.74 * rpm0 + input.throttle * 0.18 : 0;
    /* T700 torque ratings: continuous schedule plus a transient reserve the
       FADEC burns as it is used (and recharges when demand drops) — this is
       what lets the Apache hover at max gross; hold full collective too long
       and it decays to continuous. */
    if (engineRun && liveCount > 0) {
      const cont = liveCount === 2 ? 0.87 : 0.66;
      if (tqRaw0 > cont) this.trans = Math.max(0, this.trans - dt / (liveCount === 2 ? 90 : 25));
      else if (tqRaw0 < cont * 0.88) this.trans = Math.min(1, this.trans + dt / 45);
    }
    const tqLimit = (liveCount === 2 ? 0.87 : 0.66) + 0.28 * this.trans;
    s.torqueLimitPct = Math.round(tqLimit * 100);
    s.oei = liveCount < 2 && engineRun;
    const overTq = Math.max(0, tqRaw0 / tqLimit - 1);
    const overT = Math.max(0, (Math.max(this.ittL, this.ittR) - 870) / 80);
    const fade = Math.max(0.55, Math.min(1, 1 - overTq * 1.6 - Math.min(0.3, overT) * 2));
    const ngDemand = engineRun && liveCount > 0
      ? Math.min(100, (NG_HOVER + input.throttle * 16 + 1.6 * Math.max(0, 100 - this.rotorRpm)) * fade)
      : 0;
    const ngStep = (live: boolean, ng: number): number =>
      (engineRun && live)
        ? ng + (ngDemand - ng) * Math.min(1, NG_RATE * dt)
        : Math.max(0, ng - dt * (engineRun ? 7 : 14));          // failed: fuel cut, gas producer spools out
    const ngLPrev = this.ngL; const ngRPrev = this.ngR;
    this.ngL = ngStep(this.engL, this.ngL);
    this.ngR = ngStep(this.engR, this.ngR);
    /* ITT: equilibrium rises with per-engine torque load; ram air cools; spool-up
       transients overshoot; decay toward ambient when shut down. */
    const ramCool = 1 + 0.25 * Math.min(1, this.airMassSpeed() / 50);
    const ittStep = (itt: number, live: boolean, ng: number, ngPrev: number, oat: number): number => {
      if (!engineRun || !live) return itt + (oat + (engineRun ? 60 : 0) - itt) * Math.min(1, dt * 0.05);
      const load = liveCount === 2 ? (tqRaw0 / 2) / 0.435 : tqRaw0 / 0.66;
      const target = (200 + 640 * Math.pow(Math.max(0, load), 1.6) + (this.oatSurfC - 15) * 2.4) / ramCool;
      const spool = Math.max(0, ng - ngPrev) * 3.0;
      return Math.min(940, itt + (target - itt) * Math.min(1, dt * 0.35) + spool);
    };
    const oat = oatDegC(s.altM);
    this.ittL = ittStep(this.ittL, this.engL, this.ngL, ngLPrev, oat);
    this.ittR = ittStep(this.ittR, this.engR, this.ngR, ngRPrev, oat);

    /* collective smoothing (physical lag through hydraulics) */
    this.collectiveSmooth += (input.collective - this.collectiveSmooth) *
      (input.collective > this.collectiveSmooth ? 3.0 : 5.0) * dt;
    const coll = this.collectiveSmooth;

    /* rotor speed: engine-driven while running; in autorotation the rotor is
       driven by upflow through the disk and loaded by blade pitch — the pilot
       trades rotor rpm against rate of descent, and aft cyclic lowers disk
       loading (rpm rises) exactly per FAA Ch.11. */
    const rpm = this.rotorRpm / 100;
    let nfDot: number;
    if (engineRun) {
      // Per-engine drive authority: twins at normal schedule; the survivor of an
      // OEI is on contingency rating (T700 30-min 2,160 shp ≈ 1.5× continuous),
      // so one engine can still hold a moderate-weight hover.
      const drive = (this.ngL / 100 * (this.engL ? 1 : 0) + this.ngR / 100 * (this.engR ? 1 : 0))
        * (liveCount === 2 ? 0.50 : 0.74);
      const relief0 = Math.max(0, Math.min(1, (this.airMassSpeed() - 15) / 40));
      const req = coll * (0.55 + 0.45 * rpm) * rpm * (0.5 + 0.5 * sqrtSigma)
        * (1 - this.profile.pusherShare * relief0);             // rotor power demand (wing/pusher share)
      nfDot = drive - req;
    } else {
      const sinkM = Math.max(0, -this.vU);                      // descent flow through the rotor
      const drive = 0.030 * sinkM * (1.15 - coll) * sqrtSigma * (1 - 0.4 * this.vrsDepth);
      const load = (0.10 + coll * 0.55) * rpm * rpm;
      // Aft cyclic unloads the disk and raises rotor rpm; forward cyclic does the
      // reverse (blowback) — FAA Ch.11.
      // Big rotor inertia (AH-64 stores ~8 MJ at 100%): transients are seconds, not frames.
      nfDot = (drive - load + (-this.diskFwd) * 0.0035 * rpm) * 0.13;
    }
    this.rotorRpm = Math.max(0, Math.min(104, this.rotorRpm + nfDot * ROTOR_TORQUE_K * dt));
    const rpmNow = this.rotorRpm / 100;

    /* drivetrain torque (gauge % of AVAILABLE capacity — twin 87% continuous,
       OEI 66% contingency): the whole crew story lives in this one number. */
    const trqDemand = engineRun && liveCount > 0 ? tqRaw0 / tqLimit : 0;
    this.torque += (Math.max(0, trqDemand) - this.torque) * (dt * 2.2);

    /* available thrust = weight-adjusted, density-scaled (T ∝ ρ); gravity opposes.
       Installed T/W margin vs gross weight follows a power-fraction (hover power
       ∝ W^1.5, thrust ∝ W): calibrated so the hover detent is 0.77 at the
       5,200 kg datum and max gross (9,500 kg) hovers at full collective —
       marginal, like the real airframe near its ceiling. */
    const thrust = coll * this.profile.thrustPerWeight * Math.pow(MASS_REF / this.massKg, 0.38)
      * GRAVITY * (0.40 + 0.60 * rpmNow) * sigma;

    /* ground effect (FAA Ch.4): IGE is a rotor-diameter phenomenon — the recirculation
       block below the disk buys ~25% thrust ON the surface, fading by ~1.5 rotor radii.
       OGE hover has none of it: the hover ceiling is genuinely lower out of ground. */
    const agl = Math.max(0, s.altM - s.groundAltM - this.gearH);
    const groundEffect = 1 + 0.26 * Math.exp(-agl / (0.85 * ROTOR_R));

    /* air-mass velocity for all aerodynamic forces */
    const vaN = this.vN - this.wNf;
    const vaE = this.vE - this.wEf;
    const hdgRad0 = (s.headingDeg * Math.PI) / 180;
    // speed along/at right of the nose, in the airmass
    const vaFwd = vaN * Math.cos(hdgRad0) + vaE * Math.sin(hdgRad0);
    const vaLat = vaN * Math.cos(hdgRad0 + Math.PI / 2) + vaE * Math.sin(hdgRad0 + Math.PI / 2);
    const ve = this.airMassSpeed();                             // true airspeed, m/s

    /* ── retreating-blade stall (FAA Ch.11) ──
       The retreating blade (left side, CCW rotor) runs out of relative wind. Its
       angle of attack climbs with disk loading (collective/gross), load factor,
       advance ratio μ, and aft disk tilt; thin air raises the collective needed.
       Onset: buffet, nose pitch-up, roll toward the retreating side, lift loss. */
    const nLoad = 1 / Math.max(0.62, Math.cos((s.rollDeg * Math.PI) / 180));
    const mu = Math.min(0.55, ve / (ROTOR_OMEGA * ROTOR_R * 0.96));
    // Gross weight deepens the asymmetry bite (bigger blade pitch excursions)…
    const rbsIndex = (coll / HOVER_COLLECTIVE) * nLoad
      * (1 + 2.3 * mu * mu * (this.massKg / MASS_REF))
      * (1 + Math.max(0, -this.diskFwd) * 0.055) - 1;
    const rbsSev = Math.max(0, Math.min(1, (rbsIndex - 0.5) * 1.4));
    const rbsLoss = 1 - 0.42 * rbsSev;
    s.rbs = rbsSev > 0.25 && !s.onGround;
    this.buffetPhase += dt * 26;

    /* translational lift (ETL): rotor efficiency climbs between ~10 and 24 kt EAS */
    const eas = ve * sqrtSigma;
    const tlFactor = 1 + TL_GAIN * (1 - Math.exp(-eas / TL_SPEED_MS));
    // VRS: the recirculating wake starves the rotor of clean airflow — lift
    // decays the deeper it develops, feeding the descent (FAA Ch.11 settle).
    const vrsLoss = 1 - 0.55 * this.vrsDepth;
    const effectiveThrust = (thrust * groundEffect * tlFactor) * vrsLoss * rbsLoss;
    s.etlPct = ((tlFactor - 1) / TL_GAIN) * 100;

    /* ── rotor disk & cyclic controls ── */
    const currentFwdSpeed = this.vN * Math.cos(hdgRad0) + this.vE * Math.sin(hdgRad0);

    // Forward flight authority: 0 in stationary hover or reverse, 1.0 during forward flight
    const fwdSpeed = Math.max(0, currentFwdSpeed);
    const fwdAuthority = clamp(
      Math.max(
        fwdSpeed / 5.0,
        input.throttle > 0.05 ? 1.0 : 0.0
      ),
      0,
      1.0
    );

    // Directional stick acceleration (crisp, instant response from keyboard/arrows)
    const stickFwd = input.pitch * 9.0 * rpmNow;

    // Acceleration bar (input.throttle 0..1):
    // Directly commands forward cruise speed from 0 (min / hover-stop) to max (130+ kt)
    const targetFwdSpeed = (engineRun ? input.throttle : 0) * this.profile.vneMs * (this.profile.pusherAccel > 0 ? 1.0 : 0.92);
    const speedDiff = targetFwdSpeed - currentFwdSpeed;
    const pusherK = this.profile.pusherAccel > 0 ? this.profile.pusherAccel : THROTTLE_ACCEL;
    const pusherExtra = this.profile.pusherAccel > 0 ? input.throttle * pusherK * rpmNow : 0;
    const thrFwd = engineRun
      ? (input.throttle > 0
          ? clamp(speedDiff * 1.6, -8.0, 8.0) * rpmNow + pusherExtra
          : (Math.abs(input.pitch) < 0.05 ? clamp(-currentFwdSpeed * 1.5, -8.0, 0) * rpmNow : 0))
      : 0;

    // Directional lateral controls:
    // In hover (fwdAuthority = 0): pure lateral strafe at constant heading
    // In forward flight (fwdAuthority = 1.0): lateral rocket sliding is suppressed; roll drives coordinated curving turn
    const stickLat = input.roll * 8.5 * rpmNow * (1 - fwdAuthority);

    // Virtual rotor disk tracking for cockpit gauges, visual disk tilt, and telemetry
    let diskTgtFwd = input.pitch * MAX_DISK_FWD + (input.throttle > 0.02 ? clamp(speedDiff * 0.35, -SAS_MAX, SAS_MAX) : 0);
    let diskTgtLat = input.roll * MAX_DISK_LAT;
    const diskMag = Math.hypot(diskTgtFwd, diskTgtLat);
    if (diskMag > MAX_DISK_TOTAL) {
      const k = MAX_DISK_TOTAL / diskMag;
      diskTgtFwd *= k; diskTgtLat *= k;
    }
    this.diskFwd += (diskTgtFwd - this.diskFwd) * Math.min(1, 8.0 * dt);
    this.diskLat += (diskTgtLat - this.diskLat) * Math.min(1, 8.0 * dt);
    const diskFRad = (this.diskFwd * Math.PI) / 180;
    const diskLRad = (this.diskLat * Math.PI) / 180;

    /* ── tail rotor vs main-rotor torque ──
       In AH-64 DAFCS, collective-to-yaw mixing auto-trims tail rotor thrust to
       balance main rotor torque so climbing does not kick the nose off heading.
       Pedals steer above or below trim. Translating tendency creates authentic
       rightward drift in hover. */
    const trNeeded = this.profile.trt ? clamp(tqRaw0 / 0.87 * 0.63, 0, 1) : 0;
    const trEff = this.profile.trt ? 1 + TR_TRANS * clamp((ve - 9) / 18, 0, 1) : 1;
    const trThrust = this.profile.trt ? clamp(trNeeded - 0.5 * input.pedal * trEff, 0, 1) : 0;
    s.trThrustPct = this.profile.trt ? trThrust * 100 : 0;
    s.trTrimPct = trNeeded * 100;
    s.diskFwdDeg = this.diskFwd; s.diskLatDeg = this.diskLat;

    this.wingFrac = this.profile.wingOffload * Math.max(0, Math.min(1, (eas - 20) / 25));

    /* ── forces: vertical = T·cos δ − g; horizontal = stick + pusher + gravity tilt ── */
    const aThrust = coll <= 0.03 ? 0 : effectiveThrust;
    const aUp = coll <= 0.03
      ? -GRAVITY * 0.45 - this.profile.vsDrag * this.vU * Math.abs(this.vU)
      : aThrust * Math.cos(diskFRad) * Math.cos(diskLRad)
        - GRAVITY * (1 - this.wingFrac) - this.profile.vsDrag * this.vU * Math.abs(this.vU);

    const gravFwd = -GRAVITY * Math.sin((s.pitchDeg * Math.PI) / 180);
    const gravLat = GRAVITY * Math.sin((s.rollDeg * Math.PI) / 180);

    const aFwd = stickFwd + gravFwd * 0.4 + thrFwd;
    // Translating tendency: authentic rightward drift in hands-off hover (does not fight active pilot cyclic roll)
    const aTT = this.profile.trt && !s.onGround && Math.abs(input.roll) < 0.05 ? TT_K * (s.trThrustPct / 100) * rpmNow : 0;
    const aLat = stickLat + (1 - fwdAuthority) * gravLat * 0.4 + aTT - FIN_SIDE * vaLat * Math.min(1, ve / 15);

    /* aerodynamic drag acts against the AIRMASS velocity */
    if (ve > 0.001) {
      const dragDecel = Math.min(DRAG_COEF * ve * ve, 8);
      this.vN -= (vaN / ve) * dragDecel * dt;
      this.vE -= (vaE / ve) * dragDecel * dt;
    }

    /* update horizontal velocities (N/E from body-forward and lateral) */
    const hdg = hdgRad0;
    this.vN += aFwd * Math.cos(hdg) * dt;
    this.vE += aFwd * Math.sin(hdg) * dt;
    this.vN += aLat * Math.cos(hdg + Math.PI / 2) * dt;
    this.vE += aLat * Math.sin(hdg + Math.PI / 2) * dt;

    // Lateral stabilization in forward flight: damp lateral slide (sideslip) so turns stay cleanly coordinated
    const currentLatSpeed = -this.vN * Math.sin(hdg) + this.vE * Math.cos(hdg);
    if (fwdAuthority > 0.15 && Math.abs(input.roll) < 0.05) {
      const dampGain = 2.0 * fwdAuthority;
      if (Math.abs(currentLatSpeed) > 0.02) {
        const latDecel = clamp(-currentLatSpeed * dampGain, -6.0, 6.0);
        this.vN += latDecel * Math.cos(hdg + Math.PI / 2) * dt;
        this.vE += latDecel * Math.sin(hdg + Math.PI / 2) * dt;
      }
    }

    // Vne is an AIRSPEED placard: limit TAS against the air mass, not the ground track
    const vneTas = this.profile.vneMs / Math.max(0.35, sqrtSigma);
    const veNow = this.airMassSpeed();
    if (veNow > vneTas) {
      const k = vneTas / veNow;
      this.vN = this.wNf + (this.vN - this.wNf) * k;
      this.vE = this.wEf + (this.vE - this.wEf) * k;
    }

    /* vertical integration with cap (autorotational sink exceeds the powered limit) */
    const vsCap = engineRun ? this.profile.maxVsMs : Math.max(this.profile.maxVsMs, 20);
    this.vU = Math.max(-vsCap, Math.min(this.profile.maxVsMs, this.vU + aUp * dt));
    s.altM += this.vU * dt;
    // ground contact: skids rest on the terrain at 0m AGL
    const floor = s.groundAltM + this.gearH;
    if (s.altM <= floor) {
      const sink = this.vU;
      s.altM = floor;
      if (this.vU < 0) this.vU = 0;
      const fric = Math.min(1, 3.0 * dt);
      this.vN *= (1 - fric);
      this.vE *= (1 - fric);
      s.onGround = true;
      s.hardLanding = sink < -8 && coll > 0.15;
    } else if (s.onGround && coll <= 0.05 && s.altM - floor < 25) {
      // bar down at 0: reaches the ground and stays firmly parked at 0m AGL
      s.altM = floor; this.vU = 0; s.aglM = 0; s.hardLanding = false;
    } else {
      s.onGround = false;
      s.hardLanding = false;
    }

    /* Heading: pedals command tail-rotor yaw; fin weathervanes; banked turns coordinate */
    const yawPedal = input.pedal * YAW_RATE;
    const beta = Math.abs(ve) > 0.5 ? Math.atan2(vaLat, Math.abs(vaFwd) + ve * 0.5) : 0;
    const handsOff = Math.abs(input.roll) < 0.08 && Math.abs(input.pitch) < 0.08 && !s.onGround;
    const yawWV = WEATHERVANE * beta * clamp(
      Math.max(vaFwd / 8, handsOff ? Math.min(1, (ve / 10) ** 2) : 0), 0, 1);

    // Coordinated banked turn:
    // When moving forward or FRONT is commanded, roll banks the aircraft and curves the flight path
    const bankRad = (s.rollDeg * Math.PI) / 180;
    const turnAuthority = Math.min(1.0, Math.max(0.5, fwdSpeed / 5.0));
    const yawBank = (Math.abs(input.roll) > 0.05 && (fwdAuthority > 0.05 || fwdSpeed > 0.8 || input.pitch > 0.05))
      ? (Math.sin(bankRad) * 1.5 + input.roll * 0.75) * rpmNow * turnAuthority
      : 0;

    /* ── YAW SAS (AH-64 stability augmentation) ── */
    const pedalActive = Math.abs(input.pedal) > 0.05;
    const cyclicNeutral = Math.abs(input.roll) < 0.05 && Math.abs(input.pitch) < 0.1;
    if (pedalActive || !cyclicNeutral || s.onGround || !this.yawSas) this.hdgRef = s.headingDeg;
    const hdgErr = (((this.hdgRef - s.headingDeg) % 360) + 540) % 360 - 180;
    const yawSasTerm = (this.yawSas && !pedalActive && cyclicNeutral && !s.onGround && engineRun)
      ? clamp(hdgErr * Math.PI / 180 * 3.5, -0.9, 0.9)
      : 0;

    // yaw rate is a damped first-order state with anti-windup clamping to authority limits
    const yawDampFactor = (Math.abs(input.roll) < 0.05 && Math.abs(input.pedal) < 0.05) ? 3.0 : YAW_DAMP;
    const yawDemand = yawPedal + yawWV + yawBank + yawSasTerm - yawDampFactor * this.yawRateState;
    this.yawRateState = clamp(
      this.yawRateState + (yawDemand - this.yawRateState) * Math.min(1, YAW_LAG_RATE * dt),
      -YAW_AUTH,
      YAW_AUTH
    );
    const yawRateRad = this.yawRateState;
    s.headingDeg = (((s.headingDeg + ((yawRateRad) * 180) / Math.PI * dt) % 360) + 360) % 360;

    // Velocity vector arc rotation:
    // In forward flight or when forward stick is active, rotate horizontal velocity with the turn so the helicopter carves a clean arc
    if (Math.abs(yawRateRad) > 1e-4 && (currentFwdSpeed > 0.5 || input.pitch > 0.05)) {
      const rot = yawRateRad * dt;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const vN0 = this.vN;
      this.vN = vN0 * c - this.vE * sn;
      this.vE = vN0 * sn + this.vE * c;
    }

    /* attitude dynamics: clean visual feedback for commands + realistic transverse flow & RBS cues */
    const ktEAS = eas * 1.94384;
    const tf = 2.4 * Math.exp(-(((ktEAS - 13) / 5) ** 2))
      + 1.6 * Math.exp(-(((ktEAS - 20) / 5.5) ** 2));           // blowback band
    const tfVib = tf * Math.sin(this.buffetPhase * 1.7) * 0.28; // transverse-flow buffet
    const targetPitch = -input.pitch * 9.0 + (input.throttle > 0.05 ? -clamp(currentFwdSpeed * 0.1, 0, 4) : 0) + tf * 0.4 + rbsSev * 2.4;
    const targetRoll = input.roll * 18.0 + tf * 0.6 - rbsSev * 3.2 + tfVib;
    const P_RATE = 3.5, R_RATE = Math.abs(input.roll) < 0.05 ? 6.0 : 3.8;
    s.pitchDeg += clamp((targetPitch - s.pitchDeg) * P_RATE * dt, -10 * dt, 10 * dt);
    s.rollDeg += clamp((targetRoll - s.rollDeg) * R_RATE * dt, -20 * dt, 20 * dt);
    s.pitchDeg = clamp(s.pitchDeg, -18, 18);
    s.rollDeg = clamp(s.rollDeg, -25, 25);

    /* integrate lat/lon */
    const dLat = (this.vN * dt) / 111320;
    const cosLat = Math.max(0.05, Math.cos((s.lat * Math.PI) / 180));
    const dLon = (this.vE * dt) / (111320 * cosLat);
    s.lat = clamp(s.lat + dLat, -89.9, 89.9);
    s.lon = wrapLon(s.lon + dLon);

    /* ── telemetry ── */
    const vaN2 = this.vN - this.wNf;
    const vaE2 = this.vE - this.wEf;
    const ve2 = Math.hypot(vaN2, vaE2);
    s.densityRatio = sigma;
    s.oatC = oatDegC(s.altM, this.oatSurfC);
    s.windE = this.wEf; s.windN = this.wNf;
    const windSpd = Math.hypot(this.wEf, this.wNf);
    s.windFromDeg = windSpd > 0.2 ? (((Math.atan2(-this.wEf, -this.wNf) * 180) / Math.PI + 360) % 360) : s.headingDeg;
    s.headwindKts = forwardOfNose(vaN2, vaE2, s.headingDeg) * 1.94384;    // + = flying into the wind
    s.xwindKts = -rightOfNose(this.wN, this.wE, s.headingDeg) * 1.94384;   // + = wind from the right
    s.iasKts = ve2 * sqrtSigma * 1.94384;
    s.easKts = ve2 * sqrtSigma * 1.94384;
    s.tasKts = ve2 * 1.94384;
    s.gsKts = Math.hypot(this.vN, this.vE) * 1.94384;
    s.vsFpm = this.vU * 196.8504;
    s.collective = coll;
    s.throttle = engineRun ? input.throttle : 0;
    s.aglM = s.onGround ? 0 : agl;
    s.engine = engineRun;

    /* rotor coefficients: T = m·a_thrust (1g datum), CT = T/(ρ·πR²·(ΩR)²) */
    const omega = ROTOR_OMEGA * rpmNow;
    const tipSpeed = omega * ROTOR_R;
    const Tn = this.massKg * coll * this.profile.thrustPerWeight * Math.pow(MASS_REF / this.massKg, 0.62) * GRAVITY * (0.40 + 0.60 * rpmNow) * sigma * (1 - this.wingFrac); // N
    s.torqueCoeff = tipSpeed > 1 ? Tn / (rho * ROTOR_DISK * tipSpeed * tipSpeed) : 0;
    // induced + profile drag loss factor: high at hover, parasite climbs with speed
    const loss = 0.095 + 0.055 * Math.exp(-((eas * 1.94384 / 20) ** 2)) + 0.02 * (ve2 / this.profile.vneMs) ** 2;
    s.torqueNm = Tn * loss * ROTOR_R;
    s.powerShp = omega > 0.5 ? (s.torqueNm * omega) / 745.7 : 0;
    s.vneKts = Math.round(this.profile.vneMs * 1.94384);

    /* angular rates (°/s) + accelerations (°/s², low-passed) */
    const wrap180 = (d: number) => { while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
    const pRate = (s.pitchDeg - this.pPitchD) / dt;
    const rRate = (s.rollDeg - this.pRollD) / dt;
    const yRate = wrap180(s.headingDeg - this.pHdgD) / dt;
    this.pPitchD = s.pitchDeg; this.pRollD = s.rollDeg; this.pHdgD = s.headingDeg;
    s.pitchRateDps = pRate; s.rollRateDps = rRate; s.yawRateDps = yRate;
    const aLP = Math.min(1, dt * 8);
    s.pitchAccDps2 += ((pRate - this.pPitchRate) / dt - s.pitchAccDps2) * aLP;
    s.rollAccDps2 += ((rRate - this.pRollRate) / dt - s.rollAccDps2) * aLP;
    s.yawAccDps2 += ((yRate - this.pHdgRate) / dt - s.yawAccDps2) * aLP;
    this.pPitchRate = pRate; this.pRollRate = rRate; this.pHdgRate = yRate;
    s.sideslipDeg = (beta * 180) / Math.PI;
    s.ttDriftMps = rightOfNose(vaN2, vaE2, s.headingDeg);                  // + = drifting right through the air

    /* VRS: classic gate (low airspeed + high sink + power) but it DEVELOPS —
       thrust decays, sink grows, and the state feeds itself until the pilot
       lowers collective or gains forward airspeed through the disk. */
    const vrsGate = engineRun && !s.onGround && this.vU < -3 && eas < 8 && coll > 0.5 && rpmNow > 0.85;
    this.vrsDepth += ((vrsGate ? 1 : 0) - this.vrsDepth) * (vrsGate ? 0.30 : 0.9) * dt;
    s.vrs = this.vrsDepth > 0.35;

    return this.state;
  }
}

function forwardOfNose(vx: number, vy: number, headingDeg: number): number {
  const h = (headingDeg * Math.PI) / 180;
  return vx * Math.cos(h) + vy * Math.sin(h);
}
function rightOfNose(vx: number, vy: number, headingDeg: number): number {
  const h = (headingDeg * Math.PI) / 180;
  return vx * Math.cos(h + Math.PI / 2) + vy * Math.sin(h + Math.PI / 2);
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function wrapLon(v: number) {
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}
