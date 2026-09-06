import { useState, useEffect, useRef } from 'react';
import {
  Zap, Upload, Search as SearchIcon, BarChart3, AlertTriangle,
  Loader, CheckCircle, XCircle, ClipboardList, Play,
  Wrench, RotateCcw, Pencil, Trash2, Bookmark, BookmarkCheck,
} from 'lucide-react';
import type { ChatMessage, PlanCard, ToolEvent, AiRecipe } from '@/shared/chat';
import { authHeaders } from '@/context/AuthContext';
import { StreamingMarkdownRenderer } from '@/lib/advancedChat';
import { RichMarkdown } from './RichMarkdown';
import { formatISTTime } from '@/lib/formatTime';
import { PlanCardView, SubAgentActivityView, ArtifactView, ToolApprovalView, TraceExpander } from './AdvancedChatViews';
import { StudyAreaPrompt } from './StudyAreaPrompt';
import { useChatStore } from '@/store/chatStore';

interface ChatMessageRowProps {
  msg: ChatMessage;
  idx: number;
  isLast: boolean;
  aiTyping: boolean;
  streamingRenderer: StreamingMarkdownRenderer;
  focusLocation?: (lat: number, lon: number, opts?: Record<string, unknown>) => void;
  toggleLayer?: (id: string) => void;
  executePlanFromCard?: (plan: PlanCard, msgId: number) => void | Promise<void>;
  togglePlanStep?: (msgId: number, stepId: string) => void;
  rerunWithParam?: (msg: ChatMessage, param: string, value: number) => void;
  resumeMessage?: (msg: ChatMessage) => void | Promise<void>;
  sendAI?: (msg?: string, opts?: { force?: boolean; regen?: boolean }) => void | Promise<void>;
  onEditMessage?: (content: string, messageId: number) => void;
}

/** Compact `key=value` rendering for tool-call args — legible during
 *  streaming instead of a raw JSON dump. Errors are always shown in full. */
function formatArgValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as object);
    return `{${keys.length} keys}`;
  }
  return String(v);
}

const MAX_VISIBLE_ARGS = 3;
const ARG_VALUE_MAX = 26;

function ToolEventRow({ ev }: { ev: ToolEvent }) {
  const [showAllArgs, setShowAllArgs] = useState(false);
  const icon = ev.status === 'pending'
    ? <Loader size={12} className="spin" />
    : ev.status === 'success'
      ? <CheckCircle size={12} />
      : ev.status === 'error'
        ? <XCircle size={12} />
        : <AlertTriangle size={12} />;
  const argEntries = Object.entries(ev.args ?? {});
  const visibleArgs = showAllArgs ? argEntries : argEntries.slice(0, MAX_VISIBLE_ARGS);
  const hiddenCount = argEntries.length - visibleArgs.length;
  return (
    <div className={`tool-event ${ev.status}`}>
      <span className="te-icon" aria-hidden="true">{icon}</span>
      <Wrench size={11} className="te-wrench" aria-hidden="true" />
      <span className="te-name">{ev.name}</span>
      {argEntries.length > 0 && (
        <span className="te-args">
          {visibleArgs.map(([k, v]) => {
            const val = formatArgValue(v);
            const clipped = val.length > ARG_VALUE_MAX ? `${val.slice(0, ARG_VALUE_MAX - 1)}…` : val;
            return (
              <span key={k} className="te-arg" title={`${k}: ${val}`}>
                <span className="te-arg-k">{k}</span>
                <span className="te-arg-v">{clipped}</span>
              </span>
            );
          })}
          {argEntries.length > MAX_VISIBLE_ARGS && (
            <button
              type="button"
              className="te-arg-more"
              onClick={() => setShowAllArgs(p => !p)}
              aria-expanded={showAllArgs}
            >
              {showAllArgs ? 'less' : `+${hiddenCount}`}
            </button>
          )}
        </span>
      )}
      {ev.error && <span className="te-error">{ev.error}</span>}
    </div>
  );
}

export function ChatMessageRow({
  msg, idx, isLast, aiTyping, streamingRenderer, focusLocation, toggleLayer,
  executePlanFromCard, togglePlanStep, rerunWithParam, resumeMessage,
  sendAI, onEditMessage,
}: ChatMessageRowProps) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { updateMessage } = useChatStore();

  const handleSaveRecipe = async () => {
    const recipe = msg.recipe as AiRecipe | undefined;
    if (!recipe || saving || saved) return;
    setSaving(true);
    setSaveError(null);
    try {
      const resp = await fetch('/api/ai-patterns/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(recipe),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || `Save failed (${resp.status})`);
      setSaved(true);
      updateMessage(msg.id, { patternId: data?.pattern?.id });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = () => {
    if (!msg.content) return;
    navigator.clipboard.writeText(msg.content.replace(/## COMMANDS[\s\S]*/, '').trim());
    setCopied(true);
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const handleEdit = () => {
    onEditMessage?.(msg.content, msg.id);
  };

  const handleRegenerate = () => {
    if (aiTyping) return;
    const all = useChatStore.getState().aiMessages;
    // Re-send the user prompt that produced this assistant message, replacing
    // it (and anything after it) in place rather than appending a new turn.
    for (let i = idx - 1; i >= 0; i--) {
      if (all[i].role === 'user') {
        useChatStore.getState().setAiMessages(prev => prev.slice(0, idx));
        sendAI?.(all[i].content, { regen: true });
        return;
      }
    }
  };

  const handleDelete = () => {
    // Never delete the in-flight streamed message — the Stop button owns it.
    if (isLast && aiTyping) return;
    useChatStore.getState().setAiMessages(prev => prev.filter(m => m.id !== msg.id));
  };

  const renderCommandChips = (
    commands: ChatMessage['commands'],
    focusLocation?: (lat: number, lon: number, opts?: Record<string, unknown>) => void,
    toggleLayer?: (id: string) => void,
  ) => {
    if (!commands || commands.length === 0) return null;
    const cmdChips: Array<{ label: string; action: string; lat?: number; lon?: number; layerId?: string }> = [];
    for (const cmd of commands) {
      if (cmd.action === 'flyTo' && cmd.lat != null && cmd.lon != null) {
        cmdChips.push({ label: cmd.label || 'Fly', action: 'flyTo', lat: cmd.lat, lon: cmd.lon });
      }
      if (cmd.action === 'toggleLayer' && cmd.layerId) {
        cmdChips.push({ label: cmd.layerId, action: 'toggleLayer', layerId: cmd.layerId });
      }
    }
    if (cmdChips.length === 0) return null;
    return (
      <div className="msg-commands">
        {cmdChips.map((chip, i) => (
          <button key={i} className="ai-chip command-chip"
            onClick={() => {
              if (chip.action === 'flyTo' && chip.lat && chip.lon) focusLocation?.(chip.lat, chip.lon, { label: chip.label || 'Location', color: '#60a5fa', height: 20000 });
              if (chip.action === 'toggleLayer' && chip.layerId) toggleLayer?.(chip.layerId);
            }}>{chip.label}</button>
        ))}
      </div>
    );
  };

  const updateToolEvent = (msgId: number, toolName: string, updates: Partial<ToolEvent>) => {
    updateMessage(msgId, {
      toolEvents: msg.toolEvents?.map(ev =>
        ev.name === toolName ? { ...ev, ...updates } : ev
      ),
    });
  };

  return (
    <div className={`ai-msg ${msg.role}${msg.type === 'code-result' || msg.type === 'pipeline' || msg.type === 'data-analysis' ? ' code-result' : ''}${msg.type === 'image' ? ' image-msg' : ''}`}>
      {msg.role === 'assistant' ? (
        <div>
          {msg.type === 'pipeline' && <div className="msg-label"><Zap size={13} /> Computation Pipeline Result</div>}
          {msg.type === 'upload' && <div className="msg-label upload"><Upload size={13} /> File Upload</div>}
          {msg.type === 'vision' && <div className="msg-label vision"><SearchIcon size={13} /> Vision Analysis</div>}
          {msg.type === 'data-analysis' && <div className="msg-label data"><BarChart3 size={13} /> Data Analysis</div>}
          {msg.type === 'error' && <div className="msg-label error"><AlertTriangle size={13} /> Error</div>}

          <RichMarkdown
            content={msg.content}
            isStreaming={aiTyping && isLast}
            streamingRenderer={streamingRenderer}
          />

          {msg.toolEvents && msg.toolEvents.length > 0 && (
            <div className="tool-events">
              {msg.toolEvents.map((ev, i) => (
                <ToolEventRow key={i} ev={ev} />
              ))}
            </div>
          )}

          {msg.subAgents && msg.subAgents.length > 0 && <SubAgentActivityView activities={msg.subAgents} />}
          {msg.plan && <PlanCardView plan={msg.plan} onExecute={(p) => executePlanFromCard?.(p, msg.id)} onToggleStep={(sid) => togglePlanStep?.(msg.id, sid)} />}

          {msg.studyAreaRequest && <StudyAreaPrompt request={msg.studyAreaRequest} sendAI={sendAI!} />}

          {msg.toolEvents && msg.toolEvents.filter(e => e.approvalRequired || e.status === 'blocked').map((ev, i) => (
            <ToolApprovalView key={`apr_${i}`} event={ev} onApprove={(result) => updateToolEvent(msg.id, ev.name, { status: 'success', result })} onDeny={() => updateToolEvent(msg.id, ev.name, { status: 'error', error: 'Denied by user' })} />
          ))}

          {msg.artifacts && msg.artifacts.map((art, i) => (
            <ArtifactView key={`art_${i}`} artifact={art} onRerun={(param, val) => rerunWithParam?.(msg, param, val)} />
          ))}

          {renderCommandChips(msg.commands, focusLocation, toggleLayer)}

          {msg.modelTier && (
            <span className="msg-tier-badge">{msg.modelTier}</span>
          )}

          {msg.replayed && (
            <span className="msg-replayed-badge">Replayed</span>
          )}

          {msg.recipe && !aiTyping && !saved && (
            <button
              className="msg-save-recipe"
              onClick={handleSaveRecipe}
              disabled={saving}
              title="Save this workflow as a reusable pattern"
            >
              {saving ? <Loader size={11} className="spin" /> : <Bookmark size={11} />} Save workflow
            </button>
          )}
          {saved && (
            <span className="msg-recipe-saved">
              <BookmarkCheck size={11} /> Workflow saved
            </span>
          )}
          {saveError && (
            <span className="msg-save-error">{saveError}</span>
          )}

          {msg.traceId && <TraceExpander traceId={msg.traceId} />}

          {msg.resumable && msg.content && msg.content.length > 50 && !aiTyping && (
            <button
              className="msg-resume-btn"
              onClick={() => resumeMessage?.(msg)}
              title="Continue generating this response"
            >
              <Play size={11} /> Resume
            </button>
          )}
        </div>
      ) : (
        <>
          {msg.content}
          {msg.images && msg.images.length > 0 && (
            <div className="chat-image-container">
              {msg.images.map((img, i) => (
                <img key={i} src={img.dataUrl} alt={img.fileName} className="chat-image" />
              ))}
            </div>
          )}
        </>
      )}

      {msg.content && (
        <div className="msg-actions">
          {msg.timestamp && <span className="msg-time">{formatISTTime(msg.timestamp)}</span>}
          <button className="msg-action" onClick={handleCopy} title="Copy message">
            <ClipboardList size={11} /> {copied ? 'Copied!' : 'Copy'}
          </button>
          {msg.role === 'user' && (
            <button className="msg-action" onClick={handleEdit} title="Edit message">
              <Pencil size={11} /> Edit
            </button>
          )}
          {msg.role === 'assistant' && idx > 0 && !aiTyping && (
            <button className="msg-action" onClick={handleRegenerate} title="Regenerate response">
              <RotateCcw size={11} /> Regenerate
            </button>
          )}
          <button className="msg-action danger" onClick={handleDelete} title="Delete message">
            <Trash2 size={11} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
