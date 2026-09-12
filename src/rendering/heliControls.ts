/**
 * Cockpit controls state machine (Pillar D).
 *
 * Sits between raw human input (keys / mouse widgets / future HOTAS) and the
 * pure `HelicopterInput` consumed by the flight model. Models the *physical*
 * channels of a real tactical helicopter:
 *
 *   COLLECTIVE  — position memory, friction lock, detents (full-down, hover,
 *                 max) with break-away force. Hover detent tracks density altitude.
 *   THROTTLE    — Ng demand lever behind the governor.
 *   ECL         — Engine Condition Lever: CUTOFF / IDLE / FLIGHT detents;
 *                 gates fuel (engine) and caps power at IDLE.
 *   STARTER     — momentary; needs battery + ECL ≥ IDLE + fuel + slow rotor.
 *   POWER BUS   — battery → generator chain; avionics master gates EIS displays.
 *
 * Pure TS, clock injected → fully unit-testable. Cyclic/pedals stay spring-
 * centred in the App (rate-limited sticks); this owns position-memory channels.
 */

export type EngineState = 'OFF' | 'STARTING' | 'RUNNING';
export type EclPos = 0 | 1 | 2;   // CUTOFF · IDLE · FLIGHT

export interface ControlRaw {
  collUp: boolean;
  collDown: boolean;
  collRateUp: number;
  collRateDown: number;
  throttleDelta: number;          // −1..1 (A/D held)
  starterHeld: boolean;
  onGround: boolean;
  nfPct: number;
  ngPct: number;
  fuelKg: number;
  altM: number;
  /** profile-aware hover collective (from the sim); defaults to the AH-64E curve */
  hoverColl?: number;
}

export type ControlEvent =
  | 'start' | 'start-denied-battery' | 'start-denied-ecl' | 'start-denied-fuel' | 'start-denied-speed'
  | 'lightoff' | 'run' | 'flameout-ecl' | 'flameout-fuel'
  | 'friction-on' | 'friction-off';

export interface ControlSnapshot {
  collective: number;
  collectiveLocked: boolean;
  throttle: number;
  ecl: EclPos;
  engineState: EngineState;
  battery: boolean;
  avionicsMaster: boolean;
  generatorOnline: boolean;
  starterEngaged: boolean;
  hoverDetent: number;
}

const LIGHTOFF_NF = 18;      // starter cuts out here (light-off)
const RUN_NF = 62;           // self-sustaining engine
export const IDLE_POWER_CAP = 0.32;
const DETENT_BAND = 0.014;   // magnet capture band
const DETENT_BREAK = 0.07;   // accumulated input needed to leave a detent

import { HOVER_COLLECTIVE, hoverCollectiveAt } from './helicopterSim';

export class HeliControls {
  collective = 0.55;
  collectiveLocked = false;
  throttle = 0;
  ecl: EclPos = 2;
  engineState: EngineState = 'RUNNING';
  battery = true;
  avionicsMaster = true;

  starterEngaged = false;
  generatorOnline = false;
  hoverDetent = HOVER_COLLECTIVE;

  private events: ControlEvent[] = [];
  private detentAcc = 0;
  private lightOff = false;
  private starterWasHeld = false;

  constructor(cold = false) {
    if (cold) {
      this.collective = 0; this.throttle = 0; this.ecl = 0;
      this.engineState = 'OFF'; this.battery = true; this.avionicsMaster = false;
    }
  }

  drainEvents(): ControlEvent[] {
    const e = this.events; this.events = []; return e;
  }
  private emit(e: ControlEvent) { this.events.push(e); }

  get snapshot(): ControlSnapshot {
    return {
      collective: this.collective,
      collectiveLocked: this.collectiveLocked,
      throttle: this.throttle,
      ecl: this.ecl,
      engineState: this.engineState,
      battery: this.battery,
      avionicsMaster: this.avionicsMaster,
      generatorOnline: this.generatorOnline,
      starterEngaged: this.starterEngaged,
      hoverDetent: this.hoverDetent,
    };
  }

  toggleFriction() {
    this.collectiveLocked = !this.collectiveLocked;
    this.emit(this.collectiveLocked ? 'friction-on' : 'friction-off');
  }

  cycleEcl() { this.setEcl(((this.ecl + 1) % 3) as EclPos); }

  setEcl(p: EclPos) {
    if (p === this.ecl) return;
    this.ecl = p;
    if (p === 0 && this.engineState !== 'OFF') {
      this.engineState = 'OFF'; this.lightOff = false;
      this.emit('flameout-ecl');
    }
  }

  setCollective(v: number) {
    if (this.collectiveLocked) return;
    this.collective = Math.max(0, Math.min(1, v));
  }

  setThrottle(v: number) { this.throttle = Math.max(0, Math.min(1, v)); }

  /**
   * Advance one frame; writes the command channels into `out` (the App's
   * HelicopterInput object) in place.
   */
  update(dt: number, raw: ControlRaw, out: {
    collective: number; pitch: number; roll: number; pedal: number; throttle: number; engine: boolean;
  }): void {
    dt = Math.max(0.0001, Math.min(dt, 0.05));
    const fuelOk = raw.fuelKg > 0.5;

    /* ── collective: rates, friction lock, detent magnets with break-away ── */
    this.hoverDetent = raw.hoverColl ?? hoverCollectiveAt(raw.altM);
    const dir = this.collectiveLocked ? 0 : (raw.collUp ? 1 : raw.collDown ? -1 : 0);
    if (dir !== 0) {
      const inDetent = this.hoverDetent !== undefined
        ? [0, this.hoverDetent, 1].find((d) => Math.abs(this.collective - d) < DETENT_BAND)
        : undefined;
      if (inDetent !== undefined && !(dir > 0 && inDetent >= 1) && !(dir < 0 && inDetent <= 0)) {
        this.detentAcc += dt * 0.9;
        if (this.detentAcc < DETENT_BREAK) {
          this.collective = inDetent;                        // magnet holds
        } else {
          this.detentAcc = 0;                                // broke away with a detent kick
          this.collective = Math.max(0, Math.min(1,
            this.collective + dir * (dir > 0 ? raw.collRateUp : raw.collRateDown) * dt * 4));
        }
      } else {
        this.detentAcc = 0;
        this.collective = Math.max(0, Math.min(1,
          this.collective + dir * (dir > 0 ? raw.collRateUp : raw.collRateDown) * dt));
      }
    }

    /* ── throttle lever (Ng demand) ── */
    if (raw.throttleDelta) {
      this.throttle = Math.max(0, Math.min(1, this.throttle + raw.throttleDelta * dt * 0.5));
    }
    const thrDelivered = this.ecl === 1
      ? Math.min(this.throttle, IDLE_POWER_CAP)
      : this.throttle;

    /* ── starter (momentary): cranks whenever held + interlocks clear; a press
       held through an interlock change engages without re-pressing ── */
    if (this.engineState === 'OFF' && raw.starterHeld) {
      const okBattery = this.battery;
      const okEcl = this.ecl >= 1;
      const okSpeed = raw.nfPct <= LIGHTOFF_NF + 8;
      if (okBattery && okEcl && fuelOk && okSpeed) {
        this.starterEngaged = true; this.engineState = 'STARTING'; this.emit('start');
      } else if (!this.starterWasHeld) {                     // denial reported once per press
        if (!okBattery) this.emit('start-denied-battery');
        else if (!okEcl) this.emit('start-denied-ecl');
        else if (!fuelOk) this.emit('start-denied-fuel');
        else this.emit('start-denied-speed');
      }
    }
    if (!raw.starterHeld) this.starterEngaged = false;      // momentary switch
    this.starterWasHeld = raw.starterHeld;

    if (this.engineState === 'STARTING') {
      if (raw.nfPct >= LIGHTOFF_NF && !this.lightOff) {
        this.lightOff = true; this.starterEngaged = false; this.emit('lightoff');
      }
      if (this.lightOff && raw.nfPct >= RUN_NF) { this.engineState = 'RUNNING'; this.emit('run'); }
      if (!this.battery || this.ecl === 0) { this.engineState = 'OFF'; this.lightOff = false; }
    } else if (this.engineState === 'RUNNING') {
      if (this.ecl === 0 || !this.battery) { this.engineState = 'OFF'; this.lightOff = false; }
    }
    if (this.engineState !== 'OFF' && !fuelOk) {
      this.engineState = 'OFF'; this.lightOff = false; this.emit('flameout-fuel');
    }
    this.generatorOnline = (this.engineState === 'RUNNING' ||
      (this.engineState === 'STARTING' && this.lightOff)) && raw.ngPct > 55;

    /* ── write the command channels ── */
    out.collective = this.collective;
    out.throttle = this.engineState === 'OFF' ? 0 : thrDelivered;
    // engine boolean = fuel+ignition gate: ECL open, battery feeds the igniters,
    // starter motoring or engine running. The sim's Ng/Nf dynamics do the rest.
    out.engine = this.ecl >= 1 && this.battery &&
      (this.engineState === 'RUNNING' || this.engineState === 'STARTING' || this.starterEngaged) && fuelOk;
  }
}
