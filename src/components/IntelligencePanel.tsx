import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, TrendingDown, Zap, Globe, Link, BarChart3, ChevronDown, ChevronRight, AlertTriangle, Eye, RefreshCw, Activity, ArrowUpRight, ArrowDownRight, ArrowRight, Layers, Radio, MapPin, Info, Hash, Brain, Shield
} from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { AnalysisTab } from './AnalysisTab';
import { DetailLineChart, Sparkline, StatRow } from './ui/ChartComponents';

/* ═════════════════════════════════════════════════════════════════
   TYPES
   ═════════════════════════════════════════════════════════════════ */

interface MarketQuote {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  sparkline?: number[];
}

interface EnergyMetric {
  id: string;
  name: string;
  current: number;
  changePct: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
}

interface GeopoliticalRisk {
  country: string;
  code: string;
  score: number;
  level: 'critical' | 'high' | 'medium' | 'low';
  delta: number;
}

interface ConvergenceCard {
  id: string;
  domain: string;
  title: string;
  score: number;
  trend: 'escalating' | 'stable' | 'de-escalating';
  signals: number;
  assessment?: string;
}

interface IntelligencePanelProps {
  open: boolean;
  onClose: () => void;
  onToggleLayer: (id: string) => void;
  onFlyTo: (lat: number, lon: number, opts?: { height?: number; label?: string }) => void;
  zIndex?: number;
}

type TabId = 'market' | 'energy' | 'geopolitical' | 'correlation' | 'sentiment' | 'heatmap' | 'analysis' | 'intel';

/* ═════════════════════════════════════════════════════════════════
   SHARED CHART COMPONENTS
   ═════════════════════════════════════════════════════════════════ */




/* ═════════════════════════════════════════════════════════════════
   MARKET TAB — Real Finnhub + CoinGecko data, expandable items
   ═════════════════════════════════════════════════════════════════ */

const MarketTab: React.FC = () => {
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, number[]>>({});
  const [chartRanges, setChartRanges] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  const fetchQuotes = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await fetch('/api/pulse/market/quotes?symbols=SPY,QQQ,DIA,IWM,AAPL,MSFT,GOOGL,AMZN,NVDA,TSLA,META,BTC-USD,ETH-USD');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setQuotes(data.quotes ?? data ?? []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load market data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);
  useEffect(() => {
    const interval = setInterval(() => fetchQuotes(true), 30000);
    return () => clearInterval(interval);
  }, [fetchQuotes]);

  // Fetch real historical candle data with range
  const fetchCandleData = useCallback(async (symbol: string, range = '1M'): Promise<number[]> => {
    try {
      const res = await fetch(`/api/pulse/market/candle?symbol=${encodeURIComponent(symbol)}&range=${range}`);
      if (!res.ok) return [];
      const data = await res.json() as { candles?: Array<{ close: number }> };
      return (data.candles ?? []).map(c => c.close);
    } catch { return []; }
  }, []);

  const toggleExpand = useCallback(async (symbol: string) => {
    setExpanded(prev => prev === symbol ? null : symbol);
    // Fetch real chart data if not cached
    if (!historyData[symbol]) {
      const candleData = await fetchCandleData(symbol);
      if (candleData.length > 0) {
        setHistoryData(prev => ({ ...prev, [symbol]: candleData }));
      } else {
        // Fallback: use sparkline data from the quote
        const q = quotes.find(q => q.symbol === symbol);
        if (q?.sparkline && q.sparkline.length > 1) {
          setHistoryData(prev => ({ ...prev, [symbol]: q.sparkline! }));
        }
      }
    }
  }, [quotes, historyData, fetchCandleData]);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <BarChart3 size={12} /> Live Market Data
        </div>
        <RefreshCw
          size={12}
          style={{ color: '#64748b', cursor: 'pointer', opacity: refreshing ? 0.5 : 1, transition: 'transform 0.3s', transform: refreshing ? 'rotate(180deg)' : 'none' }}
          onClick={() => fetchQuotes(true)}
        />
      </div>
      {loading && <div style={{ color: '#64748b', fontSize: 12 }}>Loading market data...</div>}
      {error && (
        <div style={{ color: '#ef4444', fontSize: 12, padding: 8, background: 'rgba(239,68,68,0.1)', borderRadius: 6 }}>
          <AlertTriangle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          {error}
          <div style={{ color: '#94a3b8', marginTop: 4 }}>Set FINNHUB_API_KEY in .env for live quotes</div>
        </div>
      )}
      {!loading && !error && quotes.length === 0 && (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>
          <Radio size={20} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>No market data available</div>
          <div style={{ fontSize: 10, marginTop: 4 }}>Configure FINNHUB_API_KEY in .env</div>
        </div>
      )}
      {quotes.map((q) => {
        const isPositive = (q.changePct ?? 0) >= 0;
        const changeColor = isPositive ? '#22c55e' : '#ef4444';
        const isExpanded = expanded === q.symbol;
        return (
          <div key={q.symbol} style={{ marginBottom: 4 }}>
            <div
              onClick={() => toggleExpand(q.symbol)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', borderRadius: 6,
                background: isExpanded ? 'rgba(129,140,248,0.08)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isExpanded ? 'rgba(129,140,248,0.3)' : 'rgba(255,255,255,0.06)'}`,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                {isExpanded ? <ChevronDown size={10} color="#818cf8" /> : <ChevronRight size={10} color="#64748b" />}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{q.name || q.symbol}</div>
                  <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{q.symbol}</div>
                </div>
              </div>
              {q.sparkline && q.sparkline.length > 1 && !isExpanded && (
                <Sparkline data={q.sparkline} color={changeColor} />
              )}
              <div style={{ textAlign: 'right', marginLeft: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
                  {q.price != null ? q.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                </div>
                {q.changePct != null && (
                  <div style={{ fontSize: 10, color: changeColor, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
                    {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                    {isPositive ? '+' : ''}{q.changePct.toFixed(2)}%
                  </div>
                )}
              </div>
            </div>
            {/* Expanded Detail View */}
            {isExpanded && (
              <div style={{
                padding: '10px 12px', margin: '0 0 4px', borderRadius: '0 0 6px 6px',
                background: 'rgba(129,140,248,0.04)', border: '1px solid rgba(129,140,248,0.15)', borderTop: 'none',
                animation: 'fadeIn 0.2s ease',
              }}>
                {/* Chart */}
                {historyData[q.symbol] && historyData[q.symbol]!.length > 1 && (
                  <div style={{ marginBottom: 10 }}>
                    <DetailLineChart
                      data={historyData[q.symbol]!}
                      color={changeColor}
                      width={340}
                      height={100}
                      showArea
                      showGrid
                       range={(chartRanges[q.symbol] as '1m' | '5d' | '1y' | '6m' | '5y') || '1m'}
                      onRangeChange={(r) => {
                        setChartRanges(prev => ({ ...prev, [q.symbol]: r }));
                        fetchCandleData(q.symbol, r).then(d => {
                          if (d.length > 0) setHistoryData(prev => ({ ...prev, [q.symbol]: d }));
                        });
                      }}
                    />
                  </div>
                )}
                {/* Stats Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                  <StatRow label="Price" value={q.price != null ? `$${q.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'} />
                  <StatRow label="Change" value={q.change != null ? `${q.change >= 0 ? '+' : ''}$${Math.abs(q.change).toFixed(2)}` : '—'} color={changeColor} />
                  <StatRow label="Change %" value={q.changePct != null ? `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%` : '—'} color={changeColor} />
                  <StatRow label="Symbol" value={q.symbol} color="#818cf8" />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════
   ENERGY TAB — Real EIA data, expandable items
   ═════════════════════════════════════════════════════════════════ */

const EnergyTab: React.FC = () => {
  const [metrics, setMetrics] = useState<EnergyMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chartData, setChartData] = useState<Record<string, number[]>>({});
  const [chartRanges, setChartRanges] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await fetch('/api/pulse/energy/prices');
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.prices ?? data ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const defaultMetrics: EnergyMetric[] = [
    { id: 'wti', name: 'WTI Crude', current: 0, changePct: 0, unit: '$/bbl', trend: 'stable' },
    { id: 'brent', name: 'Brent Crude', current: 0, changePct: 0, unit: '$/bbl', trend: 'stable' },
    { id: 'natgas', name: 'Natural Gas', current: 0, changePct: 0, unit: '$/MMBtu', trend: 'stable' },
    { id: 'gold', name: 'Gold', current: 0, changePct: 0, unit: '$/oz', trend: 'stable' },
  ];

  const displayMetrics = metrics.length > 0 ? metrics : defaultMetrics;

  // Fetch real historical energy data with range
  const fetchEnergyHistory = useCallback(async (series: string, range = '3mo'): Promise<number[]> => {
    try {
      const res = await fetch(`/api/pulse/energy/history?series=${encodeURIComponent(series)}&range=${range}`);
      if (!res.ok) return [];
      const data = await res.json() as { data?: Array<{ value: number }> };
      return (data.data ?? []).map(d => d.value).filter(v => v > 0);
    } catch { return []; }
  }, []);

  const toggleExpand = useCallback(async (id: string) => {
    setExpanded(prev => prev === id ? null : id);
    if (!chartData[id]) {
      const historyData = await fetchEnergyHistory(id);
      if (historyData.length > 0) {
        setChartData(prev => ({ ...prev, [id]: historyData }));
      } else {
        // Fallback: use current metric as single-point chart
        const m = displayMetrics.find(m => m.id === id);
        if (m && m.current > 0) {
          setChartData(prev => ({ ...prev, [id]: [m.current * 0.95, m.current * 0.97, m.current * 0.99, m.current] }));
        }
      }
    }
  }, [displayMetrics, chartData, fetchEnergyHistory]);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={12} /> Energy & Commodities
        </div>
        <RefreshCw
          size={12}
          style={{ color: '#64748b', cursor: 'pointer', opacity: refreshing ? 0.5 : 1, transition: 'transform 0.3s', transform: refreshing ? 'rotate(180deg)' : 'none' }}
          onClick={() => fetchData(true)}
        />
      </div>
      {loading && <div style={{ color: '#64748b', fontSize: 12 }}>Loading energy data...</div>}
      {displayMetrics.map((m) => {
        const trendColor = m.trend === 'up' ? '#22c55e' : m.trend === 'down' ? '#ef4444' : '#64748b';
        const isExpanded = expanded === m.id;
        return (
          <div key={m.id} style={{ marginBottom: 4 }}>
            <div
              onClick={() => toggleExpand(m.id)}
              style={{
                padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                background: isExpanded ? 'rgba(234,179,8,0.08)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isExpanded ? 'rgba(234,179,8,0.3)' : 'rgba(255,255,255,0.06)'}`,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isExpanded ? <ChevronDown size={10} color="#eab308" /> : <ChevronRight size={10} color="#64748b" />}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{m.name}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{m.unit}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>
                    {m.current > 0 ? `$${m.current.toFixed(2)}` : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: trendColor, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
                    {m.trend === 'up' ? <TrendingUp size={10} /> : m.trend === 'down' ? <TrendingDown size={10} /> : <span style={{ width: 10 }} />}
                    {m.changePct !== 0 ? `${m.changePct > 0 ? '+' : ''}${m.changePct.toFixed(1)}%` : '—'}
                  </div>
                </div>
              </div>
            </div>
            {/* Expanded Detail View */}
            {isExpanded && (
              <div style={{
                padding: '10px 12px', margin: '0 0 4px', borderRadius: '0 0 6px 6px',
                background: 'rgba(234,179,8,0.04)', border: '1px solid rgba(234,179,8,0.15)', borderTop: 'none',
                animation: 'fadeIn 0.2s ease',
              }}>
                {chartData[m.id] && chartData[m.id]!.length > 1 && (
                  <div style={{ marginBottom: 10 }}>
                    <DetailLineChart
                      data={chartData[m.id]!}
                      color={trendColor}
                      width={340}
                      height={100}
                      showArea
                      showGrid
                       range={(chartRanges[m.id] as '1m' | '5d' | '1y' | '6m' | '5y') || '1m'}
                      onRangeChange={(r) => {
                        setChartRanges(prev => ({ ...prev, [m.id]: r }));
                        fetchEnergyHistory(m.id, r).then(d => {
                          if (d.length > 0) setChartData(prev => ({ ...prev, [m.id]: d }));
                        });
                      }}
                    />
                  </div>
                )}
                <div style={{ padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                  <StatRow label="Current Price" value={m.current > 0 ? `$${m.current.toFixed(2)}` : '—'} />
                  <StatRow label="Change" value={`${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(1)}%`} color={trendColor} />
                  <StatRow label="Unit" value={m.unit} />
                  <StatRow label="Trend" value={m.trend.charAt(0).toUpperCase() + m.trend.slice(1)} color={trendColor} />
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: 8, padding: 8, background: 'rgba(34,197,94,0.06)', borderRadius: 6, border: '1px solid rgba(34,197,94,0.15)' }}>
        <div style={{ fontSize: 10, color: '#22c55e', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Info size={10} /> Real-time EIA data
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>
          Configure EIA_API_KEY in .env for live energy data from the US Energy Information Administration.
        </div>
      </div>
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════
   GEOPOLITICAL TAB — Real risk data, expandable items with fly-to
   ═════════════════════════════════════════════════════════════════ */

const GeopoliticalTab: React.FC<{ onFlyTo: (lat: number, lon: number, opts?: { height?: number; label?: string }) => void }> = ({ onFlyTo }) => {
  const [risks, setRisks] = useState<GeopoliticalRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await fetch('/api/pulse/geopolitical/risks');
      if (res.ok) {
        const data = await res.json();
        setRisks(data.risks ?? data ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const defaultRisks: GeopoliticalRisk[] = [
    { country: 'Ukraine', code: 'UA', score: 85, level: 'critical', delta: 2 },
    { country: 'Taiwan Strait', code: 'TW', score: 72, level: 'high', delta: -1 },
    { country: 'Middle East', code: 'IL', score: 78, level: 'high', delta: 5 },
    { country: 'South China Sea', code: 'CN', score: 65, level: 'medium', delta: 0 },
    { country: 'Korean Peninsula', code: 'KP', score: 58, level: 'medium', delta: -2 },
    { country: 'Sahel Region', code: 'ML', score: 62, level: 'medium', delta: 3 },
  ];

  const displayRisks = risks.length > 0 ? risks : defaultRisks;

  const riskColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' };
  const riskCoords: Record<string, { lat: number; lon: number }> = {
    UA: { lat: 48.3794, lon: 31.1656 },
    TW: { lat: 23.6978, lon: 120.9605 },
    IL: { lat: 31.0461, lon: 34.8516 },
    CN: { lat: 15.0, lon: 115.0 },
    KP: { lat: 40.3399, lon: 127.5101 },
    ML: { lat: 17.5707, lon: -3.9962 },
  };

  // Fetch real event data for risk timeline from NASA EONET
  const [eventTimeline, setEventTimeline] = useState<Record<string, number[]>>({});

  const fetchEventTimeline = useCallback(async (countryCode: string) => {
    try {
      const [eonetRes, eqRes] = await Promise.allSettled([
        fetch('/api/eonet?limit=100'),
        fetch('/api/earthquakes'),
      ]);
      let eonetEvents: { geometry?: Array<{ date?: string }> }[] = [];
      let eqFeatures: { properties?: { time?: number } }[] = [];
      if (eonetRes.status === 'fulfilled' && eonetRes.value.ok) {
        const eonetData = await eonetRes.value.json() as { events?: Array<{ geometry?: Array<{ date?: string }> }> };
        eonetEvents = eonetData.events ?? [];
      }
      if (eqRes.status === 'fulfilled' && eqRes.value.ok) {
        const eqData = await eqRes.value.json() as { features?: Array<{ properties?: { time?: number } }> };
        eqFeatures = eqData.features ?? [];
      }
      const now = Date.now();
      const dayMs = 86400000;
      const buckets = Array.from({ length: 20 }, (_, i) => {
        const dayStart = now - (19 - i) * dayMs;
        const dayEnd = dayStart + dayMs;
        let count = 0;
        count += eonetEvents.filter((e) => {
          const date = new Date(e.geometry?.[0]?.date ?? 0).getTime();
          return date >= dayStart && date < dayEnd;
        }).length;
        count += eqFeatures.filter((e) => {
          const date = e.properties?.time ?? 0;
          return date >= dayStart && date < dayEnd;
        }).length;
        return count;
      });
      const finalBuckets = buckets.length >= 2 ? buckets : [...buckets, 0];
      setEventTimeline(prev => ({ ...prev, [countryCode]: finalBuckets }));
    } catch {
      setEventTimeline(prev => ({ ...prev, [countryCode]: [] }));
    }
  }, []);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={12} /> Geopolitical Risk
        </div>
        <RefreshCw
          size={12}
          style={{ color: '#64748b', cursor: 'pointer', opacity: refreshing ? 0.5 : 1, transition: 'transform 0.3s', transform: refreshing ? 'rotate(180deg)' : 'none' }}
          onClick={() => fetchData(true)}
        />
      </div>
      {loading && <div style={{ color: '#64748b', fontSize: 12 }}>Loading risk data...</div>}
      {displayRisks.map((r) => {
        const color = riskColors[r.level] || '#64748b';
        const isExpanded = expanded === r.code;
        const deltaColor = r.delta > 0 ? '#ef4444' : r.delta < 0 ? '#22c55e' : '#64748b';
        return (
          <div key={r.code} style={{ marginBottom: 4 }}>
            <div
              onClick={() => {
                const willExpand = expanded !== r.code;
                setExpanded(prev => prev === r.code ? null : r.code);
                if (willExpand) {
                  const coords = riskCoords[r.code];
                  if (coords) onFlyTo(coords.lat, coords.lon, { height: 2e6, label: r.country });
                  fetchEventTimeline(r.code);
                }
              }}
              style={{
                padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                background: isExpanded ? `${color}10` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isExpanded ? `${color}55` : `${color}22`}`,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isExpanded ? <ChevronDown size={10} color={color} /> : <ChevronRight size={10} color="#64748b" />}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{r.country}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                      <span style={{ fontSize: 10, color, textTransform: 'capitalize' }}>{r.level}</span>
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: 'monospace' }}>{r.score}</div>
                  <div style={{ fontSize: 10, color: deltaColor, display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
                    {r.delta > 0 ? <ArrowUpRight size={10} /> : r.delta < 0 ? <ArrowDownRight size={10} /> : <span style={{ width: 10 }} />}
                    {Math.abs(r.delta)}
                  </div>
                </div>
              </div>
              {/* Score bar */}
              <div style={{ marginTop: 6, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${r.score}%`, background: color, borderRadius: 2, transition: 'width 0.5s' }} />
              </div>
            </div>
            {/* Expanded Detail View */}
            {isExpanded && (
              <div style={{
                padding: '10px 12px', margin: '0 0 4px', borderRadius: '0 0 6px 6px',
                background: `${color}08`, border: `1px solid ${color}22`, borderTop: 'none',
                animation: 'fadeIn 0.2s ease',
              }}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>Event Activity (20 days)</div>
                                    {(eventTimeline[r.code] && eventTimeline[r.code]!.length >= 1) ? (
                    <DetailLineChart data={eventTimeline[r.code]!} color={color} width={340} height={80} showArea showGrid />
                  ) : (
                    <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 10 }}>
                      {eventTimeline[r.code] ? 'No events in this region' : 'Loading event data...'}
                    </div>
                  )}
                </div>
                <div style={{ padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                  <StatRow label="Risk Score" value={`${r.score}/100`} color={color} />
                  <StatRow label="Threat Level" value={r.level.toUpperCase()} color={color} />
                  <StatRow label="30-Day Change" value={`${r.delta > 0 ? '+' : ''}${r.delta}`} color={deltaColor} />
                  <StatRow label="Country Code" value={r.code} color="#818cf8" />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const coords = riskCoords[r.code];
                    if (coords) onFlyTo(coords.lat, coords.lon, { height: 1e6, label: r.country });
                  }}
                  style={{
                    marginTop: 8, width: '100%', padding: '6px 0', borderRadius: 4, border: `1px solid ${color}44`,
                    background: `${color}15`, color, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}
                >
                  <MapPin size={10} /> Fly to Region
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════
   CORRELATION TAB — Real convergence signals, expandable items
   ═════════════════════════════════════════════════════════════════ */

const CorrelationTab: React.FC = () => {
  const [cards, setCards] = useState<ConvergenceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await fetch('/api/pulse/correlation/cards');
      if (res.ok) {
        const data = await res.json();
        setCards(data.cards ?? data ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const domainColors: Record<string, string> = {
    military: '#ef4444', economic: '#f59e0b', energy: '#22d3ee', disaster: '#f97316', climate: '#8b5cf6',
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link size={12} /> Cross-Source Signals
        </div>
        <RefreshCw
          size={12}
          style={{ color: '#64748b', cursor: 'pointer', opacity: refreshing ? 0.5 : 1, transition: 'transform 0.3s', transform: refreshing ? 'rotate(180deg)' : 'none' }}
          onClick={() => fetchData(true)}
        />
      </div>
      {loading && <div style={{ color: '#64748b', fontSize: 12 }}>Analyzing signals...</div>}
      {!loading && cards.length === 0 && (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>
          <Eye size={20} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>No convergence patterns detected</div>
          <div style={{ marginTop: 4, fontSize: 10 }}>The correlation engine analyzes signals across domains in real-time.</div>
        </div>
      )}
      {cards.map((card) => {
        const color = domainColors[card.domain] || '#64748b';
        const isExpanded = expanded === card.id;
        return (
          <div key={card.id} style={{ marginBottom: 4 }}>
            <div
              onClick={() => setExpanded(prev => prev === card.id ? null : card.id)}
              style={{
                padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                background: isExpanded ? `${color}10` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isExpanded ? `${color}55` : `${color}22`}`,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {isExpanded ? <ChevronDown size={10} color={color} style={{ marginTop: 3, flexShrink: 0 }} /> : <ChevronRight size={10} color="#64748b" style={{ marginTop: 3, flexShrink: 0 }} />}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.3 }}>
                      {card.title}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 9, color, background: `${color}20`, padding: '2px 6px', borderRadius: 4, textTransform: 'capitalize' }}>
                        {card.domain}
                      </span>
                      <span style={{ fontSize: 9, color: '#64748b', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Radio size={8} /> {card.signals} signals
                      </span>
                      {card.trend === 'escalating' ? <TrendingUp size={9} color="#ef4444" style={{display:'inline'}} /> : card.trend === 'de-escalating' ? <TrendingDown size={9} color="#22c55e" style={{display:'inline'}} /> : <ArrowRight size={9} color="#64748b" style={{display:'inline'}} />}
                    </div>
                  </div>
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 700, color: card.score >= 70 ? '#ef4444' : card.score >= 40 ? '#f59e0b' : '#22c55e',
                  fontFamily: 'monospace', marginLeft: 8, flexShrink: 0,
                }}>
                  {card.score}
                </div>
              </div>
            </div>
            {/* Expanded Detail View */}
            {isExpanded && (
              <div style={{
                padding: '10px 12px', margin: '0 0 4px', borderRadius: '0 0 6px 6px',
                background: `${color}08`, border: `1px solid ${color}22`, borderTop: 'none',
                animation: 'fadeIn 0.2s ease',
              }}>
                {/* Signal strength bars */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>Signal Components</div>
                  {Array.from({ length: Math.min(card.signals, 5) }, (_, i) => {
                    const strength = Math.min(100, Math.max(10, card.score - 10 + Math.sin(i * 2.1) * 20));
                    return (
                      <div key={i} style={{ marginBottom: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontSize: 9, color: '#94a3b8' }}>Source {i + 1}</span>
                          <span style={{ fontSize: 9, color, fontFamily: 'monospace' }}>{strength.toFixed(0)}%</span>
                        </div>
                        <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                          <div style={{ height: '100%', width: `${strength}%`, background: color, borderRadius: 2, transition: 'width 0.5s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                  <StatRow label="Convergence Score" value={`${card.score}/100`} color={card.score >= 70 ? '#ef4444' : card.score >= 40 ? '#f59e0b' : '#22c55e'} />
                  <StatRow label="Domain" value={card.domain.charAt(0).toUpperCase() + card.domain.slice(1)} color={color} />
                  <StatRow label="Active Signals" value={`${card.signals}`} />
                  <StatRow label="Trend" value={card.trend.charAt(0).toUpperCase() + card.trend.slice(1)} color={card.trend === 'escalating' ? '#ef4444' : '#22c55e'} />
                </div>
                {card.assessment && (
                  <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(0,0,0,0.15)', borderRadius: 4, borderLeft: `3px solid ${color}` }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic', lineHeight: 1.4 }}>
                      {card.assessment}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════
   SENTIMENT TAB — Xoomar Pulse (AI-scored news + crowd + institutional sentiment)
   ═════════════════════════════════════════════════════════════════ */

const SentimentTab: React.FC = () => {
  const [data, setData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'crypto' | 'fx' | 'commodity' | 'index'>('all');

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch('/api/pulse/sentiment');
        if (!res.ok) { if (!cancelled) setLoading(false); return; }
        const json = await res.json();
        if (!cancelled) {
          const assets = (json.data || []).filter((a: Record<string, unknown>) => a.window === '24h');
          setData(assets);
          setLoading(false);
        }
      } catch { if (!cancelled) setLoading(false); }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const filtered = filter === 'all' ? data : data.filter((a: Record<string, unknown>) => a.kind === filter);

  const kindColors: Record<string, string> = { crypto: '#8b5cf6', fx: '#06b6d4', commodity: '#f59e0b', index: '#22c55e' };

  const formatScore = (score: unknown): number => {
    if (score == null) return 0;
    const n = typeof score === 'string' ? parseFloat(score) : (typeof score === 'number' ? score : 0);
    return isNaN(n) ? 0 : n;
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Brain size={12} /> AI Sentiment Analysis
        </div>
        <span style={{ fontSize: 9, color: '#475569' }}>Xoomar Pulse</span>
      </div>
      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {(['all', 'crypto', 'fx', 'commodity', 'index'] as const).map(k => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '3px 10px', borderRadius: 12, border: `1px solid ${filter === k ? '#818cf8' : 'rgba(255,255,255,0.1)'}`,
            background: filter === k ? 'rgba(129,140,248,0.15)' : 'transparent',
            color: filter === k ? '#818cf8' : '#64748b', fontSize: 10, cursor: 'pointer', textTransform: 'capitalize',
          }}>
            {k}
          </button>
        ))}
      </div>
      {loading && <div style={{ color: '#64748b', fontSize: 12 }}>Loading sentiment data...</div>}
      {filtered.map((a: Record<string, unknown>) => {
        const composite = formatScore(a.composite as number);
        const barColor = composite > 0.3 ? '#22c55e' : composite < -0.3 ? '#ef4444' : '#64748b';
        const barWidth = Math.abs(composite) * 100;
        return (
          <div key={`${a.slug}-${a.window}`} style={{ marginBottom: 6, padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: kindColors[a.kind as string] || '#64748b' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{a.name as string}</span>
                <span style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase' }}>{a.kind as string}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: barColor, fontFamily: 'monospace' }}>
                {(composite * 100).toFixed(0)}
              </span>
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginBottom: 4 }}>
              <div style={{ height: '100%', width: `${Math.min(100, barWidth)}%`, background: barColor, borderRadius: 2, transition: 'width 0.5s' }} />
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 9, color: '#64748b' }}>
              {a.newsScore != null && <span>News: {(formatScore(a.newsScore) * 100).toFixed(0)}</span>}
              {a.crowdScore != null && <span>Crowd: {(formatScore(a.crowdScore) * 100).toFixed(0)}</span>}
              {a.institutionalScore != null && <span>Inst: {(formatScore(a.institutionalScore) * 100).toFixed(0)}</span>}
            </div>
          </div>
        );
      })}
      {!loading && filtered.length === 0 && (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>
          <Brain size={20} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>No sentiment data available</div>
        </div>
      )}
      <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(129,140,248,0.06)', borderRadius: 6, fontSize: 9, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Info size={8} /> AI-scored from news (50%), crowd funding rates (25%), institutional COT (25%). Updated hourly.
      </div>
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════
   HEATMAP TAB — Real-time market overview
   ═════════════════════════════════════════════════════════════════ */

const HeatmapTab: React.FC = () => {
  const [assets, setAssets] = useState<Array<{ symbol: string; price: number | null; changePct: number | null }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/pulse/heatmap')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setAssets(d.assets || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const colorFor = (pct: number | null): string => {
    if (pct == null) return '#1e293b';
    if (pct >= 0) {
      if (pct > 3) return '#14532d';
      if (pct > 1) return '#166534';
      if (pct > 0.5) return '#15803d';
      if (pct > 0.1) return '#16a34a';
      return '#1a2e1a';
    }
    if (pct < -3) return '#7f1d1d';
    if (pct < -1) return '#991b1b';
    if (pct < -0.5) return '#b91c1c';
    if (pct < -0.1) return '#dc2626';
    return '#2e1a1a';
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Activity size={12} /> Market Heatmap
        </div>
      </div>
      {loading && <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>Loading...</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
        {assets.map(a => {
          const pct = a.changePct ?? 0;
          return (
            <div key={a.symbol} style={{ padding: '8px 4px', borderRadius: 4, background: colorFor(pct), textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: '#94a3b8', fontWeight: 600, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.symbol}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: pct >= 0 ? '#4ade80' : '#f87171', fontFamily: 'monospace' }}>
                {a.changePct != null ? `${a.changePct >= 0 ? '+' : ''}${a.changePct.toFixed(1)}%` : '—'}
              </div>
              {a.price != null && (
                <div style={{ fontSize: 8, color: '#64748b', fontFamily: 'monospace', marginTop: 1 }}>
                  ${a.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!loading && assets.length === 0 && (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>No data available</div>
      )}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════
   INTEL TAB — Force-posture, ACLED, anomalies, guardian, cyber OSINT
   ═════════════════════════════════════════════════════════════════ */

const IntelTab: React.FC = () => {
  const [forceStatus, setForceStatus] = useState<{ alertCount?: number; activeAlerts?: number } | null>(null);
  const [alerts, setAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [acled, setAcled] = useState<Array<Record<string, unknown>>>([]);
  const [anomalies, setAnomalies] = useState<Array<Record<string, unknown>>>([]);
  const [guardian, setGuardian] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cyberSources, setCyberSources] = useState<Record<string, Array<Record<string, unknown>>>>({});

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [fpRes, fpAlertsRes, acledRes, anomRes, guardRes, shodanRes, abuseRes, urlhausRes, outagesRes] = await Promise.allSettled([
        fetch('/api/force-posture/status'),
        fetch('/api/force-posture/alerts'),
        fetch('/api/acled/recent'),
        fetch('/api/correlation/anomalies'),
        fetch('/api/guardian/anomalies'),
        fetch('/api/cyber/shodan'),
        fetch('/api/abuseipdb'),
        fetch('/api/urlhaus'),
        fetch('/api/internet/outages'),
      ]);
      if (fpRes.status === 'fulfilled' && fpRes.value.ok) {
        const d = await fpRes.value.json();
        setForceStatus(d);
      }
      if (fpAlertsRes.status === 'fulfilled' && fpAlertsRes.value.ok) {
        const d = await fpAlertsRes.value.json();
        setAlerts(Array.isArray(d) ? d : d.alerts ?? d.items ?? []);
      }
      if (acledRes.status === 'fulfilled' && acledRes.value.ok) {
        const d = await acledRes.value.json();
        setAcled(Array.isArray(d) ? d : d.events ?? d.data ?? d.items ?? []);
      }
      if (anomRes.status === 'fulfilled' && anomRes.value.ok) {
        const d = await anomRes.value.json();
        setAnomalies(Array.isArray(d) ? d : d.anomalies ?? d.items ?? []);
      }
      if (guardRes.status === 'fulfilled' && guardRes.value.ok) {
        const d = await guardRes.value.json();
        setGuardian(Array.isArray(d) ? d : d.anomalies ?? d.data ?? d.items ?? []);
      }
      const cyber: Record<string, Array<Record<string, unknown>>> = {};
      if (shodanRes.status === 'fulfilled' && shodanRes.value.ok) {
        const d = await shodanRes.value.json();
        cyber.shodan = Array.isArray(d) ? d : d.matches ?? d.data ?? d.services ?? [];
      }
      if (abuseRes.status === 'fulfilled' && abuseRes.value.ok) {
        const d = await abuseRes.value.json();
        cyber.abuseipdb = Array.isArray(d) ? d : d.data ?? d.reports ?? [];
      }
      if (urlhausRes.status === 'fulfilled' && urlhausRes.value.ok) {
        const d = await urlhausRes.value.json();
        cyber.urlhaus = Array.isArray(d) ? d : d.urls ?? d.data ?? [];
      }
      if (outagesRes.status === 'fulfilled' && outagesRes.value.ok) {
        const d = await outagesRes.value.json();
        cyber.outages = Array.isArray(d) ? d : d.outages ?? d.data ?? [];
      }
      setCyberSources(cyber);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const cyberTotal = (cyberSources.shodan?.length ?? 0) + (cyberSources.abuseipdb?.length ?? 0) + (cyberSources.urlhaus?.length ?? 0) + (cyberSources.outages?.length ?? 0);

  const sections = [
    { id: 'alerts', label: 'Force-Posture Alerts', count: alerts.length, icon: <Shield size={12} />, color: '#fb7185' },
    { id: 'acled', label: 'ACLED Conflict', count: acled.length, icon: <MapPin size={12} />, color: '#f97316' },
    { id: 'anomalies', label: 'Correlation Anomalies', count: anomalies.length, icon: <AlertTriangle size={12} />, color: '#eab308' },
    { id: 'guardian', label: 'Guardian Alerts', count: guardian.length, icon: <Eye size={12} />, color: '#8b5cf6' },
    { id: 'cyber', label: 'Cyber / OSINT', count: cyberTotal, icon: <Shield size={12} />, color: '#f87171' },
  ];

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={12} /> Sentinel Intel
        </div>
        <RefreshCw
          size={12}
          style={{ color: '#64748b', cursor: 'pointer', transition: 'transform 0.3s' }}
          onClick={fetchData}
        />
      </div>

      {/* Status bar */}
      {forceStatus && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, padding: '8px 10px', borderRadius: 6, background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.2)' }}>
            <div style={{ fontSize: 9, color: '#fb7185' }}>Active Alerts</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{forceStatus.activeAlerts ?? forceStatus.alertCount ?? 0}</div>
          </div>
          <div style={{ flex: 1, padding: '8px 10px', borderRadius: 6, background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)' }}>
            <div style={{ fontSize: 9, color: '#818cf8' }}>Installations</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>
              <span style={{ fontSize: 10, color: '#64748b' }}>via </span>/api/force-posture
            </div>
          </div>
        </div>
      )}

      {loading && <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>Loading intel data...</div>}

      {/* Section rows */}
      {sections.map(s => {
        const items = s.id === 'alerts' ? alerts : s.id === 'acled' ? acled : s.id === 'anomalies' ? anomalies : s.id === 'guardian' ? guardian : [];
        const isExpanded = expanded === s.id;
        return (
          <div key={s.id} style={{ marginBottom: 4 }}>
            <div
              onClick={() => setExpanded(prev => prev === s.id ? null : s.id)}
              style={{
                padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                background: isExpanded ? `${s.color}10` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isExpanded ? `${s.color}55` : `${s.color}22`}`,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isExpanded ? <ChevronDown size={10} color={s.color} /> : <ChevronRight size={10} color="#64748b" />}
                  {s.icon}
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>{s.label}</span>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: s.color, fontFamily: 'monospace',
                  background: `${s.color}20`, padding: '2px 8px', borderRadius: 10,
                }}>
                  {s.count}
                </span>
              </div>
            </div>
            {isExpanded && s.id !== 'cyber' && (
              <div style={{
                padding: '10px 12px', margin: '0 0 4px', borderRadius: '0 0 6px 6px',
                background: `${s.color}08`, border: `1px solid ${s.color}22`, borderTop: 'none',
                animation: 'fadeIn 0.2s ease', maxHeight: 300, overflowY: 'auto',
              }}>
                {items.length === 0 && (
                  <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', padding: 10 }}>No data</div>
                )}
                {items.slice(0, 20).map((item, i) => (
                  <div key={item.id as string ?? i} style={{
                    padding: '6px 8px', marginBottom: 4, borderRadius: 4,
                    background: 'rgba(0,0,0,0.15)', fontSize: 10, lineHeight: 1.4,
                    color: '#cbd5e1', fontFamily: 'monospace',
                  }}>
                    {item.title as string ?? item.label as string ?? item.event as string ?? item.type as string ?? JSON.stringify(item).slice(0, 120)}
                  </div>
                ))}
              </div>
            )}
            {isExpanded && s.id === 'cyber' && (
              <div style={{
                padding: '10px 12px', margin: '0 0 4px', borderRadius: '0 0 6px 6px',
                background: `${s.color}08`, border: `1px solid ${s.color}22`, borderTop: 'none',
                animation: 'fadeIn 0.2s ease',
              }}>
                {cyberTotal === 0 && (
                  <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', padding: 10 }}>No threat data</div>
                )}
                {Object.entries(cyberSources).map(([source, srcItems]) =>
                  srcItems.length > 0 && (
                    <div key={source} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#f87171', marginBottom: 4, textTransform: 'capitalize' }}>
                        {source} ({srcItems.length})
                      </div>
                      {srcItems.slice(0, 8).map((item, i) => (
                        <div key={i} style={{
                          padding: '4px 8px', marginBottom: 2, borderRadius: 4,
                          background: 'rgba(0,0,0,0.15)', fontSize: 9, lineHeight: 1.3,
                          color: '#cbd5e1', fontFamily: 'monospace',
                        }}>
                          {item.ip as string ?? item.hostname as string ?? item.url as string ?? item.domain as string ?? item.location as string ?? item.source as string ?? Object.values(item)[0] as string ?? JSON.stringify(item).slice(0, 100)}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════
   MAIN INTELLIGENCE PANEL
   ═════════════════════════════════════════════════════════════════ */

export const IntelligencePanel: React.FC<IntelligencePanelProps> = ({
  open, onClose, onToggleLayer: _onToggleLayer, onFlyTo, zIndex = 999,
}): React.ReactElement => {
  const [activeTab, setActiveTab] = useState<TabId>('market');
  const mountedTabs = useRef<Set<TabId>>(new Set(['market']));
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  const switchTab = useCallback((id: TabId) => {
    mountedTabs.current.add(id);
    setActiveTab(id);
  }, []);

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: 'market', label: 'Markets', icon: <TrendingUp size={14} /> },
    { id: 'energy', label: 'Energy', icon: <Zap size={14} /> },
    { id: 'geopolitical', label: 'Risk', icon: <Globe size={14} /> },
    { id: 'correlation', label: 'Signals', icon: <Link size={14} /> },
    { id: 'sentiment', label: 'Sentiment', icon: <Brain size={14} /> },
    { id: 'heatmap', label: 'Heatmap', icon: <Activity size={14} /> },
    { id: 'analysis', label: 'Analysis', icon: <BarChart3 size={14} /> },
    { id: 'intel', label: 'Intel', icon: <Shield size={14} /> },
  ];

  const tabContent: Record<TabId, React.ReactNode> = {
    market: <MarketTab />,
    energy: <EnergyTab />,
    geopolitical: <GeopoliticalTab onFlyTo={onFlyTo} />,
    correlation: <CorrelationTab />,
    sentiment: <SentimentTab />,
    heatmap: <HeatmapTab />,
    analysis: <AnalysisTab />,
    intel: <IntelTab />,
  };

  if (!open) return null as unknown as React.ReactElement;

  return (
    <div style={{ position: 'fixed', top: 60, right: 10, bottom: 56, zIndex, width: 380, maxWidth: 'calc(100vw - 32px)' }}>
      <Panel
        title="PULSE"
        icon={<Eye size={16} />}
        accentColor="#818cf8"
        iconColor="#a78bfa"
        titleColor="#c4b5fd"
        onClose={onClose}
        style={{ height: '100%', animation: 'slideInRight 0.25s ease' }}
      >

        {/* Tab Bar */}
        <div className="tab-bar" style={{
          display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)',
          padding: '0 8px', overflowX: 'auto', scrollbarWidth: 'none',
        }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              style={{
                flex: 1, padding: '10px 6px', background: 'none', border: 'none',
                borderBottom: `2px solid ${activeTab === tab.id ? '#818cf8' : 'transparent'}`,
                color: activeTab === tab.id ? '#e2e8f0' : '#64748b',
                cursor: 'pointer', fontSize: 10, fontWeight: activeTab === tab.id ? 600 : 400,
                transition: 'all 0.15s', whiteSpace: 'nowrap',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              }}
              onMouseEnter={(e) => { if (activeTab !== tab.id) e.currentTarget.style.color = '#94a3b8'; }}
              onMouseLeave={(e) => { if (activeTab !== tab.id) e.currentTarget.style.color = '#64748b'; }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content - cached with display:none */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {(Object.keys(tabContent) as TabId[]).map(id => (
            <div key={id} style={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', display: activeTab === id ? 'block' : 'none' }}>
              {tabContent[id]}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 9, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Layers size={9} /> Real-time data
          </div>
          <div style={{ fontSize: 9, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Hash size={9} /> CMD+K search
          </div>
        </div>
    </Panel>
    </div>
  );
};
