import React, { useState } from 'react';

export interface ReasoningStep {
  type: string;
  description: string;
  evidence?: string;
  confidence?: number;
  timestamp: number;
  durationMs?: number;
}

export interface ReasoningTrace {
  interactionId: string;
  steps: ReasoningStep[];
  totalDurationMs: number;
  confidence: number;
  modelUsed: string;
  intentType: string;
}

const STEP_ICONS: Record<string, string> = {
  thought: '💭', tool_call: '🔧', tool_result: '📊',
  observation: '👁️', inference: '🧠', conclusion: '✅',
};

interface Props {
  trace: ReasoningTrace;
  loading?: boolean;
  error?: string;
}

export default function ReasoningTraceViewer({ trace, loading, error }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (loading) {
    return (
      <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(59,130,246,0.06)', borderRadius: 6, border: '1px solid rgba(59,130,246,0.15)', fontSize: 11, color: 'var(--text-dim)' }}>
        🔍 Loading reasoning trace...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(239,68,68,0.06)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.15)', fontSize: 11, color: '#ef4444' }}>
        ⚠️ {error}
      </div>
    );
  }

  if (!trace || trace.steps.length === 0) return null;

  const confidenceColor = trace.confidence >= 0.8 ? 'var(--success)' : trace.confidence >= 0.5 ? 'var(--warning)' : 'var(--danger)';
  const totalSteps = trace.steps.length;
  const completedSteps = trace.steps.filter(s => s.type === 'conclusion').length;

  return (
    <div style={{ marginTop: 8, borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', fontSize: 11 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
          background: 'rgba(59,130,246,0.06)', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontWeight: 500, color: 'var(--text)' }}>🧠 Reasoning Trace</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{completedSteps}/{totalSteps} steps</span>
        <span style={{ marginLeft: 'auto', color: confidenceColor, fontWeight: 600 }}>
          {(trace.confidence * 100).toFixed(0)}% confident
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '4px 0' }}>
          {/* Summary bar */}
          <div style={{ padding: '4px 10px 8px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-dim)' }}>
              <span>Model: {trace.modelUsed}</span>
              <span>Intent: {trace.intentType}</span>
              <span>Duration: {(trace.totalDurationMs / 1000).toFixed(1)}s</span>
            </div>
          </div>

          {/* Steps */}
          {trace.steps.map((step, i) => (
            <div key={i}>
              <div
                onClick={() => setExpandedStep(expandedStep === i ? null : i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                  cursor: 'pointer', transition: 'background 0.15s',
                  background: expandedStep === i ? 'rgba(59,130,246,0.04)' : 'transparent',
                }}
              >
                <span>{STEP_ICONS[step.type] || '•'}</span>
                <span style={{ color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {step.description}
                </span>
                {step.confidence !== undefined && (
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                    background: step.confidence >= 0.8 ? 'rgba(34,197,94,0.12)' : step.confidence >= 0.5 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                    color: step.confidence >= 0.8 ? 'var(--success)' : step.confidence >= 0.5 ? 'var(--warning)' : 'var(--danger)',
                  }}>
                    {(step.confidence * 100).toFixed(0)}%
                  </span>
                )}
                <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>
                  {expandedStep === i ? '▲' : '▼'}
                </span>
              </div>
              {expandedStep === i && (
                <div style={{ padding: '4px 10px 8px 30px', borderBottom: '1px solid var(--border)' }}>
                  {step.evidence && (
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, lineHeight: 1.4 }}>
                      <span style={{ fontWeight: 500, color: 'var(--text)' }}>Evidence: </span>
                      {step.evidence}
                    </div>
                  )}
                  {step.durationMs !== undefined && (
                    <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                      ⏱ {step.durationMs}ms
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
