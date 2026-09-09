// Example Earth Intelligence Plugin
// Drop .ts files into server/plugins/ — they auto-load every 30s.
//
// Plugin API available:
//   api.registerTool(tool)    — register a custom tool
//   api.unregisterTool(name)  — remove a tool
//   api.log(level, msg)       — log to server console

module.exports = {};

module.exports.init = function(api: { log: (level: string, msg: string) => void; registerTool: (tool: Record<string, unknown>) => void; registerDataSource: (source: Record<string, unknown>) => void }) {
  api.log('info', 'Example plugin loaded');

  api.registerTool({
    name: 'hello_world',
    description: 'A friendly greeting tool',
    category: 'custom',
    handler: async (args: { name?: string }) => {
      const name = args.name || 'World';
      return { greeting: `Hello, ${name}! From Earth Intelligence plugin.` };
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
