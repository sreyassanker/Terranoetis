import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, TrendingUp, BarChart3, Globe, Users, DollarSign, Thermometer, Briefcase, Wind, Heart } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { COUNTRY_CENTROIDS } from '@/lib/countryCentroids';
import { getCoordinates, isValidCoordinates } from '@/lib/types/geo';

interface WorldBankItem {
  country: string;
  countryCode: string;
  value: number;
  date: string;
  indicator: string;
  indicatorCode?: string;
}

const INDICATORS = [
  { code: 'NY.GDP.MKTP.CD', name: 'GDP', icon: <DollarSign size={14} />, unit: 'US$', divisor: 1e9, format: (v: number) => `$${(v / 1e9).toFixed(1)}B`, color: '#22c55e' },
  { code: 'NY.GDP.PCAP.CD', name: 'GDP/Capita', icon: <TrendingUp size={14} />, unit: 'US$/person', divisor: 1, format: (v: number) => `$${v.toLocaleString()}`, color: '#3b82f6' },
  { code: 'SP.POP.TOTL', name: 'Population', icon: <Users size={14} />, unit: 'people', divisor: 1e6, format: (v: number) => `${(v / 1e6).toFixed(1)}M`, color: '#8b5cf6' },
  { code: 'FP.CPI.TOTL.ZG', name: 'Inflation', icon: <Thermometer size={14} />, unit: '%', divisor: 1, format: (v: number) => `${v.toFixed(1)}%`, color: '#ef4444' },
  { code: 'SL.UEM.TOTL.ZS', name: 'Unemployment', icon: <Briefcase size={14} />, unit: '%', divisor: 1, format: (v: number) => `${v.toFixed(1)}%`, color: '#f59e0b' },
  { code: 'SP.DYN.LE00.IN', name: 'Life Expectancy', icon: <Heart size={14} />, unit: 'years', divisor: 1, format: (v: number) => `${v.toFixed(1)} yrs`, color: '#06b6d4' },
  { code: 'EN.ATM.CO2E.PC', name: 'CO2/Capita', icon: <Wind size={14} />, unit: 'metric tons', divisor: 1, format: (v: number) => `${v.toFixed(2)}t`, color: '#64748b' },
  { code: 'BN.CAB.XOKA.CD', name: 'Current Account', icon: <Globe size={14} />, unit: 'US$', divisor: 1e9, format: (v: number) => `${v >= 0 ? '+' : ''}$${(v / 1e9).toFixed(1)}B`, color: '#10b981' },
];


export function WorldBankPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<WorldBankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndicator, setActiveIndicator] = useState(0);
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('table');

  const currentIndicator = INDICATORS[activeIndicator];

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Fetch all indicators at once
      const indicatorCodes = INDICATORS.map(i => i.code).join(',');
      const res = await fetch(`/api/economics/worldbank?indicator=${indicatorCodes}`);
      if (!res.ok) throw new Error('Failed to fetch data');
      const result = await res.json();
      setData(result.indicators || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 300000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, [fetchData]);

  // Filter data for current indicator
  const filteredData = useMemo(() => {
    return data
      .filter(d => d.indicatorCode === currentIndicator.code)
      .filter(d => d.value != null && d.country !== 'World' && !d.country?.includes('income') && !d.country?.includes('OECD') && !d.country?.includes('European Union'))
      .sort((a, b) => (b.value || 0) - (a.value || 0));
  }, [data, currentIndicator]);

  const top10 = useMemo(() => filteredData.slice(0, 10), [filteredData]);

  return (
    <Panel
      title="WORLD BANK ECONOMIC DATA"
      icon={<BarChart3 size={16} />}
      accentColor="#22c55e"
      iconColor="#4ade80"
      titleColor="#86efac"
      onClose={onClose}
      style={{ maxHeight: 'calc(100vh - 160px)', width: 400 }}
    >
      {/* Indicator selector */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {INDICATORS.map((ind, i) => (
          <button
            key={ind.code}
            onClick={() => setActiveIndicator(i)}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: 'none',
              fontSize: 11,
              fontWeight: activeIndicator === i ? 600 : 400,
              background: activeIndicator === i ? ind.color : 'transparent',
              color: activeIndicator === i ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.2s',
            }}
          >
            {ind.icon}
            {ind.name}
          </button>
        ))}
      </div>

      {/* Tab switcher */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <button
          onClick={() => setActiveTab('table')}
          style={{
            padding: '4px 12px',
            borderRadius: 4,
            border: 'none',
            fontSize: 12,
            background: activeTab === 'table' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'table' ? '#fff' : 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Table
        </button>
        <button
          onClick={() => setActiveTab('chart')}
          style={{
            padding: '4px 12px',
            borderRadius: 4,
            border: 'none',
            fontSize: 12,
            background: activeTab === 'chart' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'chart' ? '#fff' : 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Top 10
        </button>
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={fetchData}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: 'none',
              fontSize: 11,
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </div>

      {/* Geographic Distribution using COUNTRY_CENTROIDS */}
      {!loading && !error && filteredData.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6, fontFamily: 'monospace' }}>GEOGRAPHIC DISTRIBUTION</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {filteredData.slice(0, 15).map((item, i) => {
              const coords = getCoordinates(COUNTRY_CENTROIDS, item.countryCode);
              if (!coords || !isValidCoordinates(coords)) return null;
              const severity = currentIndicator.color;
              return (
                <div key={`geo-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, background: `${severity}15`, border: `1px solid ${severity}30` }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: severity }} />
                  <span style={{ fontSize: 10, color: severity }}>{item.countryCode}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ padding: '8px 12px', maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
            <RefreshCw size={20} className="animate-spin" style={{ marginBottom: 8 }} />
            <div>Loading {currentIndicator.name} data...</div>
          </div>
        )}
        
        {error && (
          <div style={{ textAlign: 'center', padding: 20, color: '#ef4444' }}>
            Error: {error}
          </div>
        )}

        {!loading && !error && filteredData.length === 0 && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
            No data available for {currentIndicator.name}
          </div>
        )}

        {!loading && !error && activeTab === 'table' && filteredData.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filteredData.slice(0, 20).map((item, i) => {
              const maxVal = filteredData[0]?.value || 1;
              const percentage = (item.value / maxVal) * 100;
              return (
                <div
                  key={`${item.countryCode}-${item.date}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.03)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${percentage}%`,
                      background: `${currentIndicator.color}15`,
                      borderRadius: 6,
                    }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 20, zIndex: 1 }}>
                    {i + 1}
                  </span>
                  <div style={{ flex: 1, zIndex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{item.country}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{item.date}</div>
                  </div>
                  <div style={{ textAlign: 'right', zIndex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: currentIndicator.color }}>
                      {currentIndicator.format(item.value)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !error && activeTab === 'chart' && top10.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {top10.map((item, i) => {
              const maxVal = top10[0]?.value || 1;
              const percentage = (item.value / maxVal) * 100;
              return (
                <div key={`${item.countryCode}-${item.date}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ fontWeight: 500 }}>{item.country}</span>
                    <span style={{ color: currentIndicator.color, fontWeight: 600 }}>
                      {currentIndicator.format(item.value)}
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${percentage}%`,
                        background: `linear-gradient(90deg, ${currentIndicator.color}, ${currentIndicator.color}cc)`,
                        borderRadius: 4,
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center' }}>
        Source: World Bank Open Data • {filteredData.length} countries • Auto-refresh: 5min
      </div>
    </Panel>
  );
}
