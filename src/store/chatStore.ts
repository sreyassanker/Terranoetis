import { create } from 'zustand';
import type { ChatMessage, ChatListItem } from '@/lib/chatStore';
import { StreamingMarkdownRenderer } from '@/lib/advancedChat';

export interface AgentStep {
  type: string;
  text: string;
  code?: string;
  output?: string;
  timeMs?: number;
  toolName?: string;
  subtask?: string;
  status?: string;
  startedAt?: number;
}

export interface PipelineStep {
  id: string;
  description: string;
  status: string;
}

export interface ChatImage {
  id: number;
  dataUrl: string;
  mimeType: string;
  fileName: string;
}

interface ModelTier {
  id: string;
  label: string;
  description: string;
  costPerQuery: number;
  latencyMs: number;
}

// ── Tab registry ──
export interface ChatTab {
  id: string;
  title: string;
  sessionId: string;
  messages: ChatMessage[];
  input: string;
  selectedTier: string;
  agentSteps: AgentStep[];
  pipelineProgress: PipelineStep[];
  chatImages: ChatImage[];
  editingMessageId: number | null;
  currentChatId: string | null;
  sandboxWorkspaceId: string | null;
  width: number;
  height: number | null;
  collapsed: boolean;
}

function snapshotActiveTab(state: ChatState): Omit<ChatTab, 'id' | 'title' | 'sessionId'> {
  return {
    messages: state.aiMessages,
    input: state.aiInput,
    selectedTier: state.selectedTier,
    agentSteps: state.agentSteps,
    pipelineProgress: state.pipelineProgress,
    chatImages: state.chatImages,
    editingMessageId: state.editingMessageId,
    currentChatId: state.currentChatId,
    sandboxWorkspaceId: state.sandboxWorkspaceId,
    width: state.chatPanelWidth,
    height: state.chatPanelHeight,
    collapsed: state.chatCollapsed,
  };
}

function freshTabState(): {
  messages: ChatMessage[];
  input: string;
  selectedTier: string;
  agentSteps: AgentStep[];
  pipelineProgress: PipelineStep[];
  chatImages: ChatImage[];
  editingMessageId: number | null;
  currentChatId: string | null;
  sandboxWorkspaceId: string | null;
} {
  return {
    messages: [
      { id: 0, role: 'assistant', content: 'Welcome to Earth Intelligence AI. Ask me about earthquakes, weather, flights, or any location on Earth.', timestamp: Date.now() },
    ],
    input: '',
    selectedTier: 'flash',
    agentSteps: [],
    pipelineProgress: [],
    chatImages: [],
    editingMessageId: null,
    currentChatId: null,
    sandboxWorkspaceId: null,
  };
}

const TABS_STORAGE_KEY = 'chat-tabs-registry';

function loadTabRegistry(): { tabs: ChatTab[]; activeTabId: string | null } {
  if (typeof window === 'undefined') return { tabs: [], activeTabId: null };
  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed = JSON.parse(raw) as { tabs?: ChatTab[]; activeTabId?: string };
    return { tabs: parsed.tabs || [], activeTabId: parsed.activeTabId || null };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

function persistTabRegistry(tabs: ChatTab[], activeTabId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
  } catch { /* ignore */ }
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingTabs: ChatTab[] | null = null;
let _pendingActiveId: string | null = null;
/** Debounced persist — coalesces rapid mutateTab calls (e.g. token streaming)
 *  into a single localStorage write every 500ms. */
function scheduleTabPersist(tabs: ChatTab[], activeTabId: string | null) {
  _pendingTabs = tabs;
  _pendingActiveId = activeTabId;
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    if (_pendingTabs) {
      persistTabRegistry(_pendingTabs, _pendingActiveId);
      _pendingTabs = null;
      _pendingActiveId = null;
    }
  }, 500);
}
/** Flush any pending debounced persist immediately (e.g. on beforeunload). */
function flushTabPersist() {
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  if (_pendingTabs) {
    persistTabRegistry(_pendingTabs, _pendingActiveId);
    _pendingTabs = null;
    _pendingActiveId = null;
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushTabPersist);
}

interface ChatState {
  // Tab registry
  chatTabs: ChatTab[];
  activeTabId: string | null;
  openChatTab: (title?: string) => void;
  closeChatTab: (id: string) => void;
  activateChatTab: (id: string, onBeforeSwitch?: () => void) => void;
  renameChatTab: (id: string, title: string) => void;

  /** Applies a mutation to a specific tab. When that tab is active, the
   *  changed fields are mirrored to the singleton so the UI updates live.
   *  When it's a background tab, only the tab registry is updated. */
  mutateTab: (tabId: string, updater: (tab: ChatTab) => ChatTab) => void;

  // Per-tab streaming state (not persisted)
  tabTyping: Record<string, boolean>;
  setTabTyping: (tabId: string, value: boolean) => void;
  tabAbortControllers: Record<string, AbortController | null>;
  registerTabAbort: (tabId: string, controller: AbortController | null) => void;
  abortTabStream: (tabId: string) => void;

  // Messages
  aiMessages: ChatMessage[];
  setAiMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: number, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;

  // Input
  aiInput: string;
  setAiInput: (value: string) => void;
  /** When set, the next send edits this message in place instead of appending a new turn. */
  editingMessageId: number | null;
  setEditingMessageId: (value: number | null) => void;

  // Typing/streaming
  aiTyping: boolean;
  setAiTyping: (value: boolean) => void;
  streamingMdRef: { current: StreamingMarkdownRenderer };

  // Session
  sessionId: string;
  selectedTier: string;
  setSelectedTier: (tier: string) => void;

  // Model tiers
  modelTiers: ModelTier[];
  setModelTiers: (tiers: ModelTier[]) => void;

  // Suggestions
  adaptiveSuggestions: string[];
  setAdaptiveSuggestions: (suggestions: string[] | ((prev: string[]) => string[])) => void;

  // Agent steps / thinking
  agentSteps: AgentStep[];
  setAgentSteps: (steps: AgentStep[] | ((prev: AgentStep[]) => AgentStep[])) => void;
  addAgentStep: (step: AgentStep) => void;
  clearAgentSteps: () => void;

  // Pipeline progress
  pipelineProgress: PipelineStep[];
  setPipelineProgress: (steps: PipelineStep[] | ((prev: PipelineStep[]) => PipelineStep[])) => void;
  clearPipelineProgress: () => void;

  // Chat images
  chatImages: ChatImage[];
  setChatImages: (images: ChatImage[] | ((prev: ChatImage[]) => ChatImage[])) => void;
  addChatImage: (image: ChatImage) => void;
  clearChatImages: () => void;

  // Voice
  voiceMode: boolean;
  setVoiceMode: (value: boolean) => void;
  bargeIn: boolean;
  setBargeIn: (value: boolean) => void;
  isListening: boolean;
  setIsListening: (value: boolean) => void;
  speaking: boolean;
  setSpeaking: (value: boolean) => void;
  stopSpeaking: () => void;

  // Chat history
  chatList: ChatListItem[];
  setChatList: (chats: ChatListItem[] | ((prev: ChatListItem[]) => ChatListItem[])) => void;
  showChatHistory: boolean;
  setShowChatHistory: (value: boolean) => void;
  chatSearch: string;
  setChatSearch: (value: string) => void;
  /** The chat session id currently loaded in the composer (for the history highlight) */
  currentChatId: string | null;
  setCurrentChatId: (value: string | null) => void;

  // UI state
  showAI: boolean;
  setShowAI: (value: boolean | ((prev: boolean) => boolean)) => void;
  copiedMsgId: number | null;
  setCopiedMsgId: (id: number | null) => void;
  thinkingExpanded: boolean;
  setThinkingExpanded: (value: boolean) => void;
  expandedStep: number | null;
  setExpandedStep: (step: number | null) => void;

  // Planning
  planningFor: string | null;
  setPlanningFor: (value: string | null) => void;

  // PDF export
  pdfExporting: boolean;
  setPdfExporting: (value: boolean) => void;

  // Sandbox
  sandboxWorkspaceId: string | null;
  setSandboxWorkspaceId: (id: string | null) => void;
  uploadedFiles: string[];
  setUploadedFiles: (files: string[] | ((prev: string[]) => string[])) => void;

  // Reasoning traces
  showReasoningFor: Record<string, boolean>;
  setShowReasoningFor: (value: Record<string, boolean>) => void;
  showEvidenceFor: Record<string, boolean>;
  setShowEvidenceFor: (value: Record<string, boolean>) => void;
  reasoningTraces: Record<string, unknown>;
  setReasoningTraces: (value: Record<string, unknown>) => void;
  evidenceChains: Record<string, unknown>;
  setEvidenceChains: (value: Record<string, unknown>) => void;

  // Data analysis
  dataAnalysisResult: Record<string, unknown> | null;
  setDataAnalysisResult: (result: Record<string, unknown> | null) => void;

  // Share
  showShareDialog: boolean;
  setShowShareDialog: (value: boolean) => void;
  shareUrl: string;
  setShareUrl: (url: string) => void;

  // Panel layout (persisted to localStorage)
  chatCollapsed: boolean;
  setChatCollapsed: (value: boolean) => void;
  chatPanelWidth: number;
  setChatPanelWidth: (value: number) => void;
  chatPanelHeight: number | null;
  setChatPanelHeight: (value: number | null) => void;
}

const PANEL_STATE_KEY = 'chat-panel-state';

// Same bounds the drag handles enforce in ChatPanel — stale/tampered
// localStorage must never render an oversized panel.
const MIN_PANEL_W = 300;
const MAX_PANEL_W = 580;
const MIN_PANEL_H = 320;
const PANEL_H_OFFSET = 120;

function loadPanelState(): { width: number; height: number | null; collapsed: boolean } {
  if (typeof window === 'undefined') return { width: 380, height: null, collapsed: false };
  try {
    const raw = window.localStorage.getItem(PANEL_STATE_KEY);
    if (!raw) return { width: 380, height: null, collapsed: false };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const width = typeof parsed.width === 'number'
      ? Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, parsed.width))
      : 380;
    let height: number | null = null;
    if (typeof parsed.height === 'number') {
      const maxH = Math.max(MIN_PANEL_H, window.innerHeight - PANEL_H_OFFSET);
      height = Math.min(maxH, Math.max(MIN_PANEL_H, parsed.height));
    }
    return { width, height, collapsed: Boolean(parsed.collapsed) };
  } catch {
    return { width: 380, height: null, collapsed: false };
  }
}

const initialPanelState = loadPanelState();

const initialTabRegistry = loadTabRegistry();

const initialActiveTab = initialTabRegistry.tabs.find(t => t.id === initialTabRegistry.activeTabId) || null;

export const useChatStore = create<ChatState>((set, get) => ({
  // ── Tab registry ──
  chatTabs: initialTabRegistry.tabs,
  activeTabId: initialTabRegistry.activeTabId,
  tabTyping: {},

  // ── Singleton hydrated from the persisted active tab (if any) ──
  aiMessages: initialActiveTab ? initialActiveTab.messages : [
    { id: 0, role: 'assistant', content: 'Welcome to Earth Intelligence AI. Ask me about earthquakes, weather, flights, or any location on Earth.', timestamp: Date.now() },
  ],
  aiInput: initialActiveTab ? initialActiveTab.input : '',
  selectedTier: initialActiveTab ? initialActiveTab.selectedTier : 'flash',
  agentSteps: initialActiveTab ? initialActiveTab.agentSteps : [],
  pipelineProgress: initialActiveTab ? initialActiveTab.pipelineProgress : [],
  chatImages: initialActiveTab ? initialActiveTab.chatImages : [],
  editingMessageId: initialActiveTab ? initialActiveTab.editingMessageId : null,
  currentChatId: initialActiveTab ? initialActiveTab.currentChatId : null,
  sandboxWorkspaceId: initialActiveTab ? initialActiveTab.sandboxWorkspaceId : null,
  chatCollapsed: initialActiveTab ? initialActiveTab.collapsed : initialPanelState.collapsed,
  chatPanelWidth: initialActiveTab ? initialActiveTab.width : initialPanelState.width,
  chatPanelHeight: initialActiveTab ? initialActiveTab.height : initialPanelState.height,
  sessionId: initialActiveTab ? initialActiveTab.sessionId : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,

  openChatTab: (title?: string) => {
    const s = get();
    // Snapshot current active tab before switching
    if (s.activeTabId) {
      const snapshot = snapshotActiveTab(s);
      set({
        chatTabs: s.chatTabs.map(t =>
          t.id === s.activeTabId ? { ...t, ...snapshot, title: t.title } : t
        ),
      });
    }
    const newTab: ChatTab = {
      id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || 'New Chat',
      sessionId: `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...freshTabState(),
      width: s.chatPanelWidth,
      height: s.chatPanelHeight,
      collapsed: false,
    };
    const newTabs = [...get().chatTabs, newTab];
    set({
      chatTabs: newTabs,
      activeTabId: newTab.id,
      aiMessages: newTab.messages,
      aiInput: newTab.input,
      selectedTier: newTab.selectedTier,
      agentSteps: newTab.agentSteps,
      pipelineProgress: newTab.pipelineProgress,
      chatImages: newTab.chatImages,
      editingMessageId: newTab.editingMessageId,
      currentChatId: newTab.currentChatId,
      sandboxWorkspaceId: newTab.sandboxWorkspaceId,
      aiTyping: false,
      streamingMdRef: { current: new StreamingMarkdownRenderer() },
      showChatHistory: false,
    });
    persistTabRegistry(newTabs, newTab.id);
  },

  closeChatTab: (id: string) => {
    const s = get();
    const idx = s.chatTabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    // Abort any running stream in the tab being closed.
    get().abortTabStream(id);
    const newTabs = s.chatTabs.filter(t => t.id !== id);
    if (s.activeTabId === id) {
      // Activate next tab, or previous, or create fresh
      const nextId = newTabs.length > 0
        ? newTabs[Math.min(idx, newTabs.length - 1)].id
        : null;
      if (nextId) {
        const nextTab = newTabs.find(t => t.id === nextId)!;
        set({
          chatTabs: newTabs,
          activeTabId: nextId,
          aiMessages: nextTab.messages,
          aiInput: nextTab.input,
          selectedTier: nextTab.selectedTier,
          agentSteps: nextTab.agentSteps,
          pipelineProgress: nextTab.pipelineProgress,
          chatImages: nextTab.chatImages,
          editingMessageId: nextTab.editingMessageId,
          currentChatId: nextTab.currentChatId,
          sandboxWorkspaceId: nextTab.sandboxWorkspaceId,
          chatPanelWidth: nextTab.width,
          chatPanelHeight: nextTab.height,
          chatCollapsed: nextTab.collapsed,
          aiTyping: get().tabTyping[nextId] ?? false,
          streamingMdRef: { current: new StreamingMarkdownRenderer() },
        });
      } else {
        // No tabs left — create a fresh one
        const freshTab: ChatTab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: 'New Chat',
          sessionId: `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ...freshTabState(),
          width: s.chatPanelWidth,
          height: s.chatPanelHeight,
          collapsed: false,
        };
        set({
          chatTabs: [freshTab],
          activeTabId: freshTab.id,
          aiMessages: freshTab.messages,
          aiInput: freshTab.input,
          selectedTier: freshTab.selectedTier,
          agentSteps: freshTab.agentSteps,
          pipelineProgress: freshTab.pipelineProgress,
          chatImages: freshTab.chatImages,
          editingMessageId: freshTab.editingMessageId,
          currentChatId: freshTab.currentChatId,
          sandboxWorkspaceId: freshTab.sandboxWorkspaceId,
          aiTyping: false,
          streamingMdRef: { current: new StreamingMarkdownRenderer() },
        });
      }
    } else {
      set({ chatTabs: newTabs });
    }
    persistTabRegistry(newTabs, get().activeTabId);
  },

  activateChatTab: (id: string, onBeforeSwitch?: () => void) => {
    const s = get();
    if (s.activeTabId === id) return;
    // (No stream abort on switch — background streams keep generating.)
    onBeforeSwitch?.();
    // Snapshot current tab
    if (s.activeTabId) {
      const snapshot = snapshotActiveTab(s);
      set({
        chatTabs: s.chatTabs.map(t =>
          t.id === s.activeTabId ? { ...t, ...snapshot, title: t.title } : t
        ),
      });
    }
    const targetTab = s.chatTabs.find(t => t.id === id);
    if (!targetTab) return;
    // Hydrate singleton from target tab
    set({
      activeTabId: id,
      aiMessages: targetTab.messages,
      aiInput: targetTab.input,
      sessionId: targetTab.sessionId,
      selectedTier: targetTab.selectedTier,
      agentSteps: targetTab.agentSteps,
      pipelineProgress: targetTab.pipelineProgress,
      chatImages: targetTab.chatImages,
      editingMessageId: targetTab.editingMessageId,
      currentChatId: targetTab.currentChatId,
      sandboxWorkspaceId: targetTab.sandboxWorkspaceId,
      chatPanelWidth: targetTab.width,
      chatPanelHeight: targetTab.height,
      chatCollapsed: targetTab.collapsed,
      aiTyping: get().tabTyping[id] ?? false,
      streamingMdRef: { current: new StreamingMarkdownRenderer() },
    });
    persistTabRegistry(get().chatTabs, id);
  },

  mutateTab: (tabId, updater) => {
    const s = get();
    const idx = s.chatTabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    const updated = updater(s.chatTabs[idx]);
    const newTabs = s.chatTabs.map((t, i) => (i === idx ? updated : t));
    const patch: Partial<ChatState> = { chatTabs: newTabs };
    if (tabId === s.activeTabId) {
      patch.aiMessages = updated.messages;
      patch.aiInput = updated.input;
      patch.selectedTier = updated.selectedTier;
      patch.agentSteps = updated.agentSteps;
      patch.pipelineProgress = updated.pipelineProgress;
      patch.chatImages = updated.chatImages;
      patch.editingMessageId = updated.editingMessageId;
      patch.currentChatId = updated.currentChatId;
      patch.sandboxWorkspaceId = updated.sandboxWorkspaceId;
      patch.chatPanelWidth = updated.width;
      patch.chatPanelHeight = updated.height;
      patch.chatCollapsed = updated.collapsed;
    }
    set(patch);
    // Debounced persist: save the tab registry whenever tab data changes
    // so messages survive page refresh even without an explicit tab switch.
    scheduleTabPersist(newTabs, tabId === s.activeTabId ? tabId : s.activeTabId);
  },

  setTabTyping: (tabId, value) => {
    const s = get();
    const tabTyping = { ...s.tabTyping, [tabId]: value };
    const aiTyping = tabId === s.activeTabId ? value : s.aiTyping;
    set({ tabTyping, aiTyping });
  },

  tabAbortControllers: {},
  registerTabAbort: (tabId, controller) => {
    set(s => ({ tabAbortControllers: { ...s.tabAbortControllers, [tabId]: controller } }));
  },
  abortTabStream: (tabId) => {
    const ctrl = get().tabAbortControllers[tabId];
    ctrl?.abort();
    set(s => {
      const nextAbort = { ...s.tabAbortControllers };
      delete nextAbort[tabId];
      const nextTyping = { ...s.tabTyping };
      delete nextTyping[tabId];
      return {
        tabAbortControllers: nextAbort,
        tabTyping: nextTyping,
        aiTyping: tabId === s.activeTabId ? false : s.aiTyping,
      };
    });
  },

  renameChatTab: (id: string, title: string) => {
    const s = get();
    const newTabs = s.chatTabs.map(t => t.id === id ? { ...t, title } : t);
    set({ chatTabs: newTabs });
    persistTabRegistry(newTabs, s.activeTabId);
  },

  // Messages
  setAiMessages: (messages) => {
    const next = typeof messages === 'function' ? messages(get().aiMessages) : messages;
    const s = get();
    const patch: Partial<ChatState> = { aiMessages: next };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, messages: next } : t);
    }
    set(patch);
  },
  addMessage: (message) => {
    const s = get();
    const exists = s.aiMessages.some(m => m.id === message.id);
    if (exists) return;
    const next = [...s.aiMessages, { ...message, timestamp: message.timestamp ?? Date.now() }];
    const patch: Partial<ChatState> = { aiMessages: next };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, messages: next } : t);
    }
    set(patch);
  },
  updateMessage: (id, updates) => {
    const s = get();
    const next = s.aiMessages.map(m => (m.id === id ? { ...m, ...updates } : m));
    const patch: Partial<ChatState> = { aiMessages: next };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, messages: next } : t);
    }
    set(patch);
  },
  clearMessages: () => {
    const s = get();
    const patch: Partial<ChatState> = { aiMessages: [] };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, messages: [] } : t);
    }
    set(patch);
  },

  // Input
  setAiInput: (value) => set({ aiInput: value }),
  setEditingMessageId: (value) => set({ editingMessageId: value }),

  // Typing
  aiTyping: false,
  setAiTyping: (value) => set({ aiTyping: value }),
  streamingMdRef: { current: new StreamingMarkdownRenderer() },

  // Session
  setSelectedTier: (tier) => set({ selectedTier: tier }),

  // Model tiers
  modelTiers: [],
  setModelTiers: (tiers) => set({ modelTiers: tiers }),

  // Suggestions
  adaptiveSuggestions: [],
  setAdaptiveSuggestions: (suggestions) => set({
    adaptiveSuggestions: typeof suggestions === 'function' ? suggestions(get().adaptiveSuggestions) : suggestions,
  }),

  // Agent steps
  setAgentSteps: (steps) => {
    const next = typeof steps === 'function' ? steps(get().agentSteps) : steps;
    const s = get();
    const patch: Partial<ChatState> = { agentSteps: next };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, agentSteps: next } : t);
    }
    set(patch);
  },
  addAgentStep: (step) => set((state) => ({ agentSteps: [...state.agentSteps, step] })),
  clearAgentSteps: () => set({ agentSteps: [] }),

  // Pipeline
  setPipelineProgress: (steps) => {
    const next = typeof steps === 'function' ? steps(get().pipelineProgress) : steps;
    const s = get();
    const patch: Partial<ChatState> = { pipelineProgress: next };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, pipelineProgress: next } : t);
    }
    set(patch);
  },
  clearPipelineProgress: () => set({ pipelineProgress: [] }),

  // Chat images
  setChatImages: (images) => {
    const next = typeof images === 'function' ? images(get().chatImages) : images;
    const s = get();
    const patch: Partial<ChatState> = { chatImages: next };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, chatImages: next } : t);
    }
    set(patch);
  },
  addChatImage: (image) => {
    const s = get();
    const next = [...s.chatImages, image];
    const patch: Partial<ChatState> = { chatImages: next };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, chatImages: next } : t);
    }
    set(patch);
  },
  clearChatImages: () => {
    const s = get();
    const patch: Partial<ChatState> = { chatImages: [] };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, chatImages: [] } : t);
    }
    set(patch);
  },

  // Voice
  voiceMode: false,
  setVoiceMode: (value) => set({ voiceMode: value }),
  bargeIn: false,
  setBargeIn: (value) => set({ bargeIn: value }),
  isListening: false,
  setIsListening: (value) => set({ isListening: value }),
  speaking: false,
  setSpeaking: (value) => set({ speaking: value }),
  stopSpeaking: () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    set({ speaking: false });
  },

  // Chat history
  chatList: [],
  setChatList: (chats) => set({
    chatList: typeof chats === 'function' ? chats(get().chatList) : chats,
  }),
  showChatHistory: false,
  setShowChatHistory: (value) => set({ showChatHistory: value }),
  chatSearch: '',
  setChatSearch: (value) => set({ chatSearch: value }),
  setCurrentChatId: (value) => set({ currentChatId: value }),

  // UI
  showAI: false,
  setShowAI: (value) => set({
    showAI: typeof value === 'function' ? value(get().showAI) : value,
  }),
  copiedMsgId: null,
  setCopiedMsgId: (id) => set({ copiedMsgId: id }),
  thinkingExpanded: false,
  setThinkingExpanded: (value) => set({ thinkingExpanded: value }),
  expandedStep: null,
  setExpandedStep: (step) => set({ expandedStep: step }),

  // Planning
  planningFor: null,
  setPlanningFor: (value) => set({ planningFor: value }),

  // PDF
  pdfExporting: false,
  setPdfExporting: (value) => set({ pdfExporting: value }),

  // Sandbox
  setSandboxWorkspaceId: (id) => set({ sandboxWorkspaceId: id }),
  uploadedFiles: [],
  setUploadedFiles: (files) => set({
    uploadedFiles: typeof files === 'function' ? files(get().uploadedFiles) : files,
  }),

  // Reasoning
  showReasoningFor: {},
  setShowReasoningFor: (value) => set({ showReasoningFor: value }),
  showEvidenceFor: {},
  setShowEvidenceFor: (value) => set({ showEvidenceFor: value }),
  reasoningTraces: {},
  setReasoningTraces: (value) => set({ reasoningTraces: value }),
  evidenceChains: {},
  setEvidenceChains: (value) => set({ evidenceChains: value }),

  // Data analysis
  dataAnalysisResult: null,
  setDataAnalysisResult: (result) => set({ dataAnalysisResult: result }),

  // Share
  showShareDialog: false,
  setShowShareDialog: (value) => set({ showShareDialog: value }),
  shareUrl: '',
  setShareUrl: (url) => set({ shareUrl: url }),

  // Panel layout (persisted to localStorage)
  setChatCollapsed: (value) => set({ chatCollapsed: value }),
  setChatPanelWidth: (value) => set({ chatPanelWidth: value }),
  setChatPanelHeight: (value) => set({ chatPanelHeight: value }),
}));