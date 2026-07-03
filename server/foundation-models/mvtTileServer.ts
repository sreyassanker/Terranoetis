import { getDb } from '../db/index';
import zlib from 'zlib';

const ZOOM_MAX = 22;

function tileToBbox(z: number, x: number, y: number) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  const s = Math.PI - (2 * Math.PI * (y + 1)) / Math.pow(2, z);
  return {
    west: (x / Math.pow(2, z)) * 360 - 180,
    east: ((x + 1) / Math.pow(2, z)) * 360 - 180,
    north: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    south: (Math.atan(Math.sinh(s)) * 180) / Math.PI,
  };
}

const layerConfigs: Record<string, {
  table: string;
  label: string;
  minZoom: number;
  maxZoom: number;
  fields: Record<string, string>;
  sql: string;
}> = {
  earthquakes: {
    table: 'earthquakes',
    label: 'Earthquakes',
    minZoom: 0, maxZoom: 14,
    fields: { mag: 'number', place: 'string', time: 'string' },
    sql: 'SELECT lat, lon, mag, place, time FROM earthquakes WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ? AND COALESCE(mag,0) >= ? ORDER BY COALESCE(mag,0) DESC LIMIT 200',
  },
  firms_fires: {
    table: 'firms',
    label: 'FIRMS Fires',
    minZoom: 3, maxZoom: 14,
    fields: { brightness: 'number', frp: 'number' },
    sql: 'SELECT lat, lon, brightness, frp FROM firms WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ? ORDER BY COALESCE(brightness,0) DESC LIMIT 500',
  },
  volcanoes: {
    table: 'volcanoes',
    label: 'Volcanoes',
    minZoom: 0, maxZoom: 12,
    fields: { name: 'string', status: 'string' },
    sql: 'SELECT lat, lon, name, status FROM volcanoes WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ? LIMIT 100',
  },
  weather_alerts: {
    table: 'weather_alerts',
    label: 'Weather Alerts',
    minZoom: 2, maxZoom: 10,
    fields: { event: 'string', headline: 'string' },
    sql: 'SELECT lat, lon, event, headline FROM weather_alerts WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ? LIMIT 200',
  },
  gdacs: {
    table: 'gdacs_alerts',
    label: 'GDACS Alerts',
    minZoom: 0, maxZoom: 10,
    fields: { type: 'string', severity: 'string' },
    sql: 'SELECT lat, lon, alert_type as type, severity FROM gdacs_alerts WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ? LIMIT 100',
  },
};

function queryFeatures(layer: string, bbox: { west: number; south: number; east: number; north: number }, z: number): Record<string, unknown>[] {
  const cfg = layerConfigs[layer];
  if (!cfg) return [];
  if (z < cfg.minZoom || z > cfg.maxZoom) return [];

  const magThreshold = layer === 'earthquakes' ? (z < 3 ? 4 : z < 5 ? 2.5 : 0) : 0;

  try {
    const db = getDb();
    const rows = db.prepare(cfg.sql).all(
      bbox.west, bbox.east, bbox.south, bbox.north, magThreshold,
    ) as Record<string, unknown>[];
    return rows;
  } catch {
    return [];
  }
}

const tileCache = new Map<string, { buffer: Buffer; time: number }>();
const CACHE_TTL = 30000;
const CACHE_MAX = 2000;

export function getLayerSources(): string[] {
  return Object.keys(layerConfigs);
}

export function getTileJson(baseUrl: string = ''): Record<string, unknown> {
  return {
    tilejson: '3.0.0',
    name: 'Realtime Geo Data',
    description: 'Live geospatial data: earthquakes, fires, volcanoes, weather alerts, disasters',
    version: '1.0.0',
    scheme: 'xyz',
    tiles: [`${baseUrl}/api/tiles/{z}/{x}/{y}.mvt`],
    vector_layers: Object.entries(layerConfigs).map(([id, cfg]) => ({
      id, description: `Dynamic ${cfg.label} data`, minzoom: cfg.minZoom, maxzoom: cfg.maxZoom, fields: cfg.fields,
    })),
    bounds: [-180, -85.051129, 180, 85.051129],
    center: [0, 20, 2],
  };
}

let _fromGeojsonVt: ((data: Record<string, unknown>) => Uint8Array) | null = null;

async function ensurePkgs(): Promise<void> {
  if (!_fromGeojsonVt) {
    const mod = await import('vt-pbf');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _fromGeojsonVt = (mod as any).fromGeojsonVt || (mod as any).default;
  }
}

function encodeMvtSync(featuresByLayer: Record<string, Record<string, unknown>[]>): Buffer {
  if (!_fromGeojsonVt) return Buffer.alloc(0);

  const geojsonVtLayers: Record<string, { features: Array<{ type: string; geometry: { type: string; coordinates: number[] }; properties: Record<string, unknown>; id: number }> }> = {};
  for (const [name, features] of Object.entries(featuresByLayer)) {
    if (features.length === 0) continue;

    const cfg = layerConfigs[name];
    geojsonVtLayers[name] = {
      features: features.map((f, idx) => {
        const props: Record<string, unknown> = {};
        if (cfg) {
          for (const key of Object.keys(cfg.fields)) {
            if (f[key] != null) props[key] = f[key];
          }
        }
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [f.lon as number, f.lat as number] },
          properties: props,
          id: idx,
        };
      }),
    };
  }

  if (Object.keys(geojsonVtLayers).length === 0) return Buffer.alloc(0);

  try {
    return Buffer.from(_fromGeojsonVt(geojsonVtLayers));
  } catch {
    return Buffer.alloc(0);
  }
}

export async function handleTileRequest(
  z: number, x: number, y: number, layer?: string,
): Promise<{ buffer: Buffer; headers: Record<string, string> } | null> {
  if (z < 0 || z > ZOOM_MAX || x < 0 || y < 0) return null;
  const maxTile = Math.pow(2, z) - 1;
  if (x > maxTile || y > maxTile) return null;

  const cacheKey = `${z}/${x}/${y}/${layer || '__all__'}`;
  const cached = tileCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return { buffer: cached.buffer, headers: getHeaders() };
  }

  const bbox = tileToBbox(z, x, y);
  const layerNames = layer ? [layer] : Object.keys(layerConfigs);

  const featuresByLayer: Record<string, Record<string, unknown>[]> = {};
  for (const ln of layerNames) {
    const feats = queryFeatures(ln, bbox, z);
    if (feats.length > 0) featuresByLayer[ln] = feats;
  }

  await ensurePkgs();

  let buffer = encodeMvtSync(featuresByLayer);
  if (buffer.length === 0) return null;

  buffer = zlib.gzipSync(buffer);

  if (tileCache.size >= CACHE_MAX) {
    const oldest = [...tileCache.entries()].sort((a, b) => a[1].time - b[1].time)[0];
    if (oldest) tileCache.delete(oldest[0]);
  }
  tileCache.set(cacheKey, { buffer, time: Date.now() });

  return { buffer, headers: getHeaders() };
}

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/vnd.mapbox-vector-tile',
    'Content-Encoding': 'gzip',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=30',
  };
}
