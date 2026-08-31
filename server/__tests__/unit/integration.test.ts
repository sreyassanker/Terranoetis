import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pubsub } from '../../pubsub';

describe('PubSub Integration', () => {
  beforeEach(() => {
    pubsub.removeAllListeners();
  });

  it('publish/subscribe roundtrip delivers message', () => {
    const handler = vi.fn();
    pubsub.subscribe('test.event', handler);
    pubsub.publish('test.event', { hello: 'world' });
    expect(handler).toHaveBeenCalledWith({ hello: 'world' });
  });

  it('multiple subscribers receive same message', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    pubsub.subscribe('multi.event', h1);
    pubsub.subscribe('multi.event', h2);
    pubsub.publish('multi.event', { msg: 'broadcast' });
    expect(h1).toHaveBeenCalledWith({ msg: 'broadcast' });
    expect(h2).toHaveBeenCalledWith({ msg: 'broadcast' });
  });

  it('unsubscribe stops messages', () => {
    const handler = vi.fn();
    const unsub = pubsub.subscribe('unsub.event', handler);
    pubsub.publish('unsub.event', { msg: 'first' });
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    pubsub.publish('unsub.event', { msg: 'second' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
