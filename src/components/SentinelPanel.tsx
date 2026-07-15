/**
 * SentinelPanel — Automated Monitoring & Alert Management
 *
 * Shows active watch zones, alert history, and allows creating/editing zones.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Trash2, RefreshCw, CheckCircle, X } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { SEVERITY_COLORS, formatTimeAgo, SeverityIcon } from '@/lib/constants';

interface WatchZone {
  id: string;
  name: string;
  bbox_min_lat: number;
  bbox_max_lat: number;
  bbox_min_lon: number;
  bbox_max_lon: number;
  layers: string[];
  thresholds: Record<string, number>;
  poll_interval_ms: number;
  enabled: boolean;
  composite_score?: number;
  created_at: string;
}

interface SentinelAlert {
  alert_id: string;
  title: string;
  body: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  lat?: number;
  lon?: number;
  type?: string;
  created_at: string;
}

interface DashboardStats {
  totalZones: number;
  totalAlerts: number;
  criticalAlerts: number;
  avgRisk: number;
}

interface SentinelPanelProps {
  onClose: () => void;
}

const LAYER_OPTIONS = [
  { id: 'earthquakes', label: 'Earthquakes' },
  { id: 'weather', label: 'Weather' },
  { id: 'wildfires', label: 'Wildfires' },
  { id: 'floods', label: 'Floods' },
  { id: 'firms_fires', label: 'FIRMS Fires' },
  { id: 'air_quality', label: 'Air Quality' },
  { id: 'storms', label: 'Tropical Storms' },
];

export default function SentinelPanel({ onClose }: SentinelPanelProps) {
  const [zones, setZones] = useState<WatchZone[]>([]);
  const [alerts, setAlerts] = useState<SentinelAlert[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ totalZones: 0, totalAlerts: 0, criticalAlerts: 0, avgRisk: 0 });
  const [activeTab, setActiveTab] = useState<'zones' | 'alerts' | 'create'>('zones');
  const [loading, setLoading] = useState(true);
  const [newZone, setNewZone] = useState({
    name: '',
    bbox_min_lat: 30,
    bbox_max_lat: 40,
    bbox_min_lon: -120,
    bbox_max_lon: -110,
    layers: ['earthquakes', 'weather'] as string[],
    poll_interval_ms: 300000,
  });

  const fetchDashboard = useCallback(async () => {
    try {
      const resp = await fetch('/api/dashboard/state');
      if (resp.ok) {
        const data = await resp.json();
        setZones(data.zones || []);
        setAlerts(data.alerts || []);
        setStats(data.stats || { totalZones: 0, totalAlerts: 0, criticalAlerts: 0, avgRisk: 0 });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const createZone = async () => {
    if (!newZone.name) return;
    try {
      const resp = await fetch('/api/watch-zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newZone),
      });
      if (resp.ok) {
        setNewZone({
          name: '',
          bbox_min_lat: 30, bbox_max_lat: 40,
          bbox_min_lon: -120, bbox_max_lon: -110,
          layers: ['earthquakes', 'weather'],
          poll_interval_ms: 300000,
        });
        setActiveTab('zones');
        fetchDashboard();
      }
    } catch {
      // ignore
    }
  };

  const deleteZone = async (id: string) => {
    try {
      await fetch(`/api/watch-zones/${id}`, { method: 'DELETE' });
      fetchDashboard();
    } catch {
      // ignore
    }
  };

  const toggleZone = async (zone: WatchZone) => {
    try {
      await fetch(`/api/watch-zones/${zone.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !zone.enabled }),
      });
      fetchDashboard();
    } catch {
      // ignore
    }
  };

  const formatInterval = (ms: number) => {
    if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
    if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 1000)}s`;
  };

  return (
    <Panel
      title="SENTINEL"
      icon={<Shield size={16} />}
      accentColor="#ef4444"
      iconColor="#f87171"
      titleColor="#fca5a5"
      onClose={onClose}
      style={{ position: 'fixed', top: 50, right: 10, zIndex: 110, width: 380, maxHeight: 'calc(100vh - 80px)' }}
    >
      {/* Stats Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#60a5fa' }}>{stats.totalZones}</div>
          <div style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase' }}>Zones</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b' }}>{stats.totalAlerts}</div>
          <div style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase' }}>Alerts</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>{stats.criticalAlerts}</div>
          <div style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase' }}>Critical</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{Math.round(stats.avgRisk)}</div>
          <div style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase' }}>Avg Risk</div>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {(['zones', 'alerts', 'create'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            flex: 1, padding: '8px 0', fontSize: 10, fontWeight: 600, textTransform: 'capitalize',
            background: activeTab === tab ? 'rgba(239,68,68,0.15)' : 'transparent',
            border: 'none', borderBottom: activeTab === tab ? '2px solid #ef4444' : '2px solid transparent',
            color: activeTab === tab ? '#f87171' : '#64748b', cursor: 'pointer',
          }}>
            {tab === 'zones' ? `Zones (${zones.length})` : tab === 'alerts' ? `Alerts (${alerts.length})` : '+ Create'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '8px 12px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
            <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ marginTop: 8, fontSize: 10 }}>Loading...</div>
          </div>
        ) : activeTab === 'zones' ? (
          zones.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 11 }}>
              <Shield size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
              <div>No watch zones configured</div>
              <div style={{ fontSize: 9, marginTop: 4 }}>Create a zone to start monitoring</div>
            </div>
          ) : (
            zones.map(zone => (
              <div key={zone.id} style={{
                padding: '10px 12px', marginBottom: 6, borderRadius: 8,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                borderLeft: `3px solid ${zone.composite_score && zone.composite_score > 50 ? '#ef4444' : zone.composite_score && zone.composite_score > 25 ? '#f59e0b' : '#22c55e'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: zone.enabled ? '#22c55e' : '#64748b',
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{zone.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                    background: zone.composite_score && zone.composite_score > 50 ? 'rgba(239,68,68,0.2)' : zone.composite_score && zone.composite_score > 25 ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)',
                    color: zone.composite_score && zone.composite_score > 50 ? '#ef4444' : zone.composite_score && zone.composite_score > 25 ? '#f59e0b' : '#22c55e',
                  }}>
                    {Math.round(zone.composite_score ?? 0)}
                  </span>
                </div>
                <div style={{ fontSize: 9, color: '#64748b', marginBottom: 4 }}>
                  {zone.bbox_min_lat.toFixed(1)}°–{zone.bbox_max_lat.toFixed(1)}° lat, {zone.bbox_min_lon.toFixed(1)}°–{zone.bbox_max_lon.toFixed(1)}° lon
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  {zone.layers.map(l => (
                    <span key={l} style={{
                      fontSize: 8, padding: '2px 6px', borderRadius: 3,
                      background: 'rgba(96,165,250,0.15)', color: '#60a5fa',
                    }}>
                      {LAYER_OPTIONS.find(o => o.id === l)?.label ?? l}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 8, color: '#64748b' }}>Poll: {formatInterval(zone.poll_interval_ms)}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button onClick={() => toggleZone(zone)} style={{
                      fontSize: 8, padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: zone.enabled ? 'rgba(34,197,94,0.2)' : 'rgba(100,116,139,0.2)',
                      color: zone.enabled ? '#22c55e' : '#94a3b8',
                    }}>
                      {zone.enabled ? 'Active' : 'Paused'}
                    </button>
                    <button onClick={() => deleteZone(zone.id)} style={{
                      fontSize: 8, padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                    }}>
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )
        ) : activeTab === 'alerts' ? (
          alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 11 }}>
              <CheckCircle size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
              <div>No active alerts</div>
              <div style={{ fontSize: 9, marginTop: 4 }}>All clear across monitored zones</div>
            </div>
          ) : (
            alerts.map(alert => (
              <div key={alert.alert_id} style={{
                padding: '10px 12px', marginBottom: 6, borderRadius: 8,
                background: `${SEVERITY_COLORS[alert.severity] || '#6b7280'}08`,
                border: `1px solid ${SEVERITY_COLORS[alert.severity] || '#6b7280'}22`,
                borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity] || '#6b7280'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ color: SEVERITY_COLORS[alert.severity] || '#6b7280' }}>
                    <SeverityIcon severity={alert.severity} />
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{alert.title}</span>
                  <span style={{ fontSize: 8, color: '#64748b' }}>{formatTimeAgo(alert.created_at)}</span>
                </div>
                <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.4 }}>{alert.body}</div>
              </div>
            ))
          )
        ) : (
          /* Create Zone Form */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Zone Name</label>
              <input value={newZone.name} onChange={e => setNewZone(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Pacific Northwest"
                style={{ width: '100%', padding: '6px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <label style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Min Lat</label>
                <input type="number" value={newZone.bbox_min_lat} onChange={e => setNewZone(p => ({ ...p, bbox_min_lat: parseFloat(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Max Lat</label>
                <input type="number" value={newZone.bbox_max_lat} onChange={e => setNewZone(p => ({ ...p, bbox_max_lat: parseFloat(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Min Lon</label>
                <input type="number" value={newZone.bbox_min_lon} onChange={e => setNewZone(p => ({ ...p, bbox_min_lon: parseFloat(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Max Lon</label>
                <input type="number" value={newZone.bbox_max_lon} onChange={e => setNewZone(p => ({ ...p, bbox_max_lon: parseFloat(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Layers to Monitor</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {LAYER_OPTIONS.map(opt => (
                  <button key={opt.id} onClick={() => {
                    setNewZone(p => ({
                      ...p,
                      layers: p.layers.includes(opt.id) ? p.layers.filter(l => l !== opt.id) : [...p.layers, opt.id],
                    }));
                  }} style={{
                    fontSize: 9, padding: '4px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: newZone.layers.includes(opt.id) ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.05)',
                    color: newZone.layers.includes(opt.id) ? '#60a5fa' : '#64748b',
                  }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Poll Interval</label>
              <select value={newZone.poll_interval_ms} onChange={e => setNewZone(p => ({ ...p, poll_interval_ms: parseInt(e.target.value) }))}
                style={{ width: '100%', padding: '6px 10px', fontSize: 11, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' }}>
                <option value={60000}>1 minute</option>
                <option value={300000}>5 minutes</option>
                <option value={600000}>10 minutes</option>
                <option value={1800000}>30 minutes</option>
                <option value={3600000}>1 hour</option>
              </select>
            </div>
            <button onClick={createZone} disabled={!newZone.name} style={{
              padding: '8px 16px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', cursor: newZone.name ? 'pointer' : 'not-allowed',
              background: newZone.name ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'rgba(255,255,255,0.05)',
              color: '#fff', opacity: newZone.name ? 1 : 0.5,
            }}>
              <Plus size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Create Watch Zone
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
