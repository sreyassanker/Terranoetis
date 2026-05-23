import * as Cesium from 'cesium';

export interface FlightState {
  icao24: string;
  callsign: string;
  lon: number;
  lat: number;
  alt: number;
  heading: number;
  velocity: number;
  lastUpdate: number;
}

export function altitudeBandColor(altMeters: number): string {
  const ft = altMeters * 3.28084;
  if (ft > 35000) return '#00D4FF';
  if (ft > 25000) return '#39FF14';
  if (ft > 10000) return '#FF9500';
  if (ft > 1000) return '#f97316';
  return '#FF3B30';
}

export function parseOpenSkyState(state: unknown[]): FlightState | null {
  const lonVal = state[5];
  const latVal = state[6];
  if (lonVal == null || latVal == null) return null;
  const lon = Number(lonVal);
  const lat = Number(latVal);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    icao24: String(state[0] ?? ''),
    callsign: String(state[1] ?? 'Unknown').trim() || 'Unknown',
    lon,
    lat,
    alt: Number(state[7] ?? 0),
    heading: Number(state[10] ?? 0),
    velocity: Number(state[9] ?? 0),
    lastUpdate: Number(state[4] ?? Date.now() / 1000) * 1000,
  };
}

const ICON_CACHE = new Map<string, HTMLCanvasElement>();

function getPlaneIcon(heading: number, color: string): HTMLCanvasElement {
  const rounded = Math.round(heading / 5) * 5;
  const key = `${rounded}_${color}`;
  let cached = ICON_CACHE.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.translate(12, 12);
  ctx.rotate((rounded * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(-3, 2);
  ctx.lineTo(-8, 6);
  ctx.lineTo(-3, 4);
  ctx.lineTo(0, 8);
  ctx.lineTo(3, 4);
  ctx.lineTo(8, 6);
  ctx.lineTo(3, 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  ICON_CACHE.set(key, canvas);
  return canvas;
}

export class FlightDeadReckoning {
  private flights = new Map<string, FlightState>();
  private entities = new Map<string, Cesium.Entity>();
  private iconKeys = new Map<string, string>();
  private removeTick: (() => void) | null = null;
  private viewer: Cesium.Viewer;
  private lastTickTime: number = Date.now();

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  updateFromApi(states: unknown[][]) {
    const next = new Map<string, FlightState>();
    for (const state of states) {
      const f = parseOpenSkyState(state);
      if (f) next.set(`${f.icao24}_${f.callsign}`, f);
    }
    this.flights = next;
    this.syncEntities();
  }

  start() {
    if (this.removeTick) return;
    this.lastTickTime = Date.now();
    this.removeTick = this.viewer.clock.onTick.addEventListener(() => this.tick());
  }

  stop() {
    if (this.removeTick) {
      this.removeTick();
      this.removeTick = null;
    }
  }

  clear() {
    this.stop();
    for (const ent of this.entities.values()) {
      this.viewer.entities.remove(ent);
    }
    this.entities.clear();
    this.iconKeys.clear();
    this.flights.clear();
  }

  private tick() {
    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000;
    if (dt <= 0 || dt > 5) {
      this.lastTickTime = now;
      return;
    }
    this.lastTickTime = now;
    for (const flight of this.flights.values()) {
      if (flight.velocity <= 0) continue;
      const dist = flight.velocity * dt;
      const rad = (flight.heading * Math.PI) / 180;
      const dLat = (dist * Math.cos(rad)) / 111320;
      const cosLat = Math.cos((flight.lat * Math.PI) / 180);
      if (Math.abs(cosLat) < 0.01) continue;
      const dLon = (dist * Math.sin(rad)) / (111320 * cosLat);
      flight.lat += dLat;
      flight.lon += dLon;
    }
    this.syncEntities(false);
  }

  private syncEntities(full = true) {
    const activeIds = new Set<string>();
    for (const flight of this.flights.values()) {
      const color = altitudeBandColor(flight.alt);
      const id = `${flight.icao24}_${flight.callsign}`;
      const pos = Cesium.Cartesian3.fromDegrees(flight.lon, flight.lat, flight.alt);
      activeIds.add(id);
      let ent = this.entities.get(id);
      if (!ent) {
        ent = this.viewer.entities.add({
          position: pos,
          name: flight.callsign,
          billboard: {
            image: getPlaneIcon(flight.heading, color),
            width: 24,
            height: 24,
            scale: 1.2,
            scaleByDistance: new Cesium.NearFarScalar(500000, 1.0, 5000000, 0.15),
          },
          label: {
            text: flight.callsign,
            font: '10px Space Grotesk, sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 18),
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            heightReference: Cesium.HeightReference.NONE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 3000000.0),
            scaleByDistance: new Cesium.NearFarScalar(1000000.0, 1.0, 3000000.0, 0.5),
          },
          properties: {
            layer: 'flight_tracks',
            icao24: id,
            callsign: flight.callsign,
            altitude: flight.alt,
            heading: flight.heading,
            velocity: flight.velocity,
            lon: flight.lon,
            lat: flight.lat,
            time: Date.now(),
          },
        });
        this.entities.set(id, ent);
        const roundedKey = `${Math.round(flight.heading / 5) * 5}_${color}`;
        this.iconKeys.set(id, roundedKey);
      } else {
        if (ent.position instanceof Cesium.ConstantPositionProperty) {
          ent.position.setValue(pos);
        } else {
          ent.position = new Cesium.ConstantPositionProperty(pos);
        }
        if (full) {
          const rounded = Math.round(flight.heading / 5) * 5;
          const key = `${rounded}_${color}`;
          if (key !== this.iconKeys.get(id)) {
            if (ent.billboard) {
              const newIcon = getPlaneIcon(flight.heading, color);
              if (ent.billboard.image instanceof Cesium.ConstantProperty) {
                ent.billboard.image.setValue(newIcon);
              } else {
                ent.billboard.image = new Cesium.ConstantProperty(newIcon);
              }
            }
            this.iconKeys.set(id, key);
          }
          if (ent.label) {
            if (ent.label.text instanceof Cesium.ConstantProperty) {
              ent.label.text.setValue(flight.callsign);
            } else {
              ent.label.text = new Cesium.ConstantProperty(flight.callsign);
            }
          }
          if (ent.properties) {
            for (const [k, v] of Object.entries({
              callsign: flight.callsign,
              altitude: flight.alt,
              heading: flight.heading,
              velocity: flight.velocity,
              lon: flight.lon,
              lat: flight.lat,
              time: Date.now(),
            })) {
              const prop = ent.properties.getProperty(k);
              if (prop instanceof Cesium.ConstantProperty) {
                prop.setValue(v);
              }
            }
          }
        }
        ent.name = flight.callsign;
      }
    }

    for (const [id, ent] of this.entities.entries()) {
      if (activeIds.has(id)) continue;
      this.viewer.entities.remove(ent);
      this.entities.delete(id);
      this.iconKeys.delete(id);
    }
  }
}
