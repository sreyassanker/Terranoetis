// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { useChatStore } from '@/store/chatStore';

/**
 * Audit L5 guard: tier + model choices must persist into the per-tab registry
 * (and survive tab switches), not live only in the singleton.
 */
describe('chatStore tier/model per-tab persistence (audit L5)', () => {
  const store = useChatStore;

  it('setSelectedTier writes the active tab registry', () => {
    store.getState().openChatTab('A');
    const idA = store.getState().activeTabId!;
    store.getState().setSelectedTier('pro');
    const tab = store.getState().chatTabs.find(t => t.id === idA)!;
    expect(tab.selectedTier).toBe('pro');
  });

  it('setSelectedModel writes the active tab registry', () => {
    store.getState().openChatTab('A');
    const idA = store.getState().activeTabId!;
    store.getState().setSelectedModel('groq/compound');
    const tab = store.getState().chatTabs.find(t => t.id === idA)!;
    expect(tab.selectedModel).toBe('groq/compound');
  });

  it('tier+model survive a tab switch round-trip', () => {
    store.getState().openChatTab('A');
    const idA = store.getState().activeTabId!;
    store.getState().setSelectedTier('pro');
    store.getState().setSelectedModel('local');
    store.getState().openChatTab('B');
    expect(store.getState().selectedTier).toBe('flash');
    expect(store.getState().selectedModel).toBe('auto');
    store.getState().activateChatTab(idA);
    expect(store.getState().selectedTier).toBe('pro');
    expect(store.getState().selectedModel).toBe('local');
  });
});
