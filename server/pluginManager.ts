import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { transformSync } from 'esbuild';
import { logger } from './observability/logger';
import { pluginLoadsTotal } from './observability/metrics';
import { getDb } from './db/index';

export interface PluginTool {
  name: string;
  description: string;
  category: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  schema?: Record<string, unknown>;
  exampleArgs?: Record<string, unknown>;
}

export interface PluginData {
  name: string;
  description: string;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  category?: string;
  tools?: PluginTool[];
  dataSources?: PluginData[];
  enabled?: boolean;
  isBuiltin?: boolean;
  error?: string | null;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  category?: string;
  toolCount: number;
  tools: Array<{
    name: string;
    description: string;
    category: string;
    schema?: Record<string, unknown>;
    exampleArgs?: Record<string, unknown>;
  }>;
  enabled: boolean;
  isBuiltin: boolean;
  error?: string | null;
}

export interface CuratedTemplate {
  id: string;
  name: string;
  version: string;
  category: string;
  author: string;
  description: string;
  filename: string;
  code: string;
}

export type PluginAPI = {
  registerTool: (tool: PluginTool) => void;
  unregisterTool: (name: string) => void;
  registerDataSource: (source: PluginData) => void;
  unregisterDataSource: (name: string) => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
};

const PLUGINS_DIR = path.resolve(import.meta.dirname, 'plugins');

export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private toolHandlers = new Map<string, PluginTool>();
  private dataHandlers = new Map<string, PluginData>();
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private onToolChange?: () => void;

  constructor(onToolChange?: () => void) {
    this.onToolChange = onToolChange;
  }

  private ensureStateTable(): void {
    try {
      const db = getDb();
      db.prepare(`
        CREATE TABLE IF NOT EXISTS plugin_states (
          id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();
    } catch (e) {
      logger.warn({ err: e }, '[PluginManager] Could not ensure plugin_states table');
    }
  }

  private getPersistedStates(): Map<string, boolean> {
    const states = new Map<string, boolean>();
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, enabled FROM plugin_states').all() as Array<{ id: string; enabled: number }>;
      for (const r of rows) {
        states.set(r.id, r.enabled === 1);
      }
    } catch {
      /* ignore */
    }
    return states;
  }

  private persistState(id: string, enabled: boolean): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO plugin_states (id, enabled, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(id, enabled ? 1 : 0);
    } catch (e) {
      logger.warn({ err: e, id, enabled }, '[PluginManager] Failed to persist plugin state');
    }
  }

  async init(): Promise<void> {
    this.ensureStateTable();

    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }

    await this.loadBuiltinPlugins();
    await this.scanFiles();

    this.watchTimer = setInterval(() => this.scanFiles(), 30_000);
  }

  destroy(): void {
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.plugins.clear();
    this.toolHandlers.clear();
    this.dataHandlers.clear();
  }

  getToolHandlers(): Map<string, PluginTool> {
    return this.toolHandlers;
  }

  getDataHandlers(): Map<string, PluginData> {
    return this.dataHandlers;
  }

  listPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author || (p.id.startsWith('builtin:') ? 'Terranoetis Core Team' : 'Community Developer'),
      category: p.category || (p.id.startsWith('builtin:') ? 'Core Intelligence' : 'Custom Extension'),
      toolCount: (p.tools || []).length,
      tools: (p.tools || []).map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        schema: t.schema,
        exampleArgs: t.exampleArgs,
      })),
      enabled: p.enabled !== false,
      isBuiltin: Boolean(p.isBuiltin || p.id.startsWith('builtin:')),
      error: p.error || null,
    }));
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    plugin.enabled = enabled;
    this.persistState(id, enabled);

    if (enabled) {
      for (const tool of plugin.tools || []) {
        this.toolHandlers.set(tool.name, tool);
      }
      for (const ds of plugin.dataSources || []) {
        this.dataHandlers.set(ds.name, ds);
      }
    } else {
      for (const tool of plugin.tools || []) {
        this.toolHandlers.delete(tool.name);
      }
      for (const ds of plugin.dataSources || []) {
        this.dataHandlers.delete(ds.name);
      }
    }

    if (this.onToolChange) this.onToolChange();
    return true;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.toolHandlers.get(name);
    if (tool) {
      return tool.handler(args);
    }
    // Fallback: search loaded plugins (enables testing in the admin playground)
    for (const plugin of this.plugins.values()) {
      const match = (plugin.tools || []).find(t => t.name === name);
      if (match) {
        return match.handler(args);
      }
    }
    throw new Error(`Plugin tool "${name}" not found.`);
  }

  async callDataSource(name: string, params: Record<string, unknown>): Promise<unknown> {
    const source = this.dataHandlers.get(name);
    if (!source) throw new Error(`Plugin data source "${name}" not found or plugin is disabled.`);
    return source.handler(params);
  }

  async installPlugin(filename: string, content: string): Promise<string | null> {
    const safeFilename = path.basename(filename);
    if (!safeFilename.endsWith('.ts') && !safeFilename.endsWith('.js')) {
      throw new Error('Plugin file must be a .ts or .js file');
    }
    const resolvedPluginsDir = path.resolve(PLUGINS_DIR);
    if (!fs.existsSync(resolvedPluginsDir)) {
      fs.mkdirSync(resolvedPluginsDir, { recursive: true });
    }
    const pluginPath = path.resolve(resolvedPluginsDir, safeFilename);
    if (!pluginPath.startsWith(resolvedPluginsDir + path.sep)) {
      throw new Error('Invalid plugin path');
    }
    fs.writeFileSync(pluginPath, content, 'utf-8');

    const pluginId = `file:${safeFilename}`;
    this.plugins.delete(pluginId);
    await this.scanFiles();

    return this.plugins.has(pluginId) ? pluginId : null;
  }

  removePlugin(id: string): boolean {
    if (id.startsWith('builtin:')) {
      return false;
    }
    const cleanId = id.trim();
    let target = this.plugins.get(cleanId);
    let resolvedId = cleanId;

    if (!target) {
      if (cleanId.startsWith('file:')) {
        const bare = cleanId.slice(5);
        target = this.plugins.get(bare);
        if (target) resolvedId = bare;
      } else {
        const withFile = `file:${cleanId}`;
        target = this.plugins.get(withFile);
        if (target) resolvedId = withFile;
      }
    }

    if (!target) return false;

    this.plugins.delete(resolvedId);

    try {
      const db = getDb();
      db.prepare('DELETE FROM plugin_states WHERE id = ? OR id = ?').run(resolvedId, resolvedId.replace(/^file:/, ''));
    } catch {
      /* ignore */
    }

    for (const tool of target.tools || []) {
      this.toolHandlers.delete(tool.name);
    }
    for (const ds of target.dataSources || []) {
      this.dataHandlers.delete(ds.name);
    }

    const rawFilename = resolvedId.replace(/^file:/, '');
    const filename = path.basename(rawFilename);
    const resolvedPluginsDir = path.resolve(PLUGINS_DIR);
    const pluginPath = path.resolve(resolvedPluginsDir, filename);
    try {
      if (pluginPath.startsWith(resolvedPluginsDir + path.sep) && fs.existsSync(pluginPath)) {
        fs.unlinkSync(pluginPath);
      }
    } catch {
      /* ignore */
    }

    if (this.onToolChange) this.onToolChange();
    return true;
  }


  private async loadBuiltinPlugins(): Promise<void> {
    const states = this.getPersistedStates();

    this.loadPluginDefinition({
      id: 'builtin:weather-insights',
      name: 'Weather Insights',
      version: '1.0.0',
      description: 'Enhanced atmospheric weather analysis with Saffir-Simpson hurricane and heat stress calculation',
      category: 'Meteorology',
      author: 'Terranoetis Science Core',
      isBuiltin: true,
      enabled: states.has('builtin:weather-insights') ? states.get('builtin:weather-insights')! : true,
      tools: [
        {
          name: 'storm_severity',
          description: 'Classify storm severity, category, and barometric pressure danger',
          category: 'weather',
          schema: {
            windSpeed: 'number (sustained winds in mph)',
            pressure: 'number (central pressure in hPa)',
          },
          exampleArgs: {
            windSpeed: 125,
            pressure: 955,
          },
          handler: async (args) => {
            const windSpeed = Number(args.windSpeed) || 0;
            const pressure = Number(args.pressure) || 1013;
            let category: string;
            if (windSpeed >= 157) category = 'Category 5 Catastrophic';
            else if (windSpeed >= 130) category = 'Category 4 Extreme';
            else if (windSpeed >= 111) category = 'Category 3 Major Hurricane';
            else if (windSpeed >= 96) category = 'Category 2 Moderate Hurricane';
            else if (windSpeed >= 74) category = 'Category 1 Hurricane';
            else if (windSpeed >= 39) category = 'Tropical Storm';
            else category = 'Tropical Depression / Wave';

            const intensity = pressure < 920 ? 'Catastrophic' : pressure < 950 ? 'Extreme' : pressure < 980 ? 'Severe' : pressure < 1005 ? 'Moderate' : 'Low';
            return {
              category,
              intensity,
              windSpeedMph: windSpeed,
              windSpeedKmh: Math.round(windSpeed * 1.60934),
              pressureHpa: pressure,
              advisory: `Storm classified as ${category} with ${intensity} barometric drop. Coastal surge warning recommended.`,
            };
          },
        },
        {
          name: 'heat_index',
          description: 'Calculate NOAA Apparent Temperature (Heat Index) and physiological risk tier',
          category: 'weather',
          schema: {
            temperature: 'number (ambient dry bulb in °F)',
            humidity: 'number (relative humidity 0-100%)',
          },
          exampleArgs: {
            temperature: 96,
            humidity: 68,
          },
          handler: async (args) => {
            const tempF = Number(args.temperature) || 75;
            const humidity = Number(args.humidity) || 50;
            const hi = -42.379 + 2.04901523 * tempF + 10.14333127 * humidity
              - 0.22475541 * tempF * humidity - 0.00683783 * tempF * tempF
              - 0.05481717 * humidity * humidity + 0.00122874 * tempF * tempF * humidity
              + 0.00085282 * tempF * humidity * humidity - 0.00000199 * tempF * tempF * humidity * humidity;
            const risk = hi >= 130 ? 'Extreme Danger (Heat stroke imminent)' : hi >= 105 ? 'Danger (Heat exhaustion likely)' : hi >= 90 ? 'Extreme Caution' : 'Caution';
            return {
              heatIndexF: Math.round(hi * 10) / 10,
              heatIndexC: Math.round(((hi - 32) * 5 / 9) * 10) / 10,
              riskTier: risk,
              ambientTemperatureF: tempF,
              humidityPercent: humidity,
            };
          },
        },
      ],
    });

    this.loadPluginDefinition({
      id: 'builtin:seismic-insights',
      name: 'Seismic Insights',
      version: '1.0.0',
      description: 'Advanced earthquake energy conversion and historical seismic gap risk calculation',
      category: 'Geophysics',
      author: 'Terranoetis Science Core',
      isBuiltin: true,
      enabled: states.has('builtin:seismic-insights') ? states.get('builtin:seismic-insights')! : true,
      tools: [
        {
          name: 'mag_to_energy',
          description: 'Convert earthquake Moment Magnitude (Mw) to joules and TNT equivalence',
          category: 'seismic',
          schema: {
            magnitude: 'number (Richter / Mw scale)',
          },
          exampleArgs: {
            magnitude: 7.4,
          },
          handler: async (args) => {
            const mag = Number(args.magnitude) || 0;
            const energyJoules = Math.pow(10, 1.5 * mag + 4.8);
            const tntTons = energyJoules / 4.184e9;
            const hiroshimaEquiv = energyJoules / 6.3e13;
            return {
              magnitude: mag,
              energyJoules: energyJoules.toExponential(3),
              tntEquivalentTons: Math.round(tntTons * 10) / 10,
              hiroshimaBombEquiv: Math.round(hiroshimaEquiv * 10) / 10,
              destructivePotential: mag >= 8.0 ? 'Great / Catastrophic' : mag >= 7.0 ? 'Major Damage' : mag >= 6.0 ? 'Moderate Destructive' : 'Light',
            };
          },
        },
        {
          name: 'seismic_gap',
          description: 'Identify overdue subduction fault segments and rupture probabilities',
          category: 'seismic',
          schema: {},
          exampleArgs: {},
          handler: async () => {
            const gaps = [
              { region: 'Cascadia Subduction Zone (Pacific NW)', lat: 45.0, lon: -124.0, lastMajor: '1700 (Mw 9.0)', recurrenceWindow: '240-500 yrs', probability: 'High (37% in 50yrs)' },
              { region: 'Northern Chile / Iquique Gap', lat: -20.0, lon: -70.0, lastMajor: '1877 (Mw 8.5)', recurrenceWindow: '110-150 yrs', probability: 'Very High (M8.5+ overdue)' },
              { region: 'Central Himalayan Arc', lat: 28.0, lon: 85.0, lastMajor: '1505 (Mw 8.2)', recurrenceWindow: '500 yrs', probability: 'Critical (Severe slip deficit)' },
              { region: 'Tokyo / Sagami Trough Gap', lat: 35.5, lon: 140.0, lastMajor: '1923 (Mw 7.9)', recurrenceWindow: '70-100 yrs', probability: 'Moderate-High (M8+ due)' },
            ];
            return {
              gaps,
              count: gaps.length,
              guidance: 'Seismic gaps represent locked plate boundary sections that have not ruptured in their typical recurrence window.',
            };
          },
        },
      ],
    });

    this.loadPluginDefinition({
      id: 'builtin:geo-intel',
      name: 'Geo Intelligence',
      version: '1.0.0',
      description: 'Geospatial proximity, great-circle distances, and coordinates-to-timezone resolution',
      category: 'Geodesy',
      author: 'Terranoetis Science Core',
      isBuiltin: true,
      enabled: states.has('builtin:geo-intel') ? states.get('builtin:geo-intel')! : true,
      tools: [
        {
          name: 'distance',
          description: 'Calculate spherical great-circle distance between two geographic coordinates',
          category: 'compute',
          schema: {
            lat1: 'number (origin latitude)',
            lon1: 'number (origin longitude)',
            lat2: 'number (destination latitude)',
            lon2: 'number (destination longitude)',
          },
          exampleArgs: {
            lat1: 37.7749,
            lon1: -122.4194,
            lat2: 35.6762,
            lon2: 139.6503,
          },
          handler: async (args) => {
            const { lat1, lon1, lat2, lon2 } = args as Record<string, number>;
            const toRad = (d: number) => d * Math.PI / 180;
            const R = 6371; // Earth mean radius in km
            const dLat = toRad(Number(lat2) - Number(lat1));
            const dLon = toRad(Number(lon2) - Number(lon1));
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(Number(lat1))) * Math.cos(toRad(Number(lat2))) * Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distKm = Math.round(R * c * 100) / 100;
            const distMiles = Math.round(distKm * 0.621371 * 100) / 100;
            const distNautical = Math.round(distKm * 0.539957 * 100) / 100;
            return {
              distanceKm: distKm,
              distanceMiles: distMiles,
              distanceNauticalMiles: distNautical,
              origin: { lat: lat1, lon: lon1 },
              destination: { lat: lat2, lon: lon2 },
            };
          },
        },
        {
          name: 'timezone',
          description: 'Determine solar timezone offset and approximate local time from coordinate',
          category: 'compute',
          schema: {
            lat: 'number (latitude)',
            lon: 'number (longitude)',
          },
          exampleArgs: {
            lat: 40.7128,
            lon: -74.0060,
          },
          handler: async (args) => {
            const { lat, lon } = args as Record<string, number>;
            const offset = Math.round(Number(lon) / 15);
            const sign = offset >= 0 ? '+' : '-';
            const localDate = new Date(Date.now() + offset * 3600000);
            return {
              coordinates: { lat, lon },
              approximateUtcOffset: `UTC${sign}${Math.abs(offset)}:00`,
              estimatedLocalTime: localDate.toISOString().replace('T', ' ').slice(0, 19),
            };
          },
        },
      ],
    });
  }

  private loadPluginDefinition(plugin: Plugin): void {
    if (plugin.enabled === undefined) plugin.enabled = true;
    this.plugins.set(plugin.id, plugin);

    if (plugin.enabled) {
      for (const tool of plugin.tools || []) {
        this.toolHandlers.set(tool.name, tool);
      }
      for (const ds of plugin.dataSources || []) {
        this.dataHandlers.set(ds.name, ds);
      }
    }
  }

  private async scanFiles(): Promise<void> {
    if (!fs.existsSync(PLUGINS_DIR)) return;
    const entries = fs.readdirSync(PLUGINS_DIR);
    const persistedStates = this.getPersistedStates();

    // Clean up file-based plugins that were removed from disk
    const activeFiles = new Set(entries.filter(e => e.endsWith('.ts') || e.endsWith('.js')).map(e => `file:${e}`));
    for (const [id, plugin] of this.plugins.entries()) {
      if (id.startsWith('file:') && !activeFiles.has(id)) {
        for (const tool of plugin.tools || []) {
          this.toolHandlers.delete(tool.name);
        }
        for (const ds of plugin.dataSources || []) {
          this.dataHandlers.delete(ds.name);
        }
        this.plugins.delete(id);
      }
    }

    for (const entry of entries) {
      if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
      const pluginId = `file:${entry}`;
      if (this.plugins.has(pluginId)) continue;

      const isEnabled = persistedStates.has(pluginId) ? persistedStates.get(pluginId)! : true;

      try {
        const pluginPath = path.join(PLUGINS_DIR, entry);
        const content = fs.readFileSync(pluginPath, 'utf-8');

        const localTools: PluginTool[] = [];
        const localDataSources: PluginData[] = [];

        const api: PluginAPI = {
          registerTool: (tool) => {
            localTools.push(tool);
            if (isEnabled) this.toolHandlers.set(tool.name, tool);
            if (this.onToolChange) this.onToolChange();
          },
          unregisterTool: (name) => {
            this.toolHandlers.delete(name);
            if (this.onToolChange) this.onToolChange();
          },
          registerDataSource: (source) => {
            localDataSources.push(source);
            if (isEnabled) this.dataHandlers.set(source.name, source);
          },
          unregisterDataSource: (name) => {
            this.dataHandlers.delete(name);
          },
          log: (level, msg) => console[level](`[Plugin:${entry}] ${msg}`),
        };

        const initFn = this.runInSandbox(content, api);
        if (typeof initFn === 'function') {
          initFn(api);
        }

        this.plugins.set(pluginId, {
          id: pluginId,
          name: entry.replace(/\.(ts|js)$/, ''),
          version: '0.1.0',
          description: `Custom extension from ${entry}`,
          tools: localTools,
          dataSources: localDataSources,
          enabled: isEnabled,
          isBuiltin: false,
          error: null,
        });

        logger.info({ plugin: entry, tools: localTools.length }, 'Plugin loaded successfully');
        pluginLoadsTotal.inc({ plugin_id: entry, status: 'success' });
      } catch (e) {
        const errorMsg = (e as Error).message || String(e);
        logger.error({ plugin: entry, error: errorMsg }, 'Plugin load failed');
        pluginLoadsTotal.inc({ plugin_id: entry, status: 'failed' });

        this.plugins.set(pluginId, {
          id: pluginId,
          name: entry.replace(/\.(ts|js)$/, ''),
          version: '0.1.0',
          description: `Custom extension from ${entry}`,
          tools: [],
          enabled: false,
          isBuiltin: false,
          error: errorMsg,
        });
      }
    }
  }

  private runInSandbox(content: string, api: PluginAPI): ((api: PluginAPI) => void) | undefined {
    const sandboxModule = { exports: {} as Record<string, unknown> };

    let transpileSource = content;
    try {
      transpileSource = transformSync(content, { loader: 'ts', target: 'es2022' }).code;
    } catch (e) {
      logger.warn({ error: (e as Error).message }, 'TypeScript transpile failed, using raw content');
    }

    const cleanContent = transpileSource
      .replace(/^export\s+default\s+/gm, 'module.exports = ')
      .replace(/^export\s+function\s+(\w+)/gm, 'module.exports.$1 = function')
      .replace(/^export\s+(const|let|var)\s+(\w+)/gm, 'module.exports.$2 = $1 ');

    const wrapperCode = `
(function(module, exports, api, console, setTimeout, clearTimeout, fetch, URL, URLSearchParams) {
  ${cleanContent}
})(sandboxModule, sandboxModule.exports, api, sandboxConsole, sandboxSetTimeout, sandboxClearTimeout, sandboxFetch, URL, URLSearchParams);
`;

    const sandboxConsole = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: (...args: unknown[]) => (logger as any).info({ source: 'plugin' }, ...args),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      warn: (...args: unknown[]) => (logger as any).warn({ source: 'plugin' }, ...args),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: (...args: unknown[]) => (logger as any).error({ source: 'plugin' }, ...args),
    };

    // Safe managed fetch with 10s timeout
    const sandboxFetch = (url: string | URL, init?: RequestInit) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
    };

    const sandbox = {
      sandboxModule,
      api,
      sandboxConsole,
      sandboxFetch,
      sandboxSetTimeout: setTimeout,
      sandboxClearTimeout: clearTimeout,
      URL,
      URLSearchParams,
      btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
      atob: (b64: string) => Buffer.from(b64, 'base64').toString('binary'),
      Math,
      JSON,
      Date,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      module: undefined as unknown,
      exports: undefined as unknown,
      console: undefined as unknown,
      setTimeout: undefined as unknown,
      clearTimeout: undefined as unknown,
      require: undefined as unknown,
      process: undefined as unknown,
      Buffer: undefined as unknown,
      global: undefined as unknown,
    };

    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const script = new vm.Script(wrapperCode, { filename: 'plugin' } as any);
    script.runInContext(context, { timeout: 8000 });

    const exp = sandboxModule.exports as { init?: unknown } | unknown;
    if (typeof exp === 'function') return exp as (api: PluginAPI) => void;
    return (exp as { init?: (api: PluginAPI) => void })?.init as ((api: PluginAPI) => void) | undefined;
  }

  getCuratedTemplates(): CuratedTemplate[] {
    return [
      {
        id: 'noaa-space-weather',
        name: 'NOAA Space Weather Alerts',
        version: '1.2.0',
        category: 'Astrophysics & Atmosphere',
        author: 'Space Weather Prediction Center (SWPC)',
        description: 'Analyzes planetary K-index (Kp) geomagnetic storms and solar proton radiation fluxes.',
        filename: 'noaa_space_weather.ts',
        code: `module.exports.init = function(api) {
  api.log('info', 'NOAA Space Weather extension activated');

  api.registerTool({
    name: 'geomagnetic_storm_scale',
    description: 'Classify planetary Kp index into NOAA G-scale storm levels and aurora visibility',
    category: 'space-weather',
    schema: {
      kpIndex: 'number (planetary Kp index from 0 to 9)'
    },
    exampleArgs: {
      kpIndex: 6.7
    },
    handler: async (args) => {
      const kp = Math.max(0, Math.min(9, Number(args.kpIndex) || 0));
      let gScale = 'G0 (Quiet)';
      let auroraLat = 'Above 65° (Arctic/Antarctic)';
      let gridImpact = 'None';

      if (kp >= 9) {
        gScale = 'G5 Extreme';
        auroraLat = 'Down to 40° latitude (Central US, Central Europe)';
        gridImpact = 'Widespread voltage control problems and protective grid trips possible';
      } else if (kp >= 8) {
        gScale = 'G4 Severe';
        auroraLat = 'Down to 45° latitude';
        gridImpact = 'Possible voltage control issues, satellite surface charging';
      } else if (kp >= 7) {
        gScale = 'G3 Strong';
        auroraLat = 'Down to 50° latitude';
        gridImpact = 'Voltage corrections required, false alarms triggered on protection devices';
      } else if (kp >= 6) {
        gScale = 'G2 Moderate';
        auroraLat = 'Down to 55° latitude (New York, UK, North Germany)';
        gridImpact = 'High-latitude power systems may experience voltage alarms';
      } else if (kp >= 5) {
        gScale = 'G1 Minor';
        auroraLat = 'Down to 60° latitude';
        gridImpact = 'Weak power grid fluctuations can occur';
      }

      return {
        kpIndex: kp,
        noaaGScale: gScale,
        auroraVisibilityThreshold: auroraLat,
        powerGridAdvisory: gridImpact,
        timestamp: new Date().toISOString()
      };
    }
  });
};
`,
      },
      {
        id: 'air-quality-aqi',
        name: 'Global Air Quality & Smoke Index',
        version: '1.1.0',
        category: 'Environmental Health',
        author: 'EPA & Cop-Atmosphere',
        description: 'Converts raw sensor PM2.5 readings into standard EPA AQI score and health risk advisories.',
        filename: 'air_quality_aqi.ts',
        code: `module.exports.init = function(api) {
  api.log('info', 'Air Quality AQI extension activated');

  api.registerTool({
    name: 'calculate_aqi',
    description: 'Calculate standard EPA AQI and vulnerable population advisories from PM2.5 concentration',
    category: 'environment',
    schema: {
      pm25: 'number (PM2.5 concentration in micrograms per cubic meter)'
    },
    exampleArgs: {
      pm25: 78.5
    },
    handler: async (args) => {
      const c = Number(args.pm25) || 0;
      let aqi = 0;
      let category = 'Good';
      let healthRisk = 'Air quality is satisfactory with little or no risk.';

      if (c <= 12.0) {
        aqi = Math.round((50 / 12.0) * c);
        category = 'Good (0-50)';
      } else if (c <= 35.4) {
        aqi = Math.round(((100 - 51) / (35.4 - 12.1)) * (c - 12.1) + 51);
        category = 'Moderate (51-100)';
        healthRisk = 'Acceptable air quality; sensitive individuals should consider limiting outdoor exertion.';
      } else if (c <= 55.4) {
        aqi = Math.round(((150 - 101) / (55.4 - 35.5)) * (c - 35.5) + 101);
        category = 'Unhealthy for Sensitive Groups (101-150)';
        healthRisk = 'Members of sensitive groups may experience health effects. General public not likely affected.';
      } else if (c <= 150.4) {
        aqi = Math.round(((200 - 151) / (150.4 - 55.5)) * (c - 55.5) + 151);
        category = 'Unhealthy (151-200)';
        healthRisk = 'Everyone may begin to experience health effects; sensitive groups should avoid outdoor activity.';
      } else if (c <= 250.4) {
        aqi = Math.round(((300 - 201) / (250.4 - 150.5)) * (c - 150.5) + 201);
        category = 'Very Unhealthy (201-300)';
        healthRisk = 'Health alert: serious risk of health effects for everyone.';
      } else {
        aqi = Math.round(((500 - 301) / (500.4 - 250.5)) * (c - 250.5) + 301);
        category = 'Hazardous (301-500)';
        healthRisk = 'Health warning of emergency conditions. The entire population is likely to be affected.';
      }

      return {
        rawPm25UgM3: c,
        epaAqiScore: Math.min(500, aqi),
        category,
        healthGuidance: healthRisk,
        outdoorActivityPermitted: aqi < 150
      };
    }
  });
};
`,
      },
      {
        id: 'geodesic-aviation',
        name: 'Great-Circle Aviation Waypoints',
        version: '1.0.0',
        category: 'Aviation & Navigation',
        author: 'ICAO Geodesy Tools',
        description: 'Computes great-circle flight navigation waypoints along spherical geodesic curves.',
        filename: 'geodesic_aviation.ts',
        code: `module.exports.init = function(api) {
  api.log('info', 'Geodesic Aviation Navigation extension activated');

  api.registerTool({
    name: 'flight_path_waypoints',
    description: 'Generate 5 intermediate spherical geodesic navigation waypoints between coordinates',
    category: 'aviation',
    schema: {
      lat1: 'number (origin latitude)',
      lon1: 'number (origin longitude)',
      lat2: 'number (destination latitude)',
      lon2: 'number (destination longitude)'
    },
    exampleArgs: {
      lat1: 51.5074,
      lon1: -0.1278,
      lat2: 40.7128,
      lon2: -74.0060
    },
    handler: async (args) => {
      const lat1 = Number(args.lat1) || 0;
      const lon1 = Number(args.lon1) || 0;
      const lat2 = Number(args.lat2) || 0;
      const lon2 = Number(args.lon2) || 0;

      const toRad = (d) => d * Math.PI / 180;
      const toDeg = (r) => r * 180 / Math.PI;

      const φ1 = toRad(lat1), λ1 = toRad(lon1);
      const φ2 = toRad(lat2), λ2 = toRad(lon2);

      const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
      const totalKm = Math.round(6371 * d);

      const waypoints = [];
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const f = i / (steps + 1);
        const A = Math.sin((1 - f) * d) / Math.sin(d);
        const B = Math.sin(f * d) / Math.sin(d);
        const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
        const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
        const z = A * Math.sin(φ1) + B * Math.sin(φ2);
        const φi = Math.atan2(z, Math.sqrt(x ** 2 + y ** 2));
        const λi = Math.atan2(y, x);

        waypoints.push({
          step: i,
          progressPercent: Math.round(f * 100),
          lat: Math.round(toDeg(φi) * 10000) / 10000,
          lon: Math.round(toDeg(λi) * 10000) / 10000
        });
      }

      return {
        origin: { lat: lat1, lon: lon1 },
        destination: { lat: lat2, lon: lon2 },
        totalDistanceKm: totalKm,
        totalDistanceNauticalMiles: Math.round(totalKm * 0.539957),
        intermediateWaypoints: waypoints
      };
    }
  });
};
`,
      },
      {
        id: 'usgs-seismic-attenuation',
        name: 'USGS Ground Shaking & PGA Attenuation',
        version: '1.2.0',
        category: 'Geophysics & Hazards',
        author: 'USGS Earthquake Science Team',
        description: 'Computes Joyner-Boore ground motion acceleration (%g) and Modified Mercalli Intensity (MMI).',
        filename: 'usgs_shaking_intensity.ts',
        code: `module.exports.init = function(api) {
  api.log('info', 'USGS Seismic Attenuation extension activated');

  api.registerTool({
    name: 'calculate_pga_mmi',
    description: 'Calculate Peak Ground Acceleration (%g) and Modified Mercalli Intensity (MMI) from magnitude and hypocentral distance',
    category: 'seismic',
    schema: {
      magnitude: 'number (earthquake moment magnitude Mw)',
      distanceKm: 'number (distance to epicenter in km)'
    },
    exampleArgs: {
      magnitude: 6.8,
      distanceKm: 35
    },
    handler: async (args) => {
      const M = Number(args.magnitude) || 5.0;
      const R = Math.max(1, Number(args.distanceKm) || 10);

      const rHypo = Math.sqrt(R * R + 7.3 * 7.3);
      const lnPga = -0.62 + 0.52 * M - Math.log(rHypo) - 0.0025 * rHypo;
      const pgaG = Math.exp(lnPga);
      const pgaPercentG = Math.round(pgaG * 100 * 10) / 10;

      let mmi = 'I (Not Felt)';
      let damageDesc = 'No structural damage';
      if (pgaPercentG >= 65) {
        mmi = 'X+ (Extreme / Disastrous)';
        damageDesc = 'Most masonry structures destroyed, bridges collapsed';
      } else if (pgaPercentG >= 34) {
        mmi = 'VIII-IX (Severe / Violent)';
        damageDesc = 'Considerable damage in ordinary buildings, partial collapse';
      } else if (pgaPercentG >= 18) {
        mmi = 'VII (Very Strong)';
        damageDesc = 'Damage negligible in buildings of good design; slight in well-built ordinary structures';
      } else if (pgaPercentG >= 9.2) {
        mmi = 'VI (Strong)';
        damageDesc = 'Felt by all; some heavy furniture moved; slight damage to plaster';
      } else if (pgaPercentG >= 3.9) {
        mmi = 'V (Moderate)';
        damageDesc = 'Felt outdoors; sleeping persons awakened; small unstable objects overturned';
      } else if (pgaPercentG >= 1.4) {
        mmi = 'IV (Light)';
        damageDesc = 'Felt indoors by many, dishes rattled, motor cars rocked slightly';
      } else if (pgaPercentG >= 0.5) {
        mmi = 'II-III (Weak)';
        damageDesc = 'Felt only by a few persons at rest, especially on upper floors';
      }

      return {
        magnitudeMw: M,
        distanceKm: R,
        peakGroundAccelerationG: Math.round(pgaG * 1000) / 1000,
        peakGroundAccelerationPercentG: pgaPercentG,
        modifiedMercalliIntensity: mmi,
        structuralDamageGuidance: damageDesc,
        timestamp: new Date().toISOString()
      };
    }
  });
};
`,
      },
      {
        id: 'wildfire-spread-rate',
        name: 'Wildfire Rate of Spread & McArthur FFDI',
        version: '1.1.0',
        category: 'Environmental Hazards',
        author: 'Bushfire & Natural Hazards CRC',
        description: 'Computes McArthur Mark 5 Forest Fire Danger Index (FFDI) and flame spread velocity.',
        filename: 'wildfire_spread_ffdi.ts',
        code: `module.exports.init = function(api) {
  api.log('info', 'Wildfire Spread & FFDI extension activated');

  api.registerTool({
    name: 'calculate_fire_danger',
    description: 'Calculate McArthur Forest Fire Danger Index (FFDI), flame height, and forward rate of spread',
    category: 'wildfire',
    schema: {
      temperatureC: 'number (ambient temperature in °C)',
      humidityPercent: 'number (relative humidity 0-100%)',
      windSpeedKmh: 'number (10-meter wind speed in km/h)',
      droughtFactor: 'number (fuel drought factor 1-10)'
    },
    exampleArgs: {
      temperatureC: 38.5,
      humidityPercent: 14,
      windSpeedKmh: 45,
      droughtFactor: 9.5
    },
    handler: async (args) => {
      const T = Number(args.temperatureC) || 25;
      const H = Math.max(1, Math.min(100, Number(args.humidityPercent) || 50));
      const V = Math.max(0, Number(args.windSpeedKmh) || 10);
      const DF = Math.max(1, Math.min(10, Number(args.droughtFactor) || 5));

      const exponent = -0.450 + 0.987 * Math.log(DF) - 0.0345 * H + 0.0338 * T + 0.0234 * V;
      const ffdi = Math.round(2.0 * Math.exp(exponent) * 10) / 10;

      let category = 'Low-Moderate (0-11)';
      let suppressionGuidance = 'Fires easily controlled with direct attack.';
      if (ffdi >= 100) {
        category = 'Catastrophic / Code Red (100+)';
        suppressionGuidance = 'Uncontrollable crown fire; defensive evacuation essential.';
      } else if (ffdi >= 75) {
        category = 'Extreme (75-99)';
        suppressionGuidance = 'Spotting ahead of main front; direct attack dangerous.';
      } else if (ffdi >= 50) {
        category = 'Severe (50-74)';
        suppressionGuidance = 'High spread rate; initial attack success low.';
      } else if (ffdi >= 24) {
        category = 'Very High (24-49)';
        suppressionGuidance = 'Substantial spotting risk; heavy mechanical equipment needed.';
      } else if (ffdi >= 12) {
        category = 'High (12-23)';
        suppressionGuidance = 'Controlled with direct attack by tankers and ground crews.';
      }

      const forwardSpreadMph = Math.round(0.0012 * ffdi * 15 * 1000);

      return {
        mcArthurFfdiScore: ffdi,
        fireDangerRating: category,
        operationalGuidance: suppressionGuidance,
        forwardRateOfSpreadMetersPerHour: forwardSpreadMph,
        parameters: { temperatureC: T, humidityPercent: H, windSpeedKmh: V, droughtFactor: DF },
        timestamp: new Date().toISOString()
      };
    }
  });
};
`,
      },
    ];
  }
}

export const pluginManager = new PluginManager();
