import { useChatStore } from '@/store/chatStore';
import { useShallow } from 'zustand/react/shallow';
import { StreamingMarkdownRenderer } from '@/lib/advancedChat';
import type { AgentStep, ChatImage, ChatTab, PipelineStep } from '@/store/chatStore';

interface ChatPanelState {
  showAI: boolean;
  setShowAI: (value: boolean | ((prev: boolean) => boolean)) => void;
  aiMessages: import('@/lib/chatStore').ChatMessage[];
  aiTyping: boolean;
  aiInput: string;
  setAiInput: (value: string) => void;
  editingMessageId: number | null;
  setEditingMessageId: (value: number | null) => void;
  showChatHistory: boolean;
  setShowChatHistory: (value: boolean) => void;
  adaptiveSuggestions: string[];
  pdfExporting: boolean;
  setPdfExporting: (value: boolean) => void;
  sandboxWorkspaceId: string | null;
  uploadedFiles: string[];
  isListening: boolean;
  speaking: boolean;
  sessionId: string;
  selectedTier: string;
  setSelectedTier: (tier: string) => void;
  modelTiers: Array<{ id: string; label: string; description: string; costPerQuery: number; latencyMs: number }>;
  showShareDialog: boolean;
  setShowShareDialog: (value: boolean) => void;
  shareUrl: string;
  setShareUrl: (url: string) => void;
  agentSteps: AgentStep[];
  pipelineProgress: PipelineStep[];
  streamingMdRef: { current: StreamingMarkdownRenderer };
  streamingRenderer: StreamingMarkdownRenderer;
  chatImages: ChatImage[];
  setChatImages: (images: ChatImage[] | ((prev: ChatImage[]) => ChatImage[])) => void;
  chatCollapsed: boolean;
  setChatCollapsed: (value: boolean) => void;
  chatPanelWidth: number;
  setChatPanelWidth: (value: number) => void;
  chatPanelHeight: number | null;
  setChatPanelHeight: (value: number | null) => void;
  // Tab registry
  chatTabs: ChatTab[];
  activeTabId: string | null;
  openChatTab: (title?: string) => void;
  closeChatTab: (id: string) => void;
  activateChatTab: (id: string) => void;
  renameChatTab: (id: string, title: string) => void;
}

export function useChatPanelState(): ChatPanelState {
  return useChatStore(useShallow(state => ({
    showAI: state.showAI,
    setShowAI: state.setShowAI,
    aiMessages: state.aiMessages,
    aiTyping: state.aiTyping,
    aiInput: state.aiInput,
    setAiInput: state.setAiInput,
    editingMessageId: state.editingMessageId,
    setEditingMessageId: state.setEditingMessageId,
    showChatHistory: state.showChatHistory,
    setShowChatHistory: state.setShowChatHistory,
    adaptiveSuggestions: state.adaptiveSuggestions,
    pdfExporting: state.pdfExporting,
    setPdfExporting: state.setPdfExporting,
    sandboxWorkspaceId: state.sandboxWorkspaceId,
    uploadedFiles: state.uploadedFiles,
    isListening: state.isListening,
    speaking: state.speaking,
    sessionId: state.sessionId,
    selectedTier: state.selectedTier,
    setSelectedTier: state.setSelectedTier,
    modelTiers: state.modelTiers,
    showShareDialog: state.showShareDialog,
    setShowShareDialog: state.setShowShareDialog,
    shareUrl: state.shareUrl,
    setShareUrl: state.setShareUrl,
    agentSteps: state.agentSteps,
    pipelineProgress: state.pipelineProgress,
    streamingMdRef: state.streamingMdRef,
    streamingRenderer: state.streamingMdRef.current as StreamingMarkdownRenderer,
    chatImages: state.chatImages,
    setChatImages: state.setChatImages,
    chatCollapsed: state.chatCollapsed,
    setChatCollapsed: state.setChatCollapsed,
    chatPanelWidth: state.chatPanelWidth,
    setChatPanelWidth: state.setChatPanelWidth,
    chatPanelHeight: state.chatPanelHeight,
    setChatPanelHeight: state.setChatPanelHeight,
    // Tab registry
    chatTabs: state.chatTabs,
    activeTabId: state.activeTabId,
    openChatTab: state.openChatTab,
    closeChatTab: state.closeChatTab,
    activateChatTab: state.activateChatTab,
    renameChatTab: state.renameChatTab,
  })));
}

export function useChatInputState() {
  return useChatStore(useShallow(state => ({
    aiInput: state.aiInput,
    setAiInput: state.setAiInput,
    adaptiveSuggestions: state.adaptiveSuggestions,
  })));
}

export function useChatSessionState() {
  return useChatStore(useShallow(state => ({
    sessionId: state.sessionId,
    selectedTier: state.selectedTier,
    showShareDialog: state.showShareDialog,
    setShowShareDialog: state.setShowShareDialog,
    shareUrl: state.shareUrl,
    setShareUrl: state.setShareUrl,
  })));
}

export function useChatExportState() {
  return useChatStore(useShallow(state => ({
    pdfExporting: state.pdfExporting,
    setPdfExporting: state.setPdfExporting,
    aiMessages: state.aiMessages,
    sessionId: state.sessionId,
    selectedTier: state.selectedTier,
  })));
}

export function useChatVoiceState() {
  return useChatStore(useShallow(state => ({
    isListening: state.isListening,
    speaking: state.speaking,
    voiceMode: state.voiceMode,
    setVoiceMode: state.setVoiceMode,
    bargeIn: state.bargeIn,
    setBargeIn: state.setBargeIn,
    setIsListening: state.setIsListening,
    setSpeaking: state.setSpeaking,
    stopSpeaking: state.stopSpeaking,
  })));
}

export function useChatThinkingState() {
  return useChatStore(useShallow(state => ({
    agentSteps: state.agentSteps,
    setAgentSteps: state.setAgentSteps,
    addAgentStep: state.addAgentStep,
    clearAgentSteps: state.clearAgentSteps,
    pipelineProgress: state.pipelineProgress,
    setPipelineProgress: state.setPipelineProgress,
    clearPipelineProgress: state.clearPipelineProgress,
    thinkingExpanded: state.thinkingExpanded,
    setThinkingExpanded: state.setThinkingExpanded,
    expandedStep: state.expandedStep,
    setExpandedStep: state.setExpandedStep,
  })));
}

export function useStreamingRenderer() {
  return useChatStore(state => state.streamingMdRef.current) as StreamingMarkdownRenderer;
}