import * as Cesium from 'cesium';

export interface PointItem {
  lat?: number; latitude?: number; lon?: number; longitude?: number; lng?: number;
  name?: string; id?: string;
  [key: string]: unknown;
}

interface StormPoint {
  lon?: number; longitude?: number; lat?: number; latitude?: number;
  [key: number]: unknown;
}

interface StormTrackEntry {
  name?: string; category?: string; windSpeed?: number; pressure?: number;
  track?: StormPoint[]; positions?: StormPoint[]; coordinates?: StormPoint[];
}

interface GeoFeature {
  type?: string; coordinates?: number[][][] | number[][][][];
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: number[][][] | number[][][][]; };
}

interface DroughtData { features?: GeoFeature[]; zones?: GeoFeature[]; }

interface RadarSiteEntry {
  lat: number; lon: number; name?: string; id?: string;
  stationType?: string; elevation?: number;
  rda?: Record<string, unknown>;
}

interface ClimateFeatureProperties { cat?: string; prob?: number; valid_seas?: string; fcst_date?: number; }
interface ClimateFeature { properties?: ClimateFeatureProperties; geometry?: GeoFeature['geometry']; }

interface ClimateIndicesData {
  temperature?: { features?: ClimateFeature[] };
  precipitation?: { features?: ClimateFeature[] };
}

export function addGenericPointEntities(
  viewer: Cesium.Viewer,
  items: PointItem[],
  layerId: string,
  opts?: {
    iconColor?: string;
    labelField?: string;
    iconSize?: number;
    pulseColor?: string;
  },
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const color = opts?.iconColor || '#3b82f6';
  const labelField = opts?.labelField || 'name';
  const iconSize = opts?.iconSize || 12;

  items.forEach((item, i: number) => {
    const lat = item.lat ?? item.latitude ?? 0;
    const lon = item.lon ?? item.longitude ?? item.lng ?? 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat);
    const label = String(item[labelField] || item.name || item.id || `${layerId}_${i}`);
    const ent = viewer.entities.add({
      position: pos,
      name: label,
      billboard: {
        image: createColoredDot(color, iconSize),
        width: iconSize,
        height: iconSize,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: label.length > 20 ? label.slice(0, 18) + '...' : label,
        font: '9px Inter, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2000000),
        show: false,
      },
      properties: {
        layer: layerId,
        ...item,
      },
    });
    ents.push(ent);
  });
  return ents;
}

export function addStormTrackEntities(
  viewer: Cesium.Viewer,
  storms: StormTrackEntry[],
  layerId: string,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  storms.forEach((storm) => {
    const track = storm.track || storm.positions || storm.coordinates || [];
    const positions = track
      .map((pt) => {
        const lon = pt.lon ?? pt.longitude ?? Number(pt[0]);
        const lat = pt.lat ?? pt.latitude ?? Number(pt[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return Cesium.Cartesian3.fromDegrees(lon, lat);
      })
      .filter(Boolean) as Cesium.Cartesian3[];

    // A storm with no multi-point track is still a live point (e.g. NHC
    // CurrentStorms) — render it as a marker so the layer always appears.
    if (positions.length === 1) {
      const marker = viewer.entities.add({
        position: positions[0],
        name: storm.name || 'Storm Center',
        billboard: {
          image: createColoredDot('#ef4444', 16),
          width: 16,
          height: 16,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `${storm.name || 'Storm'}${storm.category ? ` (Cat ${storm.category})` : ''}`,
          font: '10px Inter, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          pixelOffset: new Cesium.Cartesian2(0, -14),
        },
        properties: {
          layer: layerId,
          name: storm.name || 'Storm',
          windSpeed: storm.windSpeed || 0,
          pressure: storm.pressure || 0,
          isStormCenter: true,
        },
      });
      ents.push(marker);
      return;
    }

    if (positions.length < 2) return;

    const ent = viewer.entities.add({
      name: storm.name || 'Storm Track',
      polyline: {
        positions,
        width: 2.5,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.7),
          glowPower: 0.3,
        }),
      },
      properties: {
        layer: layerId,
        name: storm.name || 'Storm',
        category: storm.category || '',
        windSpeed: storm.windSpeed || 0,
        pressure: storm.pressure || 0,
      },
    });
    ents.push(ent);

    const last = positions[positions.length - 1];
    const marker = viewer.entities.add({
      position: last,
      name: storm.name || 'Storm Center',
      billboard: {
        image: createColoredDot('#ef4444', 16),
        width: 16,
        height: 16,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: `${storm.name || 'Storm'} ${storm.category ? `(Cat ${storm.category})` : ''}`,
        font: '10px Inter, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -14),
      },
      properties: {
        layer: layerId,
        name: storm.name || 'Storm',
        isStormCenter: true,
      },
    });
    ents.push(marker);
  });
  return ents;
}

function extractPolygonRings(geometry: GeoFeature['geometry']): number[][][] {
  if (!geometry || !geometry.type || !geometry.coordinates) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates as number[][][];
  if (geometry.type === 'MultiPolygon') {
    const rings: number[][][] = [];
    for (const poly of geometry.coordinates as number[][][][]) {
      for (const ring of poly) rings.push(ring);
    }
    return rings;
  }
  return [];
}

export function addDroughtZoneEntities(
  viewer: Cesium.Viewer,
  data: DroughtData,
  layerId: string,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const features = data.features || data.zones || [];
  const dmColors: Record<string, string> = {
    D0: '#ffff00',
    D1: '#fcd37f',
    D2: '#ffaa00',
    D3: '#e60000',
    D4: '#730000',
  };

  features.forEach((f) => {
    const props = f.properties || {};
    const dm = String(props.dm || 'D0');
    const rings = extractPolygonRings(f.geometry);
    if (rings.length === 0) return;
    const color = Cesium.Color.fromCssColorString(dmColors[dm] || '#ffff00').withAlpha(0.4);
    try {
      const ent = viewer.entities.add({
        name: String(props.name || `Drought ${dm}`),
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(rings[0].map((c: number[]) => Cesium.Cartesian3.fromDegrees(c[0], c[1]))),
          material: color,
          outline: true,
          outlineColor: color.withAlpha(0.6),
          outlineWidth: 1,
        },
        properties: {
          layer: layerId,
          dm,
          name: props.name || `Drought ${dm}`,
        },
      });
      ents.push(ent);
    } catch { /* skip invalid geometry */ }
  });
  return ents;
}

export function addRadarSiteEntities(
  viewer: Cesium.Viewer,
  sites: RadarSiteEntry[],
  layerId: string,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  sites.forEach((site) => {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return;
    const pos = Cesium.Cartesian3.fromDegrees(site.lon, site.lat);
    const rda = site.rda || {};
    const ent = viewer.entities.add({
      position: pos,
      name: `${site.name} (${site.id})`,
      billboard: {
        image: createRadarIcon(),
        width: 18,
        height: 18,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: site.id || '',
        font: '9px Inter, sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#22d3ee'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        show: false,
      },
      properties: {
        layer: layerId,
        id: site.id,
        name: site.name,
        lat: site.lat,
        lon: site.lon,
        stationType: site.stationType || 'WSR-88D',
        elevation: site.elevation ?? 0,
        mode: rda.mode || '',
        vcp: rda.vcp || '',
        alarmSummary: rda.alarmSummary || '',
        generatorState: rda.generatorState || '',
      },
    });
    ents.push(ent);
  });
  return ents;
}

export function addClimateIndicesEntities(
  viewer: Cesium.Viewer,
  data: ClimateIndicesData,
  layerId: string,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const { temperature, precipitation } = data;
  let validSeason = '';

  function addOutlookFeatures(features: ClimateFeature[], prefix: string, isTemp: boolean) {
    (features || []).forEach((f) => {
      const p = f.properties || {};
      const cat = p.cat || 'EC';
      const probVal = p.prob ?? 33;
      if (!validSeason && p.valid_seas) validSeason = p.valid_seas;
      const rings = extractPolygonRings(f.geometry);
      if (rings.length === 0) return;
      const colorStr = isTemp
        ? (cat === 'A' ? `rgba(215,48,39,${probVal / 100 * 0.5 + 0.15})` : cat === 'B' ? `rgba(69,115,180,${probVal / 100 * 0.5 + 0.15})` : 'rgba(240,240,240,0.1)')
        : (cat === 'A' ? `rgba(26,152,80,${probVal / 100 * 0.5 + 0.15})` : cat === 'B' ? `rgba(166,86,40,${probVal / 100 * 0.5 + 0.15})` : 'rgba(240,240,240,0.1)');
      try {
        const ent = viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(rings[0].map((c: number[]) => Cesium.Cartesian3.fromDegrees(c[0], c[1]))),
            material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(colorStr)),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(isTemp ? '#d73027' : '#1a9850').withAlpha(0.3),
            outlineWidth: 1,
          },
          properties: {
            layer: layerId,
            type: prefix,
            category: cat,
            probability: probVal,
            season: p.valid_seas || '',
            fcstDate: p.fcst_date || 0,
          },
        });
        ents.push(ent);
      } catch { /* skip */ }
    });
  }

  addOutlookFeatures(temperature?.features ?? [], 'temp', true);
  addOutlookFeatures(precipitation?.features ?? [], 'precip', false);

  return ents;
}

const DOT_ICON_CACHE = new Map<string, HTMLCanvasElement>();
const DOT_ICON_CACHE_MAX = 500;

function createColoredDot(color: string, size: number): HTMLCanvasElement {
  if (DOT_ICON_CACHE.size > DOT_ICON_CACHE_MAX) DOT_ICON_CACHE.clear();
  const key = `${color}_${size}`;
  const cached = DOT_ICON_CACHE.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2, cy = size / 2, r = size * 0.4;
  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, size / 2);
  glow.addColorStop(0, Cesium.Color.fromCssColorString(color).withAlpha(0.95).toCssColorString());
  glow.addColorStop(0.5, Cesium.Color.fromCssColorString(color).withAlpha(0.4).toCssColorString());
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = Cesium.Color.fromCssColorString(color).withAlpha(0.9).toCssColorString();
  ctx.fill();
  DOT_ICON_CACHE.set(key, canvas);
  return canvas;
}

let cachedRadarIcon: HTMLCanvasElement | null = null;
function createRadarIcon(): HTMLCanvasElement {
  if (cachedRadarIcon) return cachedRadarIcon;
  const canvas = document.createElement('canvas');
  canvas.width = 18;
  canvas.height = 18;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(9, 9, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(9, 3);
  ctx.lineTo(9, 15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(3, 9);
  ctx.lineTo(15, 9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(9, 9, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#22d3ee';
  ctx.fill();
  cachedRadarIcon = canvas;
  return canvas;
}
