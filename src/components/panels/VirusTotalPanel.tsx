import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Shield, AlertTriangle, Info } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface VirusTotalData {
  name: string;
  type: string;
  severity: string;
  source: string;
  detected: boolean;
  scanDate: string;
}

interface VirusTotalPanelProps {
  onClose: () => void;
}

export function VirusTotalPanel({ onClose }: VirusTotalPanelProps) {
  const [data, setData] = useState<VirusTotalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await fetch('/api/cyber/virustotal');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      setData(result.threats || []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load VirusTotal data');
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

  const getSeverityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case 'critical': return '#ef4444';
      case 'high': return '#f97316';
      case 'medium': return '#eab308';
      case 'low': return '#22c55e';
      default: return '#64748b';
    }
  };

  return (
    <Panel title="VirusTotal Threats" onClose={onClose} width={420}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#64748b' }}>
            Threat Intelligence Feed
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
            Loading threat intelligence...
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
              VirusTotal API key may not be configured
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
            <Shield size={20} style={{ marginBottom: 8, opacity: 0.4 }} />
            <div>No threat data available</div>
            <div style={{ fontSize: 10, marginTop: 4 }}>
              Configure VIRUSTOTAL_API_KEY in .env
            </div>
          </div>
        )}

        {!loading && data.length > 0 && (
          <div style={{ padding: '0 12px' }}>
            {data.map((item, idx) => (
              <div
                key={`vt-${idx}`}
                style={{
                  padding: '10px 12px',
                  marginBottom: 4,
                  borderRadius: 6,
                  background: 'rgba(214,40,40,0.06)',
                  border: `1px solid ${getSeverityColor(item.severity)}33`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: getSeverityColor(item.severity),
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                      {item.type} • {item.severity} • {item.scanDate}
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
        Data from VirusTotal API • Requires API key
      </div>
    </Panel>
  );
}
