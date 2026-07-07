import type { InterpPoint } from './idwInterpolation';

export function extractPointsFromResult(toolId: string, resultJson: string): InterpPoint[] {
  let data: Record<string, unknown>;
  try { data = JSON.parse(resultJson); } catch { return []; }

  if (data?.error) return [];

  const result = (data?.result as Record<string, unknown>) || data;
  if (!result) return [];

  // Fused mode: points are pre-extracted by the ToolWorkbench chain executor
  if ((data as Record<string, unknown>)?._surfaceMode === 'fused') {
    return extractFusedPoints(result);
  }

  switch (toolId) {
    case 'earthquakes':
    case 'seismic_events':
      return extractGeoJSONPoints(result);
    case 'weather_forecast':
    case 'weather_ensemble':
    case 'gfs_forecast':
      return extractWeatherPoints(result);
    case 'storms':
      return extractStormsPoints(result);
    case 'wildfires':
    case 'floods':
      return extractGeoJSONPoints(result);
    case 'firms_fires':
      return extractFIRMSPoints(result);
    case 'satellite_analyze':
      return extractSatellitePoints(result);
    case 'flood_forecast':
      return extractFloodForecastPoints(result);
    case 'marine':
      return extractMarinePoints(result);
    case 'seasonal_forecast':
    case 'climate_historical':
      return extractClimatePoints(result);
    case 'air_quality':
      return extractAirQualityPoints(result);
    case 'agriculture':
      return extractAgriculturePoints(result);
    case 'gdelt':
      return extractGDELTPoints(result);
    case 'population':
      return extractPopulationPoints(result);
    case 'space_weather':
      return extractSpaceWeatherPoints(result);
    case 'infrastructure':
      return extractInfrastructurePoints(result);
    case 'water_resources':
      return extractWaterResourcesPoints(result);
    case 'disaster_declarations':
      return extractDisasterDeclarationsPoints(result);
    case 'sentiment_analyze':
      return extractSentimentPoints(result);
    case 'radar_fetch':
      return extractRadarPoints(result);
    case 'fused':
      return extractFusedPoints(result);
    default:
      return [];
  }
}

function extractGeoJSONPoints(result: Record<string, unknown>): InterpPoint[] {
  const features = result?.features as Array<Record<string, unknown>> | undefined;
  if (!features) return [];
  const points: InterpPoint[] = [];
  for (const f of features) {
    const coords = (f?.geometry as Record<string, unknown>)?.coordinates as number[] | undefined;
    if (!coords || coords.length < 2) continue;
    const lon = coords[0];
    const lat = coords[1];
    const props = f?.properties as Record<string, unknown> | undefined;
    const value = (props?.mag ?? props?.confidence ?? 0.5) as number;
    points.push({ lat, lon, value });
  }
  return points;
}

function extractWeatherPoints(result: Record<string, unknown>): InterpPoint[] {
  const lat = (result?.latitude ?? 35) as number;
  const lon = (result?.longitude ?? 140) as number;
  const current = result?.current as Record<string, unknown> | undefined;
  const cw = result?.current_weather as Record<string, unknown> | undefined;
  const value = (current?.temperature_2m ?? cw?.temperature ?? result?.temperature_2m ?? result?.temperature ?? 20) as number;
  return [{ lat, lon, value }];
}

function extractStormsPoints(result: Record<string, unknown>): InterpPoint[] {
  const storms = (result?.storms as Array<Record<string, unknown>>) || (Array.isArray(result) ? result as unknown as Array<Record<string, unknown>> : undefined);
  if (!storms) return [];
  return storms.map(s => ({
    lat: (s.lat ?? s.latitude ?? 0) as number,
    lon: (s.lon ?? s.longitude ?? 0) as number,
    value: (s.windSpeed ?? s.wind ?? s.category ?? 1) as number,
  }));
}

function extractFIRMSPoints(result: Record<string, unknown>): InterpPoint[] {
  const features = (result?.features as Array<Record<string, unknown>>) || (Array.isArray(result) ? result as unknown as Array<Record<string, unknown>> : undefined);
  if (!features) return [];
  return features.map(f => {
    const coords = ((f?.geometry as Record<string, unknown>)?.coordinates as number[]) || (f as unknown as number[]);
    return {
      lat: coords[1] ?? 0,
      lon: coords[0] ?? 0,
      value: ((f?.properties as Record<string, unknown>)?.frp ?? (f?.properties as Record<string, unknown>)?.brightness ?? 1) as number,
    };
  });
}

function extractSatellitePoints(result: Record<string, unknown>): InterpPoint[] {
  const pts = (result?.analyzed_points as Array<Record<string, unknown>>) || (result?.classification as Array<Record<string, unknown>>) || [];
  return pts.map(p => ({
    lat: (p.lat ?? p.latitude ?? 0) as number,
    lon: (p.lon ?? p.longitude ?? 0) as number,
    value: (p.value ?? p.confidence ?? p.class ?? 0.5) as number,
  }));
}

function extractFloodForecastPoints(result: Record<string, unknown>): InterpPoint[] {
  const daily = result?.daily as Record<string, unknown> | undefined;
  if (!daily) return [];
  const lat = (result?.latitude ?? 35) as number;
  const lon = (result?.longitude ?? 140) as number;
  const prob = daily.flood_probability as number[] | undefined;
  const maxProb = Array.isArray(prob) ? Math.max(...prob.filter(Number.isFinite)) : 0.5;
  return [{ lat, lon, value: Math.min(1, maxProb) }];
}

function extractMarinePoints(result: Record<string, unknown>): InterpPoint[] {
  const daily = result?.daily as Record<string, unknown> | undefined;
  if (!daily) return [];
  const lat = (result?.latitude ?? 35) as number;
  const lon = (result?.longitude ?? 140) as number;
  const wh = daily.wave_height_max as number[] | undefined;
  const maxWave = Array.isArray(wh) ? Math.max(...wh.filter(Number.isFinite)) : 0;
  return [{ lat, lon, value: Math.min(1, maxWave / 20) }];
}

function extractClimatePoints(result: Record<string, unknown>): InterpPoint[] {
  const daily = result?.daily as Record<string, unknown> | undefined;
  if (!daily) return [];
  const lat = (result?.latitude ?? 35) as number;
  const lon = (result?.longitude ?? 140) as number;
  const precip = daily.precipitation_sum as number[] | undefined;
  const totalP = Array.isArray(precip) ? precip.filter(Number.isFinite).reduce((a, b) => a + b, 0) : 0;
  return [{ lat, lon, value: Math.min(1, totalP / 500) }];
}

function extractAirQualityPoints(result: Record<string, unknown>): InterpPoint[] {
  const current = result?.current as Record<string, unknown> | undefined;
  if (!current) return [];
  const lat = (result?.latitude ?? 35) as number;
  const lon = (result?.longitude ?? 140) as number;
  const aqi = (current.us_aqi ?? current.european_aqi ?? 50) as number;
  return [{ lat, lon, value: Math.min(1, aqi / 500) }];
}

function extractAgriculturePoints(result: Record<string, unknown>): InterpPoint[] {
  const props = result?.properties as Record<string, unknown> | undefined;
  const lat = (result?.latitude ?? 35) as number;
  const lon = (result?.longitude ?? 140) as number;
  if (props) {
    const temp = (props.T2M ?? 20) as number;
    return [{ lat, lon, value: Math.min(1, Math.max(0, (temp + 10) / 60)) }];
  }
  return [{ lat, lon, value: 0.5 }];
}

function extractGDELTPoints(result: Record<string, unknown>): InterpPoint[] {
  const articles = result?.articles as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(articles)) return [];
  return articles.map(a => ({
    lat: parseFloat(String(a.lat ?? a.latitude ?? 0)) || 0,
    lon: parseFloat(String(a.lon ?? a.longitude ?? 0)) || 0,
    value: Math.min(1, Math.max(0, (Number(a.tone ?? a.averagetone ?? 0) + 100) / 200)),
  })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

function extractPopulationPoints(result: Record<string, unknown>): InterpPoint[] {
  const latMin = ((result?.bbox as Record<string, unknown>)?.latMin as number) ?? 35;
  const latMax = ((result?.bbox as Record<string, unknown>)?.latMax as number) ?? 45;
  const lonMin = ((result?.bbox as Record<string, unknown>)?.lonMin as number) ?? -120;
  const lonMax = ((result?.bbox as Record<string, unknown>)?.lonMax as number) ?? -110;
  const pop = (result?.totalPopulation ?? 0) as number;
  const midLat = (latMin + latMax) / 2;
  const midLon = (lonMin + lonMax) / 2;
  return [{ lat: midLat, lon: midLon, value: Math.min(1, pop / 10000000) }];
}

function extractSpaceWeatherPoints(result: Record<string, unknown>): InterpPoint[] {
  const arr = Array.isArray(result) ? result : (result?.notifications as Array<Record<string, unknown>>) ?? [];
  if (arr.length === 0) return [];
  const severity = Math.min(1, arr.length / 20);
  return [{ lat: 0, lon: 0, value: severity }];
}

function extractInfrastructurePoints(result: Record<string, unknown>): InterpPoint[] {
  const elements = result?.elements as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(elements)) return [];
  return elements.filter(e => {
    const lat = (e?.lat as number) ?? ((e?.center as Record<string, unknown>)?.lat as number);
    const lon = (e?.lon as number) ?? ((e?.center as Record<string, unknown>)?.lon as number);
    return Number.isFinite(lat) && Number.isFinite(lon);
  }).map(e => {
    const tags = e.tags as Record<string, unknown> | undefined;
    return {
      lat: (e?.lat as number) ?? ((e?.center as Record<string, unknown>)?.lat as number),
      lon: (e?.lon as number) ?? ((e?.center as Record<string, unknown>)?.lon as number),
      value: tags?.building ? 0.8 : tags?.highway ? 0.6 : 0.3,
    };
  });
}

function extractWaterResourcesPoints(result: Record<string, unknown>): InterpPoint[] {
  const value = result?.value as Record<string, unknown> | undefined;
  const lat = (result?.latitude ?? 35) as number;
  const lon = (result?.longitude ?? 140) as number;
  if (value) {
    const q = value['00060'] as Record<string, unknown> | undefined;
    const flow = Number(q?.value ?? 0);
    return [{ lat, lon, value: Math.min(1, flow / 100000) }];
  }
  const sites = result?.sites as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(sites)) {
    return sites.map(s => ({
      lat: Number(s.latitude ?? s.lat ?? 0),
      lon: Number(s.longitude ?? s.lon ?? 0),
      value: 0.5,
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }
  return [];
}

function extractDisasterDeclarationsPoints(result: Record<string, unknown>): InterpPoint[] {
  const declarations = result?.DisasterDeclarationsSummaries as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(declarations)) return [];
  return declarations.map(d => ({
    lat: parseFloat(String(d.latitude ?? 0)) || 0,
    lon: parseFloat(String(d.longitude ?? 0)) || 0,
    value: 0.7,
  })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

function extractSentimentPoints(result: Record<string, unknown>): InterpPoint[] {
  // Extract spatial points from sentiment analysis
  const spatialPoints = result?.spatial_points as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(spatialPoints)) {
    return spatialPoints.map(p => ({
      lat: Number(p.lat ?? 0),
      lon: Number(p.lon ?? 0),
      value: Math.min(1, Math.max(0, Number(p.value ?? 0))),
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }
  return [];
}

function extractRadarPoints(_result: Record<string, unknown>): InterpPoint[] {
  // Rainviewer returns radar tile URLs; we can't extract spatial points from this
  // Return empty since radar data is tile-based, not point-based
  return [];
}

/** Extract pre-accumulated fused points from the ToolWorkbench chain executor */
function extractFusedPoints(result: Record<string, unknown>): InterpPoint[] {
  const features = result?.features as Array<Record<string, unknown>> | undefined;
  if (!features) return [];
  const points: InterpPoint[] = [];
  for (const f of features) {
    const coords = (f?.geometry as Record<string, unknown>)?.coordinates as number[] | undefined;
    if (!coords || coords.length < 2) continue;
    const lon = coords[0];
    const lat = coords[1];
    const props = (f?.properties ?? {}) as Record<string, unknown>;
    const value = (props.value ?? props.mag ?? 0.5) as number;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(value)) {
      points.push({ lat, lon, value });
    }
  }
  return points;
}
