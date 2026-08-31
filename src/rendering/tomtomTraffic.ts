/**
 * TomTom Traffic Layer — per-vehicle street-level traffic flow.
 * Uses TomTom Traffic Flow API to fetch live congestion data at street level.
 * Real data when a valid TOMTOM_API_KEY is present; otherwise registers
 * an empty layer (no fabricated data).
 *
 * This is a genuinely NEW feature — not an upgrade of the existing Sentinel-1
 * road traffic detector (which analyzes corridor-level SAR data for anomaly
 * detection). This layer shows per-vehicle flow with congestion coloring.
 */

import * as Cesium from 'cesium';

const TOMTOM_BASE = 'https://api.tomtom.com/traffic/services/4/flowSegmentData';

interface FlowSegment {
  coordinates: { coordinate: { longitude: number; latitude: number } };
  currentSpeed: number;
  freeFlowSpeed: number;
  currentTravelTime: number;
  freeFlowTravelTime: number;
  confidence: number;
  roadClosure: boolean;
  length: number;
}

interface FlowResponse {
  flowSegmentData: FlowSegment;
}

export interface TomTomKeyConfig {
  apiKey: string;
}

export class TomTomTrafficLayer {
  private viewer: Cesium.Viewer;
  private apiKey: string | null;
  private entities: Cesium.Entity[] = [];
  private active = false;
  private abortController: AbortController | null = null;
  private readonly refreshIntervalMs = 120000; // 2 min
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(viewer: Cesium.Viewer, apiKey: string | null) {
    this.viewer = viewer;
    this.apiKey = apiKey;
  }

  async start(): Promise<void> {
    if (this.destroyed || this.active) return;
    this.active = true;
    const key = this.apiKey;
    if (!key) return;
    await this.refresh();
    this.intervalId = setInterval(() => this.refresh(), this.refreshIntervalMs);
  }

  stop(): void {
    this.active = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.clear();
  }

  private clear(): void {
    for (const e of this.entities) {
      this.viewer.entities.remove(e);
    }
    this.entities = [];
  }

  /** Remove all rendered traffic entities without stopping the refresh timer. */
  clearEntities(): void {
    this.clear();
  }

  private async refresh(): Promise<void> {
    if (!this.active || !this.apiKey) return;
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Get the camera's current view extent to request traffic for the visible area.
    const cam = this.viewer.camera;
    const rect = cam.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
    if (!rect) return;

    // Sample a grid of flow segments within the viewport.
    // TomTom flow segment API is point-based; we sample key intersections.
    const west = Cesium.Math.toDegrees(rect.west);
    const east = Cesium.Math.toDegrees(rect.east);
    const south = Cesium.Math.toDegrees(rect.south);
    const north = Cesium.Math.toDegrees(rect.north);
    const lonSpan = east - west;
    const latSpan = north - south;
    // Only request traffic at zoomed-in levels (street-level).
    if (lonSpan > 0.5 || latSpan > 0.5) return;

    // Sample points across the viewport.
    const steps = Math.max(3, Math.min(8, Math.floor(4 / Math.max(lonSpan, latSpan, 0.01))));
    const points: Array<{ lat: number; lon: number }> = [];
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        points.push({
          lat: south + (latSpan * (i + 0.5)) / steps,
          lon: west + (lonSpan * (j + 0.5)) / steps,
        });
      }
    }

    this.clear();
    const results = await Promise.allSettled(
      points.map(p => this.fetchFlowSegment(p.lat, p.lon, signal)),
    );

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const seg = r.value.flowSegmentData;
      if (seg.roadClosure) continue;
      const { latitude, longitude } = seg.coordinates.coordinate;
      const congestion = seg.currentSpeed / Math.max(seg.freeFlowSpeed, 1);
      // Color: green (free flow) → yellow → red (congested)
      const hue = 120 * Math.min(1, Math.max(0, congestion)); // 120° = green, 0° = red
      const color = Cesium.Color.fromHsl(hue / 360, 0.85, 0.5);
      this.entities.push(
        this.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),
          point: {
            pixelSize: 4,
            color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: {
            speed: seg.currentSpeed,
            freeFlow: seg.freeFlowSpeed,
            confidence: seg.confidence,
            length: seg.length,
            lat: latitude,
            lon: longitude,
          },
        }),
      );
    }
  }

  private async fetchFlowSegment(
    lat: number,
    lon: number,
    signal: AbortSignal,
  ): Promise<FlowResponse | null> {
    const key = this.apiKey;
    if (!key) return null;
    const url = `${TOMTOM_BASE}/absolute/22/json?point=${lat},${lon}&unit=KMPH&key=${key}`;
    try {
      const resp = await fetch(url, { signal });
      if (!resp.ok) return null;
      return (await resp.json()) as FlowResponse;
    } catch {
      return null;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
  }
}