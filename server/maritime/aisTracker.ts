import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';

export interface AisVessel {
  mmsi: number;
  lat: number;
  lon: number;
  cog: number;
  sog: number;
  heading: number;
  name: string;
  shipType: number;
  lastUpdate: number;
}

const STALE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VESSELS = 50000;

export class AisTracker {
  private vessels = new Map<number, AisVessel>();
  private socket: WebSocket | null = null;
  private connected = false;
  private shouldReconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private apiKey: string;

  private static readonly MAX_RECONNECT_ATTEMPTS = 20;
  private static readonly BASE_RECONNECT_MS = 2000;
  private static readonly MAX_RECONNECT_MS = 60_000;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  start(): void {
    if (this.shouldReconnect) return;
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.connect();
    this.cleanupTimer = setInterval(() => this.pruneStale(), 60_000);
    logger.info('[AIS] Tracker started');
  }

  stop(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.socket) {
      try { this.socket.close(); } catch { /* ignore */ }
      this.socket = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getVesselCount(): number {
    return this.vessels.size;
  }

  getAllVessels(): AisVessel[] {
    return [...this.vessels.values()];
  }

  getVesselsInBBox(latMin: number, latMax: number, lonMin: number, lonMax: number): AisVessel[] {
    return [...this.vessels.values()].filter(v =>
      v.lat >= latMin && v.lat <= latMax && v.lon >= lonMin && v.lon <= lonMax,
    );
  }

  getVesselsNearby(lat: number, lon: number, radiusKm: number): AisVessel[] {
    const degLat = radiusKm / 111;
    const degLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    return [...this.vessels.values()].filter(v =>
      Math.abs(v.lat - lat) <= degLat && Math.abs(v.lon - lon) <= degLon,
    );
  }

  private connect(): void {
    if (this.socket) return;
    try {
      this.socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    } catch (e) {
      logger.warn({ err: (e as Error).message }, '[AIS] WebSocket creation failed');
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      logger.info('[AIS] Connected to AISStream.io');
      try {
        this.socket!.send(JSON.stringify({
          APIKey: this.apiKey,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: ['PositionReport'],
        }));
      } catch (e) {
        logger.warn({ err: (e as Error).message }, '[AIS] Failed to send subscribe message');
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.MessageType === 'Error' || msg.error || msg.Error) return;
        if (msg.MessageType !== 'PositionReport' || !msg.Message?.PositionReport) return;
        const r = msg.Message.PositionReport;
        const lat = r.Latitude;
        const lon = r.Longitude;
        const mmsi = msg.MetaData?.MMSI;
        if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon) || !mmsi) return;

        const vessel: AisVessel = {
          mmsi,
          lat,
          lon,
          cog: r.Cog ?? 0,
          sog: r.Sog ?? 0,
          heading: r.TrueHeading ?? r.Cog ?? 0,
          name: msg.MetaData?.ShipName || '',
          shipType: msg.MetaData?.ShipType ?? 0,
          lastUpdate: Date.now(),
        };
        this.vessels.set(mmsi, vessel);

        if (this.vessels.size > MAX_VESSELS) {
          const oldest = [...this.vessels.entries()].sort((a, b) => a[1].lastUpdate - b[1].lastUpdate);
          for (let i = 0; i < 1000; i++) this.vessels.delete(oldest[i][0]);
        }

        pubsub.publish('maritime:position', vessel);
      } catch { /* skip parse errors */ }
    };

    this.socket.onerror = () => {
      this.connected = false;
      logger.warn('[AIS] WebSocket error');
    };

    this.socket.onclose = () => {
      this.connected = false;
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectAttempt >= AisTracker.MAX_RECONNECT_ATTEMPTS) {
      logger.error('[AIS] Giving up after repeated reconnection failures');
      return;
    }
    const delay = Math.min(
      AisTracker.MAX_RECONNECT_MS,
      AisTracker.BASE_RECONNECT_MS * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt++;
    logger.info({ attempt: this.reconnectAttempt, delayMs: delay }, '[AIS] Reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) this.connect();
    }, delay);
  }

  private pruneStale(): void {
    const now = Date.now();
    let pruned = 0;
    for (const [mmsi, v] of this.vessels) {
      if (now - v.lastUpdate > STALE_TIMEOUT_MS) {
        this.vessels.delete(mmsi);
        pruned++;
      }
    }
    if (pruned > 0) logger.debug({ pruned, remaining: this.vessels.size }, '[AIS] Pruned stale vessels');
  }
}

let trackerInstance: AisTracker | null = null;

export function getAisTracker(): AisTracker | null {
  return trackerInstance;
}

export function initAisTracker(): AisTracker | null {
  const apiKey = process.env.AIS_STREAM_API_KEY;
  if (!apiKey) {
    logger.warn('[AIS] AIS_STREAM_API_KEY not set — maritime tracking disabled');
    return null;
  }
  if (trackerInstance) return trackerInstance;
  trackerInstance = new AisTracker(apiKey);
  trackerInstance.start();
  return trackerInstance;
}

export function stopAisTracker(): void {
  if (trackerInstance) {
    trackerInstance.stop();
    trackerInstance = null;
  }
}
