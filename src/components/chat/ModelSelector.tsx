import { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, Check, AlertTriangle } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { authHeaders } from '@/context/AuthContext';

export interface AvailableModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  available: boolean;
  status: string;
  local: boolean;
  tier: number;
}

/**
 * Model picker for the Earth Intelligence AI panel.
 * - Loads the available model list from /api/agent/models.
 * - Lets the user choose a specific model (or "auto" for default behaviour).
 * - If a selected model becomes unavailable, shows a notice.
 * - No selection → works exactly as before (auto).
 */
export function ModelSelector() {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const models = useChatStore(s => s.availableModels);
  const setModels = useChatStore(s => s.setAvailableModels);
  const selectedModel = useChatStore(s => s.selectedModel);
  const setSelectedModel = useChatStore(s => s.setSelectedModel);
  const wrapRef = useRef<HTMLDivElement>(null);

  const loadModels = useCallback(async () => {
    if (models.length > 0) return;
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await fetch('/api/agent/models', {
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { models: AvailableModel[] };
      setModels(data.models || []);
    } catch {
      setLoadError('Could not load model list.');
      // Keep a minimal auto entry so the picker still works.
      setModels([{ id: 'auto', provider: 'auto', model: '', label: 'Auto (recommended)', available: true, status: 'healthy', local: false, tier: 0 }]);
    } finally {
      setLoading(false);
    }
  }, [models.length, setModels]);

  useEffect(() => {
    void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close when clicking outside.
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [expanded]);

  const selected = selectedModel === 'auto' ? null : models.find(m => m.model === selectedModel) ?? null;
  const selectedUnavailable = selected && !selected.available;

  return (
    <div
      ref={wrapRef}
      style={{
        borderTop: '1px solid var(--border)',
        padding: '3px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      <button
        onClick={() => { void loadModels(); setExpanded(!expanded); }}
        title="Choose AI model — Auto uses the default routing"
        aria-expanded={expanded}
        aria-haspopup="listbox"
        style={{
          fontSize: 10,
          padding: '3px 8px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: selectedUnavailable ? 'rgba(239,68,68,0.12)' : 'rgba(129,140,248,0.12)',
          border: `1px solid ${selectedUnavailable ? 'rgba(239,68,68,0.45)' : 'rgba(129,140,248,0.35)'}`,
          color: selectedUnavailable ? '#ef4444' : 'var(--text)',
          borderRadius: 6,
          fontFamily: 'inherit',
        }}
      >
        <Cpu size={11} />
        {selectedUnavailable ? <AlertTriangle size={11} /> : null}
        <span>{selected ? (selectedUnavailable ? `"${selected.model}" not available` : selected.label) : 'Model'}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {selectedUnavailable && (
        <span style={{ fontSize: 9, color: '#ef4444' }}>Selected model unavailable — using auto.</span>
      )}

      {loading && <span style={{ fontSize: 9, opacity: 0.6 }}>Loading…</span>}
      {loadError && !loading && <span style={{ fontSize: 9, color: '#f59e0b' }}>{loadError}</span>}

      {expanded && (
        <div
          role="listbox"
          aria-label="Available AI models"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            right: 8,
            zIndex: 500,
            minWidth: 220,
            maxHeight: 280,
            overflowY: 'auto',
            background: '#17181c',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            padding: 4,
          }}
        >
          {models.map(m => {
            const active = selectedModel === m.model;
            const unavailable = !m.available && m.id !== 'auto';
            return (
              <button
                key={m.id}
                role="option"
                aria-selected={active}
                onClick={() => { setSelectedModel(m.id === 'auto' ? 'auto' : m.model); setExpanded(false); }}
                title={unavailable ? `Not available (${m.status})` : m.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  textAlign: 'left',
                  padding: '5px 8px',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'inherit',
                  background: active ? 'rgba(96,165,250,0.18)' : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  color: unavailable ? '#f87171' : (active ? '#60a5fa' : '#e5e7eb'),
                  opacity: unavailable ? 0.85 : 1,
                }}
              >
                <span style={{ width: 12, display: 'inline-flex' }}>{active ? <Check size={11} /> : null}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                {unavailable ? (
                  <span style={{ fontSize: 9, color: '#f87171', flexShrink: 0 }}>offline</span>
                ) : m.local ? (
                  <span style={{ fontSize: 9, color: '#34d399', flexShrink: 0 }}>local</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}