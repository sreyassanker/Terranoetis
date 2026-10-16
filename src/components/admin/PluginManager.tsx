import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plug,
  Play,
  Check,
  Copy,
  Trash2,
  ShieldCheck,
  Search,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Code2,
  Terminal,
  ChevronDown,
  ChevronUp,
  Globe,
  Sliders,
  CheckCircle2,
  CloudRain,
  Activity,
  Compass,
  FileCode,
  Zap,
} from 'lucide-react';

export interface PluginToolInfo {
  name: string;
  description: string;
  category: string;
  schema?: Record<string, unknown>;
  exampleArgs?: Record<string, unknown>;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  category?: string;
  toolCount: number;
  tools: PluginToolInfo[];
  enabled: boolean;
  isBuiltin: boolean;
  error?: string | null;
}

export interface CuratedTemplate {
  id: string;
  name: string;
  version: string;
  category: string;
  author: string;
  description: string;
  filename: string;
  code: string;
}

interface PluginManagerProps {
  token?: string | null;
  onPluginsChange?: () => void;
}

type ManagerTab = 'installed' | 'gallery' | 'install';
type InstallMode = 'url' | 'github' | 'code' | 'zip';

export const PluginManager: React.FC<PluginManagerProps> = ({ token, onPluginsChange }) => {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [templates, setTemplates] = useState<CuratedTemplate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [tab, setTab] = useState<ManagerTab>('installed');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedPluginId, setExpandedPluginId] = useState<string | null>(null);

  // Testing tool playground state
  const [testTool, setTestTool] = useState<{
    pluginName: string;
    tool: PluginToolInfo;
    argsJson: string;
    running: boolean;
    result: unknown | null;
    error: string | null;
    durationMs: number | null;
  } | null>(null);

  // Install custom state
  const [installMode, setInstallMode] = useState<InstallMode>('code');
  const [installUrl, setInstallUrl] = useState<string>('');
  const [installName, setInstallName] = useState<string>('custom_metric.ts');
  const [installCode, setInstallCode] = useState<string>(`// Earth Intelligence Custom Extension
module.exports = {};

module.exports.init = function(api) {
  api.log('info', 'Custom plugin active');

  api.registerTool({
    name: 'custom_analysis',
    description: 'Perform custom geospatial calculations',
    category: 'custom',
    schema: {
      factor: 'number (multiplier ratio)'
    },
    exampleArgs: {
      factor: 2.5
    },
    handler: async (args) => {
      const factor = Number(args.factor) || 1.0;
      return {
        factor,
        computedScore: factor * 42,
        timestamp: new Date().toISOString(),
        verified: true
      };
    }
  });
};
`);
  const [installZip, setInstallZip] = useState<File | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [installing, setInstalling] = useState<boolean>(false);
  const [copiedResult, setCopiedResult] = useState<boolean>(false);

  // Fetch plugins & templates
  const fetchData = useCallback(async () => {
    setLoading(true);
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      const [pluginsRes, templatesRes] = await Promise.allSettled([
        fetch('/api/admin/plugins', { cache: 'no-store', headers }),
        fetch('/api/admin/plugins/templates', { cache: 'no-store', headers }),
      ]);

      if (pluginsRes.status === 'fulfilled' && pluginsRes.value.ok) {
        const data = await pluginsRes.value.json();
        setPlugins(Array.isArray(data.plugins) ? data.plugins : []);
      }
      if (templatesRes.status === 'fulfilled' && templatesRes.value.ok) {
        const data = await templatesRes.value.json();
        setTemplates(Array.isArray(data.templates) ? data.templates : []);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Toggle Plugin
  const togglePlugin = useCallback(async (id: string, newEnabled: boolean) => {
    // Optimistic UI update
    setPlugins(prev => prev.map(p => p.id === id ? { ...p, enabled: newEnabled } : p));

    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      const resp = await fetch(`/api/admin/plugins/${encodeURIComponent(id)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (!resp.ok) {
        // Revert on failure
        setPlugins(prev => prev.map(p => p.id === id ? { ...p, enabled: !newEnabled } : p));
        alert('Could not update plugin status.');
      } else {
        if (onPluginsChange) onPluginsChange();
      }
    } catch {
      setPlugins(prev => prev.map(p => p.id === id ? { ...p, enabled: !newEnabled } : p));
    }
  }, [token, onPluginsChange]);

  // Remove Plugin
  const removePlugin = useCallback(async (id: string) => {
    if (!confirm(`Are you sure you want to remove plugin "${id}"? This will delete the plugin file.`)) return;

    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      const resp = await fetch(`/api/admin/plugins/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      if (resp.ok) {
        setPlugins(prev => prev.filter(p => p.id !== id));
        if (onPluginsChange) onPluginsChange();
      } else {
        const err = await resp.json().catch(() => ({ error: 'Remove failed' }));
        alert(`Error: ${err.error || resp.statusText}`);
      }
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    }
  }, [token, onPluginsChange]);

  // Install Curated Template
  const installTemplate = useCallback(async (template: CuratedTemplate) => {
    setInstalling(true);
    setInstallStatus(`Installing ${template.name}...`);
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

    try {
      const resp = await fetch('/api/admin/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        body: JSON.stringify({ name: template.filename, content: template.code }),
      });
      if (resp.ok) {
        setInstallStatus(`Successfully installed ${template.name}!`);
        await fetchData();
        if (onPluginsChange) onPluginsChange();
        setTimeout(() => setInstallStatus(null), 4000);
      } else {
        const err = await resp.json().catch(() => ({ error: 'Install failed' }));
        setInstallStatus(`Error: ${err.error || resp.statusText}`);
      }
    } catch (e) {
      setInstallStatus(`Error: ${(e as Error).message}`);
    } finally {
      setInstalling(false);
    }
  }, [token, fetchData, onPluginsChange]);

  // Install Custom Plugin
  const handleCustomInstall = useCallback(async () => {
    setInstalling(true);
    setInstallStatus('Installing plugin...');
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

    try {
      if (installMode === 'zip') {
        if (!installZip) {
          setInstallStatus('Error: No zip file selected.');
          setInstalling(false);
          return;
        }
        const b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(installZip);
        });
        const resp = await fetch('/api/admin/plugins/install-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(headers || {}) },
          body: JSON.stringify({ zipB64: b64 }),
        });
        const data = await resp.json();
        if (resp.ok) {
          const count = data.pluginIds?.length || 0;
          setInstallStatus(`Installed ${count} plugin(s) from zip!`);
          await fetchData();
          if (onPluginsChange) onPluginsChange();
          setTimeout(() => setInstallStatus(null), 4000);
        } else {
          setInstallStatus(`Error: ${data.error || 'Zip install failed'}`);
        }
      } else if (installMode === 'url' || installMode === 'github') {
        if (!installUrl.trim()) {
          setInstallStatus('Error: URL is required.');
          setInstalling(false);
          return;
        }
        const resp = await fetch('/api/admin/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(headers || {}) },
          body: JSON.stringify({ url: installUrl.trim() }),
        });
        const data = await resp.json();
        if (resp.ok) {
          setInstallStatus('Plugin installed successfully!');
          setInstallUrl('');
          await fetchData();
          if (onPluginsChange) onPluginsChange();
          setTimeout(() => setInstallStatus(null), 4000);
        } else {
          setInstallStatus(`Error: ${data.error || 'Install failed'}`);
        }
      } else {
        // Code mode
        if (!installName.trim() || !installCode.trim()) {
          setInstallStatus('Error: Filename and code content are required.');
          setInstalling(false);
          return;
        }
        const resp = await fetch('/api/admin/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(headers || {}) },
          body: JSON.stringify({ name: installName.trim(), content: installCode }),
        });
        const data = await resp.json();
        if (resp.ok) {
          setInstallStatus('Plugin created and loaded successfully!');
          await fetchData();
          if (onPluginsChange) onPluginsChange();
          setTimeout(() => setInstallStatus(null), 4000);
        } else {
          setInstallStatus(`Error: ${data.error || 'Code install failed'}`);
        }
      }
    } catch (e) {
      setInstallStatus(`Error: ${(e as Error).message}`);
    } finally {
      setInstalling(false);
    }
  }, [installMode, installZip, installUrl, installName, installCode, token, fetchData, onPluginsChange]);

  // Execute Tool in Playground
  const executePlaygroundTool = useCallback(async () => {
    if (!testTool) return;
    setTestTool(prev => prev ? { ...prev, running: true, error: null, result: null } : null);

    const start = performance.now();
    try {
      let parsedArgs = {};
      if (testTool.argsJson.trim()) {
        try {
          parsedArgs = JSON.parse(testTool.argsJson);
        } catch {
          throw new Error('Invalid JSON arguments in editor.');
        }
      }

      const resp = await fetch(`/api/plugin/tool/${encodeURIComponent(testTool.tool.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedArgs),
      });

      const data = await resp.json();
      const duration = Math.round(performance.now() - start);

      if (resp.ok) {
        setTestTool(prev => prev ? { ...prev, running: false, result: data, durationMs: duration } : null);
      } else {
        setTestTool(prev => prev ? { ...prev, running: false, error: data.error || `HTTP ${resp.status}`, durationMs: duration } : null);
      }
    } catch (e) {
      const duration = Math.round(performance.now() - start);
      setTestTool(prev => prev ? { ...prev, running: false, error: (e as Error).message, durationMs: duration } : null);
    }
  }, [testTool]);

  // Filtered Plugins
  const filteredPlugins = useMemo(() => {
    return plugins.filter(p => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const nameMatch = p.name.toLowerCase().includes(q);
      const descMatch = (p.description || '').toLowerCase().includes(q);
      const toolMatch = (p.tools || []).some(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
      return nameMatch || descMatch || toolMatch;
    });
  }, [plugins, searchQuery]);

  const activeCount = plugins.filter(p => p.enabled).length;

  const getCategoryIcon = (category?: string) => {
    const c = (category || '').toLowerCase();
    if (c.includes('weather') || c.includes('atmosphere')) return <CloudRain size={16} style={{ color: '#38bdf8' }} />;
    if (c.includes('seismic') || c.includes('geophysic') || c.includes('hazard')) return <Activity size={16} style={{ color: '#f87171' }} />;
    if (c.includes('geo') || c.includes('nav') || c.includes('aviation')) return <Compass size={16} style={{ color: '#4ade80' }} />;
    if (c.includes('astro') || c.includes('space')) return <Zap size={16} style={{ color: '#fbbf24' }} />;
    if (c.includes('environ') || c.includes('health') || c.includes('air') || c.includes('fire')) return <ShieldCheck size={16} style={{ color: '#34d399' }} />;
    return <Plug size={16} style={{ color: '#60a5fa' }} />;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Top Header & Tab Switcher ── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: 12,
        border: '1px solid rgba(255, 255, 255, 0.07)',
      }}>
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'installed' as ManagerTab, label: 'Installed Extensions', count: plugins.length, icon: <Plug size={14} /> },
            { id: 'gallery' as ManagerTab, label: 'Curated Gallery', count: templates.length, icon: <Sparkles size={14} /> },
            { id: 'install' as ManagerTab, label: 'Install / Code', icon: <Code2 size={14} /> },
          ].map(t => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  background: isActive ? '#2563eb' : 'rgba(255, 255, 255, 0.04)',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  border: isActive ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {t.icon}
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 10,
                    background: isActive ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)',
                    color: isActive ? '#fff' : '#cbd5e1',
                  }}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Status Pill & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            fontSize: 12,
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: activeCount > 0 ? '#22c55e' : '#64748b',
              boxShadow: activeCount > 0 ? '0 0 8px #22c55e' : 'none',
              display: 'inline-block',
            }} />
            <span><strong>{activeCount}</strong> of <strong>{plugins.length}</strong> active</span>
          </div>

          <button
            onClick={() => void fetchData()}
            disabled={loading}
            title="Refresh plugins list"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 6,
              padding: '6px 10px',
              color: '#e2e8f0',
              fontSize: 12,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            <span>Reload</span>
          </button>
        </div>
      </div>

      {/* ── TAB 1: INSTALLED PLUGINS ── */}
      {tab === 'installed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Search bar */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
            <input
              type="text"
              placeholder="Search plugins by name, description, or tool functions..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 12px 8px 34px',
                borderRadius: 8,
                fontSize: 12,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#f8fafc',
                outline: 'none',
              }}
            />
          </div>

          {/* Plugin list */}
          {filteredPlugins.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b', background: 'rgba(255,255,255,0.02)', borderRadius: 10 }}>
              No plugins found matching &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            filteredPlugins.map(p => {
              const isExpanded = expandedPluginId === p.id;
              return (
                <div
                  key={p.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: 10,
                    border: `1px solid ${p.enabled ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)'}`,
                    opacity: p.enabled ? 1 : 0.65,
                    transition: 'all 0.2s ease',
                    overflow: 'hidden',
                  }}
                >
                  {/* Card Header */}
                  <div style={{
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}>
                    {/* Left: Icon & Title & Description */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1 }}>
                      <div style={{
                        width: 38,
                        height: 38,
                        borderRadius: 8,
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 2,
                      }}>
                        {getCategoryIcon(p.category)}
                      </div>

                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>
                            {p.name}
                          </span>
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.08)', color: '#94a3b8' }}>
                            v{p.version}
                          </span>
                          {p.isBuiltin ? (
                            <span style={{
                              fontSize: 10,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: 'rgba(56, 189, 248, 0.12)',
                              border: '1px solid rgba(56, 189, 248, 0.3)',
                              color: '#38bdf8',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}>
                              <ShieldCheck size={11} />
                              Core Extension
                            </span>
                          ) : (
                            <span style={{
                              fontSize: 10,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: 'rgba(168, 85, 247, 0.12)',
                              border: '1px solid rgba(168, 85, 247, 0.3)',
                              color: '#c084fc',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}>
                              <Terminal size={11} />
                              Custom Plugin
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: '#64748b' }}>
                            by {p.author}
                          </span>
                        </div>

                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
                          {p.description}
                        </div>

                        {p.error && (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginTop: 6,
                            color: '#ef4444',
                            fontSize: 11,
                            background: 'rgba(239, 68, 68, 0.1)',
                            padding: '4px 8px',
                            borderRadius: 4,
                          }}>
                            <AlertTriangle size={13} />
                            <span>Load Error: {p.error}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions & Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {/* Expand Tools Button */}
                      <button
                        onClick={() => setExpandedPluginId(isExpanded ? null : p.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          background: isExpanded ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                          border: isExpanded ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                          color: isExpanded ? '#60a5fa' : '#cbd5e1',
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        <Sliders size={12} />
                        <span>{p.toolCount} {p.toolCount === 1 ? 'Tool' : 'Tools'}</span>
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>

                      {/* macOS / iOS Style Toggle Switch */}
                      <div
                        onClick={() => void togglePlugin(p.id, !p.enabled)}
                        title={p.enabled ? 'Click to disable extension' : 'Click to enable extension'}
                        style={{
                          width: 44,
                          height: 24,
                          borderRadius: 12,
                          background: p.enabled ? '#22c55e' : 'rgba(255, 255, 255, 0.15)',
                          position: 'relative',
                          cursor: 'pointer',
                          transition: 'background 0.2s ease',
                          boxShadow: p.enabled ? '0 0 10px rgba(34, 197, 94, 0.3)' : 'none',
                        }}
                      >
                        <div style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: '#ffffff',
                          position: 'absolute',
                          top: 3,
                          left: p.enabled ? 23 : 3,
                          transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                        }} />
                      </div>

                      {/* Remove Button for custom plugins */}
                      {!p.isBuiltin && (
                        <button
                          onClick={() => void removePlugin(p.id)}
                          title="Remove custom plugin"
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            color: '#f87171',
                            borderRadius: 6,
                            padding: '6px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable Tools List & Test Runner */}
                  {isExpanded && (
                    <div style={{
                      background: 'rgba(0, 0, 0, 0.25)',
                      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                      padding: '12px 16px',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 8, letterSpacing: '0.04em' }}>
                        AVAILABLE TOOLS &amp; NEURAL AGENT HANDLERS
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {p.tools && p.tools.length > 0 ? (
                          p.tools.map(tool => (
                            <div
                              key={tool.name}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(255, 255, 255, 0.02)',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: 6,
                                padding: '8px 12px',
                                gap: 12,
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <code style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>
                                    {tool.name}
                                  </code>
                                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#64748b' }}>
                                    {tool.category}
                                  </span>
                                </div>
                                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                                  {tool.description}
                                </div>
                                {tool.schema && Object.keys(tool.schema).length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                                    {Object.entries(tool.schema).map(([k, v]) => (
                                      <span key={k} style={{ fontSize: 9, fontFamily: 'monospace', padding: '1px 5px', borderRadius: 3, background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8' }}>
                                        {k}: {String(v)}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Test Tool Button */}
                              <button
                                onClick={() => setTestTool({
                                  pluginName: p.name,
                                  tool,
                                  argsJson: JSON.stringify(tool.exampleArgs || {}, null, 2),
                                  running: false,
                                  result: null,
                                  error: null,
                                  durationMs: null,
                                })}
                                disabled={!p.enabled}
                                title={p.enabled ? 'Test this tool live' : 'Enable plugin to test tool'}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  background: p.enabled ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                                  border: p.enabled ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                                  color: p.enabled ? '#4ade80' : '#64748b',
                                  padding: '5px 10px',
                                  borderRadius: 5,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: p.enabled ? 'pointer' : 'not-allowed',
                                }}
                              >
                                <Play size={11} />
                                <span>Test Tool</span>
                              </button>
                            </div>
                          ))
                        ) : (
                          <div style={{ fontSize: 11, color: '#64748b' }}>No tool handlers exposed by this extension.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── TAB 2: CURATED GALLERY ── */}
      {tab === 'gallery' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Production-grade geospatial and environmental intelligence extensions ready for one-click deployment:
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {templates.map(tpl => {
              const alreadyInstalled = plugins.some(p => p.id === `file:${tpl.filename}`);
              return (
                <div
                  key={tpl.id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: 10,
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>
                          {tpl.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 2 }}>
                          {tpl.category}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>
                        v{tpl.version}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8, lineHeight: 1.4 }}>
                      {tpl.description}
                    </div>

                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                      Source: {tpl.author}
                    </div>
                  </div>

                  {/* Install Action */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: 10 }}>
                    <code style={{ fontSize: 10, color: '#64748b' }}>{tpl.filename}</code>

                    {alreadyInstalled ? (
                      <span style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 11,
                        color: '#4ade80',
                        fontWeight: 600,
                      }}>
                        <CheckCircle2 size={13} />
                        Installed
                      </span>
                    ) : (
                      <button
                        onClick={() => void installTemplate(tpl)}
                        disabled={installing}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          background: '#2563eb',
                          border: 'none',
                          borderRadius: 6,
                          padding: '6px 14px',
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: installing ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <Sparkles size={12} />
                        <span>Install</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB 3: INSTALL CUSTOM EXTENSIONS ── */}
      {tab === 'install' && (
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: 10,
          border: '1px solid rgba(255, 255, 255, 0.07)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}>
          {/* Submode Switcher */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { id: 'code' as InstallMode, label: 'Live TypeScript Code', icon: <Code2 size={13} /> },
              { id: 'url' as InstallMode, label: 'Single File URL', icon: <Globe size={13} /> },
              { id: 'github' as InstallMode, label: 'GitHub Repository', icon: <FileCode size={13} /> },
              { id: 'zip' as InstallMode, label: 'Zip Archive', icon: <Terminal size={13} /> },
            ].map(m => {
              const active = installMode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setInstallMode(m.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: active ? 600 : 500,
                    background: active ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                    color: active ? '#60a5fa' : '#94a3b8',
                    border: active ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                    cursor: 'pointer',
                  }}
                >
                  {m.icon}
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* Form Inputs */}
          {installMode === 'code' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  Extension Filename (.ts)
                </label>
                <input
                  type="text"
                  value={installName}
                  onChange={e => setInstallName(e.target.value)}
                  placeholder="e.g. wildfire_smoke.ts"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8fafc',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  TypeScript / JavaScript Code
                </label>
                <textarea
                  value={installCode}
                  onChange={e => setInstallCode(e.target.value)}
                  style={{
                    width: '100%',
                    height: 220,
                    boxSizing: 'border-box',
                    padding: '10px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#e2e8f0',
                    outline: 'none',
                    lineHeight: 1.5,
                  }}
                />
              </div>
            </div>
          )}

          {installMode === 'url' && (
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                Public TypeScript Plugin URL
              </label>
              <input
                type="url"
                value={installUrl}
                onChange={e => setInstallUrl(e.target.value)}
                placeholder="https://example.com/satellite_weather.ts"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  outline: 'none',
                }}
              />
            </div>
          )}

          {installMode === 'github' && (
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                GitHub Repository or Raw Link
              </label>
              <input
                type="url"
                value={installUrl}
                onChange={e => setInstallUrl(e.target.value)}
                placeholder="https://github.com/username/terranoetis-extension"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  outline: 'none',
                }}
              />
            </div>
          )}

          {installMode === 'zip' && (
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                Select Extension Zip Bundle
              </label>
              <input
                type="file"
                accept=".zip"
                onChange={e => setInstallZip(e.target.files?.[0] || null)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                }}
              />
            </div>
          )}

          {/* Submit Button & Status */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            {installStatus && (
              <span style={{
                fontSize: 12,
                color: installStatus.startsWith('Error') ? '#ef4444' : '#22c55e',
                fontWeight: 500,
              }}>
                {installStatus}
              </span>
            )}
            <button
              onClick={() => void handleCustomInstall()}
              disabled={installing}
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#2563eb',
                border: 'none',
                borderRadius: 6,
                padding: '8px 18px',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: installing ? 'not-allowed' : 'pointer',
              }}
            >
              {installing ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plug size={13} />}
              <span>{installing ? 'Installing...' : 'Deploy Extension'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── TOOL PLAYGROUND MODAL / DRAWER ── */}
      {testTool && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 20,
        }}>
          <div style={{
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 14,
            width: '100%',
            maxWidth: 640,
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontSize: 15, fontWeight: 700, color: '#38bdf8' }}>
                    {testTool.tool.name}
                  </code>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                    {testTool.pluginName}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {testTool.tool.description}
                </div>
              </div>

              <button
                onClick={() => setTestTool(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: 18,
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  INPUT ARGUMENTS (JSON):
                </label>
                <textarea
                  value={testTool.argsJson}
                  onChange={e => setTestTool(prev => prev ? { ...prev, argsJson: e.target.value } : null)}
                  style={{
                    width: '100%',
                    height: 100,
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    background: 'rgba(0, 0, 0, 0.35)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8fafc',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Execution Result */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>
                    EXECUTION OUTPUT:
                  </span>
                  {testTool.durationMs !== null && (
                    <span style={{ fontSize: 11, color: '#4ade80' }}>
                      Latency: {testTool.durationMs} ms
                    </span>
                  )}
                </div>

                <div style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 6,
                  padding: 12,
                  minHeight: 120,
                  maxHeight: 220,
                  overflowY: 'auto',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: testTool.error ? '#f87171' : '#e2e8f0',
                }}>
                  {testTool.running ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8' }}>
                      <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
                      <span>Executing in sandbox runtime...</span>
                    </div>
                  ) : testTool.error ? (
                    <div>Error: {testTool.error}</div>
                  ) : testTool.result ? (
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {JSON.stringify(testTool.result, null, 2)}
                    </pre>
                  ) : (
                    <div style={{ color: '#64748b' }}>Click &ldquo;Run Execution&rdquo; to test tool.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              {testTool.result ? (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(testTool.result, null, 2));
                    setCopiedResult(true);
                    setTimeout(() => setCopiedResult(false), 2000);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: copiedResult ? '#4ade80' : '#cbd5e1',
                    borderRadius: 6,
                    padding: '6px 12px',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {copiedResult ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedResult ? 'Copied' : 'Copy Output'}</span>
                </button>
              ) : <div />}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setTestTool(null)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#94a3b8',
                    borderRadius: 6,
                    padding: '6px 14px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
                <button
                  onClick={() => void executePlaygroundTool()}
                  disabled={testTool.running}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#22c55e',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 16px',
                    color: '#000',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: testTool.running ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Play size={12} />
                  <span>{testTool.running ? 'Running...' : 'Run Execution'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
