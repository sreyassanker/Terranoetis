/**
 * GIS Fusion Engine — Multi-Hazard Risk Surface Computation
 *
 * ALL extractors enforce strict bbox filtering — no global data
 * leaks into the study area surface.
 *
 * Normalization: every extractor maps its native domain to [0,1]
 * via a fixed reference scale so no single tool can compress the
 * color gradient (e.g. mag 3.9 = 0.39, AQI 250 = 0.50 on the
 * same scale).
 *
 * Fusion: per-category max pooling, then max across categories.
 * This prevents tool-count imbalance (7 weather vs 2 seismic)
 * from masking any hazard type.
 */

import type { InterpPoint } from './idwInterpolation';

export interface ProjectedPoint {
  x: number;
  y: number;
  value: number;
  toolId: string;
  category: string;
}

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

const EARTH_RADIUS_M = 6371000;

export function projectToLocal(
  lat: number, lon: number,
  centerLat: number, centerLon: number,
): { x: number; y: number } {
  const latR = lat * Math.PI / 180;
  const lonR = lon * Math.PI / 180;
  const cLatR = centerLat * Math.PI / 180;
  const cLonR = centerLon * Math.PI / 180;
  return {
    x: (lonR - cLonR) * Math.cos(cLatR) * EARTH_RADIUS_M,
    y: (latR - cLatR) * EARTH_RADIUS_M,
  };
}

function insideBbox(lat: number, lon: number, bbox: Bbox): boolean {
  return lat >= bbox.latMin && lat <= bbox.latMax && lon >= bbox.lonMin && lon <= bbox.lonMax;
}

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

function linScale(val: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return clamp01((val - min) / (max - min));
}

type ExtractFn = (
  raw: Record<string, unknown>,
  centerLat: number, centerLon: number, bbox: Bbox,
) => ProjectedPoint[];

function extractGeoJSON(
  raw: Record<string, unknown>, valueKey: string,
  valueScale: (v: number) => number,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const features = raw.features as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(features)) return [];
  const out: ProjectedPoint[] = [];
  for (const f of features) {
    const coords = (f?.geometry as Record<string, unknown>)?.coordinates as number[] | undefined;
    if (!coords || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!insideBbox(lat, lon, bbox)) continue;
    const props = (f?.properties ?? {}) as Record<string, unknown>;
    const rawVal = Number(props[valueKey] ?? props.value ?? 0.5);
    const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
    out.push({ x, y, value: valueScale(rawVal), toolId, category });
  }
  return out;
}

function extractEONET(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const events = raw.events as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(events)) return [];
  const out: ProjectedPoint[] = [];
  for (const ev of events) {
    const geoms = ev?.geometry as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(geoms)) continue;
    for (const g of geoms) {
      const coords = g?.coordinates as number[] | undefined;
      if (!coords || coords.length < 2) continue;
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!insideBbox(lat, lon, bbox)) continue;
      const mv = Number(g.magnitudeValue ?? 0);
      const val = mv > 0 ? clamp01(mv / 5000) : 0.5;
      const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
      out.push({ x, y, value: val, toolId, category });
    }
  }
  return out;
}

function extractFIRMS(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const hotspots = raw.hotspots as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(hotspots)) return [];
  const out: ProjectedPoint[] = [];
  for (const h of hotspots) {
    const lat = Number(h.latitude ?? 0);
    const lon = Number(h.longitude ?? 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!insideBbox(lat, lon, bbox)) continue;
    const frp = Number(h.bright_ti4 ?? h.frp ?? h.brightness ?? 0);
    const val = frp > 0 ? clamp01(Math.log10(frp + 1) / Math.log10(10000)) : 0.3;
    const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
    out.push({ x, y, value: val, toolId, category });
  }
  return out;
}

function extractGDELT(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const articles = raw.articles as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(articles)) return [];
  const out: ProjectedPoint[] = [];
  for (const a of articles) {
    const lat = Number(a.lat ?? a.latitude ?? 0);
    const lon = Number(a.lon ?? a.longitude ?? 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue;
    if (!insideBbox(lat, lon, bbox)) continue;
    const tone = Number(a.tone ?? a.averagetone ?? 0);
    const risk = tone < 0 ? clamp01(Math.abs(tone) / 20) : 0.1;
    const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
    out.push({ x, y, value: risk, toolId, category });
  }
  return out;
}

function extractOverpass(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const elements = raw.elements as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(elements)) return [];
  const out: ProjectedPoint[] = [];
  for (const e of elements) {
    const lat = Number(e.lat ?? (e.center as Record<string, unknown>)?.lat);
    const lon = Number(e.lon ?? (e.center as Record<string, unknown>)?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!insideBbox(lat, lon, bbox)) continue;
    const tags = e.tags as Record<string, unknown> | undefined;
    const val = tags?.building ? 0.8 : tags?.highway ? 0.6 : 0.3;
    const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
    out.push({ x, y, value: val, toolId, category });
  }
  return out;
}

function extractFEMA(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const decls = raw.DisasterDeclarationsSummaries as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(decls)) return [];
  const out: ProjectedPoint[] = [];
  for (const d of decls) {
    const lat = Number(d.incidentLatitude ?? d.latitude ?? d.designatedIncidentLatitude ?? 0);
    const lon = Number(d.incidentLongitude ?? d.longitude ?? d.designatedIncidentLongitude ?? 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!insideBbox(lat, lon, bbox)) continue;
    const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
    out.push({ x, y, value: 0.7, toolId, category });
  }
  return out;
}

function extractUSGSWater(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const value = raw.value as Record<string, unknown> | undefined;
  const lat = Number(raw.latitude ?? 0);
  const lon = Number(raw.longitude ?? 0);
  if (value && insideBbox(lat, lon, bbox)) {
    const q = value['00060'] as Record<string, unknown> | undefined;
    const flow = Number(q?.value ?? 0);
    const val = clamp01(flow / 500000);
    const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
    return [{ x, y, value: val, toolId, category }];
  }
  const sites = raw.sites as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(sites)) {
    return sites
      .map(s => {
        const slat = Number(s.latitude ?? s.lat ?? 0);
        const slon = Number(s.longitude ?? s.lon ?? 0);
        if (!insideBbox(slat, slon, bbox)) return null;
        const { x, y } = projectToLocal(slat, slon, centerLat, centerLon);
        return { x, y, value: 0.5, toolId, category };
      })
      .filter((p): p is ProjectedPoint => p !== null && Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  return [];
}

function extractSinglePoint(
  raw: Record<string, unknown>,
  valueExtractor: (raw: Record<string, unknown>) => number,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const lat = Number(raw.latitude ?? raw.lat);
  const lon = Number(raw.longitude ?? raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (!insideBbox(lat, lon, bbox)) return [];
  const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
  return [{ x, y, value: valueExtractor(raw), toolId, category }];
}

function extractStorms(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const storms = raw.storms as Array<Record<string, unknown>> | undefined;
  const arr = Array.isArray(storms) ? storms : (Array.isArray(raw) ? (raw as unknown as Array<Record<string, unknown>>) : []);
  return arr
    .map(s => {
      const lat = Number(s.lat ?? s.latitude ?? 0);
      const lon = Number(s.lon ?? s.longitude ?? 0);
      if (!insideBbox(lat, lon, bbox)) return null;
      const wind = Number(s.windSpeed ?? s.wind ?? s.maxWinds ?? s.category ?? 0);
      const val = clamp01(wind / 140);
      const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
      return { x, y, value: val, toolId, category };
    })
    .filter((p): p is ProjectedPoint => p !== null && Number.isFinite(p.x));
}

function extractSpaceWeather(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, _bbox: Bbox,
): ProjectedPoint[] {
  const arr = Array.isArray(raw) ? raw : ((raw.notifications as Array<Record<string, unknown>>) ?? []);
  if (arr.length === 0) return [];
  const val = clamp01(arr.length / 20);
  const { x, y } = projectToLocal(centerLat, centerLon, centerLat, centerLon);
  return [{ x, y, value: val, toolId, category }];
}

function extractSentiment(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const spatialPoints = raw.spatial_points as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(spatialPoints)) {
    return spatialPoints
      .map(p => {
        const lat = Number(p.lat ?? 0);
        const lon = Number(p.lon ?? 0);
        if (!insideBbox(lat, lon, bbox)) return null;
        const val = clamp01(Number(p.value ?? 0));
        const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
        return { x, y, value: val, toolId, category };
      })
      .filter((p): p is ProjectedPoint => p !== null && Number.isFinite(p.x));
  }
  return [];
}

function extractRadar(_raw: Record<string, unknown>): ProjectedPoint[] {
  return [];
}

function extractSatellite(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const pts = raw.analyzed_points as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(pts)) {
    return pts
      .map(p => {
        const lat = Number(p.lat ?? p.latitude ?? 0);
        const lon = Number(p.lon ?? p.longitude ?? 0);
        if (!insideBbox(lat, lon, bbox)) return null;
        const val = clamp01(Number(p.value ?? p.confidence ?? 0.5));
        const { x, y } = projectToLocal(lat, lon, centerLat, centerLon);
        return { x, y, value: val, toolId, category };
      })
      .filter((p): p is ProjectedPoint => p !== null && Number.isFinite(p.x));
  }
  return [];
}

function extractPopulation(
  raw: Record<string, unknown>,
  toolId: string, category: string,
  centerLat: number, centerLon: number, bbox: Bbox,
): ProjectedPoint[] {
  const popBbox = raw.bbox as Record<string, unknown> | undefined;
  const totalPop = raw.totalPopulation as number | undefined;
  if (!popBbox || totalPop == null) return [];
  const midLat = (Number(popBbox.latMin ?? 0) + Number(popBbox.latMax ?? 0)) / 2;
  const midLon = (Number(popBbox.lonMin ?? 0) + Number(popBbox.lonMax ?? 0)) / 2;
  if (!insideBbox(midLat, midLon, bbox)) return [];
  const val = clamp01(totalPop / 50000000);
  const { x, y } = projectToLocal(midLat, midLon, centerLat, centerLon);
  return [{ x, y, value: val, toolId, category }];
}

/* Fixed-reference normalizers per domain ----------------------- */

const magNorm        = (v: number) => clamp01(v / 10);          // mag 0→10 → 0→1
const tempDevNorm    = (t: number) => clamp01(Math.abs(t - 22) / 30); // 22°C ideal, ±30°C → 1
const windNorm       = (w: number) => clamp01(w / 140);          // 140 kt = Cat 5
const flowNorm       = (f: number) => clamp01(f / 500000);       // 500k cfs = major flood
const popNorm        = (p: number) => clamp01(p / 50000000);     // 50M = megacity
const aqiNorm        = (a: number) => clamp01(a / 500);          // AQI 500 = hazardous
const precipNorm     = (p: number) => clamp01(p / 2000);         // 2000mm = extreme
const seasonalNorm   = (t: number) => linScale(t, -10, 50);      // -10°C→0, 50°C→1
const gdeltToneNorm  = (t: number) => clamp01(Math.abs(t) / 20); // tone -20→+20 scale

/* ═════════════════════════════════════════════════════════════════
   EXTRACTORS — each maps to a category for category-pooled fusion
   ═════════════════════════════════════════════════════════════════ */

const EXTRACTORS: Record<string, ExtractFn> = {
  earthquakes: (raw, clat, clon, bbox) =>
    extractGeoJSON(raw, 'mag', magNorm, 'earthquakes', 'seismic', clat, clon, bbox),

  seismic_events: (raw, clat, clon, bbox) =>
    extractGeoJSON(raw, 'mag', magNorm, 'seismic_events', 'seismic', clat, clon, bbox),

  weather_forecast: (raw, clat, clon, bbox) =>
    extractSinglePoint(raw, (r) => {
      const t = Number((r.current as Record<string, unknown>)?.temperature_2m ?? r.temperature_2m ?? 20);
      return tempDevNorm(t);
    }, 'weather_forecast', 'weather', clat, clon, bbox),

  storms: (raw, clat, clon, bbox) =>
    extractStorms(raw, 'storms', 'weather', clat, clon, bbox),

  wildfires: (raw, clat, clon, bbox) =>
    extractEONET(raw, 'wildfires', 'fire', clat, clon, bbox),

  firms_fires: (raw, clat, clon, bbox) =>
    extractFIRMS(raw, 'firms_fires', 'fire', clat, clon, bbox),

  floods: (raw, clat, clon, bbox) =>
    extractEONET(raw, 'floods', 'flood', clat, clon, bbox),

  flood_forecast: (raw, clat, clon, bbox) =>
    extractSinglePoint(raw, (r) => {
      const daily = r.daily as Record<string, unknown> | undefined;
      if (!daily) return 0;
      const prob = daily.flood_probability as number[] | undefined;
      return Array.isArray(prob) ? clamp01(Math.max(...prob.filter(Number.isFinite))) : 0;
    }, 'flood_forecast', 'flood', clat, clon, bbox),

  marine: (raw, clat, clon, bbox) =>
    extractSinglePoint(raw, (r) => {
      const daily = r.daily as Record<string, unknown> | undefined;
      if (!daily) return 0;
      const wh = daily.wave_height_max as number[] | undefined;
      return Array.isArray(wh) ? clamp01(Math.max(0, ...wh.filter(Number.isFinite)) / 15) : 0;
    }, 'marine', 'weather', clat, clon, bbox),

  weather_ensemble: (raw, clat, clon, bbox) =>
    extractSinglePoint(raw, (r) => {
      const current = r.current as Record<string, unknown> | undefined;
      if (!current) return 0;
      const t = Number(current.temperature_2m ?? 20);
      return tempDevNorm(t);
    }, 'weather_ensemble', 'weather', clat, clon, bbox),

  seasonal_forecast: (raw, clat, clon, bbox) =>
    extractSinglePoint(raw, (r) => {
      const daily = r.daily as Record<string, unknown> | undefined;
      if (!daily) return 0;
      const tMax = daily.temperature_2m_max as number[] | undefined;
      const avgMax = Array.isArray(tMax) && tMax.length > 0
        ? tMax.filter(Number.isFinite).reduce((a, b) => a + b, 0) / tMax.length : 20;
      return seasonalNorm(avgMax);
    }, 'seasonal_forecast', 'weather', clat, clon, bbox),

  climate_historical: (raw, clat, clon, bbox) =>
    extractSinglePoint(raw, (r) => {
      const daily = r.daily as Record<string, unknown> | undefined;
      if (!daily) return 0;
      const precip = daily.precipitation_sum as number[] | undefined;
      const totalP = Array.isArray(precip) ? precip.filter(Number.isFinite).reduce((a, b) => a + b, 0) : 0;
      return precipNorm(totalP);
    }, 'climate_historical', 'weather', clat, clon, bbox),

  air_quality: (raw, clat, clon, bbox) =>
    extractSinglePoint(raw, (r) => {
      const current = r.current as Record<string, unknown> | undefined;
      const aqi = Number(current?.us_aqi ?? current?.european_aqi ?? 0);
      return aqiNorm(aqi);
    }, 'air_quality', 'hazards', clat, clon, bbox),

  gfs_forecast: (raw, clat, clon, bbox) =>
    extractSinglePoint(raw, (r) => {
      const current = r.current as Record<string, unknown> | undefined;
      if (!current) return 0;
      return windNorm(Number(current.wind_speed_10m ?? 0));
    }, 'gfs_forecast', 'weather', clat, clon, bbox),

  agriculture: (raw, clat, clon, bbox) =>
    extractSinglePoint(raw, (r) => {
      const props = r.properties as Record<string, unknown> | undefined;
      const params = props?.parameter as Record<string, unknown> | undefined;
      const t = params?.T2M as Record<string, number> | undefined;
      const vals = t ? Object.values(t).filter(Number.isFinite) : [];
      const avgT = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 20;
      return tempDevNorm(avgT);
    }, 'agriculture', 'env', clat, clon, bbox),

  radar_fetch: () => [],

  satellite_analyze: (raw, clat, clon, bbox) =>
    extractSatellite(raw, 'satellite_analyze', 'multimodal', clat, clon, bbox),

  sentiment_analyze: (raw, clat, clon, bbox) =>
    extractSentiment(raw, 'sentiment_analyze', 'multimodal', clat, clon, bbox),

  gdelt: (raw, clat, clon, bbox) =>
    extractGDELT(raw, 'gdelt', 'multimodal', clat, clon, bbox),

  space_weather: (raw, clat, clon, bbox) =>
    extractSpaceWeather(raw, 'space_weather', 'multimodal', clat, clon, bbox),

  population: (raw, clat, clon, bbox) =>
    extractPopulation(raw, 'population', 'env', clat, clon, bbox),

  infrastructure: (raw, clat, clon, bbox) =>
    extractOverpass(raw, 'infrastructure', 'env', clat, clon, bbox),

  water_resources: (raw, clat, clon, bbox) =>
    extractUSGSWater(raw, 'water_resources', 'flood', clat, clon, bbox),

  disaster_declarations: (raw, clat, clon, bbox) =>
    extractFEMA(raw, 'disaster_declarations', 'env', clat, clon, bbox),

  predict: (raw, clat, clon, _bbox) => {
    const preds = raw.predictions as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(preds)) return [];
    return preds.map(p => {
      const prob = clamp01(Number(p.probability ?? 0.5));
      const { x, y } = projectToLocal(clat, clon, clat, clon);
      return { x, y, value: prob, toolId: 'predict', category: 'ml' };
    });
  },
};

/* ═════════════════════════════════════════════════════════════════
   FUSION ENGINE — category-pooled: per-category max per cell,
   then max across categories.  No per-tool weights — every
   category contributes at most one value per cell.
   ═════════════════════════════════════════════════════════════════ */

export function computeFusedSurface(
  toolResults: Record<string, Record<string, unknown>>,
  bbox: Bbox,
): InterpPoint[] {
  const centerLat = (bbox.latMin + bbox.latMax) / 2;
  const centerLon = (bbox.lonMin + bbox.lonMax) / 2;
  const latSpan = (bbox.latMax - bbox.latMin) * Math.PI / 180 * EARTH_RADIUS_M;
  const lonSpan = (bbox.lonMax - bbox.lonMin) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(centerLat * Math.PI / 180);
  const bboxAreaM2 = Math.abs(latSpan * lonSpan);

  /* Step 1 — group extracted points by category */
  const byCat = new Map<string, ProjectedPoint[]>();
  for (const [toolId, raw] of Object.entries(toolResults)) {
    const extract = EXTRACTORS[toolId];
    if (!extract) continue;
    try {
      const pts = extract(raw, centerLat, centerLon, bbox);
      for (const p of pts) {
        const cat = p.category;
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat)!.push(p);
      }
    } catch { /* skip */ }
  }
  if (byCat.size === 0) return [];

  /* Step 2 — per-category decluster (max per cell within category) */
  let totalPoints = 0;
  byCat.forEach(pt => { totalPoints += pt.length; });
  const avgCellArea = Math.max(4e6, bboxAreaM2 / Math.max(1, totalPoints));
  const cellSize = Math.sqrt(avgCellArea);

  const cellMaxes = new Map<string, number>();   // cellKey → max across categories
  byCat.forEach(points => {
    const catBins = new Map<string, number>();     // cellKey → max within this category
    for (const p of points) {
      const bx = Math.floor(p.x / cellSize);
      const by = Math.floor(p.y / cellSize);
      const key = `${bx},${by}`;
      const existing = catBins.get(key) ?? 0;
      catBins.set(key, Math.max(existing, p.value));
    }
    /* Merge into global: per cell, take max across categories */
    catBins.forEach((catVal, key) => {
      const existing = cellMaxes.get(key) ?? 0;
      cellMaxes.set(key, Math.max(existing, catVal));
    });
  });

  /* Step 3 — convert cells to InterpPoint[] */
  const centerLatR = centerLat * Math.PI / 180;
  const out: InterpPoint[] = [];
  cellMaxes.forEach((value, key) => {
    const [bx, by] = key.split(',').map(Number);
    const cx = (bx + 0.5) * cellSize;
    const cy = (by + 0.5) * cellSize;
    out.push({
      lat: centerLat + (cy / EARTH_RADIUS_M) * (180 / Math.PI),
      lon: centerLon + (cx / (EARTH_RADIUS_M * Math.cos(centerLatR))) * (180 / Math.PI),
      value: clamp01(value),
    });
  });
  return out;
}

export function computeToolRiskSummary(
  toolResults: Record<string, Record<string, unknown>>,
  bbox: Bbox,
): Record<string, number> {
  const centerLat = (bbox.latMin + bbox.latMax) / 2;
  const centerLon = (bbox.lonMin + bbox.lonMax) / 2;
  const summary: Record<string, number> = {};
  for (const [toolId, raw] of Object.entries(toolResults)) {
    const extract = EXTRACTORS[toolId];
    if (!extract) continue;
    try {
      const pts = extract(raw, centerLat, centerLon, bbox);
      if (pts.length > 0) {
        summary[toolId] = clamp01(Math.max(...pts.map(p => p.value)));
      }
    } catch { /* skip */ }
  }
  return summary;
}
