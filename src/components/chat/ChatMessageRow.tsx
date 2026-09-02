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
      <div className="msg-commands" style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        {cmdChips.map((chip, i) => (
          <span key={i} className="ai-chip command-chip" style={{ fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}
            onClick={() => {
              if (chip.action === 'flyTo' && chip.lat && chip.lon) focusLocation?.(chip.lat, chip.lon, { label: chip.label || 'Location', color: '#60a5fa', height: 20000 });
              if (chip.action === 'toggleLayer' && chip.layerId) toggleLayer?.(chip.layerId);
            }}>{chip.label}</span>
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
          {msg.type === 'pipeline' && <div className="msg-label"><Zap size={12} style={{ display: 'inline', marginRight: 3 }} /> Computation Pipeline Result</div>}
          {msg.type === 'upload' && <div className="msg-label" style={{ color: '#60a5fa' }}><Upload size={12} style={{ display: 'inline', marginRight: 3 }} /> File Upload</div>}
          {msg.type === 'vision' && <div className="msg-label" style={{ color: '#a78bfa' }}><SearchIcon size={12} style={{ display: 'inline', marginRight: 3 }} /> Vision Analysis</div>}
          {msg.type === 'data-analysis' && <div className="msg-label" style={{ color: '#34d399' }}><BarChart3 size={12} style={{ display: 'inline', marginRight: 3 }} /> Data Analysis</div>}
          {msg.type === 'error' && <div className="msg-label" style={{ color: '#ef4444' }}><AlertTriangle size={12} style={{ display: 'inline', marginRight: 3 }} /> Error</div>}

          <RichMarkdown
            content={msg.content}
            isStreaming={aiTyping && isLast}
            streamingRenderer={streamingRenderer}
          />

          {msg.toolEvents && msg.toolEvents.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
              {msg.toolEvents.map((ev, i) => {
                const icon = ev.status === 'pending'
                  ? <Loader size={11} className="spin" style={{ color: '#60a5fa' }} />
                  : ev.status === 'success'
                    ? <CheckCircle size={11} style={{ color: '#34d399' }} />
                    : ev.status === 'error'
                      ? <XCircle size={11} style={{ color: '#ef4444' }} />
                      : <AlertTriangle size={11} style={{ color: '#eab308' }} />;
                const bg = ev.status === 'success' ? 'rgba(52,211,153,0.08)'
                  : ev.status === 'error' ? 'rgba(239,68,68,0.08)'
                    : ev.status === 'unknown' ? 'rgba(234,179,8,0.08)'
                      : 'rgba(96,165,250,0.08)';
                const bd = ev.status === 'success' ? 'rgba(52,211,153,0.25)'
                  : ev.status === 'error' ? 'rgba(239,68,68,0.25)'
                    : ev.status === 'unknown' ? 'rgba(234,179,8,0.25)'
                      : 'rgba(96,165,250,0.25)';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, padding: '3px 8px', borderRadius: 6, background: bg, border: `1px solid ${bd}` }}>
                    {icon}
                    <Wrench size={10} style={{ color: 'var(--text-dim)' }} />
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{ev.name}</span>
                    {ev.args && Object.keys(ev.args).length > 0 && (
                      <span style={{ color: 'var(--text-dim)' }}>{JSON.stringify(ev.args)}</span>
                    )}
                    {ev.error && <span style={{ color: '#ef4444' }}>{ev.error}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {msg.subAgents && msg.subAgents.length > 0 && <SubAgentActivityView activities={msg.subAgents} />}
          {msg.plan && <PlanCardView plan={msg.plan} onExecute={(p) => executePlanFromCard?.(p, msg.id)} onToggleStep={(sid) => togglePlanStep?.(msg.id, sid)} />}

          {msg.studyAreaRequest && <StudyAreaPrompt request={msg.studyAreaRequest} sendAI={sendAI!} />}

          {msg.toolEvents && msg.toolEvents.filter(e => e.approvalRequired || e.status === 'blocked').map((ev, i) => (
            <ToolApprovalView key={`apr_${i}`} event={ev} onApprove={() => updateToolEvent(msg.id, ev.name, { status: 'success' })} onDeny={() => updateToolEvent(msg.id, ev.name, { status: 'error', error: 'Denied by user' })} />
          ))}

          {msg.artifacts && msg.artifacts.map((art, i) => (
            <ArtifactView key={`art_${i}`} artifact={art} onRerun={(param, val) => rerunWithParam?.(msg, param, val)} />
          ))}

          {renderCommandChips(msg.commands, focusLocation, toggleLayer)}

          {msg.modelTier && (
            <span style={{ fontSize: 10, color: '#64748b', background: 'rgba(100,116,139,0.1)', borderRadius: 3, padding: '1px 5px', marginTop: 2, display: 'inline-block' }}>{msg.modelTier}</span>
          )}

          {msg.replayed && (
            <span style={{ fontSize: 10, color: '#34d399', background: 'rgba(52,211,153,0.1)', borderRadius: 3, padding: '1px 5px', marginTop: 2, display: 'inline-block', marginLeft: 4 }}>Replayed</span>
          )}

          {msg.recipe && !aiTyping && !saved && (
            <button
              onClick={handleSaveRecipe}
              disabled={saving}
              style={{ fontSize: 10, color: saving ? '#64748b' : '#818cf8', background: saving ? 'rgba(100,116,139,0.1)' : 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.35)', borderRadius: 4, padding: '2px 8px', cursor: saving ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 4, marginLeft: 4 }}
              title="Save this workflow as a reusable pattern"
            >
              {saving ? <Loader size={10} className="spin" /> : <Bookmark size={10} />} Save workflow
            </button>
          )}
          {saved && (
            <span style={{ fontSize: 10, color: '#34d399', background: 'rgba(52,211,153,0.1)', borderRadius: 3, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 4, marginLeft: 4 }}>
              <BookmarkCheck size={10} /> Workflow saved
            </span>
          )}
          {saveError && (
            <span style={{ fontSize: 10, color: '#ef4444', marginLeft: 4 }}>{saveError}</span>
          )}

          {msg.traceId && <TraceExpander traceId={msg.traceId} />}

          {msg.resumable && msg.content && msg.content.length > 50 && !aiTyping && (
            <button
              onClick={() => resumeMessage?.(msg)}
              style={{ fontSize: 10, color: 'var(--text-dim)', background: 'none', border: '1px solid transparent', cursor: 'pointer', padding: '2px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 4 }}
              title="Continue generating this response"
            >
              <Play size={10} /> Resume
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
            <ClipboardList size={10} /> {copied ? 'Copied!' : 'Copy'}
          </button>
          {msg.role === 'user' && (
            <button className="msg-action" onClick={handleEdit} title="Edit message">
              <Pencil size={10} /> Edit
            </button>
          )}
          {msg.role === 'assistant' && idx > 0 && !aiTyping && (
            <button className="msg-action" onClick={handleRegenerate} title="Regenerate response">
              <RotateCcw size={10} /> Regenerate
            </button>
          )}
          <button className="msg-action danger" onClick={handleDelete} title="Delete message">
            <Trash2 size={10} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
