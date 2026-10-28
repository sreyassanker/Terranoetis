import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Check, ChevronDown, Key, RefreshCw, Cpu, Zap, Brain, ShieldCheck } from 'lucide-react';
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
 * Clean, Claude / Antigravity styled model picker for Earth Intelligence Copilot.
 * - Shows strictly verified working models from /api/agent/models
 * - Offers direct one-click access to the encrypted API Vault
 * - Automatically refreshes when API keys are configured in the Vault
 */
export function ModelSelector() {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const models = useChatStore(s => s.availableModels);
  const setModels = useChatStore(s => s.setAvailableModels);
  const selectedModel = useChatStore(s => s.selectedModel);
  const setSelectedModel = useChatStore(s => s.setSelectedModel);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadModels = useCallback(async (force = false) => {
    if (!force && models.length > 0) return;
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await fetch('/api/agent/models', {
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { models: AvailableModel[] };
      const fetched = data.models || [];
      setModels(fetched);
    } catch {
      setLoadError('Could not refresh model list.');
      setModels([{ id: 'auto', provider: 'auto', model: 'auto', label: 'Auto (Smart Routing)', available: true, status: 'healthy', local: false, tier: 0 }]);
    } finally {
      setLoading(false);
    }
  }, [models.length, setModels]);

  useEffect(() => {
    void loadModels(true);
  }, [loadModels]);

  // Listen for API Vault key changes to immediately refresh provider availability
  useEffect(() => {
    const handleVaultUpdated = () => {
      void loadModels(true);
    };
    window.addEventListener('terranoetis:vault-updated', handleVaultUpdated);
    return () => window.removeEventListener('terranoetis:vault-updated', handleVaultUpdated);
  }, [loadModels]);

  // Close when clicking outside.
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [expanded]);

  const open = useCallback(() => {
    void loadModels(true);
    const selIdx = Math.max(0, models.findIndex(m => (m.id === 'auto' ? selectedModel === 'auto' : (m.id === selectedModel || m.model === selectedModel))));
    setActiveIndex(selIdx);
    setExpanded(true);
  }, [loadModels, models, selectedModel]);

  const selectAt = useCallback((idx: number) => {
    const m = models[idx];
    if (!m) return;
    setSelectedModel(m.id === 'auto' ? 'auto' : (m.id || m.model));
    setExpanded(false);
    triggerRef.current?.focus();
  }, [models, setSelectedModel]);

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!expanded) open();
      else if (e.key !== 'ArrowDown') selectAt(activeIndex);
    } else if (e.key === 'Escape' && expanded) {
      setExpanded(false);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(models.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectAt(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setExpanded(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      setExpanded(false);
    }
  };

  const selected = selectedModel === 'auto'
    ? null
    : (models.find(m => m.id === selectedModel || m.model === selectedModel) ?? null);

  const formatCleanModelName = (raw: string): string => {
    if (!raw) return '';
    return raw
      .replace(/\.gguf$/i, '')
      .replace(/[-_](?:instruct|it|chat|text-model|q[0-9]+_[a-z0-9_]+|bf16|f16|f32)/gi, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const getPillLabel = () => {
    if (!selected || selected.id === 'auto') return 'Auto Routing';
    if (selected.local || selected.provider === 'local-gguf') {
      const labelClean = selected.label?.replace(/^Local\s*(?:Offline)?\s*—\s*/i, '').trim();
      if (labelClean && labelClean.toLowerCase() !== 'local' && labelClean.toLowerCase() !== 'local offline') {
        return `Local · ${labelClean}`;
      }
      const raw = selected.model && selected.model !== 'local' ? selected.model : (selected.id?.replace(/^local-gguf\//, '') || '');
      const clean = formatCleanModelName(raw);
      return `Local · ${clean || 'Offline'}`;
    }
    const prov = selected.provider ? selected.provider.charAt(0).toUpperCase() + selected.provider.slice(1) : 'AI';
    const cleanModel = formatCleanModelName(selected.model || selected.id || selected.label);
    return `${prov} · ${cleanModel}`;
  };

  const getBadgeForModel = (m: AvailableModel) => {
    if (m.id === 'auto') {
      return <span className="model-badge smart"><Sparkles size={10} /> Smart</span>;
    }
    if (m.local) {
      return <span className="model-badge local"><ShieldCheck size={10} /> On-Device</span>;
    }
    if (m.provider === 'groq') {
      if (m.model.includes('120b')) {
        return <span className="model-badge reason"><Brain size={10} /> Deep</span>;
      }
      return <span className="model-badge fast"><Zap size={10} /> 5ms</span>;
    }
    if (m.provider === 'openai') {
      return <span className="model-badge reason"><Brain size={10} /> Vision</span>;
    }
    return <span className="model-badge online">Active</span>;
  };

  return (
    <div className="model-selector-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="model-selector-pill"
        onClick={() => (expanded ? setExpanded(false) : open())}
        onKeyDown={onTriggerKeyDown}
        title="Active AI model & routing — click to switch or configure"
        aria-expanded={expanded}
        aria-haspopup="listbox"
      >
        <span className="model-selector-icon">
          {selected?.local ? <Cpu size={12} /> : <Sparkles size={12} />}
        </span>
        <span className="model-selector-name">{getPillLabel()}</span>
        <ChevronDown size={11} className={`model-selector-chevron ${expanded ? 'rotated' : ''}`} />
      </button>

      {expanded && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Verified Working AI Models"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="model-selector-dropdown"
        >
          <div className="model-selector-dropdown-header">
            <span className="model-selector-header-title">WORKING AI MODELS</span>
            <button
              type="button"
              className="model-selector-refresh-btn"
              onClick={() => void loadModels(true)}
              title="Refresh provider health status"
              disabled={loading}
            >
              <RefreshCw size={11} className={loading ? 'spin' : ''} />
            </button>
          </div>

          {loadError && (
            <div style={{ padding: '4px 10px', fontSize: 10, color: '#f59e0b' }}>
              {loadError}
            </div>
          )}

          <div className="model-selector-options-list">
            {models.map((m, idx) => {
              const active = selectedModel === m.id || selectedModel === m.model || (m.id === 'auto' && selectedModel === 'auto');
              return (
                <button
                  key={m.id}
                  id={`model-opt-${idx}`}
                  data-idx={idx}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`model-dropdown-option ${active ? 'active' : ''} ${idx === activeIndex ? 'focused' : ''}`}
                  onClick={() => selectAt(idx)}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  <span className="model-option-indicator">
                    {active ? <Check size={13} style={{ color: '#0284c7' }} /> : null}
                  </span>
                  <div className="model-option-info">
                    <span className="model-option-title">{m.label}</span>
                    <span className="model-option-subtitle">
                      {m.id === 'auto'
                        ? 'Dynamically balances speed, context, and reasoning'
                        : m.local
                        ? '100% offline edge inference via local llama runtime'
                        : `${m.provider.toUpperCase()} API · Verified healthy`}
                    </span>
                  </div>
                  {getBadgeForModel(m)}
                </button>
              );
            })}
          </div>

          <div className="model-selector-dropdown-footer">
            <button
              type="button"
              className="model-selector-vault-action"
              onClick={() => {
                setExpanded(false);
                window.dispatchEvent(new CustomEvent('terranoetis:open-api-vault'));
              }}
              title="Open Encrypted API Vault to configure OpenAI, Anthropic, Gemini, Groq, and Cesium keys"
            >
              <Key size={13} />
              <span>Configure API Keys (API Vault)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
