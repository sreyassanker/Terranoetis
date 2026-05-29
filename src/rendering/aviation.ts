import * as Cesium from 'cesium';
import { FlightDeadReckoning } from './flights';

export { FlightDeadReckoning };

interface VolcanoEntry {
  lat: number; lon: number; name?: string; status?: string;
  country?: string; region?: string; elevation?: number;
  so2?: number; lastUpdate?: string; date?: string; issued?: string;
}

interface DataContainer { advisories?: VolcanoEntry[]; locations?: VolcanoEntry[]; }

interface AirportEntry {
  iata?: string; icao?: string; name?: string; city?: string;
  country?: string; lat: number; lon: number; alt?: number;
}

interface RouteEntry { srcIata: string; dstIata: string; airline?: string; }

interface OpenFlightsData { airports?: AirportEntry[]; routes?: RouteEntry[]; }

export function createFlightLayerManager(
  viewer: Cesium.Viewer,
  _createIcon: (heading: number, color: string) => HTMLCanvasElement,
  _layerId: string,
): FlightDeadReckoning {
  const manager = new FlightDeadReckoning(viewer);
  return manager;
}

export function addVolcanoEntities(
  viewer: Cesium.Viewer,
  volcanoes: VolcanoEntry[],
  layerId: string,
  markerColor: string = '#f59e0b',
  _pulseColor: string = '#ef4444',
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  volcanoes.forEach((v) => {
    const lat = v.lat;
    const lon = v.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const status = (v.status || 'ACTIVE').toUpperCase();
    const color = status === 'ERUPTING' ? '#ef4444' :
      status === 'WATCH' ? '#f97316' :
      status === 'ADVISORY' ? '#eab308' :
      status === 'GREEN' ? '#22c55e' :
      markerColor;
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 1000);
    const ent = viewer.entities.add({
      position: pos,
      name: v.name || 'Volcano',
      billboard: {
        image: createVolcanoIcon(color),
        width: 20,
        height: 20,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: v.name || '',
        font: '10px Space Grotesk, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        show: true,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2000000),
      },
      properties: {
        layer: layerId,
        name: v.name || 'Volcano',
        lat,
        lon,
        status: v.status || 'Active',
        country: v.country || v.region || '',
        elevation: v.elevation || 0,
        so2: v.so2 || 0,
        lastUpdate: v.lastUpdate || v.date || v.issued || '',
      },
    });
    ents.push(ent);
  });
  return ents;
}

export function addVaacAdvisoryEntities(
  viewer: Cesium.Viewer,
  data: DataContainer,
  layerId: string,
): Cesium.Entity[] {
  const advisories = data.advisories || [];
  return addVolcanoEntities(viewer, advisories, layerId, '#eab308', '#ef4444');
}

export function addSo2Entities(
  viewer: Cesium.Viewer,
  data: DataContainer,
  layerId: string,
): Cesium.Entity[] {
  const locations = data.locations || [];
  return addVolcanoEntities(viewer, locations, layerId, '#a855f7', '#7c3aed');
}

export function addOpenFlightsEntities(
  viewer: Cesium.Viewer,
  data: OpenFlightsData,
  layerId: string,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const airports = data.airports || [];
  const routes = data.routes || [];

  const airportMap = new Map<string, AirportEntry>();
  airports.slice(0, 500).forEach((a) => {
    if (a.iata) airportMap.set(a.iata, a);
    const pos = Cesium.Cartesian3.fromDegrees(a.lon, a.lat);
    const ent = viewer.entities.add({
      position: pos,
      name: `${a.name} (${a.iata})`,
      billboard: {
        image: createAirportIcon(),
        width: 10,
        height: 10,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: a.iata || '',
        font: '9px Space Grotesk, sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#14b8a6'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        pixelOffset: new Cesium.Cartesian2(0, -8),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1000000),
      },
      properties: {
        layer: layerId,
        type: 'airport',
        iata: a.iata,
        icao: a.icao,
        name: a.name,
        city: a.city,
        country: a.country,
        lat: a.lat,
        lon: a.lon,
        altitude: a.alt,
      },
    });
    ents.push(ent);
  });

  const drawnRoutes = new Set<string>();
  const routeLimit = Math.min(routes.length, 200);
  for (let i = 0; i < routeLimit; i++) {
    const r = routes[i];
    const src = airportMap.get(r.srcIata);
    const dst = airportMap.get(r.dstIata);
    if (!src || !dst) continue;
    const key = [r.srcIata, r.dstIata].sort().join('-');
    if (drawnRoutes.has(key)) continue;
    drawnRoutes.add(key);
    const ent = viewer.entities.add({
      name: `${r.srcIata} → ${r.dstIata}`,
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(src.lon, src.lat, 5000),
          Cesium.Cartesian3.fromDegrees(dst.lon, dst.lat, 5000),
        ],
        width: 1,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: Cesium.Color.fromCssColorString('#14b8a6').withAlpha(0.4),
          glowPower: 0.2,
        }),
      },
      properties: {
        layer: layerId,
        type: 'route',
        from: r.srcIata,
        to: r.dstIata,
        airline: r.airline,
      },
    });
    ents.push(ent);
  }
  return ents;
}

function createVolcanoIcon(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 20;
  canvas.height = 20;
  const ctx = canvas.getContext('2d')!;
  const cx = 10, cy = 10;
  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 10);
  glow.addColorStop(0, Cesium.Color.fromCssColorString(color).withAlpha(0.95).toCssColorString());
  glow.addColorStop(0.4, Cesium.Color.fromCssColorString(color).withAlpha(0.5).toCssColorString());
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = Cesium.Color.fromCssColorString(color).withAlpha(0.9).toCssColorString();
  ctx.fill();
  return canvas;
}

function createAirportIcon(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 12;
  canvas.height = 12;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#14b8a6';
  ctx.beginPath();
  ctx.arc(6, 6, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0d9488';
  ctx.lineWidth = 1;
  ctx.stroke();
  return canvas;
}
