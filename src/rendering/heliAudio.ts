/**
 * Cockpit/ambient rotor audio (Phase 6 polish).
 *
 * A small WebAudio graph whose tone IS the telemetry:
 *   - blade-pass "whump": 4P sawtooth (17.9 Hz × Nf) through a lowpass,
 *     amplitude from torque — the deep chop that speeds up with Nf.
 *   - transmission tone: 1P fundamental hum (4.5 Hz × Nf → sub octave mixed
 *     up two octaves so laptop speakers still render it).
 *   - VRS/low-Nf warble: slight detune when Nf < 90.
 *
 * Everything is guarded; absence of AudioContext degrades silently.
 */

interface AudioEnv {
  nfPct: number; ngPct: number; torquePct: number; throttle: number;
  engineOn: boolean; vrs: boolean; cockpit: boolean;
}

export class HeliAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private whumpOsc: OscillatorNode | null = null;
  private whumpGain: GainNode | null = null;
  private whumpFilter: BiquadFilterNode | null = null;
  private humOsc: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private started = false;
  muted = false;

  start(): boolean {
    if (this.started) return true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);

      const whumpOsc = ctx.createOscillator();
      whumpOsc.type = 'sawtooth';
      const whumpFilter = ctx.createBiquadFilter();
      whumpFilter.type = 'lowpass'; whumpFilter.frequency.value = 140; whumpFilter.Q.value = 6;
      const whumpGain = ctx.createGain(); whumpGain.gain.value = 0.0001;
      whumpOsc.connect(whumpFilter).connect(whumpGain).connect(master);
      whumpOsc.start();

      const humOsc = ctx.createOscillator();
      humOsc.type = 'triangle';
      const humGain = ctx.createGain(); humGain.gain.value = 0.0001;
      humOsc.connect(humGain).connect(master);
      humOsc.start();

      this.ctx = ctx; this.master = master;
      this.whumpOsc = whumpOsc; this.whumpGain = whumpGain; this.whumpFilter = whumpFilter;
      this.humOsc = humOsc; this.humGain = humGain;
      this.started = true;
      void ctx.resume().catch(() => { /* autoplay policy */ });
      return true;
    } catch { return false; }
  }

  update(env: AudioEnv) {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return void this.muted;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => {
      p.setTargetAtTime(Math.max(0.00005, v), t, 0.08);
    };
    const nf = Math.max(0, env.nfPct) / 100;
    const muffle = env.cockpit ? 0.42 : 1;
    const masterV = this.muted || !this.started ? 0 : (env.engineOn ? 0.9 : 0.12) * muffle;
    set(this.master.gain, masterV);
    if (this.whumpOsc) this.whumpOsc.frequency.setTargetAtTime(17.9 * nf + 4, t, 0.1);
    if (this.whumpGain) set(this.whumpGain.gain, env.engineOn ? 0.02 + (env.torquePct / 100) * 0.22 : 0.0);
    if (this.whumpFilter) this.whumpFilter.frequency.setTargetAtTime(90 + 120 * nf, t, 0.15);
    if (this.humOsc) this.humOsc.frequency.setTargetAtTime(4.5 * Math.max(0.3, nf) * 16 * (env.vrs ? 0.94 : 1) + (env.vrs ? Math.sin(t * 9) * 6 : 0), t, 0.12);
    if (this.humGain) set(this.humGain.gain, nf > 0.05 ? 0.05 * nf * nf + (env.vrs ? 0.06 : 0) : 0);
  }

  toggleMute(): boolean { this.muted = !this.muted; return this.muted; }

  stop() {
    try {
      this.whumpOsc?.stop(); this.humOsc?.stop();
      this.ctx?.close();
    } catch { /* already down */ }
    this.ctx = null; this.master = null; this.started = false;
  }

  get status() {
    return { started: this.started, state: this.ctx?.state ?? 'none', muted: this.muted };
  }
}
