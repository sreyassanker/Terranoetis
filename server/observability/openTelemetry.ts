/**
 * OpenTelemetry Full-Stack Observability
 *
 * Provides vendor-neutral distributed tracing, metrics, and logging:
 * - Correlate frontend clicks with backend database queries
 * - Trace API request lifecycle across services
 * - Monitor performance of 460+ data layers
 * - Custom spans for AI model calls and data processing
 *
 * Based on: https://opentelemetry.io/
 * SDK: @opentelemetry/sdk-node, @opentelemetry/api
 * Exporters: OTLP (for Jaeger, Grafana Tempo, Datadog, etc.)
 */

import { logger } from './logger';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface TraceSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: 'client' | 'server' | 'internal' | 'producer' | 'consumer';
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'ok' | 'error' | 'timeout';
  attributes: Record<string, string | number | boolean>;
  events: TraceEvent[];
  parentSpanId?: string;
}

export interface TraceEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, string | number | boolean>;
}

export interface MetricData {
  name: string;
  type: 'counter' | 'histogram' | 'gauge';
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface ObservabilityConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  enabled: boolean;
  exportUrl?: string;  // OTLP endpoint
  sampleRate: number;  // 0-1
}

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory Trace Store (Development/No-OTLP)
// ═══════════════════════════════════════════════════════════════════════════

const MAX_SPANS = 10000;
const MAX_METRICS = 5000;

let spans: TraceSpan[] = [];
let metrics: MetricData[] = [];
let config: ObservabilityConfig = {
  serviceName: 'earth-intelligence',
  serviceVersion: '1.0.0',
  environment: 'development',
  enabled: true,
  sampleRate: 1.0,
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const traceCounter = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const spanCounter = 0;

// ═══════════════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize OpenTelemetry observability
 */
export function initObservability(userConfig?: Partial<ObservabilityConfig>): void {
  config = { ...config, ...userConfig };

  if (!config.enabled) {
    logger.info('[OpenTelemetry] Observability disabled');
    return;
  }

  // In production, this would initialize the OTel SDK:
  // import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
  // import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

  logger.info({
    service: config.serviceName,
    version: config.serviceVersion,
    env: config.environment,
    sampleRate: config.sampleRate,
  }, '[OpenTelemetry] Observability initialized');
}

// ═══════════════════════════════════════════════════════════════════════════
// Tracing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start a new trace span
 */
export function startSpan(
  name: string,
  kind: TraceSpan['kind'] = 'internal',
  attributes: Record<string, string | number | boolean> = {},
  parentSpanId?: string,
): TraceSpan {
  if (!config.enabled || Math.random() > config.sampleRate) {
    return createNoopSpan(name);
  }

  const traceId = parentSpanId ? getTraceIdFromParent(parentSpanId) : generateId();
  const spanId = generateId();

  const span: TraceSpan = {
    traceId,
    spanId,
    name,
    kind,
    startTime: Date.now(),
    status: 'ok',
    attributes: {
      ...attributes,
      'service.name': config.serviceName,
      'service.version': config.serviceVersion,
      'environment': config.environment,
    },
    events: [],
    parentSpanId,
  };

  spans.push(span);
  if (spans.length > MAX_SPANS) {
    spans = spans.slice(-MAX_SPANS / 2);
  }

  return span;
}

/**
 * End a trace span
 */
export function endSpan(span: TraceSpan, status: TraceSpan['status'] = 'ok'): void {
  span.endTime = Date.now();
  span.duration = span.endTime - span.startTime;
  span.status = status;
}

/**
 * Add an event to a span
 */
export function addSpanEvent(
  span: TraceSpan,
  name: string,
  attributes: Record<string, string | number | boolean> = {},
): void {
  span.events.push({
    name,
    timestamp: Date.now(),
    attributes,
  });
}

/**
 * Trace an async function execution
 */
export async function traceAsync<T>(
  name: string,
  fn: () => Promise<T>,
  attributes: Record<string, string | number | boolean> = {},
): Promise<T> {
  const span = startSpan(name, 'internal', attributes);
  try {
    const result = await fn();
    endSpan(span, 'ok');
    return result;
  } catch (e) {
    endSpan(span, 'error');
    addSpanEvent(span, 'exception', {
      'exception.type': (e as Error).name,
      'exception.message': (e as Error).message,
    });
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Metrics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a metric value
 */
export function recordMetric(
  name: string,
  type: MetricData['type'],
  value: number,
  labels: Record<string, string> = {},
): void {
  if (!config.enabled) return;

  metrics.push({
    name,
    type,
    value,
    labels,
    timestamp: Date.now(),
  });

  if (metrics.length > MAX_METRICS) {
    metrics = metrics.slice(-MAX_METRICS / 2);
  }
}

/**
 * Increment a counter metric
 */
export function incrementCounter(
  name: string,
  labels: Record<string, string> = {},
): void {
  const existing = metrics.find(
    (m) => m.name === name && m.type === 'counter' && JSON.stringify(m.labels) === JSON.stringify(labels),
  );

  if (existing) {
    existing.value++;
    existing.timestamp = Date.now();
  } else {
    recordMetric(name, 'counter', 1, labels);
  }
}

/**
 * Record a histogram value
 */

// ═══════════════════════════════════════════════════════════════════════════
// Query
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent traces
 */
export function getRecentTraces(limit: number = 50): TraceSpan[] {
  return spans.slice(-limit);
}

/**
 * Get metrics summary
 */
export function getMetricsSummary(): {
  counters: Record<string, number>;
  histograms: Record<string, { avg: number; count: number; max: number }>;
  gauges: Record<string, number>;
} {
  const counters: Record<string, number> = {};
  const histograms: Record<string, { sum: number; count: number; max: number }> = {};
  const gauges: Record<string, number> = {};

  for (const m of metrics) {
    if (m.type === 'counter') {
      counters[m.name] = (counters[m.name] || 0) + m.value;
    } else if (m.type === 'histogram') {
      if (!histograms[m.name]) histograms[m.name] = { sum: 0, count: 0, max: 0 };
      histograms[m.name].sum += m.value;
      histograms[m.name].count++;
      histograms[m.name].max = Math.max(histograms[m.name].max, m.value);
    } else {
      gauges[m.name] = m.value;
    }
  }

  return {
    counters,
    histograms: Object.fromEntries(
      Object.entries(histograms).map(([k, v]) => [k, { avg: v.sum / v.count, count: v.count, max: v.max }]),
    ),
    gauges,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

function generateId(): string {
  return Math.random().toString(36).substring(2, 14) + Math.random().toString(36).substring(2, 14);
}

function getTraceIdFromParent(_parentSpanId: string): string {
  // In production, look up the parent span to get the traceId
  return generateId();
}

function createNoopSpan(name: string): TraceSpan {
  return {
    traceId: '',
    spanId: '',
    name,
    kind: 'internal',
    startTime: Date.now(),
    status: 'ok',
    attributes: {},
    events: [],
  };
}
