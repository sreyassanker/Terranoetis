/**
 * Tesla Roadster Tri-Motor AWD & SpaceX Thruster Audio Engine
 *
 * Procedural Web Audio synthesis pipeline reproducing the authentic acoustic signature:
 *  1. Tri-Motor Stator & Inverter Whine:
 *     - Electromagnetic motor fundamental (triangle wave scaling with RPM / km/h)
 *     - SiC (Silicon Carbide) high-voltage inverter switching harmonic (resonant bandpass)
 *     - Acceleration torque surge & regenerative deceleration pitch sweeps
 *  2. SpaceX Cold-Gas Thrusters (10,000 PSI COPV Pneumatic Jets):
 *     - Dual-band noise burst for high-pressure air nozzle hiss and supersonic floor resonance
 *     - Sub-bass thrust recoil punch when firing
 *  3. Ludicrous+ Warp Pulse:
 *     - Deep cinematic 40-80 Hz sub-bass sweep on launch
 *  4. Dual On-Board Electric Compressors:
 *     - Mechanical compressor hum & pneumatic hiss while refilling COPV tanks on ground
 *  5. Tire Pavement Roll & Aerodynamic Wind Rush:
 *     - Asphalt tire contact noise (muted when airborne)
 *     - High-speed aerodynamic wind shear (amplified in Targa open-air convertible mode)
 *  6. Cockpit Acoustic Isolation:
 *     - Cabin soundproofing filter in coupe mode; wide-open bandwidth in convertible mode
 */

export interface RoadsterAudioTelemetry {
  speedKmh: number;
  throttle: number;         // -1 (brake/reverse) to +1 (forward)
  isFlying: boolean;
  isLudicrous: boolean;
  isBraking: boolean;
  copvPressurePsi: number;
  perspective: 'cockpit' | 'chase';
  targaOpen?: boolean;
  onGround?: boolean;
}

export class RoadsterAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private cockpitFilter: BiquadFilterNode | null = null;

  // Tri-Motor EV Powertrain
  private motorOsc: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private inverterOsc: OscillatorNode | null = null;
  private inverterFilter: BiquadFilterNode | null = null;
  private inverterGain: GainNode | null = null;
  private harmonicOsc: OscillatorNode | null = null;
  private harmonicGain: GainNode | null = null;

  // SpaceX Cold-Gas Thruster System
  private thrusterNoiseNode: AudioBufferSourceNode | null = null;
  private thrusterHighFilter: BiquadFilterNode | null = null;
  private thrusterLowFilter: BiquadFilterNode | null = null;
  private thrusterGain: GainNode | null = null;
  private thrusterSubOsc: OscillatorNode | null = null;
  private thrusterSubGain: GainNode | null = null;

  // Ludicrous+ Warp Tone
  private ludicrousOsc: OscillatorNode | null = null;
  private ludicrousGain: GainNode | null = null;

  // COPV Recharge Compressor
  private compressorOsc: OscillatorNode | null = null;
  private compressorGain: GainNode | null = null;

  // Environmental Road & Wind
  private envNoiseNode: AudioBufferSourceNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private started = false;
  muted = false;

  start(): boolean {
    if (this.started) return true;
    try {
      if (typeof window === 'undefined') return false;
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return false;

      const ctx = new AudioContextCtor();
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.0001;
      masterGain.connect(ctx.destination);

      // Cabin acoustic shielding filter (lowpass filter that softens high frequencies inside closed cockpit)
      const cockpitFilter = ctx.createBiquadFilter();
      cockpitFilter.type = 'lowpass';
      cockpitFilter.frequency.value = 20000;
      cockpitFilter.Q.value = 1.0;
      cockpitFilter.connect(masterGain);

      // ────────────────────────────────────────────────────────────────────────
      // 1. Tri-Motor Powertrain (Fundamental Stator + Inverter Switching Whine)
      // ────────────────────────────────────────────────────────────────────────
      const motorOsc = ctx.createOscillator();
      motorOsc.type = 'triangle';
      motorOsc.frequency.value = 60;
      const motorGain = ctx.createGain();
      motorGain.gain.value = 0.0001;
      motorOsc.connect(motorGain).connect(cockpitFilter);
      motorOsc.start();

      // High-Frequency Inverter Resonance (The signature futuristic Plaid / Roadster whine)
      const inverterOsc = ctx.createOscillator();
      inverterOsc.type = 'sine';
      inverterOsc.frequency.value = 240;
      const inverterFilter = ctx.createBiquadFilter();
      inverterFilter.type = 'bandpass';
      inverterFilter.frequency.value = 850;
      inverterFilter.Q.value = 6.0;
      const inverterGain = ctx.createGain();
      inverterGain.gain.value = 0.0001;
      inverterOsc.connect(inverterFilter).connect(inverterGain).connect(cockpitFilter);
      inverterOsc.start();

      // High-order harmonic overtone (jet turbine overtone)
      const harmonicOsc = ctx.createOscillator();
      harmonicOsc.type = 'sine';
      harmonicOsc.frequency.value = 720;
      const harmonicGain = ctx.createGain();
      harmonicGain.gain.value = 0.0001;
      harmonicOsc.connect(harmonicGain).connect(cockpitFilter);
      harmonicOsc.start();

      // ────────────────────────────────────────────────────────────────────────
      // 2. SpaceX Cold-Gas Thrusters (Compressed 10,000 PSI Air Burst)
      // ────────────────────────────────────────────────────────────────────────
      const noiseBuffer = this.generateNoiseBuffer(ctx, 2.5);
      const thrusterNoiseNode = ctx.createBufferSource();
      thrusterNoiseNode.buffer = noiseBuffer;
      thrusterNoiseNode.loop = true;

      // High-frequency pneumatic hiss (air nozzle expulsion)
      const thrusterHighFilter = ctx.createBiquadFilter();
      thrusterHighFilter.type = 'bandpass';
      thrusterHighFilter.frequency.value = 3200;
      thrusterHighFilter.Q.value = 3.5;

      // Low-frequency jet roar
      const thrusterLowFilter = ctx.createBiquadFilter();
      thrusterLowFilter.type = 'lowpass';
      thrusterLowFilter.frequency.value = 380;
      thrusterLowFilter.Q.value = 4.0;

      const thrusterGain = ctx.createGain();
      thrusterGain.gain.value = 0.0001;

      thrusterNoiseNode.connect(thrusterHighFilter).connect(thrusterGain);
      thrusterNoiseNode.connect(thrusterLowFilter).connect(thrusterGain);
      thrusterGain.connect(masterGain); // Thrusters bypass internal cockpit muffle for maximum immersion
      thrusterNoiseNode.start();

      // Sub-bass thrust recoil tone
      const thrusterSubOsc = ctx.createOscillator();
      thrusterSubOsc.type = 'sawtooth';
      thrusterSubOsc.frequency.value = 48;
      const thrusterSubGain = ctx.createGain();
      thrusterSubGain.gain.value = 0.0001;
      thrusterSubOsc.connect(thrusterSubGain).connect(masterGain);
      thrusterSubOsc.start();

      // ────────────────────────────────────────────────────────────────────────
      // 3. Ludicrous+ Hyperspace Warp / Sub-Bass Pulse
      // ────────────────────────────────────────────────────────────────────────
      const ludicrousOsc = ctx.createOscillator();
      ludicrousOsc.type = 'sine';
      ludicrousOsc.frequency.value = 52;
      const ludicrousGain = ctx.createGain();
      ludicrousGain.gain.value = 0.0001;
      ludicrousOsc.connect(ludicrousGain).connect(masterGain);
      ludicrousOsc.start();

      // ────────────────────────────────────────────────────────────────────────
      // 4. COPV Tank Air Compressor
      // ────────────────────────────────────────────────────────────────────────
      const compressorOsc = ctx.createOscillator();
      compressorOsc.type = 'square';
      compressorOsc.frequency.value = 115;
      const compressorGain = ctx.createGain();
      compressorGain.gain.value = 0.0001;
      compressorOsc.connect(compressorGain).connect(cockpitFilter);
      compressorOsc.start();

      // ────────────────────────────────────────────────────────────────────────
      // 5. Environmental Tire Roll & Aerodynamic Wind Noise
      // ────────────────────────────────────────────────────────────────────────
      const envNoiseNode = ctx.createBufferSource();
      envNoiseNode.buffer = noiseBuffer;
      envNoiseNode.loop = true;

      // Tire pavement roll
      const tireFilter = ctx.createBiquadFilter();
      tireFilter.type = 'lowpass';
      tireFilter.frequency.value = 85;
      tireFilter.Q.value = 2.0;
      const tireGain = ctx.createGain();
      tireGain.gain.value = 0.0001;
      envNoiseNode.connect(tireFilter).connect(tireGain).connect(cockpitFilter);

      // Wind shear
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'highpass';
      windFilter.frequency.value = 1200;
      windFilter.Q.value = 1.0;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.0001;
      envNoiseNode.connect(windFilter).connect(windGain).connect(cockpitFilter);
      envNoiseNode.start();

      this.ctx = ctx;
      this.masterGain = masterGain;
      this.cockpitFilter = cockpitFilter;
      this.motorOsc = motorOsc;
      this.motorGain = motorGain;
      this.inverterOsc = inverterOsc;
      this.inverterFilter = inverterFilter;
      this.inverterGain = inverterGain;
      this.harmonicOsc = harmonicOsc;
      this.harmonicGain = harmonicGain;
      this.thrusterNoiseNode = thrusterNoiseNode;
      this.thrusterHighFilter = thrusterHighFilter;
      this.thrusterLowFilter = thrusterLowFilter;
      this.thrusterGain = thrusterGain;
      this.thrusterSubOsc = thrusterSubOsc;
      this.thrusterSubGain = thrusterSubGain;
      this.ludicrousOsc = ludicrousOsc;
      this.ludicrousGain = ludicrousGain;
      this.compressorOsc = compressorOsc;
      this.compressorGain = compressorGain;
      this.envNoiseNode = envNoiseNode;
      this.tireFilter = tireFilter;
      this.tireGain = tireGain;
      this.windFilter = windFilter;
      this.windGain = windGain;

      this.started = true;
      void ctx.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  private generateNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.floor(sampleRate * seconds), sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      // Pink noise smoothing filter
      lastOut = lastOut * 0.95 + white * 0.05;
      data[i] = lastOut * 3.5;
    }
    return buffer;
  }

  update(telemetry: RoadsterAudioTelemetry): void {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const set = (param: AudioParam, value: number, timeConstant = 0.06) => {
      param.setTargetAtTime(Math.max(0.00001, value), t, timeConstant);
    };

    if (this.muted) {
      set(this.masterGain.gain, 0.00001, 0.05);
      return;
    }

    const speed = Math.max(0, telemetry.speedKmh);
    const speedRatio = Math.min(1.0, speed / 400); // 0 to 1 across 0-400 km/h
    const isCockpit = telemetry.perspective === 'cockpit';
    const isConvertible = !!telemetry.targaOpen;
    const onGround = telemetry.onGround !== false;

    // Master volume
    set(this.masterGain.gain, 0.85, 0.08);

    // ────────────────────────────────────────────────────────────────────────
    // Cockpit Acoustic Isolation Filter
    // In closed coupe cockpit: attenuate frequencies above 1,800 Hz for acoustic glass feel
    // In convertible open-air targa: open filter up to 20,000 Hz
    // ────────────────────────────────────────────────────────────────────────
    if (this.cockpitFilter) {
      const cutoff = isCockpit && !isConvertible ? 1800 : 20000;
      set(this.cockpitFilter.frequency, cutoff, 0.15);
    }

    // ────────────────────────────────────────────────────────────────────────
    // 1. Tri-Motor Electric Powertrain Audio
    // ────────────────────────────────────────────────────────────────────────
    // Motor fundamental frequency: 55 Hz (standby/idle) up to 2,600 Hz (at 400 km/h)
    const motorFreq = 55 + speedRatio * 2545;
    if (this.motorOsc) set(this.motorOsc.frequency, motorFreq, 0.08);

    // Inverter switching frequency (2.8x to 3.5x harmonic, giving signature spaceship shriek)
    const inverterFreq = 220 + speedRatio * 3200;
    if (this.inverterOsc) set(this.inverterOsc.frequency, inverterFreq, 0.08);
    if (this.inverterFilter) set(this.inverterFilter.frequency, 400 + speedRatio * 2800, 0.08);

    // Third harmonic overtone
    const harmonicFreq = 580 + speedRatio * 4400;
    if (this.harmonicOsc) set(this.harmonicOsc.frequency, harmonicFreq, 0.08);

    // Motor Volume Envelope:
    // Surges when accelerating (`throttle > 0`), hums quietly when cruising,
    // and produces regenerative braking deceleration pitch when throttle released.
    const isAccelerating = telemetry.throttle > 0.05;
    const isRegenBraking = speed > 5 && (telemetry.isBraking || telemetry.throttle <= -0.05);

    let motorVol = 0.02 + speedRatio * 0.14;
    let inverterVol = 0.015 + speedRatio * 0.18;
    let harmonicVol = speedRatio * 0.08;

    if (isAccelerating) {
      motorVol += 0.12 * Math.abs(telemetry.throttle);
      inverterVol += 0.22 * Math.abs(telemetry.throttle);
      harmonicVol += 0.10 * Math.abs(telemetry.throttle);
    } else if (isRegenBraking) {
      motorVol += 0.08;
      inverterVol += 0.14;
    }

    if (this.motorGain) set(this.motorGain.gain, motorVol, 0.05);
    if (this.inverterGain) set(this.inverterGain.gain, inverterVol, 0.05);
    if (this.harmonicGain) set(this.harmonicGain.gain, harmonicVol, 0.06);

    // ────────────────────────────────────────────────────────────────────────
    // 2. SpaceX Cold-Gas Thruster Blast (Pneumatic High-Pressure Jet)
    // ────────────────────────────────────────────────────────────────────────
    if (telemetry.isFlying) {
      // Powerful rocket nozzle air hiss and roar
      const thrusterVol = 0.42;
      if (this.thrusterGain) set(this.thrusterGain.gain, thrusterVol, 0.04);
      if (this.thrusterHighFilter) set(this.thrusterHighFilter.frequency, 3600, 0.06);
      if (this.thrusterLowFilter) set(this.thrusterLowFilter.frequency, 420, 0.06);
      if (this.thrusterSubGain) set(this.thrusterSubGain.gain, 0.22, 0.05);
      if (this.thrusterSubOsc) set(this.thrusterSubOsc.frequency, 54 + Math.sin(t * 12) * 6, 0.05);
    } else {
      if (this.thrusterGain) set(this.thrusterGain.gain, 0.00001, 0.12);
      if (this.thrusterSubGain) set(this.thrusterSubGain.gain, 0.00001, 0.12);
    }

    // ────────────────────────────────────────────────────────────────────────
    // 3. Ludicrous+ Warp Pulse
    // ────────────────────────────────────────────────────────────────────────
    if (telemetry.isLudicrous) {
      const ludicrousVol = isAccelerating ? 0.28 : 0.08;
      if (this.ludicrousGain) set(this.ludicrousGain.gain, ludicrousVol, 0.05);
      if (this.ludicrousOsc) set(this.ludicrousOsc.frequency, 45 + speedRatio * 85, 0.06);
    } else {
      if (this.ludicrousGain) set(this.ludicrousGain.gain, 0.00001, 0.15);
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. COPV Tank Recharge Compressors
    // ────────────────────────────────────────────────────────────────────────
    // Compressors fire when on ground and pressure is replenishing (< 9,900 PSI)
    const isCompressing = onGround && !telemetry.isFlying && telemetry.copvPressurePsi < 9900;
    if (this.compressorGain) {
      set(this.compressorGain.gain, isCompressing ? 0.045 : 0.00001, 0.15);
    }

    // ────────────────────────────────────────────────────────────────────────
    // 5. Tire Asphalt Contact & Aerodynamic Wind Noise
    // ────────────────────────────────────────────────────────────────────────
    if (this.tireGain) {
      // Tire rumble only exists when rolling on pavement (muted when flying)
      const tireVol = onGround ? Math.min(0.20, (speed / 180) * 0.20) : 0.00001;
      set(this.tireGain.gain, tireVol, 0.08);
    }

    if (this.windGain) {
      // Wind roar scales with square of velocity (drag law)
      const windMultiplier = isConvertible ? 1.9 : 1.0;
      const windVol = Math.min(0.35, Math.pow(speed / 320, 2) * 0.35) * windMultiplier;
      set(this.windGain.gain, windVol, 0.1);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(this.muted ? 0.00001 : 0.85, t, 0.05);
    }
    return this.muted;
  }

  stop(): void {
    try {
      this.motorOsc?.stop();
      this.inverterOsc?.stop();
      this.harmonicOsc?.stop();
      this.thrusterNoiseNode?.stop();
      this.thrusterSubOsc?.stop();
      this.ludicrousOsc?.stop();
      this.compressorOsc?.stop();
      this.envNoiseNode?.stop();
      this.ctx?.close();
    } catch {
      // already stopped or closing
    }
    this.ctx = null;
    this.masterGain = null;
    this.started = false;
  }

  get status() {
    return {
      started: this.started,
      state: this.ctx?.state ?? 'none',
      muted: this.muted,
    };
  }
}
