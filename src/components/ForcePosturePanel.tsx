import { useEffect, useState, useCallback } from 'react';
import { Radar, X, ChevronRight, ChevronDown, AlertCircle, AlertTriangle } from 'lucide-react';
import { SEVERITY_COLORS, timeAgo } from '../lib/constants';

interface Installation {
  id: string; name: string; type: string; country: string;
  lat: number; lon: number; baselineFlightCount: number;
  currentFlightCount: number; deviationScore: number; lastUpdate: number;
}

interface PostureAlert {
  id: string; type: string; severity: string; installationId: string;
  installationName: string; lat: number; lon: number; description: string;
  confidence: number; createdAt: number; acknowledged: boolean;
}

const severityColor = SEVERITY_COLORS;
const typeLabels: Record<string, string> = { activity_surge: 'Activity Surge', activity_drop: 'Activity Drop', force_buildup: 'Force Buildup', exercise_detected: 'Exercise Detected' };


export default function ForcePosturePanel({ onClose }: { onClose: () => void }) {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [alerts, setAlerts] = useState<PostureAlert[]>([]);
  const [tab, setTab] = useState<'installations' | 'alerts'>('installations');

  useEffect(() => {
    fetch('/api/force-posture/installations').then(r => r.json()).then(d => { if (d.installations) setInstallations(d.installations); }).catch(() => {});
    fetch('/api/force-posture/alerts').then(r => r.json()).then(d => { if (d.alerts) setAlerts(d.alerts); }).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      fetch('/api/force-posture/installations').then(r => r.json()).then(d => { if (d.installations) setInstallations(d.installations); }).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const handleAck = useCallback((id: string) => {
    fetch(`/api/force-posture/alerts/${id}/acknowledge`, { method: 'POST' })
      .then(() => setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a)))
      .catch(() => {});
  }, []);

  const activeAlerts = alerts.filter(a => !a.acknowledged);
  const highDeviation = installations.filter(i => i.deviationScore >= 1.5);

  return (
    <div style={{
      position: 'fixed', top: 50, right: 10, width: 420, maxHeight: 'calc(100vh - 100px)',
      zIndex: 110, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)',
      background: 'rgba(12,12,30,0.92)', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Radar size={16} color="#06b6d4" />
        <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', flex: 1 }}>Force Posture Intelligence</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}><X size={14} /></button>
      </div>

      <div style={{ display: 'flex', gap: 12, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: 11 }}>
        <span style={{ color: '#06b6d4', display: 'flex', alignItems: 'center', gap: 4 }}><Radar size={14} /> {installations.length} Installations</span>
        <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}><AlertCircle size={14} /> {highDeviation.length} Deviations</span>
        <span style={{ color: '#f97316', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={14} /> {activeAlerts.length} Alerts</span>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        {(['installations', 'alerts'] as const).map(key => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: tab === key ? 'rgba(6,182,212,0.1)' : 'transparent',
            color: tab === key ? '#06b6d4' : '#64748b', borderBottom: tab === key ? '2px solid #06b6d4' : '2px solid transparent',
            border: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
          }}>{key === 'installations' ? 'Installations' : 'Alerts'}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 'installations' ? (
          installations.sort((a, b) => b.deviationScore - a.deviationScore).map(inst => (
            <div key={inst.id} style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{inst.name}</span>
                <span style={{ fontSize: 10, color: '#64748b' }}>{inst.country}</span>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: inst.deviationScore >= 1.5 ? 'rgba(239,68,68,0.2)' : 'rgba(6,182,212,0.2)', color: inst.deviationScore >= 1.5 ? '#ef4444' : '#06b6d4' }}>{Math.round(inst.deviationScore * 100)}%</span>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                Flights: {inst.currentFlightCount}/{inst.baselineFlightCount} baseline • ({inst.lat.toFixed(2)}, {inst.lon.toFixed(2)})
              </div>
            </div>
          ))
        ) : (
          alerts.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 12 }}>No posture alerts.</div>
          ) : (
            alerts.map(a => (
              <div key={a.id} style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: a.acknowledged ? 0.5 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={14} color={severityColor[a.severity]} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{a.installationName}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${severityColor[a.severity]}22`, color: severityColor[a.severity] }}>{typeLabels[a.type] || a.type}</span>
                  <span style={{ fontSize: 10, color: '#64748b' }}>{timeAgo(a.createdAt)}</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{a.description}</div>
                {!a.acknowledged && (
                  <button onClick={() => handleAck(a.id)} style={{ marginTop: 4, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#94a3b8', fontSize: 10, cursor: 'pointer' }}>ACK</button>
                )}
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}
