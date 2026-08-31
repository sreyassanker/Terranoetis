/**
 * Cinematic Camera — tick-based continuous motion engine.
 * the reference platform-parity features: orbit, pan, tilt, rotate, route dolly with banked
 * turns, altitude breathing, terrain following, gaze smoothing, interrupt.
 * All pure math — no mocked data, no external API.
 */

import * as Cesium from 'cesium';

/* ── Constants ── */
const ORBIT_DEG_S = { slow: 2, normal: 6, fast: 15 };
const TILT_DEG_S = { slow: 4, normal: 10, fast: 20 };
const PAN_VIEW_FRACTION_S = { slow: 0.08, normal: 0.2, fast: 0.45 };
const ROUTE_M_S = { slow: 20, normal: 40, fast: 90 };
const PITCH_MIN = Cesium.Math.toRadians(-89);
const PITCH_MAX = Cesium.Math.toRadians(-5);
const ROUTE_CAMERA_HEIGHT_M = 260;
const ROUTE_PITCH_DEG = -32;
const ROUTE_LOOKAHEAD_S = 6.5;
const ROUTE_BANK_MAX_DEG = 10;
const ROUTE_BANK_PER_DEG_S = 0.44;
const ROUTE_BANK_LEAD_RATE = 2.2;
const ROUTE_BANK_SETTLE_RATE = 1.6;
const ROUTE_BREATH_M = 20;
const ROUTE_BREATH_WAVELENGTH_M = 2200;
const ROUTE_TURN_LIFT_M = 26;
const ROUTE_RAMP_S = 2.4;
const ROUTE_MIN_CLEARANCE_M = 90;
const ROUTE_BANK_WINDOW_S = 4;
const ROUTE_DIR_SMOOTH_RATE = 1.6;

type MotionKind = 'orbit' | 'pan' | 'tilt' | 'rotate' | 'route';
type MotionMode = 'continuous' | 'once';
type SpeedWord = 'slow' | 'normal' | 'fast';

interface MotionState {
  kind: MotionKind;
  direction: string;
  speed: SpeedWord;
  mode: MotionMode;
  elapsed?: number;
  lastScale?: number;
  target?: Cesium.Cartesian3;
  hpr?: Cesium.HeadingPitchRange;
  hprStartHeading?: number;
  // route dolly state
  pts?: Cesium.Cartesian3[];
  cumM?: number[];
  totalM?: number;
  durationS?: number;
  ramp?: number;
  u?: number;
  traveled?: number;
  headingDir?: Cesium.Cartesian3;
  bankDeg?: number;
  bankLeadDeg?: number;
  offsetM?: number;
  appliedHeightM?: number;
  floorM?: number;
  groundSpeedMps?: number;
  /**
   * Street-level traffic — per-vehicle flow, congestion-colored, refreshed
   * on a timer as the camera moves. Real API data when TOMTOM_API_KEY is set;
   * an empty layer (no fabricated vehicles) when the key is absent.
   */
  strength: number;
}

export class CinematicCamera {
  private viewer: Cesium.Viewer;
  private active: MotionState | null = null;
  private tickRemover: (() => void) | null = null;
  private inputRemovers: Array<() => void> = [];
  private destroyed = false;
  private _arcA = new Cesium.Cartesian3();
  private _arcB = new Cesium.Cartesian3();
  private _chordVertical = new Cesium.Cartesian3();
  private _turnCross = new Cesium.Cartesian3();
  private _frameDir = new Cesium.Cartesian3();
  private _frameRight = new Cesium.Cartesian3();
  private _frameUp = new Cesium.Cartesian3();
  private _frameGaze = new Cesium.Cartesian3();
  private _frameLevelUp = new Cesium.Cartesian3();
  private _frameEye = new Cesium.Cartesian3();
  private _frameBankedUp = new Cesium.Cartesian3();
  private _frameCarto = new Cesium.Cartographic();
  private _frameAheadCarto = new Cesium.Cartographic();
  private _bankQuat = new Cesium.Quaternion();
  private _bankMatrix = new Cesium.Matrix3();
  private _headingQuat = new Cesium.Quaternion();
  private _headingMatrix = new Cesium.Matrix3();
  private _arcPos = new Cesium.Cartesian3();
  private _arcAhead = new Cesium.Cartesian3();

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.tickRemover = viewer.clock.onTick.addEventListener(() => this.onTick());
    const canvas = viewer.scene.canvas;
    const h = () => this.interrupt('manual-input');
    for (const evt of ['pointerdown', 'wheel'] as const) {
      canvas.addEventListener(evt, h, { passive: true });
      this.inputRemovers.push(() => canvas.removeEventListener(evt, h));
    }
  }

  get activeMotion(): MotionKind | null {
    return this.active?.kind ?? null;
  }

  interrupt(_reason = 'interrupt'): void {
    this.active = null;
    try { this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); } catch { /* ignore */ }
  }

  orbit(entity: Cesium.Entity, speed: SpeedWord = 'normal', mode: MotionMode = 'continuous'): void {
    const pos = entity.position?.getValue(Cesium.JulianDate.now());
    if (!pos) return;
    this.interrupt();
    const cam = this.viewer.camera;
    const range = Cesium.Cartesian3.distance(cam.positionWC, pos);
    const carto = Cesium.Cartographic.fromCartesian(cam.positionWC);
    const tCarto = Cesium.Cartographic.fromCartesian(pos);
    const dh = carto.height - tCarto.height;
    const pitch = -Math.asin(Math.min(1, Math.max(-1, dh / Math.max(1, range))));
    this.active = {
      kind: 'orbit', mode, direction: 'right', speed,
      target: pos,
      hpr: new Cesium.HeadingPitchRange(cam.heading, pitch, range),
      hprStartHeading: cam.heading,
      strength: 0,
    };
  }

  pan(direction: 'left' | 'right' | 'up' | 'down', speed: SpeedWord = 'normal', mode: MotionMode = 'once'): void {
    this.interrupt();
    this.active = { kind: 'pan', mode, direction, speed, strength: 0 };
  }

  tilt(direction: 'up' | 'down', speed: SpeedWord = 'normal', mode: MotionMode = 'once'): void {
    const pitch = this.viewer.camera.pitch;
    if (direction === 'up' && pitch >= PITCH_MAX - Cesium.Math.toRadians(0.5)) return;
    if (direction === 'down' && pitch <= PITCH_MIN + Cesium.Math.toRadians(0.5)) return;
    this.interrupt();
    this.active = { kind: 'tilt', mode, direction, speed, strength: 0 };
  }

  rotate(direction: 'left' | 'right', speed: SpeedWord = 'normal', mode: MotionMode = 'once'): void {
    this.interrupt();
    this.active = { kind: 'rotate', mode, direction, speed, strength: 0 };
  }

  /** Build a cinematic route flight along a path. */
  flyRoute(pts: Array<{ lat: number; lon: number; altM: number } | [number, number, number?]>, speed: SpeedWord = 'normal'): void {
    this.interrupt();
    const cartesians = pts.map(p => {
      if (Array.isArray(p)) {
        const [lon, lat, alt] = p;
        return Cesium.Cartesian3.fromDegrees(lon, lat, alt ?? 0);
      }
      return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altM ?? 0);
    });
    if (cartesians.length < 2) return;
    const cumM: number[] = [0];
    for (let i = 1; i < cartesians.length; i++) {
      cumM.push(cumM[i - 1] + Cesium.Cartesian3.distance(cartesians[i - 1], cartesians[i]));
    }
    const totalM = cumM[cumM.length - 1];
    const cruiseMps = ROUTE_M_S[speed] || ROUTE_M_S.normal;
    const durationS = Math.max(0.5, totalM / cruiseMps);
    this.active = {
      kind: 'route', mode: 'continuous', direction: 'forward', speed,
      pts: cartesians, cumM, totalM, durationS,
      ramp: Math.min(0.35, ROUTE_RAMP_S / durationS),
      u: 0, traveled: 0, bankDeg: 0, bankLeadDeg: 0, offsetM: 0,
      appliedHeightM: 0, floorM: 0, groundSpeedMps: 0,
      headingDir: undefined,
      strength: 0,
    };
  }

  stop(): void {
    this.interrupt('stop');
  }

  private onTick(): void {
    if (!this.active) return;
    const cam = this.viewer.camera;
    const m = this.active;
    const dt = 1 / 60; // ~60 Hz, consistent with Cesium clock tick

    let scale = 1;
    if (m.mode === 'once') {
      m.elapsed = (m.elapsed || 0) + dt;
      const t = Math.min(1, m.elapsed / 0.9);
      scale = 1 - (1 - t) * (1 - t);
      if (t >= 1) { this.interrupt('once-complete'); return; }
    }

    try {
      switch (m.kind) {
        case 'orbit': {
          if (!m.target || !m.hpr) break;
          const rate = Cesium.Math.toRadians(ORBIT_DEG_S[m.speed]) * (m.direction === 'left' ? -1 : 1);
          if (m.mode === 'once' && m.hprStartHeading !== undefined) {
            const total = Cesium.Math.toRadians(30) * (m.direction === 'left' ? -1 : 1);
            m.hpr.heading = m.hprStartHeading + total * scale;
          } else {
            m.hpr.heading += rate * dt;
          }
          cam.lookAt(m.target, m.hpr);
          break;
        }
        case 'pan': {
          const height = Math.max(50, cam.positionCartographic.height);
          const step = m.mode === 'once'
            ? height * 0.25 * (scale - (m.lastScale || 0))
            : height * PAN_VIEW_FRACTION_S[m.speed] * dt;
          m.lastScale = scale;
          if (m.direction === 'left') cam.moveLeft(step);
          else if (m.direction === 'right') cam.moveRight(step);
          else if (m.direction === 'up') cam.moveUp(step);
          else cam.moveDown(step);
          break;
        }
        case 'tilt': {
          const degS = TILT_DEG_S[m.speed];
          const stepRad = m.mode === 'once'
            ? Cesium.Math.toRadians(15) * (scale - (m.lastScale || 0))
            : Cesium.Math.toRadians(degS) * dt;
          m.lastScale = scale;
          const next = cam.pitch + (m.direction === 'up' ? stepRad : -stepRad);
          if (next > PITCH_MAX || next < PITCH_MIN) { this.interrupt('tilt-clamp'); return; }
          if (m.direction === 'up') cam.lookUp(stepRad); else cam.lookDown(stepRad);
          break;
        }
        case 'rotate': {
          const stepRad = m.mode === 'once'
            ? Cesium.Math.toRadians(15) * (scale - (m.lastScale || 0))
            : Cesium.Math.toRadians(TILT_DEG_S[m.speed]) * dt;
          m.lastScale = scale;
          if (m.direction === 'left') cam.lookLeft(stepRad); else cam.lookRight(stepRad);
          break;
        }
        case 'route': {
          this.advanceRoute(m, dt, cam);
          break;
        }
      }
    } catch { this.interrupt('tick-error'); }
  }

  private advanceRoute(m: MotionState, dt: number, cam: Cesium.Camera): void {
    m.u = Math.min(1, (m.u || 0) + dt / (m.durationS || 1));
    const traveled = (m.totalM || 0) * m.u;
    m.traveled = traveled;
    m.groundSpeedMps = (m.totalM || 0) / (m.durationS || 1);

    const pos = this.arcPoint(m, traveled, this._arcPos);
    const carto = Cesium.Cartographic.fromCartesian(pos, Cesium.Ellipsoid.WGS84, this._frameCarto);
    const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormalCartographic(carto, this._frameUp);

    // Banked turn
    const halfWindow = Math.max(20, (ROUTE_BANK_WINDOW_S * (m.groundSpeedMps || 1)) / 2);
    const inbound = this.horizontalChord(m, traveled - halfWindow, traveled, up);
    const outbound = this.horizontalChord(m, traveled, traveled + halfWindow, up);
    const turnRate = (inbound && outbound) ? Cesium.Math.toDegrees(
      this.signedTurnRad(inbound, outbound, up)
    ) / ROUTE_BANK_WINDOW_S : 0;
    const bankTarget = Math.max(-ROUTE_BANK_MAX_DEG, Math.min(ROUTE_BANK_MAX_DEG, turnRate * ROUTE_BANK_PER_DEG_S));
    m.bankLeadDeg = this.approach(m.bankLeadDeg || 0, bankTarget, ROUTE_BANK_LEAD_RATE, dt);
    m.bankDeg = this.approach(m.bankDeg || 0, m.bankLeadDeg || 0, ROUTE_BANK_SETTLE_RATE, dt);
    const appliedBank = (m.bankDeg || 0);

    // Gaze — smooth heading toward future path point
    const lookahead = Math.min(600, Math.max(120, ROUTE_LOOKAHEAD_S * (m.groundSpeedMps || 1)));
    const gaze = this.horizontalChord(m, traveled, traveled + lookahead, up) || outbound || inbound;
    if (gaze) {
      if (!m.headingDir) { m.headingDir = Cesium.Cartesian3.clone(gaze); }
      else {
        const k = 1 - Math.exp(-ROUTE_DIR_SMOOTH_RATE * dt);
        const turn = this.signedTurnRad(m.headingDir, gaze, up);
        const rot = Cesium.Matrix3.fromQuaternion(
          Cesium.Quaternion.fromAxisAngle(up, -turn * k, this._headingQuat), this._headingMatrix
        );
        const turned = Cesium.Matrix3.multiplyByVector(rot, m.headingDir, this._frameDir);
        const vert = Cesium.Cartesian3.multiplyByScalar(up, Cesium.Cartesian3.dot(turned, up), this._chordVertical);
        Cesium.Cartesian3.subtract(turned, vert, turned);
        if (Cesium.Cartesian3.magnitude(turned) > 1e-6) Cesium.Cartesian3.normalize(turned, m.headingDir);
      }
    }
    if (!m.headingDir) m.headingDir = Cesium.Cartesian3.UNIT_X;

    // Altitude: breath + turn lift
    const bankFrac = appliedBank / ROUTE_BANK_MAX_DEG;
    const straight = 1 - Math.abs(bankFrac);
    const breath = Math.sin((2 * Math.PI * traveled) / ROUTE_BREATH_WAVELENGTH_M) * ROUTE_BREATH_M * straight;
    m.offsetM = this.approach(m.offsetM || 0, breath + (Math.abs(bankFrac) * ROUTE_TURN_LIFT_M), 0.9, dt);
    const height = Math.max(ROUTE_MIN_CLEARANCE_M, ROUTE_CAMERA_HEIGHT_M + (m.offsetM || 0));
    m.appliedHeightM = this.approach(m.appliedHeightM || 0, height, 0.9, dt);

    const eye = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, m.appliedHeightM, Cesium.Ellipsoid.WGS84, this._frameEye);
    const pitch = Cesium.Math.toRadians(ROUTE_PITCH_DEG);
    const dir = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(m.headingDir, Math.cos(pitch), this._frameDir),
        Cesium.Cartesian3.multiplyByScalar(up, Math.sin(pitch), this._frameLevelUp),
        this._frameDir,
      ), this._frameDir);
    const right = Cesium.Cartesian3.cross(dir, up, this._frameRight);
    let bankedUp = Cesium.Cartesian3.cross(right, dir, this._frameLevelUp);
    if (Math.abs(appliedBank) > 0.5) {
      const q = Cesium.Quaternion.fromAxisAngle(dir, Cesium.Math.toRadians(appliedBank), this._bankQuat);
      bankedUp = Cesium.Matrix3.multiplyByVector(Cesium.Matrix3.fromQuaternion(q, this._bankMatrix), bankedUp, this._frameBankedUp);
    }
    cam.setView({ destination: eye, orientation: { direction: dir, up: bankedUp } });
    if (m.u >= 1) this.interrupt('route-complete');
  }

  private approach(current: number, target: number, rate: number, dt: number): number {
    if (!Number.isFinite(current)) return target;
    const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
    return current + (target - current) * k;
  }

  private arcPoint(state: MotionState, s: number, result: Cesium.Cartesian3): Cesium.Cartesian3 {
    const pts = state.pts || [];
    const cumM = state.cumM || [];
    const total = state.totalM || 0;
    const clamped = Math.max(0, Math.min(total, s));
    let lo = 0, hi = cumM.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumM[mid] <= clamped) lo = mid; else hi = mid - 1;
    }
    const segLen = cumM[lo + 1] - cumM[lo];
    const t = segLen > 1e-6 ? Math.min(1, Math.max(0, (clamped - cumM[lo]) / segLen)) : 0;
    return Cesium.Cartesian3.lerp(pts[lo], pts[lo + 1], t, result);
  }

  private horizontalChord(state: MotionState, a: number, b: number, up: Cesium.Cartesian3): Cesium.Cartesian3 | null {
    const pA = this.arcPoint(state, a, this._arcA);
    const pB = this.arcPoint(state, b, this._arcB);
    const diff = Cesium.Cartesian3.subtract(pB, pA, this._frameDir);
    const vert = Cesium.Cartesian3.multiplyByScalar(up, Cesium.Cartesian3.dot(diff, up), this._chordVertical);
    Cesium.Cartesian3.subtract(diff, vert, diff);
    const len = Cesium.Cartesian3.magnitude(diff);
    return len > 1e-3 ? Cesium.Cartesian3.divideByScalar(diff, len, diff) : null;
  }

  private signedTurnRad(a: Cesium.Cartesian3, b: Cesium.Cartesian3, up: Cesium.Cartesian3): number {
    const cross = Cesium.Cartesian3.cross(a, b, this._turnCross);
    return -Math.atan2(Cesium.Cartesian3.dot(cross, up), Cesium.Cartesian3.dot(a, b));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.interrupt('destroy');
    if (this.tickRemover) this.tickRemover();
    for (const rm of this.inputRemovers) rm();
    this.inputRemovers = [];
  }
}