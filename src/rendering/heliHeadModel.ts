/**
 * Pilot head model (Pillar B.5).
 *
 * Replaces the unconstrained free-look with a body-mounted head inside the
 * neck cone, spring-returning to a neutral scan posture, riding on
 * rotor-vibration micro-motion:
 *
 *   - yaw   ±40°, pitch +30° / −60° (real pilot head limits inside the AH-64)
 *   - spring back to neutral posture after 1.4 s of no look input (τ ≈ 1.6 s)
 *   - 1P imbalance + 4P blade-pass micro-jitter scaled with (Nf/100)², plus a
 *     tail-rotor tone; amplitudes are millimetres of eye offset
 *   - roll coupling: the head does NOT stay world-level — it follows the
 *     airframe roll through the seat (camRoll = rollDeg · ROLL_FOLLOW)
 *
 * Pure TS + injected clock → unit-testable.
 */

export interface HeadEnv {
  nfPct: number;        // rotor speed %
  engineOn: boolean;
  time: number;         // s, monotonic session clock
}

const TAU_RETURN = 1.6;      // s, spring time constant to neutral
const RETURN_DELAY = 1.4;    // s of no input before returning
/** Neutral flight scan posture: the pilot looks forward through the canopy
 *  with the horizon centered, slightly down (~4°) over the glareshield. */
export const NEUTRAL_PITCH = -0.07;
export const HEAD_LIMITS = {
  yawMax: 0.75, pitchUpMax: 0.55, pitchDownMax: 0.85,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class PilotHead {
  yaw = 0;              // rad, right +
  pitch = NEUTRAL_PITCH; // rad, up + (neutral scan posture)
  private vYaw = 0;
  private vPitch = 0;
  private lastLook = -99;
  /** eye offset jitter in body frame (right, nose, up), metres */
  jitter: [number, number, number] = [0, 0, 0];
  rollFollow = 0.9;     // fraction of airframe roll the head inherits

  /** pointer/wheel look input (rad deltas). */
  look(dYaw: number, dPitch: number, now: number) {
    this.yaw = clamp(this.yaw + dYaw, -HEAD_LIMITS.yawMax, HEAD_LIMITS.yawMax);
    this.pitch = clamp(this.pitch + dPitch, -HEAD_LIMITS.pitchDownMax, HEAD_LIMITS.pitchUpMax);
    this.lastLook = now;
  }

  reset() { this.yaw = 0; this.pitch = NEUTRAL_PITCH; this.vYaw = 0; this.vPitch = 0; }

  update(dt: number, now: number, env: HeadEnv): void {
    dt = clamp(Number.isFinite(dt) ? dt : 0.016, 0.001, 0.05);
    // spring-return to neutral scan posture when hands-off
    if (now - this.lastLook > RETURN_DELAY) {
      const w = 1 / TAU_RETURN;
      this.vYaw += (-w * 2 * this.yaw - 2 * 0.9 * w * this.vYaw) * dt * 4;   // ~critically damped
      this.vPitch += (-w * 2 * (this.pitch - NEUTRAL_PITCH) - 2 * 0.9 * w * this.vPitch) * dt * 4;
      this.yaw = clamp(this.yaw + this.vYaw * dt, -HEAD_LIMITS.yawMax, HEAD_LIMITS.yawMax);
      this.pitch = clamp(this.pitch + this.vPitch * dt, -HEAD_LIMITS.pitchDownMax, HEAD_LIMITS.pitchUpMax);
    } else {
      this.vYaw = 0; this.vPitch = 0;
    }
    // vibration: 1P imbalance (slow, larger), 4P blade-pass, TR tone
    const n = env.engineOn ? env.nfPct / 100 : 0;
    if (n > 0.02) {
      const amp = 0.0016 * n * n;                    // ~1.6 mm at full rpm
      const f1 = 4.48 * n, f4 = 17.9 * n, ft = 161 * n;
      const t = env.time;
      this.jitter = [
        amp * Math.sin(t * 2 * Math.PI * f1) + amp * 0.35 * Math.sin(t * 2 * Math.PI * f4 + 1.3),
        amp * 0.8 * Math.sin(t * 2 * Math.PI * f4 + 0.7) + amp * 0.15 * Math.sin(t * 2 * Math.PI * ft),
        amp * 1.2 * Math.cos(t * 2 * Math.PI * f1) + amp * 0.4 * Math.sin(t * 2 * Math.PI * f4),
      ];
    } else {
      this.jitter = [0, 0, 0];
    }
  }
}
