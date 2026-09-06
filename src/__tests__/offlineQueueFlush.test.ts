import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock idb-keyval with an in-memory store so flushQueue can be tested in node.
const mem = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => mem.get(k),
  set: async (k: string, v: unknown) => { mem.set(k, v); },
  del: async (k: string) => { mem.delete(k); },
}));

import { queueMessage, flushQueue, getQueuedMessages } from '@/lib/offlineChat';

describe('offline queue flush (the previously-missing half of offline chat)', () => {
  beforeEach(() => mem.clear());

  it('messages queue while offline', async () => {
    await queueMessage('earthquakes in Japan', 's1');
    await queueMessage('weather in Paris', 's1');
    const q = await getQueuedMessages();
    expect(q.length).toBe(2);
    expect(q.map(m => m.content)).toEqual(['earthquakes in Japan', 'weather in Paris']);
  });

  it('flushQueue sends every message in order and empties the queue', async () => {
    await queueMessage('a', 's1');
    await queueMessage('b', 's1');
    await queueMessage('c', 's1');
    const sent: string[] = [];
    const n = await flushQueue(async (content) => { sent.push(content); return true; });
    expect(n).toBe(3);
    expect(sent).toEqual(['a', 'b', 'c']);
    expect((await getQueuedMessages()).length).toBe(0);
  });

  it('defers (leaves queued) when the sender cannot send yet', async () => {
    await queueMessage('a', 's1');
    await queueMessage('b', 's1');
    const sent: string[] = [];
    const n = await flushQueue(async (content) => {
      if (content === 'b') return false; // simulate "a stream is active"
      sent.push(content); return true;
    });
    expect(sent).toEqual(['a']);
    expect(n).toBe(1);
    const remaining = await getQueuedMessages();
    expect(remaining.map(m => m.content)).toEqual(['b']); // 'b' restored, not lost
  });
});
