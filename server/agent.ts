import NodeCache from 'node-cache';
import { omninet, classifyComplexity } from './ai-router/omninet';
import { cognitiveOrchestrator, type CognitionResult, type ProgressCallback } from './cognition/cognitiveOrchestrator';
import { AgentOrchestrator } from './orchestrator';

// ═══════════════════════════════════════════════════════════════════════
// DEPRECATED: Static prompt — kept for backward compatibility.
// Use buildAgentPrompt(tools) instead.
// ═══════════════════════════════════════════════════════════════════════
export const AGENTS_MD = `# Earth Intelligence Copilot — Advanced Sandbox Mode

You are an autonomous Earth Intelligence Copilot with full sandbox capabilities. You have access to:
1. **Antigravity sandbox** (Google-managed Linux VM with Python, Node.js, bash, internet)
2. **Local sandbox API** on http://localhost:3001 for direct code execution, file ops, and data analysis

## Your Mission
When a user describes a task:
1. **Plan** — Decompose the task into subtasks (fetch, analyze, visualize)
2. **Fetch** — Pull data from the APIs below or scrape the web
3. **Compute** — Run Python/Node.js in the sandbox for analysis, stats, simulations
4. **Command** — Use COMMANDS to visualize results on the globe
5. **Respond** — Concise, data-backed answer with specific numbers

## Available Data APIs (all on http://localhost:3001)

### Seismic
- \`GET /api/earthquakes\` — Recent M2.5+ earthquakes (GeoJSON)
- \`GET /api/earthquakes/significant\` — Significant month quakes
- \`GET /api/tectonic\` — Tectonic plate boundaries
- \`GET /api/gdacs/alerts\` — GDACS disaster alerts

### Aviation
- \`GET /api/adsb-lol\` — Live aircraft positions (multi-region)
- \`GET /api/adsb-fi\` — Live aircraft positions (multi-region)
- \`GET /api/openflights\` — Airports and routes

### Weather
- \`GET /api/weather/open-meteo?lat=X&lon=Y\` — Current weather at coordinates
- \`GET /api/weather/nhc\` — NHC tropical cyclones
- \`GET /api/weather/alerts\` — NWS weather alerts
- \`GET /api/weather/drought\` — US drought monitor
- \`GET /api/weather/climate-indices\` — Climate outlooks
- \`GET /api/lightning\` — Real-time lightning strikes

### Hazards
- \`GET /api/eonet\` — NASA natural events (wildfires, floods, volcanoes, dust)
- \`GET /api/firms\` — NASA FIRMS wildfire detections
- \`GET /api/vaac/tokyo\`, \`/api/vaac/anchorage\`, \`/api/vaac/washington\` — VAAC advisories
- \`GET /api/wovodat\` — Volcano observatory data
- \`GET /api/nasa-so2\` — NASA SO2 monitoring

### Ocean & Energy
- \`GET /api/submarine-cables\` — Submarine cable map
- \`GET /api/electricity-grid\` — Grid carbon intensity

### Space
- \`GET /api/space-debris\` — CelesTrak orbital debris (1500+ objects)
- \`GET /api/nasa-dsn\` — NASA Deep Space Network dishes
- \`GET /api/aurora\` — Aurora oval forecast
- \`GET /api/space-weather/kp\` — Kp index
- \`GET /api/iss\` — ISS real-time position
- \`GET /api/satellites/tle\` — Active satellite TLE data

### Social
- \`GET /api/social\` — Aggregated news + social media feed

## Sandbox Code Execution

You can run code directly in the local sandbox using \`POST /api/sandbox/execute\`:

### Python
\`\`\`json
POST /api/sandbox/execute
{"language":"python","code":"import json, numpy as np\\ndata = np.array([1,2,3,4,5])\\nprint(f'Mean: {np.mean(data)}')\\nprint('##JSON_RESULT')\\nprint(json.dumps({'mean':float(np.mean(data)),'std':float(np.std(data))}))\\nprint('##')"}
\`\`\`

### Node.js
\`\`\`json
POST /api/sandbox/execute
{"language":"node","code":"const data = [1,2,3,4,5];\\nconst mean = data.reduce((a,b)=>a+b,0)/data.length;\\nconsole.log('##JSON_RESULT');\\nconsole.log(JSON.stringify({mean,std:Math.sqrt(data.reduce((s,v)=>s+(v-mean)**2,0)/data.length)}));\\nconsole.log('##')"}
\`\`\`

### Bash
\`\`\`json
POST /api/sandbox/execute
{"language":"bash","code":"curl -s http://localhost:3001/api/earthquakes | python3 -c \\"import sys,json; d=json.load(sys.stdin); print(f'{len(d[\\"features\\"])} earthquakes'); print('##JSON_RESULT'); print(json.dumps({'count':len(d['features'])})); print('##')\\""}
\`\`\`

### File operations
- Upload: POST /api/sandbox/workspace/{id}/upload (multipart)
- List: GET /api/sandbox/workspace/{id}/files
- Read: GET /api/sandbox/workspace/{id}/read?file=xxx

## How to Command the Globe

After your analysis, output commands for the globe. Each line is one JSON command:

\`\`\`
## COMMANDS
{"action":"flyTo","lat":35.68,"lon":139.65,"label":"Tokyo","zoom":8}
{"action":"toggleLayer","layerId":"earthquakes","enabled":true}
{"action":"addPin","lat":35.68,"lon":139.65,"label":"Epicenter","color":"#ef4444"}
{"action":"addHeatmap","points":[{"lat":35.68,"lon":139.65,"value":0.8},{"lat":35.5,"lon":139.3,"value":0.4}],"radius":50}
{"action":"addPolygon","coordinates":[[35.6,139.5],[35.7,139.5],[35.7,139.7],[35.6,139.7]],"label":"Risk Zone","color":"rgba(255,0,0,0.3)"}
{"action":"addGeoJSON","geojson":{"type":"FeatureCollection","features":[...]},"label":"Analysis Results","color":"#22c55e"}
{"action":"addChart","type":"bar","title":"Magnitude Distribution","labels":["M2","M3","M4","M5"],"values":[120,45,12,3],"position":{"lat":35.68,"lon":139.65}}
\`\`\`

## Response Rules
- Be concise. Lead with the most important finding.
- Include specific numbers (magnitudes, counts, distances, computed statistics).
- Suggest what the user should look at on the globe.
- Always include ## COMMANDS when globe changes are needed.
- When running code, explain what you're computing and why.
- If the user asks about a location with no data, say so honestly.
- For complex tasks, break into subtasks and show progress.`;

// ═══════════════════════════════════════════════════════════════════════
// TYPES (unchanged)
// ═══════════════════════════════════════════════════════════════════════

export type GlobeAction =
  | 'flyTo' | 'toggleLayer' | 'addPin' | 'addHeatmap' | 'addPolygon'
  | 'addGeoJSON' | 'addChart';

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

export interface AgentResponse {
  outputText: string;
  commands: GlobeCommand[];
  steps: AgentStep[];
  workspaceId?: string;
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
  type: 'quick_scan' | 'deep_analysis' | 'fly_to' | 'toggle_layer' | 'weather_check' | 'compute' | 'unknown';
  confidence: number;
  location?: { lat: number; lon: number; label?: string };
  layerIds?: string[];
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
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  listByCategory(category: string): AgentTool[] {
    return this.list().filter(t => t.category === category);
  }

  /**
   * Build a dynamic AGENTS.md prompt that only includes
   * tools relevant to the detected intent.
   */
  buildPrompt(intent?: IntentResult): string {
    let tools = this.list();

    if (intent && intent.confidence > 0.3) {
      tools = tools.filter(t => {
        if (intent.type === 'weather_check') return t.category === 'weather';
        if (intent.type === 'toggle_layer') {
          if (intent.layerIds) {
            return intent.layerIds.some(id => t.name.includes(id) || t.exampleQueries.some(q => q.includes(id)));
          }
          return true;
        }
        if (intent.type === 'compute') return t.schema.type === 'sandbox';
        return true;
      });
    }

    const lines: string[] = [
      '# Earth Intelligence Copilot — Agent Mode',
      '',
      'You are an autonomous Earth Intelligence Copilot. Your mission:',
      '1. Understand the user\'s Earth science question',
      '2. Fetch relevant data from the tools below or the web',
      '3. Analyze using the sandbox code execution environment',
      '4. Visualize results on the globe using ## COMMANDS',
      '5. Respond with concise, data-backed answers',
      '',
      '## Available Tools',
      '',
    ];

    const grouped = new Map<string, AgentTool[]>();
    for (const tool of tools) {
      const group = grouped.get(tool.category) || [];
      group.push(tool);
      grouped.set(tool.category, group);
    }

    for (const [category, categoryTools] of grouped) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
      for (const tool of categoryTools) {
        const ep = tool.schema.endpoint ? ` — \`${tool.schema.method || 'GET'} ${tool.schema.endpoint}\`` : '';
        lines.push(`- **${tool.name}**: ${tool.description}${ep}`);
      }
      lines.push('');
    }

    lines.push(
      '## Sandbox Code Execution',
      '',
      'You can run code via `POST /api/sandbox/execute` with `{"language":"python"|"node"|"bash", "code": "..."}`.',
      'The sandbox has numpy, pandas, scipy, scikit-learn, geopandas, and internet access.',
      '',
      '## How to Command the Globe',
      '',
      'After your analysis, output commands:',
      '```',
      '## COMMANDS',
      '{"action":"flyTo","lat":35.68,"lon":139.65,"label":"Tokyo","zoom":8}',
      '{"action":"toggleLayer","layerId":"earthquakes","enabled":true}',
      '{"action":"addPin","lat":35.68,"lon":139.65,"label":"Epicenter","color":"#ef4444"}',
      '{"action":"addHeatmap","points":[{"lat":35.68,"lon":139.65,"value":0.8}],"radius":50}',
      '{"action":"addPolygon","coordinates":[[35.6,139.5],[35.7,139.5]],"label":"Zone","color":"rgba(255,0,0,0.3)"}',
      '{"action":"addGeoJSON","geojson":{...},"label":"Results","color":"#22c55e"}',
      '{"action":"addChart","type":"bar","title":"Distribution","labels":["A","B"],"values":[10,20]}',
      '```',
      '',
      'Supported actions: flyTo, toggleLayer, addPin, addHeatmap, addPolygon, addGeoJSON, addChart.',
      '',
      '## Response Rules',
      '- Be concise. Lead with the most important finding.',
      '- Include specific numbers (magnitudes, counts, computed statistics).',
      '- Suggest what the user should look at on the globe.',
      '- Always include ## COMMANDS when globe changes are needed.',
      '- If the user asks about a location with no data, say so honestly.',
      '- For complex tasks, break into subtasks and show progress.',
    );

    return lines.join('\n');
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
  } catch {
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
];

// Pre-computed embeddings cache
const prototypeEmbeddings = new Map<string, number[]>();

export async function warmIntentPrototypeEmbeddings(_apiKey?: string): Promise<void> {
  for (const proto of INTENT_PROTOTYPES) {
    for (const pattern of proto.patterns) {
      try {
        const emb = await omninetEmbed(pattern);
        prototypeEmbeddings.set(pattern, emb);
      } catch {
        // skip failed embeddings
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
  karachi: [24.8607, 67.0011], lagos: [6.5244, 3.3792], 'hong kong': [22.3193, 114.1694],
  chennai: [13.0827, 80.2707], kolkata: [22.5726, 88.3639], bangalore: [12.9716, 77.5946],
  hyderabad: [17.385, 78.4867], ahmedabad: [23.0225, 72.5714], pune: [18.5204, 73.8567],
  jaipur: [26.9124, 75.7873], lucknow: [26.8467, 80.9462], 'los angeles': [34.0522, -118.2437],

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

    // Weather check with location (must precede generic quick_scan)
    if (location && (lower.includes('weather') || lower.includes('rain') || lower.includes('temperature') ||
                     lower.includes('wind') || lower.includes('humidity') || lower.includes('forecast'))) {
      return { type: 'weather_check', confidence: 0.9, location };
    }

    // Fly to location
    if (location && (lower.includes('fly') || lower.includes('go to') || lower.includes('zoom to') ||
                     lower.includes('take me') || lower.includes('navigate') || lower.includes('focus'))) {
      return { type: 'fly_to', confidence: 0.95, location };
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
        return { type: 'toggle_layer', confidence: 0.8, layerIds: ['2_adsb_lol'] };
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
    } catch {
      // Fall through to fast result
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
- type: one of "quick_scan" (urgent hazard check), "deep_analysis" (detailed research), "fly_to" (navigate to location), "toggle_layer" (show/hide data), "weather_check" (weather query), "compute" (data analysis/computation), or "unknown"
- confidence: 0.0 to 1.0
- location: if a specific place is mentioned, provide {lat, lon, label}. Use known coordinates for major cities. If coordinates are given directly, parse them.
- layerIds: if the user wants to see a specific data layer, suggest the layer ID (earthquakes, wildfires, severe_storms, volcanoes, flights, ais_vessels, space_debris, etc.)

User message: "${text.replace(/"/g, '\\"')}"

Return JSON: {"type":"...","confidence":0.0,"location":{"lat":0,"lon":0,"label":""},"layerIds":[]}`;

    const result = await omninetStructured<IntentResult>(prompt);
    if (result && result.type && result.confidence) {
      return result;
    }

    // Fallback to embedding path
    return this.classifyWithEmbedding(text);
  }

  /**
   * LLM-based geocoding — resolves any location name to coordinates.
   */
  static async geocode(text: string, apiKey: string): Promise<{ lat: number; lon: number; label: string } | null> {
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
    } catch {
      // Return null — caller handles missing location
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
    } catch {
      // Fallback to static decomposition
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
        const validActions = ['flyTo', 'toggleLayer', 'addPin', 'addHeatmap', 'addPolygon', 'addGeoJSON', 'addChart'];
        if (validActions.includes(cmd.action)) {
          commands.push(cmd);
        }
      } catch {
        // skip malformed JSON lines
      }
    }
    return commands;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SessionManager (unchanged)
// ═══════════════════════════════════════════════════════════════════════

export class SessionManager {
  private sessions = new Map<string, { environmentId: string; interactionId: string }>();

  get(userId: string) {
    return this.sessions.get(userId);
  }

  set(userId: string, data: { environmentId: string; interactionId: string }) {
    this.sessions.set(userId, data);
  }

  delete(userId: string) {
    this.sessions.delete(userId);
  }

  getOrCreate(userId: string, environmentId: string) {
    const existing = this.sessions.get(userId);
    if (existing) return existing;
    const session = { environmentId, interactionId: '' };
    this.sessions.set(userId, session);
    return session;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MaterializedViewCache (unchanged)
// ═══════════════════════════════════════════════════════════════════════

export class MaterializedViewCache {
  private cache = new NodeCache({ stdTTL: 60, checkperiod: 30 });
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private apiOrigin: string, private refreshIntervalMs = 60000) {}

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
        this.fetchJson(`${this.apiOrigin}/api/earthquakes`).catch(() => ({ features: [] })),
        this.fetchJson(`${this.apiOrigin}/api/eonet`).catch(() => ({ events: [] })),
        this.fetchJson(`${this.apiOrigin}/api/weather/alerts`).catch(() => ({ features: [] })),
        this.fetchJson(`${this.apiOrigin}/api/gdacs/alerts`).catch(() => ({ alerts: [] })),
      ]);
      const grid = this.buildGrid({ quakes, eonet, weather, gdacs });
      this.cache.set('materialized', grid);
    } catch {
      // Silently fail — next refresh will retry
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
