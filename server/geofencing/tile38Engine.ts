type GeofenceType = 'circle' | 'bbox' | 'polygon';

interface Geofence {
  id: string;
  type: GeofenceType;
  params: CircleParams | BboxParams | PolygonParams;
  webhook?: string;
  actions: GeofenceAction[];
  createdAt: number;
  lastFired: Record<string, number>;
}

interface CircleParams {
  lat: number;
  lon: number;
  meters: number;
}

interface BboxParams {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

interface PolygonParams {
  vertices: Array<{ lat: number; lon: number }>;
}

interface GeofenceAction {
  type: 'enter' | 'exit' | 'inside' | 'outside';
  cooldownMs: number;
}

interface TrackedObject {
  id: string;
  lat: number;
  lon: number;
  properties: Record<string, unknown>;
  updatedAt: number;
}

interface GeofenceEvent {
  fenceId: string;
  objectId: string;
  action: string;
  object: TrackedObject;
  timestamp: number;
}

type GeofenceCallback = (event: GeofenceEvent) => void;

const EARTH_RADIUS_M = 6371000;

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInCircle(lat: number, lon: number, circle: CircleParams): boolean {
  return haversine(lat, lon, circle.lat, circle.lon) <= circle.meters;
}

function pointInBbox(lat: number, lon: number, bbox: BboxParams): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
}

function pointInPolygon(lat: number, lon: number, polygon: PolygonParams): boolean {
  const verts = polygon.vertices;
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].lon, yi = verts[i].lat;
    const xj = verts[j].lon, yj = verts[j].lat;
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInFence(lat: number, lon: number, fence: Geofence): boolean {
  switch (fence.type) {
    case 'circle': return pointInCircle(lat, lon, fence.params as CircleParams);
    case 'bbox': return pointInBbox(lat, lon, fence.params as BboxParams);
    case 'polygon': return pointInPolygon(lat, lon, fence.params as PolygonParams);
    default: return false;
  }
}

export class Tile38Engine {
  private geofences: Map<string, Geofence> = new Map();
  private objects: Map<string, TrackedObject> = new Map();
  private prevInside: Map<string, Set<string>> = new Map();
  private callbacks: GeofenceCallback[] = [];
  private eventLog: GeofenceEvent[] = [];
  private maxEventLog = 1000;

  getStatus() {
    return {
      geofences: this.geofences.size,
      trackedObjects: this.objects.size,
      recentEvents: this.eventLog.length,
    };
  }

  onEvent(cb: GeofenceCallback): void {
    this.callbacks.push(cb);
  }

  // ── Geofence CRUD ──

  setGeofence(id: string, type: GeofenceType, params: CircleParams | BboxParams | PolygonParams, webhook?: string): Geofence {
    const fence: Geofence = {
      id, type, params,
      webhook,
      actions: [
        { type: 'enter', cooldownMs: 5000 },
        { type: 'exit', cooldownMs: 5000 },
        { type: 'inside', cooldownMs: 30000 },
        { type: 'outside', cooldownMs: 30000 },
      ],
      createdAt: Date.now(),
      lastFired: {},
    };
    this.geofences.set(id, fence);
    this.prevInside.set(id, new Set());
    return fence;
  }

  delGeofence(id: string): boolean {
    this.prevInside.delete(id);
    return this.geofences.delete(id);
  }

  getGeofences(): Geofence[] {
    return [...this.geofences.values()];
  }

  getGeofence(id: string): Geofence | undefined {
    return this.geofences.get(id);
  }

  // ── Object CRUD ──

  setObject(id: string, lat: number, lon: number, properties: Record<string, unknown> = {}): TrackedObject {
    const obj: TrackedObject = { id, lat, lon, properties, updatedAt: Date.now() };
    this.objects.set(id, obj);
    this.evaluateGeofences(obj);
    return obj;
  }

  delObject(id: string): boolean {
    const obj = this.objects.get(id);
    this.objects.delete(id);
    if (obj) {
      for (const [fenceId, inside] of this.prevInside) {
        if (inside.has(id)) {
          inside.delete(id);
          this.fireEvent({
            fenceId, objectId: id, action: 'exit',
            object: obj, timestamp: Date.now(),
          });
        }
      }
    }
    return !!obj;
  }

  getObjects(): TrackedObject[] {
    return [...this.objects.values()];
  }

  getObject(id: string): TrackedObject | undefined {
    return this.objects.get(id);
  }

  // ── Query ──

  nearby(lat: number, lon: number, radiusMeters: number): TrackedObject[] {
    const results: TrackedObject[] = [];
    for (const obj of this.objects.values()) {
      if (haversine(lat, lon, obj.lat, obj.lon) <= radiusMeters) {
        results.push(obj);
      }
    }
    return results.sort((a, b) =>
      haversine(lat, lon, a.lat, a.lon) - haversine(lat, lon, b.lat, b.lon)
    );
  }

  within(fenceId: string): TrackedObject[] {
    const fence = this.geofences.get(fenceId);
    if (!fence) return [];
    return [...this.objects.values()].filter(o => pointInFence(o.lat, o.lon, fence));
  }

  // ── Evaluation ──

  private evaluateGeofences(obj: TrackedObject): void {
    for (const [fenceId, fence] of this.geofences) {
      const wasInside = this.prevInside.get(fenceId)?.has(obj.id) || false;
      const isInside = pointInFence(obj.lat, obj.lon, fence);

      if (wasInside !== isInside) {
        const action = isInside ? 'enter' : 'exit';
        const key = `${fenceId}:${obj.id}:${action}`;
        const last = fence.lastFired[key] || 0;
        const cooldown = fence.actions.find(a => a.type === action)?.cooldownMs || 5000;

        if (Date.now() - last >= cooldown) {
          fence.lastFired[key] = Date.now();
          this.fireEvent({ fenceId, objectId: obj.id, action, object: obj, timestamp: Date.now() });
        }

        if (isInside) {
          if (!this.prevInside.has(fenceId)) this.prevInside.set(fenceId, new Set());
          this.prevInside.get(fenceId)!.add(obj.id);
        } else {
          this.prevInside.get(fenceId)?.delete(obj.id);
        }
      } else if (isInside) {
        const key = `${fenceId}:${obj.id}:inside`;
        const last = fence.lastFired[key] || 0;
        const cooldown = fence.actions.find(a => a.type === 'inside')?.cooldownMs || 30000;

        if (Date.now() - last >= cooldown) {
          fence.lastFired[key] = Date.now();
          this.fireEvent({ fenceId, objectId: obj.id, action: 'inside', object: obj, timestamp: Date.now() });
        }
      }
    }
  }

  private fireEvent(event: GeofenceEvent): void {
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxEventLog) this.eventLog.shift();

    for (const cb of this.callbacks) {
      try { cb(event); } catch { /* ignore */ }
    }

    const fence = this.geofences.get(event.fenceId);
    if (fence?.webhook) {
      this.callWebhook(fence.webhook, event).catch(() => { });
    }
  }

  private async callWebhook(url: string, event: GeofenceEvent): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* ignore */ }
  }

  getRecentEvents(count = 50): GeofenceEvent[] {
    return this.eventLog.slice(-count);
  }

  // ── Periodic sweep for stale objects ──

  startPeriodicSweep(intervalMs = 60000): void {
    setInterval(() => {
      const now = Date.now();
      const stale = [...this.objects.values()].filter(o => now - o.updatedAt > 3600000);
      for (const obj of stale) this.delObject(obj.id);
    }, intervalMs);
  }
}

export const tile38Engine = new Tile38Engine();
