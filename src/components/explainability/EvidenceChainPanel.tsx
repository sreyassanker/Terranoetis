import React, { useState } from 'react';

export interface EvidenceSource {
  sourceType: string;
  sourceName: string;
  endpoint?: string;
  httpStatus?: number;
  responseTimeMs?: number;
}

export interface EvidenceLink {
  claim: string;
  confidence: number;
  sources: EvidenceSource[];
  hash: string;
  timestamp: number;
}

interface Props {
  chain: EvidenceLink[] | null;
  integrity?: { valid: boolean; brokenLinks: number[]; tamperedClaims: string[] };
  loading?: boolean;
}

const SOURCE_ICONS: Record<string, string> = {
  api_call: '🌐', tool_execution: '🔧', database_query: '🗄️',
  llm_inference: '🧠', user_input: '👤', sensor: '📡',
};

export default function EvidenceChainPanel({ chain, integrity, loading }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(20,184,166,0.06)', borderRadius: 6, border: '1px solid rgba(20,184,166,0.15)', fontSize: 11, color: 'var(--text-dim)' }}>
        📋 Loading evidence chain...
      </div>
    );
  }

  if (!chain || chain.length === 0) return null;

  const avgConfidence = chain.reduce((s, l) => s + l.confidence, 0) / chain.length;
  const isIntact = integrity?.valid !== false;

  return (
    <div style={{ marginTop: 6, borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', fontSize: 11 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
          background: 'rgba(20,184,166,0.06)', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontWeight: 500, color: 'var(--text)' }}>📋 Evidence Chain</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{chain.length} claims</span>
        <span style={{ marginLeft: 'auto', fontSize: 10 }}>
          {isIntact ? '✅ Chain intact' : '⚠️ Tampered'}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '4px 0' }}>
          {chain.map((link, i) => (
            <div key={i} style={{
              padding: '6px 10px',
              borderBottom: i < chain.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ color: 'var(--text-dim)', fontSize: 10, minWidth: 20 }}>#{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--text)', marginBottom: 3, lineHeight: 1.4 }}>{link.claim}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {link.sources.map((src, j) => (
                      <span key={j} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '1px 6px', borderRadius: 3, fontSize: 9,
                        background: 'rgba(255,255,255,0.04)', color: 'var(--text-dim)',
                      }}>
                        {SOURCE_ICONS[src.sourceType] || '•'} {src.sourceName}
                        {src.httpStatus && ` (${src.httpStatus})`}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 9, color: 'var(--text-dim)' }}>
                    <span>Confidence: {(link.confidence * 100).toFixed(0)}%</span>
                    <span>Hash: {link.hash.slice(0, 8)}...</span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Integrity status */}
          {integrity && (
            <div style={{
              padding: '6px 10px', borderTop: '1px solid var(--border)',
              fontSize: 10, color: integrity.valid ? 'var(--success)' : 'var(--danger)',
            }}>
              {integrity.valid
                ? '✅ Hash chain verified — no tampering detected'
                : `⚠️ Chain integrity compromised — ${integrity.tamperedClaims.length} tampered claim(s) detected`
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}
