import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoadsterAudioEngine, type RoadsterAudioTelemetry } from '@/rendering/roadsterAudio';

describe('RoadsterAudioEngine — Procedural Electric Hypercar & SpaceX Thruster Audio', () => {
  it('instantiates cleanly and reports initial status', () => {
    const audio = new RoadsterAudioEngine();
    expect(audio.status.started).toBe(false);
    expect(audio.muted).toBe(false);
  });

  it('toggles mute correctly', () => {
    const audio = new RoadsterAudioEngine();
    expect(audio.muted).toBe(false);
    const m1 = audio.toggleMute();
    expect(m1).toBe(true);
    expect(audio.muted).toBe(true);
    const m2 = audio.toggleMute();
    expect(m2).toBe(false);
    expect(audio.muted).toBe(false);
  });

  it('handles update safely when AudioContext is uninitialized or absent', () => {
    const audio = new RoadsterAudioEngine();
    const telemetry: RoadsterAudioTelemetry = {
      speedKmh: 120,
      throttle: 0.8,
      isFlying: false,
      isLudicrous: false,
      isBraking: false,
      copvPressurePsi: 10000,
      perspective: 'chase',
      targaOpen: false,
      onGround: true,
    };
    // Should execute safely without throwing errors
    expect(() => audio.update(telemetry)).not.toThrow();
  });

  it('safely stops and cleans up engine nodes', () => {
    const audio = new RoadsterAudioEngine();
    expect(() => audio.stop()).not.toThrow();
    expect(audio.status.started).toBe(false);
  });
});
