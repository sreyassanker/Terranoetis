import React from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// ═══════════════════════════════════════════════════════════════════════
// TYPES (mirrors server/digitalTwin analysis PanelData)
// ═══════════════════════════════════════════════════════════════════════

interface StatCard {
  label: string;
  value: string;
  unit: string;
  icon: string;
}

interface ChartConfig {
  type: 'bar' | 'pie' | 'area' | 'line' | 'radar';
  title: string;
  data: Record<string, unknown>[];
  keys: { dataKey: string; color: string; name: string }[];
}

interface TableConfig {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface PanelData {
  stats: StatCard[];
  charts: ChartConfig[];
  table: TableConfig;
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════════════════
// STAT CARD
// ═══════════════════════════════════════════════════════════════════════

function StatCardComponent({ stat }: { stat: StatCard }) {
  const isCritical = stat.label === 'Risk Level' && (stat.value === 'CRITICAL' || stat.value === 'HIGH');
  return (
    <div className={`p-3 rounded-lg border ${isCritical ? 'bg-red-950/30 border-red-800/50' : 'bg-slate-800/50 border-slate-700/50'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{stat.icon}</span>
        <span className="text-xs text-slate-400 uppercase tracking-wide">{stat.label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-bold ${isCritical ? 'text-red-400' : 'text-white'}`}>{stat.value}</span>
        {stat.unit && <span className="text-xs text-slate-500">{stat.unit}</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CHART RENDERER
// ═══════════════════════════════════════════════════════════════════════

function ChartRenderer({ config }: { config: ChartConfig }) {
  const { type, title, data, keys } = config;

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
      <h4 className="text-sm font-medium text-slate-300 mb-3">{title}</h4>
      <ResponsiveContainer width="100%" height={200}>
        {type === 'area' ? (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey={Object.keys(data[0] || {})[0]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: 12 }} />
            {keys.map((k) => (
              <Area key={k.dataKey} type="monotone" dataKey={k.dataKey} stroke={k.color} fill={k.color} fillOpacity={0.3} name={k.name} />
            ))}
          </AreaChart>
        ) : type === 'line' ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey={Object.keys(data[0] || {})[0]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: 12 }} />
            {keys.map((k) => (
              <Line key={k.dataKey} type="monotone" dataKey={k.dataKey} stroke={k.color} strokeWidth={2} dot={false} name={k.name} />
            ))}
          </LineChart>
        ) : type === 'bar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey={Object.keys(data[0] || {})[0]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: 12 }} />
            {keys.map((k) => (
              <Bar key={k.dataKey} dataKey={k.dataKey} fill={k.color} name={k.name} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        ) : type === 'pie' ? (
          <PieChart>
            <Pie data={data} dataKey={keys[0]?.dataKey || 'value'} nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
              {data.map((_, idx) => (
                <Cell key={idx} fill={['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6'][idx % 5]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: 12 }} />
          </PieChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey={Object.keys(data[0] || {})[0]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: 12 }} />
            {keys.map((k) => (
              <Bar key={k.dataKey} dataKey={k.dataKey} fill={k.color} name={k.name} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TABLE RENDERER
// ═══════════════════════════════════════════════════════════════════════

function TableRenderer({ config }: { config: TableConfig }) {
  if (!config.rows.length) return null;
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
      <h4 className="text-sm font-medium text-slate-300 mb-3">{config.title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700">
              {config.columns.map((col) => (
                <th key={col} className="text-left py-2 px-2 text-slate-400 font-medium">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                {row.map((cell, j) => (
                  <td key={j} className={`py-2 px-2 ${cell === 'CRITICAL' ? 'text-red-400 font-bold' : cell === 'HIGH' ? 'text-amber-400' : 'text-slate-300'}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════

interface DigitalTwinPanelProps {
  panel: PanelData;
  onClose: () => void;
}

export function DigitalTwinPanel({ panel, onClose }: DigitalTwinPanelProps) {
  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-slate-900/95 border-l border-slate-700/50 shadow-2xl z-50 overflow-y-auto backdrop-blur-sm">
      {/* Header */}
      <div className="sticky top-0 bg-slate-900/95 border-b border-slate-700/50 p-4 flex items-center justify-between z-10 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <h3 className="text-sm font-semibold text-white">Digital Twin Analysis</h3>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700/50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2">
          {panel.stats.map((stat, i) => (
            <StatCardComponent key={i} stat={stat} />
          ))}
        </div>

        {/* Charts */}
        {panel.charts.map((chart, i) => (
          <ChartRenderer key={i} config={chart} />
        ))}

        {/* Table */}
        {panel.table && <TableRenderer config={panel.table} />}

        {/* Recommendations */}
        {panel.recommendations.length > 0 && (
          <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-amber-300 mb-2">Recommended Actions</h4>
            <ul className="space-y-1.5">
              {panel.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                  <span className="text-amber-500 mt-0.5">&#9679;</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
