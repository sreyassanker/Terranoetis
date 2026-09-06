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
  /** True while the title is system-generated ("Chat N") and may be
   *  auto-replaced by the first message snippet. Manual renames set false. */
  titleAuto?: boolean;
  sessionId: string;
  messages: ChatMessage[];
  input: string;
  selectedTier: string;
  /** Per-tab model choice (audit L5): 'auto' or a provider/model id. */
  selectedModel: string;
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
    selectedModel: state.selectedModel,
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
  selectedModel: string;
  availableModels: ChatState['availableModels'];
  agentSteps: AgentStep[];
  pipelineProgress: PipelineStep[];
  chatImages: ChatImage[];
  editingMessageId: number | null;
  currentChatId: string | null;
  sandboxWorkspaceId: string | null;
} {
  return {
    messages: [],
    input: '',
    selectedTier: 'flash',
    selectedModel: 'auto',
    availableModels: [],
    agentSteps: [],
    pipelineProgress: [],
    chatImages: [],
    editingMessageId: null,
    currentChatId: null,
    sandboxWorkspaceId: null,
  };
}

const TABS_STORAGE_KEY = 'chat-tabs-registry';

// Titles that the system owns and may auto-replace with a message snippet.
// The regex also covers legacy persisted tabs (pre-titleAuto field).
const AUTO_TITLE_RE = /^(New Chat|Chat \d+)$/;

function isAutoTitled(tab: Pick<ChatTab, 'title' | 'titleAuto'>): boolean {
  return tab.titleAuto === true || (tab.titleAuto === undefined && AUTO_TITLE_RE.test(tab.title));
}

function nextChatNumber(tabs: ChatTab[]): number {
  let max = 0;
  for (const t of tabs) {
    const m = /^Chat (\d+)$/.exec(t.title);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return Math.max(max, tabs.length) + 1;
}

const TAB_TITLE_MAX = 18;

/** Short chip-friendly title derived from the first user message. */
export function tabTitleFromText(text: string): string | null {
  const clean = text
    .replace(/^📷\s*\[Image:[^\]]*\]\s*/i, '')
    .replace(/^📊\s*\[Data[^\]]*\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  return clean.length > TAB_TITLE_MAX ? clean.slice(0, TAB_TITLE_MAX).trimEnd() + '…' : clean;
}

function loadTabRegistry(): { tabs: ChatTab[]; activeTabId: string | null } {
  if (typeof window === 'undefined') return { tabs: [], activeTabId: null };
  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed = JSON.parse(raw) as { tabs?: ChatTab[]; activeTabId?: string };
    return { tabs: (parsed.tabs || []).map(sanitizeInFlightState), activeTabId: parsed.activeTabId || null };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

/**
 * A reload kills every in-flight stream. The process timeline (agentSteps /
 * pipelineProgress) is TRANSIENT live state — once the stream is gone it has
 * nothing to show, and hydrating it left a dead "Reasoning… 6/7 · 1518m 40s"
 * panel on screen forever. Drop it on load; the conversation messages (and
 * their tool chips) are the durable part and stay.
 */
function sanitizeInFlightState(tab: ChatTab): ChatTab {
  const messages = (tab.messages || []).map(m => {
    if (!m.toolEvents || !m.toolEvents.some(e => e.status === 'pending' || e.status === 'blocked')) return m;
    return {
      ...m,
      toolEvents: m.toolEvents.map(e =>
        e.status === 'pending' || e.status === 'blocked'
          ? { ...e, status: 'error' as const, error: e.status === 'blocked' ? 'Approval expired (page reloaded)' : 'Interrupted (page reloaded)' }
          : e,
      ),
    };
  });
  return { ...tab, agentSteps: [], pipelineProgress: [], messages };
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
  /** Replace a still-auto tab title with a snippet of the first user message. */
  autoTitleTabFromText: (tabId: string, text: string) => void;

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

  // Available LLM models (from /api/agent/models) + user's selection.
  availableModels: Array<{ id: string; provider: string; model: string; label: string; available: boolean; status: string; local: boolean; tier: number }>;
  setAvailableModels: (models: ChatState['availableModels']) => void;
  /** User-selected model id (e.g. "groq/compound", "local"), or "auto" for default. */
  selectedModel: string;
  setSelectedModel: (id: string) => void;

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

  // Active study area bbox (drawn on globe) — sent with AI requests so the
  // analytical engine can compute grids over the user's real study area.
  studyAreaBbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null;
  setStudyAreaBbox: (bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null) => void;
  /** The AI query awaiting a drawn study area — auto-sent when drawing completes. */
  pendingStudyAreaQuery: string | null;
  setPendingStudyAreaQuery: (query: string | null) => void;

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
  // No seeded "welcome" bubble — the premium empty-state block in ChatPanel is
  // the single onboarding surface (shown while there are ≤1 messages).
  aiMessages: initialActiveTab ? initialActiveTab.messages : [],
  aiInput: initialActiveTab ? initialActiveTab.input : '',
  selectedTier: initialActiveTab ? initialActiveTab.selectedTier : 'flash',
  selectedModel: initialActiveTab && initialActiveTab.selectedModel ? initialActiveTab.selectedModel : 'auto',
  availableModels: [],
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
    // Snapshot current active tab before switching (audit C5: functional set
    // so concurrent background-tab updates are not clobbered).
    if (s.activeTabId) {
      const snapshot = snapshotActiveTab(s);
      const prevId = s.activeTabId;
      set((cur) => ({
        chatTabs: cur.chatTabs.map(t =>
          t.id === prevId ? { ...t, ...snapshot, title: t.title } : t
        ),
      }));
    }
    const newTab: ChatTab = {
      id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || `Chat ${nextChatNumber(get().chatTabs)}`,
      titleAuto: !title,
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
      // Hydrate the singleton sessionId from the new tab. Without this the
      // singleton keeps the PREVIOUS tab's sessionId, so useChat sends the new
      // chat's requests under the old session → server-side conversation memory
      // cross-talk between tabs.
      sessionId: newTab.sessionId,
      aiMessages: newTab.messages,
      aiInput: newTab.input,
      selectedTier: newTab.selectedTier,
      selectedModel: newTab.selectedModel,
      agentSteps: newTab.agentSteps,
      pipelineProgress: newTab.pipelineProgress,
      chatImages: newTab.chatImages,
      editingMessageId: newTab.editingMessageId,
      currentChatId: newTab.currentChatId,
      sandboxWorkspaceId: newTab.sandboxWorkspaceId,
      aiTyping: false,
      // A new chat is a fresh spatial context — a study area drawn in another
      // tab must not leak into (and silently scope) this one's queries.
      studyAreaBbox: null,
      pendingStudyAreaQuery: null,
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
          sessionId: nextTab.sessionId,
          aiMessages: nextTab.messages,
          aiInput: nextTab.input,
          selectedTier: nextTab.selectedTier,
          selectedModel: nextTab.selectedModel,
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
          studyAreaBbox: null,
          pendingStudyAreaQuery: null,
          streamingMdRef: { current: new StreamingMarkdownRenderer() },
        });
      } else {
        // No tabs left — create a fresh one
        const freshTab: ChatTab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: `Chat ${nextChatNumber(newTabs)}`,
          titleAuto: true,
          sessionId: `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ...freshTabState(),
          width: s.chatPanelWidth,
          height: s.chatPanelHeight,
          collapsed: false,
        };
        set({
          chatTabs: [freshTab],
          activeTabId: freshTab.id,
          sessionId: freshTab.sessionId,
          aiMessages: freshTab.messages,
          aiInput: freshTab.input,
          selectedTier: freshTab.selectedTier,
          selectedModel: freshTab.selectedModel,
          agentSteps: freshTab.agentSteps,
          pipelineProgress: freshTab.pipelineProgress,
          chatImages: freshTab.chatImages,
          editingMessageId: freshTab.editingMessageId,
          currentChatId: freshTab.currentChatId,
          sandboxWorkspaceId: freshTab.sandboxWorkspaceId,
          aiTyping: false,
          studyAreaBbox: null,
          pendingStudyAreaQuery: null,
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
    // Snapshot current tab. Audit C5: apply the snapshot via a FUNCTIONAL set
    // so a background tab's mutateTab that landed between get() and set() is
    // not clobbered by the stale chatTabs array.
    if (s.activeTabId) {
      const snapshot = snapshotActiveTab(s);
      const prevId = s.activeTabId;
      set((cur) => ({
        chatTabs: cur.chatTabs.map(t =>
          t.id === prevId ? { ...t, ...snapshot, title: t.title } : t
        ),
      }));
    }
    // Re-read from the FRESH state (audit C5): the target tab may have
    // received background stream updates since `s` was captured.
    const targetTab = get().chatTabs.find(t => t.id === id);
    if (!targetTab) return;
    // Hydrate singleton from target tab
    set({
      activeTabId: id,
      aiMessages: targetTab.messages,
      aiInput: targetTab.input,
      sessionId: targetTab.sessionId,
      selectedTier: targetTab.selectedTier,
      selectedModel: targetTab.selectedModel ?? 'auto',
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
      studyAreaBbox: null,
      pendingStudyAreaQuery: null,
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
      patch.selectedModel = updated.selectedModel;
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
    const newTabs = s.chatTabs.map(t => t.id === id ? { ...t, title, titleAuto: false } : t);
    set({ chatTabs: newTabs });
    persistTabRegistry(newTabs, s.activeTabId);
  },

  autoTitleTabFromText: (tabId: string, text: string) => {
    const s = get();
    const tab = s.chatTabs.find(t => t.id === tabId);
    if (!tab || !isAutoTitled(tab)) return;
    const title = tabTitleFromText(text);
    if (!title) return;
    const newTabs = s.chatTabs.map(t => t.id === tabId ? { ...t, title, titleAuto: false } : t);
    set({ chatTabs: newTabs });
    scheduleTabPersist(newTabs, s.activeTabId);
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
    const ns = get();
    if (ns.activeTabId) scheduleTabPersist(ns.chatTabs, ns.activeTabId);
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
    const ns = get();
    if (ns.activeTabId) scheduleTabPersist(ns.chatTabs, ns.activeTabId);
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
    const ns = get();
    if (ns.activeTabId) scheduleTabPersist(ns.chatTabs, ns.activeTabId);
  },
  clearMessages: () => {
    const s = get();
    const patch: Partial<ChatState> = { aiMessages: [] };
    if (s.activeTabId) {
      const idx = s.chatTabs.findIndex(t => t.id === s.activeTabId);
      if (idx >= 0) patch.chatTabs = s.chatTabs.map((t, i) => i === idx ? { ...t, messages: [] } : t);
    }
    set(patch);
    const ns = get();
    if (ns.activeTabId) scheduleTabPersist(ns.chatTabs, ns.activeTabId);
  },

  // Input
  setAiInput: (value) => {
    set({ aiInput: value });
    const s = get();
    if (s.activeTabId) {
      set({
        chatTabs: s.chatTabs.map(t =>
          t.id === s.activeTabId ? { ...t, input: value } : t
        ),
      });
      scheduleTabPersist(get().chatTabs, s.activeTabId);
    }
  },
  setEditingMessageId: (value) => set({ editingMessageId: value }),

  // Typing
  aiTyping: false,
  setAiTyping: (value) => set({ aiTyping: value }),
  streamingMdRef: { current: new StreamingMarkdownRenderer() },

  // Session
  // Audit L5: tier/model choices must persist per-tab (registry + refresh),
  // not live only in the singleton where a tab switch or reload reverted them.
  setSelectedTier: (tier) => {
    set({ selectedTier: tier });
    const s = get();
    if (s.activeTabId) {
      const tabs = s.chatTabs.map(t => (t.id === s.activeTabId ? { ...t, selectedTier: tier } : t));
      set({ chatTabs: tabs });
      scheduleTabPersist(tabs, s.activeTabId);
    }
  },

  // Model tiers
  modelTiers: [],
  setModelTiers: (tiers) => set({ modelTiers: tiers }),

  // Available LLM models + user's selection (auto = default behaviour)
  setAvailableModels: (models) => set({ availableModels: models }),
  setSelectedModel: (id) => {
    set({ selectedModel: id });
    const s = get();
    if (s.activeTabId) {
      const tabs = s.chatTabs.map(t => (t.id === s.activeTabId ? { ...t, selectedModel: id } : t));
      set({ chatTabs: tabs });
      scheduleTabPersist(tabs, s.activeTabId);
    }
  },

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

  // Study area bbox
  studyAreaBbox: null,
  setStudyAreaBbox: (bbox) => set({ studyAreaBbox: bbox }),
  pendingStudyAreaQuery: null,
  setPendingStudyAreaQuery: (query) => set({ pendingStudyAreaQuery: query }),

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