/**
 * Chase-camera rig for the helicopter sim (Pillar A).
 *
 * A pure, Cesium-free, frame-rate-independent spring rig that turns the
 * static orbit turntable into a chase cam with aerodynamic inertia:
 *
 *   - position trails the airframe's velocity vector, not just its nose
 *   - critically/under-damped springs (ζ < 1 gives a hair of overshoot)
 *   - framing distance scales with TAS and AGL, and SQUATS with the
 *     airframe at low AGL so the rig tracks nap-of-the-earth lines
 *   - distance- and speed-scaled FOV (the DCS "speed rush")
 *   - bank bias + attitude roll bleed-through
 *   - manual gestures perturb the rig (offsets decay back to chase framing)
 *
 * Conventions match the App's existing orbit parameterisation:
 *   az: body-frame spherical azimuth, π = directly behind the nose
 *   el: elevation above the target plane (radians)
 *   dist: metres from the (optionally panned) target
 * All inputs SI except attitudes in degrees. Clock is injected — testable.
 */

export interface ChaseFrame {
  headingRad: number;   // nose heading (ENU, rad)
  tasMps: number;       // true airspeed magnitude (m/s)
  aglM: number;         // height above ground (m)
  yawRateDps: number;   // + nose right
  sideslipDeg: number;  // β: + air velocity vector right of nose
  pitchDeg: number;     // + nose up
  rollDeg: number;      // + right bank
}

export interface ChaseRigConfig {
  d0: number; kv: number; ka: number; dMin: number; dMax: number;
  fovClose: number; fovFar: number; fovSpeedK: number; fovMin: number; fovMax: number;
  elBase: number; bankK: number; pitchLeadK: number;
  aglKnee: number;                            // AGL (m) below which the rig squats to the deck
  elLow: number;                              // elevation base (rad) at agl→0
  kaLow: number;                              // AGL-distance law retained at agl→0 (0..1)
  omega: number; zeta: number;              // positional spring
  fovOmega: number; rollOmega: number;
  tauReturn: number;                        // manual-offset decay (s)
  betaK: number;                            // trailing of the velocity vector
  leadT: number;                            // target lead along velocity (s)
  rollGain: number; rollMax: number;
}

export const CHASE_CLOSE_CONFIG = (over: Partial<ChaseRigConfig> = {}): ChaseRigConfig => ({
  // Close gaming chase cam: positioned right behind the tail boom looking directly
  // along the airframe axis with the helicopter centered on screen at all altitudes (0m to 5000m+).
  d0: 21, kv: 0.18, ka: 0, dMin: 18, dMax: 26,
  fovClose: 1.12, fovFar: 1.25, fovSpeedK: 0.08, fovMin: 0.85, fovMax: 1.65, // radians
  elBase: 0.18, bankK: 0.08, pitchLeadK: 0.15,
  aglKnee: 200, elLow: 0.18, kaLow: 1.0,
  omega: 5.0, zeta: 0.95,
  fovOmega: 2.0, rollOmega: 2.8,
  tauReturn: 5,
  betaK: 0, leadT: 0,
  rollGain: 0.40, rollMax: 16,
  ...over,
});

export const CHASE_WIDE_CONFIG = (over: Partial<ChaseRigConfig> = {}): ChaseRigConfig => ({
  // Wide tactical chase view: balanced distance for situational awareness with
  // strict tail-alignment and dead-center lock on the airframe.
  d0: 48, kv: 0.65, ka: 0.035, dMin: 28, dMax: 160,
  fovClose: 0.95, fovFar: 1.18, fovSpeedK: 0.10, fovMin: 0.55, fovMax: 1.75, // radians
  elBase: 0.26, bankK: 0.10, pitchLeadK: 0.22,
  aglKnee: 450, elLow: 0.10, kaLow: 0.45,
  omega: 4.2, zeta: 0.88,
  fovOmega: 1.4, rollOmega: 2.4,
  tauReturn: 6,
  betaK: 0.15, leadT: 0,
  rollGain: 0.32, rollMax: 12,
  ...over,
});

export const CHASE_CONFIG = (over: Partial<ChaseRigConfig> = {}): ChaseRigConfig => CHASE_WIDE_CONFIG(over);

export interface ChaseOutput {
  az: number; el: number; dist: number; distTarget: number;
  fov: number;          // radians
  rollDeg: number;      // camera roll (degrees)
  leadT: number;        // target lead time along velocity (s)
  mode: ChaseRig['mode'];
}

interface Spring { x: number; v: number }

const springStep = (
  sp: Spring, eq: number, omega: number, zeta: number, dt: number, wrap = false,
) => {
  let err = eq - sp.x;
  if (wrap) { while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI; }
  const a = omega * omega * err - 2 * zeta * omega * sp.v;
  sp.v += a * dt;
  sp.x += sp.v * dt;
  return sp.x;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class ChaseRig {
  mode: 'chase' | 'orbit' = 'chase';
  /** 0..1 user "rigidity": <1 floppier cable-cam, >1 snappier */
  rigidity = 1;

  private cfg: ChaseRigConfig;
  // Camera bearing is integrated in the WORLD frame so it genuinely lags a
  // turning airframe; the body-frame az the App consumes = world − nose.
  private wAz: Spring = { x: Math.PI, v: 0 };
  private pH = 0;                          // previous nose heading
  private el: Spring = { x: 0.32, v: 0 };
  private ld: Spring = { x: Math.log(45), v: 0 };   // log-distance spring
  private fov: Spring = { x: 1.047, v: 0 };
  private roll: Spring = { x: 0, v: 0 };

  // decaying manual offsets
  private mAz = 0; private mEl = 0; private mLogD = 0; private mFov = 0;
  // orbit-mode release inertia (Cesium-style gliding)
  private velAz = 0; private velEl = 0; private velZoom = 0;
  private dragging = false;
  private t = 0;
  private eqLd = Math.log(45);          // current framing distance equilibrium

  constructor(init?: { az: number; el: number; dist: number }, cfg?: Partial<ChaseRigConfig>) {
    this.cfg = CHASE_CONFIG(cfg);
    if (init) {
      this.wAz = { x: init.az, v: 0 };
      this.pH = init.az - Math.PI;
      this.el = { x: init.el, v: 0 };
      this.ld = { x: Math.log(Math.max(this.cfg.dMin * 0.5, init.dist)), v: 0 };
    }
    this.fov.x = lerp(this.cfg.fovClose, this.cfg.fovFar, 0.35);
  }

  get config(): ChaseRigConfig { return this.cfg; }

  setDragging(on: boolean) { this.dragging = on; }

  /** Drag delta (rad) — live nudge, keeps inertia bookkeeping for orbit mode. */
  nudgeAzEl(dAz: number, dEl: number, liveVelAz = 0, liveVelEl = 0) {
    if (this.mode === 'chase') {
      this.mAz += dAz;
      this.mEl = clamp(this.mEl + dEl, -1.5, 1.45);
    } else {
      this.wAz.x += dAz;
      this.el.x = clamp(this.el.x + dEl, -1.553, 1.553);
      this.velAz = liveVelAz; this.velEl = liveVelEl;
    }
  }

  /** Wheel/zoom delta (log factor). */
  nudgeZoom(logFactor: number, withInertia = 0) {
    if (this.mode === 'chase') {
      this.mLogD = clamp(this.mLogD + logFactor, -4, 6);
      this.velZoom = withInertia;
    } else {
      this.ld.x = clamp(this.ld.x + logFactor, Math.log(0.05), Math.log(8000));
      this.velZoom = withInertia;
    }
  }

  /** Trackpad twist / fling: impulse into the angular velocity. */
  flingAz(velRadPerS: number) {
    if (this.mode === 'chase') this.wAz.v += velRadPerS * 0.5;
    else this.velAz = velRadPerS;
  }

  /** ± keys: manual FOV offset that decays back to the auto law. */
  nudgeFov(dRad: number) { this.mFov = clamp(this.mFov + dRad, -0.9, 0.9); }

  /** Hard-set the distance target (mode switches / reset / top-down handoff). */
  reset(dist: number, el?: number, az?: number) {
    this.wAz = { x: az ?? Math.PI, v: 0 };
    this.el = { x: el ?? this.cfg.elBase, v: 0 };
    this.ld = { x: Math.log(clamp(dist, 0.05, 8000)), v: 0 };
    this.mAz = 0; this.mEl = 0; this.mLogD = 0; this.mFov = 0;
    this.velAz = 0; this.velEl = 0; this.velZoom = 0;
  }

  /** Switch between close chase and wide chase profiles dynamically. */
  setProfile(p: 'close' | 'wide', headingRad?: number) {
    this.cfg = p === 'close' ? CHASE_CLOSE_CONFIG() : CHASE_WIDE_CONFIG();
    const az = (headingRad !== undefined && Number.isFinite(headingRad))
      ? headingRad + Math.PI
      : this.wAz.x;
    if (headingRad !== undefined && Number.isFinite(headingRad)) {
      this.pH = headingRad;
    }
    this.reset(this.cfg.d0, this.cfg.elBase, az);
  }

  /** Advance and return the framing for this frame. */
  step(dtRaw: number, fRaw: ChaseFrame): ChaseOutput {
    const c = this.cfg;
    const dt = clamp(Number.isFinite(dtRaw) ? dtRaw : 0.016, 0.001, 0.05);
    const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d);
    const f: ChaseFrame = {
      headingRad: fin(fRaw.headingRad, this.pH) as number,
      tasMps: Math.max(0, fin(fRaw.tasMps, 0)),
      aglM: Math.max(0, fin(fRaw.aglM, 0)),
      yawRateDps: clamp(fin(fRaw.yawRateDps, 0), -400, 400),
      sideslipDeg: clamp(fin(fRaw.sideslipDeg, 0), -180, 180),
      pitchDeg: clamp(fin(fRaw.pitchDeg, 0), -90, 90),
      rollDeg: clamp(fin(fRaw.rollDeg, 0), -90, 90),
    };
    this.t += dt;
    const rigW = 0.55 + 0.75 * clamp(this.rigidity, 0, 2);   // softness from user knob

    // heading advance feed-forward: camera mostly follows the nose, leaving a
    // controllable fraction of genuine world-frame lag during fast rotation.
    let dH = f.headingRad - this.pH;
    while (dH > Math.PI) dH -= 2 * Math.PI;
    while (dH < -Math.PI) dH += 2 * Math.PI;
    if (Math.abs(dH) < 0.6) this.wAz.x += dH * 0.82;
    this.pH = f.headingRad;

    let targetDist = Math.exp(this.ld.x);
    if (this.mode === 'chase') {
      // ── manual offsets decay back to autonomous framing ──
      const decay = Math.exp(-dt / c.tauReturn);
      this.mAz *= decay; this.mEl *= decay; this.mLogD *= decay; this.mFov *= decay;

      // ── low-AGL squat: as the airframe closes on the deck the camera
      //    flattens its elevation toward the flight-path plane and pulls in,
      //    so the external view tracks low-level lines instead of hovering ──
      const squat = 1 - smoothstep(clamp(f.aglM / c.aglKnee, 0, 1));   // 0 high → 1 on deck

      // ── equilibrium target: behind the velocity vector, in world frame ──
      const beta = (c.betaK * f.sideslipDeg * Math.PI) / 180;
      const eqAz = f.headingRad + Math.PI + clamp(beta, -0.9, 0.9) + this.mAz;
      const elBaseAg = lerp(c.elBase, c.elLow, squat);
      const eqEl = clamp(
        elBaseAg + c.bankK * (f.rollDeg * Math.PI / 180) + c.pitchLeadK * (f.pitchDeg * Math.PI / 180) + this.mEl,
        -1.2, 1.45,
      );
      const eqDist = clamp(c.d0 + c.kv * f.tasMps + c.ka * f.aglM * lerp(1, c.kaLow, squat), c.dMin, c.dMax);
      // manual zoom may perturb but never break out of the framing envelope
      const eqLd = clamp(Math.log(eqDist) + this.mLogD, Math.log(c.dMin), Math.log(c.dMax));
      this.eqLd = eqLd;
      targetDist = Math.exp(eqLd);

      // ── springs; soften slightly during fast rotation (operator lag) ──
      const soft = 1 - Math.min(0.45, Math.abs(f.yawRateDps) / 90);
      const w = c.omega * rigW * soft;
      springStep(this.wAz, eqAz, w, c.zeta, dt, true);
      springStep(this.el, eqEl, w * 1.1, c.zeta, dt);
      springStep(this.ld, eqLd, w * 0.6, c.zeta, dt);

      // ── FOV: distance law + speed rush + decaying manual ──
      const t = smoothstep((Math.exp(this.ld.x) - 15) / 200);
      const eqFov = clamp(
        lerp(c.fovClose, c.fovFar, t) + c.fovSpeedK * Math.min(1, f.tasMps / 77) + this.mFov,
        c.fovMin, c.fovMax,
      );
      springStep(this.fov, eqFov, c.fovOmega * rigW, 1, dt);

      // ── roll: attitude bleeds through, decays to level in hover ──
      const eqRoll = clamp(c.rollGain * f.rollDeg, -c.rollMax, c.rollMax);
      springStep(this.roll, eqRoll, c.rollOmega, 1, dt);
    } else {
      // ── orbit mode: the classic turntable with release inertia ──
      if (!this.dragging) {
        this.wAz.x += this.velAz * dt;
        this.el.x = clamp(this.el.x + this.velEl * dt, -1.553, 1.553);
        const dmp = Math.pow(0.9, dt * 60);
        this.velAz *= dmp; this.velEl *= dmp;
        if (Math.abs(this.velZoom) > 1e-4) {
          this.ld.x = clamp(this.ld.x + this.velZoom * dt, Math.log(0.05), Math.log(8000));
          this.velZoom *= Math.pow(0.8, dt * 60);
        }
      }
      // FOV stays where the manual keys put it (no auto law in orbit mode)
      springStep(this.fov, clamp(1.047 + this.mFov, c.fovMin, c.fovMax), 2.5, 1, dt);
      this.mFov *= Math.exp(-dt / 4);
      springStep(this.roll, 0, 2, 1, dt);
    }

    const dist = Math.exp(this.ld.x);
    let bodyAz = this.wAz.x - f.headingRad;
    while (bodyAz > Math.PI) bodyAz -= 2 * Math.PI;
    while (bodyAz < -Math.PI) bodyAz += 2 * Math.PI;
    return {
      az: bodyAz,
      el: this.el.x,
      dist,
      distTarget: targetDist,
      fov: this.fov.x,
      rollDeg: this.mode === 'chase' ? this.roll.x : 0,
      leadT: this.mode === 'chase' ? c.leadT * Math.min(1, f.tasMps / 25) : 0,
      mode: this.mode,
    };
  }

  /** Current state snapshot (debug/tests). */
  get snapshot() {
    let bodyAz = this.wAz.x - this.pH;
    while (bodyAz > Math.PI) bodyAz -= 2 * Math.PI;
    while (bodyAz < -Math.PI) bodyAz += 2 * Math.PI;
    return {
      mode: this.mode,
      az: bodyAz, el: this.el.x, dist: Math.exp(this.ld.x),
      fov: this.fov.x, rollDeg: this.roll.x,
      distTarget: Math.exp(this.mode === 'chase' ? this.eqLd : this.ld.x),
      manual: { az: this.mAz, el: this.mEl, logDist: this.mLogD, fov: this.mFov },
      time: this.t,
    };
  }
}
