/**
 * MissionRecorder
 * Captures military entity state snapshots at configurable intervals.
 * Each snapshot records every tracked entity's position, properties, and
 * metadata so the timeline can be replayed later via CZML playback.
 */

export interface EntitySnapshot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  heading?: number;
  speed?: number;
  color?: string;
  label?: string;
  category: string;        // 'bft' | 'cop' | 'targeting' | 'tewa' | etc.
  affiliation?: string;    // 'friend' | 'hostile' | 'neutral' | 'unknown'
  severity?: string;
  properties: Record<string, unknown>;
}

export interface MissionSnapshot {
  timestamp: number;       // Date.now() when captured
  clock: number;           // simulated time from the slider
  entities: EntitySnapshot[];
  alerts: AlertSnapshot[];
  metadata: MissionMetadata;
}

export interface AlertSnapshot {
  id: string;
  severity: string;
  sourceModule: string;
  description: string;
  timestamp: number;
}

export interface MissionMetadata {
  theater?: string;
  startTime: number;
  endTime?: number;
  entityCount: number;
  categoryCounts: Record<string, number>;
}

export interface RecorderOptions {
  /** Interval in ms between snapshots (default: 5000) */
  captureInterval?: number;
  /** Max snapshots to keep in memory (default: 2000) */
  maxSnapshots?: number;
  /** Callback invoked on each new snapshot */
  onSnapshot?: (snapshot: MissionSnapshot) => void;
}

export class MissionRecorder {
  private snapshots: MissionSnapshot[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startTime: number = 0;
  private options: Required<RecorderOptions>;
  private isRecording = false;
  private captureFn: () => { entities: EntitySnapshot[]; alerts: AlertSnapshot[] } = () => ({ entities: [], alerts: [] });

  constructor(options: RecorderOptions = {}) {
    this.options = {
      captureInterval: options.captureInterval ?? 5000,
      maxSnapshots: options.maxSnapshots ?? 2000,
      onSnapshot: options.onSnapshot ?? (() => {}),
    };
  }

  /** Register the function that provides entity data each tick */
  setCaptureSource(fn: () => { entities: EntitySnapshot[]; alerts: AlertSnapshot[] }): void {
    this.captureFn = fn;
  }

  /** Start recording at the given simulated clock time */
  startRecording(simulatedTime: number = Date.now()): void {
    if (this.isRecording) return;
    this.isRecording = true;
    this.startTime = Date.now();
    this.snapshots = [];

    // Capture immediately on start
    this.captureTick(simulatedTime);

    this.intervalId = setInterval(() => {
      this.captureTick(simulatedTime + (Date.now() - this.startTime));
    }, this.options.captureInterval);
  }

  /** Stop recording */
  stopRecording(): MissionSnapshot[] {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRecording = false;
    if (this.snapshots.length > 0) {
      this.snapshots[this.snapshots.length - 1].metadata.endTime = Date.now();
    }
    return [...this.snapshots];
  }

  /** Check if currently recording */
  getRecording(): boolean {
    return this.isRecording;
  }

  /** Get all recorded snapshots */
  getSnapshots(): MissionSnapshot[] {
    return [...this.snapshots];
  }

  /** Get the time range of recorded data */
  getTimeRange(): { start: number; end: number; duration: number } {
    if (this.snapshots.length === 0) {
      return { start: 0, end: 0, duration: 0 };
    }
    const start = this.snapshots[0].timestamp;
    const end = this.snapshots[this.snapshots.length - 1].timestamp;
    return { start, end, duration: end - start };
  }

  /** Find the snapshot closest to a given timestamp */
  findNearest(timestamp: number): MissionSnapshot | null {
    if (this.snapshots.length === 0) return null;
    let best = this.snapshots[0];
    let bestDist = Math.abs(best.timestamp - timestamp);
    for (const snap of this.snapshots) {
      const dist = Math.abs(snap.timestamp - timestamp);
      if (dist < bestDist) {
        best = snap;
        bestDist = dist;
      }
    }
    return best;
  }

  /** Interpolate between two snapshots for smooth playback */
  interpolate(snapA: MissionSnapshot, snapB: MissionSnapshot, t: number): MissionSnapshot {
    const entityMap = new Map<string, EntitySnapshot>();
    for (const e of snapA.entities) entityMap.set(e.id, { ...e });

    for (const b of snapB.entities) {
      const a = entityMap.get(b.id);
      if (a) {
        a.lat = a.lat + (b.lat - a.lat) * t;
        a.lon = a.lon + (b.lon - a.lon) * t;
        a.alt = a.alt + (b.alt - a.alt) * t;
        if (b.heading != null && a.heading != null) {
          a.heading = a.heading + (b.heading - a.heading) * t;
        }
        if (b.speed != null && a.speed != null) {
          a.speed = a.speed + (b.speed - a.speed) * t;
        }
        entityMap.set(b.id, a);
      } else {
        entityMap.set(b.id, { ...b });
      }
    }

    return {
      timestamp: snapA.timestamp + (snapB.timestamp - snapA.timestamp) * t,
      clock: snapA.clock + (snapB.clock - snapA.clock) * t,
      entities: Array.from(entityMap.values()),
      alerts: snapA.alerts, // keep source alerts
      metadata: snapA.metadata,
    };
  }

  /** Export snapshots as JSON */
  toJSON(): string {
    return JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      snapshots: this.snapshots,
    });
  }

  /** Import snapshots from JSON */
  fromJSON(json: string): boolean {
    try {
      const data = JSON.parse(json);
      if (data.version === 1 && Array.isArray(data.snapshots)) {
        this.snapshots = data.snapshots;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Clear all recorded data */
  reset(): void {
    this.stopRecording();
    this.snapshots = [];
  }

  private captureTick(simulatedTime: number): void {
    const { entities, alerts } = this.captureFn();
    const categoryCounts: Record<string, number> = {};
    for (const e of entities) {
      categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
    }

    const snapshot: MissionSnapshot = {
      timestamp: Date.now(),
      clock: simulatedTime,
      entities,
      alerts,
      metadata: {
        startTime: this.startTime,
        entityCount: entities.length,
        categoryCounts,
      },
    };

    this.snapshots.push(snapshot);

    // Evict oldest if over limit
    if (this.snapshots.length > this.options.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.options.maxSnapshots);
    }

    this.options.onSnapshot(snapshot);
  }
}
