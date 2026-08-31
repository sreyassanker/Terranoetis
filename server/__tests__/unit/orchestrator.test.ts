import { describe, it, expect, vi, beforeAll } from 'vitest';

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

function setGeminiResponse(text: string) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  });
}

describe('AgentOrchestrator.orchestrate', () => {
  beforeAll(() => {
    setGeminiResponse(JSON.stringify({ nodes: [], synthesisPrompt: '' }));
  });

  it('returns valid output for simple query', async () => {
    const { AgentOrchestrator } = await import('../../orchestrator');
    const orchestrator = new AgentOrchestrator('test-key');
    const result = await orchestrator.orchestrate('hello');
    expect(result).toBeTruthy();
    expect(typeof result.output).toBe('string');
  });

  it('returns output for a query with no nodes', async () => {
    const { AgentOrchestrator } = await import('../../orchestrator');
    const orchestrator = new AgentOrchestrator('test-key');
    setGeminiResponse(JSON.stringify({ nodes: [], synthesisPrompt: 'Just greet the user' }));
    const result = await orchestrator.orchestrate('Hi there');
    expect(result.output).toBe('');
  });

  it('accepts optional context', async () => {
    const { AgentOrchestrator } = await import('../../orchestrator');
    const orchestrator = new AgentOrchestrator('test-key');
    const result = await orchestrator.orchestrate('earthquakes near me', {
      location: { lat: 35, lon: 139, label: 'Tokyo' },
      intent: 'scan',
      layers: ['seismic'],
    });
    expect(result).toBeTruthy();
  });
});

describe('DAG execution', () => {
  beforeAll(async () => {
    // Will be set per-test
  });

  it('rejects if no fetch mock for plan response', async () => {
    const { AgentOrchestrator } = await import('../../orchestrator');
    mockFetch.mockRejectedValue(new Error('network error'));
    const orchestrator = new AgentOrchestrator('test-key');
    await expect(orchestrator.orchestrate('test query')).rejects.toThrow();
  });
});

describe('CircuitBreaker usage', () => {
  it('opens after repeated failures', async () => {
    const { CircuitBreaker } = await import('../../resilience');
    const cb = new CircuitBreaker(3, 60000, 60000);
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail');
    }
    expect(cb.getState()).toBe('OPEN');
  });
});
