/**
 * MissionPlayer
 * Manages CZML playback on the Cesium viewer during mission replay.
 * Loads CZML data, controls playback timeline, and provides seeking,
 * speed control, and entity tracking during replay.
 */

import * as Cesium from 'cesium';
import type { MissionSnapshot, EntitySnapshot } from './recorder';
import { snapshotsToSimpleCzml } from './czmlWriter';

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;     // timestamp ms
  duration: number;        // total ms
  progress: number;        // 0-1
  speed: number;           // multiplier (1, 2, 4, 8, 0.5)
  entityCount: number;
  currentSnapshotIndex: number;
  totalSnapshots: number;
}

export type PlaybackStateCallback = (state: PlaybackState) => void;

export class MissionPlayer {
  private viewer: Cesium.Viewer;
  private czmlDataSource: Cesium.CzmlDataSource | null = null;
  private snapshots: MissionSnapshot[] = [];
  private isPlaying = false;
  private speed = 1;
  private currentIdx = 0;
  private startTime = 0;
  private endTime = 0;
  private duration = 0;
  private playbackInterval: ReturnType<typeof setInterval> | null = null;
  private stateCallback: PlaybackStateCallback | null = null;

  // Entity tracking overlay (shows current snapshot entities as Cesium entities)
  private overlayEntities = new Map<string, Cesium.Entity>();

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  /** Register callback for playback state changes */
  onStateChange(callback: PlaybackStateCallback): void {
    this.stateCallback = callback;
  }

  /** Load mission snapshots for playback */
  loadSnapshots(snapshots: MissionSnapshot[]): void {
    this.stop();
    this.snapshots = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);

    if (this.snapshots.length > 0) {
      this.startTime = this.snapshots[0].timestamp;
      this.endTime = this.snapshots[this.snapshots.length - 1].timestamp;
      this.duration = this.endTime - this.startTime;
    }
    this.currentIdx = 0;
    this.notifyState();
  }

  /** Load CZML data into the viewer */
  async loadCzml(snapshots: MissionSnapshot[]): Promise<void> {
    // Remove existing CZML if any
    if (this.czmlDataSource) {
      this.viewer.dataSources.remove(this.czmlDataSource);
      this.czmlDataSource = null;
    }

    if (snapshots.length === 0) return;

    // Generate CZML from snapshots
    const czml = snapshotsToSimpleCzml(snapshots);

    // Create and load the CZML data source
    this.czmlDataSource = await Cesium.CzmlDataSource.load(czml);
    this.viewer.dataSources.add(this.czmlDataSource);

    // Configure the viewer clock for CZML playback
    const clock = this.viewer.clock;
    clock.startTime = Cesium.JulianDate.fromDate(new Date(this.startTime));
    clock.stopTime = Cesium.JulianDate.fromDate(new Date(this.endTime));
    clock.currentTime = Cesium.JulianDate.fromDate(new Date(this.startTime));
    clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    clock.multiplier = this.speed;
    clock.shouldAnimate = false; // don't auto-play
  }

  /** Start playback from current position */
  play(): void {
    if (this.isPlaying || this.snapshots.length === 0) return;
    this.isPlaying = true;

    // Also start the Cesium clock animation
    this.viewer.clock.shouldAnimate = true;
    this.viewer.clock.multiplier = this.speed;

    this.playbackInterval = setInterval(() => {
      if (!this.isPlaying) return;

      // Advance current index based on speed
      const stepMs = 5000; // base step = snapshot interval
      const advanceMs = stepMs * this.speed;

      const nextTimestamp = this.snapshots[this.currentIdx]?.timestamp + advanceMs;
      if (nextTimestamp && nextTimestamp <= this.endTime) {
        // Find the next snapshot
        while (this.currentIdx < this.snapshots.length - 1 &&
               this.snapshots[this.currentIdx].timestamp < nextTimestamp) {
          this.currentIdx++;
        }
        this.renderSnapshot(this.snapshots[this.currentIdx]);
        this.notifyState();
      } else {
        // Reached end — loop back
        this.currentIdx = 0;
        this.renderSnapshot(this.snapshots[0]);
        this.notifyState();
      }
    }, 100); // tick every 100ms for smooth updates
  }

  /** Pause playback */
  pause(): void {
    this.isPlaying = false;
    this.viewer.clock.shouldAnimate = false;
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
    this.notifyState();
  }

  /** Stop playback and clear overlay */
  stop(): void {
    this.pause();
    this.currentIdx = 0;
    this.clearOverlay();
    this.notifyState();
  }

  /** Seek to a specific time (ms timestamp) */
  seekTo(timestamp: number): void {
    if (this.snapshots.length === 0) return;

    // Find closest snapshot
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.snapshots.length; i++) {
      const dist = Math.abs(this.snapshots[i].timestamp - timestamp);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    this.currentIdx = bestIdx;
    this.renderSnapshot(this.snapshots[bestIdx]);

    // Update Cesium clock position
    this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(timestamp));

    this.notifyState();
  }

  /** Seek to a progress percentage (0-1) */
  seekToProgress(progress: number): void {
    const targetTime = this.startTime + this.duration * Math.max(0, Math.min(1, progress));
    this.seekTo(targetTime);
  }

  /** Set playback speed multiplier */
  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(32, speed));
    this.viewer.clock.multiplier = this.speed;
    this.notifyState();
  }

  /** Get current playback state */
  getState(): PlaybackState {
    const currentTime = this.snapshots[this.currentIdx]?.timestamp ?? this.startTime;
    return {
      isPlaying: this.isPlaying,
      currentTime,
      duration: this.duration,
      progress: this.duration > 0 ? (currentTime - this.startTime) / this.duration : 0,
      speed: this.speed,
      entityCount: this.snapshots[this.currentIdx]?.entities.length ?? 0,
      currentSnapshotIndex: this.currentIdx,
      totalSnapshots: this.snapshots.length,
    };
  }

  /** Get the snapshot at a given time */
  getSnapshotAt(timestamp: number): MissionSnapshot | null {
    if (this.snapshots.length === 0) return null;
    let best = this.snapshots[0];
    let bestDist = Infinity;
    for (const snap of this.snapshots) {
      const dist = Math.abs(snap.timestamp - timestamp);
      if (dist < bestDist) {
        best = snap;
        bestDist = dist;
      }
    }
    return best;
  }

  /** Clean up */
  destroy(): void {
    this.stop();
    if (this.czmlDataSource) {
      this.viewer.dataSources.remove(this.czmlDataSource);
      this.czmlDataSource = null;
    }
    this.clearOverlay();
  }

  // ── Private Methods ──

  private renderSnapshot(snapshot: MissionSnapshot): void {
    // Clear previous overlay
    this.clearOverlay();

    // Render entities as Cesium entities
    for (const ent of snapshot.entities) {
      const pos = Cesium.Cartesian3.fromDegrees(Number(ent.lon), Number(ent.lat), Number(ent.alt));
      const color = this.getEntityColor(ent);

      const entity = this.viewer.entities.add({
        id: `replay_${ent.id}`,
        position: pos,
        name: ent.name,
        point: {
          pixelSize: ent.category === 'bft' ? 10 : 8,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: ent.label || ent.name,
          font: '9px monospace',
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, 14),
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          showBackground: true,
          backgroundColor: Cesium.Color.fromBytes(0, 0, 0, 128),
        },
        properties: {
          layer: 'replay',
          category: ent.category,
          affiliation: ent.affiliation,
          snapshotTime: snapshot.timestamp,
        },
      });

      this.overlayEntities.set(ent.id, entity);
    }

    // Force a render
    this.viewer.scene.requestRender();
  }

  private clearOverlay(): void {
    for (const entity of this.overlayEntities.values()) {
      this.viewer.entities.remove(entity);
    }
    this.overlayEntities.clear();
  }

  private getEntityColor(ent: EntitySnapshot): string {
    if (ent.affiliation === 'friend') return '#3b82f6';
    if (ent.affiliation === 'hostile') return '#ef4444';
    if (ent.affiliation === 'neutral') return '#eab308';

    const catColors: Record<string, string> = {
      bft: '#3b82f6', cop: '#22c55e', targeting: '#ef4444',
      tewa: '#f97316', airDefense: '#dc2626', missionPlanning: '#8b5cf6',
      dataLinks: '#8b5cf6', ew: '#f59e0b', isr: '#06b6d4',
      maritime: '#0ea5e9', geoint: '#a855f7', nuclear: '#eab308',
      cde: '#ef4444', cyber: '#10b981', fp: '#f59e0b',
      wargaming: '#a855f7', aar: '#94a3b8', hadr: '#eab308',
      orbat: '#fbbf24',
    };
    return catColors[ent.category] || '#94a3b8';
  }

  private notifyState(): void {
    if (this.stateCallback) {
      this.stateCallback(this.getState());
    }
  }
}
