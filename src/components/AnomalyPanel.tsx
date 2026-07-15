import { useEffect, useState, useCallback } from 'react';
import { X, ChevronDown, ChevronRight, Radio } from 'lucide-react';
import { SEVERITY_COLORS, SEVERITY_ICONS, timeAgo } from '../lib/constants';

/* ── Types ── */
interface Anomaly {
  id: string;
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  title: string;
  description: string;
  lat: number;
  lon: number;
  radius: number;
  sources: string[];
  events: string[];
  createdAt: number;
  acknowledged: boolean;
}

interface AnomalyPanelProps {
  onClose: () => void;
}

/* ── Helpers ── */
const severityColor = SEVERITY_COLORS;
const severityIcon = SEVERITY_ICONS;

const sourceLabels: Record<string, string> = {
  usgs_earthquakes: 'USGS Earthquakes',
  nws_alerts: 'NWS Weather',
  nasa_firms: 'NASA FIRMS',
  nasa_eonet: 'NASA EONET',
  military_flights: 'Military ADS-B',
  ucdp_conflicts: 'UCDP Conflicts',
  gdacs_disasters: 'GDACS Disasters',
};



/* ── Stats Bar ── */
function StatsBar({ anomalies }: { anomalies: Anomaly[] }) {
  const critical = anomalies.filter(a => a.severity === 'critical').length;
  const high = anomalies.filter(a => a.severity === 'high').length;
  const medium = anomalies.filter(a => a.severity === 'medium').length;
  const unacked = anomalies.filter(a => !a.acknowledged).length;

  return (
    <div style={{ display: 'flex', gap: 12, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: 11 }}>
      <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} /> {critical} Critical</span>
      <span style={{ color: '#f97316', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} /> {high} High</span>
      <span style={{ color: '#eab308', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#eab308', display: 'inline-block' }} /> {medium} Medium</span>
      <span style={{ color: '#60a5fa', marginLeft: 'auto' }}>{unacked} Unread</span>
    </div>
  );
}

/* ── Anomaly Card ── */
function AnomalyCard({ anomaly, onAcknowledge }: { anomaly: Anomaly; onAcknowledge: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = severityIcon[anomaly.severity];
  const color = severityColor[anomaly.severity] || '#60a5fa';

  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      cursor: 'pointer',
      opacity: anomaly.acknowledged ? 0.5 : 1,
      transition: 'opacity 0.2s',
    }} onClick={() => setExpanded(p => !p)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {expanded ? <ChevronDown size={14} color="#64748b" /> : <ChevronRight size={14} color="#64748b" />}
        <Icon size={14} color={color} />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{anomaly.title}</span>
        <span style={{ fontSize: 10, color: '#64748b' }}>{timeAgo(anomaly.createdAt)}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 22, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
          <p>{anomaly.description}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {anomaly.sources.map(src => (
              <span key={src} style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontSize: 10 }}>
                {sourceLabels[src] || src}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#64748b', fontSize: 10 }}>Confidence: {Math.round(anomaly.confidence * 100)}%</span>
            <span style={{ color: '#64748b', fontSize: 10 }}>({anomaly.lat.toFixed(3)}, {anomaly.lon.toFixed(3)})</span>
            {!anomaly.acknowledged && (
              <button onClick={(e) => { e.stopPropagation(); onAcknowledge(anomaly.id); }} style={{
                marginLeft: 'auto', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)',
                background: 'transparent', color: '#94a3b8', fontSize: 10, cursor: 'pointer',
              }}>ACK</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Panel ── */
export default function AnomalyPanel({ onClose }: AnomalyPanelProps) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [expanded, setExpanded] = useState(true);

  // Fetch anomalies on mount
  useEffect(() => {
    fetch('/api/correlation/anomalies')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.anomalies)) setAnomalies(data.anomalies);
      })
      .catch(() => {});
  }, []);

  // Poll for new anomalies every 30s
  useEffect(() => {
    const timer = setInterval(() => {
      fetch('/api/correlation/anomalies')
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data.anomalies)) setAnomalies(data.anomalies);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleAcknowledge = useCallback((id: string) => {
    fetch(`/api/correlation/anomalies/${id}/acknowledge`, { method: 'POST' })
      .then(() => setAnomalies(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a)))
      .catch(() => {});
  }, []);

  const filtered = filter === 'all' ? anomalies : anomalies.filter(a => a.severity === filter);

  return (
    <div style={{
      position: 'fixed', top: 50, right: 10, width: 400, maxHeight: 'calc(100vh - 100px)',
      zIndex: 110, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)',
      background: 'rgba(12,12,30,0.92)', backdropFilter: 'blur(12px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Radio size={16} color="#f59e0b" />
        <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', flex: 1 }}>Intelligence Correlation</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}><X size={14} /></button>
      </div>

      {/* Stats */}
      <StatsBar anomalies={anomalies} />

      {/* Filter Chips */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {(['all', 'critical', 'high', 'medium', 'low'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${filter === f ? (f === 'all' ? '#60a5fa' : severityColor[f]) : 'rgba(255,255,255,0.15)'}`,
            background: filter === f ? (f === 'all' ? 'rgba(96,165,250,0.15)' : `${severityColor[f]}22`) : 'transparent',
            color: filter === f ? (f === 'all' ? '#60a5fa' : severityColor[f]) : '#64748b',
          }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
        ))}
      </div>

      {/* Anomaly List */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
            {filter === 'all' ? 'No anomalies detected. Engine is monitoring real data streams.' : `No ${filter} anomalies.`}
          </div>
        ) : (
          filtered.map(a => (
            <AnomalyCard key={a.id} anomaly={a} onAcknowledge={handleAcknowledge} />
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '6px 12px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 10, color: '#475569', display: 'flex', justifyContent: 'space-between' }}>
        <span>{filtered.length} anomalies</span>
        <span>6 rules • 7 data streams • 30min window</span>
      </div>
    </div>
  );
}
