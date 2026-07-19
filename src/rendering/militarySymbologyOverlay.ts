import * as Cesium from 'cesium';
import type { AisVesselState } from './ais';
import type { FlightState } from './flights';
import { getMilitarySymbol, inferEntityDomain } from './militarySymbology';
import type { MilitaryEntity } from './militarySymbology';

export class MilitarySymbologyOverlay {
  private viewer: Cesium.Viewer;
  private entities = new Map<string, Cesium.Entity>();
  private enabled = false;
  private removeTick: (() => void) | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.start();
    } else {
      this.stop();
    }
  }

  private start() {
    if (this.removeTick) return;
    this.removeTick = this.viewer.clock.onTick.addEventListener(() => this.tick());
  }

  private stop() {
    if (this.removeTick) {
      this.removeTick();
      this.removeTick = null;
    }
    this.clearEntities();
  }

  updateFromVessels(vessels: AisVesselState[]) {
    if (!this.enabled) return;
    const active = new Set<string>();
    for (const v of vessels) {
      const id = `mil_vessel_${v.mmsi}`;
      active.add(id);
      const pos = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 0);
      let ent = this.entities.get(id);
      if (!ent) {
        const domain = inferEntityDomain(v.shipType);
        const milEntity: MilitaryEntity = {
          id, name: v.name || `MMSI:${v.mmsi}`,
          lat: v.lat, lon: v.lon, heading: v.heading,
          domain, affiliation: 'unknown', status: 'present',
          speed: v.sog, timestamp: Date.now(),
        };
        const symbolCanvas = getMilitarySymbol(milEntity, 28);
        ent = this.viewer.entities.add({
          position: pos,
          name: milEntity.name,
          billboard: {
            image: symbolCanvas,
            width: 28, height: 28,
            scaleByDistance: new Cesium.NearFarScalar(100000, 1.0, 5000000, 0.3),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: milEntity.name,
            font: '11px Space Grotesk, sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 18),
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 2000000.0),
          },
          properties: { layer: 'military_symbology', source: 'ais', mmsi: v.mmsi },
        });
        this.entities.set(id, ent);
      } else {
        if (ent.position instanceof Cesium.ConstantPositionProperty) {
          ent.position.setValue(pos);
        }
        const milEntity: MilitaryEntity = {
          id, name: v.name || `MMSI:${v.mmsi}`,
          lat: v.lat, lon: v.lon, heading: v.heading,
          domain: inferEntityDomain(v.shipType),
          affiliation: 'unknown', status: 'present',
          timestamp: Date.now(),
        };
        const newSymbol = getMilitarySymbol(milEntity, 28);
        if (ent.billboard && ent.billboard.image instanceof Cesium.ConstantProperty) {
          ent.billboard.image.setValue(newSymbol);
        }
      }
    }
    for (const [id, ent] of this.entities) {
      if (!active.has(id)) {
        this.viewer.entities.remove(ent);
        this.entities.delete(id);
      }
    }
  }

  updateFromFlights(flights: FlightState[]) {
    if (!this.enabled) return;
    const active = new Set<string>();
    for (const f of flights) {
      const id = `mil_flight_${f.icao24}_${f.callsign}`;
      active.add(id);
      const pos = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, f.alt);
      let ent = this.entities.get(id);
      if (!ent) {
        const milEntity: MilitaryEntity = {
          id, name: f.callsign || f.icao24,
          lat: f.lat, lon: f.lon, alt: f.alt, heading: f.heading,
          domain: 'air', affiliation: 'unknown', status: 'present',
          speed: f.velocity, timestamp: Date.now(),
        };
        const symbolCanvas = getMilitarySymbol(milEntity, 26);
        ent = this.viewer.entities.add({
          position: pos,
          name: milEntity.name,
          billboard: {
            image: symbolCanvas,
            width: 26, height: 26,
            scale: 1.2,
            scaleByDistance: new Cesium.NearFarScalar(500000, 1.0, 5000000, 0.15),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: milEntity.name,
            font: '10px Space Grotesk, sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 18),
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 3000000.0),
          },
          properties: { layer: 'military_symbology', source: 'adsb', icao24: f.icao24 },
        });
        this.entities.set(id, ent);
      } else {
        if (ent.position instanceof Cesium.ConstantPositionProperty) {
          ent.position.setValue(pos);
        }
        const milEntity: MilitaryEntity = {
          id, name: f.callsign || f.icao24,
          lat: f.lat, lon: f.lon, alt: f.alt, heading: f.heading,
          domain: 'air', affiliation: 'unknown', status: 'present',
          timestamp: Date.now(),
        };
        const newSymbol = getMilitarySymbol(milEntity, 26);
        if (ent.billboard && ent.billboard.image instanceof Cesium.ConstantProperty) {
          ent.billboard.image.setValue(newSymbol);
        }
      }
    }
    for (const [id, ent] of this.entities) {
      if (!active.has(id)) {
        this.viewer.entities.remove(ent);
        this.entities.delete(id);
      }
    }
  }

  getTrackedEntities(): MilitaryEntity[] {
    const result: MilitaryEntity[] = [];
    for (const [id, ent] of this.entities) {
      const pos = ent.position?.getValue(Cesium.JulianDate.now());
      if (!pos) continue;
      const carto = Cesium.Cartographic.fromCartesian(pos);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const props = ent.properties?.getValue(Cesium.JulianDate.now()) || {};
      result.push({
        id,
        name: ent.name || id,
        lat, lon, heading: 0,
        domain: id.includes('flight') ? 'air' : 'surface',
        affiliation: 'unknown',
        status: 'present',
        timestamp: Date.now(),
        speed: props.sog || props.velocity,
      });
    }
    return result;
  }

  private tick() {
    const now = Cesium.JulianDate.now();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [id, ent] of this.entities) {
      const props = ent.properties?.getValue(now);
      if (!props) continue;
    }
  }

  clear() {
    this.setEnabled(false);
    this.clearEntities();
  }

  private clearEntities() {
    for (const ent of this.entities.values()) {
      this.viewer.entities.remove(ent);
    }
    this.entities.clear();
  }
}
