import { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, Check, AlertTriangle, ChevronDown } from 'lucide-react';
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
 * - If a selected model becomes unavailable, shows a notice (honest fallback).
 * - Full keyboard support: Enter/Space/Down opens, arrows move the active
 *   option, Enter selects, Escape closes and restores focus.
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

  const open = useCallback(() => {
    void loadModels();
    const selIdx = Math.max(0, models.findIndex(m => (m.id === 'auto' ? selectedModel === 'auto' : m.model === selectedModel)));
    setActiveIndex(selIdx);
    setExpanded(true);
  }, [loadModels, models, selectedModel]);

  const selectAt = useCallback((idx: number) => {
    const m = models[idx];
    if (!m) return;
    setSelectedModel(m.id === 'auto' ? 'auto' : m.model);
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
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(models.length - 1);
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

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!expanded || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, expanded]);

  const selected = selectedModel === 'auto' ? null : models.find(m => m.model === selectedModel) ?? null;
  const selectedUnavailable = selected && !selected.available;

  return (
    <div className="model-selector-wrap">
      <button
        ref={triggerRef}
        className={`model-selector-trigger${selectedUnavailable ? ' unavailable' : ''}`}
        onClick={() => (expanded ? setExpanded(false) : open())}
        onKeyDown={onTriggerKeyDown}
        title="Choose AI model — Auto uses the default routing"
        aria-expanded={expanded}
        aria-haspopup="listbox"
      >
        <Cpu size={12} />
        {selectedUnavailable ? <AlertTriangle size={12} /> : null}
        <span>{selectedUnavailable ? `"${selected?.model}" not available` : selected ? selected.label : 'Model'}</span>
        <ChevronDown size={11} style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }} />
      </button>

      {selectedUnavailable && (
        <span className="model-selector-notice">Selected model unavailable — using auto.</span>
      )}

      {loading && <span className="model-selector-notice">Loading…</span>}
      {loadError && !loading && <span className="model-selector-notice warn">{loadError}</span>}

      {expanded && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Available AI models"
          aria-activedescendant={`model-opt-${activeIndex}`}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="model-selector-list"
        >
          {models.map((m, idx) => {
            const active = selectedModel === m.model || (m.id === 'auto' && selectedModel === 'auto');
            const unavailable = !m.available && m.id !== 'auto';
            return (
              <button
                key={m.id}
                id={`model-opt-${idx}`}
                data-idx={idx}
                role="option"
                aria-selected={active}
                className={`model-option${active ? ' active' : ''}${unavailable ? ' unavailable' : ''}${idx === activeIndex ? ' focused' : ''}`}
                onClick={() => selectAt(idx)}
                onMouseEnter={() => setActiveIndex(idx)}
                title={unavailable ? `Not available (${m.status})` : m.label}
              >
                <span className="model-option-check">{active ? <Check size={12} /> : null}</span>
                <span className="model-option-label">{m.label}</span>
                {unavailable ? (
                  <span className="model-option-tag offline">offline</span>
                ) : m.local ? (
                  <span className="model-option-tag local">local</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
