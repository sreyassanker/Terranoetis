import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { getToken } from '../context/AuthContext';
import { Lock, Shield, X, BarChart3, ClipboardList, Plug, Heart, Sparkles, Brain, CheckCircle, XCircle, Home, MapPin, Clock, Search, Cpu } from 'lucide-react';
import { useUserPrefStore } from '../store/userPrefStore';
import { formatISTTime, getAllTimezones } from '../lib/formatTime';

type Tab = 'home' | 'metrics' | 'audit' | 'plugins' | 'health' | 'evolution';

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

  const token = getToken();

  // Local GGUF model download state
  const [ggufStatus, setGgufStatus] = useState<{ installed: boolean; size: number; partialSize: number; download: { running: boolean; received: number; total: number; done: boolean; error?: string; percent: number; resuming?: boolean; speedBytes: number; etaSeconds: number } } | null>(null);
  const [ggufDownloading, setGgufDownloading] = useState(false);

const formatEta = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

  const fetchGgufStatus = useCallback(async () => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      const resp = await fetch('/api/admin/models/gguf-status', { cache: 'no-store', headers });
      if (resp.ok) {
        const d = await resp.json();
        setGgufStatus(d);
        // If a download is running, keep polling until done.
        if (d?.download?.running && !d?.download?.done) {
          setTimeout(fetchGgufStatus, 2000);
        }
      }
    } catch { /* silent */ }
  }, [token]);

  const startGgufDownload = useCallback(async () => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    setGgufDownloading(true);
    try {
      const resp = await fetch('/api/admin/models/gguf-download', { method: 'POST', headers });
      if (resp.ok) {
        const d = await resp.json();
        void fetchGgufStatus();
      }
    } catch { /* silent */ }
    setGgufDownloading(false);
  }, [token, fetchGgufStatus]);

  useEffect(() => {
    void fetchGgufStatus();
  }, [fetchGgufStatus]);

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
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMetrics();
    fetchHealth();
    void fetchAdminData();
    void fetchEvolution();
    const interval = setInterval(fetchHealth, 5000);
    const evoInterval = setInterval(fetchEvolution, 30000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(interval); clearInterval(evoInterval); clearInterval(clock); };
  }, [fetchMetrics, fetchHealth, fetchAdminData, fetchEvolution]);

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
          {(['home', 'metrics', 'audit', 'plugins', 'health', 'evolution'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: '8px 16px', borderRadius: '6px 6px 0 0', border: 'none',
                background: tab === t ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: tab === t ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 600 : 400,
              }}>
              {t === 'home' ? <><Home size={13} style={{display:'inline',marginRight:4}} /> Home</> : t === 'metrics' ? <><BarChart3 size={13} style={{display:'inline',marginRight:4}} /> Metrics</> : t === 'audit' ? <><ClipboardList size={13} style={{display:'inline',marginRight:4}} /> Audit Logs</> : t === 'plugins' ? <><Plug size={13} style={{display:'inline',marginRight:4}} /> Plugins</> : t === 'health' ? <><Heart size={13} style={{display:'inline',marginRight:4}} /> Health</> : <><Sparkles size={13} style={{display:'inline',marginRight:4}} /> Evolution</>}
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
                      📍 My Location
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

              {/* ── Local AI Model ── */}
              <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>
                <Cpu size={13} style={{display:'inline',marginRight:4}} /> Local AI Model (GGUF)
              </h3>
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 14, marginBottom: 20,
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                {ggufStatus?.installed ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#22c55e' }}>✅ Installed</span>
                    <span style={{ fontSize: 10, color: '#64748b' }}>{(ggufStatus.size / 1e9).toFixed(1)} GB</span>
                    <button
                      onClick={startGgufDownload}
                      style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', cursor: 'pointer', fontSize: 10 }}>
                      Re-download
                    </button>
                  </div>
                ) : (
                  <>
                    {ggufStatus?.download?.running ? (
                      <div>
                        <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 6 }}>
                          {ggufStatus.download.resuming ? '↻ Resuming…' : '⏳ Downloading…'} ({ggufStatus.download.percent}%)
                        </div>
                        <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${ggufStatus.download.percent}%`, height: '100%', background: '#60a5fa', borderRadius: 3, transition: 'width 0.5s' }} />
                        </div>
                        <div style={{ fontSize: 9, color: '#64748b', marginTop: 4, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                          <span>
                            {ggufStatus.download.percent > 0
                              ? `${(ggufStatus.download.received / 1e9).toFixed(1)} / ${(ggufStatus.download.total / 1e9).toFixed(1)} GB`
                              : 'Starting…'}
                          </span>
                          <span>
                            {ggufStatus.download.speedBytes > 0
                              ? `${(ggufStatus.download.speedBytes / 1e6).toFixed(1)} MB/s`
                              : ''}
                            {ggufStatus.download.etaSeconds > 0
                              ? ` · ~${formatEta(ggufStatus.download.etaSeconds)} left`
                              : ''}
                          </span>
                        </div>
                      </div>
                    ) : ggufStatus?.partialSize && ggufStatus.partialSize > 0 ? (
                      <div>
                        <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 6 }}>
                          ⚠ Interrupted — {(ggufStatus.partialSize / 1e9).toFixed(1)} GB downloaded so far (partial file kept for resume)
                        </div>
                        <button
                          onClick={startGgufDownload}
                          disabled={ggufDownloading}
                          style={{
                            padding: '8px 16px', borderRadius: 6, border: 'none',
                            background: ggufDownloading ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.8)',
                            color: '#fff', cursor: ggufDownloading ? 'not-allowed' : 'pointer', fontSize: 12,
                          }}>
                          {ggufDownloading ? 'Starting…' : '↻ Resume Download'}
                        </button>
                      </div>
                    ) : ggufStatus?.download?.error ? (
                      <div>
                        <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6 }}>❌ Download failed: {ggufStatus.download.error}</div>
                        <button
                          onClick={startGgufDownload}
                          disabled={ggufDownloading}
                          style={{
                            padding: '8px 16px', borderRadius: 6, border: 'none',
                            background: ggufDownloading ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.8)',
                            color: '#fff', cursor: ggufDownloading ? 'not-allowed' : 'pointer', fontSize: 12,
                          }}>
                          {ggufDownloading ? 'Starting…' : 'Retry Download'}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
                          Download the LFM 2.5 2.6B Q4_K_M GGUF model (~1.6 GB) so the local AI fallback works.
                        </div>
                        <button
                          onClick={startGgufDownload}
                          disabled={ggufDownloading}
                          style={{
                            padding: '8px 16px', borderRadius: 6, border: 'none',
                            background: ggufDownloading ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.8)',
                            color: '#fff', cursor: ggufDownloading ? 'not-allowed' : 'pointer', fontSize: 12,
                          }}>
                          {ggufDownloading ? 'Starting…' : '⬇ Download Model'}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* ── Quick access to all sections ── */}
              <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#94a3b8' }}>Dashboard Sections</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                {([
                  { key: 'metrics' as Tab, icon: <BarChart3 size={18} />, title: 'Metrics', desc: `${metrics ? Object.keys(metrics).length : '…'} Prometheus metrics` },
                  { key: 'audit' as Tab, icon: <ClipboardList size={18} />, title: 'Audit Logs', desc: `${auditLogs.length} recorded events` },
                  { key: 'plugins' as Tab, icon: <Plug size={18} />, title: 'Plugins', desc: `${plugins.length} plugins · install / remove` },
                  { key: 'health' as Tab, icon: <Heart size={18} />, title: 'Health', desc: health ? `${health.status} · ${Object.keys(health.checks).length} checks` : '…' },
                  { key: 'evolution' as Tab, icon: <Sparkles size={18} />, title: 'Evolution', desc: `${archProposals.length + intentProposals.length + ecoProposals.length} proposals` },
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>Plugin Manager</h3>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => setInstallForm(f => ({ ...f, mode: 'url' }))}
                    style={{
                      padding: '4px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                      background: installForm.mode === 'url' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                      color: installForm.mode === 'url' ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: 11,
                    }}
                  >URL</button>
                  <button
                    onClick={() => setInstallForm(f => ({ ...f, mode: 'github' }))}
                    style={{
                      padding: '4px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                      background: installForm.mode === 'github' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                      color: installForm.mode === 'github' ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: 11,
                    }}
                  >GitHub</button>
                  <button
                    onClick={() => setInstallForm(f => ({ ...f, mode: 'content' }))}
                    style={{
                      padding: '4px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                      background: installForm.mode === 'content' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                      color: installForm.mode === 'content' ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: 11,
                    }}
                  >Code</button>
                  <button
                    onClick={() => setInstallForm(f => ({ ...f, mode: 'zip' }))}
                    style={{
                      padding: '4px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                      background: installForm.mode === 'zip' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                      color: installForm.mode === 'zip' ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: 11,
                    }}
                  >Zip</button>
                </div>
              </div>

              {/* Install form */}
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12, marginBottom: 12,
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                {installForm.mode === 'url' ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="url"
                      placeholder="https://example.com/my-plugin.ts"
                      value={installForm.url}
                      onChange={e => setInstallForm(f => ({ ...f, url: e.target.value }))}
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(0,0,0,0.2)', color: '#e2e8f0', fontSize: 12, outline: 'none',
                      }}
                    />
                    <button
                      onClick={installPlugin}
                      disabled={!installForm.url}
                      style={{
                        padding: '6px 14px', borderRadius: 4, border: 'none',
                        background: installForm.url ? 'rgba(59,130,246,0.8)' : 'rgba(59,130,246,0.3)',
                        color: '#fff', cursor: installForm.url ? 'pointer' : 'not-allowed', fontSize: 12,
                      }}
                    >Install</button>
                  </div>
                ) : installForm.mode === 'github' ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="url"
                      placeholder="https://github.com/user/repo or user/repo"
                      value={installForm.url}
                      onChange={e => setInstallForm(f => ({ ...f, url: e.target.value }))}
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(0,0,0,0.2)', color: '#e2e8f0', fontSize: 12, outline: 'none',
                      }}
                    />
                    <button
                      onClick={installPlugin}
                      disabled={!installForm.url}
                      style={{
                        padding: '6px 14px', borderRadius: 4, border: 'none',
                        background: installForm.url ? 'rgba(59,130,246,0.8)' : 'rgba(59,130,246,0.3)',
                        color: '#fff', cursor: installForm.url ? 'pointer' : 'not-allowed', fontSize: 12,
                      }}
                    >Install</button>
                  </div>
                ) : installForm.mode === 'zip' ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="file" accept=".zip"
                      onChange={e => setInstallForm(f => ({ ...f, zipFile: e.target.files?.[0] || null }))}
                      style={{
                        flex: 1, padding: '4px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(0,0,0,0.2)', color: '#e2e8f0', fontSize: 12,
                      }}
                    />
                    <button
                      onClick={installPlugin}
                      disabled={!installForm.zipFile}
                      style={{
                        padding: '6px 14px', borderRadius: 4, border: 'none',
                        background: installForm.zipFile ? 'rgba(59,130,246,0.8)' : 'rgba(59,130,246,0.3)',
                        color: '#fff', cursor: installForm.zipFile ? 'pointer' : 'not-allowed', fontSize: 12,
                      }}
                    >Upload & Install</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="plugin-name.ts"
                      value={installForm.name}
                      onChange={e => setInstallForm(f => ({ ...f, name: e.target.value }))}
                      style={{
                        padding: '6px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(0,0,0,0.2)', color: '#e2e8f0', fontSize: 12, outline: 'none',
                      }}
                    />
                    <textarea
                      placeholder="Plugin source code (TypeScript/JavaScript)..."
                      value={installForm.content}
                      onChange={e => setInstallForm(f => ({ ...f, content: e.target.value }))}
                      style={{
                        width: '100%', height: 120, padding: '8px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(0,0,0,0.2)', color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace',
                        outline: 'none', resize: 'vertical',
                      }}
                    />
                    <button
                      onClick={installPlugin}
                      disabled={!installForm.name || !installForm.content}
                      style={{
                        alignSelf: 'flex-end', padding: '6px 14px', borderRadius: 4, border: 'none',
                        background: installForm.name && installForm.content ? 'rgba(59,130,246,0.8)' : 'rgba(59,130,246,0.3)',
                        color: '#fff', cursor: installForm.name && installForm.content ? 'pointer' : 'not-allowed', fontSize: 12,
                      }}
                    >Install</button>
                  </div>
                )}
                {installStatus && (
                  <div style={{ marginTop: 8, fontSize: 11, color: installStatus.startsWith('Error') ? '#ef4444' : '#22c55e' }}>
                    {installStatus}
                  </div>
                )}
              </div>

              {/* Plugin list */}
              {plugins.length === 0 ? (
                <div style={{ color: '#64748b', padding: 20, textAlign: 'center' }}>
                  No plugins loaded.
                </div>
              ) : (
                plugins.map(p => (
                  <div key={p.id || p.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 6 }}>
                    <div style={{ flex: 1 }}>
                      <strong style={{ color: '#e2e8f0' }}>{p.name}</strong>
                      <div style={{ color: '#64748b', fontSize: 10 }}>{p.version} · {p.toolCount} tools</div>
                      {p.id.startsWith('file:') && (
                        <div style={{ color: '#64748b', fontSize: 9, marginTop: 2 }}>ID: {p.id}</div>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: p.enabled ? '#22c55e' : '#ef4444' }}>{p.enabled ? 'Enabled' : 'Disabled'}</div>
                    <button
                      onClick={() => togglePlugin(p.id, !p.enabled)}
                      title={p.enabled ? 'Disable plugin' : 'Enable plugin'}
                      style={{
                        padding: '4px 8px', borderRadius: 4,
                        border: `1px solid ${p.enabled ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.4)'}`,
                        background: 'transparent', color: p.enabled ? '#ef4444' : '#22c55e', cursor: 'pointer', fontSize: 10,
                      }}
                    >{p.enabled ? 'Disable' : 'Enable'}</button>
                    {p.id.startsWith('file:') && (
                      <button
                        onClick={() => removePlugin(p.id)}
                        style={{
                          padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)',
                          background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 10,
                        }}
                        title="Remove plugin"
                      >Remove</button>
                    )}
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

          {tab === 'evolution' && (
            <div>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, color: '#94a3b8' }}>
                <Sparkles size={14} style={{display:'inline',marginRight:4}} /> Self-Improvement Evolution
              </h3>

              {/* Status cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
                <HealthCard label="Evolution Status" value={evoStatus?.active ? 'Active' : 'Standby'} color={evoStatus?.active ? '#22c55e' : '#94a3b8'} />
                <HealthCard label="Pending Proposals" value={`${evoStatus?.pendingProposals ?? evoStatus?.proposals ?? 0}`} color={evoStatus && (evoStatus.pendingProposals ?? evoStatus?.proposals ?? 0) > 0 ? '#f59e0b' : '#94a3b8'} />
                <HealthCard label="Arch. Proposals" value={`${archProposals.length}`} color={archProposals.length > 0 ? '#818cf8' : '#94a3b8'} />
                <HealthCard label="Intent Proposals" value={`${intentProposals.length}`} color={intentProposals.length > 0 ? '#a78bfa' : '#94a3b8'} />
              </div>

              {/* Architecture Proposals */}
              {archProposals.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 12, color: '#818cf8', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Brain size={12} /> Architecture Proposals
                  </h4>
                  {archProposals.slice(0, 10).map((p, i) => (
                    <div key={i} style={{
                      padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 4,
                      border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{`${p.title || p.name || `Proposal #${i + 1}`}`}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 9, display: 'flex', alignItems: 'center', gap: 3 }}>
                        {p.status === 'approved' ? <CheckCircle size={10} color="#22c55e" /> : p.status === 'rejected' ? <XCircle size={10} color="#ef4444" /> : <Sparkles size={10} color="#f59e0b" />}
                        <span style={{ color: '#94a3b8' }}>{p.status as string || 'pending'}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Intent Proposals */}
              {intentProposals.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 12, color: '#a78bfa', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Sparkles size={12} /> Intent Proposals
                  </h4>
                  {intentProposals.slice(0, 10).map((p, i) => (
                    <div key={i} style={{
                      padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 4,
                      border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{`${p.title || p.name || p.intent || `Intent #${i + 1}`}`}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 9, display: 'flex', alignItems: 'center', gap: 3 }}>
                        {p.status === 'active' ? <CheckCircle size={10} color="#22c55e" /> : p.status === 'explored' ? <CheckCircle size={10} color="#818cf8" /> : <Sparkles size={10} color="#f59e0b" />}
                        <span style={{ color: '#94a3b8' }}>{p.status as string || 'pending'}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Self-Evolution Proposals */}
              {ecoProposals.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 12, color: '#f472b6', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Sparkles size={12} /> Self-Evolution Proposals
                  </h4>
                  {ecoProposals.slice(0, 10).map((p, i) => (
                    <div key={i} style={{
                      padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 4,
                      border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{`${p.title || p.description || p.name || `Proposal #${i + 1}`}`}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: '#94a3b8' }}>{p.status as string || 'pending'}</span>
                    </div>
                  ))}
                </div>
              )}

              {!archProposals.length && !intentProposals.length && !ecoProposals.length && (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: 13 }}>
                  <Brain size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
                  <div>No evolution proposals yet</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>The self-improvement engine will generate proposals as the system learns.</div>
                </div>
              )}
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
