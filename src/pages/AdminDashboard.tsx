import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getToken } from '../context/AuthContext';
import { Lock, Shield, X, BarChart3, ClipboardList, Plug, Heart } from 'lucide-react';

type Tab = 'metrics' | 'audit' | 'plugins' | 'health';

interface HealthData {
  status: string;
  checks: Record<string, { status: string; detail?: string }>;
  uptime_ms: number;
  version?: string;
}

interface MetricsData {
  [key: string]: string;
}

interface AuditLogRow {
  id: number;
  user_id: string;
  action: string;
  resource: string;
  details: string;
  created_at: string;
}

interface PluginRow {
  id: string;
  name: string;
  version: string;
  description?: string;
  toolCount: number;
  enabled: boolean;
}

export default function AdminDashboard({ onClose }: { onClose: () => void }) {
  const { isAdmin, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('metrics');
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [healthColor, setHealthColor] = useState<string>('#22c55e');

  const token = getToken();

  const fetchMetrics = useCallback(async () => {
    try {
      const resp = await fetch('/api/admin/metrics', {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (resp.ok) {
        const text = await resp.text();
        const lines: MetricsData = {};
        for (const line of text.split('\n')) {
          if (line && !line.startsWith('#') && !line.startsWith('TYPE') && !line.startsWith('HELP')) {
            const parts = line.split(' ');
            if (parts.length >= 2) {
              const key = parts.slice(0, -1).join(' ');
              lines[key] = parts[parts.length - 1];
            }
          }
        }
        setMetrics(lines);
      }
    } catch { /* silent */ }
  }, [token]);

  const fetchAdminData = useCallback(async () => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const [auditResponse, pluginResponse] = await Promise.allSettled([
      fetch('/api/admin/audit-logs?limit=100', { cache: 'no-store', headers }),
      fetch('/api/admin/plugins', { cache: 'no-store', headers }),
    ]);
    if (auditResponse.status === 'fulfilled' && auditResponse.value.ok) {
      const data = await auditResponse.value.json();
      setAuditLogs(Array.isArray(data.logs) ? data.logs : []);
    }
    if (pluginResponse.status === 'fulfilled' && pluginResponse.value.ok) {
      const data = await pluginResponse.value.json();
      setPlugins(Array.isArray(data.plugins) ? data.plugins : []);
    }
  }, [token]);

  const fetchHealth = useCallback(async () => {
    try {
      const resp = await fetch('/api/health', { cache: 'no-store' });
      const data: HealthData = await resp.json();
      setHealth(data);
      if (data.status === 'healthy') setHealthColor('#22c55e');
      else if (data.status === 'degraded') setHealthColor('#f59e0b');
      else setHealthColor('#ef4444');
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMetrics();
    fetchHealth();
    void fetchAdminData();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, [fetchMetrics, fetchHealth, fetchAdminData]);

  if (!isAdmin) {
    return (
      <div className="admin-overlay">
        <div className="admin-panel" style={{ textAlign: 'center', padding: 40 }}>
          <Lock size={48} />
          <h2>Access Denied</h2>
          <p style={{ color: '#94a3b8' }}>Admin privileges required.</p>
          <button onClick={onClose} style={{ marginTop: 16, padding: '8px 24px', borderRadius: 8, border: 'none', background: '#334155', color: '#e2e8f0', cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className="admin-panel" style={{
        background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16, width: '90%', maxWidth: 900, height: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}><Shield size={18} style={{display:'inline',marginRight:6}} /> Admin Dashboard</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={logout} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>Logout</button>
            <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#334155', color: '#e2e8f0', cursor: 'pointer', fontSize: 12 }}><X size={12} /></button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 2, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          {(['metrics', 'audit', 'plugins', 'health'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: '8px 16px', borderRadius: '6px 6px 0 0', border: 'none',
                background: tab === t ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: tab === t ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 600 : 400,
              }}>
              {t === 'metrics' ? <><BarChart3 size={13} style={{display:'inline',marginRight:4}} /> Metrics</> : t === 'audit' ? <><ClipboardList size={13} style={{display:'inline',marginRight:4}} /> Audit Logs</> : t === 'plugins' ? <><Plug size={13} style={{display:'inline',marginRight:4}} /> Plugins</> : <><Heart size={13} style={{display:'inline',marginRight:4}} /> Health</>}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {tab === 'metrics' && (
            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>Prometheus Metrics</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                {metrics ? Object.entries(metrics).slice(0, 50).map(([key, val]) => (
                  <div key={key} style={{
                    background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 14px',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace', wordBreak: 'break-all' }}>{key}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#60a5fa', marginTop: 4 }}>{val}</div>
                  </div>
                )) : <div style={{ color: '#64748b', padding: 20 }}>Loading metrics...</div>}
              </div>
            </div>
          )}

          {tab === 'audit' && (
            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>Audit Logs</h3>
              {auditLogs.length === 0 ? (
                <div style={{ color: '#64748b', padding: 20, textAlign: 'center' }}>No audit events recorded.</div>
              ) : auditLogs.map(log => (
                <div key={log.id} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 6 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                    <strong style={{ color: '#e2e8f0' }}>{log.action}</strong>
                    <span style={{ color: '#64748b', fontSize: 11 }}>{log.resource || 'system'}</span>
                    <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 10 }}>{log.created_at}</span>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                    {log.user_id || 'anonymous'}{log.details ? ` · ${log.details}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'plugins' && (
            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>Plugin Manager</h3>
              {plugins.length === 0 ? (
                <div style={{ color: '#64748b', padding: 20, textAlign: 'center' }}>
                  No plugins loaded.
                </div>
              ) : (
                plugins.map(p => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 6 }}>
                    <div style={{ flex: 1 }}>
                      <strong style={{ color: '#e2e8f0' }}>{p.name}</strong>
                      <div style={{ color: '#64748b', fontSize: 10 }}>{p.version} · {p.toolCount} tools</div>
                    </div>
                    <div style={{ fontSize: 11, color: p.enabled ? '#22c55e' : '#ef4444' }}>{p.enabled ? 'Enabled' : 'Disabled'}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'health' && (
            <div>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, color: '#94a3b8' }}>System Health <span style={{ fontSize: 11, color: '#64748b' }}>(polling every 5s)</span></h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {health ? (
                  <>
                    <HealthCard label="Overall Status" value={health.status} color={healthColor} />
                    <HealthCard label="Uptime" value={`${(health.uptime_ms / 3600000).toFixed(1)}h`} color="#60a5fa" />
                    <HealthCard label="Version" value={health.version || '0.0.0'} color="#94a3b8" />
                    {Object.entries(health.checks).map(([key, val]) => (
                      <HealthCard key={key} label={key} value={val.status} color={val.status === 'ok' ? '#22c55e' : val.status === 'degraded' ? '#f59e0b' : '#ef4444'} detail={val.detail} />
                    ))}
                  </>
                ) : (
                  <div style={{ color: '#64748b' }}>Loading health data...</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HealthCard({ label, value, color, detail }: { label: string; value: string; color: string; detail?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '14px 16px',
      border: `1px solid ${color}22`,
    }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
        {value}
      </div>
      {detail && <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{detail}</div>}
    </div>
  );
}
