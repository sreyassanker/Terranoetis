import { useCallback, useEffect, useRef } from 'react';
import { Bot, History, Plus, RotateCcw, Trash2, Send, Square, Paperclip, Image as ImageIcon, FileSpreadsheet, Volume2, Link, FileDown, CheckCircle, Mic, ChevronDown, ChevronUp } from 'lucide-react';

import Panel from '@/components/ui/Panel';
import { useChatStore } from '@/store/chatStore';
import type { ChatMessage, PlanCard } from '@/lib/chatStore';
import { queueMessage, isOnline } from '@/lib/offlineChat';
import { HumanOverrideBanner } from '@/components/explainability/index';
import { exportConversationAsPDF } from '@/lib/pdfReport';
import ChatPanelContent from './ChatPanelContent';
import { ChatTabs } from './ChatTabs';
import { ModelSelector } from './ModelSelector';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useChatPanelState, useStreamingRenderer } from '@/hooks/useChatSelectors';
import type { VirtualizedMessageListHandle } from './VirtualizedMessageList';

const GLASS_BTN_STYLE: React.CSSProperties = {
  background: 'rgba(129, 140, 248, 0.12)',
  border: '1px solid rgba(129, 140, 248, 0.35)',
  backdropFilter: 'blur(12px) saturate(160%)',
  WebkitBackdropFilter: 'blur(12px) saturate(160%)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
};

// Resize bounds (kept in sync with store/chatStore.ts loadPanelState).
const MIN_PANEL_W = 300;
const MAX_PANEL_W = 580;
const MIN_PANEL_H = 320;
const PANEL_H_OFFSET = 120;

export function ChatPanel({
  getPanelZIndex,
  focusLocation,
  toggleLayer,
  activeLayers,
  sendAI,
  handleFileUpload,
  handleImageUpload,
  handleDataFileUpload,
  toggleVoiceInput,
  voiceSupported,
  buildSessionShareLink,
  showNotification,
  newChat,
  undoLastAgentAction,
  clearAllAgentActions: _clearAllAgentActions,
  deleteCurrentChat,
  cleanupThinkingSteps,
  abortControllerRef,
  virtualizedChatRef,
  speakResponse,
  stopSpeaking,
  executePlanFromCard,
  togglePlanStep,
  rerunWithParam,
  resumeMessage,
}: {
  getPanelZIndex: (id: string, base: number) => number;
  focusLocation: (lat: number, lon: number, opts?: { label?: string; color?: string; height?: number; duration?: number }) => void;
  toggleLayer: (id: string) => void;
  activeLayers: Array<{ id: string; label: string }>;
  sendAI: (msg?: string, opts?: { force?: boolean; regen?: boolean }) => Promise<void>;
  handleFileUpload: (file: File) => void;
  handleImageUpload: (file: File) => void;
  handleDataFileUpload: (file: File) => void;
  toggleVoiceInput: () => void;
  voiceSupported: boolean;
  buildSessionShareLink: () => Promise<string>;
  showNotification: (msg: string, type: string) => void;
  newChat: () => void;
  undoLastAgentAction: () => void;
  clearAllAgentActions: () => void;
  deleteCurrentChat: () => void | Promise<void>;
  cleanupThinkingSteps: (force?: boolean) => void;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  virtualizedChatRef: React.MutableRefObject<VirtualizedMessageListHandle | null>;
  speakResponse: (text: string) => void;
  stopSpeaking: () => void;
  executePlanFromCard: (plan: PlanCard, msgId: number) => void | Promise<void>;
  togglePlanStep: (msgId: number, stepId: string) => void;
  rerunWithParam: (msg: ChatMessage, param: string, value: number) => void;
  resumeMessage: (msg: ChatMessage) => void | Promise<void>;
}) {
  const {
    showAI, setShowAI, aiMessages, aiTyping, aiInput, setAiInput,
    editingMessageId,
    showChatHistory, setShowChatHistory,
    adaptiveSuggestions,
    pdfExporting, setPdfExporting,
    sandboxWorkspaceId, uploadedFiles,
    isListening, speaking,
    sessionId, selectedTier,
    showShareDialog, setShowShareDialog, shareUrl, setShareUrl,
    agentSteps, pipelineProgress,
    chatImages, setChatImages,
    chatCollapsed, setChatCollapsed,
    chatPanelWidth, setChatPanelWidth,
    chatPanelHeight, setChatPanelHeight,
  } = useChatPanelState();

  const streamingRenderer = useStreamingRenderer();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Collapse the composer back to one line after the input is cleared (e.g. send).
  useEffect(() => {
    if (aiInput === '' && inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [aiInput]);

  // Stable handler so ChatPanelContent's renderMessage useCallback isn't
  // invalidated on every panel re-render (which would re-render all rows).
  const handleEditMessage = useCallback((content: string, messageId: number) => {
    setAiInput(content);
    useChatStore.getState().setEditingMessageId(messageId);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setAiInput]);

  // Persist panel layout (width / height / collapsed) across sessions.
  useEffect(() => {
    try {
      window.localStorage.setItem('chat-panel-state', JSON.stringify({
        width: chatPanelWidth,
        height: chatPanelHeight,
        collapsed: chatCollapsed,
      }));
    } catch { /* ignore quota / privacy-mode errors */ }
  }, [chatPanelWidth, chatPanelHeight, chatCollapsed]);

  // Drag-to-resize: left edge resizes width, bottom edge resizes height.
  const dragRef = useRef<{ kind: 'width' | 'height'; start: number; startValue: number } | null>(null);

  const onHandleMouseDown = useCallback((kind: 'width' | 'height') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startValue = kind === 'width'
      ? chatPanelWidth
      : (chatPanelHeight ?? Math.max(window.innerHeight - 160, MIN_PANEL_H));
    dragRef.current = { kind, start: kind === 'width' ? e.clientX : e.clientY, startValue };
    document.body.style.cursor = kind === 'width' ? 'ew-resize' : 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [chatPanelWidth, chatPanelHeight]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'width') {
        // Panel hugs the right edge: dragging left makes it wider.
        const next = Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, d.startValue + (d.start - e.clientX)));
        setChatPanelWidth(next);
      } else {
        const next = Math.min(Math.max(MIN_PANEL_H, window.innerHeight - PANEL_H_OFFSET), Math.max(MIN_PANEL_H, d.startValue + (e.clientY - d.start)));
        setChatPanelHeight(next);
      }
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // Covers the mouse released outside the browser window.
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
      // Never leave the body stuck in resize mode if unmounted mid-drag.
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [setChatPanelWidth, setChatPanelHeight]);

  if (!showAI) return null;

  return (
    <div className="ai-panel-light" style={{ position: 'absolute', top: 60, right: 10, zIndex: getPanelZIndex('ai', 110), width: chatPanelWidth }}>
      {!chatCollapsed && (
        <>
          <div className="chat-resize-handle chat-resize-w" onMouseDown={onHandleMouseDown('width')} aria-hidden="true" title="Drag to resize width" />
          <div className="chat-resize-handle chat-resize-h" onMouseDown={onHandleMouseDown('height')} aria-hidden="true" title="Drag to resize height" />
        </>
      )}
      <Panel
        title="EARTH INTELLIGENCE AI"
        icon={<Bot size={14} />}
        accentColor="#d97757"
        iconColor="#cc785c"
        titleColor="#9c6b55"
        onClose={() => setShowAI(false)}
        headerExtra={
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {chatCollapsed && aiTyping && <span className="chat-collapsed-indicator" aria-hidden="true" />}
            <button onClick={() => setShowChatHistory(!showChatHistory)} title="Chat History" aria-label="Chat history" style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1 }}><History size={14} /></button>
            <button onClick={newChat} title="New Chat" aria-label="New chat" style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1 }}><Plus size={14} /></button>
            <button onClick={undoLastAgentAction} title="Undo last AI action" aria-label="Undo last AI action" style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1 }}><RotateCcw size={14} /></button>
            <button onClick={() => { if (window.confirm('Delete this chat?')) deleteCurrentChat(); }} title="Delete current chat" aria-label="Delete current chat" style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1 }}><Trash2 size={14} /></button>
            <button
              onClick={() => setChatCollapsed(!chatCollapsed)}
              title={chatCollapsed ? 'Expand chat panel' : 'Minimize chat panel'}
              aria-label={chatCollapsed ? 'Expand chat panel' : 'Minimize chat panel'}
              aria-expanded={!chatCollapsed}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
            >
              {chatCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        }
        style={{
          height: chatCollapsed ? 44 : (chatPanelHeight ?? 'calc(100vh - 160px)'),
          maxHeight: chatCollapsed ? 44 : (chatPanelHeight ?? 'calc(100vh - 160px)'),
          background: '#faf9f5',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          border: '1px solid rgba(0,0,0,0.12)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          color: '#1f1e1d',
        }}
      >
        {!chatCollapsed && (
        <>
        <ChatTabs
          onBeforeTabSwitch={() => {
            // Abort any running stream before switching tabs.
            const activeTabId = useChatStore.getState().activeTabId;
            if (activeTabId) {
              useChatStore.getState().abortTabStream(activeTabId);
            }
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
            useChatStore.getState().setAiTyping(false);
            cleanupThinkingSteps(true);
          }}
        />
        <ErrorBoundary label="Chat Content">
          <ChatPanelContent
            aiMessages={aiMessages}
            aiTyping={aiTyping}
            streamingRenderer={streamingRenderer}
            virtualizedChatRef={virtualizedChatRef}
            agentSteps={agentSteps}
            pipelineProgress={pipelineProgress}
            focusLocation={focusLocation}
            toggleLayer={toggleLayer}
            executePlanFromCard={executePlanFromCard}
            togglePlanStep={togglePlanStep}
            rerunWithParam={rerunWithParam}
            resumeMessage={resumeMessage}
            sendAI={sendAI}
            onEditMessage={handleEditMessage}
          />
        </ErrorBoundary>

        <HumanOverrideBanner />

        {activeLayers.length > 0 && (
          <div className="ai-active-layers">
            <span className="ai-active-layers-label">Active layers</span>
            <div className="ai-active-layers-list">
              {activeLayers.map(layer => (
                <span
                  key={layer.id}
                  className="ai-active-layer-chip"
                  onClick={() => toggleLayer(layer.id)}
                  title={`Click to ${layer.id ? 'close' : 'open'} ${layer.label}`}
                >
                  {layer.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {sandboxWorkspaceId && uploadedFiles.length > 0 && (
          <div className="sandbox-file-upload">
            <span className="sandbox-workspace-badge">Workspace active</span>
            <span className="sandbox-file-name">{uploadedFiles.length} file(s)</span>
          </div>
        )}

        {aiMessages.length <= 1 && (
          <div className="ai-suggestion-chips">
            {(adaptiveSuggestions.length > 0 ? adaptiveSuggestions : [
              'Show earthquake data', 'Show wildfires', 'Aircraft near Delhi',
              'Analyze quake stats', 'Compute averages', 'Storm tracking',
            ]).map(chip => (
              <span key={chip} className="ai-chip" onClick={() => sendAI(chip)}>{chip}</span>
            ))}
          </div>
        )}

        {chatImages.length > 0 && (
          <div className="chat-image-previews" aria-label="Pending image uploads">
            {chatImages.map(img => (
              <div key={img.id} className="chat-image-preview">
                <img src={img.dataUrl} alt={img.fileName} />
                <button
                  onClick={() => setChatImages(prev => prev.filter(i => i.id !== img.id))}
                  aria-label={`Remove ${img.fileName}`}
                  title="Remove image"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="ai-input-wrap" role="region" aria-label="Chat composer">
          <button
            className={`ai-voice-btn ${isListening ? 'listening' : ''}`}
            onClick={toggleVoiceInput}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleVoiceInput(); }}}
            title={isListening ? 'Listening...' : 'Voice input'}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            aria-pressed={isListening}
            style={{
              display: voiceSupported ? 'flex' : 'none',
              ...GLASS_BTN_STYLE,
              background: isListening ? 'rgba(239,68,68,0.18)' : GLASS_BTN_STYLE.background,
              border: isListening ? '1px solid rgba(239,68,68,0.5)' : GLASS_BTN_STYLE.border,
              color: isListening ? '#ef4444' : undefined,
            }}
          >
            {isListening ? <Square size={13} fill="#ef4444" /> : <Mic size={14} />}
          </button>
          <textarea
            ref={inputRef}
            className="ai-input"
            placeholder={editingMessageId != null ? 'Edit your message — press Enter to apply and regenerate the reply' : 'Ask, analyze, compute, or upload data...'}
            value={aiInput}
            rows={1}
            onChange={e => setAiInput(e.target.value)}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return; // IME composition in progress
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); }
            }}
            aria-label="Chat message input"
            aria-describedby="chat-input-hint"
          />
          <span id="chat-input-hint" className="visually-hidden">Press Enter to send, Shift+Enter for new line</span>
          {aiTyping ? (
            <button
              className="ai-stop"
              onClick={() => {
                abortControllerRef.current?.abort();
                useChatStore.getState().setAiTyping(false);
                cleanupThinkingSteps(true);
              }}
              title="Stop response"
              aria-label="Stop AI response generation"
              style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Square size={12} /> Stop
            </button>
          ) : (
            <button className="ai-send" onClick={() => sendAI()} aria-label="Send message" title="Send">
              <Send size={14} />
            </button>
          )}
        </div>

        <div className="sandbox-file-upload" style={{ borderTop: '1px solid var(--border)', padding: '3px 8px', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="sandbox-file-btn" title="Upload data" aria-label="Upload data file" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', ...GLASS_BTN_STYLE }}>
            <Paperclip size={13} />
            <input type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
          </label>
          <label className="sandbox-file-btn" title="Upload image" aria-label="Upload image" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', ...GLASS_BTN_STYLE }}>
            <ImageIcon size={13} />
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
          </label>
          <label className="sandbox-file-btn" title="Analyze data file" aria-label="Analyze data file" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', ...GLASS_BTN_STYLE }}>
            <FileSpreadsheet size={13} />
            <input type="file" accept=".csv,.json,.geojson" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleDataFileUpload(f); }} />
          </label>
          <span className="toolbar-sep" aria-hidden="true" />
          <button
            className="sandbox-file-btn"
            title={speaking ? 'Stop reading' : 'Read last response aloud'}
            aria-label={speaking ? 'Stop reading response' : 'Read last response aloud'}
            onClick={speaking ? stopSpeaking : () => speakResponse(aiMessages.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '')}
            style={{
              ...GLASS_BTN_STYLE,
              background: speaking ? 'rgba(239,68,68,0.18)' : GLASS_BTN_STYLE.background,
              border: speaking ? '1px solid rgba(239,68,68,0.5)' : GLASS_BTN_STYLE.border,
              color: speaking ? '#ef4444' : undefined,
            }}
          >
            {speaking ? <Square size={13} fill="#ef4444" /> : <Volume2 size={13} />}
          </button>
          <button
            className="sandbox-file-btn"
            title="Share session"
            aria-label="Share session"
            disabled={aiMessages.length === 0 || !isOnline()}
            style={{ ...GLASS_BTN_STYLE, opacity: (aiMessages.length === 0 || !isOnline()) ? 0.4 : undefined, cursor: (aiMessages.length === 0 || !isOnline()) ? 'not-allowed' : undefined }}
            onClick={async () => {
            try {
              setShowShareDialog(true);
              const url = await buildSessionShareLink();
              await navigator.clipboard.writeText(url);
              setShareUrl(url);
              setTimeout(() => setShowShareDialog(false), 2500);
            } catch (e) {
              setShowShareDialog(false);
              showNotification(`Share failed: ${e}`, 'error');
            }
          }}>
            <Link size={13} />
          </button>
          <button
            className="sandbox-file-btn"
            onClick={async () => {
              setPdfExporting(true);
              try {
                exportConversationAsPDF(aiMessages, {
                  title: 'Earth Intelligence Report',
                  subtitle: 'AI Conversation Transcript',
                  author: 'Earth Intelligence AI',
                  sessionId,
                  modelTier: selectedTier,
                });
                if (!isOnline()) {
                  try {
                    await queueMessage('pdf_export', sessionId);
                  } catch (queueError) {
                    showNotification(`Failed to queue PDF for sync: ${queueError}`, 'warning');
                  }
                }
              } catch (e) {
                showNotification(`PDF export failed: ${e}`, 'error');
              }
              setTimeout(() => setPdfExporting(false), 500);
            }}
            title="Download conversation as PDF report"
            aria-label="Download conversation as PDF report"
            disabled={aiMessages.length === 0}
            style={pdfExporting ? { ...GLASS_BTN_STYLE, background: 'rgba(52,211,153,0.18)', border: '1px solid rgba(52,211,153,0.5)', color: '#34d399' } : { ...GLASS_BTN_STYLE, opacity: aiMessages.length === 0 ? 0.4 : undefined, cursor: aiMessages.length === 0 ? 'not-allowed' : undefined }}
          >
            {pdfExporting ? <CheckCircle size={13} style={{ color: '#34d399' }} /> : <FileDown size={13} />}
          </button>
          {showShareDialog && <span style={{ fontSize: 10, color: '#34d399', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={shareUrl}>{shareUrl ? 'Link copied!' : 'Creating…'}</span>}
          {sandboxWorkspaceId && <span className="sandbox-workspace-badge" style={{ fontSize: 10 }}>Workspace</span>}
        </div>

        <ModelSelector />

        {!isOnline() && (
          <div style={{ padding: '4px 8px', fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
            Offline — messages will sync when reconnected
          </div>
        )}
        </>
        )}
      </Panel>
    </div>
  );
}