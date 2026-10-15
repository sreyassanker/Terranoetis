import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot, History, Plus, RotateCcw, Trash2, Send, Square, Paperclip,
  Image as ImageIcon, FileSpreadsheet, Volume2, Link, FileDown,
  CheckCircle, Mic, ChevronDown, ChevronUp, Check, X, Sparkles, Eraser
} from 'lucide-react';

import Panel from '@/components/ui/Panel';
import { useChatStore } from '@/store/chatStore';
import type { ChatMessage, PlanCard } from '@/lib/chatStore';
import { isOnline } from '@/lib/offlineChat';
import { HumanOverrideBanner } from '@/components/explainability/index';
import { exportConversationAsPDF } from '@/lib/pdfReport';
import ChatPanelContent from './ChatPanelContent';
import { ChatTabs } from './ChatTabs';
import { ModelSelector } from './ModelSelector';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useChatPanelState, useStreamingRenderer } from '@/hooks/useChatSelectors';
import type { VirtualizedMessageListHandle } from './VirtualizedMessageList';

// Resize bounds (kept in sync with store/chatStore.ts loadPanelState).
const MIN_PANEL_W = 320;
const MAX_PANEL_W = 600;
const DEFAULT_PANEL_W = 400;
const MIN_PANEL_H = 340;
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
  agentActionCount = 0,
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
  agentActionCount?: number;
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
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const hasMessages = aiMessages.length > 0;
  const canUndo = agentActionCount > 0;

  const handleNewChat = useCallback(() => {
    if (aiMessages.length === 0 && !aiInput.trim()) {
      inputRef.current?.focus();
      return;
    }
    newChat();
  }, [aiMessages.length, aiInput, newChat]);

  // Two-step inline delete confirmation (replaces window.confirm).
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); }, []);

  const handleDeleteClick = () => {
    if (!hasMessages) return;
    if (confirmDelete) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmDelete(false);
      void deleteCurrentChat();
      return;
    }
    setConfirmDelete(true);
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 4000);
  };

  useEffect(() => {
    if (!hasMessages && confirmDelete) {
      setConfirmDelete(false);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    }
  }, [hasMessages, confirmDelete]);

  // Close attach menu when clicking outside
  useEffect(() => {
    if (!showAttachMenu) return;
    const onDown = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showAttachMenu]);

  // Collapse the composer back to one line after input is cleared
  useEffect(() => {
    if (aiInput === '' && inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [aiInput]);

  const handleEditMessage = useCallback((content: string, messageId: number) => {
    setAiInput(content);
    useChatStore.getState().setEditingMessageId(messageId);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setAiInput]);

  // Persist panel layout
  useEffect(() => {
    try {
      window.localStorage.setItem('chat-panel-state', JSON.stringify({
        width: chatPanelWidth,
        height: chatPanelHeight,
        collapsed: chatCollapsed,
      }));
    } catch { /* ignore quota */ }
  }, [chatPanelWidth, chatPanelHeight, chatCollapsed]);

  // Never let width exceed viewport
  useEffect(() => {
    const clamp = () => {
      const maxW = Math.max(MIN_PANEL_W, Math.min(MAX_PANEL_W, window.innerWidth - 40));
      if (chatPanelWidth > maxW) setChatPanelWidth(maxW);
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [chatPanelWidth, setChatPanelWidth]);

  // Drag-to-resize handles
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
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      document.body.classList.remove('chat-resizing', 'chat-resizing-w', 'chat-resizing-h');
    };
  }, [setChatPanelWidth, setChatPanelHeight]);

  const handleStop = () => {
    const activeTabId = useChatStore.getState().activeTabId;
    if (activeTabId) useChatStore.getState().abortTabStream(activeTabId);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    cleanupThinkingSteps(true);
  };

  const handleShare = async () => {
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
  };

  const handlePdfExport = async () => {
    setPdfExporting(true);
    try {
      exportConversationAsPDF(aiMessages, {
        title: 'Earth Intelligence Report',
        subtitle: 'AI Conversation Transcript',
        author: 'Earth Intelligence AI',
        sessionId,
        modelTier: selectedTier,
      });
    } catch (e) {
      showNotification(`PDF export failed: ${e}`, 'error');
    }
    setTimeout(() => setPdfExporting(false), 500);
  };

  if (!showAI) return null;

  return (
    <div
      className="ai-panel-light"
      style={{
        position: 'absolute',
        top: 60,
        right: 12,
        zIndex: getPanelZIndex('ai', 110),
        width: chatPanelWidth,
      }}
    >
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
        title="Earth Copilot"
        icon={<Bot size={15} strokeWidth={1.6} />}
        accentColor="#c25e3e"
        iconColor="#c25e3e"
        titleColor="#2d2724"
        headerBackground="#f4efe6"
        onClose={() => setShowAI(false)}
        headerActions={
          <div className="chat-header-actions" role="toolbar" aria-label="AI Copilot actions">
            {chatCollapsed && aiTyping && <span className="chat-collapsed-indicator" aria-hidden="true" />}

            {/* Group 1: Session Navigation */}
            <div className="chat-header-group" role="group" aria-label="Conversation controls">
              <button
                type="button"
                className={`chat-header-btn ${showChatHistory ? 'active' : ''}`}
                onClick={() => setShowChatHistory(!showChatHistory)}
                title={showChatHistory ? 'Close chat history' : 'Chat history'}
                aria-label="Chat history"
                aria-pressed={showChatHistory}
              >
                <History size={13.5} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                className="chat-header-btn"
                onClick={handleNewChat}
                title="New chat"
                aria-label="New chat"
              >
                <Plus size={13.5} strokeWidth={1.5} />
              </button>
            </div>

            <span className="chat-header-divider" aria-hidden="true" />

            {/* Group 2: Globe AI Canvas Actions */}
            <div className="chat-header-group" role="group" aria-label="Globe AI actions">
              <button
                type="button"
                className="chat-header-btn"
                onClick={undoLastAgentAction}
                disabled={!canUndo}
                title={canUndo ? `Undo last globe action (${agentActionCount})` : 'No globe actions to undo'}
                aria-label="Undo last globe action"
              >
                <RotateCcw size={13.5} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                className="chat-header-btn"
                onClick={clearAllAgentActions}
                disabled={!canUndo}
                title={canUndo ? 'Clear AI layers & markers from globe' : 'No AI items on globe to clear'}
                aria-label="Clear AI layers and markers from globe"
              >
                <Eraser size={13.5} strokeWidth={1.5} />
              </button>
            </div>

            <span className="chat-header-divider" aria-hidden="true" />

            {/* Group 3: Destructive Deletion */}
            <div className="chat-header-group" role="group" aria-label="Delete conversation">
              {confirmDelete ? (
                <span className="chat-header-confirm" role="group" aria-label="Confirm delete conversation">
                  <button
                    type="button"
                    className="chat-header-btn confirm-yes"
                    onClick={handleDeleteClick}
                    title="Confirm delete conversation"
                    aria-label="Confirm delete conversation"
                  >
                    <Check size={13} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    className="chat-header-btn confirm-no"
                    onClick={() => {
                      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                      setConfirmDelete(false);
                    }}
                    title="Cancel"
                    aria-label="Cancel"
                  >
                    <X size={13} strokeWidth={1.8} />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="chat-header-btn danger-hover"
                  onClick={handleDeleteClick}
                  disabled={!hasMessages}
                  title={hasMessages ? 'Delete current conversation' : 'No messages to delete'}
                  aria-label="Delete current conversation"
                >
                  <Trash2 size={13.5} strokeWidth={1.5} />
                </button>
              )}
            </div>

            <span className="chat-header-divider" aria-hidden="true" />

            {/* Group 4: Panel Collapse Toggle */}
            <button
              type="button"
              className="chat-header-btn"
              onClick={() => setChatCollapsed(!chatCollapsed)}
              title={chatCollapsed ? 'Expand chat panel' : 'Minimize chat panel'}
              aria-label={chatCollapsed ? 'Expand chat panel' : 'Minimize chat panel'}
              aria-expanded={!chatCollapsed}
            >
              {chatCollapsed ? <ChevronUp size={13.5} strokeWidth={1.5} /> : <ChevronDown size={13.5} strokeWidth={1.5} />}
            </button>
          </div>
        }
        style={{
          height: chatCollapsed ? 46 : (chatPanelHeight ?? 'calc(100vh - 150px)'),
          maxHeight: chatCollapsed ? 46 : (chatPanelHeight ?? 'calc(100vh - 150px)'),
          background: '#faf8f5',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid #e7e2d7',
          boxShadow: '0 16px 40px rgba(40, 30, 20, 0.12), 0 0 1px rgba(0, 0, 0, 0.08)',
          color: '#1c1917',
          borderRadius: '14px',
        }}
      >
        {!chatCollapsed && (
          <>
            <ChatTabs
              onBeforeTabSwitch={() => {
                const activeTabId = useChatStore.getState().activeTabId;
                if (activeTabId) useChatStore.getState().abortTabStream(activeTabId);
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
                  <Sparkles size={14} className="text-terracotta" />
                  <span>Earth Intelligence Copilot</span>
                </div>
                <div className="chat-welcome-sub">
                  Query 103 live scientific data layers, global flight radar, satellite orbits, or upload datasets for instant spatial synthesis.
                </div>
                <div className="ai-suggestion-chips">
                  {(adaptiveSuggestions.length > 0 ? adaptiveSuggestions : [
                    'Show earthquake data', 'Show flight tracks', 'Aircraft near Delhi',
                    'Analyze quake stats', 'Active wildfires', 'Storm tracking',
                  ]).map(chip => (
                    <button key={chip} className="ai-chip" onClick={() => sendAI(chip)}>{chip}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Modern Claude / Antigravity Style Integrated Composer */}
            <div className="chat-composer-card">
              {chatImages.length > 0 && (
                <div className="chat-image-previews" aria-label="Pending image uploads">
                  {chatImages.map(img => (
                    <div key={img.id} className="chat-image-preview">
                      <img src={img.dataUrl} alt={img.fileName} />
                      <button
                        type="button"
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

              <textarea
                ref={inputRef}
                className="chat-composer-input"
                placeholder={editingMessageId != null ? 'Edit your message — press Enter to apply and regenerate…' : 'Ask about any place, layer, or upload data…'}
                value={aiInput}
                rows={1}
                onChange={e => setAiInput(e.target.value)}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                }}
                onKeyDown={e => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); }
                }}
                aria-label="Chat message input"
              />

              <div className="chat-composer-toolbar">
                <div className="chat-composer-left">
                  {/* Unified Attachment menu */}
                  <div className="chat-attach-wrap" ref={attachMenuRef}>
                    <button
                      type="button"
                      className={`chat-composer-icon-btn ${showAttachMenu ? 'active' : ''}`}
                      onClick={() => setShowAttachMenu(v => !v)}
                      title="Attach file, image, or dataset"
                      aria-label="Attach file"
                    >
                      <Paperclip size={14} />
                    </button>
                    {showAttachMenu && (
                      <div className="chat-attach-menu">
                        <label className="chat-attach-menu-item">
                          <ImageIcon size={14} />
                          <span>Upload Image (Vision)</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            style={{ display: 'none' }}
                            onChange={e => {
                              const f = e.target.files?.[0];
                              if (f) handleImageUpload(f);
                              setShowAttachMenu(false);
                            }}
                          />
                        </label>
                        <label className="chat-attach-menu-item">
                          <FileSpreadsheet size={14} />
                          <span>Analyze Dataset (.csv, .json, .geojson)</span>
                          <input
                            type="file"
                            accept=".csv,.json,.geojson"
                            style={{ display: 'none' }}
                            onChange={e => {
                              const f = e.target.files?.[0];
                              if (f) handleDataFileUpload(f);
                              setShowAttachMenu(false);
                            }}
                          />
                        </label>
                        <label className="chat-attach-menu-item">
                          <Paperclip size={14} />
                          <span>General File Upload</span>
                          <input
                            type="file"
                            style={{ display: 'none' }}
                            onChange={e => {
                              const f = e.target.files?.[0];
                              if (f) handleFileUpload(f);
                              setShowAttachMenu(false);
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Clean Model Selector Pill */}
                  <ModelSelector />

                  {sandboxWorkspaceId && <span className="sandbox-workspace-pill">Workspace</span>}
                </div>

                <div className="chat-composer-right">
                  {/* Voice input button */}
                  {voiceSupported && (
                    <button
                      type="button"
                      className={`chat-composer-icon-btn voice-btn ${isListening ? 'listening' : ''}`}
                      onClick={toggleVoiceInput}
                      title={isListening ? 'Listening… click to stop' : 'Voice input'}
                      aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                    >
                      {isListening ? <Square size={12} fill="currentColor" /> : <Mic size={15} />}
                    </button>
                  )}

                  {/* Read last response aloud */}
                  <button
                    type="button"
                    className={`chat-composer-icon-btn ${speaking ? 'active' : ''}`}
                    title={speaking ? 'Stop reading' : 'Read aloud last reply'}
                    aria-label={speaking ? 'Stop reading response' : 'Read aloud last reply'}
                    onClick={speaking ? stopSpeaking : () => speakResponse(aiMessages.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '')}
                  >
                    {speaking ? <Square size={12} fill="currentColor" /> : <Volume2 size={14} />}
                  </button>

                  {/* Share transcript */}
                  <button
                    type="button"
                    className="chat-composer-icon-btn"
                    title="Share session transcript"
                    aria-label="Share session"
                    disabled={aiMessages.length === 0 || !isOnline()}
                    onClick={handleShare}
                  >
                    <Link size={14} />
                  </button>

                  {/* PDF Export */}
                  <button
                    type="button"
                    className={`chat-composer-icon-btn ${pdfExporting ? 'active' : ''}`}
                    onClick={handlePdfExport}
                    title="Export conversation as PDF report"
                    aria-label="Export conversation as PDF report"
                    disabled={aiMessages.length === 0}
                  >
                    {pdfExporting ? <CheckCircle size={14} /> : <FileDown size={14} />}
                  </button>

                  {/* Send / Stop button */}
                  {aiTyping ? (
                    <button
                      type="button"
                      className="chat-submit-btn stop"
                      onClick={handleStop}
                      title="Stop generating"
                      aria-label="Stop generating"
                    >
                      <Square size={11} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`chat-submit-btn send ${aiInput.trim() || chatImages.length > 0 ? 'ready' : ''}`}
                      onClick={() => sendAI()}
                      disabled={!aiInput.trim() && chatImages.length === 0}
                      title="Send message"
                      aria-label="Send message"
                    >
                      <Send size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {showShareDialog && (
              <div className="chat-share-toast">
                {shareUrl ? 'Share link copied to clipboard!' : 'Generating shareable link…'}
              </div>
            )}

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
