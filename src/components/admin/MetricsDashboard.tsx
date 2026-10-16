import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  Clock,
  Zap,
  Network,
  Server,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Copy,
  Check,
  Globe,
  Database,
  Gauge,
  Terminal,
} from 'lucide-react';

interface MetricsDashboardProps {
  token?: string | null;
  initialMetrics?: Record<string, string>;
  onMetricsUpdate?: (metrics: Record<string, string>) => void;
}

type MetricCategory = 'all' | 'memory' | 'cpu' | 'eventloop' | 'network' | 'app' | 'raw';

// Metadata definition for curated metrics
interface MetricMeta {
  title: string;
  category: 'memory' | 'cpu' | 'eventloop' | 'network' | 'app' | 'runtime';
  desc: string;
  format: 'bytes' | 'seconds' | 'lag_seconds' | 'timestamp' | 'count' | 'percent' | 'ms' | 'string';
  icon?: React.ReactNode;
}

const CURATED_METRICS: Record<string, MetricMeta> = {
  process_resident_memory_bytes: {
    title: 'Resident Set Size (RSS)',
    category: 'memory',
    desc: 'Total memory allocated to the Node.js process by the OS',
    format: 'bytes',
    icon: <HardDrive size={16} />,
  },
  nodejs_heap_size_total_bytes: {
    title: 'V8 Committed Heap',
    category: 'memory',
    desc: 'Total memory reserved by V8 for JavaScript objects',
    format: 'bytes',
    icon: <Layers size={16} />,
  },
  nodejs_heap_size_used_bytes: {
    title: 'V8 Heap In Use',
    category: 'memory',
    desc: 'Memory actively consumed by live JavaScript objects',
    format: 'bytes',
    icon: <Layers size={16} />,
  },
  nodejs_external_memory_bytes: {
    title: 'V8 External Memory',
    category: 'memory',
    desc: 'Memory of C++ objects bound to JS objects (Buffers, etc.)',
    format: 'bytes',
    icon: <HardDrive size={16} />,
  },
  process_cpu_seconds_total: {
    title: 'Total CPU Time',
    category: 'cpu',
    desc: 'Combined CPU execution time spent in user and kernel mode',
    format: 'seconds',
    icon: <Cpu size={16} />,
  },
  process_cpu_user_seconds_total: {
    title: 'User CPU Time',
    category: 'cpu',
    desc: 'CPU execution time spent in application JavaScript/C++ code',
    format: 'seconds',
    icon: <Cpu size={16} />,
  },
  process_cpu_system_seconds_total: {
    title: 'System Kernel CPU Time',
    category: 'cpu',
    desc: 'CPU execution time spent in OS system calls and I/O kernel space',
    format: 'seconds',
    icon: <Cpu size={16} />,
  },
  process_start_time_seconds: {
    title: 'Server Uptime',
    category: 'runtime',
    desc: 'Continuous uptime since the backend process started',
    format: 'timestamp',
    icon: <Clock size={16} />,
  },
  nodejs_eventloop_lag_seconds: {
    title: 'Event Loop Instant Lag',
    category: 'eventloop',
    desc: 'Current scheduling delay of the Node.js libuv event loop',
    format: 'lag_seconds',
    icon: <Zap size={16} />,
  },
  nodejs_eventloop_lag_mean_seconds: {
    title: 'Mean Event Loop Lag',
    category: 'eventloop',
    desc: 'Average scheduling delay across event loop sample periods',
    format: 'lag_seconds',
    icon: <Zap size={16} />,
  },
  nodejs_eventloop_lag_min_seconds: {
    title: 'Min Event Loop Lag',
    category: 'eventloop',
    desc: 'Minimum recorded event loop latency during sampling',
    format: 'lag_seconds',
    icon: <Zap size={16} />,
  },
  nodejs_eventloop_lag_max_seconds: {
    title: 'Max Event Loop Lag',
    category: 'eventloop',
    desc: 'Peak latency spike observed on the event loop',
    format: 'lag_seconds',
    icon: <Zap size={16} />,
  },
  nodejs_eventloop_lag_p50_seconds: {
    title: 'Event Loop Lag (p50)',
    category: 'eventloop',
    desc: 'Median latency — 50% of event loop iterations execute faster than this',
    format: 'lag_seconds',
    icon: <Gauge size={16} />,
  },
  nodejs_eventloop_lag_p90_seconds: {
    title: 'Event Loop Lag (p90)',
    category: 'eventloop',
    desc: '90th percentile latency — upper threshold for 90% of turns',
    format: 'lag_seconds',
    icon: <Gauge size={16} />,
  },
  nodejs_eventloop_lag_p99_seconds: {
    title: 'Event Loop Lag (p99 Tail)',
    category: 'eventloop',
    desc: '99th percentile peak tail latency under heavy workloads',
    format: 'lag_seconds',
    icon: <Gauge size={16} />,
  },
  nodejs_eventloop_lag_stddev_seconds: {
    title: 'Event Loop Jitter (StdDev)',
    category: 'eventloop',
    desc: 'Standard deviation of event loop latency variation',
    format: 'lag_seconds',
    icon: <Activity size={16} />,
  },
  nodejs_active_handles_total: {
    title: 'Active Libuv Handles',
    category: 'network',
    desc: 'Total active I/O handles (sockets, timers, file streams)',
    format: 'count',
    icon: <Network size={16} />,
  },
  nodejs_active_requests_total: {
    title: 'Active Libuv Requests',
    category: 'network',
    desc: 'In-flight asynchronous requests in the libuv thread pool',
    format: 'count',
    icon: <Network size={16} />,
  },
  nodejs_active_resources_total: {
    title: 'Active Async Resources',
    category: 'network',
    desc: 'Total active Node.js async tracking resources',
    format: 'count',
    icon: <Network size={16} />,
  },
  active_sse_connections: {
    title: 'Active SSE Subscribers',
    category: 'network',
    desc: 'Connected live Server-Sent Events realtime streams',
    format: 'count',
    icon: <Globe size={16} />,
  },
  http_requests_total: {
    title: 'HTTP Requests Served',
    category: 'app',
    desc: 'Total HTTP requests handled by the Express gateway',
    format: 'count',
    icon: <Server size={16} />,
  },
  cache_hit_rate: {
    title: 'Cache Hit Ratio',
    category: 'app',
    desc: 'Ratio of queries resolved directly from memory cache',
    format: 'percent',
    icon: <Database size={16} />,
  },
  sandbox_executions_total: {
    title: 'Sandbox Code Executions',
    category: 'app',
    desc: 'Total isolated geospatial and Python sandbox runs',
    format: 'count',
    icon: <Terminal size={16} />,
  },
  omninet_calls_total: {
    title: 'Omninet Neural Invocations',
    category: 'app',
    desc: 'Total AI and vision inference calls dispatched',
    format: 'count',
    icon: <Zap size={16} />,
  },
  tool_executions_total: {
    title: 'AI Tool Executions',
    category: 'app',
    desc: 'Total function tool calls performed by cognitive agents',
    format: 'count',
    icon: <Activity size={16} />,
  },
};

// Formatting helpers
function formatBytes(bytes: number): string {
  if (isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatSeconds(sec: number): string {
  if (isNaN(sec) || sec <= 0) return '0.00 s';
  if (sec < 0.001) return `${(sec * 1000000).toFixed(0)} µs`;
  if (sec < 1) return `${(sec * 1000).toFixed(1)} ms`;
  if (sec < 60) return `${sec.toFixed(2)} s`;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(0);
  return `${m}m ${s}s`;
}

function formatLagMs(sec: number): { text: string; ms: number; status: 'optimal' | 'moderate' | 'elevated' | 'laggy' } {
  if (isNaN(sec) || sec < 0 || sec > 1000000) {
    return { text: '< 0.1 ms', ms: 0.1, status: 'optimal' };
  }
  const ms = sec * 1000;
  let status: 'optimal' | 'moderate' | 'elevated' | 'laggy' = 'optimal';
  if (ms > 100) status = 'laggy';
  else if (ms > 40) status = 'elevated';
  else if (ms > 15) status = 'moderate';

  if (ms < 0.01) return { text: '< 0.01 ms', ms, status };
  if (ms < 1) return { text: `${ms.toFixed(2)} ms`, ms, status };
  if (ms < 10) return { text: `${ms.toFixed(2)} ms`, ms, status };
  if (ms < 1000) return { text: `${ms.toFixed(1)} ms`, ms, status };
  return { text: `${(ms / 1000).toFixed(2)} s`, ms, status };
}

function formatUptime(epochSec: number): { duration: string; startedAt: string } {
  if (isNaN(epochSec) || epochSec <= 0) return { duration: 'Just started', startedAt: 'Unknown' };
  const nowSec = Date.now() / 1000;
  const diff = Math.max(0, Math.floor(nowSec - epochSec));
  const started = new Date(epochSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return { duration: parts.join(' '), startedAt: started };
}

function parseMetricKey(rawKey: string): { baseKey: string; labels: Record<string, string> } {
  const match = rawKey.match(/^([a-zA-Z0-9_:]+)(?:\{([^}]+)\})?$/);
  if (!match) return { baseKey: rawKey, labels: {} };

  const baseKey = match[1];
  const labelStr = match[2];
  const labels: Record<string, string> = {};

  if (labelStr) {
    const pairs = labelStr.match(/([a-zA-Z0-9_]+)="([^"]*)"/g);
    if (pairs) {
      for (const p of pairs) {
        const [k, v] = p.split('=');
        labels[k] = v.replace(/^"|"$/g, '');
      }
    }
  }
  return { baseKey, labels };
}

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({
  token,
  initialMetrics,
  onMetricsUpdate,
}) => {
  const [metrics, setMetrics] = useState<Record<string, string>>(initialMetrics || {});
  const [rawText, setRawText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(!initialMetrics || Object.keys(initialMetrics).length === 0);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshInterval, setRefreshInterval] = useState<number>(5000); // 5s default
  const [activeCategory, setActiveCategory] = useState<MetricCategory>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch metrics from Prometheus endpoint
  const fetchMetrics = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/metrics', {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (resp.ok) {
        const text = await resp.text();
        setRawText(text);
        const parsed: Record<string, string> = {};
        for (const line of text.split('\n')) {
          if (line && !line.startsWith('#') && !line.startsWith('TYPE') && !line.startsWith('HELP')) {
            const parts = line.split(' ');
            if (parts.length >= 2) {
              const key = parts.slice(0, -1).join(' ');
              parsed[key] = parts[parts.length - 1];
            }
          }
        }
        setMetrics(parsed);
        setLastUpdated(new Date());
        setError(null);
        if (onMetricsUpdate) onMetricsUpdate(parsed);
      } else {
        setError(`Failed to fetch metrics: HTTP ${resp.status}`);
      }
    } catch (e) {
      setError(`Telemetry connection error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [token, onMetricsUpdate]);

  // Periodic polling
  useEffect(() => {
    void fetchMetrics();
    if (refreshInterval > 0) {
      const timer = setInterval(() => {
        void fetchMetrics();
      }, refreshInterval);
      return () => clearInterval(timer);
    }
  }, [fetchMetrics, refreshInterval]);

  // KPI Calculations
  const kpis = useMemo(() => {
    const rss = parseFloat(metrics['process_resident_memory_bytes'] || '0');
    const heapTotal = parseFloat(metrics['nodejs_heap_size_total_bytes'] || '0');
    const heapUsed = parseFloat(metrics['nodejs_heap_size_used_bytes'] || '0');
    const extMem = parseFloat(metrics['nodejs_external_memory_bytes'] || '0');

    const cpuUser = parseFloat(metrics['process_cpu_user_seconds_total'] || '0');
    const cpuSys = parseFloat(metrics['process_cpu_system_seconds_total'] || '0');
    const cpuTotal = parseFloat(metrics['process_cpu_seconds_total'] || String(cpuUser + cpuSys));

    const startTime = parseFloat(metrics['process_start_time_seconds'] || '0');
    const uptime = formatUptime(startTime);

    const lagMean = parseFloat(metrics['nodejs_eventloop_lag_mean_seconds'] || '0');
    const lagP50 = parseFloat(metrics['nodejs_eventloop_lag_p50_seconds'] || '0');
    const lagP90 = parseFloat(metrics['nodejs_eventloop_lag_p90_seconds'] || '0');
    const lagP99 = parseFloat(metrics['nodejs_eventloop_lag_p99_seconds'] || '0');
    const lagMax = parseFloat(metrics['nodejs_eventloop_lag_max_seconds'] || '0');

    const activeHandles = parseInt(metrics['nodejs_active_handles_total'] || '0', 10);
    const activeRequests = parseInt(metrics['nodejs_active_requests_total'] || '0', 10);
    const activeResources = parseInt(metrics['nodejs_active_resources_total'] || '0', 10);

    const heapPercent = heapTotal > 0 ? Math.min(100, Math.round((heapUsed / heapTotal) * 100)) : 0;
    const heapStatus = heapUsed > 800 * 1024 * 1024 ? 'elevated' : heapUsed > 400 * 1024 * 1024 ? 'moderate' : 'optimal';
    const heapColor = heapStatus === 'elevated' ? '#ef4444' : heapStatus === 'moderate' ? '#f59e0b' : '#38bdf8';
    const cpuUserPercent = cpuTotal > 0 ? Math.round((cpuUser / cpuTotal) * 100) : 80;
    const cpuSysPercent = 100 - cpuUserPercent;

    return {
      rss,
      heapTotal,
      heapUsed,
      extMem,
      heapPercent,
      heapStatus,
      heapColor,
      cpuUser,
      cpuSys,
      cpuTotal,
      cpuUserPercent,
      cpuSysPercent,
      uptime,
      lagMean,
      lagP50,
      lagP90,
      lagP99,
      lagMax,
      activeHandles,
      activeRequests,
      activeResources,
    };
  }, [metrics]);

  // Count distinct metric families (excluding histogram buckets)
  const uniqueMetricCount = useMemo(() => {
    const set = new Set<string>();
    for (const k of Object.keys(metrics)) {
      if (k.includes('_bucket{') || k.endsWith('_bucket')) continue;
      set.add(k.split('{')[0]);
    }
    return set.size;
  }, [metrics]);

  // Handle Copy Raw Prometheus Text
  const handleCopyRaw = useCallback(() => {
    navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [rawText]);

  // Categorized & Filtered Metrics
  const filteredMetrics = useMemo(() => {
    const entries = Object.entries(metrics);
    return entries.filter(([rawKey, val]) => {
      // If not in raw tab, omit internal histogram bucket lines to avoid cluttering with 300+ buckets
      if (activeCategory !== 'raw' && (rawKey.includes('_bucket{') || rawKey.endsWith('_bucket'))) {
        return false;
      }

      const { baseKey, labels } = parseMetricKey(rawKey);
      const meta = CURATED_METRICS[baseKey];

      // Category filter
      if (activeCategory !== 'all' && activeCategory !== 'raw') {
        const cat = meta?.category;
        if (activeCategory === 'memory' && cat !== 'memory') return false;
        if (activeCategory === 'cpu' && cat !== 'cpu') return false;
        if (activeCategory === 'eventloop' && cat !== 'eventloop') return false;
        if (activeCategory === 'network' && cat !== 'network') return false;
        if (activeCategory === 'app' && cat !== 'app') return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const labelText = Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(' ').toLowerCase();
        const titleMatch = meta?.title.toLowerCase().includes(q);
        const keyMatch = rawKey.toLowerCase().includes(q);
        const descMatch = meta?.desc.toLowerCase().includes(q);
        const valMatch = String(val).toLowerCase().includes(q);
        return titleMatch || keyMatch || descMatch || valMatch || labelText.includes(q);
      }

      return true;
    });
  }, [metrics, activeCategory, searchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Top Header Controls & Live Heartbeat ── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: 12,
        border: '1px solid rgba(255, 255, 255, 0.07)',
      }}>
        {/* Status Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 20,
            background: 'rgba(34, 197, 94, 0.12)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            color: '#4ade80',
            fontSize: 12,
            fontWeight: 600,
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#22c55e',
              boxShadow: '0 0 8px #22c55e',
              display: 'inline-block',
            }} />
            SYSTEM OPTIMAL
          </div>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Refresh Interval Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
            <span>Auto-refresh:</span>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#f1f5f9',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 12,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value={2000}>2s (Live)</option>
              <option value={5000}>5s (Default)</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={0}>Paused</option>
            </select>
          </div>

          {/* Manual Refresh Button */}
          <button
            onClick={() => void fetchMetrics()}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 6,
              padding: '6px 12px',
              color: '#e2e8f0',
              fontSize: 12,
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            <span>Refresh</span>
          </button>

          {/* Copy Raw Prometheus Data */}
          <button
            onClick={handleCopyRaw}
            title="Copy raw Prometheus metrics text to clipboard"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: copied ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              border: copied ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 6,
              padding: '6px 12px',
              color: copied ? '#4ade80' : '#e2e8f0',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copied Prometheus' : 'Copy All'}</span>
          </button>
        </div>
      </div>

      {/* Error alert banner */}
      {error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 8,
          color: '#f87171',
          fontSize: 13,
        }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* ── 4 Executive High-Level KPI Cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 12,
      }}>
        {/* KPI 1: Memory */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid rgba(96, 165, 250, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 10,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <HardDrive size={16} style={{ color: '#38bdf8' }} />
              RAM Allocation (RSS)
            </span>
            <span style={{
              fontSize: 11,
              background: kpis.heapStatus === 'optimal' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
              color: kpis.heapStatus === 'optimal' ? '#4ade80' : '#facc15',
              padding: '2px 6px',
              borderRadius: 4,
              fontWeight: 600,
            }}>
              {kpis.heapStatus === 'optimal' ? 'Healthy' : 'Active'}
            </span>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
              {formatBytes(kpis.rss)}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              V8 In-Use: <strong>{formatBytes(kpis.heapUsed)}</strong> · Committed: {formatBytes(kpis.heapTotal)}
            </div>
          </div>
          {/* Progress Bar showing proportion of normal operating threshold */}
          <div style={{ width: '100%', height: 6, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, Math.max(8, Math.round((kpis.heapUsed / (512 * 1024 * 1024)) * 100)))}%`,
              height: '100%',
              background: kpis.heapColor,
              borderRadius: 3,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        {/* KPI 2: CPU Execution Time */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid rgba(168, 85, 247, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 10,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Cpu size={16} style={{ color: '#c084fc' }} />
              CPU Execution Time
            </span>
            <span style={{ fontSize: 11, background: 'rgba(192, 132, 252, 0.15)', color: '#c084fc', padding: '2px 6px', borderRadius: 4 }}>
              Total Time
            </span>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
              {formatSeconds(kpis.cpuTotal)}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              User: <strong>{formatSeconds(kpis.cpuUser)}</strong> ({kpis.cpuUserPercent}%) · Sys: {formatSeconds(kpis.cpuSys)}
            </div>
          </div>
          {/* Dual Split Bar */}
          <div style={{ width: '100%', height: 6, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${kpis.cpuUserPercent}%`, height: '100%', background: '#c084fc' }} title={`User CPU: ${kpis.cpuUserPercent}%`} />
            <div style={{ width: `${kpis.cpuSysPercent}%`, height: '100%', background: '#818cf8' }} title={`System CPU: ${kpis.cpuSysPercent}%`} />
          </div>
        </div>

        {/* KPI 3: Event Loop Latency */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid rgba(34, 197, 94, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 10,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={16} style={{ color: '#4ade80' }} />
              Event Loop Lag (Mean)
            </span>
            {(() => {
              const lagInfo = formatLagMs(kpis.lagMean);
              return (
                <span style={{
                  fontSize: 11,
                  background: lagInfo.status === 'optimal' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                  color: lagInfo.status === 'optimal' ? '#4ade80' : '#facc15',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontWeight: 600,
                }}>
                  {lagInfo.status === 'optimal' ? 'Optimal' : 'Active'}
                </span>
              );
            })()}
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
              {formatLagMs(kpis.lagMean).text}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              p50: <strong>{formatLagMs(kpis.lagP50).text}</strong> · p99: {formatLagMs(kpis.lagP99).text}
            </div>
          </div>
          {/* Latency Bar */}
          <div style={{ width: '100%', height: 6, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, Math.max(5, (kpis.lagMean * 1000 / 25) * 100))}%`,
              height: '100%',
              background: '#4ade80',
              borderRadius: 3,
            }} />
          </div>
        </div>

        {/* KPI 4: Continuous Uptime */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)',
          borderRadius: 12,
          padding: '16px',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 10,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={16} style={{ color: '#fbbf24' }} />
              Process Uptime
            </span>
            <span style={{ fontSize: 11, background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24', padding: '2px 6px', borderRadius: 4 }}>
              Online
            </span>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
              {kpis.uptime.duration}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              Started at <strong>{kpis.uptime.startedAt}</strong> · Async Handles: {kpis.activeHandles}
            </div>
          </div>
          {/* Active indicator */}
          <div style={{ width: '100%', height: 6, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: '100%', height: '100%', background: '#fbbf24', borderRadius: 3 }} />
          </div>
        </div>
      </div>

      {/* ── Category Tabs & Live Search Filter ── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        paddingBottom: 8,
      }}>
        {/* Category Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[
            { id: 'all' as MetricCategory, label: 'All Metrics', count: uniqueMetricCount },
            { id: 'memory' as MetricCategory, label: 'Memory & V8', icon: <HardDrive size={13} /> },
            { id: 'cpu' as MetricCategory, label: 'CPU & Cores', icon: <Cpu size={13} /> },
            { id: 'eventloop' as MetricCategory, label: 'Event Loop', icon: <Zap size={13} /> },
            { id: 'network' as MetricCategory, label: 'Network & Sockets', icon: <Network size={13} /> },
            { id: 'app' as MetricCategory, label: 'Application & AI', icon: <Server size={13} /> },
            { id: 'raw' as MetricCategory, label: 'Raw Prometheus', icon: <Terminal size={13} /> },
          ].map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  background: isActive ? '#2563eb' : 'rgba(255, 255, 255, 0.04)',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  border: isActive ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {cat.icon}
                <span>{cat.label}</span>
                {cat.count !== undefined && (
                  <span style={{
                    fontSize: 10,
                    padding: '1px 5px',
                    borderRadius: 10,
                    background: isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
                    color: isActive ? '#fff' : '#cbd5e1',
                  }}>
                    {cat.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Live Search Bar */}
        <div style={{ position: 'relative', minWidth: 220, maxWidth: 320, flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            placeholder="Search metric, key, or value..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 10px 6px 30px',
              borderRadius: 8,
              fontSize: 12,
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#f8fafc',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* ── Metric Display Area ── */}
      {activeCategory === 'raw' ? (
        /* Raw Prometheus Explorer */
        <div style={{
          background: 'rgba(15, 23, 42, 0.85)',
          borderRadius: 10,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          padding: 16,
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#cbd5e1',
          overflowX: 'auto',
          maxHeight: 520,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Standard OpenMetrics / Prometheus Exposition Output</span>
            <button
              onClick={handleCopyRaw}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#e2e8f0',
                padding: '4px 10px',
                borderRadius: 5,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'Copied!' : 'Copy Exposition Text'}</span>
            </button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5 }}>
            {rawText || 'No raw Prometheus text available.'}
          </pre>
        </div>
      ) : (
        /* Formatted Metric Cards Grid */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {filteredMetrics.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center', color: '#64748b' }}>
              No metrics found matching &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            filteredMetrics.map(([rawKey, val]) => {
              const { baseKey, labels } = parseMetricKey(rawKey);
              const meta = CURATED_METRICS[baseKey];
              const numVal = parseFloat(val);

              // Friendly title fallback
              let title = meta?.title;
              if (!title) {
                // Convert snake_case to clean words
                title = baseKey
                  .replace(/^(nodejs_|process_)/, '')
                  .replace(/_(total|bytes|seconds|ms)$/, '')
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase());
              }

              // Value formatting
              let formattedVal = val;
              let unitLabel = '';

              if (meta?.format === 'bytes' || baseKey.endsWith('_bytes')) {
                formattedVal = formatBytes(numVal);
              } else if (meta?.format === 'lag_seconds' || baseKey.includes('eventloop_lag')) {
                const lag = formatLagMs(numVal);
                formattedVal = lag.text;
              } else if (meta?.format === 'seconds' || baseKey.endsWith('_seconds_total')) {
                formattedVal = formatSeconds(numVal);
              } else if (meta?.format === 'timestamp' || baseKey.includes('start_time')) {
                formattedVal = formatUptime(numVal).duration;
                unitLabel = 'uptime';
              } else if (meta?.format === 'percent') {
                formattedVal = `${(numVal * 100).toFixed(1)}%`;
              } else if (!isNaN(numVal) && Number.isInteger(numVal)) {
                formattedVal = numVal.toLocaleString();
              } else if (!isNaN(numVal)) {
                formattedVal = numVal.toFixed(3);
              }

              return (
                <div
                  key={rawKey}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: 10,
                    padding: '14px 16px',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 8,
                    transition: 'border-color 0.15s ease, background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  }}
                >
                  {/* Top Bar: Title & Category Icon */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
                        {title}
                      </div>
                      {meta?.desc && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, lineHeight: 1.3 }}>
                          {meta.desc}
                        </div>
                      )}
                    </div>
                    <div style={{ color: '#60a5fa', flexShrink: 0, marginTop: 2 }}>
                      {meta?.icon || <Activity size={15} />}
                    </div>
                  </div>

                  {/* Labels if any */}
                  {Object.keys(labels).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '2px 0' }}>
                      {Object.entries(labels).map(([lk, lv]) => (
                        <span
                          key={lk}
                          style={{
                            fontSize: 10,
                            fontFamily: 'monospace',
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'rgba(56, 189, 248, 0.1)',
                            border: '1px solid rgba(56, 189, 248, 0.25)',
                            color: '#38bdf8',
                          }}
                        >
                          {lk}: {lv}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Value Row */}
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
                    <div style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: '#60a5fa',
                      letterSpacing: '-0.02em',
                      fontFeatureSettings: '"tnum"',
                    }}>
                      {formattedVal}
                      {unitLabel && <span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8', marginLeft: 4 }}>{unitLabel}</span>}
                    </div>
                  </div>

                  {/* Monospace Raw Key Pill at bottom */}
                  <div style={{
                    fontSize: 10,
                    color: '#64748b',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                    paddingTop: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <span>{rawKey}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
