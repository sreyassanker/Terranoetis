import React from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

export interface ToolSeries {
  label: string;
  points: Array<{ x: number; y: number }>;
  color?: string;
}

interface Props {
  vizType: string;
  series?: ToolSeries[];
  unit?: string;
  color?: string;
}

// Q1-journal / colour-blind-safe palette (Okabe-Ito): high contrast, print-safe.
const CHART_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#F0E442', '#000000'];

const tooltipStyle = {
  background: 'rgba(15,23,42,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  fontSize: 10,
  borderRadius: 6,
};

const tooltipFormatter = (value: unknown, name: unknown) => {
  const v = typeof value === 'number' ? value.toFixed(2) : String(value ?? '');
  return [v, String(name ?? '')] as [string, string];
};

function AxisY({ unit }: { unit?: string }) {
  return <YAxis tick={{ fontSize: 10, fill: '#64748b' }} unit={unit ? ` ${unit}` : undefined} />;
}

function AxisX() {
  return <XAxis dataKey="x" tick={{ fontSize: 10, fill: '#64748b' }} />;
}

/**
 * Merge multiple series into a single chart-data array where each element
 * has { x, series0_y, series1_y, ... } so recharts can draw multiple lines
 * from one data array (the chart-level data).
 */
function mergeSeries(series: ToolSeries[]): { data: Record<string, number>[]; keys: string[] } {
  // Collect all unique x values across all series
  const xSet = new Set<number>();
  for (const s of series) for (const p of s.points) xSet.add(p.x);
  const xSorted = [...xSet].sort((a, b) => a - b);
  // Build lookup: series index → map of x → y
  const lookups = series.map(s => {
    const m = new Map<number, number>();
    for (const p of s.points) m.set(p.x, p.y);
    return m;
  });
  const keys = series.map((_, i) => `y${i}`);
  const data = xSorted.map(x => {
    const row: Record<string, number> = { x: Number.isFinite(x) ? x : 0 };
    for (let i = 0; i < series.length; i++) {
      const y = lookups[i].get(x);
      row[keys[i]] = y != null && Number.isFinite(y) ? y : 0;
    }
    return row;
  });
  return { data, keys };
}

export function ToolResultChart({ vizType, series, unit, color }: Props) {
  if (!series || series.length === 0) {
    return <div style={{ fontSize: 10, color: '#f59e0b', padding: 4 }}>No chart data — no genuine series available.</div>;
  }
  const baseColor = color || '#60a5fa';
  const wrapper: React.CSSProperties = { width: '100%', minWidth: 280 };
  const { data, keys } = mergeSeries(series);
  const title = `${series.map(s => s.label).join(' / ')}${unit ? ` (${unit})` : ''}`;
  if (data.length === 0) {
    return <div style={{ fontSize: 10, color: '#f59e0b', padding: 4 }}>Chart data empty.</div>;
  }

  // Axis label text
  const firstSeriesLabel = series[0]?.label ?? 'Value';
  const yLabel = unit ? `Value (${unit})` : 'Value';
  const labelStyle = { fontSize: 10, fill: '#94a3b8' };

  const axisLabel = (viz: string) => {
    switch (viz) {
      case 'profile': return 'Depth / Height';
      case 'spectrum': return 'Frequency / Wavelength';
      case 'scatter': return 'X variable';
      default: return 'Time / Index';
    }
  };

  switch (vizType) {
    case 'timeseries':
    case 'profile':
      return (
        <div style={wrapper}>
        <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 2, fontFamily: 'JetBrains Mono, monospace' }}>{title}</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 8, dy: 45, ...labelStyle }} tick={{ fontSize: 10, fill: '#64748b' }} unit={unit ? ` ${unit}` : undefined} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} strokeDasharray="0.1 7" strokeLinecap="round" dot={{ r: 3, fill: series[i].color || CHART_COLORS[i % CHART_COLORS.length], strokeWidth: 0 }} isAnimationActive={false} name={series[i].label} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        </div>
      );

    case 'spectrum':
    case 'distribution':
      return (
        <div style={wrapper}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 8, dy: 45, ...labelStyle }} tick={{ fontSize: 10, fill: '#64748b' }} unit={unit ? ` ${unit}` : undefined} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {keys.map((k, i) => (
              <Area key={k} type="monotone" dataKey={k} stroke={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} fill={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.25} strokeWidth={2} name={series[i].label} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        </div>
      );

    case 'bar':
    case 'histogram': {
      const barKeys = keys;
      return (
        <div style={wrapper}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 8, dy: 45, ...labelStyle }} tick={{ fontSize: 10, fill: '#64748b' }} unit={unit ? ` ${unit}` : undefined} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {barKeys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={series[i].color || baseColor} radius={[3, 3, 0, 0]} name={series[i].label} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        </div>
      );
    }

    case 'scatter':
      return (
        <div style={wrapper}>
        <ResponsiveContainer width="100%" height={200}>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" dataKey="x" name="x" label={{ value: firstSeriesLabel, position: 'bottom', offset: -2, ...labelStyle }} tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis type="number" dataKey="y" name="y" label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 8, dy: 45, ...labelStyle }} tick={{ fontSize: 10, fill: '#64748b' }} unit={unit ? ` ${unit}` : undefined} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {keys.map((k, i) => (
              <Scatter key={k} data={series[i].points.map(p => ({ x: p.x, y: p.y }))} fill={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} name={series[i].label} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
        </div>
      );

    default: {
      const lastY = series[0].points[series[0].points.length - 1]?.y ?? 0;
      const barData = [{ x: 'value', y: lastY }];
      return (
        <div style={wrapper}>
        <ResponsiveContainer width="100%" height={90}>
          <BarChart data={barData} margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            <Bar dataKey="y" fill={baseColor} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        </div>
      );
    }
  }
}
