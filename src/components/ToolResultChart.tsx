import React from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { CHART_COLORS, mergeSeries, type ToolSeries } from './chartShared';
import { formatSciCompact } from '../lib/formatSci';

interface Props {
  vizType: string;
  series?: ToolSeries[];
  unit?: string;
  color?: string;
}

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

  // Axis label text (scientifically correct per vizType, from the governing papers)
  const firstSeriesLabel = series[0]?.label ?? 'Value';
  const yLabelFor = (viz: string) => {
    if (viz === 'distribution') return unit ? `Density (${unit})` : 'Density'; // covers probability f(x) AND size N(D) densities
    if (viz === 'histogram') return 'Frequency / Count';
    if (viz === 'spectrum') return unit ? `Spectral Density (${unit})` : 'Spectral Density';
    return unit ? `Value (${unit})` : 'Value';
  };
  const yLabel = yLabelFor(vizType);
  const labelStyle = { fontSize: 10, fill: '#94a3b8' };

  // Clean numeric tick values: avoid full float precision ("0.37275937…"),
  // huge integers ("3000000000000000000") and cramped exponential ticks.
  const fmtTick = (v: unknown): string => {
    return typeof v === 'number' ? formatSciCompact(v) : String(v ?? '');
  };
  const tickProps = { fontSize: 10, fill: '#64748b' };

  const axisLabel = (viz: string) => {
    switch (viz) {
      case 'profile': return 'Depth / Height';
      case 'spectrum': return 'Frequency / Wavelength';
      case 'distribution': return 'Value';
      case 'bar': return 'Category';
      case 'histogram': return 'Bin';
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
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 8, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} strokeDasharray={i === 0 ? '0.2 7' : '4 4'} strokeLinecap="round" dot={{ r: 3, fill: series[i].color || CHART_COLORS[i % CHART_COLORS.length], strokeWidth: 0 }} isAnimationActive={false} name={series[i].label} />
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
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 8, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {keys.map((k, i) => (
              <Area key={k} type="monotone" dataKey={k} stroke={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} fill={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} name={series[i].label} />
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
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 8, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {barKeys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={series[i].color || baseColor} radius={[3, 3, 0, 0]} isAnimationActive={false} name={series[i].label} />
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
          <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" dataKey="x" name="x" label={{ value: firstSeriesLabel, position: 'bottom', offset: -2, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis type="number" dataKey="y" name="y" label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 8, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {keys.map((k, i) => (
              <Scatter key={k} data={series[i].points.map(p => ({ x: p.x, y: p.y }))} fill={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} isAnimationActive={false} name={series[i].label} />
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
          <BarChart data={barData} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            <Bar dataKey="y" fill={baseColor} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        </div>
      );
    }
  }
}
