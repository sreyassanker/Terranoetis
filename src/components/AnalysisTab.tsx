import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BarChart3, TrendingUp, RefreshCw, ChevronDown, ChevronRight, Activity, Globe, Info
} from 'lucide-react';
import { DetailLineChart, CorrelationHeatmap } from './intelligence/ChartComponents';

/* ═════════════════════════════════════════════════════════════════
   TYPES
   ═════════════════════════════════════════════════════════════════ */

interface TrendSeries {
  id: string;
  label: string;
  values: number[];
  color: string;
  unit: string;
  source?: string;
}

interface CorrelationCell {
  x: string;
  y: string;
  value: number;
}

/* ═════════════════════════════════════════════════════════════════
   DETAIL LINE CHART (Canvas)
   ═════════════════════════════════════════════════════════════════ */


/* ═════════════════════════════════════════════════════════════════
   CORRELATION HEATMAP (Canvas)
   ═════════════════════════════════════════════════════════════════ */


/* ═════════════════════════════════════════════════════════════════
   TREND BAR
   ═════════════════════════════════════════════════════════════════ */

const TrendBar: React.FC<{
  label: string; current: number; previous: number; max: number; unit: string; color: string;
}> = ({ label, current, previous, max, unit, color }) => {
  const change = current - previous;
  const changePct = previous !== 0 ? ((change / Math.abs(previous)) * 100) : 0;
  const isPositive = change >= 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: '#e2e8f0' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#e2e8f0' }}>
            {current.toLocaleString()}{unit}
          </span>
          <span style={{
            fontSize: 9, fontFamily: 'monospace', color: isPositive ? '#22c55e' : '#ef4444',
            background: isPositive ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            padding: '1px 4px', borderRadius: 3,
          }}>
            {isPositive ? '+' : ''}{changePct.toFixed(1)}%
          </span>
        </div>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${Math.min(100, (current / max) * 100)}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════
   ANALYSIS TAB — Real data from FRED, USGS, Open-Meteo
   ═════════════════════════════════════════════════════════════════ */

export const AnalysisTab: React.FC = () => {
  const [trendData, setTrendData] = useState<TrendSeries[]>([]);
  const [correlations, setCorrelations] = useState<CorrelationCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTrend, setExpandedTrend] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const cancelledRef = useRef(false);

  // Real data fetching
  const fetchData = useCallback(async (silent = false) => {
    cancelledRef.current = false;
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);

      const [eqRes, weatherRes, kpRes, eonetRes] = await Promise.allSettled([
        fetch('/api/earthquakes'),
        fetch('/api/weather/open-meteo?lat=40.7&lon=-74&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto'),
        fetch('/api/space-weather/kp'),
        fetch('/api/eonet?limit=50'),
      ]);

      const series: TrendSeries[] = [];

      if (eqRes.status === 'fulfilled' && eqRes.value.ok) {
        const eqData = await eqRes.value.json() as { features?: Array<{ properties?: { mag?: number } }> };
        const mags = (eqData.features ?? []).map(f => f.properties?.mag ?? 0).filter(m => m > 0);
        if (mags.length > 0) {
          series.push({ id: 'seismic', label: 'Seismic Activity', values: mags.slice(0, 20), color: '#ef4444', unit: ' M', source: 'USGS Earthquake Hazards' });
        }
      }

      if (weatherRes.status === 'fulfilled' && weatherRes.value.ok) {
        const wd = await weatherRes.value.json() as { daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] } };
        const maxT = wd.daily?.temperature_2m_max ?? [];
        const minT = wd.daily?.temperature_2m_min ?? [];
        if (maxT.length > 0) series.push({ id: 'temp_max', label: 'Daily High Temp', values: maxT, color: '#ef4444', unit: ' C', source: 'Open-Meteo Weather' });
        if (minT.length > 0) series.push({ id: 'temp_min', label: 'Daily Low Temp', values: minT, color: '#60a5fa', unit: ' C', source: 'Open-Meteo Weather' });
      }

      if (kpRes.status === 'fulfilled' && kpRes.value.ok) {
        const kpData = await kpRes.value.json() as Array<{ kp_index?: string }>;
        const kpVals = kpData.slice(-20).map(d => parseFloat(d.kp_index ?? '0')).filter(v => !isNaN(v) && v > 0);
        if (kpVals.length > 2) series.push({ id: 'kp', label: 'Kp Index', values: kpVals, color: '#a78bfa', unit: '', source: 'NOAA Space Weather' });
      }

      if (eonetRes.status === 'fulfilled' && eonetRes.value.ok) {
        const ed = await eonetRes.value.json() as { events?: Array<{ geometry?: Array<{ date?: string }> }> };
        const events = ed.events ?? [];
        if (events.length > 0) {
          const now = Date.now();
          const dayMs = 86400000;
          const dailyCounts = Array.from({ length: 14 }, (_, i) => {
            const dStart = now - (13 - i) * dayMs;
            const dEnd = dStart + dayMs;
            return events.filter((e: { geometry?: Array<{ date?: string }> }) => {
              const date = new Date(e.geometry?.[0]?.date ?? 0).getTime();
              return date >= dStart && date < dEnd;
            }).length;
          });
          series.push({ id: 'eonet', label: 'Natural Events', values: dailyCounts, color: '#f59e0b', unit: '/day', source: 'NASA EONET' });
        }
      }

      if (!cancelledRef.current) {
        setTrendData(series);
        const validSeries = series.filter(s => s.values.length >= 2);
        const labels = validSeries.map(s => s.label.slice(0, 8));
        const cells: CorrelationCell[] = [];
        for (let i = 0; i < labels.length; i++) {
          for (let j = 0; j < labels.length; j++) {
            if (i === j) { cells.push({ x: labels[i]!, y: labels[j]!, value: 1.0 }); }
            else if (j > i) {
              const a = validSeries[i]!.values.slice(0, Math.min(validSeries[i]!.values.length, validSeries[j]!.values.length));
              const b = validSeries[j]!.values.slice(0, a.length);
              const mA = a.reduce((s, v) => s + v, 0) / a.length;
              const mB = b.reduce((s, v) => s + v, 0) / b.length;
              let num = 0, dA = 0, dB = 0;
              for (let k = 0; k < a.length; k++) {
                const da = a[k]! - mA; const db = b[k]! - mB;
                num += da * db; dA += da * da; dB += db * db;
              }
              const corr = (dA > 0 && dB > 0) ? Math.round((num / Math.sqrt(dA * dB)) * 10) / 10 : 0;
              cells.push({ x: labels[i]!, y: labels[j]!, value: corr });
              cells.push({ x: labels[j]!, y: labels[i]!, value: corr });
            }
          }
        }
        setCorrelations(cells);
      }
    } catch { /* silent */ }
    finally { if (!cancelledRef.current) { setLoading(false); setRefreshing(false); } }
  }, []);

  useEffect(() => {
    fetchData();
    return () => { cancelledRef.current = true; };
  }, [fetchData]);

  const activeSeries = trendData.filter(s => s.values.length >= 2);
  const correlationLabels = activeSeries.length >= 2
    ? activeSeries.map(s => s.label.slice(0, 8))
    : [];

  const placeholderSeries = trendData;

  // Correlation cells - real data only
  const correlationCells: CorrelationCell[] = correlations;

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <BarChart3 size={12} /> Cross-Domain Analysis
        </div>
        <RefreshCw
          size={12}
          style={{ color: '#64748b', cursor: 'pointer', opacity: refreshing ? 0.5 : 1, transition: 'transform 0.3s', transform: refreshing ? 'rotate(180deg)' : 'none' }}
          onClick={() => fetchData(true)}
        />
      </div>
      {loading && <div style={{ color: '#64748b', fontSize: 12, padding: 12 }}>Loading analysis data...</div>}
      {!loading && placeholderSeries.length === 0 && (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>
          <Info size={20} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>No analysis data available</div>
          <div style={{ marginTop: 4, fontSize: 10 }}>Data: USGS Earthquakes, Open-Meteo Weather, NOAA Space Weather, NASA EONET.</div>
        </div>
      )}

      {/* Trend Sparklines — each expandable */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <TrendingUp size={12} /> Trend Analysis
        </div>
        {placeholderSeries.map((series) => {
          const isExpanded = expandedTrend === series.id;
          return (
            <div key={series.id} style={{ marginBottom: 4 }}>
              <div
                onClick={() => setExpandedTrend(prev => prev === series.id ? null : series.id)}
                style={{
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  background: isExpanded ? 'rgba(129,140,248,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isExpanded ? 'rgba(129,140,248,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isExpanded ? <ChevronDown size={10} color="#818cf8" /> : <ChevronRight size={10} color="#64748b" />}
                    <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 500 }}>{series.label}</span>
                  </div>
                  <span style={{ fontSize: 10, color: series.color, fontFamily: 'monospace' }}>
                    {series.values[series.values.length - 1]?.toFixed(series.unit === ' %' ? 2 : 1)}{series.unit}
                  </span>
                </div>
                {!isExpanded && series.values.length > 1 && (
                  <div style={{ marginTop: 6 }}>
                    <DetailLineChart data={series.values} color={series.color} width={340} height={24} showArea showGrid={false} />
                  </div>
                )}
              </div>
              {/* Expanded Detail View */}
              {isExpanded && (
                <div style={{
                  padding: '10px 12px', margin: '0 0 4px', borderRadius: '0 0 6px 6px',
                  background: 'rgba(129,140,248,0.04)', border: '1px solid rgba(129,140,248,0.15)', borderTop: 'none',
                  animation: 'fadeIn 0.2s ease',
                }}>
                  <div style={{ marginBottom: 10 }}>
                    <DetailLineChart data={series.values} color={series.color} width={340} height={100} showArea showGrid />
                  </div>
                  <div style={{ padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ fontSize: 9, color: '#64748b' }}>Latest</span>
                      <span style={{ fontSize: 9, color: series.color, fontFamily: 'monospace' }}>
                        {series.values[series.values.length - 1]?.toFixed(series.unit === ' %' ? 3 : 2)}{series.unit}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ fontSize: 9, color: '#64748b' }}>Min</span>
                      <span style={{ fontSize: 9, color: '#e2e8f0', fontFamily: 'monospace' }}>
                        {Math.min(...series.values).toFixed(series.unit === ' %' ? 3 : 2)}{series.unit}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ fontSize: 9, color: '#64748b' }}>Max</span>
                      <span style={{ fontSize: 9, color: '#e2e8f0', fontFamily: 'monospace' }}>
                        {Math.max(...series.values).toFixed(series.unit === ' %' ? 3 : 2)}{series.unit}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ fontSize: 9, color: '#64748b' }}>Data Points</span>
                      <span style={{ fontSize: 9, color: '#e2e8f0' }}>{series.values.length}</span>
                    </div>
                    {series.source && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span style={{ fontSize: 9, color: '#64748b' }}>Source</span>
                        <span style={{ fontSize: 9, color: '#818cf8' }}>{series.source}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Correlation Heatmap */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={12} /> Correlation Matrix
        </div>
        <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'center', flexDirection: 'column', alignItems: 'center' }}>
          {correlationLabels.length >= 2 ? (
            <CorrelationHeatmap data={correlationCells} labels={correlationLabels} size={280} />
          ) : (
            <div style={{ color: '#64748b', fontSize: 11, textAlign: 'center', padding: 20 }}>
              <div>Insufficient data for correlation analysis</div>
              <div style={{ fontSize: 9, marginTop: 4 }}>Need at least 2 data series with 2+ points each</div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: '#ef4444' }} />
            <span style={{ fontSize: 9, color: '#64748b' }}>Negative</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: '#1e293b' }} />
            <span style={{ fontSize: 9, color: '#64748b' }}>Neutral</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: '#22c55e' }} />
            <span style={{ fontSize: 9, color: '#64748b' }}>Positive</span>
          </div>
        </div>
      </div>

      {/* Signal Strength Bars */}
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Activity size={12} /> Signal Strength
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          {placeholderSeries.slice(0, 5).map(s => {
            const latest = s.values[s.values.length - 1] ?? 0;
            const prev = s.values[s.values.length - 2] ?? latest;
            return (
              <TrendBar
                key={s.id}
                label={s.label}
                current={latest}
                previous={prev}
                max={Math.max(...s.values) * 1.2 || 100}
                unit={s.unit}
                color={s.color}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
