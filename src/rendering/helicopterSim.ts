/**
 * Helicopter flight model — AH-64 style for the Terranoetis globe.
 *
 * A compact rotorcraft dynamic model with realistic-feel (not full rotorcraft
 * aero) behaviour, exposing honest aerospace terminology:
 *   - Collective (0..1) → main-rotor thrust; Ng (gas producer) governs Nf (rotor).
 *   - Cyclic (pitch/roll stick) → thrust-vector tilt → forward/lateral accel.
 *   - Pedals → tail-rotor yaw + anti-torque; torque yaw + translating tendency
 *     make hover a real two-handed job.
 *   - ISA air data: IAS (CAS) / EAS / TAS / GS split by density altitude + wind.
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
  vrs: boolean;          // vortex-ring state condition
  vneKts: number;        // never-exceed speed (IAS)
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
  const tpw = profile?.thrustPerWeight ?? MAX_THRUST_PER_WEIGHT;
  return Math.min(1, (1 / tpw) / sigmaAt(Math.max(0, altM)));
}
const ROTOR_TORQUE_K = 75;            // %/s Nf per unit normalized torque imbalance
const NG_RATE = 1.1;                  // gas-generator response toward demand (1/s)
export const NG_HOVER = 84;           // Ng needed to hold 100% Nf at hover collective
// Vne / climb caps / vertical drag are profile fields now (see PROFILES)
const DRAG_COEF = 0.0011;
const PITCH_ACCEL = 6.5;              // m/s per unit cyclic (low-speed authority)
const ROLL_ACCEL = 6.0;
const THROTTLE_ACCEL = 4.6;           // m/s² at full throttle — power-surplus acceleration
const YAW_RATE = 0.5;                 // rad/s per unit pedal (~28°/s)
const WEATHERVANE = 1.4;              // rad/s² per rad β at full speed authority
const TL_GAIN = 0.13;                 // translational-lift efficiency at full knee
const TL_SPEED_MS = 7.7;              // ETL onset (~15 kt); knee 18–20 kt
const FUEL_BURN_IDLE = 0.004;         // kg/s idle
const FUEL_BURN_PER_TORQUE = 0.06;    // kg/s per unit torque
/* rotor geometry (AH-64: 4-blade, R = 7.31 m, 269 rpm → Ω = 28.2 rad/s) */
const ROTOR_R = 7.31;
const ROTOR_OMEGA = 28.2;
const ROTOR_DISK = Math.PI * ROTOR_R * ROTOR_R;
const RHO0 = 1.225;                   // ISA sea-level density

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
  etlPct: 0, ttDriftMps: 0, trThrustPct: 0, vrs: false, vneKts: 150,
});

/** ISA density ratio σ at geometric altitude (m). Valid to ~11 km. */
function sigmaAt(altM: number): number {
  const h = Math.max(0, Math.min(11000, altM));
  return Math.pow(1 - 2.25577e-5 * h, 4.2568);
}
function oatDegC(altM: number): number {
  return 15 - 1.98 * (Math.max(0, altM) / 1000);
}

export class HelicopterSim {
  readonly profile: RotorcraftProfile;
  private st: HeliState;
  private vN = 0;   // ground speed north (m/s)
  private vE = 0;   // ground speed east (m/s)
  private vU = 0;   // vertical speed (m/s, +up)
  private wN = 0;   // wind velocity (m/s, air-mass motion)
  private wE = 0;
  private rotorRpm = 100;   // Nf %
  private ng = NG_HOVER;    // Ng %
  private torque = 0;
  private collectiveSmooth = 0.5;
  private gearH: number;    // model-origin height above the wheels (m)
  // rate filtering state
  private pPitchD = 0; private pRollD = 0; private pHdgD = 0;
  private pPitchRate = 0; private pRollRate = 0; private pHdgRate = 0;

  private wingFrac = 0;
  /** true airspeed (m/s) through the current air mass */
  private airMassSpeed(): number { return Math.hypot(this.vN - this.wN, this.vE - this.wE); }

  constructor(init?: Partial<HeliState>, opts?: { gearOffsetM?: number; profile?: RotorcraftProfile }) {
    this.profile = opts?.profile ?? PROFILES.AH64E;
    this.st = { ...HELI_DEFAULT(), ...init };
    this.gearH = Math.max(0, opts?.gearOffsetM ?? 0);
    this.rotorRpm = this.st.engine ? this.st.rotorRpm : 0;
    this.ng = this.st.engine ? this.st.ngPct : 0;
    this.collectiveSmooth = this.st.collective;
  }

  get state(): HeliState {
    return { ...this.st, rotorRpm: this.rotorRpm, ngPct: this.ng, torquePct: this.torque * 100 };
  }

  setGroundAlt(m: number) {
    this.st.groundAltM = m;
  }

  /** Ground-speed velocity vector (m/s) — for camera lead & wind triangles. */
  get velocity(): { n: number; e: number; u: number } { return { n: this.vN, e: this.vE, u: this.vU }; }

  /** Set steady wind (m/s velocity of the air mass). Gusts add on top. */
  setWind(wE: number, wN: number) {
    this.wE = wE; this.wN = wN;
  }

  /** Wind gust (m/s added to the air-mass velocity) for the turbulence toggle. */
  addGust(dE: number, dN: number, dU: number) {
    this.wE += dE; this.wN += dN; this.vU += dU;
  }

  resetTo(init: Partial<HeliState>) {
    this.st = { ...HELI_DEFAULT(), ...init };
    this.vN = 0; this.vE = 0; this.vU = 0;
    this.wN = this.st.windN; this.wE = this.st.windE;
    this.rotorRpm = this.st.engine ? 100 : 0;
    this.ng = this.st.engine ? NG_HOVER : 0;
    this.torque = 0;
    this.collectiveSmooth = this.st.collective;
    this.pPitchRate = 0; this.pRollRate = 0; this.pHdgRate = 0;
    this.pPitchD = this.st.pitchDeg; this.pRollD = this.st.rollDeg; this.pHdgD = this.st.headingDeg;
  }

  /** Advance one fixed step. `dt` clamped to avoid explode on tab-switch. */
  update(dtRaw: number, input: HelicopterInput): HeliState {
    const dt = Math.min(Math.max(dtRaw, 0.0001), 0.05);
    const s = this.st;

    /* ── ISA air data ── */
    const sigma = sigmaAt(s.altM);
    const rho = RHO0 * sigma;
    const sqrtSigma = Math.sqrt(sigma);

    /* ── powerplant: ECL/engine → Ng demand; rotor (Nf) follows torque balance ── */
    const engineRun = input.engine && s.fuelKg > 0;
    const ngDemand = engineRun
      ? Math.min(100, NG_HOVER + input.throttle * 16 + 1.6 * Math.max(0, 100 - this.rotorRpm))
      : 0;
    this.ng += (ngDemand - this.ng) * Math.min(1, NG_RATE * dt);
    if (!engineRun) this.ng = Math.max(0, this.ng - dt * 14);   // gas generator spools down freely

    /* collective smoothing (physical lag through hydraulics) */
    this.collectiveSmooth += (input.collective - this.collectiveSmooth) *
      (input.collective > this.collectiveSmooth ? 3.0 : 5.0) * dt;
    const coll = this.collectiveSmooth;

    /* rotor speed: driven by Ng, loaded by collective demand, recovered by descent flow */
    const rpm = this.rotorRpm / 100;
    const drive = (this.ng / 100) * 0.92;                       // normalized drive torque (Ng=100)
    const relief0 = Math.max(0, Math.min(1, (this.airMassSpeed() - 15) / 40));
    const req = coll * (0.55 + 0.45 * rpm) * rpm * (0.5 + 0.5 * sqrtSigma)
      * (1 - this.profile.pusherShare * relief0);               // rotor power demand (wing/pusher share)
    this.rotorRpm = Math.max(0, Math.min(104, this.rotorRpm + (drive - req) * ROTOR_TORQUE_K * dt));
    // Autorotation: descent flow through the rotor re-energises it (never beyond ~34%)
    if (!engineRun && this.vU < -1.5) {
      const recovery = Math.min(3, -this.vU * 0.35) * dt * 10;
      this.rotorRpm = Math.max(this.rotorRpm, Math.min(34, this.rotorRpm + recovery));
    }
    const rpmNow = this.rotorRpm / 100;

    /* drivetrain torque load (gauge %): collective demand × rpm, throttle adds */
    // The governor holds nominal hover torque well below the red-line.  The
    // previous calibration reported >95% torque at the normal hover detent,
    // which made the caution illuminate throughout an otherwise normal flight.
    const trqDemand = engineRun ? 0.12 + coll * 0.74 * rpmNow + input.throttle * 0.18 : 0;
    this.torque += (Math.max(0, trqDemand) - this.torque) * (dt * 2.2);

    /* fuel burn */
    if (engineRun) {
      s.fuelKg = Math.max(0, s.fuelKg - dt * (FUEL_BURN_IDLE + this.torque * FUEL_BURN_PER_TORQUE + input.throttle * 0.015));
    }

    /* available thrust = weight-adjusted, density-scaled (T ∝ ρ); gravity opposes */
    const thrust = coll * this.profile.thrustPerWeight * GRAVITY * (0.25 + 0.75 * rpmNow) * sigma;

    /* ground effect: extra efficiency close to the ground (wheel-height datum) */
    const agl = Math.max(0, s.altM - s.groundAltM - this.gearH);
    const groundEffect = 1 + Math.max(0, 0.18 * (1 - Math.min(1, agl / 60)));

    /* air-mass velocity for all aerodynamic forces */
    const vaN = this.vN - this.wN;
    const vaE = this.vE - this.wE;
    const hdgRad0 = (s.headingDeg * Math.PI) / 180;
    // speed along/at right of the nose, in the airmass
    const vaFwd = vaN * Math.cos(hdgRad0) + vaE * Math.sin(hdgRad0);
    const vaLat = vaN * Math.cos(hdgRad0 + Math.PI / 2) + vaE * Math.sin(hdgRad0 + Math.PI / 2);
    const ve = this.airMassSpeed();                             // true airspeed, m/s

    /* translational lift (ETL): rotor efficiency climbs between ~10 and 24 kt EAS */
    const eas = ve * sqrtSigma;
    const tlFactor = 1 + TL_GAIN * (1 - Math.exp(-eas / TL_SPEED_MS));
    const effectiveThrust = thrust * groundEffect * tlFactor;
    s.etlPct = ((tlFactor - 1) / TL_GAIN) * 100;

    /* ── vertical accel (thrust cos-pitch cos-roll − g) ── */
    const cosP = Math.cos((s.pitchDeg * Math.PI) / 180);
    const cosR = Math.cos((s.rollDeg * Math.PI) / 180);
    this.wingFrac = this.profile.wingOffload * Math.max(0, Math.min(1, (eas - 20) / 25));
    const aUp = effectiveThrust * cosP * cosR - GRAVITY * (1 - this.wingFrac) - this.profile.vsDrag * this.vU * Math.abs(this.vU);

    /* ── forward/lateral accel from cyclic tilt (stick + thrust-vector tilt) ── */
    // pitchDeg: + = nose UP. Stick forward (+pitch input) commands nose-down.
    const gravFwd = -GRAVITY * Math.sin((s.pitchDeg * Math.PI) / 180);
    const gravLat = GRAVITY * Math.sin((s.rollDeg * Math.PI) / 180);

    const stickFwd = input.pitch * PITCH_ACCEL * rpmNow;
    const stickLat = input.roll * ROLL_ACCEL * rpmNow;
    // throttle: net acceleration from power surplus behind the rotor governor
    // pusher-prop compounds accelerate hard without bleeding rotor authority
    const pusherK = this.profile.pusherAccel > 0 ? this.profile.pusherAccel : THROTTLE_ACCEL;
    const pusherTaper = this.profile.pusherAccel > 0 ? Math.max(0.4, 1 - ve / 150) : 1;
    const thrFwd = (engineRun ? input.throttle : 0) * pusherK * rpmNow * pusherTaper;
    // The tail-rotor trim system balances main-rotor torque at the launch
    // detent.  Pedals command a turn; they do not require a constant opposite
    // input merely to prevent an unattended simulation from drifting left.
    const trBalance = Math.max(0, coll * rpmNow);               // 0..1 TR thrust demand
    s.trThrustPct = this.profile.trt ? trBalance * 100 : 0;
    const trtLat = 0;
    const aFwd = stickFwd + gravFwd + thrFwd;
    const aLat = stickLat + gravLat + trtLat;                   // + = right of nose

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

    // never exceed Vne (ground-track authority limit, as before)
    const spd = Math.hypot(this.vN, this.vE);
    if (spd > this.profile.vneMs) {
      const k = this.profile.vneMs / spd;
      this.vN *= k; this.vE *= k;
    }

    /* vertical integration with cap */
    this.vU = Math.max(-this.profile.maxVsMs, Math.min(this.profile.maxVsMs, this.vU + aUp * dt));
    s.altM += this.vU * dt;
    // ground contact: the skids (not the model origin) rest on the terrain —
    // unconditional clamp so rising terrain can never swallow the airframe
    const floor = s.groundAltM + this.gearH;
    if (s.altM <= floor) {
      const sink = this.vU;                       // m/s at the moment of contact
      s.altM = floor;
      if (this.vU < 0) this.vU = 0;
      // skid friction on the ground bleeds horizontal speed fast
      const fric = Math.min(1, 2.5 * dt);
      this.vN *= (1 - fric);
      this.vE *= (1 - fric);
      s.onGround = true;
      s.hardLanding = sink < -8;                  // >~1,600 fpm — report it
    } else if (!(s.onGround && !engineRun && this.rotorRpm < 10 && coll < 0.05)) {
      s.onGround = false;
      s.hardLanding = false;
    } else {
      // terrain re-streaming under a parked heli: keep it glued to the pad
      s.altM = floor; this.vU = 0; s.aglM = 0; s.hardLanding = false;
    }

    /* Heading: pedals command tail-rotor yaw while the trim system cancels
       steady main-rotor torque.  The fin still weathervanes at speed and a
       banked turn coordinates the flight path. */
    const yawPedal = input.pedal * YAW_RATE;
    const beta = Math.abs(ve) > 0.5 ? Math.atan2(vaLat, Math.abs(vaFwd) + ve * 0.5) : 0; // + airflow from right
    const yawWeathervane = WEATHERVANE * beta * Math.min(1, ve / 15);  // nose yaws toward the relative wind
    const yawBank = Math.sin((s.rollDeg * Math.PI) / 180) * Math.min(1, spd / 30) * 0.45;
    const yawRateRad = yawPedal + yawWeathervane;
    s.headingDeg = (((s.headingDeg + ((yawRateRad + yawBank) * 180) / Math.PI * dt) % 360) + 360) % 360;
    if (Math.abs(yawBank) > 1e-9) {
      const c = Math.cos(yawBank * dt), sn = Math.sin(yawBank * dt);
      const vN0 = this.vN;
      this.vN = vN0 * c - this.vE * sn;
      this.vE = vN0 * sn + this.vE * c;
    }

    /* attitude dynamics: cyclic commands a target attitude, body follows w/ rate limit */
    const targetPitch = -input.pitch * 16;
    const targetRoll = input.roll * 20;
    const P_RATE = 3.2, R_RATE = 3.6;
    s.pitchDeg += clamp((targetPitch - s.pitchDeg) * P_RATE * dt, -10 * dt, 10 * dt);
    s.rollDeg += clamp((targetRoll - s.rollDeg) * R_RATE * dt, -14 * dt, 14 * dt);
    s.pitchDeg = clamp(s.pitchDeg, -18, 18);
    s.rollDeg = clamp(s.rollDeg, -25, 25);

    /* integrate lat/lon */
    const dLat = (this.vN * dt) / 111320;
    const cosLat = Math.max(0.05, Math.cos((s.lat * Math.PI) / 180));
    const dLon = (this.vE * dt) / (111320 * cosLat);
    s.lat = clamp(s.lat + dLat, -89.9, 89.9);
    s.lon = wrapLon(s.lon + dLon);

    /* ── telemetry ── */
    const vaN2 = this.vN - this.wN;
    const vaE2 = this.vE - this.wE;
    const ve2 = Math.hypot(vaN2, vaE2);
    s.densityRatio = sigma;
    s.oatC = oatDegC(s.altM);
    s.windE = this.wE; s.windN = this.wN;
    const windSpd = Math.hypot(this.wE, this.wN);
    s.windFromDeg = windSpd > 0.2 ? (((Math.atan2(-this.wE, -this.wN) * 180) / Math.PI + 360) % 360) : s.headingDeg;
    s.headwindKts = forwardOfNose(vaN2, vaE2, s.headingDeg) * 1.94384;    // + = flying into the wind
    s.xwindKts = -rightOfNose(this.wN, this.wE, s.headingDeg) * 1.94384;   // + = wind from the right
    s.iasKts = ve2 * sqrtSigma * 1.94384;
    s.easKts = ve2 * sqrtSigma * 1.94384;
    s.tasKts = ve2 * 1.94384;
    s.gsKts = Math.hypot(this.vN, this.vE) * 1.94384;
    s.vsFpm = this.vU * 196.8504;
    s.collective = coll;
    s.throttle = engineRun ? input.throttle : 0;
    s.aglM = agl;
    s.engine = engineRun;

    /* rotor coefficients: T = m·a_thrust (1g datum), CT = T/(ρ·πR²·(ΩR)²) */
    const omega = ROTOR_OMEGA * rpmNow;
    const tipSpeed = omega * ROTOR_R;
    const Tn = 5200 * coll * this.profile.thrustPerWeight * GRAVITY * (0.25 + 0.75 * rpmNow) * sigma * (1 - this.wingFrac); // N, hover-datum mass
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

    /* VRS caution: low airspeed, high sink, substantial power (classic gate) */
    s.vrs = !s.onGround && this.vU < -3 && eas < 8 && coll > 0.5 && rpmNow > 0.85;

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
