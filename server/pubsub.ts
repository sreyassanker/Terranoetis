/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';

type Handler = (data: any) => void;

class PubSub {
  private emitter = new EventEmitter();
  private handlerCount = 0;

  publish(channel: string, data: any): void {
    this.emitter.emit(channel, data);
  }

  subscribe(channel: string, handler: Handler): () => void {
    this.emitter.on(channel, handler);
    this.handlerCount++;
    return () => {
      this.emitter.off(channel, handler);
      this.handlerCount--;
    };
  }

  publishToUser(userId: string, eventType: string, data: any): void {
    const channel = `sse:${userId}`;
    this.emitter.emit(channel, { event: eventType, data });
    this.emitter.emit('sse:all', { userId, event: eventType, data });
  }

  subscribeUser(userId: string, handler: Handler): () => void {
    return this.subscribe(`sse:${userId}`, handler);
  }

  subscribeAll(handler: (data: { userId: string; event: string; data: any }) => void): () => void {
    return this.subscribe('sse:all', handler);
  }

  getHandlerCount(): number {
    return this.handlerCount;
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
    this.handlerCount = 0;
  }
}

export const pubsub = new PubSub();
