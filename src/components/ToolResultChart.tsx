import React from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { CHART_COLORS, mergeSeries, type ToolSeries } from './chartShared';
import { formatSciCompact } from '../lib/formatSci';

interface Props {
  vizType: string;
  series?: ToolSeries[];
  unit?: string;
  color?: string;
  /** Optional value→color ramp (same stops as the heatmap). When supplied,
   *  histogram bars are colored per-bin by their value (matches the globe). */
  colorStops?: Array<{ stop: number; r: number; g: number; b: number }>;
}

/** Interpolate a value in [vmin, vmax] through a color-stop ramp → CSS color. */
function colorForValue(v: number, vmin: number, vmax: number, stops: Array<{ stop: number; r: number; g: number; b: number }>): string {
  if (!stops || stops.length === 0) return '#8b5cf6';
  const t = vmax > vmin ? Math.max(0, Math.min(1, (v - vmin) / (vmax - vmin))) : 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const c0 = stops[i], c1 = stops[i + 1];
    if (t >= c0.stop && t <= c1.stop) {
      const seg = (c1.stop - c0.stop) === 0 ? 0 : (t - c0.stop) / (c1.stop - c0.stop);
      const r = Math.round(c0.r + (c1.r - c0.r) * seg);
      const g = Math.round(c0.g + (c1.g - c0.g) * seg);
      const b = Math.round(c0.b + (c1.b - c0.b) * seg);
      return `rgb(${r},${g},${b})`;
    }
  }
  const last = stops[stops.length - 1];
  return `rgb(${last.r},${last.g},${last.b})`;
}

/** Custom Y-axis title: rotated text pinned flush against the axis line (no
 *  extra gap). Anchored near the bottom of the axis, lifted slightly up. */
function AxisYLabel({ viewBox, children, fill }: {
  viewBox?: { x: number; y: number; width: number; height: number };
  children?: React.ReactNode; fill?: string;
}) {
  const vb = viewBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const cx = vb.x + 6;
  const cy = vb.y + vb.height - 60;
  return (
    <text x={cx} y={cy} transform={`rotate(-90 ${cx} ${cy})`} textAnchor="middle" fill={fill ?? '#94a3b8'} fontSize={10}>
      {children}
    </text>
  );
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

export function ToolResultChart({ vizType, series, unit, color, colorStops }: Props) {
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
  const yLabelFor = (viz: string) => {
    if (viz === 'distribution') return unit ? `Density (${unit})` : 'Density'; // covers probability f(x) AND size N(D) densities
    if (viz === 'histogram') return 'Frequency / Count';
    if (viz === 'spectrum') return unit ? `Spectral Density (${unit})` : 'Spectral Density';
    return unit ? `Value (${unit})` : 'Value';
  };
  const yLabel = yLabelFor(vizType);
  const labelStyle = { fontSize: 10, fill: '#94a3b8' };
  const titleStyle: React.CSSProperties = { fontSize: 9, color: '#94a3b8', marginBottom: 2, fontFamily: 'JetBrains Mono, monospace' };

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
        <div style={titleStyle}>{title}</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis label={<AxisYLabel>{yLabel}</AxisYLabel>} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} strokeDasharray={i === 0 ? '0.2 7' : '4 4'} strokeLinecap="round" dot={{ r: 3, fill: series[i].color || CHART_COLORS[i % CHART_COLORS.length], strokeWidth: 0 }} isAnimationActive={false} name={series[i].label} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        </div>
      );

    case 'spectrum':
    case 'distribution': {
      // Spectra span orders of magnitude (Planck ~1e-198→1e+6); a linear Y
      // flattens the curve. Use a log10 Y axis when the positive range spans
      // >3 decades so the physical shape is visible (standard practice).
      const yAll = series.flatMap(s => s.points.map(p => p.y));
      const yPos = yAll.filter(v => Number.isFinite(v) && v > 0);
      const useLogY = (vizType === 'spectrum' || vizType === 'distribution')
        && yPos.length > 0
        && Math.log10(Math.max(...yPos)) - Math.log10(Math.min(...yPos)) > 3;
      const yLogMin = useLogY ? Math.log10(Math.min(...yPos)) : 0;
      const yLogMax = useLogY ? Math.log10(Math.max(...yPos)) : 0;
      const yLogDomain = useLogY
        ? [Math.pow(10, yLogMin), Math.pow(10, yLogMax + 0.2)] as [number, number]
        : [0, 'auto'] as [number, 'auto'];
      const fmtLogTick = useLogY
        ? (v: unknown): string => (typeof v === 'number' && v > 0 ? v.toExponential(0) : String(v ?? ''))
        : fmtTick;
      return (
        <div style={wrapper}>
        <div style={titleStyle}>{title}</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis domain={yLogDomain} scale={useLogY ? 'log' : 'linear'} allowDataOverflow label={<AxisYLabel>{yLabel}</AxisYLabel>} tick={{ ...tickProps }} tickFormatter={fmtLogTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {keys.map((k, i) => (
              <Area key={k} type="monotone" dataKey={k} stroke={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} fill={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} name={series[i].label} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        </div>
      );
    }

    case 'bar':
    case 'histogram': {
      const barKeys = keys;
      const useBinColors = vizType === 'histogram' && !!colorStops && colorStops.length > 0;
      // Histogram: value range for per-bin color mapping (matches the heatmap).
      const histMin = data.length ? Math.min(...data.map(d => Number(d.x))) : 0;
      const histMax = data.length ? Math.max(...data.map(d => Number(d.x))) : 1;
      return (
        <div style={wrapper}>
        <div style={titleStyle}>{title}</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis label={<AxisYLabel>{yLabel}</AxisYLabel>} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            {barKeys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={series[i].color || CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} isAnimationActive={false} name={series[i].label}>
                {useBinColors && data.map((d, bi) => (
                  <Cell key={bi} fill={colorForValue(Number(d.x), histMin, histMax, colorStops!)} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
        </div>
      );
    }

    case 'scatter':
      return (
        <div style={wrapper}>
        <div style={titleStyle}>{title}</div>
        <ResponsiveContainer width="100%" height={200}>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" dataKey="x" name="x" label={{ value: axisLabel(vizType), position: 'bottom', offset: -2, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis type="number" dataKey="y" name="y" label={<AxisYLabel>{yLabel}</AxisYLabel>} tick={{ ...tickProps }} tickFormatter={fmtTick} />
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
        <div style={titleStyle}>{title}</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" label={{ value: axisLabel('bar'), position: 'bottom', offset: -2, ...labelStyle }} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <YAxis label={<AxisYLabel>{yLabel}</AxisYLabel>} tick={{ ...tickProps }} tickFormatter={fmtTick} />
            <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} />
            <Bar dataKey="y" fill={series[0].color || baseColor} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        </div>
      );
    }
  }
}
