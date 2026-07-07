import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, ClipboardList, Circle, CheckCircle, RefreshCw } from 'lucide-react';

interface Alert {
  id: string;
  title: string;
  body: string;
  severity: string;
  lat: number;
  lon: number;
  type: string;
  delivered: number;
  created_at: string;
  evidence?: string;
  dismissed?: boolean;
}

interface AlertPanelProps {
  onClose: () => void;
  onFlyTo?: (lat: number, lon: number) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'var(--accent)', advisory: 'var(--warning)', warning: '#f97316', critical: 'var(--danger)',
};

function AlertCard({ alert, onDismiss, onEscalate }: { alert: Alert; onDismiss: () => void; onEscalate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const color = SEVERITY_COLORS[alert.severity] || 'var(--text-dim)';
  const timeAgo = alert.created_at
    // eslint-disable-next-line react-hooks/purity
    ? Math.floor((Date.now() - new Date(alert.created_at + 'Z').getTime()) / 60000)
    : 0;

  return (
    <div style={{
      padding: '8px 10px', borderBottom: '1px solid var(--border)',
      borderLeft: `3px solid ${color}`,
      background: expanded ? 'rgba(255,255,255,0.02)' : 'transparent',
      cursor: 'pointer',
    }} onClick={() => setExpanded(!expanded)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
              background: `${color}20`, color,
            }}>{alert.severity.toUpperCase()}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>{alert.title}</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-dim)' }}>
              {timeAgo < 60 ? `${timeAgo}m ago` : `${Math.floor(timeAgo / 60)}h ago`}
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>{alert.body}</div>
          {alert.lat !== 0 && (
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
              <MapPin size={10} style={{display:'inline',marginRight:2}} /> {alert.lat.toFixed(3)}, {alert.lon.toFixed(3)}
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <button onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer' }}>
            Dismiss
          </button>
          <button onClick={(e) => { e.stopPropagation(); onEscalate(); }}
            style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, color: 'var(--warning)', cursor: 'pointer' }}>
            Escalate
          </button>
          {alert.evidence && (
            <span style={{ fontSize: 9, color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 2 }}>
              <ClipboardList size={10} style={{display:'inline',marginRight:2}} /> {alert.evidence}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function AlertPanel({ onClose, onFlyTo }: AlertPanelProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [showHistory, setShowHistory] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const resp = await fetch('/api/sentinel/alerts');
      if (resp.ok) {
        const data = await resp.json();
        setAlerts((data.alerts || []).slice(0, 100));
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const filtered = alerts.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'critical') return a.severity === 'critical';
    if (filter === 'warning') return a.severity === 'warning' || a.severity === 'advisory';
    return true;
  });

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="panel-header">
        {!showHistory && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {[
              { key: 'all', label: `All (${alerts.length})` },
              { key: 'critical', label: <><Circle size={9} fill="var(--danger)" color="var(--danger)" style={{display:'inline',marginRight:2}} />{criticalCount}</> },
              { key: 'warning', label: <><Circle size={9} fill="#f97316" color="#f97316" style={{display:'inline',marginRight:2}} />{warningCount}</> },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{
                  fontSize: 9, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
                  background: filter === f.key ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${filter === f.key ? 'var(--accent)' : 'var(--border)'}`,
                  color: filter === f.key ? '#fff' : 'var(--text-dim)',
                  fontWeight: filter === f.key ? 600 : 400,
                }}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
          <button onClick={() => setShowHistory(!showHistory)}
            style={{ fontSize: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer', padding: '2px 6px' }}>
            {showHistory ? 'Live' : 'History'}
          </button>
          <button className="ai-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {!showHistory && (
        <>
          {/* Alert Cards */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {loading && <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)' }}>Loading alerts...</div>}
            {!loading && filtered.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)' }}>
                <CheckCircle size={11} style={{display:'inline',marginRight:3}} /> No alerts
              </div>
            )}
            {filtered.map(alert => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onDismiss={() => setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, dismissed: true } : a))}
                onEscalate={() => {
                  if (onFlyTo && alert.lat) onFlyTo(alert.lat, alert.lon);
                }}
              />
            ))}
          </div>
        </>
      )}

      {showHistory && (
        <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 }}>
            Last {alerts.length} alerts
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {alerts.slice(-20).reverse().map((a, i) => (
              <div key={i} style={{
                padding: '4px 8px', borderRadius: 4, fontSize: 9,
                background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                borderLeft: `2px solid ${SEVERITY_COLORS[a.severity] || 'var(--text-dim)'}`,
              }}>
                <div style={{ color: 'var(--text)', fontWeight: 500 }}>{a.title}</div>
                <div style={{ color: 'var(--text-dim)', marginTop: 1 }}>{a.created_at}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
        <button onClick={() => setAlerts([])} style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, color: 'var(--danger)', cursor: 'pointer' }}>
          Clear All
        </button>
        <button onClick={fetchAlerts} style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer' }}>
          <RefreshCw size={10} style={{display:'inline',marginRight:2}} /> Refresh
        </button>
      </div>
    </div>
  );
}
