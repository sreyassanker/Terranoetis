import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Package, ArrowUpRight, ArrowDownRight, Info } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface TradeData {
  country: string;
  countryCode: string;
  exports: number;
  imports: number;
  balance: number;
  period: string;
  lat: number;
  lon: number;
}

interface SupplyChainPanelProps {
  onClose: () => void;
}

export function SupplyChainPanel({ onClose }: SupplyChainPanelProps) {
  const [data, setData] = useState<TradeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await fetch('/api/supply-chain/trade');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      setData(result.trades || []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load trade data');
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
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    return `$${value.toLocaleString()}`;
  };

  return (
    <Panel title="Global Trade Flows" onClose={onClose} width={420}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#64748b' }}>
            UN Comtrade Data
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
            Loading trade data...
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
            <Info size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            {error}
            <div style={{ color: '#94a3b8', marginTop: 4, fontSize: 10 }}>
              UN Comtrade API may be temporarily unavailable
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
            <Package size={20} style={{ marginBottom: 8, opacity: 0.4 }} />
            <div>No trade data available</div>
          </div>
        )}

        {!loading && data.length > 0 && (
          <div style={{ padding: '0 12px' }}>
            {data.map((item, idx) => (
              <div
                key={`trade-${item.countryCode}-${idx}`}
                style={{
                  padding: '10px 12px',
                  marginBottom: 4,
                  borderRadius: 6,
                  background: 'rgba(67,97,238,0.06)',
                  border: '1px solid rgba(67,97,238,0.2)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                      {item.country}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>
                      {item.countryCode} • {item.period}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2 }}>Exports</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#22c55e', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                      <ArrowUpRight size={10} />
                      {formatValue(item.exports)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2 }}>Imports</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#ef4444', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                      <ArrowDownRight size={10} />
                      {formatValue(item.imports)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2 }}>Balance</div>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: item.balance >= 0 ? '#22c55e' : '#ef4444',
                      fontFamily: 'monospace',
                    }}>
                      {formatValue(item.balance)}
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
        Data from UN Comtrade API • Updated daily
      </div>
    </Panel>
  );
}
