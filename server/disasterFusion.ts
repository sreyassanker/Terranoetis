/**
 * Tool Workbench Fusion Pipeline — server-side
 *
 * Runs the EXACT same chain as the client Tool Workbench:
 * fetch → extractEvidence → physics surrogates → causal propagation → GIS fusion
 *
 * Reuses the same pure-TS modules from src/rendering/ so the result is identical
 * whether you click "Run Chain" in the Workbench or type the AI command.
 */

import { logger } from './observability/logger';
import {
  computeCausalProbabilities, computeFullCausalState, extractEvidence, getToolIO,
} from '../src/rendering/causalGraph';
import {
  computeLiquefaction, computeDispersion, computeWildfireSpread, computeFloodRouting,
} from '../src/rendering/physicsSurrogates';
import { computeFusedSurface } from '../src/rendering/gisFusion';

const PORT = Number(process.env.PROXY_PORT ?? 3001);

const DEFAULT_TOOL_CHAIN = [
  // Exact same auto-populated chain as the Tool Workbench:
  // AVAILABLE_TOOLS minus predict, radar_fetch, space_weather (22 tools).
  'earthquakes', 'seismic_events', 'weather_forecast', 'storms', 'firms_fires',
  'wildfires', 'floods', 'flood_forecast', 'marine', 'weather_ensemble',
  'seasonal_forecast', 'climate_historical', 'gfs_forecast', 'air_quality',
  'agriculture', 'water_resources', 'disaster_declarations', 'satellite_analyze',
  'sentiment_analyze', 'gdelt', 'population', 'infrastructure',
];

interface FusionInput {
  latMin: number; latMax: number; lonMin: number; lonMax: number;
}

export interface FusionResult {
  /** Per-tool cumulative evidence after the chain */
  cumulativeEvidence: Record<string, number>;
  /** Causal probabilities (tool → probability) */
  causalProbs: Record<string, number>;
  /** Full causal state including topological order */
  causalState: { topoOrder: string[]; beliefs: Record<string, unknown>; variance: Record<string, number>; informationGain: number };
  /** Fused risk surface points (for the globe heatmap) */
  fusedPoints: Array<{ lat: number; lon: number; value: number }>;
  /** Text summary of the fused risk */
  summary: string;
}

export async function runFusionPipeline(input: FusionInput): Promise<FusionResult> {
  const { latMin, latMax, lonMin, lonMax } = input;
  const midLat = (latMin + latMax) / 2;
  const midLon = (lonMin + lonMax) / 2;
  const base = `http://127.0.0.1:${PORT}`;
  const bbox = { latMin, latMax, lonMin, lonMax };

  const cumulativeEvidence: Record<string, number> = {};
  const toolRawResults: Record<string, Record<string, unknown>> = {};
  const duplicateTools = new Set<string>();

  for (const step of DEFAULT_TOOL_CHAIN) {
    try {
      // Build params with bbox
      const params = { lat: midLat, lon: midLon, latMin, latMax, lonMin, lonMax };

      // Inject cumulative evidence from upstream tools
      const io = getToolIO(step);
      if (io) {
        for (const input of io.inputs) {
          if (cumulativeEvidence[input] !== undefined) (params as Record<string, unknown>)[input] = cumulativeEvidence[input];
        }
      }

      // Fetch data from the same API endpoints the Workbench uses
      const directPath = DIRECT_API_PATHS[step];
      if (!directPath) continue;

      const url = `${base}${directPath}${buildQuery(step, params)}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) { logger.warn({ step, status: resp.status }, 'Fusion fetch failed'); continue; }
      const rawResult = await resp.json() as Record<string, unknown>;
      if (!rawResult || typeof rawResult !== 'object') continue;

      const isDuplicate = step === 'seismic_events' && duplicateTools.has('earthquakes');
      duplicateTools.add(step);
      if (isDuplicate) continue;

      toolRawResults[step] = rawResult;

      // Extract evidence (same as Workbench's extractEvidence call)
      const evidence = extractEvidence(rawResult, step);
      Object.assign(cumulativeEvidence, evidence);

      // Compute composite risk (same as Workbench)
      const evidenceValues = Object.entries(evidence)
        .filter(([k]) => !k.startsWith('_'))
        .map(([, v]) => typeof v === 'number' ? v : 0)
        .filter(v => v > 0);
      if (evidenceValues.length > 0) {
        const sorted = [...evidenceValues].sort((a, b) => b - a);
        const topK = sorted.slice(0, Math.min(3, sorted.length));
        const composite = topK.reduce((s, v) => s + v, 0) / topK.length;
        cumulativeEvidence[step] = Math.min(1, Math.max(0.01, composite));
      } else if (evidence._composite !== undefined) {
        cumulativeEvidence[step] = evidence._composite;
      }

      // Field-level evidence (same as Workbench's tool-specific extraction)
      if (step === 'weather_forecast') {
        const current = (rawResult.current ?? rawResult.current_weather) as Record<string, unknown> | undefined;
        const t = current?.temperature_2m ?? (rawResult as Record<string, unknown>).temperature;
        const w = current?.wind_speed_10m ?? (rawResult as Record<string, unknown>).windspeed;
        const h = current?.relative_humidity_2m;
        if (t !== undefined) { cumulativeEvidence['temperature'] = Number(t); cumulativeEvidence['temp'] = Number(t); }
        if (w !== undefined) cumulativeEvidence['windSpeed'] = Number(w);
        if (h !== undefined) cumulativeEvidence['humidity'] = Number(h);
      }

      // Physics surrogates (same as Workbench's runPhysicsForStep)
      runPhysicsForStep(step, cumulativeEvidence, params);

    } catch (e) {
      logger.warn({ err: e, step }, 'Fusion step failed — continuing');
    }
  }

  // Causal propagation (same as Workbench)
  const loc = { lat: midLat, lon: midLon };
  const causalProbs = computeCausalProbabilities(cumulativeEvidence, true, loc);
  const causalState = computeFullCausalState(cumulativeEvidence, loc);

  // ── Same display filter as the Tool Workbench ──
  // The Workbench only surfaces nodes that are in the chain
  // (chainTools.has(k)) — never ghost nodes like "predict"/"sentiment"
  // that were never fetched. Apply the identical filter so the email
  // output matches the Workbench exactly.
  const chainTools = new Set(DEFAULT_TOOL_CHAIN);
  const filteredProbs: Record<string, number> = {};
  for (const [id, prob] of Object.entries(causalProbs)) {
    if (id === '_composite' || id === '_confidence') continue;
    if (chainTools.has(id)) filteredProbs[id] = prob;
  }

  // GIS fusion (same as Workbench's computeFusedSurface)
  let fusedPoints: Array<{ lat: number; lon: number; value: number }> = [];
  try {
    const projected = computeFusedSurface(toolRawResults, bbox);
    fusedPoints = projected.map(p => ({ lat: p.lat, lon: p.lon, value: p.value }));
  } catch (e) {
    logger.warn({ err: e }, 'GIS fusion failed — no surface');
  }

  // Build summary — only chain hazards (same as Workbench)
  const topHazards = Object.entries(filteredProbs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tool, prob]) => `${tool} ${(prob * 100).toFixed(0)}%`)
    .join(', ');
  const summary = `Fused risk assessment: ${Object.keys(filteredProbs).length} hazard types analyzed. Top risks: ${topHazards || 'no significant risk detected'}. Evidence from ${Object.keys(toolRawResults).length} data sources. Risk surface: ${fusedPoints.length} points.`;

  return { cumulativeEvidence, causalProbs: filteredProbs, causalState, fusedPoints, summary };
}

function runPhysicsForStep(toolId: string, evidence: Record<string, number>, params: Record<string, unknown>): void {
  if ((toolId === 'earthquakes' || toolId === 'seismic_events') && (evidence.earthquakes > 0.01 || evidence.seismic_events > 0.01)) {
    const pga = (params.pga_gal as number) ?? 200;
    const depth = (params.depth_km as number) ?? 10;
    const r = computeLiquefaction({ peakGroundAccel: pga / 981, totalStress: depth * 18, effectiveStress: depth * 12, depth, sptBlowCount: (params.spt_blowcount as number) ?? 15, finesContent: 20 });
    evidence.liquefaction = r.probLiquefaction;
  }
  if (toolId === 'weather_forecast' && evidence.weather_forecast > 0.01) {
    const r = computeDispersion({ emissionRate: 10000, windSpeed: (params.windSpeed as number) ?? 5, windDirection: (params.windDir as number) ?? 270, stackHeight: 50, plumeRise: 30, downwindDist: 5000, crosswindDist: 0, solarRadiation: 300, cloudCover: 3 });
    evidence.dispersion = r.maxConcentration / 1000;
  }
  if (toolId === 'wildfires' && evidence.wildfires > 0.01) {
    const r = computeWildfireSpread({ windSpeed: (params.windSpeed as number) ?? 20, slope: 10, fuelMoisture: 8, deadFuelMoisture: 8, relativeHumidity: (params.humidity as number) ?? 30, temperature: (params.temperature as number) ?? 30, windDirection: 0 });
    evidence.wildfireSpread = r.ros / 100;
  }
  if ((toolId === 'floods' || toolId === 'flood_forecast') && (evidence.floods > 0.01 || evidence.flood_forecast > 0.01)) {
    const r = computeFloodRouting({ discharge: (params.discharge as number) ?? 500, channelWidth: 50, channelSlope: 0.001, manningRoughness: 0.035, channelLength: 1000 });
    evidence.floodDepth = r.depth / 10;
  }
}

// Tool → API endpoint mapping (same as Tool Workbench's DIRECT_API)
const DIRECT_API_PATHS: Record<string, string> = {
  earthquakes: '/api/earthquakes',
  weather_forecast: '/api/weather/open-meteo',
  wildfires: '/api/eonet',
  floods: '/api/eonet',
  firms_fires: '/api/firms',
  seismic_events: '/api/earthquakes',
  storms: '/api/weather/nhc',
  flood_forecast: '/api/weather/flood',
  marine: '/api/weather/marine',
  air_quality: '/api/weather/air-quality',
  gfs_forecast: '/api/weather/gfs',
  population: '/api/population/worldpop',
  space_weather: '/api/space-weather/donki',
};

function buildQuery(toolId: string, params: Record<string, unknown>): string {
  const p = params as Record<string, unknown>;
  const lat = p.lat ?? 35; const lon = p.lon ?? 140;
  const latMin = p.latMin; const latMax = p.latMax; const lonMin = p.lonMin; const lonMax = p.lonMax;
  switch (toolId) {
    case 'earthquakes':
    case 'seismic_events':
      return `?minLat=${latMin ?? lat}&maxLat=${latMax ?? Number(lat) + 10}&minLon=${lonMin ?? lon}&maxLon=${lonMax ?? Number(lon) + 10}&hours=168`;
    case 'weather_forecast':
      return `?lat=${lat}&lon=${lon}`;
    case 'wildfires':
      return `?category=wildfires&status=open&limit=20${latMin != null ? `&bbox=${lonMin},${latMin},${lonMax},${latMax}` : ''}`;
    case 'floods':
      return `?category=floods&status=open&limit=20${latMin != null ? `&bbox=${lonMin},${latMin},${lonMax},${latMax}` : ''}`;
    case 'firms_fires':
      return latMin != null ? `?latMin=${latMin}&latMax=${latMax}&lonMin=${lonMin}&lonMax=${lonMax}` : `?lat=${lat}&lon=${lon}&radius=5`;
    case 'storms':
      return latMin != null ? `?latMin=${latMin}&latMax=${latMax}&lonMin=${lonMin}&lonMax=${lonMax}` : '';
    case 'flood_forecast':
    case 'marine':
    case 'air_quality':
    case 'gfs_forecast':
      return `?lat=${lat}&lon=${lon}`;
    case 'population':
      return latMin != null ? `?latMin=${latMin}&latMax=${latMax}&lonMin=${lonMin}&lonMax=${lonMax}` : `?latMin=${Number(lat) - 5}&latMax=${Number(lat) + 5}&lonMin=${Number(lon) - 5}&lonMax=${Number(lon) + 5}`;
    case 'space_weather':
      return '';
    default:
      return '';
  }
}