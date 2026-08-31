import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('PubSub', () => {
  let pubsub: { publish: (event: string, data: unknown) => void; subscribe: (event: string, handler: (...args: unknown[]) => void) => () => void; subscribeUser: (userId: string, handler: (...args: unknown[]) => void) => void; publishToUser: (userId: string, event: string, data: unknown) => void; removeAllListeners: () => void };

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../pubsub');
    pubsub = mod.pubsub;
    pubsub.removeAllListeners();
  });

  it('publish/subscribe delivers message', () => {
    const handler = vi.fn();
    pubsub.subscribe('test_event', handler);
    pubsub.publish('test_event', { data: 'hello' });
    expect(handler).toHaveBeenCalledWith({ data: 'hello' });
  });

  it('unsubscribe prevents delivery', () => {
    const handler = vi.fn();
    const unsubscribe = pubsub.subscribe('test_event', handler);
    unsubscribe();
    pubsub.publish('test_event', { data: 'hello' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('publishToUser delivers only to target user', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    pubsub.subscribeUser('user_a', handlerA);
    pubsub.subscribeUser('user_b', handlerB);
    pubsub.publishToUser('user_a', 'personal_event', { msg: 'secret' });
    expect(handlerA).toHaveBeenCalled();
    expect(handlerA.mock.calls[0][0].data.msg).toBe('secret');
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('multiple subscribers receive broadcast', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    pubsub.subscribe('bc', h1);
    pubsub.subscribe('bc', h2);
    pubsub.publish('bc', { msg: 'hello' });
    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });
});
