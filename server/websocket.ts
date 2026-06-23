/* eslint-disable @typescript-eslint/no-explicit-any */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { pubsub } from './pubsub';
import { logger } from './observability/logger';
import { _JWT_SECRET as getJwtSecret } from './middleware/auth';

const IS_PROD = process.env.NODE_ENV === 'production';
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 35000;

// Channel authorization rules:
//   - `ws:${userId}`  — owned by the connecting user
//   - `fork:${forkId}` — allowed (fork streaming is global; ownership checked at REST API)
//   - `ws:all`        — public, read-only broadcasts
//   - everything else must be in the explicit allowlist below
const PUBLIC_CHANNELS = new Set(['ws:all', 'sentinel:raw', 'proactive', 'fork:all']);
const CHANNEL_MAX_LENGTH = 128;
const VALID_CHANNEL_RE = /^(ws:[a-zA-Z0-9_.-]{1,64}|fork:[a-zA-Z0-9_.-]{1,64}|[a-z][a-z0-9_:-]{0,80})$/;

interface WsClient {
  ws: WebSocket;
  userId: string;
  channels: Set<string>;
  lastPong: number;
  subscribedChannels: Map<string, () => void>;
}

type WsMessage = {
  type: 'subscribe' | 'unsubscribe' | 'ping' | 'pong' | 'command' | 'ack' | 'subscribe_fork';
  channel?: string;
  channels?: string[];
  action?: string;
  requestId?: string;
  payload?: unknown;
  messageId?: string;
  forkId?: string;
};

const clients = new Map<string, WsClient>();
const pendingAbortControllers = new Map<string, AbortController>();

export function getActiveConnections(): number {
  return clients.size;
}

export function getUserConnections(userId: string): number {
  let count = 0;
  for (const [, client] of clients) {
    if (client.userId === userId) count++;
  }
  return count;
}

function verifyTokenOrReject(token: string): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub?: unknown };
    if (typeof payload.sub !== 'string') return null;
    return payload.sub;
  } catch {
    return null;
  }
}

function isValidChannelName(ch: unknown): ch is string {
  if (typeof ch !== 'string') return false;
  if (ch.length === 0 || ch.length > CHANNEL_MAX_LENGTH) return false;
  // Reject path traversal / null bytes / control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f/]/.test(ch)) return false;
  return VALID_CHANNEL_RE.test(ch);
}

function canSubscribe(userId: string, channel: string): boolean {
  if (PUBLIC_CHANNELS.has(channel)) return true;
  if (channel.startsWith(`ws:${userId}`)) return true;
  if (channel.startsWith('fork:')) return true;
  // Block anything else — channels must be added to the allowlist or follow the `ws:userId` pattern
  return false;
}

export function createWsServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws/agent') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket, request) => {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token') || '';

    const userId = verifyTokenOrReject(token);
    if (!userId) {
      logger.warn({ remote: request.socket.remoteAddress }, 'websocket rejected: invalid or missing token');
      ws.close(4001, 'Authentication required');
      return;
    }

    const clientId = `${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const client: WsClient = {
      ws,
      userId,
      channels: new Set<string>(),
      lastPong: Date.now(),
      subscribedChannels: new Map(),
    };
    clients.set(clientId, client);

    logger.info({ userId, clientId }, 'websocket connected');

    const heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - client.lastPong > HEARTBEAT_TIMEOUT) {
        logger.warn({ userId, clientId }, 'heartbeat timeout, closing');
        ws.close(4002, 'Heartbeat timeout');
        return;
      }
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        /* connection may be dead */
      }
    }, HEARTBEAT_INTERVAL);

    const unsubUser = pubsub.subscribe(`ws:${userId}`, (data: any) => {
      try {
        ws.send(JSON.stringify(data));
      } catch { /* ignore */ }
    });
    const unsubAll = pubsub.subscribe('ws:all', (data: any) => {
      try {
        ws.send(JSON.stringify(data));
      } catch { /* ignore */ }
    });
    const unsubForks = pubsub.subscribe('fork:all', (data: any) => {
      try {
        ws.send(JSON.stringify({ type: 'FORK_STREAM', ...data }));
      } catch { /* ignore */ }
    });

    ws.send(JSON.stringify({
      type: 'connected',
      userId,
      channels: Array.from(client.channels),
    }));

    ws.on('message', (raw) => {
      client.lastPong = Date.now();
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'pong':
          client.lastPong = Date.now();
          break;

        case 'subscribe': {
          const channels = Array.isArray(msg.channels) ? msg.channels : (msg.channel ? [msg.channel] : []);
          const accepted: string[] = [];
          const rejected: string[] = [];
          for (const ch of channels) {
            if (!isValidChannelName(ch)) {
              rejected.push(String(ch).slice(0, 64));
              continue;
            }
            if (!canSubscribe(userId, ch)) {
              rejected.push(ch);
              continue;
            }
            if (!client.channels.has(ch)) {
              client.channels.add(ch);
              const unsub = pubsub.subscribe(ch, (data: any) => {
                try {
                  ws.send(JSON.stringify({ channel: ch, type: 'message', data }));
                } catch { /* ignore */ }
              });
              client.subscribedChannels.set(ch, unsub);
              accepted.push(ch);
            }
          }
          ws.send(JSON.stringify({ type: 'subscribed', channels: Array.from(client.channels), accepted, rejected }));
          break;
        }

        case 'unsubscribe': {
          const channels = Array.isArray(msg.channels) ? msg.channels : (msg.channel ? [msg.channel] : []);
          for (const ch of channels) {
            if (isValidChannelName(ch) && client.channels.has(ch)) {
              client.channels.delete(ch);
              const unsub = client.subscribedChannels.get(ch);
              if (unsub) {
                unsub();
                client.subscribedChannels.delete(ch);
              }
            }
          }
          ws.send(JSON.stringify({ type: 'unsubscribed', channels: Array.from(client.channels) }));
          break;
        }

        case 'command':
          handleClientCommand(ws, msg, userId);
          break;

        case 'ack':
          if (msg.messageId) {
            logger.debug({ messageId, userId }, 'ack received');
          }
          break;

        case 'subscribe_fork': {
          const forkId = msg.forkId;
          if (!forkId || !/^[a-zA-Z0-9_.-]{1,64}$/.test(forkId)) break;
          const channelName = `fork:${forkId}`;
          if (client.channels.has(channelName)) break;
          client.channels.add(channelName);
          const unsubSpecific = pubsub.subscribe(channelName, (data: any) => {
            try {
              ws.send(JSON.stringify({ type: 'FORK_STREAM', forkId, ...data }));
            } catch { /* ignore */ }
          });
          client.subscribedChannels.set(channelName, unsubSpecific);
          try {
            ws.send(JSON.stringify({ type: 'FORK_SUBSCRIBED', forkId }));
          } catch { /* ignore */ }
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeatTimer);
      unsubUser();
      unsubAll();
      unsubForks();
      for (const [, unsub] of client.subscribedChannels) {
        unsub();
      }
      clients.delete(clientId);
      logger.info({ userId, clientId }, 'websocket disconnected');
    });

    ws.on('error', () => {
      clearInterval(heartbeatTimer);
      unsubUser();
      unsubAll();
      unsubForks();
      for (const [, unsub] of client.subscribedChannels) {
        unsub();
      }
      clients.delete(clientId);
    });
  });

  return wss;
}

function handleClientCommand(ws: WebSocket, msg: WsMessage, userId: string): void {
  const action = msg.action || '';
  const requestId = msg.requestId || '';
  const payload = msg.payload;

  switch (action) {
    case 'cancel_request':
      if (requestId && /^[a-zA-Z0-9_.-]{1,64}$/.test(requestId)) {
        const controller = pendingAbortControllers.get(requestId);
        if (controller) {
          controller.abort();
          pendingAbortControllers.delete(requestId);
          ws.send(JSON.stringify({ type: 'ack', action: 'cancel_request', requestId, status: 'cancelled' }));
          logger.info({ requestId, userId }, 'request cancelled via websocket');
        } else {
          ws.send(JSON.stringify({ type: 'ack', action: 'cancel_request', requestId, status: 'not_found' }));
        }
      }
      break;

    case 'typing':
      pubsub.publish(`ws:${userId}`, { type: 'typing', userId, payload });
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown action: ${action}` }));
      break;
  }
}

export function registerAbortController(requestId: string, controller: AbortController): void {
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(requestId)) return;
  pendingAbortControllers.set(requestId, controller);
  setTimeout(() => {
    pendingAbortControllers.delete(requestId);
  }, 60000);
}

export function removeAbortController(requestId: string): void {
  pendingAbortControllers.delete(requestId);
}

export function broadcastToUser(userId: string, eventType: string, data: any): void {
  pubsub.publish(`ws:${userId}`, { type: 'message', event: eventType, data });
}

export function broadcastToAll(eventType: string, data: any): void {
  pubsub.publish('ws:all', { type: 'message', event: eventType, data });
}

export function shutdownWsServer(): void {
  for (const [, client] of clients) {
    try {
      client.ws.close(1001, 'Server shutting down');
    } catch { /* ignore */ }
  }
  clients.clear();
  pendingAbortControllers.clear();
  logger.info('websocket server shut down');
}

// Re-export IS_PROD so other modules can align production behavior
export { IS_PROD };
