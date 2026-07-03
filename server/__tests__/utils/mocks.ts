import { vi } from 'vitest';

export function mockGeminiResponse(overrides?: Partial<{
  text: string;
  embedding: number[];
  evalScores: Record<string, number>;
}>) {
  const defaults = {
    text: 'Mock AI response for testing purposes.',
    embedding: Array(768).fill(0).map((_, i) => Math.cos(i * 0.1)),
    evalScores: { relevance: 0.8, factualAccuracy: 0.7, helpfulness: 0.9, conciseness: 0.6 },
  };
  const cfg = { ...defaults, ...overrides };

  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('embedContent')) {
      return Promise.resolve(new Response(JSON.stringify({
        embedding: { values: cfg.embedding },
      })));
    }
    if (url.includes('generateContent') || url.includes('interactions')) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const isEval = body?.contents?.[0]?.parts?.[0]?.text?.includes('Rate the following AI response');
      if (isEval) {
        return Promise.resolve(new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(cfg.evalScores) }] } }],
        })));
      }
      return Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: cfg.text }] } }],
      })));
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  }) as unknown as (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export function restoreFetch(): void {
  vi.restoreAllMocks();
}

export function mockWebSocketClient() {
  const messages: unknown[] = [];
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  return {
    messages,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    },
    send: (data: string) => {
      messages.push(JSON.parse(data));
    },
    close: vi.fn(),
    emit: (event: string, ...args: unknown[]) => {
      (handlers[event] || []).forEach(h => h(...args));
    },
  };
}

export function mockSseResponse() {
  const events: Array<{ type: string; data: unknown }> = [];
  return {
    events,
    writeHead: vi.fn().mockReturnThis(),
    write: vi.fn((chunk: string) => {
      const match = chunk.match(/event: (.+)\ndata: (.+)/);
      if (match) {
        events.push({ type: match[1], data: JSON.parse(match[2]) });
      }
    }),
    end: vi.fn(),
    on: vi.fn(),
  };
}
