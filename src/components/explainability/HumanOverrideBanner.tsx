import React, { useState, useEffect } from 'react';

export interface HighStakesPrediction {
  id: string;
  type: string;
  severity: string;
  lat: number;
  lon: number;
  description: string;
  probability: number;
  predictedAt: number;
  status: string;
  evidenceSummary?: string;
}

export interface PendingOverrides {
  pending: HighStakesPrediction[];
  count: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'var(--text-dim)',
  advisory: 'var(--warning)',
  warning: '#f97316',
  critical: 'var(--danger)',
};

interface Props {
  onApprove?: (id: string, notes?: string) => void;
  onReject?: (id: string, reason: string) => void;
}

export default function HumanOverrideBanner({ onApprove, onReject }: Props) {
  const [pending, setPending] = useState<HighStakesPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetchPending();
  }, []);

  async function fetchPending() {
    try {
      setLoading(true);
      const resp = await fetch('/api/explain/override/pending');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: PendingOverrides = await resp.json();
      setPending(data.pending || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(id: string) {
    try {
      const resp = await fetch(`/api/explain/override/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'admin', notes }),
      });
      if (!resp.ok) throw new Error('Approval failed');
      setPending(prev => prev.filter(p => p.id !== id));
      setActionId(null);
      onApprove?.(id, notes);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleReject(id: string, reason: string) {
    try {
      const resp = await fetch(`/api/explain/override/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'admin', reason }),
      });
      if (!resp.ok) throw new Error('Rejection failed');
      setPending(prev => prev.filter(p => p.id !== id));
      setActionId(null);
      onReject?.(id, reason);
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading && pending.length === 0) {
    return (
      <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-dim)' }}>
        ⏳ Checking for pending approvals...
      </div>
    );
  }

  if (pending.length === 0) return null;

  const typeLabels: Record<string, string> = {
    earthquake: 'Earthquake', storm_cell: 'Storm Cell', tornado: 'Tornado',
    tsunami: 'Tsunami', wildfire: 'Wildfire', volcanic_eruption: 'Volcanic Eruption',
  };

  return (
    <div style={{
      marginTop: 8, borderRadius: 6,
      border: '1px solid rgba(239,68,68,0.3)',
      background: 'rgba(239,68,68,0.04)',
      overflow: 'hidden', fontSize: 11,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px',
        background: 'rgba(239,68,68,0.08)',
      }}>
        <span>⚠️</span>
        <span style={{ fontWeight: 600, color: 'var(--danger)' }}>
          Human Approval Required
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10,
          padding: '1px 6px', borderRadius: 3,
          background: 'rgba(239,68,68,0.15)',
          color: 'var(--danger)',
        }}>
          {pending.length} pending
        </span>
      </div>

      {pending.map(pred => (
        <div key={pred.id} style={{
          padding: '8px 10px',
          borderTop: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{
                  fontSize: 9, fontWeight: 600,
                  padding: '1px 5px', borderRadius: 3,
                  background: `${SEVERITY_COLORS[pred.severity] || 'var(--text-dim)'}20`,
                  color: SEVERITY_COLORS[pred.severity] || 'var(--text-dim)',
                }}>
                  {pred.severity.toUpperCase()}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {typeLabels[pred.type] || pred.type.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  @ {pred.lat.toFixed(2)}, {pred.lon.toFixed(2)}
                </span>
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 10, marginBottom: 4 }}>
                {pred.description}
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-dim)' }}>
                <span>Probability: {(pred.probability * 100).toFixed(0)}%</span>
                {pred.evidenceSummary && <span>📋 {pred.evidenceSummary}</span>}
              </div>
            </div>
          </div>

          {actionId === pred.id && (
            <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                placeholder="Notes / reason..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                style={{
                  flex: 1, padding: '4px 8px', fontSize: 10,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border)', borderRadius: 4,
                  color: 'var(--text)', outline: 'none',
                }}
              />
              <button
                onClick={() => { handleApprove(pred.id); setNotes(''); }}
                style={{
                  padding: '3px 10px', fontSize: 10, fontWeight: 600,
                  background: 'rgba(34,197,94,0.12)', color: 'var(--success)',
                  border: '1px solid rgba(34,197,94,0.3)', borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                ✅ Approve
              </button>
              <button
                onClick={() => { handleReject(pred.id, notes || 'Rejected by operator'); setNotes(''); }}
                style={{
                  padding: '3px 10px', fontSize: 10, fontWeight: 600,
                  background: 'rgba(239,68,68,0.12)', color: 'var(--danger)',
                  border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                ❌ Reject
              </button>
            </div>
          )}
          {actionId !== pred.id && (
            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => setActionId(pred.id)}
                style={{
                  padding: '3px 10px', fontSize: 10,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border)', borderRadius: 4,
                  color: 'var(--text-dim)', cursor: 'pointer',
                }}
              >
                Review & Respond
              </button>
            </div>
          )}

          {error && actionId === pred.id && (
            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--danger)' }}>
              {error}
            </div>
          )}
        </div>
      ))}

      <div style={{ padding: '4px 10px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <button
          onClick={fetchPending}
          style={{
            fontSize: 9, color: 'var(--text-dim)',
            background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          🔄 Refresh
        </button>
      </div>
    </div>
  );
}
