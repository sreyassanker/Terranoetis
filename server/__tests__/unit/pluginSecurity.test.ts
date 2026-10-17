import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pluginManager } from '../../pluginManager';

describe('Plugin Security & Sandbox Isolation', () => {
  const pluginsDir = path.resolve(process.cwd(), 'server', 'plugins');

  beforeEach(() => {
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test plugins
    for (const file of ['test-safe.js', 'test-escape.js', 'test-malicious.js', 'malicious.ts']) {
      const p = path.join(pluginsDir, file);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it('rejects path traversal in installPlugin', async () => {
    const maliciousCode = 'module.exports = { init: function(api) {} };';
    await expect(
      pluginManager.installPlugin('../../test-malicious.js', maliciousCode)
    ).resolves.toBeDefined();

    // Verify it was saved inside PLUGINS_DIR as 'test-malicious.js', NOT outside
    const outsideFile = path.resolve(process.cwd(), 'test-malicious.js');
    expect(fs.existsSync(outsideFile)).toBe(false);

    // Clean up inside plugins dir if saved as test-malicious.js
    const insideFile = path.join(pluginsDir, 'test-malicious.js');
    if (fs.existsSync(insideFile)) fs.unlinkSync(insideFile);
  });

  it('sandboxes plugin code and blocks access to host process and require', async () => {
    const maliciousPlugin = `
      module.exports = function(api) {
        api.registerTool({
          name: 'exploit_tool',
          description: 'Attempts host escape',
          category: 'security',
          handler: async () => {
            if (typeof process !== 'undefined' && process.env) {
              return { leaked: true };
            }
            if (typeof require !== 'undefined') {
              return { leaked: true };
            }
            if (typeof Buffer !== 'undefined' && Buffer.from) {
              return { leaked: true };
            }
            return { leaked: false };
          }
        });
      };
    `;

    const pluginId = await pluginManager.installPlugin('test-escape.js', maliciousPlugin);
    expect(pluginId).toBe('file:test-escape.js');

    const result = await pluginManager.callTool('exploit_tool', {});
    expect((result as Record<string, unknown>).leaked).toBe(false);

    pluginManager.removePlugin(pluginId!);
    await expect(pluginManager.callTool('exploit_tool', {})).rejects.toThrow();
  });

  it('loads a legitimate custom tool and executes safely', async () => {
    const safePlugin = `
      module.exports = function(api) {
        api.registerTool({
          name: 'safe_weather_calc',
          description: 'Calculates heat index estimate',
          category: 'meteorology',
          handler: async (args) => {
            return { result: Number(args.tempC) * 1.8 + 32 };
          }
        });
      };
    `;

    const pluginId = await pluginManager.installPlugin('test-safe.js', safePlugin);
    expect(pluginId).toBe('file:test-safe.js');

    const output = await pluginManager.callTool('safe_weather_calc', { tempC: 25 });
    expect(output).toEqual({ result: 77 });

    const removed = pluginManager.removePlugin(pluginId!);
    expect(removed).toBe(true);
    await expect(pluginManager.callTool('safe_weather_calc', { tempC: 25 })).rejects.toThrow();
  });
});
