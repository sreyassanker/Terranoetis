import React, { useState } from 'react';

interface ReasoningStep {
  type: string;
  description: string;
  evidence?: string;
  confidence?: number;
  durationMs?: number;
}

interface EvidenceSource {
  sourceName: string;
  sourceType: string;
  httpStatus?: number;
}

interface EvidenceLink {
  claim: string;
  confidence: number;
  sources: EvidenceSource[];
}

interface ThoughtBubbleProps {
  content: string;
  depth?: number;
  reasoningSteps?: ReasoningStep[];
  evidenceChain?: EvidenceLink[];
  confidence?: number;
}

const STEP_ICONS: Record<string, string> = {
  thought: '💭', tool_call: '🔧', tool_result: '📊',
  observation: '👁️', inference: '🧠', conclusion: '✅',
};

function ConfidenceHalo({ confidence }: { confidence: number }) {
  const color = confidence >= 0.8 ? 'var(--success)' : confidence >= 0.5 ? 'var(--warning)' : 'var(--danger)';
  const width = `${confidence * 100}%`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width, height: '100%', background: `linear-gradient(90deg, ${color}, ${color}66)`, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 9, fontWeight: 600, color, minWidth: 28, textAlign: 'right' }}>{(confidence * 100).toFixed(0)}%</span>
    </div>
  );
}

function ReasoningTree({ steps }: { steps: ReasoningStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <div style={{ marginTop: 6, borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', fontSize: 10 }}>
      <div onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'rgba(59,130,246,0.04)', cursor: 'pointer', userSelect: 'none' }}>
        <span>{expanded ? '▼' : '▶'}</span>
        <span style={{ color: 'var(--text)' }}>🌲 Reasoning Tree</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 9 }}>{steps.length} steps</span>
      </div>
      {expanded && (
        <div style={{ padding: '4px 0' }}>
          {steps.map((step, i) => (
            <div key={i}>
              <div onClick={() => setExpandedIdx(expandedIdx === i ? null : i)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', cursor: 'pointer', background: expandedIdx === i ? 'rgba(59,130,246,0.04)' : 'transparent' }}>
                <span>{'  '.repeat(step.type === 'conclusion' ? 1 : 0)}{STEP_ICONS[step.type] || '•'}</span>
                <span style={{ color: 'var(--text)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{step.description}</span>
                {step.confidence !== undefined && (
                  <span style={{ fontSize: 8, color: step.confidence >= 0.8 ? 'var(--success)' : step.confidence >= 0.5 ? 'var(--warning)' : 'var(--danger)' }}>
                    {(step.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              {expandedIdx === i && step.evidence && (
                <div style={{ padding: '2px 8px 6px 24px', fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.4, borderBottom: '1px solid var(--border)' }}>
                  {step.evidence}
                  {step.durationMs && <div style={{ marginTop: 2 }}>⏱ {step.durationMs}ms</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourcePopover({ source }: { source: EvidenceSource }) {
  const [show, setShow] = useState(false);
  const typeLabels: Record<string, string> = { api_call: '🌐 API', tool_execution: '🔧 Tool', database_query: '🗄️ DB', llm_inference: '🧠 LLM' };

  return (
    <span
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: 'relative', display: 'inline', cursor: 'help', borderBottom: '1px dashed var(--text-dim)' }}
    >
      {source.sourceName}
      {show && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          padding: '4px 8px', background: 'var(--panel-solid)', border: '1px solid var(--border)',
          borderRadius: 6, fontSize: 9, whiteSpace: 'nowrap', zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {typeLabels[source.sourceType] || source.sourceType}
          {source.httpStatus && ` · HTTP ${source.httpStatus}`}
        </span>
      )}
    </span>
  );
}

export default function ThoughtBubble({ content, depth = 0, reasoningSteps, evidenceChain, confidence }: ThoughtBubbleProps) {
  const opacity = Math.max(0.7, 1 - depth * 0.12);

  return (
    <div style={{
      opacity,
      position: 'relative',
      padding: '8px 12px',
      borderRadius: 12,
      background: depth === 0
        ? 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(168,85,247,0.04))'
        : 'rgba(255,255,255,0.03)',
      border: depth === 0 ? '1px solid rgba(59,130,246,0.15)' : '1px solid var(--border)',
      marginLeft: depth > 0 ? 16 : 0,
      marginTop: 4,
    }}>
      {depth > 0 && (
        <div style={{ fontSize: 8, color: 'var(--text-dim)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--purple)', display: 'inline-block' }} />
          Reasoning depth {depth}
        </div>
      )}
      <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text)' }}>{content}</div>

      {/* Evidence links inline */}
      {evidenceChain && evidenceChain.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 9 }}>
          {evidenceChain.slice(0, 3).map((link, i) => (
            <span key={i} style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ color: 'var(--teal)' }}>🔗</span>
              {link.sources.slice(0, 1).map((src, j) => <SourcePopover key={j} source={src} />)}
              {link.sources.length > 1 && <span style={{ color: 'var(--text-dim)' }}>+{link.sources.length - 1}</span>}
            </span>
          ))}
        </div>
      )}

      {/* Confidence halo */}
      {confidence !== undefined && <ConfidenceHalo confidence={confidence} />}

      {/* Reasoning tree */}
      {reasoningSteps && reasoningSteps.length > 0 && <ReasoningTree steps={reasoningSteps} />}
    </div>
  );
}
