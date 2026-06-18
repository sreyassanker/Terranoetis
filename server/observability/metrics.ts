/* eslint-disable @typescript-eslint/no-explicit-any */
import promClient from 'prom-client';

const register = new promClient.Registry();

promClient.collectDefaultMetrics({ register });

function labelNames(name: string): string[] {
  return name.split(',').map(s => s.trim());
}

// HTTP metrics
export const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: labelNames('method, route, status_code'),
  registers: [register],
});

export const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: labelNames('method, route, status_code'),
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

export const activeSseConnections = new promClient.Gauge({
  name: 'active_sse_connections',
  help: 'Number of active SSE connections',
  registers: [register],
});

// Gemini API metrics
export const geminiApiCallsTotal = new promClient.Counter({
  name: 'gemini_api_calls_total',
  help: 'Total number of Gemini API calls',
  labelNames: labelNames('model, status'),
  registers: [register],
});

export const geminiApiLatency = new promClient.Histogram({
  name: 'gemini_api_latency_ms',
  help: 'Gemini API call latency in milliseconds',
  labelNames: labelNames('model'),
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [register],
});

// Sandbox metrics
export const sandboxExecutionsTotal = new promClient.Counter({
  name: 'sandbox_executions_total',
  help: 'Total number of sandbox code executions',
  labelNames: labelNames('language, status'),
  registers: [register],
});

// Cache metrics
export const cacheHitRate = new promClient.Gauge({
  name: 'cache_hit_rate',
  help: 'Cache hit rate by cache type',
  labelNames: labelNames('cache_type'),
  registers: [register],
});

// DB metrics
export const dbQueryDuration = new promClient.Histogram({
  name: 'db_query_duration_ms',
  help: 'Database query duration in milliseconds',
  labelNames: labelNames('table, operation'),
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  registers: [register],
});

// Plugin metrics
export const pluginLoadsTotal = new promClient.Counter({
  name: 'plugin_loads_total',
  help: 'Total number of plugin loads',
  labelNames: labelNames('plugin_id, status'),
  registers: [register],
});

// Omninet metrics
export const omninetCallsTotal = new promClient.Counter({
  name: 'omninet_calls_total',
  help: 'Total number of Omninet AI calls',
  labelNames: labelNames('endpoint, status'),
  registers: [register],
});

// Tool execution metrics
export const toolExecutionsTotal = new promClient.Counter({
  name: 'tool_executions_total',
  help: 'Total number of tool executions',
  labelNames: labelNames('tool_name, status'),
  registers: [register],
});

export const toolGenerationsTotal = new promClient.Counter({
  name: 'tool_generations_total',
  help: 'Total number of tool generations',
  labelNames: labelNames('status'),
  registers: [register],
});

// Metrics middleware
export function metricsMiddleware(): (req: any, res: any, next: any) => void {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const route = req.route?.path || req.path || 'unknown';
      const status = String(res.statusCode);
      httpRequestsTotal.inc({ method: req.method, route, status_code: status });
      httpRequestDuration.observe({ method: req.method, route, status_code: status }, duration);
    });
    next();
  };
}

export function getMetricsContentType(): string {
  return register.contentType;
}

export async function getMetrics(): Promise<string> {
  return register.metrics();
}
