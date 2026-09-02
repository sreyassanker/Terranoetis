import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { logger } from './observability/logger';
import { pluginLoadsTotal } from './observability/metrics';

export interface PluginTool {
  name: string;
  description: string;
  category: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  schema?: Record<string, unknown>;
}

export interface PluginData {
  /** A registered data source — returns data for given params */
  name: string;
  description: string;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  tools?: PluginTool[];
  dataSources?: PluginData[];
  /** Whether the plugin is currently active. Disabled plugins keep their file
   *  on disk but their tools/data-sources are unregistered until re-enabled. */
  enabled?: boolean;
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

  async init(): Promise<void> {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
      this.createExamplePlugin();
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

  listPlugins(): Array<{ id: string; name: string; version: string; description: string; toolCount: number; enabled: boolean }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      toolCount: (p.tools || []).length,
      enabled: p.enabled !== false,
    }));
  }

  /**
   * Enable or disable a plugin. Disabling unregisters its tools and data
   * sources; enabling re-registers them from the stored tool references.
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    const wasEnabled = plugin.enabled !== false;
    if (wasEnabled === enabled) return true;
    plugin.enabled = enabled;
    if (enabled) {
      // Re-register tools
      for (const tool of plugin.tools || []) {
        this.toolHandlers.set(tool.name, tool);
      }
      for (const ds of plugin.dataSources || []) {
        this.dataHandlers.set(ds.name, ds);
      }
    } else {
      // Unregister tools
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
    if (!tool) throw new Error(`Plugin tool not found: ${name}`);
    return tool.handler(args);
  }

  async callDataSource(name: string, params: Record<string, unknown>): Promise<unknown> {
    const source = this.dataHandlers.get(name);
    if (!source) throw new Error(`Plugin data source not found: ${name}`);
    return source.handler(params);
  }

  /**
   * Install a plugin from source code content. Writes the file to the plugins
   * directory and triggers a scan so the new plugin is immediately available.
   * Returns the plugin ID on success, or null if installation failed.
   */
  async installPlugin(filename: string, content: string): Promise<string | null> {
    if (!filename.endsWith('.ts') && !filename.endsWith('.js')) {
      throw new Error('Plugin file must be a .ts or .js file');
    }
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }
    const pluginPath = path.join(PLUGINS_DIR, filename);
    fs.writeFileSync(pluginPath, content, 'utf-8');
    await this.scanFiles();
    const pluginId = `file:${filename}`;
    return this.plugins.has(pluginId) ? pluginId : null;
  }

  /**
   * Remove a plugin by ID. Only file-based plugins (file:*) can be removed;
   * builtin plugins (builtin:*) are protected. Deletes the file from disk and
   * unregisters all associated tools and data sources.
   */
  removePlugin(id: string): boolean {
    if (id.startsWith('builtin:')) {
      return false; // Builtin plugins cannot be removed
    }
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    this.plugins.delete(id);

    // Unregister tools
    for (const tool of plugin.tools || []) {
      this.toolHandlers.delete(tool.name);
    }
    // Unregister data sources
    for (const ds of plugin.dataSources || []) {
      this.dataHandlers.delete(ds.name);
    }

    // Delete the file from disk if it's a file-based plugin
    if (id.startsWith('file:')) {
      const filename = id.slice(5);
      const pluginPath = path.join(PLUGINS_DIR, filename);
      try {
        fs.unlinkSync(pluginPath);
      } catch {
        // File might not exist — ignore
      }
    }

    if (this.onToolChange) this.onToolChange();
    return true;
  }

  private createExamplePlugin(): void {
    const exampleContent = `// Example Earth Intelligence Plugin
// Drop .ts files into server/plugins/ — they auto-load every 30s.
//
// Plugin API available:
//   api.registerTool(tool)    — register a custom tool
//   api.unregisterTool(name)  — remove a tool
//   api.log(level, msg)       — log to server console

module.exports = {};

module.exports.init = function(api) {
  api.log('info', 'Example plugin loaded');

  api.registerTool({
    name: 'hello_world',
    description: 'A friendly greeting tool',
    category: 'custom',
    handler: async (args) => {
      const name = args.name || 'World';
      return { greeting: \`Hello, \${name}! From Earth Intelligence plugin.\` };
    },
  });

  api.registerDataSource({
    name: 'example_data',
    description: 'Example data source',
    handler: async () => {
      return { message: 'This is example data from a plugin.' };
    },
  });
};
`;
    fs.writeFileSync(path.join(PLUGINS_DIR, 'example.ts'), exampleContent, 'utf-8');
  }

  private async loadBuiltinPlugins(): Promise<void> {
    this.loadPluginDefinition({
      id: 'builtin:weather-insights',
      name: 'Weather Insights',
      version: '1.0.0',
      description: 'Enhanced weather analysis with storm severity classification',
      tools: [
        {
          name: 'storm_severity',
          description: 'Classify storm severity based on wind speed and pressure',
          category: 'weather',
          handler: async (args) => {
            const windSpeed = Number(args.windSpeed) || 0;
            const pressure = Number(args.pressure) || 1013;
            let category: string;
            if (windSpeed >= 137) category = 'Category 5';
            else if (windSpeed >= 113) category = 'Category 4';
            else if (windSpeed >= 96) category = 'Category 3';
            else if (windSpeed >= 83) category = 'Category 2';
            else if (windSpeed >= 64) category = 'Category 1';
            else if (windSpeed >= 39) category = 'Tropical Storm';
            else if (windSpeed >= 0) category = 'Tropical Depression';
            else category = 'Unknown';
            const intensity = pressure < 950 ? 'Extreme' : pressure < 980 ? 'High' : pressure < 1008 ? 'Moderate' : 'Low';
            return { category, intensity, windSpeed, pressure, advisory: `Storm classified as ${category} with ${intensity} intensity.` };
          },
        },
        {
          name: 'heat_index',
          description: 'Calculate heat index from temperature and humidity',
          category: 'weather',
          handler: async (args) => {
            const tempF = Number(args.temperature) || 0;
            const humidity = Number(args.humidity) || 50;
            const hi = -42.379 + 2.04901523 * tempF + 10.14333127 * humidity
              - 0.22475541 * tempF * humidity - 0.00683783 * tempF * tempF
              - 0.05481717 * humidity * humidity + 0.00122874 * tempF * tempF * humidity
              + 0.00085282 * tempF * humidity * humidity - 0.00000199 * tempF * tempF * humidity * humidity;
            const risk = hi >= 130 ? 'Extreme Danger' : hi >= 105 ? 'Danger' : hi >= 90 ? 'Extreme Caution' : 'Caution';
            return { heatIndex: Math.round(hi * 10) / 10, risk, temperature: tempF, humidity };
          },
        },
      ],
    });

    this.loadPluginDefinition({
      id: 'builtin:seismic-insights',
      name: 'Seismic Insights',
      version: '1.0.0',
      description: 'Advanced earthquake analysis utilities',
      tools: [
        {
          name: 'mag_to_energy',
          description: 'Convert earthquake magnitude to energy release in joules',
          category: 'seismic',
          handler: async (args) => {
            const mag = Number(args.magnitude) || 0;
            const energyJoules = Math.pow(10, 1.5 * mag + 4.8);
            const tntTons = energyJoules / 4.184e9;
            return { magnitude: mag, energyJoules, tntEquivalentTons: Math.round(tntTons * 100) / 100 };
          },
        },
        {
          name: 'seismic_gap',
          description: 'Identify seismic gaps (regions overdue for major earthquakes)',
          category: 'seismic',
          handler: async () => {
            const gaps = [
              { region: 'Cascadia Subduction Zone', lat: 45.0, lon: -124.0, lastMajor: '1700', probability: 'High (37% in 50yrs)' },
              { region: 'Northern Chile Gap', lat: -20.0, lon: -70.0, lastMajor: '1877', probability: 'Very High (M8.5+ due)' },
              { region: 'Himalayan Gap', lat: 28.0, lon: 85.0, lastMajor: '1505', probability: 'High (M8.5+ overdue)' },
              { region: 'Tokyo/Kanto Gap', lat: 35.5, lon: 140.0, lastMajor: '1923', probability: 'Moderate-High (M8+ due)' },
            ];
            return { gaps, count: gaps.length, note: 'Seismic gaps are segments of a fault that have not ruptured recently and are considered high-risk.' };
          },
        },
      ],
    });

    this.loadPluginDefinition({
      id: 'builtin:geo-intel',
      name: 'Geo Intelligence',
      version: '1.0.0',
      description: 'Geospatial analysis and proximity calculations',
      tools: [
        {
          name: 'distance',
          description: 'Calculate great-circle distance between two lat/lon points',
          category: 'compute',
          handler: async (args) => {
            const { lat1, lon1, lat2, lon2 } = args as Record<string, number>;
            const toRad = (d: number) => d * Math.PI / 180;
            const R = 6371;
            const dLat = toRad(Number(lon2) - Number(lon1));
            const dLon = toRad(Number(lat2) - Number(lat1));
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(Number(lon1))) * Math.cos(toRad(Number(lon2))) * Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return { distanceKm: Math.round(R * c * 100) / 100, pointA: { lat: lat1, lon: lon1 }, pointB: { lat: lat2, lon: lon2 } };
          },
        },
        {
          name: 'timezone',
          description: 'Get timezone info for a lat/lon coordinate',
          category: 'compute',
          handler: async (args) => {
            const { lat, lon } = args as Record<string, number>;
            const offset = Math.round(Number(lon) / 15);
            const sign = offset >= 0 ? '+' : '-';
            return { lat, lon, utcOffset: `UTC${sign}${Math.abs(offset)}`, approximateLocalTime: new Date(Date.now() + offset * 3600000).toISOString() };
          },
        },
      ],
    });
  }

  private loadPluginDefinition(plugin: Plugin): void {
    if (plugin.enabled === undefined) plugin.enabled = true;
    this.plugins.set(plugin.id, plugin);
    for (const tool of plugin.tools || []) {
      this.toolHandlers.set(tool.name, tool);
    }
    for (const ds of plugin.dataSources || []) {
      this.dataHandlers.set(ds.name, ds);
    }
  }

  private async scanFiles(): Promise<void> {
    if (!fs.existsSync(PLUGINS_DIR)) return;
    const entries = fs.readdirSync(PLUGINS_DIR);
    for (const entry of entries) {
      if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
      const pluginId = `file:${entry}`;
      if (this.plugins.has(pluginId)) continue;
      try {
        const pluginPath = path.join(PLUGINS_DIR, entry);
        const content = fs.readFileSync(pluginPath, 'utf-8');

        const api: PluginAPI = {
          registerTool: (tool) => {
            this.toolHandlers.set(tool.name, tool);
            if (this.onToolChange) this.onToolChange();
          },
          unregisterTool: (name) => {
            this.toolHandlers.delete(name);
            if (this.onToolChange) this.onToolChange();
          },
          registerDataSource: (source) => { this.dataHandlers.set(source.name, source); },
          unregisterDataSource: (name) => { this.dataHandlers.delete(name); },
          log: (level, msg) => console[level](`[Plugin:${entry}] ${msg}`),
        };

        const initFn = this.runInSandbox(content, api);
        if (typeof initFn === 'function') {
          initFn(api);
        }

        const alreadyRegistered = new Set<string>();
        for (const p of this.plugins.values()) {
          for (const t of p.tools || []) alreadyRegistered.add(t.name);
        }
        const newTools = Array.from(this.toolHandlers.values()).filter(t => !alreadyRegistered.has(t.name));

        this.plugins.set(pluginId, {
          id: pluginId,
          name: entry.replace(/\.(ts|js)$/, ''),
          version: '0.1.0',
          description: `Plugin from ${entry}`,
          tools: newTools,
          enabled: true,
        });
        logger.info({ plugin: entry }, 'plugin loaded');
        pluginLoadsTotal.inc({ plugin_id: entry, status: 'success' });
      } catch (e) {
        logger.error({ plugin: entry, error: (e as Error).message }, 'plugin load failed');
        pluginLoadsTotal.inc({ plugin_id: entry, status: 'failed' });
      }
    }
  }

  private runInSandbox(content: string, api: PluginAPI): ((api: PluginAPI) => void) | undefined {
    const sandboxModule = { exports: {} as Record<string, unknown> };

    const cleanContent = content
      .replace(/^export\s+default\s+/gm, 'module.exports = ')
      .replace(/^export\s+function\s+(\w+)/gm, 'module.exports.$1 = function')
      .replace(/^export\s+(const|let|var)\s+(\w+)/gm, 'module.exports.$2 = $1 ');
    const wrapperCode = `
(function(module, exports, api, console, setTimeout, clearTimeout) {
  ${cleanContent}
})(sandboxModule, sandboxModule.exports, api, sandboxConsole, sandboxSetTimeout, sandboxClearTimeout);
`;

    const sandboxConsole = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: (...args: unknown[]) => (logger as any).info({ source: 'plugin' }, ...args),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      warn: (...args: unknown[]) => (logger as any).warn({ source: 'plugin' }, ...args),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: (...args: unknown[]) => (logger as any).error({ source: 'plugin' }, ...args),
    };

    const sandbox = {
      sandboxModule,
      api,
      sandboxConsole,
      sandboxSetTimeout: setTimeout,
      sandboxClearTimeout: clearTimeout,
      module: undefined as unknown,
      exports: undefined as unknown,
      console: undefined as unknown,
      setTimeout: undefined as unknown,
      clearTimeout: undefined as unknown,
      require: undefined as unknown,
      process: undefined as unknown,
      global: undefined as unknown,
      Buffer: undefined as unknown,
      fetch: undefined as unknown,
      URL: undefined as unknown,
    };

    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const script = new vm.Script(wrapperCode, { filename: 'plugin' } as any);
    script.runInContext(context, { timeout: 5000 });

    // Support two plugin shapes:
    //   1. module.exports = { init(api) {...} }   (object with init)
    //   2. module.exports = function(api) {...}   (bare function)
    const exp = sandboxModule.exports as { init?: unknown } | unknown;
    if (typeof exp === 'function') return exp as (api: PluginAPI) => void;
    return (exp as { init?: (api: PluginAPI) => void })?.init as ((api: PluginAPI) => void) | undefined;
  }
}
