import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles,
  Brain,
  Zap,
  TrendingUp,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Play,
  Layers,
  Cpu,
  GitBranch,
  ShieldAlert,
  ArrowUpRight,
  Clock,
  ChevronRight,
  BarChart2,
  Activity,
  Award,
} from 'lucide-react';

export interface ArchitectureProposal {
  id: string;
  title: string;
  description: string;
  category: 'performance' | 'scalability' | 'new_capability' | 'optimization' | 'reliability';
  expectedImpact: number;
  effort: 'low' | 'medium' | 'high';
  effortScore?: number;
  priority?: number;
  evidence?: string[];
  status: 'pending' | 'approved' | 'rejected' | 'implemented';
  proposedAt: number;
}

export interface IntentProposal {
  name: string;
  description?: string;
  patterns?: string[];
  status: 'pending' | 'active' | 'rejected' | 'explored';
  confidence?: number;
  examples?: string[];
}

export interface BanditArm {
  arm: string;
  pulls: number;
  rewards: number;
  estimatedValue: number;
}

export interface IntentPerformance {
  intentType: string;
  accuracy: number;
  avgLatency: number;
  satisfaction: number;
  sampleCount: number;
  trend: string;
  driftDetected: boolean;
  recentScore: number;
  baselineScore: number;
}

export interface EvolutionStatusData {
  banditStats: BanditArm[];
  drifts: unknown[];
  git: { currentBranch: string; hasUncommitted: boolean };
  perf: { totalRequests: number; intents: string[] };
  proposals: number;
  pendingProposals: number;
}

export interface MetaStatusData {
  cycleCount: number;
  metaCognition?: {
    running: boolean;
    performance: IntentPerformance[];
    learning?: {
      totalFeedback: number;
      rewardModels: number;
      strategies: number;
      explorationRate: number;
    };
  };
  performance?: IntentPerformance[];
  lastReport?: {
    timestamp: number;
    improvementsApplied: number;
    driftDetected: number;
    proposalsGenerated: number;
    promptsEvolved: number;
  } | null;
}

interface EvolutionHubProps {
  token?: string | null;
  onDataChange?: () => void;
}

type TabType = 'proposals' | 'bandit' | 'drift' | 'ledger';

export const EvolutionHub: React.FC<EvolutionHubProps> = ({ token, onDataChange }) => {
  const [tab, setTab] = useState<TabType>('proposals');
  const [loading, setLoading] = useState<boolean>(true);
  const [cycling, setCycling] = useState<boolean>(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const [evoStatus, setEvoStatus] = useState<EvolutionStatusData | null>(null);
  const [metaStatus, setMetaStatus] = useState<MetaStatusData | null>(null);
  const [archProposals, setArchProposals] = useState<ArchitectureProposal[]>([]);
  const [intentProposals, setIntentProposals] = useState<IntentProposal[]>([]);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      const [evoRes, metaRes, archRes, intentRes] = await Promise.allSettled([
        fetch('/api/self-evolution/status', { headers, cache: 'no-store' }),
        fetch('/api/meta/status', { headers, cache: 'no-store' }),
        fetch('/api/meta/architecture-proposals', { headers, cache: 'no-store' }),
        fetch('/api/meta/intent-proposals', { headers, cache: 'no-store' }),
      ]);

      if (evoRes.status === 'fulfilled' && evoRes.value.ok) {
        setEvoStatus(await evoRes.value.json());
      }
      if (metaRes.status === 'fulfilled' && metaRes.value.ok) {
        setMetaStatus(await metaRes.value.json());
      }
      if (archRes.status === 'fulfilled' && archRes.value.ok) {
        const d = await archRes.value.json();
        const list = Array.isArray(d) ? d : d.pending ? [...(d.pending || []), ...(d.approved || [])] : d.all || [];
        setArchProposals(list);
      }
      if (intentRes.status === 'fulfilled' && intentRes.value.ok) {
        const d = await intentRes.value.json();
        const list = Array.isArray(d) ? d : d.all ? d.all : d.pending || [];
        setIntentProposals(list);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchAll();
    const timer = setInterval(() => void fetchAll(), 25000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  // Trigger manual evolution cycle
  const triggerCycle = async () => {
    setCycling(true);
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      const resp = await fetch('/api/meta/cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      });
      if (resp.ok) {
        showToast('Evolution cycle completed: Analysis & proposal evaluation refreshed.');
        await fetchAll();
        if (onDataChange) onDataChange();
      } else {
        const err = await resp.json().catch(() => ({ error: 'Cycle failed' }));
        showToast(`Cycle error: ${err.error || resp.statusText}`, 'error');
      }
    } catch (e) {
      showToast(`Network error: ${(e as Error).message}`, 'error');
    } finally {
      setCycling(false);
    }
  };

  // Handle Architecture proposal approval/rejection
  const handleArchAction = async (id: string, action: 'approve' | 'reject') => {
    setActionInProgress(id);
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      const resp = await fetch(`/api/meta/architecture-proposals/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      });
      if (resp.ok) {
        showToast(`Proposal ${action === 'approve' ? 'approved & marked for implementation' : 'rejected'}.`);
        setArchProposals(prev => prev.map(p => p.id === id ? { ...p, status: action === 'approve' ? 'approved' : 'rejected' } : p));
        if (onDataChange) onDataChange();
      } else {
        const err = await resp.json().catch(() => ({ error: 'Action failed' }));
        showToast(`Error: ${err.error || resp.statusText}`, 'error');
      }
    } catch (e) {
      showToast(`Error: ${(e as Error).message}`, 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle Intent proposal approval/rejection
  const handleIntentAction = async (name: string, action: 'approve' | 'reject') => {
    setActionInProgress(name);
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      const resp = await fetch(`/api/meta/intent-proposals/${encodeURIComponent(name)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      });
      if (resp.ok) {
        showToast(`Intent "${name}" ${action === 'approve' ? 'approved & activated' : 'rejected'}.`);
        setIntentProposals(prev => prev.map(p => p.name === name ? { ...p, status: action === 'approve' ? 'active' : 'rejected' } : p));
        if (onDataChange) onDataChange();
      } else {
        const err = await resp.json().catch(() => ({ error: 'Action failed' }));
        showToast(`Error: ${err.error || resp.statusText}`, 'error');
      }
    } catch (e) {
      showToast(`Error: ${(e as Error).message}`, 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const cycleCount = metaStatus?.cycleCount ?? 0;
  const isEngineActive = (metaStatus?.metaCognition?.running ?? false) || cycleCount > 0 || (evoStatus?.proposals ?? 0) > 0;
  const pendingArchCount = archProposals.filter(p => p.status === 'pending').length;
  const pendingIntentCount = intentProposals.filter(p => p.status === 'pending').length;
  const totalPending = pendingArchCount + pendingIntentCount;

  // Best bandit arm
  const bestArm = useMemo(() => {
    const arms = evoStatus?.banditStats || [];
    if (!arms.length) return null;
    return [...arms].sort((a, b) => b.estimatedValue - a.estimatedValue)[0];
  }, [evoStatus]);

  const performances = metaStatus?.metaCognition?.performance || metaStatus?.performance || [];
  const avgSatisfaction = performances.length > 0
    ? Math.round((performances.reduce((s, p) => s + (p.satisfaction || 0), 0) / performances.length) * 100)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Top Header & Actions ── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 18px',
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(168, 85, 247, 0.3)',
          }}>
            <Brain size={20} style={{ color: '#a855f7' }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>
                Self-Improvement &amp; Meta-Cognition Engine
              </h3>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 999,
                background: isEngineActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: isEngineActive ? '#4ade80' : '#fbbf24',
                border: `1px solid ${isEngineActive ? 'rgba(34, 197, 94, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
              }}>
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: isEngineActive ? '#22c55e' : '#f59e0b',
                  boxShadow: isEngineActive ? '0 0 8px #22c55e' : 'none',
                }} />
                {isEngineActive ? `Engine Active · Cycle #${cycleCount}` : 'Standby · Ready'}
              </span>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: '#94a3b8' }}>
              Autonomous intent discovery, reinforcement feedback learning, and continuous pipeline self-optimization.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => void fetchAll()}
            disabled={loading}
            title="Refresh engine telemetry"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 6,
              padding: '7px 12px',
              color: '#94a3b8',
              fontSize: 12,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => void triggerCycle()}
            disabled={cycling}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none',
              borderRadius: 6,
              padding: '7px 16px',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: cycling ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
            }}
          >
            {cycling ? (
              <>
                <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Running Cycle...</span>
              </>
            ) : (
              <>
                <Play size={13} />
                <span>Run Evolution Cycle</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── KPI Metric Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
          borderRadius: 10,
          padding: '14px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Pending Proposals
            </span>
            <Sparkles size={16} style={{ color: totalPending > 0 ? '#fbbf24' : '#64748b' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: totalPending > 0 ? '#fbbf24' : '#f8fafc', marginTop: 8 }}>
            {totalPending}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            {pendingArchCount} architecture · {pendingIntentCount} intent
          </div>
        </div>

        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
          borderRadius: 10,
          padding: '14px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Bandit Router Arms
            </span>
            <Cpu size={16} style={{ color: '#38bdf8' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#38bdf8', marginTop: 8 }}>
            {evoStatus?.banditStats?.length ? `${evoStatus.banditStats.length} Tiers` : '—'}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            {bestArm && bestArm.pulls > 0 ? `Best: ${bestArm.arm} (${Math.round(bestArm.estimatedValue * 100)}%)` : 'Evaluating baseline (0 pulls)'}
          </div>
        </div>

        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
          borderRadius: 10,
          padding: '14px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Satisfaction Score
            </span>
            <TrendingUp size={16} style={{ color: '#4ade80' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#4ade80', marginTop: 8 }}>
            {avgSatisfaction !== null ? `${avgSatisfaction}%` : '—'}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            {performances.length > 0 ? `${performances.length} monitored intent types` : 'No intent sessions recorded yet'}
          </div>
        </div>

        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
          borderRadius: 10,
          padding: '14px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Git Integration
            </span>
            <GitBranch size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', marginTop: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {evoStatus?.git?.currentBranch || 'main'}
          </div>
          <div style={{ fontSize: 11, color: evoStatus?.git?.hasUncommitted ? '#f59e0b' : '#4ade80', marginTop: 4 }}>
            {evoStatus?.git?.hasUncommitted ? 'Working tree dirty' : 'Clean release branch'}
          </div>
        </div>
      </div>

      {/* ── Tabs Navigation ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', gap: 8 }}>
        <button
          onClick={() => setTab('proposals')}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: tab === 'proposals' ? '2px solid #8b5cf6' : '2px solid transparent',
            color: tab === 'proposals' ? '#f8fafc' : '#94a3b8',
            fontWeight: tab === 'proposals' ? 600 : 500,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Sparkles size={14} style={{ color: tab === 'proposals' ? '#a855f7' : '#64748b' }} />
          <span>Actionable Proposals ({totalPending})</span>
        </button>

        <button
          onClick={() => setTab('bandit')}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: tab === 'bandit' ? '2px solid #8b5cf6' : '2px solid transparent',
            color: tab === 'bandit' ? '#f8fafc' : '#94a3b8',
            fontWeight: tab === 'bandit' ? 600 : 500,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Cpu size={14} style={{ color: tab === 'bandit' ? '#38bdf8' : '#64748b' }} />
          <span>Bandit Model Routing</span>
        </button>

        <button
          onClick={() => setTab('drift')}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: tab === 'drift' ? '2px solid #8b5cf6' : '2px solid transparent',
            color: tab === 'drift' ? '#f8fafc' : '#94a3b8',
            fontWeight: tab === 'drift' ? 600 : 500,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Activity size={14} style={{ color: tab === 'drift' ? '#4ade80' : '#64748b' }} />
          <span>Intent Performance &amp; Drift</span>
        </button>

        <button
          onClick={() => setTab('ledger')}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: tab === 'ledger' ? '2px solid #8b5cf6' : '2px solid transparent',
            color: tab === 'ledger' ? '#f8fafc' : '#94a3b8',
            fontWeight: tab === 'ledger' ? 600 : 500,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Clock size={14} style={{ color: tab === 'ledger' ? '#fbbf24' : '#64748b' }} />
          <span>Cycle History &amp; Ledger</span>
        </button>
      </div>

      {/* ── TAB 1: PROPOSALS ── */}
      {tab === 'proposals' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Architecture proposals section */}
          <div>
            <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={15} style={{ color: '#818cf8' }} />
              <span>Pipeline &amp; Architecture Proposals</span>
              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'rgba(129, 140, 248, 0.15)', color: '#818cf8' }}>
                {archProposals.length} total
              </span>
            </h4>

            {archProposals.length === 0 ? (
              <div style={{ padding: 24, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', textAlign: 'center', color: '#64748b', fontSize: 12 }}>
                No architecture proposals formulated yet. Click <strong>Run Evolution Cycle</strong> above to analyze current pipeline metrics.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {archProposals.map(p => (
                  <div
                    key={p.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: 10,
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{p.title}</span>
                          <span style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'rgba(99, 102, 241, 0.15)',
                            color: '#818cf8',
                            textTransform: 'uppercase',
                          }}>
                            {p.category}
                          </span>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#cbd5e1', lineHeight: 1.4 }}>
                          {p.description}
                        </p>
                      </div>

                      {/* Status / Action buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {p.status === 'pending' ? (
                          <>
                            <button
                              onClick={() => void handleArchAction(p.id, 'approve')}
                              disabled={actionInProgress === p.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                background: 'rgba(34, 197, 94, 0.15)',
                                border: '1px solid rgba(34, 197, 94, 0.3)',
                                color: '#4ade80',
                                padding: '5px 12px',
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: actionInProgress === p.id ? 'not-allowed' : 'pointer',
                              }}
                            >
                              <CheckCircle2 size={12} />
                              <span>Approve</span>
                            </button>

                            <button
                              onClick={() => void handleArchAction(p.id, 'reject')}
                              disabled={actionInProgress === p.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                background: 'rgba(239, 68, 68, 0.15)',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                color: '#f87171',
                                padding: '5px 12px',
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: actionInProgress === p.id ? 'not-allowed' : 'pointer',
                              }}
                            >
                              <XCircle size={12} />
                              <span>Reject</span>
                            </button>
                          </>
                        ) : (
                          <span style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 11,
                            padding: '3px 8px',
                            borderRadius: 4,
                            background: p.status === 'approved' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                            color: p.status === 'approved' ? '#4ade80' : '#ef4444',
                            fontWeight: 600,
                          }}>
                            {p.status === 'approved' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                            {p.status}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata & Evidence */}
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 16,
                      fontSize: 11,
                      color: '#64748b',
                      borderTop: '1px solid rgba(255,255,255,0.04)',
                      paddingTop: 8,
                    }}>
                      <span>Effort: <strong style={{ color: '#94a3b8' }}>{p.effort}</strong></span>
                      <span>Impact Rating: <strong style={{ color: '#4ade80' }}>{typeof p.expectedImpact === 'number' && p.expectedImpact > 0 ? `+${Math.round(p.expectedImpact * 100)}%` : 'Assessing empirical impact'}</strong></span>
                      {p.evidence && p.evidence.length > 0 && (
                        <span>Evidence: <em style={{ color: '#94a3b8' }}>{p.evidence.join(' · ')}</em></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Intent proposals section */}
          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Brain size={15} style={{ color: '#a78bfa' }} />
              <span>Intent Classification Proposals</span>
              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'rgba(167, 139, 250, 0.15)', color: '#a78bfa' }}>
                {intentProposals.length} total
              </span>
            </h4>

            {intentProposals.length === 0 ? (
              <div style={{ padding: 24, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', textAlign: 'center', color: '#64748b', fontSize: 12 }}>
                No unhandled intent clusters discovered yet. Intent clusters are automatically grouped when recurring user queries deviate from base classifications.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {intentProposals.map(ip => (
                  <div
                    key={ip.name}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: 8,
                      padding: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <code style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>{ip.name}</code>
                      {ip.description && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{ip.description}</div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {ip.status === 'pending' ? (
                        <>
                          <button
                            onClick={() => void handleIntentAction(ip.name, 'approve')}
                            disabled={actionInProgress === ip.name}
                            style={{
                              background: 'rgba(34, 197, 94, 0.15)',
                              border: '1px solid rgba(34, 197, 94, 0.3)',
                              color: '#4ade80',
                              padding: '4px 10px',
                              borderRadius: 4,
                              fontSize: 11,
                              cursor: actionInProgress === ip.name ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Approve Intent
                          </button>
                          <button
                            onClick={() => void handleIntentAction(ip.name, 'reject')}
                            disabled={actionInProgress === ip.name}
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              color: '#f87171',
                              padding: '4px 10px',
                              borderRadius: 4,
                              fontSize: 11,
                              cursor: actionInProgress === ip.name ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: ip.status === 'active' ? '#4ade80' : '#ef4444' }}>
                          {ip.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: BANDIT ROUTING ── */}
      {tab === 'bandit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Multi-Armed Bandit reinforcement router dynamically shifts model tier workloads based on empirical response latency, quality rewards, and user feedback.
          </div>

          {(!evoStatus?.banditStats || evoStatus.banditStats.length === 0) ? (
            <div style={{ padding: 24, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', textAlign: 'center', color: '#64748b', fontSize: 12 }}>
              No bandit router arms registered in the active router.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {evoStatus.banditStats.map(arm => {
                const hasPulls = arm.pulls > 0;
                const valPercent = hasPulls ? Math.round(arm.estimatedValue * 100) : 0;
                const explorationRate = metaStatus?.metaCognition?.learning?.explorationRate ?? 0.1;

                return (
                  <div
                    key={arm.arm}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 10,
                      padding: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Cpu size={16} style={{ color: '#38bdf8' }} />
                        <strong style={{ fontSize: 13, color: '#f1f5f9' }}>{arm.arm}</strong>
                      </div>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: !hasPulls ? '#64748b' : valPercent >= 80 ? '#4ade80' : '#fbbf24',
                      }}>
                        {hasPulls ? `${valPercent}% Value` : 'Unsampled (0 pulls)'}
                      </span>
                    </div>

                    {/* Value progress bar */}
                    <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        width: `${valPercent}%`,
                        height: '100%',
                        background: valPercent >= 80 ? '#22c55e' : '#f59e0b',
                        borderRadius: 3,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b' }}>
                      <span>Pulls: <strong style={{ color: '#94a3b8' }}>{arm.pulls}</strong></span>
                      <span>Rewards: <strong style={{ color: '#94a3b8' }}>{arm.rewards}</strong></span>
                      <span>Exploration: <strong style={{ color: '#38bdf8' }}>{Math.round(explorationRate * 100)}%</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: INTENT PERFORMANCE & DRIFT ── */}
      {tab === 'drift' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Empirical intent classification performance, average execution latency, and statistical drift flags across conversational domains:
          </div>

          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.04)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                  <th style={{ padding: '10px 14px' }}>Intent Domain</th>
                  <th style={{ padding: '10px 14px' }}>Accuracy</th>
                  <th style={{ padding: '10px 14px' }}>Satisfaction</th>
                  <th style={{ padding: '10px 14px' }}>Avg Latency</th>
                  <th style={{ padding: '10px 14px' }}>Samples</th>
                  <th style={{ padding: '10px 14px' }}>Drift Status</th>
                </tr>
              </thead>
              <tbody>
                {performances.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                      No intent metrics recorded yet. Conversations in chat will populate this table automatically.
                    </td>
                  </tr>
                ) : (
                  performances.map(p => (
                    <tr key={p.intentType} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', color: '#cbd5e1' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <code style={{ color: '#38bdf8', fontSize: 12 }}>{p.intentType}</code>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: p.accuracy >= 0.9 ? '#4ade80' : '#fbbf24' }}>
                        {Math.round(p.accuracy * 100)}%
                      </td>
                      <td style={{ padding: '10px 14px', color: '#f8fafc' }}>
                        {Math.round(p.satisfaction * 100)}%
                      </td>
                      <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                        {p.avgLatency ? `${p.avgLatency}ms` : 'sub-10ms'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {p.sampleCount}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {p.driftDetected ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#ef4444', fontSize: 11, fontWeight: 600 }}>
                            <AlertTriangle size={12} /> Drift Detected
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#4ade80', fontSize: 11 }}>
                            <CheckCircle2 size={12} /> Stable
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 4: CYCLE LEDGER ── */}
      {tab === 'ledger' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Historical audit trace of automated self-evolution runs and cognitive model optimizations:
          </div>

          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.07)',
            borderRadius: 10,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={16} style={{ color: '#fbbf24' }} />
                <strong style={{ fontSize: 13, color: '#f8fafc' }}>Latest Cognitive Cycle Report</strong>
              </div>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Total Executed Cycles: <strong style={{ color: '#38bdf8' }}>{cycleCount}</strong>
              </span>
            </div>

            {metaStatus?.lastReport ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 12 }}>
                <div>
                  <div style={{ color: '#64748b' }}>Last Run Timestamp</div>
                  <div style={{ color: '#cbd5e1', fontWeight: 600, marginTop: 2 }}>
                    {new Date(metaStatus.lastReport.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>Improvements Applied</div>
                  <div style={{ color: '#4ade80', fontWeight: 600, marginTop: 2 }}>
                    {metaStatus.lastReport.improvementsApplied}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>Prompts Evolved</div>
                  <div style={{ color: '#818cf8', fontWeight: 600, marginTop: 2 }}>
                    {metaStatus.lastReport.promptsEvolved}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>Drift Flags Addressed</div>
                  <div style={{ color: '#fbbf24', fontWeight: 600, marginTop: 2 }}>
                    {metaStatus.lastReport.driftDetected}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                No cycle reports logged yet in this session. Running an evolution cycle executes drift mitigation, updates prompt baselines, and generates new architecture proposals.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Toast Notification ── */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: 24,
          right: 24,
          zIndex: 10000,
          background: toast.type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(34, 197, 94, 0.95)',
          color: '#ffffff',
          padding: '10px 18px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          {toast.type === 'error' ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
};
