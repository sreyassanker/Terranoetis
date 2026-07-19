import * as Cesium from 'cesium';

export interface AisVesselState {
  mmsi: number;
  lon: number;
  lat: number;
  cog: number;
  sog: number;
  heading: number;
  name: string;
  shipType: number;
  lastUpdate: number;
}

const SHIP_ICON_CACHE = new Map<string, HTMLCanvasElement>();
const SHIP_ICON_CACHE_MAX = 500;
const STALE_TIMEOUT_MS = 30 * 60 * 1000;

function getShipIcon(heading: number): HTMLCanvasElement {
  if (SHIP_ICON_CACHE.size > SHIP_ICON_CACHE_MAX) SHIP_ICON_CACHE.clear();
  const rounded = Math.round(heading / 5) * 5;
  const key = `${rounded}`;
  const cached = SHIP_ICON_CACHE.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 28;
  canvas.height = 28;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.translate(14, 14);
  ctx.rotate((rounded * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(-5, 5);
  ctx.lineTo(-3, 8);
  ctx.lineTo(0, 5);
  ctx.lineTo(3, 8);
  ctx.lineTo(5, 5);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  SHIP_ICON_CACHE.set(key, canvas);
  return canvas;
}

export class AisVesselTracker {
  private vessels = new Map<number, AisVesselState>();
  private entities = new Map<number, Cesium.Entity>();
  private viewer: Cesium.Viewer;
  private socket: WebSocket | null = null;
  private removeTick: (() => void) | null = null;
  private lastTickTime = Date.now();
  private apiKey: string;
  private connected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private onStatus: ((msg: string, type: 'success' | 'error' | 'info') => void) | null = null;
  private hasReceivedData = false;

  getVesselsSnapshot(): AisVesselState[] {
    return [...this.vessels.values()];
  }

  private static readonly MAX_RECONNECT_ATTEMPTS = 10;
  private static readonly BASE_RECONNECT_MS = 1000;
  private static readonly MAX_RECONNECT_MS = 60_000;

  constructor(viewer: Cesium.Viewer, apiKey: string) {
    this.viewer = viewer;
    this.apiKey = apiKey;
  }

  setStatusHandler(fn: (msg: string, type: 'success' | 'error' | 'info') => void) {
    this.onStatus = fn;
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectAttempt >= AisVesselTracker.MAX_RECONNECT_ATTEMPTS) {
      this.onStatus?.('AISStream: giving up after repeated failures', 'error');
      return;
    }
    const delay = Math.min(
      AisVesselTracker.MAX_RECONNECT_MS,
      AisVesselTracker.BASE_RECONNECT_MS * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) this.connect();
    }, delay);
  }

  private connect() {
    if (this.socket) return;
    this.hasReceivedData = false;
    try {
      this.socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    } catch (e) {
      this.onStatus?.(`AISStream connection error: ${(e as Error).message}`, 'error');
      this.scheduleReconnect();
      return;
    }
    this.socket.onopen = () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      this.socket!.send(JSON.stringify({
        APIKey: this.apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport'],
      }));
    };
    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.MessageType === 'Error' || msg.error || msg.Error) {
          this.onStatus?.(`AISStream error: ${msg.message || msg.error || JSON.stringify(msg)}`, 'error');
          return;
        }
        if (msg.MessageType !== 'PositionReport' || !msg.Message?.PositionReport) return;
        const r = msg.Message.PositionReport;
        const lat = r.Latitude;
        const lon = r.Longitude;
        const mmsi = msg.MetaData?.MMSI;
        if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon) || !mmsi) return;
        if (!this.hasReceivedData) {
          this.hasReceivedData = true;
          this.onStatus?.('Live AIS stream active', 'success');
        }
        this.vessels.set(mmsi, {
          mmsi,
          lon,
          lat,
          cog: r.Cog ?? 0,
          sog: r.Sog ?? 0,
          heading: r.TrueHeading ?? r.Cog ?? 0,
          name: msg.MetaData?.ShipName || '',
          shipType: msg.MetaData?.ShipType ?? 0,
          lastUpdate: Date.now(),
        });
      } catch { /* skip parse errors */ }
    };
    this.socket.onerror = () => {
      this.connected = false;
      this.onStatus?.('AISStream WebSocket error — connection failed', 'error');
    };
    this.socket.onclose = () => {
      this.connected = false;
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  start() {
    if (this.removeTick) return;
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.connect();
    this.lastTickTime = Date.now();
    this.removeTick = this.viewer.clock.onTick.addEventListener(() => this.tick());
  }

  stop() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.removeTick) {
      this.removeTick();
      this.removeTick = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }

  clear() {
    this.stop();
    for (const ent of this.entities.values()) {
      this.viewer.entities.remove(ent);
    }
    this.entities.clear();
    this.vessels.clear();
  }

  private tick() {
    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000;
    if (dt < 0.2 || dt > 10) {
      this.lastTickTime = now;
      return;
    }
    this.lastTickTime = now;
    const staleCutoff = now - STALE_TIMEOUT_MS;

    for (const [mmsi, v] of this.vessels) {
      if (v.lastUpdate < staleCutoff) {
        this.vessels.delete(mmsi);
        continue;
      }
      if (v.sog > 0) {
        const dist = (v.sog * 0.514444) * dt;
        const rad = (v.cog * Math.PI) / 180;
        v.lat += (dist * Math.cos(rad)) / 111320;
        const cosLat = Math.cos((v.lat * Math.PI) / 180);
        if (Math.abs(cosLat) > 0.01) {
          v.lon += (dist * Math.sin(rad)) / (111320 * cosLat);
        }
        if (v.lon > 180) v.lon -= 360;
        else if (v.lon < -180) v.lon += 360;
      }
    }
    this.syncEntities();
  }

  private syncEntities() {
    const activeIds = new Set<number>();
    for (const v of this.vessels.values()) {
      const id = v.mmsi;
      const pos = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 0);
      activeIds.add(id);
      let ent = this.entities.get(id);
      if (!ent) {
        const entityConfig: Cesium.Entity.ConstructorOptions = {
          position: pos,
          name: v.name || `MMSI: ${v.mmsi}`,
          billboard: {
            image: getShipIcon(v.heading),
            width: 28,
            height: 28,
            scaleByDistance: new Cesium.NearFarScalar(100000, 1.0, 5000000, 0.3),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: v.name || '',
            font: '11px Space Grotesk, sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 18),
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 2000000.0),
            scaleByDistance: new Cesium.NearFarScalar(500000.0, 1.0, 2000000.0, 0.3),
          },
          properties: { layer: 'ais_vessels', mmsi: v.mmsi, name: v.name, sog: v.sog, cog: v.cog, lon: v.lon, lat: v.lat, time: Date.now() },
        };
        ent = this.viewer.entities.add(entityConfig);
        if (ent) this.entities.set(id, ent);
      } else {
        if (ent.position instanceof Cesium.ConstantPositionProperty) {
          ent.position.setValue(pos);
        } else {
          ent.position = new Cesium.ConstantPositionProperty(pos);
        }
        const newIcon = getShipIcon(v.heading);
        if (ent.billboard) {
          if (ent.billboard.image instanceof Cesium.ConstantProperty) {
            ent.billboard.image.setValue(newIcon);
          } else {
            ent.billboard.image = new Cesium.ConstantProperty(newIcon);
          }
        }
        ent.name = v.name || `MMSI: ${v.mmsi}`;
        if (ent.label && ent.label.text instanceof Cesium.ConstantProperty) {
          ent.label.text.setValue(v.name || '');
        }
      }
    }

    for (const [id, ent] of this.entities.entries()) {
      if (activeIds.has(id)) continue;
      this.viewer.entities.remove(ent);
      this.entities.delete(id);
    }
  }
}
