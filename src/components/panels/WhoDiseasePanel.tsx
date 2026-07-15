import { useState, useEffect, useCallback } from 'react';
import { WHO_GEO } from '@/lib/whoGeo';
import { getCoordinates, isValidCoordinates } from '@/lib/types/geo';
import { RefreshCw, Activity, AlertTriangle, Info } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface WhoData {
  name: string;
  value: number;
  date: string;
  source: string;
  indicator: string;
  lat: number;
  lon: number;
}

interface WhoDiseasePanelProps {
  onClose: () => void;
}

export function WhoDiseasePanel({ onClose }: WhoDiseasePanelProps) {
  const [data, setData] = useState<WhoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await fetch('/api/health/who-outbreaks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      setData(result.indicators || []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load WHO data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 300000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatValue = (value: number) => {
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
    return value.toFixed(2);
  };

  return (
    <Panel title="WHO Disease Outbreaks" onClose={onClose} width={420}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#64748b' }}>
            Global Health Observatory
          </span>
          <RefreshCw
            size={12}
            style={{
              color: '#64748b',
              cursor: 'pointer',
              opacity: refreshing ? 0.5 : 1,
              transition: 'transform 0.3s',
              transform: refreshing ? 'rotate(180deg)' : 'none',
            }}
            onClick={() => fetchData(true)}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '8px 0' }}>
        {loading && (
          <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 20 }}>
            Loading WHO health data...
          </div>
        )}

        {error && (
          <div style={{
            color: '#ef4444',
            fontSize: 12,
            padding: 12,
            background: 'rgba(239,68,68,0.1)',
            borderRadius: 6,
            margin: '0 12px',
          }}>
            <AlertTriangle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            {error}
            <div style={{ color: '#94a3b8', marginTop: 4, fontSize: 10 }}>
              WHO GHO API may be temporarily unavailable
            </div>
          </div>
        )}

        {!loading && !error && data.length === 0 && (
          <div style={{
            color: '#64748b',
            fontSize: 12,
            textAlign: 'center',
            padding: 20,
          }}>
            <Activity size={20} style={{ marginBottom: 8, opacity: 0.4 }} />
            <div>No WHO health data available</div>
          </div>
        )}

        {!loading && data.length > 0 && (
          <div style={{ padding: '0 12px' }}>
                    {/* Geographic Distribution using WHO_GEO */}
        {data.length > 0 && (
          <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: 'rgba(231,111,81,0.06)', border: '1px solid rgba(231,111,81,0.2)' }}>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, fontFamily: 'monospace' }}>GEOGRAPHIC DISTRIBUTION</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {data.slice(0, 20).map((item: WhoData, i: number) => {
                const dim = item.name?.split(':')[0]?.trim();
                const coords = dim ? getCoordinates(WHO_GEO, dim) : null;
                if (!coords || !isValidCoordinates(coords)) return null;
                const severity = (item.value || 0) > 100 ? '#ef4444' : (item.value || 0) > 10 ? '#f59e0b' : '#22c55e';
                return (
                  <div key={`geo-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, background: `${severity}15`, border: `1px solid ${severity}30` }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: severity }} />
                    <span style={{ fontSize: 10, color: severity }}>{dim}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {data.map((item, idx) => (
              <div
                key={`who-${idx}`}
                style={{
                  padding: '10px 12px',
                  marginBottom: 4,
                  borderRadius: 6,
                  background: 'rgba(231,111,81,0.06)',
                  border: '1px solid rgba(231,111,81,0.2)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>
                      {item.indicator} • {item.date}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e76f51', fontFamily: 'monospace' }}>
                      {formatValue(item.value)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        fontSize: 10,
        color: '#64748b',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        <Info size={10} />
        Data from WHO Global Health Observatory • Updated hourly
      </div>
    </Panel>
  );
}
