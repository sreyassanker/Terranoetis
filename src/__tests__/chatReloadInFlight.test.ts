import { describe, it, expect, vi } from 'vitest';

/**
 * Reload-hygiene guard: a page reload kills every in-flight stream, but the
 * persisted tab registry used to hydrate agentSteps with status 'running' and
 * tool chips pending on an expired approval — the process panel then spun
 * "Reasoning… 1518m 40s" forever. Hydration must mark interrupted work as
 * interrupted.
 */
function stubWindowWithRegistry(tabs: unknown[], activeTabId: string) {
  const items: Record<string, string> = {
    'chat-tabs-registry': JSON.stringify({ tabs, activeTabId }),
  };
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => items[k] ?? null,
      setItem: (k: string, v: string) => { items[k] = v; },
      removeItem: (k: string) => { delete items[k]; },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    fetch: () => Promise.reject(new Error('no network in test')),
    innerHeight: 900,
  };
}

describe('chatStore reload sanitizes in-flight state', () => {
  it('process timeline is dropped, pending+blocked tool chips become interrupted, messages survive', async () => {
    const old = Date.now() - 91_000_000; // ~25h ago — the "1518m" case
    stubWindowWithRegistry([{
      id: 'tab-1', title: 'A', titleAuto: false, sessionId: 's1',
      messages: [{
        id: 1, role: 'assistant', content: 'partial answer',
        toolEvents: [
          { name: 'earthquakes', status: 'pending' },
          { name: 'sandbox_python', status: 'blocked', approvalRequired: true, approvalId: 'apr_x' },
        ],
      }],
      input: '', selectedTier: 'flash', selectedModel: 'auto',
      agentSteps: [
        { type: 'reasoning', text: 'Reasoning…', status: 'running', startedAt: old },
        { type: 'tool', text: 'fetched', status: 'completed', startedAt: old },
      ],
      pipelineProgress: [{ id: 'p1', description: 'run', status: 'running' }],
      chatImages: [], editingMessageId: null, currentChatId: null,
      sandboxWorkspaceId: null, width: 380, height: null, collapsed: false,
    }], 'tab-1');
    vi.resetModules();
    const { useChatStore } = await import('@/store/chatStore');
    const st = useChatStore.getState();
    const tab = st.chatTabs[0];

    // Transient process state is gone entirely — nothing to render a panel from.
    expect(tab.agentSteps).toHaveLength(0);
    expect(tab.pipelineProgress).toHaveLength(0);
    // Durable conversation survives, with honest chip states.
    expect(tab.messages).toHaveLength(1);
    expect(tab.messages[0].content).toBe('partial answer');
    const events = tab.messages[0].toolEvents!;
    expect(events.every(e => e.status !== 'pending' && e.status !== 'blocked')).toBe(true);
    expect(events[1].error).toMatch(/expired/i);

    // The singleton hydrates from the SANITIZED active tab, and typing is off.
    expect(st.agentSteps).toHaveLength(0);
    expect(st.aiTyping).toBe(false);

    delete (globalThis as Record<string, unknown>).window;
  });
});
