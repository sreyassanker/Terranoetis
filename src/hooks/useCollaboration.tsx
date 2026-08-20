import { useState, useEffect, useCallback } from 'react';
import type { WsMessage } from './useWebSocket';

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  cursorPosition?: number;
  isTyping: boolean;
  lastActive: number;
}

interface CollaborationState {
  users: PresenceUser[];
  isTyping: boolean;
  typingUsers: string[];
}

interface WebSocketLike {
  sendMessage?: (msg: Record<string, unknown>) => boolean;
  subscribe?: (channel: string) => void;
  unsubscribe?: (channel: string) => void;
  onMessage?: (type: string, handler: (msg: WsMessage) => void) => () => void;
  status?: string;
  connected?: boolean;
  lastMessage?: WsMessage | null;
}

const USER_COLORS = ['#60a5fa', '#34d399', '#a78bfa', '#f59e0b', '#ef4444', '#22d3ee', '#ec4899'];

function getRandomColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

export function useCollaboration(
  ws: WebSocketLike | null,
  sessionId: string,
  userId: string = 'browser-user',
  userName: string = 'You',
) {
  const [state, setState] = useState<CollaborationState>({
    users: [],
    isTyping: false,
    typingUsers: [],
  });

  const userColor = useState(() => getRandomColor())[0];

  const broadcastTyping = useCallback((isTyping: boolean) => {
    if (ws?.sendMessage) {
      ws.sendMessage({
        type: 'presence',
        subtype: isTyping ? 'typing_start' : 'typing_end',
        sessionId,
        userId,
        userName,
        userColor,
      });
    }
    setState(prev => ({
      ...prev,
      isTyping,
      typingUsers: isTyping
        ? [...new Set([...prev.typingUsers, userId])]
        : prev.typingUsers.filter(id => id !== userId),
    }));
  }, [ws, sessionId, userId, userName, userColor]);

  const broadcastCursorPosition = useCallback((position: number) => {
    if (ws?.sendMessage) {
      ws.sendMessage({
        type: 'presence',
        subtype: 'cursor_move',
        sessionId,
        userId,
        position,
      });
    }
  }, [ws, sessionId, userId]);

  useEffect(() => {
    if (!ws) return;

    const handler = (data: { type: string; subtype?: string; sessionId?: string; userId?: string; userName?: string; userColor?: string; position?: number }) => {
      if (data.sessionId !== sessionId) return;
      if (!data.userId) return;

      setState((prev: CollaborationState): CollaborationState => {
        const existingUser = prev.users.find(u => u.id === data.userId);

        if (data.subtype === 'join' || data.subtype === 'heartbeat') {
          const userId = data.userId!;
          const users = existingUser
            ? prev.users.map(u => u.id === userId ? { ...u, lastActive: Date.now(), name: data.userName || u.name } : u)
            : [...prev.users, {
                id: userId,
                name: data.userName || 'User',
                color: data.userColor || getRandomColor(),
                isTyping: false,
                lastActive: Date.now(),
              }];
          return { ...prev, users };
        }

        if (data.subtype === 'typing_start') {
          const userId = data.userId!;
          const users = existingUser
            ? prev.users.map(u => u.id === userId ? { ...u, isTyping: true, lastActive: Date.now() } : u)
            : [...prev.users, {
                id: userId,
                name: data.userName || 'User',
                color: data.userColor || getRandomColor(),
                isTyping: true,
                lastActive: Date.now(),
              }];
          return {
            ...prev,
            users,
            typingUsers: [...new Set([...prev.typingUsers, userId])],
          };
        }

        if (data.subtype === 'typing_end') {
          return {
            ...prev,
            users: prev.users.map(u => u.id === data.userId ? { ...u, isTyping: false } : u),
            typingUsers: prev.typingUsers.filter(id => id !== data.userId),
          };
        }

        if (data.subtype === 'cursor_move') {
          return {
            ...prev,
            users: prev.users.map(u =>
              u.id === data.userId ? { ...u, cursorPosition: data.position, lastActive: Date.now() } : u
            ),
          };
        }

        if (data.subtype === 'leave') {
          return {
            ...prev,
            users: prev.users.filter(u => u.id !== data.userId),
            typingUsers: prev.typingUsers.filter(id => id !== data.userId),
          };
        }

        return prev;
      });
    };

    const unsubscribe = ws.onMessage?.('presence', handler);

    // Announce join
    if (ws?.sendMessage) {
      ws.sendMessage({
        type: 'presence',
        subtype: 'join',
        sessionId,
        userId,
        userName,
        userColor,
      });
    }

    // Heartbeat
    const interval = setInterval(() => {
      if (ws?.sendMessage) {
        ws.sendMessage({
          type: 'presence',
          subtype: 'heartbeat',
          sessionId,
          userId,
          userName,
          userColor,
        });
      }
    }, 15000);

    return () => {
      unsubscribe?.();
      clearInterval(interval);
      if (ws?.sendMessage) {
        ws.sendMessage({
          type: 'presence',
          subtype: 'leave',
          sessionId,
          userId,
        });
      }
    };
  }, [ws, sessionId, userId, userName, userColor]);

  return {
    ...state,
    broadcastTyping,
    broadcastCursorPosition,
    userColor,
  };
}