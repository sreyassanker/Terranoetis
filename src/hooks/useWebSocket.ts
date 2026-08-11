import { useCallback, useEffect, useRef, useState } from 'react';

export type WsConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface WsMessage {
  type: string;
  channel?: string;
  event?: string;
  data?: unknown;
  userId?: string;
  messageId?: string;
  action?: string;
  requestId?: string;
  status?: string;
  payload?: unknown;
}

const WS_BASE = import.meta.env.VITE_WS_URL || `ws://${location.hostname}:3001`;
const WS_PATH = '/ws/agent';
const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;
const PING_INTERVAL = 30000;

export function useWebSocket(token?: string) {
  const [status, setStatus] = useState<WsConnectionStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const handlersRef = useRef<Map<string, Set<(msg: WsMessage) => void>>>(new Map());
  const mountedRef = useRef(true);

  const sendMessage = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const subscribe = useCallback((channel: string) => {
    sendMessage({ type: 'subscribe', channels: [channel] });
  }, [sendMessage]);

  const unsubscribe = useCallback((channel: string) => {
    sendMessage({ type: 'unsubscribe', channels: [channel] });
  }, [sendMessage]);

  const cancelRequest = useCallback((requestId: string) => {
    sendMessage({ type: 'command', action: 'cancel_request', requestId });
  }, [sendMessage]);

  const sendTyping = useCallback((payload?: unknown) => {
    sendMessage({ type: 'command', action: 'typing', payload });
  }, [sendMessage]);

  const sendAck = useCallback((messageId: string) => {
    sendMessage({ type: 'ack', messageId });
  }, [sendMessage]);

  const onMessage = useCallback((type: string, handler: (msg: WsMessage) => void) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const clearTimers = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    };

    // Detach every handler first, then close. Calling close() on a WebSocket
    // that is still CONNECTING makes the browser log "WebSocket is closed
    // before the connection is established" — avoid it by letting an in-flight
    // connection fail on its own (its handlers are already detached).
    const safeClose = (ws: WebSocket) => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
        ws.close();
      }
    };

    const closeSocket = () => {
      if (wsRef.current) {
        safeClose(wsRef.current);
        wsRef.current = null;
      }
    };

    if (!token) {
      clearTimers();
      closeSocket();
      reconnectAttemptsRef.current = 0;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('disconnected');
      return () => {
        mountedRef.current = false;
        clearTimers();
        closeSocket();
      };
    }

    const connect = () => {
      if (!mountedRef.current || !token) return;

      const url = `${WS_BASE}${WS_PATH}?token=${encodeURIComponent(token)}`;

      setStatus(prev => prev === 'disconnected' ? 'connecting' : 'reconnecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setStatus('connected');
        reconnectAttemptsRef.current = 0;

        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg: WsMessage = JSON.parse(event.data);
          setLastMessage(msg);

          if (msg.type === 'ping') {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'pong' }));
            }
            return;
          }

          if (msg.type === 'pong') return;

          if (msg.type === 'connected') {
            setStatus('connected');
          }

          if (msg.type === 'ack' && msg.messageId) {
            const ackHandlers = handlersRef.current.get('ack');
            ackHandlers?.forEach(h => h(msg));
          }

          const typeHandlers = handlersRef.current.get(msg.type);
          typeHandlers?.forEach(h => h(msg));

          const eventHandlers = handlersRef.current.get(msg.event || '');
          eventHandlers?.forEach(h => h(msg));

          const channelHandlers = handlersRef.current.get(`channel:${msg.channel}`);
          channelHandlers?.forEach(h => h(msg));
        } catch {
          /* ignore malformed messages */
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        wsRef.current = null;
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (reconnectAttemptsRef.current > 0) {
          setStatus('reconnecting');
        } else {
          setStatus('disconnected');
        }

        const delay = Math.min(
          INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current),
          MAX_RECONNECT_DELAY,
        );
        const jitter = delay * (0.5 + Math.random() * 0.5);
        reconnectAttemptsRef.current++;
        reconnectTimerRef.current = setTimeout(connect, jitter);
      };

      ws.onerror = () => {
        // The connection attempt failed (e.g. the agent server is down).
        // readyState may still be CONNECTING here, so don't call close() —
        // detach handlers and let the socket settle so the browser doesn't log
        // "WebSocket is closed before the connection is established".
        ws.onopen = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
          ws.close();
        }
      };
    };

    connect();

    return () => {
      mountedRef.current = false;
      clearTimers();
      closeSocket();
    };
  }, [token]);

  return {
    status,
    connected: status === 'connected',
    lastMessage,
    sendMessage,
    subscribe,
    unsubscribe,
    cancelRequest,
    sendTyping,
    sendAck,
    onMessage,
  };
}
