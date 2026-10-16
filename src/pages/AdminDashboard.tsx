import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth, getToken, isDesktopApp } from '../context/AuthContext';
import { Lock, Shield, X, BarChart3, ClipboardList, Plug, Heart, Sparkles, Brain, CheckCircle, XCircle, Home, MapPin, Clock, Search, Cpu, RefreshCw, LogOut } from 'lucide-react';
import { useUserPrefStore } from '../store/userPrefStore';
import { formatISTTime, getAllTimezones } from '../lib/formatTime';
import { LocalAiHub } from '../components/admin/LocalAiHub';
import { MetricsDashboard } from '../components/admin/MetricsDashboard';
import { PluginManager } from '../components/admin/PluginManager';
import { EvolutionHub } from '../components/admin/EvolutionHub';

type Tab = 'home' | 'local-ai' | 'metrics' | 'audit' | 'plugins' | 'health' | 'evolution';

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
  const { isAdmin, token: authToken, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('home');
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [healthColor, setHealthColor] = useState<string>('#22c55e');
  const [evoStatus, setEvoStatus] = useState<{ active?: boolean; proposals?: number; pendingProposals?: number } | null>(null);
  const [archProposals, setArchProposals] = useState<Array<Record<string, unknown>>>([]);
  const [intentProposals, setIntentProposals] = useState<Array<Record<string, unknown>>>([]);
  const [ecoProposals, setEcoProposals] = useState<Array<Record<string, unknown>>>([]);
  const [installForm, setInstallForm] = useState<{ url: string; name: string; content: string; zipFile: File | null; mode: 'url' | 'content' | 'github' | 'zip' }>({
    url: '', name: '', content: '', zipFile: null, mode: 'url',
  });
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const { pref, setPref } = useUserPrefStore();
  const [locQuery, setLocQuery] = useState('');
  const [locSearching, setLocSearching] = useState(false);
  const [locResults, setLocResults] = useState<Array<{ lat: number; lon: number; label: string; timezone: string }>>([]);
  const [now, setNow] = useState<Date>(new Date());
  const [tzQuery, setTzQuery] = useState('');

  // Full IANA timezone list — works for every user worldwide.
  const ALL_TIMEZONES = useMemo(() => getAllTimezones(), []);
  const filteredTz = tzQuery.trim()
    ? ALL_TIMEZONES.filter(t => t.id.toLowerCase().includes(tzQuery.toLowerCase()) || t.label.toLowerCase().includes(tzQuery.toLowerCase()))
    : ALL_TIMEZONES;

  const searchLocation = useCallback(async () => {
    const q = locQuery.trim();
    if (!q || locSearching) return;
    setLocSearching(true);
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': 'Terranoetis-EarthIntelligence/3.0', 'Accept': 'application/json' },
      });
      const data = await resp.json() as Array<{ lat: string; lon: string; display_name: string }>;
      setLocResults(data.slice(0, 5).map(d => ({
        lat: parseFloat(d.lat), lon: parseFloat(d.lon), label: d.display_name.split(',')[0] + ' — ' + d.display_name.split(',').slice(-1)[0].trim(), timezone: pref.timezone,
      })));
    } catch { setLocResults([]); }
    setLocSearching(false);
  }, [locQuery, locSearching, pref.timezone]);

  // Pick a location result → update the pref (keeps current timezone until user changes it).
  const selectLocation = (r: { lat: number; lon: number; label: string }) => {
    setPref({ label: r.label, lat: r.lat, lon: r.lon });
    setLocResults([]);
    setLocQuery('');
  };

  // Use "my location" via browser geolocation.
  const useMyLocation = () => {
    if (!navigator.geolocation) { alert('Geolocation not supported'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setPref({ label: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => alert('Could not get your location — allow location access and retry.'),
      { timeout: 10000 },
    );
  };

  const token = authToken || getToken();

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

  const installPlugin = useCallback(async () => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    setInstallStatus('Installing...');

    try {
      if (installForm.mode === 'zip') {
        const zipFile = installForm.zipFile;
        if (!zipFile) { setInstallStatus('Error: No zip file selected'); return; }
        const b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(zipFile);
        });
        const resp = await fetch('/api/admin/plugins/install-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(headers || {}) },
          body: JSON.stringify({ zipB64: b64 }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Install failed' }));
          setInstallStatus(`Error: ${err.error || resp.statusText}`);
          return;
        }
        const data = await resp.json();
        const count = data.pluginIds?.length || 0;
        const errCount = data.errors?.length || 0;
        setInstallStatus(`Installed ${count} plugin(s)${errCount ? ` (${errCount} errors)` : ''}`);
      } else if (installForm.mode === 'github') {
        // Normalise shorthand: "user/repo" → "https://github.com/user/repo"
        let ghUrl = installForm.url.trim();
        if (!ghUrl.startsWith('http://') && !ghUrl.startsWith('https://')) {
          ghUrl = `https://github.com/${ghUrl.replace(/^\/+/, '')}`;
        }
        const resp = await fetch('/api/admin/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(headers || {}) },
          body: JSON.stringify({ url: ghUrl }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Install failed' }));
          setInstallStatus(`Error: ${err.error || resp.statusText}`);
          return;
        }
        const data = await resp.json();
        const count = data.pluginIds?.length || 0;
        const errCount = data.errors?.length || 0;
        setInstallStatus(`GitHub: installed ${count} plugin(s)${errCount ? ` (${errCount} errors)` : ''}`);
      } else {
        let body: Record<string, unknown>;
        if (installForm.mode === 'url') {
          body = { url: installForm.url };
        } else {
          body = { name: installForm.name, content: installForm.content };
        }
        const resp = await fetch('/api/admin/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(headers || {}) },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Install failed' }));
          setInstallStatus(`Error: ${err.error || resp.statusText}`);
          return;
        }
        const data = await resp.json();
        setInstallStatus(`Installed: ${data.pluginId || 'success'}`);
      }

      setInstallForm({ url: '', name: '', content: '', zipFile: null, mode: 'url' });
      void fetchAdminData();
      setTimeout(() => setInstallStatus(null), 5000);
    } catch (e) {
      setInstallStatus(`Error: ${String(e)}`);
    }
  }, [token, installForm, fetchAdminData]);

  const removePlugin = useCallback(async (id: string) => {
    if (!confirm(`Remove plugin "${id}"? This cannot be undone.`)) return;
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const resp = await fetch(`/api/admin/plugins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Remove failed' }));
      alert(`Error: ${err.error || resp.statusText}`);
      return;
    }
    void fetchAdminData();
  }, [token, fetchAdminData]);

  const togglePlugin = useCallback(async (id: string, enabled: boolean) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const resp = await fetch(`/api/admin/plugins/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: JSON.stringify({ enabled }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Toggle failed' }));
      alert(`Error: ${err.error || resp.statusText}`);
      return;
    }
    void fetchAdminData();
  }, [token, fetchAdminData]);

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

  const fetchEvolution = useCallback(async () => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const [statusRes, archRes, intentRes, ecoRes] = await Promise.allSettled([
      fetch('/api/self-evolution/status', { headers }),
      fetch('/api/meta/architecture-proposals', { headers }),
      fetch('/api/meta/intent-proposals', { headers }),
      fetch('/api/self-evolution/proposals', { headers }),
    ]);
    if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
      const d = await statusRes.value.json();
      // The /api/self-evolution/status endpoint returns { banditStats, drifts,
      // git, perf, proposals, pendingProposals } — it does not include an
      // `active` flag, so derive one from pending proposal activity.
      const proposals = typeof d?.proposals === 'number' ? d.proposals : 0;
      const pendingProposals = typeof d?.pendingProposals === 'number' ? d.pendingProposals : 0;
      setEvoStatus({
        active: pendingProposals > 0 || proposals > 0,
        proposals,
        pendingProposals,
      });
    }
    if (archRes.status === 'fulfilled' && archRes.value.ok) {
      const d = await archRes.value.json();
      // Endpoint returns { pending, approved, top }
      setArchProposals(Array.isArray(d) ? d : d.pending ?? d.proposals ?? d.data ?? d.all ?? []);
    }
    if (intentRes.status === 'fulfilled' && intentRes.value.ok) {
      const d = await intentRes.value.json();
      // Endpoint returns { pending, all }
      setIntentProposals(Array.isArray(d) ? d : d.pending ?? d.proposals ?? d.data ?? d.all ?? []);
    }
    if (ecoRes.status === 'fulfilled' && ecoRes.value.ok) {
      const d = await ecoRes.value.json();
      setEcoProposals(Array.isArray(d) ? d : d.proposals ?? d.data ?? []);
    }
  }, [token]);

  useEffect(() => {
    // Wrap the external fetchers and the clock tick in locally-defined
    // functions so no setState is invoked directly in the effect body
    // (matches the App.tsx clock pattern and avoids a cascading render).
    const loadAll = () => {
      void fetchMetrics();
      void fetchHealth();
      void fetchAdminData();
      void fetchEvolution();
    };
    const healthTick = () => { void fetchHealth(); };
    const evoTick = () => { void fetchEvolution(); };
    const clockTick = () => setNow(new Date());
    loadAll();
    const interval = setInterval(healthTick, 5000);
    const evoInterval = setInterval(evoTick, 30000);
    const clock = setInterval(clockTick, 1000);
    return () => { clearInterval(interval); clearInterval(evoInterval); clearInterval(clock); };
  }, [fetchMetrics, fetchHealth, fetchAdminData, fetchEvolution]);

  if (!isAdmin && !isDesktopApp) {
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
            <button
              onClick={() => {
                onClose();
                logout();
              }}
              title="Sign out of administrative session"
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid rgba(239,68,68,0.3)',
                background: 'rgba(239,68,68,0.08)',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.15s ease',
              }}
            >
              <LogOut size={13} /> Sign Out
            </button>
            <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#334155', color: '#e2e8f0', cursor: 'pointer', fontSize: 12 }}><X size={12} /></button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 2, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', overflowX: 'auto' }}>
          {(['home', 'local-ai', 'metrics', 'audit', 'plugins', 'health', 'evolution'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: '8px 14px', borderRadius: '6px 6px 0 0', border: 'none',
                background: tab === t ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: tab === t ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 600 : 400,
                whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
              }}>
              {t === 'home' ? <><Home size={13} /> Home</> :
               t === 'local-ai' ? <><Cpu size={13} style={{ color: tab === t ? '#38bdf8' : '#60a5fa' }} /> Local AI Models</> :
               t === 'metrics' ? <><BarChart3 size={13} /> Metrics</> :
               t === 'audit' ? <><ClipboardList size={13} /> Audit Logs</> :
               t === 'plugins' ? <><Plug size={13} /> Plugins</> :
               t === 'health' ? <><Heart size={13} /> Health</> :
               <><Sparkles size={13} /> Evolution</>}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {tab === 'home' && (
            <div>
              {/* ── Live location + timezone ── */}
              <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>
                <MapPin size={13} style={{display:'inline',marginRight:4}} /> Location &amp; Timezone
              </h3>
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 14, marginBottom: 20,
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>Your location:</span>
                  <div style={{ display: 'flex', flex: 1, minWidth: 220, gap: 6 }}>
                    <Search size={13} style={{ alignSelf: 'center', color: '#64748b' }} />
                    <input
                      value={locQuery}
                      onChange={e => setLocQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void searchLocation(); }}
                      placeholder="Search a city / region (e.g. Delhi, Punjab, Tokyo)"
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(0,0,0,0.2)', color: '#e2e8f0', fontSize: 12, outline: 'none',
                      }}
                    />
                    <button onClick={() => void searchLocation()} disabled={locSearching}
                      style={{ padding: '6px 12px', borderRadius: 4, border: 'none', background: 'rgba(59,130,246,0.8)', color: '#fff', cursor: 'pointer', fontSize: 12 }}>
                      {locSearching ? '…' : 'Search'}
                    </button>
                    <button onClick={useMyLocation} title="Use my current location"
                      style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.1)', color: '#34d399', cursor: 'pointer', fontSize: 12 }}>
                      [LOC] My Location
                    </button>
                  </div>
                </div>
                {locResults.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {locResults.map((r, i) => (
                      <button key={i} onClick={() => selectLocation(r)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', marginBottom: 3, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 5, color: '#e2e8f0', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <Clock size={13} style={{ color: '#64748b' }} />
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>Timezone:</span>
                  <input
                    value={tzQuery}
                    onChange={e => setTzQuery(e.target.value)}
                    placeholder="Search timezone (e.g. Shanghai, Moscow, UTC−3)"
                    style={{
                      flex: 1, minWidth: 180, padding: '6px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(0,0,0,0.2)', color: '#e2e8f0', fontSize: 12, outline: 'none',
                    }}
                  />
                  <select
                    value={pref.timezone}
                    onChange={e => { setPref({ timezone: e.target.value }); setTzQuery(''); }}
                    style={{
                      flex: 1, minWidth: 260, padding: '6px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(0,0,0,0.3)', color: '#e2e8f0', fontSize: 12, outline: 'none',
                    }}>
                    {filteredTz.map(tz => (
                      <option key={tz.id} value={tz.id}>
                        {tz.offset} — {tz.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                  Active location: <strong style={{ color: '#60a5fa' }}>{pref.label}</strong> · {pref.lat.toFixed(4)}, {pref.lon.toFixed(4)} · Now: <strong style={{ color: '#34d399' }}>{formatISTTime(now)} ({pref.timezone})</strong>
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                  All timestamps across the app (chat, reports, panels) now follow this timezone.
                </div>
              </div>

              {/* ── Quick access to all sections ── */}
              <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>Dashboard Sections</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                {([
                  { key: 'local-ai' as Tab, icon: <Cpu size={18} />, title: 'Local AI Models', desc: 'On-device GGUF models, Hugging Face Hub, Metal GPU' },
                  { key: 'metrics' as Tab, icon: <BarChart3 size={18} />, title: 'Metrics', desc: metrics ? `${Object.keys(metrics).length} Prometheus metrics active` : 'Collecting Prometheus telemetry…' },
                  { key: 'audit' as Tab, icon: <ClipboardList size={18} />, title: 'Audit Logs', desc: `${auditLogs.length} recorded audit events` },
                  { key: 'plugins' as Tab, icon: <Plug size={18} />, title: 'Plugins', desc: `${plugins.length} active plugins · install / remove` },
                  { key: 'health' as Tab, icon: <Heart size={18} />, title: 'Health', desc: health ? `${health.status.toUpperCase()} · ${Object.keys(health.checks).length} subsystem checks` : 'System health check in progress…' },
                  { key: 'evolution' as Tab, icon: <Sparkles size={18} />, title: 'Evolution', desc: `${archProposals.length + intentProposals.length + ecoProposals.length} active proposals` },
                ]).map(c => (
                  <button key={c.key} onClick={() => setTab(c.key)}
                    style={{
                      textAlign: 'left', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.07)', color: '#e2e8f0', cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                    <span style={{ color: '#60a5fa' }}>{c.icon}</span>
                    <strong style={{ fontSize: 14 }}>{c.title}</strong>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{c.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'local-ai' && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Cpu size={18} style={{ color: '#38bdf8' }} />
                  <span>On-Device Local AI &amp; Hugging Face Hub</span>
                </h2>
                <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                  Discover, download, and run privacy-preserving local GGUF models directly on your hardware with Metal GPU acceleration.
                </p>
              </div>
              <LocalAiHub token={token} />
            </div>
          )}

          {tab === 'metrics' && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BarChart3 size={18} style={{ color: '#38bdf8' }} />
                  <span>Telemetry &amp; Prometheus Metrics</span>
                </h2>
                <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                  Live runtime performance, V8 memory allocation, event loop latency distribution, and open metrics exposition.
                </p>
              </div>
              <MetricsDashboard
                token={token}
                initialMetrics={metrics || undefined}
                onMetricsUpdate={(m) => setMetrics(m)}
              />
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
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Plug size={18} style={{ color: '#38bdf8' }} />
                  <span>Geospatial Extensions &amp; Plugin Ecosystem</span>
                </h2>
                <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                  Manage modular domain extensions, test neural tool handlers in the live sandbox playground, and deploy custom intelligence algorithms.
                </p>
              </div>
              <PluginManager token={token} onPluginsChange={fetchAdminData} />
            </div>
          )}

          {tab === 'health' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Heart size={16} style={{ color: healthColor }} />
                    <span>System Health &amp; Runtime Subsystems</span>
                  </h3>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    Live empirical health diagnostics (polling every 5s)
                  </span>
                </div>

                <button
                  onClick={() => void fetchHealth()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <RefreshCw size={13} />
                  <span>Re-check Now</span>
                </button>
              </div>

              {health ? (
                <>
                  {/* Category 1: Core Platform */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                      Core Platform &amp; Host Telemetry
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
                      <HealthCard label="Overall Status" value={health.status} color={healthColor} detail={health.status === 'healthy' ? 'All critical subsystems nominal' : 'Some non-critical subsystems need attention'} />
                      <HealthCard label="Uptime" value={`${(health.uptime_ms / 3600000).toFixed(1)}h`} color="#60a5fa" detail={`Uptime ${(health.uptime_ms / 1000).toFixed(0)}s`} />
                      <HealthCard label="Release Version" value={`v${health.version || '3.0.0'}`} color="#38bdf8" detail="Production Desktop Engine" />
                      {health.checks.db && (
                        <HealthCard label="Database (SQLite)" value={health.checks.db.status} color={getCheckColor(health.checks.db.status)} detail={health.checks.db.detail || 'Connected'} />
                      )}
                      {health.checks.memory && (
                        <HealthCard label="System Memory" value={health.checks.memory.status} color={getCheckColor(health.checks.memory.status)} detail={health.checks.memory.detail} />
                      )}
                    </div>
                  </div>

                  {/* Category 2: Cognitive AI Engines */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                      Cognitive Architecture &amp; Intelligence Engines
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
                      {['reflex', 'forks', 'dream', 'entropy', 'discovery'].map(key => {
                        const chk = health.checks[key];
                        if (!chk) return null;
                        const titleMap: Record<string, string> = {
                          reflex: 'Reflex Engine',
                          forks: 'Fork Manager',
                          dream: 'Dream Engine',
                          entropy: 'Entropy Mixer',
                          discovery: 'Intent Discovery',
                        };
                        return (
                          <HealthCard
                            key={key}
                            label={titleMap[key] || key}
                            value={chk.status}
                            color={getCheckColor(chk.status)}
                            detail={chk.detail || (chk.status === 'ok' ? 'Engine Active' : 'Offline')}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Category 3: Communications & External Services */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                      Services &amp; Integrations
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
                      {health.checks.pubsub && (
                        <HealthCard label="Event Bus (PubSub)" value={health.checks.pubsub.status} color={getCheckColor(health.checks.pubsub.status)} detail={health.checks.pubsub.detail || 'In-process loopback active'} />
                      )}
                      {health.checks.redis && (
                        <HealthCard
                          label="Cluster Cache (Redis)"
                          value={health.checks.redis.status === 'standby' ? 'Standby' : health.checks.redis.status}
                          color={getCheckColor(health.checks.redis.status)}
                          detail={health.checks.redis.detail || 'In-memory fallback active'}
                        />
                      )}
                      {health.checks.gemini && (
                        <HealthCard
                          label="Google Gemini Cloud"
                          value={health.checks.gemini.status === 'not_configured' ? 'Optional / Unset' : health.checks.gemini.status}
                          color={getCheckColor(health.checks.gemini.status)}
                          detail={health.checks.gemini.detail || (health.checks.gemini.status === 'not_configured' ? 'Key unset in Settings' : 'Cloud LLM Provider')}
                        />
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ color: '#64748b', padding: 30, textAlign: 'center' }}>Loading system health diagnostics...</div>
              )}
            </div>
          )}

          {tab === 'evolution' && (
            <EvolutionHub token={token} onDataChange={() => { void fetchAdminData(); void fetchEvolution(); }} />
          )}
        </div>
      </div>
    </div>
  );
}

function getCheckColor(status: string) {
  if (status === 'ok' || status === 'healthy') return '#22c55e';
  if (status === 'standby') return '#38bdf8';
  if (status === 'not_configured') return '#a78bfa';
  if (status === 'degraded') return '#f59e0b';
  return '#ef4444';
}

function HealthCard({ label, value, color, detail }: { label: string; value: string; color: string; detail?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '14px 16px',
      border: `1px solid ${color}33`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: color === '#22c55e' ? '0 0 8px #22c55e' : 'none' }} />
        <span style={{ textTransform: 'capitalize' }}>{value}</span>
      </div>
      {detail && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.3 }}>{detail}</div>}
    </div>
  );
}
