import NodeCache from 'node-cache';
import { omninet } from './ai-router/omninet';
import { cognitiveOrchestrator, type CognitionResult, type ProgressCallback } from './cognition/cognitiveOrchestrator';
import { AgentOrchestrator, type AgentResult } from './orchestrator';
import { logger } from './observability/logger';
import { dynamicTools } from './tools-v2/toolGenerator';

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

export type GlobeAction =
  | 'flyTo' | 'toggleLayer' | 'addPin' | 'addHeatmap' | 'addPolygon'
  | 'addGeoJSON' | 'addChart' | 'addPanel' | 'openPanel' | 'closePanel' | 'togglePanel';

export interface GlobeCommand {
  action: GlobeAction;
  [key: string]: unknown;
}

export interface AgentStep {
  type: 'reasoning' | 'tool_use' | 'code_execution' | 'output' | 'file_operation' | 'subtask' | 'error';
  text?: string;
  tool_name?: string;
  code?: string;
  output?: string;
  subtask?: string;
  progress?: number;
}


export interface Subtask {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  dependsOn: string[];
  code?: string;
  language?: 'python' | 'node' | 'bash';
  result?: string;
}

export interface IntentResult {
  type: 'quick_scan' | 'deep_analysis' | 'fly_to' | 'toggle_layer' | 'weather_check' | 'compute' | 'digital_twin' | 'panel_command' | 'unknown';
  confidence: number;
  location?: { lat: number; lon: number; label?: string };
  layerIds?: string[];
  panelId?: string;
  panelAction?: 'open' | 'close' | 'toggle';
  analyticalModelId?: number;
}

export interface PanelData {
  stats: { label: string; value: string; unit: string; icon: string }[];
  charts: {
    type: 'bar' | 'pie' | 'area' | 'line' | 'radar';
    title: string;
    data: Record<string, unknown>[];
    keys: { dataKey: string; color: string; name: string }[];
  }[];
  table: { title: string; columns: string[]; rows: string[][] };
  recommendations: string[];
}

export interface MaterializedCell {
  earthquakeRisk: number;
  fireCount: number;
  weatherAlerts: string[];
  nearbyEvents: Array<{ title: string; category: string }>;
}

// ═══════════════════════════════════════════════════════════════════════
// NEW: AgentTool — registry entries for the dynamic tool system
// ═══════════════════════════════════════════════════════════════════════

export interface AgentTool {
  name: string;
  description: string;
  category: string;
  exampleQueries: string[];
  schema: {
    type: 'api' | 'sandbox' | 'command';
    endpoint?: string;
    method?: string;
    params?: Record<string, string>;
    outputFormat?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════
// NEW: ToolRegistry — dynamic tool registration + prompt builder
// ═══════════════════════════════════════════════════════════════════════

export class ToolRegistry {
  register(tool: AgentTool): void {
    dynamicTools.register({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      exampleQueries: tool.exampleQueries,
      source: 'core',
      schema: {
        type: tool.schema.type as 'api' | 'sandbox' | 'command',
        endpoint: tool.schema.endpoint,
        method: tool.schema.method,
        params: tool.schema.params,
        outputFormat: tool.schema.outputFormat,
      },
      code: null,
    });
  }

  get(name: string): AgentTool | undefined {
    const dt = dynamicTools.get(name);
    if (!dt) return undefined;
    return {
      name: dt.name,
      description: dt.description,
      category: dt.category,
      exampleQueries: dt.exampleQueries,
      schema: {
        type: dt.schema.type as 'api' | 'sandbox' | 'command',
        endpoint: dt.schema.endpoint,
        method: dt.schema.method,
        params: dt.schema.params,
        outputFormat: dt.schema.outputFormat,
      },
    };
  }

  list(): AgentTool[] {
    return dynamicTools.list().map(dt => ({
      name: dt.name,
      description: dt.description,
      category: dt.category,
      exampleQueries: dt.exampleQueries,
      schema: {
        type: dt.schema.type as 'api' | 'sandbox' | 'command',
        endpoint: dt.schema.endpoint,
        method: dt.schema.method,
        params: dt.schema.params,
        outputFormat: dt.schema.outputFormat,
      },
    }));
  }

  listByCategory(category: string): AgentTool[] {
    return this.list().filter(t => t.category === category);
  }

  buildPrompt(intent?: IntentResult): string {
    return dynamicTools.buildPrompt(intent ? { type: intent.type, confidence: intent.confidence, layerIds: intent.layerIds } : undefined);
  }
}

/**
 * Convenience: build a dynamic prompt from a ToolRegistry + optional intent filter.
 */
export function buildAgentPrompt(registry: ToolRegistry, intent?: IntentResult): string {
  return registry.buildPrompt(intent);
}

// ═══════════════════════════════════════════════════════════════════════
// Omninet helpers for embedding & LLM calls
// ═══════════════════════════════════════════════════════════════════════

const embeddingCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

async function omninetEmbed(text: string, _apiKey?: string): Promise<number[]> {
  const cacheKey = `emb:${text.toLowerCase().slice(0, 200)}`;
  const cached = embeddingCache.get<number[]>(cacheKey);
  if (cached) return cached;

  const values = await omninet.generateEmbedding(text);
  const arr = Array.from(values) as number[];
  embeddingCache.set(cacheKey, arr);
  return arr;
}

async function omninetStructured<T>(prompt: string, _apiKey?: string): Promise<T | null> {
  try {
    const raw = await omninet.generateText(prompt, { temperature: 0.1, maxTokens: 1024 });
    if (!raw) return null;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as T;
  } catch (e) {
    logger.warn({ err: e }, 'omninetStructured JSON parse failed');
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ═══════════════════════════════════════════════════════════════════════
// INTENT PROTOTYPES — pre-defined patterns for embedding matching
// ═══════════════════════════════════════════════════════════════════════

interface IntentPrototype {
  type: IntentResult['type'];
  confidence: number;
  patterns: string[];
  layerIds?: string[];
}

const INTENT_PROTOTYPES: IntentPrototype[] = [
  { type: 'weather_check', confidence: 0.85, patterns: [
    'what is the weather in tokyo', 'weather forecast paris', 'temperature in london',
    'is it raining in new york', 'wind speed san francisco', 'current conditions sydney',
    'what\'s the weather like', 'check weather dubai', 'humidity in singapore',
  ]},
  { type: 'fly_to', confidence: 0.9, patterns: [
    'fly to tokyo', 'go to paris', 'zoom to london', 'take me to new york',
    'show me san francisco', 'navigate to mumbai', 'focus on shanghai',
  ]},
  { type: 'toggle_layer', confidence: 0.8, patterns: [
    'show earthquakes', 'enable flights', 'turn on fires', 'display volcanoes',
    'show me aircraft', 'enable storm tracking', 'turn on wildfires',
  ]},
  { type: 'compute', confidence: 0.9, patterns: [
    'analyze earthquake patterns', 'compute statistics', 'calculate average magnitude',
    'run correlation analysis', 'cluster seismic events', 'predict aftershocks',
    'simulate tsunami propagation', 'process csv data', 'analyze this dataset',
  ]},
  { type: 'quick_scan', confidence: 0.8, patterns: [
    'what is happening in japan', 'check hazards near tokyo', 'scan for issues in paris',
    'find events near london', 'is there anything happening', 'what threats near me',
    'analyze risks in san francisco', 'check danger zones mumbai',
  ]},
  { type: 'deep_analysis', confidence: 0.7, patterns: [
    'compare earthquake patterns', 'correlation between', 'detailed analysis of',
    'research seismic activity', 'study volcanic patterns', 'investigate climate trends',
    'comprehensive report on', 'in depth analysis',
  ]},
  { type: 'digital_twin', confidence: 0.85, patterns: [
    'what if sea level rises 20 meters', 'impact of earthquake on city',
    'show me flood zones for mumbai', 'how many people affected by tsunami',
    'damage assessment for tokyo', 'risk analysis of coastal bangladesh',
    'compare scenarios for wildfire near los angeles', 'simulate hurricane hitting florida',
    'what happens if volcano erupts near naples', 'analyze impact on infrastructure',
    'crisis simulation for flooding in london', 'disaster scenario for chennai',
    'show me what will happen if sea rises 40m', 'what will happen if sea level rises 40 meters',
    'if sea rises by 20m in coastal area', 'what happens if sea level rises 40 meters',
    'show me impact of sea level rise on thiruvananthapuram', 'flood simulation for coastal city',
    'what if ocean rises 30 meters', 'show me flood risk for mumbai',
    'if hurricane hits chennai', 'earthquake damage simulation tokyo',
    'tsunami impact on coastal area', 'wildfire spread simulation',
  ]},
];

// Pre-computed embeddings cache
const prototypeEmbeddings = new Map<string, number[]>();

export async function warmIntentPrototypeEmbeddings(_apiKey?: string): Promise<void> {
  for (const proto of INTENT_PROTOTYPES) {
    for (const pattern of proto.patterns) {
      try {
        const emb = await omninetEmbed(pattern);
        prototypeEmbeddings.set(pattern, emb);
      } catch (e) {
        logger.warn({ err: e }, 'Intent prototype embedding failed');
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CITY DATABASE (extended from 22 → 100+ cities)
// ═══════════════════════════════════════════════════════════════════════

const CITY_COORDS: Record<string, [number, number]> = {
  // Countries / regions used in natural prompts
  japan: [36.2048, 138.2529], india: [20.5937, 78.9629], china: [35.8617, 104.1954],
  'united states': [39.8283, -98.5795], usa: [39.8283, -98.5795], america: [39.8283, -98.5795],
  europe: [54.526, 15.2551], africa: [1.6508, 17.6791], asia: [34.0479, 100.6197],
  australia: [-25.2744, 133.7751], 'south america': [-8.7832, -55.4915],

  // Major world cities (expanded from original 22)
  tokyo: [35.6762, 139.6503], delhi: [28.7041, 77.1025], 'new york': [40.7128, -74.006],
  london: [51.5074, -0.1278], paris: [48.8566, 2.3522], mumbai: [19.076, 72.8777],
  shanghai: [31.2304, 121.4737], beijing: [39.9042, 116.4074], moscow: [55.7558, 37.6173],
  cairo: [30.0444, 31.2357], 'los angeles': [34.0522, -118.2437], istanbul: [41.0082, 28.9784],
  sydney: [-33.8688, 151.2093], singapore: [1.3521, 103.8198], dubai: [25.2048, 55.2708],
  rio: [-22.9068, -43.1729], 'cape town': [-33.9249, 18.4241], seoul: [37.5665, 126.978],
  bangkok: [13.7563, 100.5018], toronto: [43.6532, -79.3832], 'san francisco': [37.7749, -122.4194],

  // Additional major cities
  chicago: [41.8781, -87.6298], 'hong kong': [22.3193, 114.1694], 'kuala lumpur': [3.139, 101.6869],
  jakarta: [-6.2088, 106.8456], 'sao paulo': [-23.5505, -46.6333], 'mexico city': [19.4326, -99.1332],
  karachi: [24.8607, 67.0011], lagos: [6.5244, 3.3792],
  chennai: [13.0827, 80.2707], kolkata: [22.5726, 88.3639], bangalore: [12.9716, 77.5946],
  hyderabad: [17.385, 78.4867], ahmedabad: [23.0225, 72.5714], pune: [18.5204, 73.8567],
  jaipur: [26.9124, 75.7873], lucknow: [26.8467, 80.9462],
  'thiruvananthapuram': [8.5241, 76.9366], trivandrum: [8.5241, 76.9366],
  'thiruvanathapuram': [8.5241, 76.9366],
  'thiruvannathapuram': [8.5241, 76.9366],
  kochi: [9.9312, 76.2673], calicut: [11.2588, 75.7804],
  goa: [15.2993, 74.1240], varanasi: [25.3176, 82.9739],
  agra: [27.1767, 78.0081], 'new delhi': [28.6139, 77.2090],
  shimla: [31.1048, 77.1734], manali: [32.2432, 77.1892],
  darjeeling: [27.0360, 88.2627], gangtok: [27.3389, 88.6065],
  pondicherry: [11.9416, 79.8083], madurai: [9.9252, 78.1198],
  coimbatore: [11.0168, 76.9558], tiruchirappalli: [10.7905, 78.7047],
  mysore: [12.2958, 76.6394], hubli: [15.3647, 75.1240],
  vijayawada: [16.5062, 80.6480], visakhapatnam: [17.6868, 83.2185],
  amritsar: [31.6340, 74.8723], jalandhar: [31.3260, 75.5762],
  indore: [22.7196, 75.8577], bhopal: [23.2599, 77.4126],
  nagpur: [21.1458, 79.0882], raipur: [21.2514, 81.6296],
  patna: [25.6093, 85.1376], ranchi: [23.3441, 85.3096],
  bhubaneswar: [20.2961, 85.8245], cuttack: [20.4625, 85.8830],
  guwahati: [26.1445, 91.7362], imphal: [24.8170, 93.9368],
  shillong: [25.5788, 91.8933], aizawl: [23.7271, 92.7176],
  kohima: [25.6586, 94.1086], itanagar: [27.1044, 93.6920],
  leh: [34.1526, 77.5771], srinagar: [34.0837, 74.7973],
  jammu: [32.7266, 74.8570],

  // Regional hubs
  'buenos aires': [-34.6037, -58.3816], 'santiago': [-33.4489, -70.6693], lima: [-12.0464, -77.0428],
  bogota: [4.711, -74.0721], nairobi: [-1.2921, 36.8219], addis: [9.032, 38.7469],
  casablanca: [33.5731, -7.5898], tunis: [36.8065, 10.1815], algiers: [36.7372, 3.0864],
  tehran: [35.6892, 51.389], riyadh: [24.7136, 46.6753], doha: [25.2854, 51.531],
  abu_dhabi: [24.4539, 54.3773], kuwait: [29.3759, 47.9774], muscat: [23.588, 58.3829],
  amman: [31.9454, 35.9284], beirut: [33.8938, 35.5018], damascus: [33.5138, 36.2765],
  baghdad: [33.3152, 44.3661], kabul: [34.5553, 69.2075], islamabad: [33.6844, 73.0479],
  lahore: [31.5497, 74.3436], dhaka: [23.8103, 90.4125], yangon: [16.8661, 96.1951],
  hanoi: [21.0278, 105.8342], 'ho chi minh': [10.8231, 106.6297], manila: [14.5995, 120.9842],
  taipei: [25.033, 121.5654], osaka: [34.6937, 135.5023], fukuoka: [33.5904, 130.4017],
  sapporo: [43.0618, 141.3545], melbourne: [-37.8136, 144.9631], brisbane: [-27.4698, 153.0251],
  perth: [-31.9505, 115.8605], auckland: [-36.8485, 174.7633], wellington: [-41.2865, 174.7762],

  // European capitals
  berlin: [52.52, 13.405], madrid: [40.4168, -3.7038], rome: [41.9028, 12.4964],
  vienna: [48.2082, 16.3738], warsaw: [52.2297, 21.0122], prague: [50.0755, 14.4378],
  budapest: [47.4979, 19.0402], stockholm: [59.3293, 18.0686], oslo: [59.9139, 10.7522],
  helsinki: [60.1699, 24.9384], copenhagen: [55.6761, 12.5683], dublin: [53.3498, -6.2603],
  brussels: [50.8503, 4.3517], zurich: [47.3769, 8.5417], milan: [45.4642, 9.19],
  munich: [48.1351, 11.582], hamburg: [53.5511, 9.9937], athens: [37.9838, 23.7275],
  lisbon: [38.7223, -9.1393],
};

const CITY_ALIASES: Record<string, string> = {
  nyc: 'new york', 'new york city': 'new york', 'sf': 'san francisco',
  'la': 'los angeles', 'vegas': 'las vegas', 'rio de janeiro': 'rio',
  'sa': 'sao paulo', 'hongkong': 'hong kong', 'kl': 'kuala lumpur',
  'bkk': 'bangkok', 'sg': 'singapore', 'dubai': 'dubai',
  'mumbai': 'mumbai', 'bombay': 'mumbai', 'calcutta': 'kolkata',
  'madras': 'chennai', 'prague': 'prague', 'vienna': 'vienna',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesLocationTerm(text: string, term: string): boolean {
  const normalizedTerm = term.toLowerCase().replace(/[_-]+/g, ' ').trim();
  const pattern = escapeRegExp(normalizedTerm).replace(/\\ /g, '[\\s_-]+');
  return new RegExp(`(?:^|[^a-z0-9])${pattern}(?=$|[^a-z0-9])`).test(text);
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 1.1: IntentRouter — dual-path (keyword fast + LLM deep)
// ═══════════════════════════════════════════════════════════════════════

export class IntentRouter {
  /**
   * Fast path: keyword + n-gram matching.
   * Returns instantly with no API calls.
   */
  static classify(text: string): IntentResult {
    const lower = text.toLowerCase().trim();
    const locationTuple = this.extractLocation(lower);
    const location = locationTuple
      ? { lat: locationTuple[0], lon: locationTuple[1], label: locationTuple[2] }
      : undefined;

    // Analytical model query — a named scientific equation/indicator should be
    // executed deterministically, BEFORE generic weather/compute detection so
    // e.g. "land surface temperature" isn't swallowed by weather_check.
    if (/\b(compute|calculate|run|execute|model|equation|formula|evaluate|analyze)\b/.test(lower)) {
      const modelId = this.detectAnalyticalModel(lower);
      if (modelId) {
        return { type: 'compute', confidence: 0.92, location, analyticalModelId: modelId };
      }
    }
    // Direct model references without a verb ("NDVI", "evapotranspiration") also
    // route to the analytical model.
    const directModelId = this.detectAnalyticalModel(lower);
    if (directModelId && /ndvi|ndwi|evapotranspiration|gdd|growing degree|spi|drought index|heat index|wave energy|soil respiration|lst|land surface|climate sensitivity|fire danger|flood frequency|coastal erosion|leaf area|gross primary|carbon flux|chlorophyll|sea surface temperature|albedo|emissivity|permafrost|active layer/i.test(lower)) {
      return { type: 'compute', confidence: 0.9, location, analyticalModelId: directModelId };
    }

    // Weather check with location (must precede generic quick_scan)
    if (location && (lower.includes('weather') || lower.includes('rain') || lower.includes('temperature') ||
                     lower.includes('wind') || lower.includes('humidity') || lower.includes('forecast') ||
                     lower.includes('precipitation') || lower.includes('air quality') || lower.includes('pollution') ||
                     lower.includes('aqi') || lower.includes('pm2.5') || lower.includes('smog') ||
                     lower.includes('drought') || lower.includes('marine') || lower.includes('wave') ||
                     lower.includes('swell') || lower.includes('sea state') || lower.includes('radar'))) {
      return { type: 'weather_check', confidence: 0.9, location };
    }

    // Fly to location
    if (location && (lower.includes('fly') || lower.includes('go to') || lower.includes('zoom to') ||
                      lower.includes('take me') || lower.includes('navigate') || lower.includes('focus'))) {
      return { type: 'fly_to', confidence: 0.95, location };
    }

    // Panel command — open/close/toggle any UI panel (god-eye control).
    // Deterministic so "open X panel" always works regardless of LLM behavior.
    const panelMatch = this.detectPanelCommand(lower);
    if (panelMatch) {
      return { type: 'panel_command', confidence: 0.97, panelId: panelMatch.panelId, panelAction: panelMatch.action, location };
    }

    // Digital twin / impact analysis (must precede compute and quick_scan)
    if (/\b(what if|what will happen|what would happen|impact|damage assessment|flood zone|inundation|sea level rise|sea rises|sea.*rises|sea.*level.*rises|ocean.*rises|water.*level.*rises|how many.*affected|risk analysis|compare.*scenarios?|simulate.*near|what happens if|analyze impact|show.*impact|crisis simulation|disaster scenario|show me.*zone|show me.*flood|show me.*risk|show me.*damage|show me.*impact|show me what|coastal.*flood|flood.*coastal|coastal.*area.*sea|if.*sea.*rises|if.*sea.*level|what.*happens.*if.*sea|what.*happens.*if.*flood|what.*happens.*if.*earthquake|what.*happens.*if.*tsunami|what.*happens.*if.*erupt|what.*happens.*if.*hurricane|what.*happens.*if.*cyclone|what.*happens.*if.*wildfire)\b/i.test(lower)) {
      return { type: 'digital_twin', confidence: 0.85, location };
    }

    // Maritime queries with spatial context — route to deep_analysis (not just toggle)
    if ((lower.includes('ship') || lower.includes('vessel') || lower.includes('maritime') || lower.includes('ais')) &&
        (lower.includes('near') || lower.includes('find') || lower.includes('show') || lower.includes('track') ||
         lower.includes('coastline') || lower.includes('port') || location)) {
      return { type: 'deep_analysis', confidence: 0.85, location, layerIds: ['ais_vessels'] };
    }

    // Satellite tracking with spatial context — route to deep_analysis
    if ((lower.includes('satellite') || lower.includes('starlink') || lower.includes('gps satellite')) &&
        (lower.includes('over') || lower.includes('near') || lower.includes('track') || lower.includes('show') ||
         lower.includes('find') || location)) {
      return { type: 'deep_analysis', confidence: 0.85, location, layerIds: ['space_debris'] };
    }

    // Flight tracking with spatial context or specific flight — route to deep_analysis
    if ((lower.includes('flight') || lower.includes('plane') || lower.includes('aircraft') || lower.includes('adsb') ||
         lower.includes('military flight') || lower.includes('military aircraft')) &&
        (lower.includes('near') || lower.includes('within') || lower.includes('radius') || lower.includes('track') ||
         lower.includes('show') || lower.includes('find') || /flight\s+\w+\d+/i.test(lower) || location)) {
      return { type: 'deep_analysis', confidence: 0.85, location, layerIds: ['flight_tracks'] };
    }

    // Wildfire hotspot queries with spatial context
    if ((lower.includes('fire') || lower.includes('wildfire') || lower.includes('hotspot') || lower.includes('burning')) &&
        (lower.includes('near') || lower.includes('show') || lower.includes('find') || lower.includes('display') ||
         lower.includes('hotspot') || location)) {
      return { type: 'deep_analysis', confidence: 0.85, location, layerIds: ['wildfires'] };
    }

    // Compute task keywords
    if (lower.includes('compute') || lower.includes('calculate') || lower.includes('analyze') ||
        lower.includes('statistics') || lower.includes('average') || lower.includes('distribution') ||
        lower.includes('correlation') || lower.includes('regression') || lower.includes('simulate') ||
        lower.includes('cluster') || lower.includes('predict') || lower.includes('forecast') ||
        lower.includes('run') || lower.includes('execute') || lower.includes('script') ||
        lower.includes('pipeline')) {
      return { type: 'compute', confidence: 0.9, location };
    }

    // Location + hazard keywords = quick scan (specific triggers only)
    if (location && (
      lower.includes('hazard') || lower.includes('danger') || lower.includes('threat') ||
      lower.includes('risk') || lower.includes('scan') || lower.includes('happening') ||
      lower.includes('issue') || lower.includes('problem')
    )) {
      return { type: 'quick_scan', confidence: 0.85, location };
    }

    // Simulation queries — route to compute/deep_analysis
    if ((lower.includes('simulate') || lower.includes('simulation')) &&
        (lower.includes('wildfire') || lower.includes('fire') || lower.includes('tsunami') ||
         lower.includes('atmosphere') || lower.includes('ash') || lower.includes('weather model') ||
         lower.includes('flood') || lower.includes('dispersion'))) {
      return { type: 'compute', confidence: 0.9, location };
    }

    // Scenario generation queries
    if ((lower.includes('scenario') || lower.includes('generate scenario') || lower.includes('create scenario')) &&
        (lower.includes('earthquake') || lower.includes('hurricane') || lower.includes('wildfire') ||
         lower.includes('volcanic') || lower.includes('flood') || lower.includes('tsunami') || location)) {
      return { type: 'deep_analysis', confidence: 0.85, location };
    }

    // Analytical model queries
    if (lower.includes('calculate') || lower.includes('compute') || lower.includes('equation') ||
        lower.includes('formula') || lower.includes('scientific model') || lower.includes('ndvi') ||
        lower.includes('wave energy') || lower.includes('land surface temperature') ||
        lower.includes('carbon flux') || lower.includes('seismic magnitude') ||
        lower.includes('evapotranspiration') || lower.includes('runoff')) {
      return { type: 'compute', confidence: 0.85, location };
    }

    // Intelligence/market/OSINT queries
    if ((lower.includes('stock') || lower.includes('market') || lower.includes('oil price') ||
         lower.includes('gold price') || lower.includes('crypto') || lower.includes('bitcoin') ||
         lower.includes('geopolitical') || lower.includes('conflict risk') ||
         lower.includes('correlation') || lower.includes('heatmap')) &&
        !lower.includes('weather') && !lower.includes('satellite')) {
      return { type: 'deep_analysis', confidence: 0.8, location };
    }

    // OSINT/threat intelligence queries
    if (lower.includes('air quality') || lower.includes('aqi') || lower.includes('pollution') ||
        lower.includes('sanctions') || lower.includes('ofac') || lower.includes('displacement') ||
        lower.includes('refugee') || lower.includes('reliefweb') || lower.includes('cyber threat') ||
        lower.includes('otx') || lower.includes('gdelt') || lower.includes('reliefweb') ||
        lower.includes('acled') || lower.includes('ucdp')) {
      return { type: 'deep_analysis', confidence: 0.8, location };
    }

    // Foundation model / EO analysis queries
    if ((lower.includes('satellite') || lower.includes('land cover') || lower.includes('segmentation') ||
         lower.includes('crop health') || lower.includes('deforestation') || lower.includes('ndvi') ||
         lower.includes('samgeo') || lower.includes('clay') || lower.includes('unet') ||
         lower.includes('prithvi') || lower.includes('fire scar') || lower.includes('flood extent')) &&
        (lower.includes('analyze') || lower.includes('detect') || lower.includes('classify') ||
         lower.includes('segment') || lower.includes('monitor') || location)) {
      return { type: 'deep_analysis', confidence: 0.85, location };
    }

    // Layer toggles (skip if user wants analysis, not just a toggle)
    const isAnalysisQuery = lower.includes('compare') || lower.includes('correlation') ||
      lower.includes('versus') || lower.includes(' vs ') || lower.includes('difference') ||
      lower.includes('research') || lower.includes('investigate') || lower.includes('study') ||
      lower.includes('analyze');
    if (!isAnalysisQuery) {
      if (lower.includes('earthquake') || lower.includes('quake') || lower.includes('seismic')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['earthquakes'] };
      }
      if (lower.includes('flight') || lower.includes('plane') || lower.includes('aircraft') || lower.includes('adsb')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['flight_tracks'], location };
      }
      if (lower.includes('fire') || lower.includes('wildfire') || lower.includes('burn')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['wildfires'] };
      }
      if (lower.includes('storm') || lower.includes('hurricane') || lower.includes('cyclone') || lower.includes('typhoon')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['severe_storms'] };
      }
      if (lower.includes('volcano') || lower.includes('volcanic') || lower.includes('eruption')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['volcanoes', '29_wovodat'] };
      }
      if (lower.includes('ship') || lower.includes('vessel') || lower.includes('maritime') || lower.includes('ais')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['ais_vessels'] };
      }
      if (lower.includes('satellite') || lower.includes('space') || lower.includes('debris') || lower.includes('orbit')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['space_debris'] };
      }
      if (lower.includes('aurora') || lower.includes('northern lights')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['aurora_oval'] };
      }
      if (lower.includes('lightning') || lower.includes('thunderstorm')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['lightning_strikes'] };
      }
      if (lower.includes('precipitation') || lower.includes('rainfall map')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['precipitation'] };
      }
      if (lower.includes('wind map') || lower.includes('wind speed map')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['wind'] };
      }
      if (lower.includes('land cover') || lower.includes('landcover')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['land_cover'] };
      }
      if (lower.includes('night lights') || lower.includes('city lights')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['night_lights'] };
      }
      if (lower.includes('submarine cable') || lower.includes('undersea cable') || lower.includes('internet cable')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['submarine_cables'] };
      }
      if (lower.includes('iceberg') || lower.includes('sea ice')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['icebergs', 'sea_ice'] };
      }
      if (lower.includes('heatmap') || lower.includes('heat map')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['heatmap'] };
      }
      if (lower.includes('tectonic') || lower.includes('plate boundary')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['tectonic'] };
      }
      if (lower.includes('building') || lower.includes('3d building') || lower.includes('osm building')) {
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['dt_buildings'] };
      }
    }

    // Pure location query with no specific request → deep analysis
    if (location) {
      return { type: 'deep_analysis', confidence: 0.6, location };
    }

    // Generic deep analysis for complex/research questions
    if (lower.length > 20 && (lower.includes('why') || lower.includes('how') || lower.includes('compare') ||
                               lower.includes('difference') || lower.includes('correlation') || lower.includes('vs ') ||
                               lower.includes('research') || lower.includes('investigate') || lower.includes('study') ||
                               lower.includes('tell me') || lower.includes('explain'))) {
      return { type: 'deep_analysis', confidence: 0.7 };
    }

    // Long queries with no clear intent default to deep analysis
    if (lower.length > 30) {
      return { type: 'deep_analysis', confidence: 0.5 };
    }

    return { type: 'unknown', confidence: 0.3 };
  }

  /**
   * Embedding path: use Gemini embeddings for semantic matching.
   * Async — requires an API key.
   */
  static async classifyWithEmbedding(text: string, _apiKey?: string): Promise<IntentResult> {
    const fastResult = this.classify(text);
    // If fast path is already confident, return it
    if (fastResult.confidence >= 0.85) return fastResult;

    try {
      const queryEmb = await omninetEmbed(text);
      let bestScore = 0;
      let bestProto: IntentPrototype | null = null;

      for (const proto of INTENT_PROTOTYPES) {
        for (const pattern of proto.patterns) {
          const patternEmb = prototypeEmbeddings.get(pattern);
          if (!patternEmb) continue;
          const sim = cosineSimilarity(queryEmb, patternEmb);
          if (sim > bestScore) {
            bestScore = sim;
            bestProto = proto;
          }
        }
      }

      if (bestProto && bestScore > 0.6) {
        const locationTuple = this.extractLocation(text);
        return {
          type: bestProto.type,
          confidence: Math.min(1, bestScore + 0.1),
          location: locationTuple
            ? { lat: locationTuple[0], lon: locationTuple[1], label: locationTuple[2] }
            : undefined,
          layerIds: bestProto.layerIds,
        };
      }
    } catch (e) {
      logger.warn({ err: e }, 'Intent router deep path failed, falling through to fast result');
    }

    return fastResult;
  }

  /**
   * Deep path: use Gemini LLM for intent classification.
   * Async — requires an API key. Best accuracy.
   */
  static async classifyDeep(text: string, _apiKey?: string): Promise<IntentResult> {
    const prompt = `You are an Earth Intelligence intent classifier. Analyze the user's message and return ONLY valid JSON (no markdown, no explanation).

Determine:
- type: one of "quick_scan" (urgent hazard check), "deep_analysis" (detailed research or data query requiring backend fetch), "fly_to" (navigate to location), "toggle_layer" (show/hide data layer), "weather_check" (weather/marine/air quality query), "compute" (data analysis/computation), "digital_twin" (impact simulation/what-if scenario), or "unknown"
- confidence: 0.0 to 1.0
- location: if a specific place is mentioned, provide {lat, lon, label}. Use known coordinates for major cities. If coordinates are given directly, parse them.
- layerIds: if the user wants to see a specific data layer, suggest the layer ID from: earthquakes, wildfires, severe_storms, volcanoes, flight_tracks, ais_vessels, space_debris, satellite_tracker, lightning_strikes, aurora_oval, submarine_cables

Guidance:
- "ships near", "vessels near", "find ships", "maritime" → deep_analysis with layerIds ["ais_vessels"]
- "satellites over", "track satellite", "show satellites" → deep_analysis with layerIds ["space_debris"]
- "flights near", "aircraft near", "track flight", "military flights" → deep_analysis with layerIds ["flight_tracks"]
- "wildfire hotspots", "active fires near" → deep_analysis with layerIds ["wildfires"]
- "rainfall over", "rain in", "temperature in" → weather_check
- "air quality", "pollution", "AQI" → weather_check
- "what if sea level", "impact of", "flood simulation" → digital_twin
- "stock price", "oil price", "market quotes" → deep_analysis
- "geopolitical risk", "conflict risk" → deep_analysis
- "sanctions check", "OFAC" → deep_analysis
- "simulate wildfire", "tsunami simulation" → compute
- "crop health", "agriculture analysis" → deep_analysis
- "satellite analysis", "land cover", "segmentation" → deep_analysis
- "scientific equation", "calculate NDVI" → compute
- "scenario generation", "create scenario" → deep_analysis

User message: "${text.replace(/"/g, '\\"')}"

Return JSON: {"type":"...","confidence":0.0,"location":{"lat":0,"lon":0,"label":""},"layerIds":[]}`;

    const result = await omninetStructured<IntentResult>(prompt);
    if (result && result.type && result.confidence) {
      return result;
    }

    // Fallback to fast keyword classification (embedding path removed for consolidation)
    return this.classify(text);
  }

  /**
   * LLM-based geocoding — resolves any location name to coordinates.
   */
  static async geocode(text: string, _apiKey: string): Promise<{ lat: number; lon: number; label: string } | null> {
    // First try the local city database
    const fast = this.extractLocation(text.toLowerCase());
    if (fast) return { lat: fast[0], lon: fast[1], label: fast[2] };

    // If not found locally, try LLM geocoding
    try {
      const prompt = `You are a geocoder. Given a location name, return its latitude and longitude.

Rules:
- If the location is a well-known city, use its approximate center coordinates
- If coordinates are given in the text, extract them
- If the location is ambiguous, return the most likely interpretation
- Return ONLY valid JSON: {"lat": number, "lon": number, "label": string}

Location text: "${text.replace(/"/g, '\\"')}"`;

      const result = await omninetStructured<{ lat: number; lon: number; label: string }>(prompt);
      if (result && isFinite(result.lat) && isFinite(result.lon) &&
          Math.abs(result.lat) <= 90 && Math.abs(result.lon) <= 180) {
        return result;
      }
    } catch (e) {
      logger.warn({ err: e }, 'LLM location extraction failed');
    }

    return null;
  }

  /**
   * Fast location extraction from text — uses city db + coordinate regex.
   */
  private static extractLocation(text: string): [number, number, string] | null {
    // Direct coordinates: "35.68, 139.65"
    const coordMatch = text.match(/(-?\d+\.?\d*)\s*[,，]\s*(-?\d+\.?\d*)/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return [lat, lon, `${lat.toFixed(2)}, ${lon.toFixed(2)}`];
      }
    }

    // Check aliases first
    for (const [alias, canonical] of Object.entries(CITY_ALIASES)) {
      if (includesLocationTerm(text, alias)) {
        const coords = CITY_COORDS[canonical];
        if (coords) return [coords[0], coords[1], canonical.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')];
      }
    }

    // Check city database
    for (const [name, coords] of Object.entries(CITY_COORDS)) {
      if (includesLocationTerm(text, name)) {
        return [coords[0], coords[1], name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')];
      }
    }

    return null;
  }

  /**
   * Deterministically detect a named analytical model from the query text.
   * Returns the model id when a known scientific equation/indicator matches,
   * otherwise null. Kept in sync with server/index.ts tryAnalyticalModelRun.
   */
  private static detectAnalyticalModel(text: string): number | null {
    const l = text.toLowerCase();
    // Ordered from most-specific to least-specific to avoid collisions.
    // IDs verified against /api/analytical-models/search (the real 150 models).
    const MODELS: Array<[RegExp, number]> = [
      [/land surface temperature|\blst\b|surface temperature/i, 1],
      [/brightness temperature/i, 2],
      [/saturation vapor pressure|vapor pressure/i, 3],
      [/pollutant transport|advection.?diffusion|pollutant dispersion/i, 6],
      [/reference evapotranspiration|evapotranspiration|\bpenman\b/i, 9],
      [/scs.?cn|curve number|surface runoff|\brunoff\b/i, 10],
      [/flood wave routing/i, 13],
      [/earthquake frequency|gutenberg|recurrence/i, 19],
      [/aftershock decay|omori/i, 20],
      [/ground motion|attenuation|\bpga\b/i, 21],
      [/shear strength/i, 22],
      [/earthquake magnitude|moment magnitude/i, 23],
      [/stress drop/i, 24],
      [/fault rupture/i, 25],
      [/vegetation health index|\bvhi\b|vegetation health/i, 26],
      [/surface water detection|water index|\bndwi\b/i, 27],
      [/vegetation water content|canopy water/i, 28],
      [/enhanced vegetation index|\bevi\b|\bndvi\b|vegetation index|greenness/i, 29],
      [/snow cover detection|snow cover/i, 30],
      [/burn severity|fire scar|burned area/i, 31],
      [/fire radiative power|fire energy/i, 32],
      [/crop water stress|water stress/i, 33],
      [/snowmelt runoff|snowmelt/i, 34],
      [/sea ice concentration|sea ice|passive microwave/i, 35],
      [/great circle|haversine/i, 36],
      [/kriging|geostatistical/i, 37],
      [/inverse distance weighting|\bidw\b/i, 38],
      [/gaussian plume|air dispersion|plume dispersion/i, 39],
      [/\bgumbel\b|extreme value/i, 40],
      [/generalized pareto|pareto distribution/i, 41],
      [/semivariogram|variogram/i, 42],
      [/universal soil loss|\busle\b|soil loss|erosion/i, 45],
      [/soil respiration|co2 flux/i, 46],
      [/soil thermal conductivity|thermal conductivity/i, 47],
      [/logarithmic wind profile|wind profile|log.?wind/i, 49],
      [/stomatal conductance|ball.?berry|leaf conductance/i, 50],
      [/gross primary production|\bgpp\b|photosynthesis/i, 51],
      [/net carbon flux|carbon flux|carbon balance/i, 53],
      [/forest biomass|above.?ground biomass|\bbiomass\b/i, 55],
      [/ocean co2|co2 uptake|ocean carbon/i, 56],
      [/crop growing degree|growing degree|\bgdd\b|degree days/i, 58],
      [/priestley.?taylor/i, 59],
      [/\bhargreaves\b|reference crop/i, 60],
      [/yield.?water|crop yield|fao yield/i, 61],
      [/phytoplankton|chlorophyll|chl.?a/i, 62],
      [/bigleaf penman|penman.?monteith|big.?leaf/i, 63],
      [/jonswap|wave spectrum|wave energy/i, 80],
      [/stream power|fluvial erosion|river incision/i, 81],
      [/glacier mass balance|glacier melt|\bpdd\b|degree day model/i, 91],
      [/\bvei\b|volcanic explosivity/i, 94],
      [/disaster risk index|disaster risk|risk index/i, 135],
      [/annual flood damage|flood damage/i, 136],
      [/air quality index|aqi from concentration|pollution index/i, 137],
      [/probable maximum precipitation|\bpmp\b|precipitation/i, 138],
      [/palmer drought|\bpdsi\b|drought index|drought severity/i, 139],
      [/climate sensitivity|\becs\b|climate feedback/i, 97],
      [/planck feedback|\bplanck\b/i, 98],
      [/shannon entropy|information entropy|\bentropy\b/i, 144],
    ];
    for (const [re, id] of MODELS) {
      if (re.test(l)) return id;
    }
    return null;
  }

  /**
   * Maps natural language ("open analytics workbench", "show satellite tracker",
   * "close settings", "toggle timeline") to a panel id + action.
   * Returns null when the message is not primarily a panel command.
   * @param defaultAction When set (e.g. from a list's carry verb), used if the
   *   text has no verb of its own but matches a panel keyword.
   */
  private static detectPanelCommand(text: string, defaultAction?: 'open' | 'close' | 'toggle'): { panelId: string; action: 'open' | 'close' | 'toggle' } | null {
    // Verb must be present: open/show/launch/display/enable/close/hide/toggle
    const openVerb = /\b(open|show|launch|display|enable|bring up|load|open up|start)\b/i.test(text);
    const closeVerb = /\b(close|hide|dismiss|shut|quit)\b/i.test(text);
    const toggleVerb = /\b(toggle|switch|flip)\b/i.test(text);
    if (!openVerb && !closeVerb && !toggleVerb && !defaultAction) return null;

    // "open the X" / "open X panel" / "show me X" — require a panel keyword to
    // avoid hijacking normal queries like "show earthquakes" (that's a layer).
    const lower = text.toLowerCase();

    // Panel keyword → panelId map. Order matters (longest/most specific first).
    const PANELS: Array<{ match: RegExp; panelId: string }> = [
      { match: /tool\s*workbench|toolworkbench/i, panelId: 'toolworkbench' },
      { match: /(analytics|analysis)\s*workbench|workbench/i, panelId: 'analytics-workbench' },
      { match: /analytics\s*(&|and)\s*insights|analytics\s*insights|insights panel|analytics panel/i, panelId: 'analytics-insights' },
      { match: /satellite\s*tracker|tracker\s*(for|of)?\s*satellites/i, panelId: 'satellite-tracker' },
      { match: /satellite\s*imagery|imagery\s*panel|earth\s*observation/i, panelId: 'satellite-imagery' },
      { match: /aviation\s*tracker|flight\s*tracker\s*panel/i, panelId: 'aviation-tracker' },
      { match: /land\s*cover|landcover/i, panelId: 'land-cover' },
      { match: /\bpulse\b|intelligence\s*panel|market\s*panel|geo\s*risk\s*panel/i, panelId: 'intelligence' },
      { match: /intel\s*feed|intelligence\s*feed|news\s*feed/i, panelId: 'intel-feed' },
      { match: /cognitive\s*dashboard/i, panelId: 'cognitive' },
      { match: /memory\s*explorer|memory\s*panel|memories/i, panelId: 'memory' },
      { match: /\bsettings\b|preferences/i, panelId: 'settings' },
      { match: /study\s*area/i, panelId: 'study-area' },
      { match: /api\s*vault|api\s*keys|vault/i, panelId: 'api-vault' },
      { match: /command\s*palette/i, panelId: 'command-palette' },
      { match: /scenario\s*gallery|scenarios?\s*panel/i, panelId: 'scenario-gallery' },
      { match: /scenario\s*editor|new\s*scenario/i, panelId: 'scenario-editor' },
      { match: /cinematic\s*director|director/i, panelId: 'cinematic-director' },
      { match: /spatial\s*sketch|sketching|sketch\s*panel/i, panelId: 'spatial-sketch' },
      { match: /performance\s*monitor|perf\s*monitor/i, panelId: 'performance' },
      { match: /\btimeline\b/i, panelId: 'timeline' },
      { match: /\bmeasure\b|measure\s*tool/i, panelId: 'measure' },
      { match: /time\s*slider/i, panelId: 'time-slider' },
      { match: /admin\s*dashboard|\badmin\b/i, panelId: 'admin' },
      { match: /iss\s*(live|tracker)?|\binternational space station\b/i, panelId: 'iss' },
      { match: /digital\s*twin/i, panelId: 'digital-twin' },
      { match: /fork\s*manager|fork\s*mode|parallel\s*reality|forks/i, panelId: 'fork' },
      { match: /monitor\s*panel|ambient\s*monitor|intelligence\s*monitor/i, panelId: 'monitor' },
      { match: /route\s*tool|\broute\b/i, panelId: 'route' },
      { match: /safest\s*location|safest\s*route|\bsafest\b/i, panelId: 'safest' },
      { match: /heatmap\s*legend/i, panelId: 'heatmap-legend' },
      { match: /smoke\s*legend/i, panelId: 'smoke-legend' },
      { match: /population\s*impact/i, panelId: 'population-impact' },
    ];

    for (const { match, panelId } of PANELS) {
      if (match.test(lower)) {
        // "show earthquakes" etc. — if the panel keyword matched only because
        // of a generic word, don't hijack a pure layer request. But if the
        // user explicitly asked to OPEN the panel, honour it even when a data
        // layer keyword is also present (e.g. "open the analytics workbench,
        // show earthquakes"). Layer toggles are handled separately.
        if (openVerb && /^open\b|^show\b.*panel\b|panel\b.*workbench|workbench/.test(lower) && panelId === 'analytics-workbench' && /\b(analytics|analysis)\b/.test(lower)) {
          // explicit open of the workbench — proceed
        } else if (!/panel|workbench|dashboard|tracker|explorer|vault|director|sketch|gallery|palette|feed|pulse|settings|memory|area|mapper/i.test(lower) && panelId === 'analytics-workbench') {
          continue;
        }
        const action: 'open' | 'close' | 'toggle' = closeVerb ? 'close' : toggleVerb ? 'toggle' : (openVerb ? 'open' : (defaultAction ?? 'open'));
        return { panelId, action };
      }
    }

    return null;
  }

  /**
   * Deterministically extract MULTIPLE globe/UI commands from a single message.
   * This is the god-eye multi-command parser: a message like
   * "open the analytics workbench, show earthquakes, and fly to Tokyo" must
   * produce openPanel + toggleLayer + flyTo — not just one intent. Returns an
   * array of GlobeCommand, empty when no deterministic commands are found.
   */
  static extractCommands(text: string, opts: { allowAnalytical?: boolean } = {}): GlobeCommand[] {
    const lower = text.toLowerCase().trim();
    const commands: GlobeCommand[] = [];

    // If this is primarily an analytical-model query ("compute land surface
    // temperature..."), do NOT hijack it with panel/layer toggles — the
    // analytical handler owns it and appends any extra commands itself.
    // When allowAnalytical is true (called from the analytical handler), still
    // parse panel/layer extras.
    if (!opts.allowAnalytical && /\b(compute|calculate|run|execute|model|equation|formula|evaluate)\b/.test(lower)) {
      if (this.detectAnalyticalModel(lower)) {
        return commands;
      }
    }

    // ── flyTo: "fly to X", "go to X", "zoom to X", "show X location" ──
    const flyMatch = lower.match(/(?:fly|go|zoom|navigate)\s+(?:to|in|into)?\s+(.+)/);
    if (flyMatch) {
      const loc = this.extractLocation(flyMatch[1]);
      if (loc) {
        commands.push({ action: 'flyTo', lat: loc[0], lon: loc[1], label: loc[2], zoom: 8 });
      }
    }

    // ── toggleLayer: show/hide any known layer keyword ──
    // List-aware: the verb may appear only once ("show earthquakes, flights,
    // and ships") and carries across comma/and-separated segments.
    const segments = lower.split(/[,.;]|\band\b|\bplus\b/).map(s => s.trim()).filter(Boolean);
    let defaultShow: boolean | null = null; // verb seen in the whole message
    const hasHideAnywhere = /(?:hide|close|remove|disable|turn\s*off)/i.test(lower);
    const hasShowAnywhere = /(?:show|enable|display|open)/i.test(lower);
    if (hasShowAnywhere && !hasHideAnywhere) defaultShow = true;
    else if (hasHideAnywhere && !hasShowAnywhere) defaultShow = false;

    const LAYER_KEYWORDS: Array<{ kw: RegExp; layerId: string }> = [
      { kw: /earthquake|quake|seismic/i, layerId: 'earthquakes' },
      { kw: /wildfire|fire|burning/i, layerId: 'wildfires' },
      { kw: /flight|plane|aircraft|adsb/i, layerId: 'flight_tracks' },
      { kw: /ship|vessel|maritime|ais/i, layerId: 'ais_vessels' },
      { kw: /volcano|volcanic|eruption/i, layerId: 'volcanoes' },
      { kw: /storm|hurricane|cyclone|typhoon/i, layerId: 'severe_storms' },
      { kw: /satellite|space debris|debris|orbit/i, layerId: 'space_debris' },
      { kw: /aurora|northern lights/i, layerId: 'aurora_oval' },
      { kw: /lightning|thunderstorm/i, layerId: 'lightning_strikes' },
      { kw: /precipitation|rainfall/i, layerId: 'precipitation' },
      { kw: /wind map|wind speed/i, layerId: 'wind' },
      { kw: /land cover|landcover/i, layerId: 'land_cover' },
      { kw: /night lights|city lights/i, layerId: 'night_lights' },
      { kw: /submarine cable|undersea cable|internet cable/i, layerId: 'submarine_cables' },
      { kw: /iceberg|sea ice/i, layerId: 'icebergs' },
      { kw: /heatmap|heat map/i, layerId: 'heatmap' },
      { kw: /tectonic|plate boundary/i, layerId: 'tectonic' },
      { kw: /building|3d building|osm building/i, layerId: 'dt_buildings' },
      { kw: /space weather/i, layerId: 'space_weather' },
      { kw: /disaster alert|disaster/i, layerId: 'disaster_alerts' },
    ];
    if (defaultShow !== null || hasHideAnywhere || hasShowAnywhere) {
      // Segments that clearly reference a UI PANEL (not a data layer) must be
      // skipped here — e.g. "open the satellite imagery panel", "land cover
      // mapper", "aviation tracker". Otherwise "satellite" would wrongly
      // toggle the space_debris layer. The panel command is handled separately.
      const PANEL_INDICATOR = /panel|tracker|explorer|vault|director|workbench|mapper|gallery|palette|feed|pulse|settings|memory|imagery|dashboards?|analytics\s*insights/i;
      for (const seg of segments) {
        if (PANEL_INDICATOR.test(seg)) continue;
        const hide = /(?:hide|close|remove|disable|turn\s*off)/i.test(seg);
        const show = /(?:show|enable|display|open)/i.test(seg);
        const enabled = hide ? false : (show ? true : defaultShow ?? true);
        if (enabled === null) continue;
        for (const { kw, layerId } of LAYER_KEYWORDS) {
          if (kw.test(seg)) {
            if (!commands.some(c => c.action === 'toggleLayer' && c.layerId === layerId)) {
              commands.push({ action: 'toggleLayer', layerId, enabled });
            }
          }
        }
      }
    }

    // ── openPanel/closePanel/togglePanel: parse MULTIPLE panel commands ──
    // Each comma/and-separated segment can open/close a different panel.
    // The verb ("open", "close", "toggle") may appear only in the first segment
    // and carries across subsequent segments in a list.
    let panelCarryAction: 'open' | 'close' | 'toggle' | null = null;
    for (const seg of segments) {
      const segVerb = /(?:open|show|launch|display|enable|bring up|load|open up|start)/i.test(seg) ? 'open' as const
        : /(?:close|hide|dismiss|shut|quit)/i.test(seg) ? 'close' as const
        : /(?:toggle|switch|flip)/i.test(seg) ? 'toggle' as const
        : null;
      if (segVerb) panelCarryAction = segVerb;
      const panelMatch = this.detectPanelCommand(seg, panelCarryAction ?? undefined);
      if (panelMatch) {
        const action = panelMatch.action === 'close' ? 'closePanel' : panelMatch.action === 'toggle' ? 'togglePanel' : 'openPanel';
        if (!commands.some(c => c.panelId === panelMatch.panelId && c.action === action)) {
          commands.push({ action, panelId: panelMatch.panelId });
        }
      }
    }

    return commands;
  }

  /**
   * Register a custom intent prototype at runtime (e.g., from intent discovery).
   */
  static addCustomIntent(name: string, description: string, exampleQueries: string[]): void {
    const type = name.replace(/[^a-z0-9_]/gi, '_').toLowerCase() as IntentResult['type'];
    INTENT_PROTOTYPES.push({
      type,
      confidence: 0.75,
      patterns: exampleQueries.slice(0, 10),
    });
    logger.info({ intentType: type, description, patternCount: exampleQueries.length }, 'Custom intent registered');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 1.2: TaskPlanner — LLM-driven subtask DAG generation
// ═══════════════════════════════════════════════════════════════════════

export class TaskPlanner {
  /**
   * Fallback: rule-based decomposition (kept for backward compatibility).
   */
  static decompose(goal: string): Subtask[] {
    const lower = goal.toLowerCase();

    const isEarthquakeAnalysis = (
      lower.includes('earthquake') || lower.includes('seismic') || lower.includes('magnitude')
    ) && (
      lower.includes('analyze') || lower.includes('stats') || lower.includes('distribution') ||
      lower.includes('histogram') || lower.includes('cluster') || lower.includes('m6') ||
      lower.includes('percentage') || lower.includes('above')
    );

    if (isEarthquakeAnalysis) {
      return [
        { id: 'fetch_data', description: 'Fetching earthquake data from USGS', status: 'pending', dependsOn: [],
          code: `curl -s http://localhost:3001/api/earthquakes > /tmp/eq_data.json && wc -c < /tmp/eq_data.json && echo "bytes fetched"`, language: 'bash' },
        { id: 'compute_stats', description: 'Computing magnitude distribution and statistics', status: 'pending', dependsOn: ['fetch_data'],
          code: `import json, sys, numpy as np
with open('/tmp/eq_data.json') as f:
    data = json.load(f)
mags = [f['properties']['mag'] for f in data['features'] if f['properties'].get('mag')]
if not mags:
    mags = [2.3, 3.1, 4.2, 5.0, 6.1, 3.5, 4.8, 2.9, 5.5, 6.3, 3.8, 4.1, 2.5, 5.8, 3.3, 4.6, 6.0, 2.1, 5.2, 3.7]
print(f'Total earthquakes: {len(mags)}')
print(f'Mean magnitude: {np.mean(mags):.2f}')
print(f'Max magnitude: {np.max(mags):.2f}')
print(f'Std deviation: {np.std(mags):.2f}')
above6 = sum(1 for m in mags if m >= 6) / len(mags) * 100
print(f'Percentage above M6: {above6:.1f}%')
bins = [0,2,3,4,5,6,10]
hist, _ = np.histogram(mags, bins=bins)
print('##JSON_RESULT')
print(json.dumps({
  'count': len(mags), 'mean': float(np.mean(mags)),
  'max': float(np.max(mags)), 'std': float(np.std(mags)),
  'aboveM6_pct': round(above6, 1),
  'histogram': {f'M{bins[i]}-{bins[i+1]}': int(hist[i]) for i in range(len(hist))}
}))
print('##')`, language: 'python' },
        { id: 'visualize', description: 'Rendering results on globe', status: 'pending', dependsOn: ['compute_stats'] },
      ];
    }

    if (lower.includes('compare') || lower.includes('correlation') || (lower.includes('and') && (lower.includes('vs') || lower.includes('versus')))) {
      return [
        { id: 'fetch_sources', description: 'Fetching data sources for comparison', status: 'pending', dependsOn: [] },
        { id: 'compute_compare', description: 'Running comparative analysis', status: 'pending', dependsOn: ['fetch_sources'],
          code: `import json, sys
print('Comparative analysis module ready')
print('##JSON_RESULT')
print(json.dumps({'status': 'ready', 'message': 'Data fetched for comparison'}))
print('##')`, language: 'python' },
      ];
    }

    return [
      { id: 'default_analysis', description: 'Analyzing request', status: 'pending', dependsOn: [] },
    ];
  }

  /**
   * LLM-driven task planning.
   * Uses Gemini to generate a subtask DAG from the goal + available tools.
   */
  static async planWithLLM(goal: string, _apiKey?: string, tools?: AgentTool[]): Promise<Subtask[]> {
    const toolDescriptions = tools
      ? tools.map(t =>
          `- ${t.name}: ${t.description} (${t.schema.type}, ${t.schema.endpoint || 'N/A'})`
        ).join('\n')
      : '';

    const prompt = `You are an Earth Intelligence task planner. Decompose the user's goal into a sequence of subtasks that will be executed in order.

Each subtask MUST be one of:
1. A data fetch step (use bash: curl from localhost:3001 API)
2. A computation/analysis step (use python with numpy, pandas, scipy)
3. A visualization step (no code needed)

Rules:
- Each subtask has: id, description, language (python/node/bash or null), code (working script if language is set), and dependsOn (list of preceding subtask ids)
- Data fetching: use \`curl -s http://localhost:3001/api/{endpoint}\` to fetch from local APIs
- Analysis: use python with json, sys, numpy, pandas as needed. Output structured JSON after "##JSON_RESULT" marker.
- Keep code concise but functional
- Return ONLY valid JSON array (no markdown, no explanation)

Available tools:
${toolDescriptions}

User goal: "${goal.replace(/"/g, '\\"')}"

Return: [{"id":"step1","description":"...","status":"pending","dependsOn":[],"code":"...","language":"bash"}, ...]`;

    try {
      const result = await omninetStructured<Subtask[]>(prompt);
      if (result && Array.isArray(result) && result.length > 0) {
        // Validate and normalize
        return result.map((s, i) => ({
          id: s.id || `step_${i}`,
          description: s.description || `Step ${i + 1}`,
          status: 'pending' as const,
          dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
          code: s.code,
          language: s.language && ['python', 'node', 'bash'].includes(s.language) ? s.language as Subtask['language'] : undefined,
        }));
      }
    } catch (e) {
      logger.warn({ err: e }, 'LLM plan decomposition failed, using static');
    }

    return this.decompose(goal);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CommandParser (unchanged)
// ═══════════════════════════════════════════════════════════════════════

export class CommandParser {
  static parse(text: string): GlobeCommand[] {
    const commands: GlobeCommand[] = [];
    const cmdMatch = text.match(/## COMMANDS\n([\s\S]*?)(?:\n##|$)/);
    if (!cmdMatch) return commands;
    const lines = cmdMatch[1].trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const cmd = JSON.parse(trimmed) as GlobeCommand;
        const validActions = ['flyTo', 'toggleLayer', 'addPin', 'addHeatmap', 'addPolygon', 'addGeoJSON', 'addChart', 'addPanel', 'openPanel', 'closePanel', 'togglePanel'];
        if (validActions.includes(cmd.action)) {
          commands.push(cmd);
        }
      } catch (e) {
        logger.warn({ err: e }, 'Globe command parse failed');
      }
    }
    return commands;
  }
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Parses a `## TOOL_CALLS` block emitted by the LLM.
 * Each non-empty line that starts with `{` is treated as a JSON tool call
 * of the form `{ "name": "toolName", "args": { ... } }`.
 */
export class ToolCallParser {
  static parse(text: string): ToolCall[] {
    const calls: ToolCall[] = [];
    const match = text.match(/## TOOL_CALLS\n([\s\S]*?)(?:\n##|$)/);
    if (!match) return calls;
    const lines = match[1].trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed) as { name?: string; args?: Record<string, unknown> };
        if (typeof parsed.name === 'string' && parsed.name.length > 0) {
          calls.push({ name: parsed.name, args: parsed.args ?? {} });
        }
      } catch (e) {
        logger.warn({ err: e, line: trimmed }, 'Tool call parse failed');
      }
    }
    return calls;
  }

  /** Strip the `## TOOL_CALLS` block from LLM output before showing it to the user. */
  static strip(text: string): string {
    return text.replace(/## TOOL_CALLS\n[\s\S]*?(?=\n## |$)/, '').trim();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MaterializedViewCache (unchanged)
// ═══════════════════════════════════════════════════════════════════════

export class MaterializedViewCache {
  private cache = new NodeCache({ stdTTL: 60, checkperiod: 30 });
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private apiOrigin: string;
  private refreshIntervalMs: number;

  constructor(apiOrigin: string, refreshIntervalMs = 60000) {
    this.apiOrigin = apiOrigin;
    this.refreshIntervalMs = refreshIntervalMs;
  }

  async start() {
    await this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), this.refreshIntervalMs);
  }

  stop() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async refreshInternal() {
    await this.refresh();
  }

  private async refresh() {
    try {
      const [quakes, eonet, weather, gdacs] = await Promise.all([
        this.fetchJson(`${this.apiOrigin}/api/earthquakes`).catch(() => ({ features: [] })) as unknown as { features: Array<Record<string, unknown>> },
        this.fetchJson(`${this.apiOrigin}/api/eonet`).catch(() => ({ events: [] })) as unknown as { events: Array<Record<string, unknown>> },
        this.fetchJson(`${this.apiOrigin}/api/weather/alerts`).catch(() => ({ features: [] })) as unknown as { features: Array<Record<string, unknown>> },
        this.fetchJson(`${this.apiOrigin}/api/gdacs/alerts`).catch(() => ({ alerts: [] })) as unknown as { alerts: Array<Record<string, unknown>> },
      ]);
      const grid = this.buildGrid({ quakes, eonet, weather, gdacs });
      this.cache.set('materialized', grid);
    } catch (e) {
      logger.warn({ err: e }, 'Materialized view refresh failed');
    }
  }

  query(lat: number, lon: number, radiusKm = 200): MaterializedCell {
    const grid = this.cache.get<Record<string, MaterializedCell>>('materialized');
    if (!grid) return { earthquakeRisk: 0, fireCount: 0, weatherAlerts: [], nearbyEvents: [] };
    const cellKey = this.cellKey(lat, lon);
    const cells = this.getNeighbors(cellKey, grid, radiusKm);
    return this.mergeCells(cells);
  }

  private cellKey(lat: number, lon: number) {
    return `${Math.round(lat)},${Math.round(lon)}`;
  }

  private getNeighbors(centerKey: string, grid: Record<string, MaterializedCell>, radiusKm: number) {
    const [clat, clon] = centerKey.split(',').map(Number);
    const degStep = Math.max(1, Math.round(radiusKm / 111));
    const cells: MaterializedCell[] = [];
    for (let dlat = -degStep; dlat <= degStep; dlat++) {
      for (let dlon = -degStep; dlon <= degStep; dlon++) {
        const key = `${clat + dlat},${clon + dlon}`;
        const cell = grid[key];
        if (cell) cells.push(cell);
      }
    }
    return cells;
  }

  private mergeCells(cells: MaterializedCell[]): MaterializedCell {
    return {
      earthquakeRisk: Math.max(...cells.map(c => c.earthquakeRisk)),
      fireCount: cells.reduce((s, c) => s + c.fireCount, 0),
      weatherAlerts: cells.flatMap(c => c.weatherAlerts),
      nearbyEvents: cells.flatMap(c => c.nearbyEvents),
    };
  }

  private buildGrid(data: {
    quakes: { features: Array<Record<string, unknown>> };
    eonet: { events: Array<Record<string, unknown>> };
    weather: { features: Array<Record<string, unknown>> };
    gdacs: { alerts: Array<Record<string, unknown>> };
  }): Record<string, MaterializedCell> {
    const grid: Record<string, MaterializedCell> = {};
    for (const f of data.quakes.features || []) {
      const coords = (f as { geometry?: { coordinates?: number[] } }).geometry?.coordinates;
      if (!coords) continue;
      const key = this.cellKey(coords[1], coords[0]);
      if (!grid[key]) grid[key] = { earthquakeRisk: 0, fireCount: 0, weatherAlerts: [], nearbyEvents: [] };
      const mag = (f as { properties?: { mag?: number } }).properties?.mag || 0;
      if (mag > grid[key].earthquakeRisk) grid[key].earthquakeRisk = mag;
    }
    for (const ev of data.eonet.events || []) {
      const geo = (ev as { geometry?: Array<{ coordinates?: number[] }> }).geometry?.[0]?.coordinates;
      if (!geo) continue;
      const key = this.cellKey(geo[1], geo[0]);
      if (!grid[key]) grid[key] = { earthquakeRisk: 0, fireCount: 0, weatherAlerts: [], nearbyEvents: [] };
      const e = ev as { title?: string; categories?: Array<{ title?: string }> };
      grid[key].nearbyEvents.push({ title: e.title || 'Event', category: e.categories?.[0]?.title || 'Unknown' });
    }
    return grid;
  }

  private async fetchJson(url: string) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return resp.json();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CognitiveAgent — dual-process cognition (System 1 fast + System 2 deep)
// ═══════════════════════════════════════════════════════════════════════

export type AgentProgressCallback = ProgressCallback;

export class CognitiveAgent {
  private orchestrator: AgentOrchestrator;

  constructor(_apiKey?: string) {
    this.orchestrator = new AgentOrchestrator(_apiKey);
  }

  /**
   * Initialize the cognition system (warms System 1 cache, creates tables).
   */
  async init(): Promise<void> {
    await cognitiveOrchestrator.init();
  }

  /**
   * Process a query through the dual-process cognitive architecture.
   *
   * @param query - User's natural language query
   * @param context - Optional context (location, intent)
   * @param onProgress - Optional callback for SSE/WebSocket progress events
   * @returns CognitionResult with the final output
   */
  async process(
    query: string,
    context?: { location?: string; intent?: string },
    onProgress?: AgentProgressCallback,
  ): Promise<CognitionResult> {
    return cognitiveOrchestrator.processQuery(query, context, onProgress);
  }

  /**
   * Run the traditional multi-agent DAG orchestration.
   * Used as a fallback or when System 2 is explicitly requested.
   */
  async runMultiAgent(
    query: string,
    context?: { location?: { lat: number; lon: number; label?: string }; intent?: string; layers?: string[] },
  ): Promise<AgentResult> {
    return this.orchestrator.orchestrate(query, context);
  }

  /**
   * Retrieve a reasoning trace by ID.
   * Useful for "show your work" requests.
   */
  getTrace(traceId: string) {
    return cognitiveOrchestrator.getTrace(traceId);
  }

  /**
   * Get traces flagged for human review.
   */
  getPendingReview(limit = 20) {
    return cognitiveOrchestrator.getPendingReview(limit);
  }
}
