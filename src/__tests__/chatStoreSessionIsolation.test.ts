import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '@/store/chatStore';

/**
 * Regression guard for cross-tab sessionId bleed.
 * openChatTab() and closeChatTab() must hydrate the singleton `sessionId` from
 * the active tab, otherwise useChat sends the new chat's requests under the
 * previous tab's session and the server's per-session conversation memory
 * cross-talks between tabs.
 */
describe('chatStore sessionId hydration', () => {
  beforeEach(() => {
    const s = useChatStore.getState();
    // reset to a known single-tab state
    useChatStore.setState({ chatTabs: [], activeTabId: null, sessionId: 's_ORIGINAL' });
    void s;
  });

  it('openChatTab sets singleton sessionId to the new tab (not the old one)', () => {
    useChatStore.getState().openChatTab('A');
    const tabA = useChatStore.getState();
    const sessionIdA = tabA.sessionId;
    const tabAId = tabA.activeTabId!;
    expect(sessionIdA).not.toBe('s_ORIGINAL');

    useChatStore.getState().openChatTab('B');
    const tabB = useChatStore.getState();
    expect(tabB.activeTabId).not.toBe(tabAId);
    expect(tabB.sessionId).toBe(tabB.chatTabs.find(t => t.id === tabB.activeTabId)!.sessionId);
    expect(tabB.sessionId).not.toBe(sessionIdA); // genuinely a NEW session
  });

  it('switching back to a tab restores that tab’s own sessionId', () => {
    useChatStore.getState().openChatTab('A');
    const idA = useChatStore.getState().activeTabId!;
    const sessA = useChatStore.getState().sessionId;
    useChatStore.getState().openChatTab('B');
    const sessB = useChatStore.getState().sessionId;
    expect(sessB).not.toBe(sessA);
    useChatStore.getState().activateChatTab(idA);
    expect(useChatStore.getState().sessionId).toBe(sessA);
  });

  it('closing the active tab activates a remaining tab with ITS sessionId', () => {
    useChatStore.getState().openChatTab('A');
    const idA = useChatStore.getState().activeTabId!;
    useChatStore.getState().openChatTab('B');
    const idB = useChatStore.getState().activeTabId!;
    const sessB = useChatStore.getState().chatTabs.find(t => t.id === idB)!.sessionId;
    // close B (active) → A becomes active and must carry A's session, not B's
    useChatStore.getState().closeChatTab(idB);
    const after = useChatStore.getState();
    expect(after.activeTabId).toBe(idA);
    expect(after.sessionId).toBe(after.chatTabs.find(t => t.id === idA)!.sessionId);
    expect(after.sessionId).not.toBe(sessB);
  });
});
