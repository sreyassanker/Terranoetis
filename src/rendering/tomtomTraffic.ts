/**
 * TomTom Traffic Layer — street-level traffic flow with congestion coloring.
 *
 * Data is fetched through the server proxy (GET /api/tomtom/flow) which holds
 * TOMTOM_API_KEY in .env — no key ever reaches the browser. The proxy calls
 * the official TomTom Flow Segment Data API (service version 4):
 *   https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/{zoom}/json
 * When TOMTOM_API_KEY is unset the proxy returns 503 KEY_REQUIRED and this
 * layer stays empty (no fabricated data).
 */

import * as Cesium from 'cesium';
import { apiGet } from '@/lib/api';

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


export class TomTomTrafficLayer {
  private viewer: Cesium.Viewer;
  private entities: Cesium.Entity[] = [];
  private active = false;
  private abortController: AbortController | null = null;
  private readonly refreshIntervalMs = 120000; // 2 min
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  async start(): Promise<void> {
    if (this.destroyed || this.active) return;
    this.active = true;
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
    if (!this.active) return;
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
      points.map(async p => ({ point: p, resp: await this.fetchFlowSegment(p.lat, p.lon, signal) })),
    );

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const seg = r.value.resp?.flowSegmentData;
      if (!seg || seg.roadClosure) continue;
      const lat = r.value.point.lat;
      const lon = r.value.point.lon;
      // The TomTom payload's coordinates.coordinate is an array of points
      // describing the segment shape (verified against the live API). Anchor
      // the entity at the shape point closest to the requested sample point.
      const raw = seg.coordinates?.coordinate;
      const shape = Array.isArray(raw) ? raw : raw ? [raw] : [];
      let nearest = shape[0];
      if (shape.length > 1) {
        let bestDist = Infinity;
        for (const pt of shape) {
          if (!pt || !Number.isFinite(pt.latitude) || !Number.isFinite(pt.longitude)) continue;
          const dLat = pt.latitude - lat;
          const dLon = pt.longitude - lon;
          const dist = dLat * dLat + dLon * dLon;
          if (dist < bestDist) { bestDist = dist; nearest = pt; }
        }
      }
      if (!nearest || !Number.isFinite(nearest.latitude) || !Number.isFinite(nearest.longitude)) continue;
      const { latitude, longitude } = nearest;
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
            travelTime: seg.currentTravelTime,
            freeFlowTravelTime: seg.freeFlowTravelTime,
            roadClosure: seg.roadClosure,
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
    try {
      // Server proxy holds TOMTOM_API_KEY; AbortSignal passes through to it.
      const data = await apiGet<FlowResponse>(`/tomtom/flow?lat=${lat}&lon=${lon}&unit=kmph`, { signal });
      return data && data.flowSegmentData ? data : null;
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