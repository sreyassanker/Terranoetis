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
  }
  return ents;
}

// ── Military Bases ─────────────────────────────────────────────────

let cachedMilBaseIcon: HTMLCanvasElement | null = null;
function createMilBaseIcon(): HTMLCanvasElement {
  if (cachedMilBaseIcon) return cachedMilBaseIcon;
  const canvas = document.createElement('canvas');
  canvas.width = 18;
  canvas.height = 18;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(9, 9);
  ctx.fillStyle = '#555555';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(7, 5);
  ctx.lineTo(0, 2);
  ctx.lineTo(-7, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  cachedMilBaseIcon = canvas;
  return canvas;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function addMilitaryBaseEntities(
  viewer: Cesium.Viewer,
  data: { elements?: OverpassElement[] },
  layerId: string,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const icon = createMilBaseIcon();
  const elems = data.elements || [];
  const capped = elems.slice(0, 500);
  for (let i = 0; i < capped.length; i++) {
    const e = capped[i];
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tags = e.tags || {};
    const name = tags.name || tags.operator || tags.military || `${tags.landuse || 'base'} ${i}`;
    const id = `${layerId}_${e.type}_${e.id}`;
    const ent = viewer.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      name: String(name),
      billboard: {
        image: icon,
        width: 18,
        height: 18,
        scaleByDistance: new Cesium.NearFarScalar(500000, 1.0, 8000000, 0.2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: String(name).length > 20 ? String(name).slice(0, 18) + '…' : String(name),
        font: '10px Space Grotesk, sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#aaaaaa'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 3000000.0),
      },
      properties: {
        layer: layerId,
        osm_type: e.type,
        osm_id: e.id,
        ...tags,
        lat,
        lon,
      },
    });
    ents.push(ent);
  }
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

const volcanoIconCache = new Map<string, HTMLCanvasElement>();
function createVolcanoIcon(color: string): HTMLCanvasElement {
  const cached = volcanoIconCache.get(color);
  if (cached) return cached;
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
  volcanoIconCache.set(color, canvas);
  return canvas;
}

let cachedAviationAirportIcon: HTMLCanvasElement | null = null;
function createAirportIcon(): HTMLCanvasElement {
  if (cachedAviationAirportIcon) return cachedAviationAirportIcon;
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
  cachedAviationAirportIcon = canvas;
  return canvas;
}

let cachedMilitaryArrow: HTMLCanvasElement | null = null;
function createMilitaryArrowIcon(): HTMLCanvasElement {
  if (cachedMilitaryArrow) return cachedMilitaryArrow;
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(12, 12);
  ctx.fillStyle = '#ff4444';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(8, 6);
  ctx.lineTo(0, 2);
  ctx.lineTo(-8, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  cachedMilitaryArrow = canvas;
  return canvas;
}

export function addMilitaryFlightEntities(
  viewer: Cesium.Viewer,
  data: { states?: unknown[][] },
  layerId: string,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const states = data.states || [];
  const icon = createMilitaryArrowIcon();
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const lonVal = s[5];
    const latVal = s[6];
    if (lonVal == null || latVal == null) continue;
    const lon = Number(lonVal);
    const lat = Number(latVal);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const icao24 = String(s[0] ?? '');
    const callsign = String(s[1] ?? '').trim() || icao24;
    const alt = Number(s[7] ?? 0);
    const heading = Number(s[10] ?? 0);
    const velocity = Number(s[9] ?? 0);
    const id = `${layerId}_${icao24}`;
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
    const ent = viewer.entities.add({
      id,
      position: pos,
      name: callsign,
      billboard: {
        image: icon,
        rotation: Cesium.Math.toRadians(90 - heading),
        width: 24,
        height: 24,
        scaleByDistance: new Cesium.NearFarScalar(500000, 1.0, 8000000, 0.2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: callsign.length > 16 ? callsign.slice(0, 14) + '…' : callsign,
        font: '10px Space Grotesk, sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#ff6666'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 4000000.0),
      },
      properties: {
        layer: layerId,
        icao24,
        callsign,
        lat,
        lon,
        alt,
        heading,
        velocity,
      },
    });
    ents.push(ent);
  }
  return ents;
}

// ── UCDP Conflict Events ──────────────────────────────────────────

let cachedUcdpIcon: HTMLCanvasElement | null = null;
function createUcdpIcon(): HTMLCanvasElement {
  if (cachedUcdpIcon) return cachedUcdpIcon;
  const canvas = document.createElement('canvas');
  canvas.width = 20;
  canvas.height = 20;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(10, 10);
  ctx.fillStyle = '#9d0208';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚔', 0, 1);
  cachedUcdpIcon = canvas;
  return canvas;
}

export interface UcdpEvent {
  id?: number;
  location?: string;
  latitude?: number;
  longitude?: number;
  date_start?: string;
  date_end?: string;
  type_of_violence?: number;
  side_a?: string;
  side_b?: string;
  best?: number;
  low?: number;
  high?: number;
}

export function addUcdpEntities(
  viewer: Cesium.Viewer,
  events: UcdpEvent[],
  layerId: string,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const icon = createUcdpIcon();
  const capped = events.slice(0, 200);
  for (let i = 0; i < capped.length; i++) {
    const e = capped[i];
    const lat = e.latitude;
    const lon = e.longitude;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const fatalities = e.best ?? 0;
    const scale = fatalities > 100 ? 1.5 : fatalities > 10 ? 1.2 : 1.0;
    const label = e.location || `Conflict ${i}`;
    const sideInfo = [e.side_a, e.side_b].filter(Boolean).join(' vs ');
    const id = `${layerId}_${e.id ?? i}`;
    const ent = viewer.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      name: label,
      billboard: {
        image: icon,
        width: 20 * scale,
        height: 20 * scale,
        scaleByDistance: new Cesium.NearFarScalar(500000, 1.0, 8000000, 0.2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: sideInfo ? `${label} (${sideInfo})` : label,
        font: '10px Space Grotesk, sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#ff6666'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 3000000.0),
      },
      properties: {
        layer: layerId,
        ...e,
        lat,
        lon,
      },
    });
    ents.push(ent);
  }
  return ents;
}
