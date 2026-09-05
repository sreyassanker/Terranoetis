import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, History, Plus, RotateCcw, Trash2, Send, Square, Paperclip, Image as ImageIcon, FileSpreadsheet, Volume2, Link, FileDown, CheckCircle, Mic, ChevronDown, ChevronUp, Check, X, Sparkles, Eraser } from 'lucide-react';

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

// Resize bounds (kept in sync with store/chatStore.ts loadPanelState).
const MIN_PANEL_W = 300;
const MAX_PANEL_W = 580;
const DEFAULT_PANEL_W = 380;
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
  clearAllAgentActions,
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

  // Two-step inline delete confirmation (replaces window.confirm).
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); }, []);
  const handleDeleteClick = () => {
    if (confirmDelete) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmDelete(false);
      void deleteCurrentChat();
      return;
    }
    setConfirmDelete(true);
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 4000);
  };

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

  // Never let a persisted width exceed the viewport.
  useEffect(() => {
    const clamp = () => {
      const maxW = Math.max(MIN_PANEL_W, Math.min(MAX_PANEL_W, window.innerWidth - 40));
      if (chatPanelWidth > maxW) setChatPanelWidth(maxW);
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [chatPanelWidth, setChatPanelWidth]);

  // Drag-to-resize: left edge resizes width, bottom edge resizes height.
  // Pointer events so mouse and touch both work; double-click resets.
  const dragRef = useRef<{ kind: 'width' | 'height'; start: number; startValue: number } | null>(null);

  const onHandlePointerDown = useCallback((kind: 'width' | 'height') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startValue = kind === 'width'
      ? chatPanelWidth
      : (chatPanelHeight ?? Math.max(window.innerHeight - 160, MIN_PANEL_H));
    dragRef.current = { kind, start: kind === 'width' ? e.clientX : e.clientY, startValue };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    document.body.classList.add('chat-resizing', kind === 'width' ? 'chat-resizing-w' : 'chat-resizing-h');
  }, [chatPanelWidth, chatPanelHeight]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'width') {
        // Panel hugs the right edge: dragging left makes it wider.
        const cap = Math.max(MIN_PANEL_W, Math.min(MAX_PANEL_W, window.innerWidth - 40));
        const next = Math.min(cap, Math.max(MIN_PANEL_W, d.startValue + (d.start - e.clientX)));
        setChatPanelWidth(next);
      } else {
        const next = Math.min(Math.max(MIN_PANEL_H, window.innerHeight - PANEL_H_OFFSET), Math.max(MIN_PANEL_H, d.startValue + (e.clientY - d.start)));
        setChatPanelHeight(next);
      }
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.classList.remove('chat-resizing', 'chat-resizing-w', 'chat-resizing-h');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // Covers the pointer released outside the browser window.
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      // Never leave the body stuck in resize mode if unmounted mid-drag.
      document.body.classList.remove('chat-resizing', 'chat-resizing-w', 'chat-resizing-h');
    };
  }, [setChatPanelWidth, setChatPanelHeight]);

  if (!showAI) return null;

  return (
    <div className="ai-panel-light" style={{ position: 'absolute', top: 60, right: 10, zIndex: getPanelZIndex('ai', 110), width: chatPanelWidth }}>
      {!chatCollapsed && (
        <>
          <div
            className="chat-resize-handle chat-resize-w"
            onPointerDown={onHandlePointerDown('width')}
            onDoubleClick={() => setChatPanelWidth(DEFAULT_PANEL_W)}
            aria-hidden="true"
            title="Drag to resize width · double-click to reset"
          />
          <div
            className="chat-resize-handle chat-resize-h"
            onPointerDown={onHandlePointerDown('height')}
            onDoubleClick={() => setChatPanelHeight(null)}
            aria-hidden="true"
            title="Drag to resize height · double-click to reset"
          />
        </>
      )}
      <Panel
        title="EARTH INTELLIGENCE AI"
        icon={<Bot size={15} />}
        accentColor="#d97757"
        iconColor="#b4532e"
        titleColor="#8a5540"
        onClose={() => setShowAI(false)}
        headerExtra={
          <div className="chat-header-actions">
            {chatCollapsed && aiTyping && <span className="chat-collapsed-indicator" aria-hidden="true" />}
            <button className="chat-header-btn" onClick={() => setShowChatHistory(!showChatHistory)} title="Chat History" aria-label="Chat history"><History size={15} /></button>
            <button className="chat-header-btn" onClick={newChat} title="New Chat" aria-label="New chat"><Plus size={15} /></button>
            <button className="chat-header-btn" onClick={undoLastAgentAction} title="Undo last AI action" aria-label="Undo last AI action"><RotateCcw size={15} /></button>
            <button className="chat-header-btn" onClick={clearAllAgentActions} title="Clear AI results from the globe (boundaries, pins, heatmaps, charts)" aria-label="Clear AI results from the globe"><Eraser size={15} /></button>
            {confirmDelete ? (
              <span className="chat-header-confirm" role="group" aria-label="Confirm delete chat">
                <button
                  className="chat-header-btn danger"
                  onClick={handleDeleteClick}
                  title="Confirm delete"
                  aria-label="Confirm delete chat"
                ><Check size={15} /></button>
                <button
                  className="chat-header-btn"
                  onClick={() => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); setConfirmDelete(false); }}
                  title="Cancel"
                  aria-label="Cancel delete"
                ><X size={15} /></button>
              </span>
            ) : (
              <button className="chat-header-btn danger-hover" onClick={handleDeleteClick} title="Delete current chat" aria-label="Delete current chat"><Trash2 size={15} /></button>
            )}
            <button
              className="chat-header-btn"
              onClick={() => setChatCollapsed(!chatCollapsed)}
              title={chatCollapsed ? 'Expand chat panel' : 'Minimize chat panel'}
              aria-label={chatCollapsed ? 'Expand chat panel' : 'Minimize chat panel'}
              aria-expanded={!chatCollapsed}
            >
              {chatCollapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        }
        style={{
          height: chatCollapsed ? 46 : (chatPanelHeight ?? 'calc(100vh - 160px)'),
          maxHeight: chatCollapsed ? 46 : (chatPanelHeight ?? 'calc(100vh - 160px)'),
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
                <button
                  key={layer.id}
                  className="ai-active-layer-chip"
                  onClick={() => toggleLayer(layer.id)}
                  title={`Click to close ${layer.label}`}
                >
                  {layer.label}
                </button>
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

        {aiMessages.length === 0 && (
          <div className="chat-welcome" role="note">
            <div className="chat-welcome-head">
              <Sparkles size={14} />
              <span>Ask about any place, layer, or model</span>
            </div>
            <div className="chat-welcome-sub">
              103 live data layers · 150 scientific models · real sources only — when data
              isn&apos;t available the AI says so instead of inventing it.
            </div>
            <div className="ai-suggestion-chips">
              {(adaptiveSuggestions.length > 0 ? adaptiveSuggestions : [
                'Show earthquake data', 'Show wildfires', 'Aircraft near Delhi',
                'Analyze quake stats', 'Compute averages', 'Storm tracking',
              ]).map(chip => (
                <button key={chip} className="ai-chip" onClick={() => sendAI(chip)}>{chip}</button>
              ))}
            </div>
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
            title={isListening ? 'Listening...' : 'Voice input'}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            aria-pressed={isListening}
            style={{ display: voiceSupported ? 'flex' : 'none' }}
          >
            {isListening ? <Square size={13} fill="currentColor" /> : <Mic size={15} />}
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
            >
              <Square size={12} /> Stop
            </button>
          ) : (
            <button className="ai-send" onClick={() => sendAI()} aria-label="Send message" title="Send">
              <Send size={15} />
            </button>
          )}
        </div>

        <div className="chat-tool-strip">
          <label className="chat-tool-btn" title="Upload data" aria-label="Upload data file">
            <Paperclip size={14} />
            <input type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
          </label>
          <label className="chat-tool-btn" title="Upload image" aria-label="Upload image">
            <ImageIcon size={14} />
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
          </label>
          <label className="chat-tool-btn" title="Analyze data file" aria-label="Analyze data file">
            <FileSpreadsheet size={14} />
            <input type="file" accept=".csv,.json,.geojson" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleDataFileUpload(f); }} />
          </label>
          <span className="toolbar-sep" aria-hidden="true" />
          <button
            className={`chat-tool-btn ${speaking ? 'active-stop' : ''}`}
            title={speaking ? 'Stop reading' : 'Read last response aloud'}
            aria-label={speaking ? 'Stop reading response' : 'Read last response aloud'}
            onClick={speaking ? stopSpeaking : () => speakResponse(aiMessages.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '')}
          >
            {speaking ? <Square size={13} fill="currentColor" /> : <Volume2 size={14} />}
          </button>
          <button
            className="chat-tool-btn"
            title="Share session"
            aria-label="Share session"
            disabled={aiMessages.length === 0 || !isOnline()}
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
            <Link size={14} />
          </button>
          <button
            className={`chat-tool-btn ${pdfExporting ? 'active-done' : ''}`}
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
          >
            {pdfExporting ? <CheckCircle size={14} /> : <FileDown size={14} />}
          </button>
          {showShareDialog && <span className="chat-tool-hint" title={shareUrl}>{shareUrl ? 'Link copied!' : 'Creating…'}</span>}
          {sandboxWorkspaceId && <span className="sandbox-workspace-badge">Workspace</span>}
        </div>

        <ModelSelector />

        {!isOnline() && (
          <div className="chat-offline-banner">
            Offline — messages will sync when reconnected
          </div>
        )}
        </>
        )}
      </Panel>
    </div>
  );
}
