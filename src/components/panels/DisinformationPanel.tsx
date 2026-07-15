import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertTriangle, ExternalLink, Info } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface DisinformationData {
  title: string;
  url: string;
  source: string;
  date: string;
  language: string;
  tone: number;
  domain: string;
  lat: number;
  lon: number;
}

interface DisinformationPanelProps {
  onClose: () => void;
}

export function DisinformationPanel({ onClose }: DisinformationPanelProps) {
  const [data, setData] = useState<DisinformationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await fetch('/api/intelligence/disinformation');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      setData(result.articles || []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load disinformation data');
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

  const getToneColor = (tone: number) => {
    if (tone > 0.3) return '#22c55e';
    if (tone < -0.3) return '#ef4444';
    return '#64748b';
  };

  return (
    <Panel title="Disinformation Monitor" onClose={onClose} width={420}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#64748b' }}>
            GDELT Media Analysis
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
            Analyzing media sources...
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
              GDELT API may be temporarily unavailable
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
            <AlertTriangle size={20} style={{ marginBottom: 8, opacity: 0.4 }} />
            <div>No disinformation articles found</div>
          </div>
        )}

        {!loading && data.length > 0 && (
          <div style={{ padding: '0 12px' }}>
            {data.map((item, idx) => (
              <div
                key={`disinfo-${idx}`}
                style={{
                  padding: '10px 12px',
                  marginBottom: 4,
                  borderRadius: 6,
                  background: 'rgba(157,2,8,0.06)',
                  border: '1px solid rgba(157,2,8,0.2)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.3 }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                      {item.source} • {item.date}
                    </div>
                  </div>
                  <div style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: `${getToneColor(item.tone)}20`,
                    color: getToneColor(item.tone),
                    fontSize: 9,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}>
                    {item.tone > 0 ? '+' : ''}{(item.tone * 100).toFixed(0)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {item.language && (
                    <span style={{
                      fontSize: 9,
                      color: '#94a3b8',
                      background: 'rgba(255,255,255,0.06)',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}>
                      {item.language}
                    </span>
                  )}
                  {item.domain && (
                    <span style={{
                      fontSize: 9,
                      color: '#94a3b8',
                      background: 'rgba(255,255,255,0.06)',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}>
                      {item.domain}
                    </span>
                  )}
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 9,
                        color: '#818cf8',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        textDecoration: 'none',
                      }}
                    >
                      <ExternalLink size={8} />
                      Source
                    </a>
                  )}
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
        Data from GDELT Project • Monitors propaganda & disinformation
      </div>
    </Panel>
  );
}
