/**
 * Advanced AI Chat — React components
 * ─────────────────────────────────────
 * Renders the new advanced message features inline in the chat panel:
 *  - PlanCard (#5): editable plan with approve/run
 *  - SubAgentActivity (#6): live sub-agent progress
 *  - InlineTable / InlineChart / InlineSlider (#7, #13)
 *  - ToolApproval (#4): approve destructive tools
 *  - ModelTierSelector (#11)
 *  - TraceExpander (#15)
 */
import React, { useState, useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { PlanCard as PlanCardType, SubAgentActivity, ArtifactData, ToolEvent } from '@/lib/chatStore';
import { approveTool, fetchTrace } from '@/lib/advancedChat';
import {
  Play, CheckCircle, XCircle, Loader, ChevronDown, ChevronRight,
  Shield, Brain, Copy, Eye, Cpu, ShieldCheck, ShieldAlert, Link2, CheckCircle2, Lock,
} from 'lucide-react';
import { authHeaders } from '@/context/AuthContext';

// ─── #5: Plan Card ─────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  planner: '#60a5fa', analyst: '#34d399', coder: '#a78bfa',
  visualizer: '#f59e0b', critic: '#ef4444', researcher: '#22d3ee',
  synthesizer: '#ec4899',
};

export function PlanCardView({ plan, onExecute, onToggleStep }: {
  plan: PlanCardType;
  onExecute: (plan: PlanCardType) => void;
  onToggleStep: (stepId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (plan.executed) {
    return (
      <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#34d399' }}>
          <CheckCircle size={12} /> Plan executed ({plan.steps.filter(s => s.status === 'completed').length}/{plan.steps.length} steps)
        </div>
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid rgba(96,165,250,0.3)', borderRadius: 8, background: 'rgba(96,165,250,0.04)', marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', cursor: 'pointer', background: 'rgba(96,165,250,0.08)' }}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} style={{ color: '#60a5fa' }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#60a5fa' }}>Execution Plan</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{plan.steps.length} steps</span>
        {plan.requiresConfirmation && (
          <span style={{ fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '1px 5px', borderRadius: 3, marginLeft: 'auto' }}>Needs approval</span>
        )}
      </div>
      {expanded && (
        <div style={{ padding: '6px 10px' }}>
          {plan.steps.map((step, i) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 0', fontSize: 11 }}>
              <input
                type="checkbox"
                checked={step.enabled}
                onChange={() => onToggleStep(step.id)}
                style={{ marginTop: 2, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 14 }}>{i + 1}.</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--text)' }}>{step.description}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: `${AGENT_COLORS[step.agent] || '#64748b'}22`, color: AGENT_COLORS[step.agent] || '#64748b' }}>{step.agent}</span>
                  {step.requiresApproval && <Shield size={9} style={{ color: '#f59e0b' }} />}
                  {step.tools && step.tools.map(t => <span key={t} style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t}</span>)}
                  {step.status === 'running' && <Loader size={10} className="spin" style={{ color: '#60a5fa' }} />}
                  {step.status === 'completed' && <CheckCircle size={10} style={{ color: '#34d399' }} />}
                  {step.status === 'failed' && <XCircle size={10} style={{ color: '#ef4444' }} />}
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={() => onExecute(plan)}
            style={{ marginTop: 6, width: '100%', padding: '6px', fontSize: 11, fontWeight: 600, background: 'rgba(96,165,250,0.2)', border: '1px solid rgba(96,165,250,0.4)', color: '#60a5fa', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          >
            <Play size={11} /> Execute Plan
          </button>
        </div>
      )}
    </div>
  );
}

// ─── #6: Sub-agent activity ────────────────────────────────────────────────

export function SubAgentActivityView({ activities }: { activities: SubAgentActivity[] }) {
  const [expanded, setExpanded] = useState(false);
  const byRole = useMemo(() => {
    const m: Record<string, SubAgentActivity[]> = {};
    if (activities) {
      for (const a of activities) {
        if (!m[a.role]) m[a.role] = [];
        m[a.role].push(a);
      }
    }
    return m;
  }, [activities]);
  if (!activities || activities.length === 0) return null;
  const roles = Object.keys(byRole);
  const activeCount = activities.filter(a => a.status === 'thinking' || a.status === 'partial' || a.status === 'starting').length;
  return (
    <div style={{ marginBottom: 6, border: '1px solid rgba(167,139,250,0.2)', borderRadius: 6, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', background: 'rgba(167,139,250,0.05)' }}>
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Cpu size={11} style={{ color: '#a78bfa' }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: '#a78bfa' }}>Multi-agent</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{roles.length} agents · {activities.length} events</span>
        {activeCount > 0 && <Loader size={10} className="spin" style={{ color: '#a78bfa', marginLeft: 'auto' }} />}
      </div>
      {expanded && (
        <div style={{ padding: '4px 8px', maxHeight: 200, overflowY: 'auto' }}>
          {roles.map(role => {
            const evts = byRole[role];
            const last = evts[evts.length - 1];
            return (
              <div key={role} style={{ padding: '3px 0', fontSize: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ padding: '0 4px', borderRadius: 3, background: `${AGENT_COLORS[role] || '#64748b'}22`, color: AGENT_COLORS[role] || '#64748b', fontWeight: 600 }}>{role}</span>
                  <span style={{ color: 'var(--text-dim)' }}>{last.text}</span>
                  {last.status === 'partial' && <Loader size={9} className="spin" />}
                  {last.status === 'thinking' && <Loader size={9} className="spin" />}
                  {last.status === 'starting' && <Loader size={9} className="spin" />}
                  {last.status === 'completed' && <CheckCircle size={9} style={{ color: '#34d399' }} />}
                  {last.status === 'failed' && <XCircle size={9} style={{ color: '#ef4444' }} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── #7: Inline Table ──────────────────────────────────────────────────────

export function InlineTableView({ artifact }: { artifact: ArtifactData }) {
  const [copied, setCopied] = useState(false);
  const cols = artifact.columns || [];
  const rows = artifact.rows || [];
  return (
    <div style={{ margin: '6px 0', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
      {artifact.title && <div style={{ padding: '4px 8px', fontSize: 10, fontWeight: 600, background: 'rgba(96,165,250,0.06)', color: 'var(--text)' }}>{artifact.title}</div>}
      <div style={{ maxHeight: 240, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr>{cols.map(c => <th key={c} style={{ padding: '4px 6px', textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', color: 'var(--text-dim)', position: 'sticky', top: 0 }}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((r, i) => (
              <tr key={i}>{cols.map(c => <td key={c} style={{ padding: '3px 6px', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>{String(r[c] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 8px', fontSize: 10, color: 'var(--text-dim)' }}>
        <span>{rows.length} rows</span>
        <button
          onClick={() => { const csv = [cols.join(','), ...rows.map(r => cols.map(c => r[c]).join(','))].join('\n'); navigator.clipboard.writeText(csv); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{ background: 'none', border: 'none', color: copied ? '#34d399' : 'var(--text-dim)', cursor: 'pointer', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}
        >
          <Copy size={9} /> {copied ? 'Copied' : 'CSV'}
        </button>
      </div>
    </div>
  );
}

// ─── #13: Inline Chart (Recharts) ──────────────────────────────────────────

const CHART_COLORS = ['#60a5fa', '#34d399', '#a78bfa', '#f59e0b', '#ef4444', '#22d3ee', '#ec4899', '#84cc16'];

export function InlineChartView({ artifact }: { artifact: ArtifactData }) {
  const labels = artifact.labels || [];
  const values = artifact.values || [];
  const data = labels.map((l, i) => ({ name: l, value: values[i] ?? 0 }));
  const type = artifact.chartType || 'bar';
  if (data.length === 0) return null;
  return (
    <div style={{ margin: '6px 0', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'rgba(15,23,42,0.4)' }}>
      {artifact.title && <div style={{ padding: '4px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>{artifact.title}</div>}
      <ResponsiveContainer width="100%" height={160}>
        {type === 'line' ? (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
            <Tooltip contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid var(--border)', fontSize: 10 }} />
            <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        ) : type === 'pie' ? (
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={{ fontSize: 10 }}>
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid var(--border)', fontSize: 10 }} />
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
            <Tooltip contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid var(--border)', fontSize: 10 }} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ─── #7: Inline Slider (re-runnable query) ─────────────────────────────────

export function InlineSliderView({ artifact, onRerun }: { artifact: ArtifactData; onRerun: (param: string, value: number) => void }) {
  const [val, setVal] = useState(artifact.sliderValue ?? artifact.sliderMin ?? 0);
  if (!artifact.sliderQuery) return null;
  return (
    <div style={{ margin: '6px 0', padding: '8px', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, background: 'rgba(245,158,11,0.03)' }}>
      <div style={{ fontSize: 10, color: 'var(--text)', marginBottom: 4 }}>{artifact.title || 'Adjust parameter'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 50 }}>{artifact.sliderParam}</span>
        <input
          type="range"
          min={artifact.sliderMin ?? 0}
          max={artifact.sliderMax ?? 100}
          step={artifact.sliderStep ?? 1}
          value={val}
          onChange={e => setVal(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b', minWidth: 40, textAlign: 'right' }}>{val}</span>
        <button onClick={() => onRerun(artifact.sliderParam || 'value', val)} style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', borderRadius: 4, cursor: 'pointer' }}>Run</button>
      </div>
    </div>
  );
}

// ─── #7: Artifact dispatcher ───────────────────────────────────────────────

export function ArtifactView({ artifact, onRerun }: { artifact: ArtifactData; onRerun: (param: string, value: number) => void }) {
  switch (artifact.kind) {
    case 'table': return <InlineTableView artifact={artifact} />;
    case 'chart': return <InlineChartView artifact={artifact} />;
    case 'slider': return <InlineSliderView artifact={artifact} onRerun={onRerun} />;
    default: return null;
  }
}

// ─── #4: Tool approval card ────────────────────────────────────────────────

export function ToolApprovalView({ event, onApprove, onDeny }: {
  event: ToolEvent;
  onApprove: (result?: unknown, answer?: string) => void;
  onDeny: () => void;
}) {
  const [approving, setApproving] = useState(false);
  if (event.status !== 'blocked' && !event.approvalRequired) return null;
  const riskColor = event.riskLevel === 'destructive' ? '#ef4444' : event.riskLevel === 'high' ? '#f59e0b' : '#64748b';
  const handleApprove = async () => {
    setApproving(true);
    try {
      if (!event.approvalId) throw new Error('no approval token');
      const r = await approveTool(event.approvalId);
      onApprove(r?.result, r?.answer);
    }
    catch { onDeny(); }
    finally { setApproving(false); }
  };
  return (
    <div style={{ margin: '4px 0', padding: '8px', border: `1px solid ${riskColor}44`, borderRadius: 6, background: `${riskColor}11` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Shield size={12} style={{ color: riskColor }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: riskColor }}>Approval required: {event.name}</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto', textTransform: 'uppercase' }}>{event.riskLevel}</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>{event.description || event.error || 'This tool modifies state and needs confirmation.'}</div>
      {event.args && Object.keys(event.args).length > 0 && (
        <pre style={{ fontSize: 10, color: 'var(--text-dim)', background: 'rgba(0,0,0,0.2)', padding: 4, borderRadius: 4, margin: '4px 0', maxHeight: 60, overflow: 'auto' }}>{JSON.stringify(event.args, null, 2)}</pre>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleApprove} disabled={approving} style={{ flex: 1, fontSize: 10, padding: '4px', background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.4)', color: '#34d399', borderRadius: 4, cursor: approving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          {approving ? <Loader size={10} className="spin" /> : <><CheckCircle size={10} /> Approve</>}
        </button>
        <button onClick={onDeny} style={{ flex: 1, fontSize: 10, padding: '4px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          <XCircle size={10} /> Deny
        </button>
      </div>
    </div>
  );
}


// ─── #15: Trace expander ───────────────────────────────────────────────────

interface TraceData {
  interactionId?: string;
  modelUsed?: string;
  intentType?: string;
  confidence?: number;
  totalDurationMs?: number;
  steps?: Array<{ type: string; description: string; durationMs?: number }>;
}

interface EvidenceSource {
  sourceType: string;
  sourceName: string;
  endpoint?: string;
  responseTimeMs?: number;
  httpStatus?: number;
}

interface EvidenceLink {
  claim: string;
  confidence: number;
  sources: EvidenceSource[];
  hash: string;
  previousHash: string;
  timestamp: number;
}

interface EvidenceChainData {
  chain: EvidenceLink[];
  integrity: { valid: boolean; length: number };
}

export function TraceExpander({ traceId }: { traceId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [subTab, setSubTab] = useState<'steps' | 'evidence'>('steps');
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(false);

  // Evidence chain states
  const [evidenceData, setEvidenceData] = useState<EvidenceChainData | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  const fetchEvidence = async (interactionId: string) => {
    setEvidenceLoading(true);
    try {
      const resp = await fetch(`/api/explain/evidence/${encodeURIComponent(interactionId)}`, {
        headers: { ...authHeaders() },
      });
      if (resp.ok) {
        const data = await resp.json();
        setEvidenceData(data);
      } else {
        setEvidenceData(null);
      }
    } catch {
      setEvidenceData(null);
    } finally {
      setEvidenceLoading(false);
    }
  };

  const handleVerify = async (interactionId: string) => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const resp = await fetch(`/api/explain/evidence/${encodeURIComponent(interactionId)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      const res = await resp.json();
      if (res.valid) {
        setVerifyResult(`✓ Cryptographic chain verified intact (${res.length || evidenceData?.chain?.length || 0} links)`);
      } else {
        setVerifyResult(`⚠ Broken chain detected at link ${res.brokenAt}`);
      }
    } catch (err: unknown) {
      setVerifyResult(`Verification error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleExpand = async () => {
    if (!expanded && !trace) {
      setLoading(true);
      try {
        const t = await fetchTrace(traceId);
        setTrace(t);
        if (t?.interactionId) {
          fetchEvidence(t.interactionId);
        }
      } catch {
        setTrace(null);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div style={{ marginTop: 4 }}>
      <button onClick={handleExpand} style={{ fontSize: 10, color: 'var(--text-dim)', background: 'none', border: '1px solid transparent', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Eye size={10} /> Trace & Evidence
      </button>

      {expanded && (
        <div style={{ marginTop: 4, padding: 8, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 10, color: 'var(--text-dim)', maxHeight: 240, overflow: 'auto' }}>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 6 }}>
            <button
              onClick={() => setSubTab('steps')}
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: subTab === 'steps' ? 'rgba(59,130,246,0.2)' : 'transparent',
                color: subTab === 'steps' ? '#60a5fa' : 'var(--text-dim)',
              }}
            >
              Execution Steps
            </button>
            <button
              onClick={() => {
                setSubTab('evidence');
                if (!evidenceData && trace?.interactionId) fetchEvidence(trace.interactionId);
              }}
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: subTab === 'evidence' ? 'rgba(52,211,153,0.2)' : 'transparent',
                color: subTab === 'evidence' ? '#34d399' : 'var(--text-dim)',
                display: 'inline-flex', alignItems: 'center', gap: 3,
              }}
            >
              <Shield size={10} /> Evidence Chain
            </button>
          </div>

          {loading && <div><Loader size={10} className="spin" /> Loading trace...</div>}

          {!loading && trace && subTab === 'steps' && (
            <div>
              <div style={{ marginBottom: 4, color: 'var(--text)' }}>Interaction: <code>{trace.interactionId?.slice(0, 12)}</code></div>
              <div style={{ marginBottom: 4 }}>Model: {trace.modelUsed} · Intent: {trace.intentType} · {((trace.confidence ?? 0) * 100).toFixed(0)}% confidence</div>
              <div style={{ marginBottom: 4 }}>Duration: {trace.totalDurationMs}ms</div>
              {Array.isArray(trace.steps) && trace.steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, padding: '3px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ color: '#60a5fa', minWidth: 70 }}>{s.type}</span>
                  <span>{s.description}</span>
                  {s.durationMs && <span style={{ marginLeft: 'auto', color: '#64748b' }}>{s.durationMs}ms</span>}
                </div>
              ))}
            </div>
          )}

          {!loading && subTab === 'evidence' && (
            <div>
              {evidenceLoading && <div><Loader size={10} className="spin" /> Loading evidence chain...</div>}
              
              {!evidenceLoading && evidenceData && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: evidenceData.integrity?.valid ? '#34d399' : '#f59e0b', fontWeight: 600 }}>
                      {evidenceData.integrity?.valid ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                      <span>{evidenceData.integrity?.valid ? 'Valid SHA-256 Evidence Chain' : 'Integrity Flagged'}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>({evidenceData.chain?.length || 0} links)</span>
                    </div>

                    {trace?.interactionId && (
                      <button
                        onClick={() => handleVerify(trace.interactionId!)}
                        disabled={verifying}
                        style={{
                          fontSize: 8, padding: '2px 6px', background: 'rgba(52,211,153,0.15)',
                          border: '1px solid rgba(52,211,153,0.3)', borderRadius: 4, color: '#34d399', cursor: 'pointer',
                        }}
                      >
                        {verifying ? 'Verifying...' : 'Verify Chain'}
                      </button>
                    )}
                  </div>

                  {verifyResult && (
                    <div style={{ fontSize: 9, color: verifyResult.startsWith('✓') ? '#34d399' : '#ef4444', marginBottom: 6 }}>
                      {verifyResult}
                    </div>
                  )}

                  {Array.isArray(evidenceData.chain) && evidenceData.chain.map((link, idx) => (
                    <div key={idx} style={{
                      padding: 6, marginBottom: 4, borderRadius: 4,
                      background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 9, marginBottom: 2 }}>
                        "{link.claim}"
                      </div>
                      <div style={{ fontSize: 8, color: 'var(--text-dim)', marginBottom: 4 }}>
                        Confidence: {(link.confidence * 100).toFixed(0)}% · Hash: <code>{link.hash?.slice(0, 10)}...</code>
                      </div>
                      {link.sources?.map((src, sIdx) => (
                        <div key={sIdx} style={{ fontSize: 8, color: '#93c5fd', display: 'flex', gap: 4, alignItems: 'center' }}>
                          <Link2 size={8} />
                          <span>{src.sourceName}</span>
                          {src.httpStatus && <span style={{ color: '#34d399' }}>HTTP {src.httpStatus}</span>}
                          {src.responseTimeMs && <span style={{ color: 'var(--text-muted)' }}>({src.responseTimeMs}ms)</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {!evidenceLoading && !evidenceData && (
                <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-dim)' }}>
                  No cryptographic evidence chain recorded for this response.
                </div>
              )}
            </div>
          )}

          {!loading && !trace && <div>Trace not found.</div>}
        </div>
      )}
    </div>
  );
}

// ─── #8: Voice mode indicator ──────────────────────────────────────────────

export function VoiceModeIndicator({ active, onToggle, bargeIn }: { active: boolean; onToggle: () => void; bargeIn: boolean }) {
  return (
    <button
      onClick={onToggle}
      title={active ? 'Voice mode active — click to stop' : 'Enable continuous voice mode'}
      style={{
        fontSize: 10, padding: '3px 6px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
        background: active ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
        color: active ? '#ef4444' : 'var(--text-dim)', borderRadius: 4,
      }}
    >
      {active ? <><span className="voice-pulse" /> Listening{bargeIn ? ' (barge-in)' : ''}</> : <>Voice mode</>}
    </button>
  );
}
