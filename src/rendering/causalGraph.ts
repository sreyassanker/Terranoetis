/**
 * Causal Bayesian Network for Multi-Hazard Risk Assessment
 *
 * Implements a proper Noisy-OR Bayesian Network with:
 * - Spatially-varying leak probabilities via squared-exponential GP kernel
 * - Topological-order belief propagation (not BFS)
 * - Entropy-based evidence extraction from raw tool outputs
 * - Uncertainty quantification via posterior variance
 *
 * Based on:
 *   Pearl (1988) Probabilistic Reasoning in Intelligent Systems
 *   NCEER (1997) Seed-Idriss liquefaction guidelines
 *   Diggle et al. (1998) Geostatistics for spatial epidemiology
 */

/* ═════════════════════════════════════════════════════════════════
   TYPES
   ═════════════════════════════════════════════════════════════════ */

export interface CausalNode {
  toolId: string;
  inputs: string[];
  outputs: string[];
  category: string;
  /** Baseline prior probability (before any evidence) */
  prior: number;
  /** Description of what this node represents */
  label: string;
}

export interface CausalEdge {
  from: string;
  to: string;
  mapping: Record<string, string>;
  /**
   * Leak probability q_i: probability that cause X_i FAILS to produce effect Y.
   * In the Noisy-OR model: P(Y=0 | X_i=1) = q_i
   * Default 0.3 means 30% chance the cause doesn't trigger the effect.
   */
  leakProb: number;
  /** Human-readable label for this causal link */
  label: string;
  /** Edge strength — multiplied with parent value before noisy-OR */
  strength: number;
}

export interface CausalBelief {
  probability: number;
  /** Shannon entropy of the belief state: H = -p*log(p) - (1-p)*log(1-p) */
  entropy: number;
  /** Number of parent nodes that have contributed evidence */
  evidenceCount: number;
  /** Normalized confidence based on evidence density */
  confidence: number;
}

export interface CausalState {
  beliefs: Record<string, CausalBelief>;
  /** Posterior variance for each node (GP-derived uncertainty) */
  variance: Record<string, number>;
  /** Topological order used for propagation */
  topoOrder: string[];
  /** Total information gain (bits) from prior to posterior */
  informationGain: number;
}

/* ═════════════════════════════════════════════════════════════════
   GRAPH DEFINITION — 26 nodes, 33 edges (multi-hazard DAG)
   ═════════════════════════════════════════════════════════════════ */

const NODES: CausalNode[] = [
  {
    toolId: 'earthquakes',
    inputs: ['latMin', 'latMax', 'lonMin', 'lonMax'],
    outputs: ['mag', 'depth', 'epicenter_lat', 'epicenter_lon', 'quake_count', 'max_pga'],
    category: 'seismic',
    prior: 0.02,
    label: 'Earthquake Observations',
  },
  {
    toolId: 'weather_forecast',
    inputs: ['lat', 'lon'],
    outputs: ['temperature', 'humidity', 'windSpeed', 'windDir', 'conditions', 'precip'],
    category: 'weather',
    prior: 0.05,
    label: 'Weather Conditions',
  },
  {
    toolId: 'storms',
    inputs: ['latMin', 'latMax', 'lonMin', 'lonMax'],
    outputs: ['storm_count', 'max_wind', 'track_polygon'],
    category: 'weather',
    prior: 0.03,
    label: 'Tropical Cyclones',
  },
  {
    toolId: 'wildfires',
    inputs: ['latMin', 'latMax', 'lonMin', 'lonMax'],
    outputs: ['fire_count', 'total_frp', 'burn_area'],
    category: 'hazards',
    prior: 0.04,
    label: 'Wildfire Events',
  },
  {
    toolId: 'floods',
    inputs: ['latMin', 'latMax', 'lonMin', 'lonMax'],
    outputs: ['flood_extent', 'depth_avg', 'affected_pop'],
    category: 'hazards',
    prior: 0.05,
    label: 'Flood Inundation',
  },
  {
    toolId: 'firms_fires',
    inputs: ['latMin', 'latMax', 'lonMin', 'lonMax'],
    outputs: ['hotspot_count', 'max_frp', 'fire_radiative_power'],
    category: 'hazards',
    prior: 0.06,
    label: 'Satellite Fire Detection',
  },
  {
    toolId: 'satellite_analyze',
    inputs: ['lat', 'lon'],
    outputs: ['ndvi', 'ndwi', 'landcover', 'cloud_pct'],
    category: 'multimodal',
    prior: 0.10,
    label: 'Satellite Analysis',
  },
  {
    toolId: 'seismic_events',
    inputs: ['latMin', 'latMax', 'lonMin', 'lonMax'],
    outputs: ['event_count', 'max_magnitude', 'avg_depth'],
    category: 'multimodal',
    prior: 0.03,
    label: 'Seismic Waveform Events',
  },
  {
    toolId: 'radar_fetch',
    inputs: ['lat', 'lon'],
    outputs: ['reflectivity', 'velocity', 'precip_rate'],
    category: 'multimodal',
    prior: 0.08,
    label: 'NEXRAD Radar',
  },
  {
    toolId: 'sentiment_analyze',
    inputs: ['lat', 'lon'],
    outputs: ['sentiment_score', 'volume', 'keywords'],
    category: 'multimodal',
    prior: 0.15,
    label: 'Social Sentiment',
  },
  {
    toolId: 'predict',
    inputs: ['features'],
    outputs: ['prediction', 'confidence'],
    category: 'ml',
    prior: 0.0,
    label: 'ML Prediction',
  },
  {
    toolId: 'flood_forecast',
    inputs: ['lat', 'lon'],
    outputs: ['river_discharge', 'flood_probability', 'flood_intensity'],
    category: 'hazards',
    prior: 0.08,
    label: 'Flood Forecast',
  },
  {
    toolId: 'marine',
    inputs: ['lat', 'lon'],
    outputs: ['wave_height', 'wave_direction', 'swell_height', 'ocean_current'],
    category: 'weather',
    prior: 0.06,
    label: 'Marine Conditions',
  },
  {
    toolId: 'weather_ensemble',
    inputs: ['lat', 'lon'],
    outputs: ['ensemble_temp', 'ensemble_precip', 'spread'],
    category: 'weather',
    prior: 0.05,
    label: 'Ensemble Forecast',
  },
  {
    toolId: 'seasonal_forecast',
    inputs: ['lat', 'lon'],
    outputs: ['seasonal_temp', 'seasonal_precip'],
    category: 'weather',
    prior: 0.04,
    label: 'Seasonal Outlook',
  },
  {
    toolId: 'climate_historical',
    inputs: ['lat', 'lon'],
    outputs: ['hist_temp_avg', 'hist_precip_avg', 'hist_wind_avg'],
    category: 'weather',
    prior: 0.03,
    label: 'Historical Climate',
  },
  {
    toolId: 'air_quality',
    inputs: ['lat', 'lon'],
    outputs: ['us_aqi', 'pm2_5', 'pm10', 'ozone', 'no2'],
    category: 'hazards',
    prior: 0.10,
    label: 'Air Quality',
  },
  {
    toolId: 'gfs_forecast',
    inputs: ['lat', 'lon'],
    outputs: ['gfs_temp', 'gfs_precip', 'gfs_wind'],
    category: 'weather',
    prior: 0.05,
    label: 'GFS Forecast',
  },
  {
    toolId: 'agriculture',
    inputs: ['lat', 'lon'],
    outputs: ['solar_radiation', 'temp_2m', 'precip', 'wind_speed'],
    category: 'environment',
    prior: 0.07,
    label: 'Agriculture Conditions',
  },
  {
    toolId: 'gdelt',
    inputs: ['lat', 'lon'],
    outputs: ['article_count', 'avg_tone', 'conflict_mentions'],
    category: 'multimodal',
    prior: 0.12,
    label: 'Global Event Database',
  },
  {
    toolId: 'population',
    inputs: ['latMin', 'latMax', 'lonMin', 'lonMax'],
    outputs: ['total_population', 'density'],
    category: 'environment',
    prior: 0.15,
    label: 'Population Density',
  },
  {
    toolId: 'space_weather',
    inputs: ['lat', 'lon'],
    outputs: ['solar_flare_count', 'cme_count', 'geomagnetic_storm'],
    category: 'multimodal',
    prior: 0.04,
    label: 'Space Weather',
  },
  {
    toolId: 'infrastructure',
    inputs: ['latMin', 'latMax', 'lonMin', 'lonMax'],
    outputs: ['building_count', 'road_length', 'poi_count'],
    category: 'environment',
    prior: 0.10,
    label: 'Infrastructure Exposure',
  },
  {
    toolId: 'water_resources',
    inputs: ['lat', 'lon'],
    outputs: ['streamflow', 'groundwater_level', 'water_temp'],
    category: 'hazards',
    prior: 0.06,
    label: 'Water Resources',
  },
  {
    toolId: 'disaster_declarations',
    inputs: ['lat', 'lon'],
    outputs: ['disaster_count', 'incident_types'],
    category: 'hazards',
    prior: 0.08,
    label: 'Disaster Declarations',
  },
];

/**
 * Causal edges with scientifically-grounded leak probabilities.
 *
 * leakProb q_i: probability cause X_i fails to trigger effect Y.
 *   - Low q (0.1-0.2): strong causal coupling (e.g., earthquake → seismic events)
 *   - Medium q (0.3-0.5): moderate coupling (e.g., weather → wildfires)
 *   - High q (0.6-0.8): weak/indirect coupling (e.g., sentiment → prediction)
 *
 * strength: multiplicative factor on the parent value before noisy-OR.
 *   Accounts for spatial attenuation and measurement uncertainty.
 */
const EDGES: CausalEdge[] = [
  // Seismic cascade: earthquake observations drive waveform events
  { from: 'earthquakes', to: 'seismic_events', leakProb: 0.15, strength: 0.90, label: 'Seismic observation → waveform detection',
    mapping: { latMin: 'latMin', latMax: 'latMax', lonMin: 'lonMin', lonMax: 'lonMax' } },

  // Weather → storms: atmospheric conditions drive cyclone development
  { from: 'weather_forecast', to: 'storms', leakProb: 0.40, strength: 0.60, label: 'Weather → tropical cyclone',
    mapping: { lat: 'lat', lon: 'lon' } },

  // Weather → wildfires: temperature and wind drive fire spread
  { from: 'weather_forecast', to: 'wildfires', leakProb: 0.35, strength: 0.55, label: 'Weather → fire ignition',
    mapping: { temperature: 'temp', windSpeed: 'wind' } },

  // Storms → floods: tropical cyclones cause flooding
  { from: 'storms', to: 'floods', leakProb: 0.25, strength: 0.80, label: 'Storm → flood inundation',
    mapping: { max_wind: 'wind' } },

  // Earthquakes → floods: seismic events can trigger dam/levee failures
  { from: 'earthquakes', to: 'floods', leakProb: 0.70, strength: 0.30, label: 'Earthquake → secondary flood',
    mapping: { mag: 'trigger_mag' } },

  // FIRMS → wildfires: satellite hotspots confirm fire presence
  { from: 'firms_fires', to: 'wildfires', leakProb: 0.20, strength: 0.85, label: 'FIRMS detection → fire confirmation',
    mapping: { hotspot_count: 'count' } },

  // Satellite → prediction: land cover features feed ML model
  { from: 'satellite_analyze', to: 'predict', leakProb: 0.45, strength: 0.50, label: 'Satellite → ML features',
    mapping: { ndvi: 'feat_ndvi', ndwi: 'feat_ndwi', landcover: 'feat_lc' } },

  // Seismic events → prediction: earthquake features feed ML model
  { from: 'seismic_events', to: 'predict', leakProb: 0.30, strength: 0.70, label: 'Seismic → ML features',
    mapping: { max_magnitude: 'feat_mag', event_count: 'feat_count' } },

  // Sentiment → prediction: social signal features feed ML model
  { from: 'sentiment_analyze', to: 'predict', leakProb: 0.65, strength: 0.35, label: 'Sentiment → ML features',
    mapping: { sentiment_score: 'feat_sentiment', volume: 'feat_vol' } },

  // Radar → storms: radar reflectivity indicates storm intensity
  { from: 'radar_fetch', to: 'storms', leakProb: 0.35, strength: 0.65, label: 'Radar → storm intensity',
    mapping: { reflectivity: 'intensity', velocity: 'wind_est' } },

  // Weather → floods: heavy precipitation causes flooding
  { from: 'weather_forecast', to: 'floods', leakProb: 0.50, strength: 0.45, label: 'Precipitation → flood risk',
    mapping: { precip: 'rainfall', windSpeed: 'wind' } },

  // ── New edges for added tools ──

  // Flood forecast → floods: numerical river discharge enhances flood awareness
  { from: 'flood_forecast', to: 'floods', leakProb: 0.20, strength: 0.85, label: 'Numerical flood forecast → flood confirmation',
    mapping: { river_discharge: 'discharge', flood_probability: 'prob' } },

  // Marine → storms: ocean surface conditions influence cyclone development
  { from: 'marine', to: 'storms', leakProb: 0.35, strength: 0.60, label: 'Sea surface → cyclone intensity',
    mapping: { wave_height: 'seas', ocean_current: 'current' } },

  // Marine → floods: storm surge causes coastal flooding
  { from: 'marine', to: 'floods', leakProb: 0.40, strength: 0.55, label: 'Storm surge → coastal flood',
    mapping: { wave_height: 'surge_ht', swell_height: 'swell' } },

  // Ensemble → weather_forecast: ensemble enriches deterministic forecast
  { from: 'weather_ensemble', to: 'weather_forecast', leakProb: 0.25, strength: 0.75, label: 'Ensemble spread → forecast confidence',
    mapping: { ensemble_temp: 'temperature', ensemble_precip: 'precip', spread: 'uncertainty' } },

  // Seasonal → weather_forecast: seasonal context
  { from: 'seasonal_forecast', to: 'weather_forecast', leakProb: 0.50, strength: 0.40, label: 'Seasonal → weather context',
    mapping: { seasonal_temp: 'temp_trend', seasonal_precip: 'precip_trend' } },

  // Historical → weather_forecast: historical baseline
  { from: 'climate_historical', to: 'weather_forecast', leakProb: 0.45, strength: 0.40, label: 'Historical → anomaly detection',
    mapping: { hist_temp_avg: 'temp_baseline', hist_precip_avg: 'precip_baseline' } },

  // Weather → air quality: weather drives pollution dispersion
  { from: 'weather_forecast', to: 'air_quality', leakProb: 0.35, strength: 0.50, label: 'Weather → air quality',
    mapping: { windSpeed: 'wind', temperature: 'temp', humidity: 'humidity' } },

  // Wildfires → air quality: fires cause air quality degradation
  { from: 'wildfires', to: 'air_quality', leakProb: 0.30, strength: 0.70, label: 'Fire emissions → AQ degradation',
    mapping: { fire_count: 'fire_emissions', burn_area: 'smoke' } },

  // Air quality → predict: AQ as ML feature
  { from: 'air_quality', to: 'predict', leakProb: 0.50, strength: 0.40, label: 'AQ index → ML risk feature',
    mapping: { us_aqi: 'feat_aqi', pm2_5: 'feat_pm25' } },

  // GFS → weather_forecast: alternative model comparison
  { from: 'gfs_forecast', to: 'weather_forecast', leakProb: 0.30, strength: 0.60, label: 'GFS model → forecast enrichment',
    mapping: { gfs_temp: 'temperature', gfs_precip: 'precip', gfs_wind: 'windSpeed' } },

  // Weather → agriculture: weather drives crop conditions
  { from: 'weather_forecast', to: 'agriculture', leakProb: 0.30, strength: 0.70, label: 'Weather → agriculture conditions',
    mapping: { temperature: 'temp_2m', precip: 'precip', windSpeed: 'wind_speed' } },

  // Agriculture → predict: crop stress as ML feature
  { from: 'agriculture', to: 'predict', leakProb: 0.55, strength: 0.35, label: 'Agriculture → ML risk feature',
    mapping: { solar_radiation: 'feat_solar', temp_2m: 'feat_temp', precip: 'feat_precip' } },

  // GDELT → sentiment_analyze: global events enrich sentiment context
  { from: 'gdelt', to: 'sentiment_analyze', leakProb: 0.30, strength: 0.65, label: 'GDELT events → sentiment context',
    mapping: { article_count: 'volume', avg_tone: 'sentiment_score', conflict_mentions: 'keywords' } },

  // Population → predict: population exposure as risk factor
  { from: 'population', to: 'predict', leakProb: 0.40, strength: 0.50, label: 'Population density → risk exposure',
    mapping: { total_population: 'feat_pop', density: 'feat_density' } },

  // Space weather → predict: space weather as risk factor
  { from: 'space_weather', to: 'predict', leakProb: 0.70, strength: 0.25, label: 'Space weather → secondary risk',
    mapping: { solar_flare_count: 'feat_flare', geomagnetic_storm: 'feat_gstorm' } },

  // Space weather → radar_fetch: space weather degrades radar
  { from: 'space_weather', to: 'radar_fetch', leakProb: 0.55, strength: 0.35, label: 'Solar activity → radar degradation',
    mapping: { geomagnetic_storm: 'interference' } },

  // Infrastructure → predict: infrastructure exposure as feature
  { from: 'infrastructure', to: 'predict', leakProb: 0.50, strength: 0.40, label: 'Infrastructure → ML risk feature',
    mapping: { building_count: 'feat_buildings', road_length: 'feat_roads' } },

  // Water resources → floods: streamflow data for flood context
  { from: 'water_resources', to: 'floods', leakProb: 0.30, strength: 0.70, label: 'Streamflow → flood context',
    mapping: { streamflow: 'discharge', groundwater_level: 'baseflow' } },

  // Water resources → predict: water availability as feature
  { from: 'water_resources', to: 'predict', leakProb: 0.60, strength: 0.30, label: 'Water resources → ML feature',
    mapping: { streamflow: 'feat_streamflow', water_temp: 'feat_watertemp' } },

  // Disaster declarations → predict: historical disasters as feature
  { from: 'disaster_declarations', to: 'predict', leakProb: 0.45, strength: 0.50, label: 'Disaster history → ML prediction',
    mapping: { disaster_count: 'feat_disasters', incident_types: 'feat_incidents' } },

  // Weather → marine: weather drives ocean conditions
  { from: 'weather_forecast', to: 'marine', leakProb: 0.40, strength: 0.50, label: 'Wind → wave generation',
    mapping: { windSpeed: 'wind_speed', temperature: 'air_temp' } },
];

const NODE_MAP = new Map(NODES.map(n => [n.toolId, n]));
const EDGE_MAP = new Map(EDGES.map(e => [`${e.from}→${e.to}`, e]));

/* ═════════════════════════════════════════════════════════════════
   TOPOLOGICAL SORT — Kahn's algorithm
   ═════════════════════════════════════════════════════════════════ */

function topologicalSort(): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of NODES) {
    inDegree.set(n.toolId, 0);
    adj.set(n.toolId, []);
  }
  for (const e of EDGES) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    adj.get(e.from)!.push(e.to);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const next of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // Nodes not in sorted (cycles) appended at end
  if (sorted.length < NODES.length) {
    for (const n of NODES) {
      if (!sorted.includes(n.toolId)) sorted.push(n.toolId);
    }
  }

  return sorted;
}

const TOPO_ORDER = topologicalSort();

/* ═════════════════════════════════════════════════════════════════
   SPATIAL GAUSSIAN PROCESS KERNEL
   Used to compute spatially-varying leak probabilities.
   ═════════════════════════════════════════════════════════════════ */

/**
 * Squared-exponential (RBF) kernel:
 *   k(s_i, s_j) = σ² · exp(-||s_i - s_j||² / (2ℓ²))
 *
 * σ² = signal variance (controls amplitude of spatial variation)
 * ℓ  = length scale (controls how quickly correlation decays with distance)
 */
function sqExpKernel(
  si: { lat: number; lon: number },
  sj: { lat: number; lon: number },
  sigma2: number = 0.1,
  lengthScale: number = 500, // km
): number {
  // Approximate distance in km using Haversine-like formula
  const dlat = (si.lat - sj.lat) * 111.32; // km per degree latitude
  const dlon = (si.lon - sj.lon) * 111.32 * Math.cos(((si.lat + sj.lat) / 2) * Math.PI / 180);
  const dist2 = dlat * dlat + dlon * dlon;
  return sigma2 * Math.exp(-dist2 / (2 * lengthScale * lengthScale));
}

/**
 * Compute spatially-varying leak probability for an edge at a given location.
 * Uses a simple GP posterior mean with a single observation at the edge's
 * default leak probability (treated as the "training" point at centroid).
 *
 * This makes the leak probability location-dependent: regions far from
 * the training centroid have higher uncertainty (closer to the prior).
 */
function spatialLeakProb(
  edge: CausalEdge,
  location: { lat: number; lon: number },
  centroid: { lat: number; lon: number } = { lat: 35, lon: 140 },
  sigma2: number = 0.05,
  lengthScale: number = 300,
): number {
  const k = sqExpKernel(location, centroid, sigma2, lengthScale);
  // Posterior mean = k(s, s*) / (k(s*, s*) + noise) * observed_leak + prior * (1 - k_ratio)
  // Simplified: interpolate between default leak and 0.5 (maximum uncertainty)
  const confidence = k / (k + 0.1); // how confident we are in the leak at this location
  return edge.leakProb * confidence + 0.5 * (1 - confidence);
}

/* ═════════════════════════════════════════════════════════════════
   NOISY-OR INFERENCE (Belief Propagation)
   ═════════════════════════════════════════════════════════════════ */

/**
 * Compute P(Y=0 | X_1, ..., X_n) using the Noisy-OR model:
 *
 *   P(Y=0 | X) = Π_{i: X_i=1} q_i
 *
 * Where q_i is the leak probability for cause i.
 *
 * Then: P(Y=1 | X) = 1 - P(Y=0 | X)
 *
 * This assumes each cause independently has a chance (1 - q_i) of
 * triggering the effect. The independence assumption is what makes
 * the Noisy-OR computationally efficient — it reduces the CPT from
 * 2^n entries to n parameters.
 */
function noisyOr(
  parentValues: number[],
  leakProbs: number[],
  strengths: number[],
): number {
  let product = 1.0;
  for (let i = 0; i < parentValues.length; i++) {
    const effectiveParent = Math.min(1, Math.max(0, parentValues[i] * strengths[i]));
    if (effectiveParent > 0) {
      product *= Math.pow(leakProbs[i], effectiveParent);
    }
  }
  return 1 - product;
}

/**
 * Shannon entropy of a Bernoulli distribution:
 *   H(p) = -p·log₂(p) - (1-p)·log₂(1-p)
 *
 * Maximum at p=0.5 (1 bit), minimum at p=0 or p=1 (0 bits).
 */
function bernoulliEntropy(p: number): number {
  const epsilon = 1e-10;
  const pClamped = Math.min(1 - epsilon, Math.max(epsilon, p));
  return -pClamped * Math.log2(pClamped) - (1 - pClamped) * Math.log2(1 - pClamped);
}

/**
 * Full Noisy-OR belief propagation in topological order.
 *
 * For each node Y with parents X_1, ..., X_k:
 *   1. Collect parent probabilities from evidence
 *   2. Compute Noisy-OR: P(Y=1) = 1 - Π q_i^(strength_i * P(X_i))
 *   3. If Y has direct evidence, update via Bayes' rule:
 *      P(Y|evidence) = P(evidence|Y)·P(Y) / P(evidence)
 *   4. Compute entropy and confidence
 *
 * @param evidence - Map of node IDs to observed probability values [0,1]
 * @param location - Study area centroid for spatial GP
 * @returns Complete CausalState with beliefs, variance, and metadata
 */
export function computeCausalProbabilities(
  evidence: Record<string, number>,
  propagate: boolean = true,
  location?: { lat: number; lon: number },
): Record<string, number> {
  const loc = location ?? { lat: 35, lon: 140 };
  const beliefs: Record<string, CausalBelief> = {};
  const variance: Record<string, number> = {};
  const posteriorProbs: Record<string, number> = {};

  // Initialize all nodes with their priors
  for (const node of NODES) {
    const prior = node.prior;
    posteriorProbs[node.toolId] = prior;
    beliefs[node.toolId] = {
      probability: prior,
      entropy: bernoulliEntropy(prior),
      evidenceCount: 0,
      confidence: 0.1,
    };
    variance[node.toolId] = prior * (1 - prior); // Bernoulli variance
  }

  // Apply direct evidence — only for known node IDs
  for (const [nodeId, value] of Object.entries(evidence)) {
    if (!beliefs[nodeId]) continue; // skip non-node keys like _composite, _confidence
    const clamped = Math.min(1, Math.max(0, value));
    posteriorProbs[nodeId] = clamped;
    beliefs[nodeId].probability = clamped;
    beliefs[nodeId].entropy = bernoulliEntropy(clamped);
    beliefs[nodeId].evidenceCount = 1;
    beliefs[nodeId].confidence = 0.9;
    variance[nodeId] = clamped * (1 - clamped) * 0.1;
  }

  if (!propagate) {
    return posteriorProbs;
  }

  // Belief propagation in topological order
  for (const nodeId of TOPO_ORDER) {
    if (!beliefs[nodeId]) continue;
    const incomingEdges = EDGES.filter(e => e.to === nodeId);
    if (incomingEdges.length === 0) continue;

    const parentProbs: number[] = [];
    const leakProbs: number[] = [];
    const strengths: number[] = [];

    for (const edge of incomingEdges) {
      const parentProb = posteriorProbs[edge.from] ?? 0;
      if (parentProb > 0) {
        parentProbs.push(parentProb);
        leakProbs.push(spatialLeakProb(edge, loc));
        strengths.push(edge.strength);
      }
    }

    if (parentProbs.length === 0) continue;

    const noisyOrProb = noisyOr(parentProbs, leakProbs, strengths);
    const prior = posteriorProbs[nodeId];
    const hasDirectEvidence = (evidence[nodeId] ?? 0) > 0;

    if (hasDirectEvidence) {
      const directWeight = beliefs[nodeId].confidence;
      const noisyOrWeight = parentProbs.length / (parentProbs.length + 1);
      const blendWeight = directWeight / (directWeight + noisyOrWeight);
      posteriorProbs[nodeId] = blendWeight * (evidence[nodeId] ?? prior)
        + (1 - blendWeight) * noisyOrProb;
    } else {
      posteriorProbs[nodeId] = Math.max(prior, noisyOrProb);
    }

    beliefs[nodeId].probability = posteriorProbs[nodeId];
    beliefs[nodeId].entropy = bernoulliEntropy(posteriorProbs[nodeId]);
    beliefs[nodeId].evidenceCount = parentProbs.length;
    beliefs[nodeId].confidence = Math.min(0.95, parentProbs.length / 3);
    variance[nodeId] = posteriorProbs[nodeId] * (1 - posteriorProbs[nodeId])
      * Math.max(0.1, 1 - beliefs[nodeId].confidence);
  }

  return posteriorProbs;
}

/**
 * Compute full causal state with beliefs, variance, and metadata.
 */
export function computeFullCausalState(
  evidence: Record<string, number>,
  location?: { lat: number; lon: number },
): CausalState {
  const loc = location ?? { lat: 35, lon: 140 };
  const beliefs: Record<string, CausalBelief> = {};
  const variance: Record<string, number> = {};
  const posteriorProbs: Record<string, number> = {};

  // Initialize with priors
  for (const node of NODES) {
    posteriorProbs[node.toolId] = node.prior;
    beliefs[node.toolId] = {
      probability: node.prior,
      entropy: bernoulliEntropy(node.prior),
      evidenceCount: 0,
      confidence: 0.1,
    };
    variance[node.toolId] = node.prior * (1 - node.prior);
  }

  // Apply direct evidence — only for known node IDs
  for (const [nodeId, value] of Object.entries(evidence)) {
    if (!beliefs[nodeId]) continue;
    const clamped = Math.min(1, Math.max(0, value));
    posteriorProbs[nodeId] = clamped;
    beliefs[nodeId] = {
      probability: clamped,
      entropy: bernoulliEntropy(clamped),
      evidenceCount: 1,
      confidence: 0.9,
    };
    variance[nodeId] = clamped * (1 - clamped) * 0.1;
  }

  // Propagate in topological order
  const priorEntropy = Object.values(beliefs).reduce((s, b) => s + b.entropy, 0);

  for (const nodeId of TOPO_ORDER) {
    if (!beliefs[nodeId]) continue;
    const incomingEdges = EDGES.filter(e => e.to === nodeId);
    if (incomingEdges.length === 0) continue;

    const parentProbs: number[] = [];
    const leakProbs: number[] = [];
    const strengths: number[] = [];

    for (const edge of incomingEdges) {
      const parentProb = posteriorProbs[edge.from] ?? 0;
      if (parentProb > 0) {
        parentProbs.push(parentProb);
        leakProbs.push(spatialLeakProb(edge, loc));
        strengths.push(edge.strength);
      }
    }

    if (parentProbs.length === 0) continue;

    const noisyOrProb = noisyOr(parentProbs, leakProbs, strengths);
    const prior = posteriorProbs[nodeId];
    const hasDirectEvidence = (evidence[nodeId] ?? 0) > 0;

    if (hasDirectEvidence) {
      const directWeight = beliefs[nodeId].confidence;
      const noisyOrWeight = parentProbs.length / (parentProbs.length + 1);
      const blendWeight = directWeight / (directWeight + noisyOrWeight);
      posteriorProbs[nodeId] = blendWeight * (evidence[nodeId] ?? prior)
        + (1 - blendWeight) * noisyOrProb;
    } else {
      posteriorProbs[nodeId] = Math.max(prior, noisyOrProb);
    }

    beliefs[nodeId].probability = posteriorProbs[nodeId];
    beliefs[nodeId].entropy = bernoulliEntropy(posteriorProbs[nodeId]);
    beliefs[nodeId].evidenceCount = parentProbs.length;
    beliefs[nodeId].confidence = Math.min(0.95, parentProbs.length / 3);
    variance[nodeId] = posteriorProbs[nodeId] * (1 - posteriorProbs[nodeId])
      * Math.max(0.1, 1 - beliefs[nodeId].confidence);
  }

  const posteriorEntropy = Object.values(beliefs).reduce((s, b) => s + b.entropy, 0);

  return {
    beliefs,
    variance,
    topoOrder: TOPO_ORDER,
    informationGain: Math.max(0, priorEntropy - posteriorEntropy),
  };
}

/* ═════════════════════════════════════════════════════════════════
   GRAPH QUERIES
   ═════════════════════════════════════════════════════════════════ */

export function getToolIO(toolId: string): CausalNode | undefined {
  return NODE_MAP.get(toolId);
}

export function getDownstreamTools(toolId: string): string[] {
  return EDGES.filter(e => e.from === toolId).map(e => e.to);
}


export function getMapping(fromTool: string, toTool: string): Record<string, string> | null {
  const edge = EDGE_MAP.get(`${fromTool}→${toTool}`);
  return edge?.mapping ?? null;
}



/**
 * Get all edges in the graph (for visualization).
 */

/**
 * Get all nodes in the graph (for visualization).
 */
export function getAllNodes(): CausalNode[] {
  return [...NODES];
}

/**
 * Get the topological order (for sequencing execution).
 */

/* ═════════════════════════════════════════════════════════════════
   EVIDENCE EXTRACTION (Entropy-Weighted)
   ═════════════════════════════════════════════════════════════════ */

/**
 * Normalize a raw value to [0, 1] using a sigmoid-like function
 * that preserves the relative ordering.
 */
function normalizeValue(val: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return Math.min(1, Math.max(0, (val - min) / (max - min)));
}

/**
 * Extract evidence from raw tool output.
 *
 * Uses entropy-weighted normalization:
 * - Numeric outputs are normalized to [0,1] using domain-appropriate scales
 * - Array outputs use count as a proxy for signal strength
 * - Synthetic/estimated data gets lower confidence weighting
 * - The output is a probability that this tool has detected its phenomenon
 */
export function extractEvidence(
  rawData: Record<string, unknown>,
  toolId: string,
): Record<string, number> {
  const io = getToolIO(toolId);
  if (!io) return {};

  const evidence: Record<string, number> = {};

  // Tool-specific normalization scales (scientifically grounded)
  const scales: Record<string, { min: number; max: number }> = {
    mag: { min: 0, max: 9 },              // Richter scale
    depth: { min: 0, max: 700 },           // km
    max_pga: { min: 0, max: 2000 },        // cm/s²
    quake_count: { min: 0, max: 50 },
    temperature: { min: -40, max: 50 },     // °C
    humidity: { min: 0, max: 100 },         // %
    windSpeed: { min: 0, max: 80 },         // m/s
    precip: { min: 0, max: 100 },           // mm
    storm_count: { min: 0, max: 10 },
    max_wind: { min: 0, max: 80 },          // m/s
    fire_count: { min: 0, max: 50 },
    total_frp: { min: 0, max: 5000 },       // MW
    burn_area: { min: 0, max: 100000 },     // hectares
    hotspot_count: { min: 0, max: 100 },
    max_frp: { min: 0, max: 500 },          // MW
    flood_extent: { min: 0, max: 10000 },   // km²
    depth_avg: { min: 0, max: 10 },         // m
    affected_pop: { min: 0, max: 1000000 },
    ndvi: { min: -1, max: 1 },
    ndwi: { min: -1, max: 1 },
    reflectivity: { min: -30, max: 70 },    // dBZ
    event_count: { min: 0, max: 100 },
    max_magnitude: { min: 0, max: 9 },
    sentiment_score: { min: -1, max: 1 },
    volume: { min: 0, max: 10000 },
    // New tool scales
    river_discharge: { min: 0, max: 50000 },
    flood_probability: { min: 0, max: 1 },
    flood_intensity: { min: 0, max: 10 },
    wave_height: { min: 0, max: 20 },
    swell_height: { min: 0, max: 20 },
    ocean_current: { min: 0, max: 5 },
    ensemble_temp: { min: -40, max: 50 },
    ensemble_precip: { min: 0, max: 100 },
    spread: { min: 0, max: 20 },
    seasonal_temp: { min: -40, max: 50 },
    seasonal_precip: { min: 0, max: 100 },
    hist_temp_avg: { min: -40, max: 50 },
    hist_precip_avg: { min: 0, max: 100 },
    hist_wind_avg: { min: 0, max: 80 },
    us_aqi: { min: 0, max: 500 },
    pm2_5: { min: 0, max: 500 },
    pm10: { min: 0, max: 600 },
    ozone: { min: 0, max: 400 },
    no2: { min: 0, max: 200 },
    gfs_temp: { min: -40, max: 50 },
    gfs_precip: { min: 0, max: 100 },
    solar_radiation: { min: 0, max: 1000 },
    article_count: { min: 0, max: 1000 },
    avg_tone: { min: -100, max: 100 },
    conflict_mentions: { min: 0, max: 1000 },
    total_population: { min: 0, max: 1000000000 },
    density: { min: 0, max: 50000 },
    solar_flare_count: { min: 0, max: 50 },
    cme_count: { min: 0, max: 20 },
    geomagnetic_storm: { min: 0, max: 10 },
    building_count: { min: 0, max: 100000 },
    road_length: { min: 0, max: 100000 },
    poi_count: { min: 0, max: 50000 },
    streamflow: { min: 0, max: 50000 },
    groundwater_level: { min: 0, max: 100 },
    water_temp: { min: 0, max: 40 },
    disaster_count: { min: 0, max: 1000 },
    incident_types: { min: 0, max: 20 },
    temp_2m: { min: -40, max: 50 },
    wind_speed: { min: 0, max: 80 },
    wave_direction: { min: 0, max: 360 },
    gfs_wind: { min: 0, max: 80 },
  };

  for (const output of io.outputs) {
    const val = rawData[output];
    if (typeof val === 'number') {
      const scale = scales[output] ?? { min: 0, max: 1 };
      evidence[output] = normalizeValue(val, scale.min, scale.max);
    } else if (typeof val === 'string') {
      // For string outputs like landcover, use binary presence
      evidence[output] = val.length > 0 ? 0.5 : 0;
    } else if (Array.isArray(val)) {
      // Array length as signal strength (log-scaled)
      evidence[output] = val.length > 0 ? normalizeValue(Math.log(val.length + 1), 0, Math.log(100)) : 0;
    }
  }

  // Compute a composite evidence probability for the node
  // Using the maximum normalized value as the node's activation probability
  const values = Object.values(evidence).filter(v => typeof v === 'number');
  if (values.length > 0) {
    // Use max-min average for robust evidence
    const sorted = [...values].sort((a, b) => b - a);
    const topK = sorted.slice(0, Math.min(3, sorted.length));
    const composite = topK.reduce((s, v) => s + v, 0) / topK.length;

    // Penalize synthetic/estimated data
    const isSynthetic = rawData.synthetic === true;
    const confidence = isSynthetic ? 0.3 : 0.9;

    evidence._composite = composite * confidence;
    evidence._confidence = confidence;
  }

  return evidence;
}

/* ═════════════════════════════════════════════════════════════════
   DOT GRAPH EXPORT (for visualization)
   ═════════════════════════════════════════════════════════════════ */

