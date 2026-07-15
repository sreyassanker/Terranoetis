import React, { useState, useMemo } from 'react';
import {
  Shield, Radio, Globe, Network, Crosshair, Target, Zap, AlertTriangle,
  Clock, Eye, Radar, Satellite, Activity, TrendingUp, Database, Bell
} from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { SEVERITY_COLORS, SEVERITY_BG } from '@/lib/constants';

interface ModuleStatus {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  enabled: boolean;
  itemCount: number;
  category: 'force' | 'fires' | 'intel' | 'support';
}

// Threat data types from App.tsx
interface ThreatItem {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  type: string;
  severity: string;
  [key: string]: unknown;
}

interface NuclearEvent {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: string;
  severity: string;
  radiation: number;
}

interface MilitaryDashboardProps {
  modules: ModuleStatus[];
  onToggleModule: (id: string) => void;
  onClose: () => void;
  // Threat data for alert correlation
  tewaThreats?: ThreatItem[];
  ewThreats?: ThreatItem[];
  maritimeThreats?: ThreatItem[];
  cyberThreats?: ThreatItem[];
  fpThreats?: ThreatItem[];
  nuclearEvents?: NuclearEvent[];
  airDefenseTracks?: Array<{ id: string; threat: string; [key: string]: unknown }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  force: 'Force Management',
  fires: 'Fires & Targeting',
  intel: 'Intelligence',
  support: 'Support & Logistics'
};

const CATEGORY_COLORS: Record<string, string> = {
  force: '#3b82f6',
  fires: '#ef4444',
  intel: '#8b5cf6',
  support: '#22c55e'
};

// Cross-module data flow definitions
const DATA_FLOWS = [
  { from: 'bft', to: 'cop', label: 'Position Data', description: 'Blue force locations feed COP' },
  { from: 'cop', to: 'orbat', label: 'Unit Status', description: 'COP updates ORBAT hierarchy' },
  { from: 'targeting', to: 'cde', label: 'Target List', description: 'Targets feed CDE assessment' },
  { from: 'targeting', to: 'fires', label: 'Fire Missions', description: 'Targeting generates fire missions' },
  { from: 'tewa', to: 'airDefense', label: 'Threat Priorities', description: 'TEWA feeds air defense priorities' },
  { from: 'airDefense', to: 'tewa', label: 'Track Data', description: 'Air defense tracks inform TEWA' },
  { from: 'isr', to: 'targeting', label: 'ISR Products', description: 'ISR feeds targeting cycle' },
  { from: 'maritime', to: 'cop', label: 'Maritime Tracks', description: 'Vessel positions feed COP' },
  { from: 'dataLinks', to: 'cop', label: 'Link Messages', description: 'Data link messages update COP' },
  { from: 'ew', to: 'tewa', label: 'EW Detections', description: 'EW detects feed TEWA analysis' },
  { from: 'cyber', to: 'forceProtection', label: 'Cyber Threats', description: 'Cyber threats inform force protection' },
  { from: 'nuclear', to: 'hadr', label: 'CBRN Events', description: 'Nuclear events trigger HADR response' },
  { from: 'wargaming', to: 'missionPlanning', label: 'COA Routes', description: 'Wargaming generates mission routes' },
  { from: 'aar', to: 'wargaming', label: 'After Action', description: 'AAR data improves wargaming models' },
  { from: 'geoint', to: 'targeting', label: 'GEOINT Products', description: 'Change detection feeds targeting' },
  { from: 'missionPlanning', to: 'bft', label: 'Routes', description: 'Planned routes sent to blue forces' },
];

// Cross-module alert correlation rules
// Maps a threat source module to affected downstream modules with recommended actions
const ALERT_RULES: Array<{
  id: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  sourceModule: string;
  sourceField: string;
  affectedModules: string[];
  correlationType: 'cascade' | 'mutual' | 'independent';
  description: string;
  action: string;
}> = [
  {
    id: 'tewa-airdefense',
    name: 'Air Threat Cascade',
    severity: 'high',
    sourceModule: 'tewa',
    sourceField: 'tewaThreats',
    affectedModules: ['airDefense', 'ew', 'cop'],
    correlationType: 'cascade',
    description: 'TEWA threat detection triggers air defense activation and EW posture adjustment',
    action: 'Activate air defense sectors, alert EW operators',
  },
  {
    id: 'ew-tewa',
    name: 'EW Detection Correlation',
    severity: 'medium',
    sourceModule: 'ew',
    sourceField: 'ewThreats',
    affectedModules: ['tewa', 'airDefense', 'targeting'],
    correlationType: 'cascade',
    description: 'EW threat detections feed TEWA analysis and may indicate targeting opportunities',
    action: 'Update TEWA threat board, consider ISR tasking',
  },
  {
    id: 'cyber-fp',
    name: 'Cyber→Force Protection',
    severity: 'high',
    sourceModule: 'cyber',
    sourceField: 'cyberThreats',
    affectedModules: ['fp', 'dataLinks', 'cop'],
    correlationType: 'cascade',
    description: 'Cyber threats may compromise force protection posture and data link integrity',
    action: 'Elevate FP status, verify data link encryption',
  },
  {
    id: 'maritime-cop',
    name: 'Maritime Alert→COP',
    severity: 'medium',
    sourceModule: 'maritime',
    sourceField: 'maritimeThreats',
    affectedModules: ['cop', 'airDefense', 'targeting'],
    correlationType: 'cascade',
    description: 'Maritime threats update COP and may require air/land response',
    action: 'Update COP tracks, assess targeting options',
  },
  {
    id: 'nuclear-hadr',
    name: 'CBRN Event→HADR',
    severity: 'critical',
    sourceModule: 'nuclear',
    sourceField: 'nuclearEvents',
    affectedModules: ['hadr', 'fp', 'cop', 'missionPlanning'],
    correlationType: 'cascade',
    description: 'Nuclear/CBRN events trigger HADR response and force protection measures',
    action: 'Activate HADR protocols, evacuate affected areas',
  },
  
  
  {
    id: 'fp-cyber',
    name: 'FP Threat→Cyber Check',
    severity: 'medium',
    sourceModule: 'fp',
    sourceField: 'fpThreats',
    affectedModules: ['cyber', 'cop', 'dataLinks'],
    correlationType: 'mutual',
    description: 'Force protection threats may have cyber dimensions',
    action: 'Cross-reference with cyber threat intelligence',
  },
  
  
];

interface Alert {
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  sourceModule: string;
  sourceModuleName: string;
  affectedModules: string[];
  affectedModuleNames: string[];
  description: string;
  action: string;
  threatCount: number;
  correlationType: string;
}



export function MilitaryDashboard({
  modules, onToggleModule, onClose,
  tewaThreats = [], ewThreats = [], maritimeThreats = [],
  cyberThreats = [], fpThreats = [], nuclearEvents = [],
  airDefenseTracks = [],
}: MilitaryDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'flows' | 'modules' | 'alerts'>('overview');
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  const [highlightedModules, setHighlightedModules] = useState<Set<string>>(new Set());
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);

  // Map module IDs to names for display
  const moduleMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of modules) map[m.id] = m.name;
    return map;
  }, [modules]);

  // Compute active alerts based on threat data
  const activeAlerts = useMemo(() => {
    const alerts: Alert[] = [];
    for (const rule of ALERT_RULES) {
      let threatCount = 0;
      switch (rule.sourceField) {
        case 'tewaThreats': threatCount = tewaThreats.length; break;
        case 'ewThreats': threatCount = ewThreats.length; break;
        case 'maritimeThreats': threatCount = maritimeThreats.length; break;
        case 'cyberThreats': threatCount = cyberThreats.length; break;
        case 'fpThreats': threatCount = fpThreats.length; break;
        case 'nuclearEvents': threatCount = nuclearEvents.length; break;
        case 'targetList': threatCount = 0; break; // Not passed as prop
        case 'isrAssets': threatCount = 0; break; // Not passed as prop
        case 'wargameScenarios': threatCount = 0; break; // Not passed as prop
        case 'geointChanges': threatCount = 0; break; // Not passed as prop
      }
      // Also check airDefense tracks with threat field
      if (rule.sourceField === 'tewaThreats' && airDefenseTracks.length > 0) {
        threatCount = Math.max(threatCount, airDefenseTracks.filter(t => t.threat !== 'none').length);
      }
      if (threatCount > 0) {
        alerts.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          sourceModule: rule.sourceModule,
          sourceModuleName: moduleMap[rule.sourceModule] || rule.sourceModule,
          affectedModules: rule.affectedModules,
          affectedModuleNames: rule.affectedModules.map(m => moduleMap[m] || m),
          description: rule.description,
          action: rule.action,
          threatCount,
          correlationType: rule.correlationType,
        });
      }
    }
    return alerts.sort((a, b) => {
      const sev: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return sev[a.severity] - sev[b.severity];
    });
  }, [tewaThreats, ewThreats, maritimeThreats, cyberThreats, fpThreats, nuclearEvents, airDefenseTracks, moduleMap]);

  // Modules with active threats (for visual indicators)
  const modulesWithThreats = useMemo(() => {
    const set = new Set<string>();
    for (const alert of activeAlerts) {
      set.add(alert.sourceModule);
      for (const m of alert.affectedModules) set.add(m);
    }
    return set;
  }, [activeAlerts]);

  const handleAlertHover = (alert: Alert | null) => {
    if (!alert) {
      setHighlightedModules(new Set());
      return;
    }
    const affected = new Set<string>(alert.affectedModules);
    affected.add(alert.sourceModule);
    setHighlightedModules(affected);
  };

  const enabledCount = modules.filter(m => m.enabled).length;
  const totalItems = modules.reduce((sum, m) => sum + m.itemCount, 0);
  const categoryStats = Object.keys(CATEGORY_LABELS).map(cat => ({
    id: cat,
    label: CATEGORY_LABELS[cat],
    color: CATEGORY_COLORS[cat],
    modules: modules.filter(m => m.category === cat),
    enabled: modules.filter(m => m.category === cat && m.enabled).length,
    total: modules.filter(m => m.category === cat).length,
  }));

  const alertCountBySeverity = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const a of activeAlerts) counts[a.severity]++;
    return counts;
  }, [activeAlerts]);

  return (
    <div data-panel="military" style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 70, paddingBottom: 60, paddingLeft: 10, paddingRight: 10, position: 'fixed', inset: 0, zIndex: 999, pointerEvents: 'none' }}>
    <div style={{ pointerEvents: 'auto', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', width: 640, maxWidth: '100%' }}>
    <Panel title="Military Operations Dashboard" onClose={onClose}>
      {/* Tab Navigation */}
      <div className="flex gap-1 mb-4">
        {(['overview', 'flows', 'modules', 'alerts'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs rounded font-medium transition-colors relative ${
              activeTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {tab === 'alerts' && <Bell size={12} className="inline mr-1" />}
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'alerts' && activeAlerts.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {activeAlerts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-slate-800 rounded p-3 text-center">
              <div className="text-xs text-slate-400">Modules</div>
              <div className="text-2xl font-bold text-blue-400">{enabledCount}/{modules.length}</div>
            </div>
            <div className="bg-slate-800 rounded p-3 text-center">
              <div className="text-xs text-slate-400">Total Items</div>
              <div className="text-2xl font-bold text-purple-400">{totalItems}</div>
            </div>
            <div className="bg-slate-800 rounded p-3 text-center">
              <div className="text-xs text-slate-400">Data Flows</div>
              <div className="text-2xl font-bold text-cyan-400">{DATA_FLOWS.length}</div>
            </div>
            <div className="bg-slate-800 rounded p-3 text-center">
              <div className="text-xs text-slate-400">Alerts</div>
              <div className={`text-2xl font-bold ${activeAlerts.length > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {activeAlerts.length}
              </div>
            </div>
          </div>

          {/* Active Alert Summary */}
          {activeAlerts.length > 0 && (
            <div className="bg-slate-800 rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-amber-400" />
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Active Correlations</span>
              </div>
              <div className="flex gap-2">
                {alertCountBySeverity.critical > 0 && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: SEVERITY_BG.critical, color: SEVERITY_COLORS.critical }}>
                    {alertCountBySeverity.critical} Critical
                  </span>
                )}
                {alertCountBySeverity.high > 0 && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: SEVERITY_BG.high, color: SEVERITY_COLORS.high }}>
                    {alertCountBySeverity.high} High
                  </span>
                )}
                {alertCountBySeverity.medium > 0 && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: SEVERITY_BG.medium, color: SEVERITY_COLORS.medium }}>
                    {alertCountBySeverity.medium} Medium
                  </span>
                )}
                {alertCountBySeverity.low > 0 && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: SEVERITY_BG.low, color: SEVERITY_COLORS.low }}>
                    {alertCountBySeverity.low} Low
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Category Breakdown */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Categories</h3>
            {categoryStats.map(cat => (
              <div key={cat.id} className="bg-slate-800 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium" style={{ color: cat.color }}>{cat.label}</span>
                  <span className="text-xs text-slate-400">{cat.enabled}/{cat.total} active</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {cat.modules.map(m => (
                    <button
                      key={m.id}
                      onClick={() => onToggleModule(m.id)}
                      className={`flex-1 px-2 py-1.5 rounded text-xs transition-all relative ${
                        m.enabled
                          ? 'text-white'
                          : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      }`}
                      style={m.enabled ? { backgroundColor: m.color + '40', borderColor: m.color, borderWidth: 1 } : {}}
                    >
                      {/* Threat indicator dot */}
                      {modulesWithThreats.has(m.id) && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                      )}
                      <div className="flex items-center justify-center gap-1">
                        {m.icon}
                        <span className="truncate">{m.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Flows Tab */}
      {activeTab === 'flows' && (
        <div className="space-y-3">
          <div className="bg-slate-800 rounded p-3">
            <div className="text-xs text-slate-400 mb-2">Cross-Module Data Flow Map</div>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {DATA_FLOWS.map((flow, idx) => {
                const fromMod = modules.find(m => m.id === flow.from);
                const toMod = modules.find(m => m.id === flow.to);
                const isActive = highlightedModules.has(flow.from) || highlightedModules.has(flow.to);
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedFlow(selectedFlow === flow.label ? null : flow.label)}
                    className={`p-2 rounded cursor-pointer transition-all ${
                      selectedFlow === flow.label
                        ? 'bg-blue-900/30 border border-blue-500'
                        : isActive
                          ? 'bg-amber-900/20 border border-amber-500/50'
                          : 'bg-slate-700 hover:bg-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span style={{ color: fromMod?.color || '#6b7280' }}>{fromMod?.name || flow.from}</span>
                      <span className="text-slate-500">→</span>
                      <span style={{ color: toMod?.color || '#6b7280' }}>{toMod?.name || flow.to}</span>
                      <span className="text-slate-400 ml-auto">{flow.label}</span>
                    </div>
                    {selectedFlow === flow.label && (
                      <div className="text-xs text-slate-400 mt-1 pl-4">{flow.description}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modules Tab */}
      {activeTab === 'modules' && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {modules.map(m => {
            const isHighlighted = highlightedModules.has(m.id);
            const hasThreat = modulesWithThreats.has(m.id);
            return (
              <div
                key={m.id}
                className={`p-3 rounded border transition-all ${
                  m.enabled
                    ? isHighlighted
                      ? 'bg-amber-900/20 border-amber-500/60'
                      : 'bg-slate-800 border-slate-600'
                    : 'bg-slate-900 border-slate-700 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="relative" style={{ color: m.color }}>
                      {m.icon}
                      {hasThreat && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">{m.name}</div>
                      <div className="text-xs text-slate-400">
                        {m.category} • {m.itemCount} items
                        {hasThreat && <span className="text-red-400 ml-1">• threat active</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onToggleModule(m.id)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      m.enabled ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                    }`}
                  >
                    {m.enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <div className="space-y-3 max-h-[500px] overflow-y-auto">
          {activeAlerts.length === 0 ? (
            <div className="bg-slate-800 rounded p-6 text-center">
              <Shield size={32} className="mx-auto mb-2 text-green-400 opacity-50" />
              <div className="text-sm text-slate-400">No active threat correlations</div>
              <div className="text-xs text-slate-500 mt-1">All modules operating independently</div>
            </div>
          ) : (
            <>
              <div className="text-xs text-slate-400">
                {activeAlerts.length} active correlation{activeAlerts.length !== 1 ? 's' : ''} — hover to highlight affected modules
              </div>
              {activeAlerts.map(alert => (
                <div
                  key={alert.ruleId}
                  className="bg-slate-800 rounded p-3 border transition-all cursor-pointer"
                  style={{ borderColor: SEVERITY_COLORS[alert.severity] + '60' }}
                  onMouseEnter={() => handleAlertHover(alert)}
                  onMouseLeave={() => handleAlertHover(null)}
                  onClick={() => setSelectedAlert(selectedAlert === alert.ruleId ? null : alert.ruleId)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                        style={{ background: SEVERITY_BG[alert.severity], color: SEVERITY_COLORS[alert.severity] }}
                      >
                        {alert.severity}
                      </span>
                      <span className="text-sm font-medium text-white">{alert.ruleName}</span>
                    </div>
                    <span className="text-xs text-slate-400">{alert.threatCount} threat{alert.threatCount !== 1 ? 's' : ''}</span>
                  </div>

                  <div className="mt-2 text-xs text-slate-400">
                    <span style={{ color: SEVERITY_COLORS[alert.severity] }}>●</span>{' '}
                    <span className="text-slate-300">{alert.sourceModuleName}</span>
                    <span className="text-slate-500"> → </span>
                    <span>{alert.affectedModuleNames.join(', ')}</span>
                  </div>

                  {selectedAlert === alert.ruleId && (
                    <div className="mt-3 pt-2 border-t border-slate-700 space-y-1">
                      <div className="text-xs text-slate-400">{alert.description}</div>
                      <div className="text-xs">
                        <span className="text-amber-400 font-medium">Recommended: </span>
                        <span className="text-slate-300">{alert.action}</span>
                      </div>
                      <div className="flex gap-1 mt-2">
                        {[alert.sourceModule, ...alert.affectedModules].map(modId => {
                          const mod = modules.find(m => m.id === modId);
                          return (
                            <span
                              key={modId}
                              className="px-1.5 py-0.5 rounded text-[10px]"
                              style={{ backgroundColor: (mod?.color || '#6b7280') + '30', color: mod?.color || '#9ca3af' }}
                            >
                              {mod?.name || modId}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Panel>
    </div>
    </div>
  );
}
