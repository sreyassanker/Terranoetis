import { get, set, del } from 'idb-keyval';
import type { ChatMessage } from '@/lib/chatStore';

const CHAT_CACHE_KEY = 'terranoetis_chat_cache';
const MESSAGE_QUEUE_KEY = 'terranoetis_msg_queue';
const OFFLINE_BUFFER_KEY = 'terranoetis_offline_buffer';

interface CachedChat {
  sessionId: string;
  messages: ChatMessage[];
  savedAt: number;
}

interface CachedChats {
  sessions: Record<string, CachedChat>;
}

interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
  sessionId: string;
  retries?: number;
}

const MAX_RETRIES = 3;
const MAX_QUEUE_SIZE = 500;
const MAX_BUFFER_SIZE = 100;
const MAX_CACHED_MESSAGES = 50;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 100 * (MAX_RETRIES - retries + 1)));
      return withRetry(fn, retries - 1);
    }
    throw e;
  }
}

export async function cacheChatSession(sessionId: string, messages: ChatMessage[]): Promise<void> {
  try {
    await withRetry(async () => {
      const cached = await get<CachedChats>(CHAT_CACHE_KEY);
      const sessions = cached?.sessions || {};
      sessions[sessionId] = {
        sessionId,
        messages: messages.slice(-MAX_CACHED_MESSAGES),
        savedAt: Date.now(),
      };
      // Limit total sessions to prevent unbounded growth
      const sessionEntries = Object.entries(sessions);
      if (sessionEntries.length > 100) {
        sessionEntries.sort((a, b) => a[1].savedAt - b[1].savedAt);
        const toKeep = sessionEntries.slice(-100);
        Object.keys(sessions).forEach(key => delete sessions[key]);
        toKeep.forEach(([k, v]) => { sessions[k] = v; });
      }
      await set(CHAT_CACHE_KEY, { sessions });
    });
  } catch (e) {
    console.warn('Failed to cache chat session:', e);
  }
}

export async function getCachedChatSession(sessionId: string): Promise<ChatMessage[] | null> {
  try {
    const cached = await get<CachedChats>(CHAT_CACHE_KEY);
    const session = cached?.sessions?.[sessionId];
    return session?.messages || null;
  } catch {
    return null;
  }
}

export async function listCachedSessions(): Promise<Array<{ sessionId: string; savedAt: number; messageCount: number }>> {
  try {
    const cached = await get<CachedChats>(CHAT_CACHE_KEY);
    if (!cached?.sessions) return [];
    return Object.values(cached.sessions).map(s => ({
      sessionId: s.sessionId,
      savedAt: s.savedAt,
      messageCount: s.messages.length,
    }));
  } catch {
    return [];
  }
}

export async function queueMessage(content: string, sessionId: string): Promise<void> {
  try {
    await withRetry(async () => {
      const queue = await get<QueuedMessage[]>(MESSAGE_QUEUE_KEY) || [];
      queue.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content,
        timestamp: Date.now(),
        sessionId,
        retries: 0,
      });
      // Limit queue size
      if (queue.length > MAX_QUEUE_SIZE) {
        queue.splice(0, queue.length - MAX_QUEUE_SIZE);
      }
      await set(MESSAGE_QUEUE_KEY, queue);
    });
  } catch (e) {
    console.warn('Failed to queue message:', e);
    throw e; // Re-throw so caller can handle
  }
}

export async function getQueuedMessages(): Promise<QueuedMessage[]> {
  try {
    return await get<QueuedMessage[]>(MESSAGE_QUEUE_KEY) || [];
  } catch {
    return [];
  }
}

let _flushing = false;
/**
 * Drain the offline queue in order once connectivity returns. For each queued
 * message we optimistically remove it from the store, then hand it to `sendFn`.
 * If `sendFn` reports it could not send right now (e.g. a stream is already in
 * flight), we stop and leave the remaining messages queued for the next attempt.
 * Returns the number of messages successfully sent. This is the missing half of
 * the offline feature — previously queueMessage() wrote messages nothing read.
 */
export async function flushQueue(
  sendFn: (content: string, sessionId: string) => Promise<boolean>,
): Promise<number> {
  if (_flushing) return 0;
  _flushing = true;
  let sent = 0;
  try {
    // Bound the loop so a pathological sendFn can't spin forever.
    for (let guard = 0; guard < MAX_QUEUE_SIZE + 1; guard++) {
      const queue = await get<QueuedMessage[]>(MESSAGE_QUEUE_KEY) || [];
      if (queue.length === 0) break;
      const [head, ...rest] = queue;
      await set(MESSAGE_QUEUE_KEY, rest); // remove first (crash-safe: no infinite retry)
      let ok = false;
      try { ok = await sendFn(head.content, head.sessionId); } catch { ok = false; }
      if (ok) sent++;
      else { await set(MESSAGE_QUEUE_KEY, [head, ...rest]); break; } // defer, restore
    }
  } finally {
    _flushing = false;
  }
  return sent;
}

export async function clearMessageQueue(): Promise<void> {
  try {
    await del(MESSAGE_QUEUE_KEY);
  } catch (e) {
    console.warn('Failed to clear message queue:', e);
  }
}

export async function storeOfflineBuffer(data: { type: string; payload: unknown }): Promise<void> {
  try {
    await withRetry(async () => {
      const buffer = await get<Array<{ type: string; payload: unknown; timestamp: number }>>(OFFLINE_BUFFER_KEY) || [];
      buffer.push({ ...data, timestamp: Date.now() });
      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.shift();
      }
      await set(OFFLINE_BUFFER_KEY, buffer);
    });
  } catch (e) {
    console.warn('Failed to store offline buffer:', e);
  }
}

export async function getOfflineBuffer(): Promise<Array<{ type: string; payload: unknown; timestamp: number }>> {
  try {
    return await get<Array<{ type: string; payload: unknown; timestamp: number }>>(OFFLINE_BUFFER_KEY) || [];
  } catch {
    return [];
  }
}

export async function clearOfflineBuffer(): Promise<void> {
  try {
    await del(OFFLINE_BUFFER_KEY);
  } catch {
    // ignore
  }
}

export async function clearAllOfflineData(): Promise<void> {
  try {
    await Promise.all([
      del(CHAT_CACHE_KEY),
      del(MESSAGE_QUEUE_KEY),
      del(OFFLINE_BUFFER_KEY),
    ]);
  } catch {
    // ignore
  }
}

export function isOnline(): boolean {
  return navigator.onLine;
}

export function addOnlineListener(callback: (online: boolean) => void): () => void {
  const handler = () => callback(navigator.onLine);
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  return () => {
    window.removeEventListener('online', handler);
    window.removeEventListener('offline', handler);
  };
}