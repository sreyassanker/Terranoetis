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
  const lon = Number(state[5]);
  const lat = Number(state[6]);
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

export class FlightDeadReckoning {
  private flights = new Map<string, FlightState>();
  private entities = new Map<string, Cesium.Entity>();
  private removeTick: (() => void) | null = null;
  private viewer: Cesium.Viewer;
  private createIcon: (heading: number, color: string) => HTMLCanvasElement;
  private lastTickTime: number = Date.now();

  constructor(
    viewer: Cesium.Viewer,
    createIcon: (heading: number, color: string) => HTMLCanvasElement,
  ) {
    this.viewer = viewer;
    this.createIcon = createIcon;
  }

  updateFromApi(states: unknown[][]) {
    const next = new Map<string, FlightState>();
    for (const state of states.slice(0, 500)) {
      const f = parseOpenSkyState(state);
      if (f) next.set(f.icao24 || f.callsign, f);
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
    this.flights.clear();
  }

  private tick() {
    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    if (dt <= 0 || dt > 5) return;

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
      const id = flight.icao24 || flight.callsign;
      const pos = Cesium.Cartesian3.fromDegrees(flight.lon, flight.lat, flight.alt);
      activeIds.add(id);
      let ent = this.entities.get(id);
      if (!ent) {
        ent = this.viewer.entities.add({
          position: pos,
          name: flight.callsign,
          billboard: {
            image: this.createIcon(flight.heading, color),
            width: 24,
            height: 24,
            scale: 1.2,
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
            disableDepthTestDistance: Number.POSITIVE_INFINITY, // Ensure labels don't get clipped by the globe
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 3000000.0), // Hide text when camera is >3000 km away
            scaleByDistance: new Cesium.NearFarScalar(1000000.0, 1.0, 3000000.0, 0.5), // Shrink text as camera pulls away
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
      } else if (full) {
        ent.position = new Cesium.ConstantPositionProperty(pos);
        if (ent.billboard) {
          ent.billboard.image = new Cesium.ConstantProperty(this.createIcon(flight.heading, color));
        }
        if (ent.label) {
          ent.label.text = new Cesium.ConstantProperty(flight.callsign);
        }
      } else {
        ent.position = new Cesium.ConstantPositionProperty(pos);
      }

      ent.name = flight.callsign;
      ent.properties = new Cesium.PropertyBag({
        layer: 'flight_tracks',
        icao24: id,
        callsign: flight.callsign,
        altitude: flight.alt,
        heading: flight.heading,
        velocity: flight.velocity,
        lon: flight.lon,
        lat: flight.lat,
        time: Date.now(),
      });
    }

    for (const [id, ent] of this.entities.entries()) {
      if (activeIds.has(id)) continue;
      this.viewer.entities.remove(ent);
      this.entities.delete(id);
    }
  }
}
