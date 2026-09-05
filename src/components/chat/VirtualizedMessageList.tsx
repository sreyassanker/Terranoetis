import { useCallback, useRef, useEffect, useState, useMemo, useImperativeHandle, forwardRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import type { ChatMessage } from '@/lib/chatStore';
import { StreamingMarkdownRenderer } from '@/lib/advancedChat';
import { ChatMessageRow } from './ChatMessageRow';

const ROW_HEIGHT_ESTIMATE = 64;
const MIN_ROW_HEIGHT = 40;
const MAX_ROW_HEIGHT = 800;
const NEAR_BOTTOM_PX = 80;

interface VirtualizedMessageListProps {
  messages: ChatMessage[];
  aiTyping: boolean;
  streamingRenderer: StreamingMarkdownRenderer;
  renderItem?: (msg: ChatMessage, idx: number, isLast: boolean) => React.ReactNode;
}

interface VirtualizedMessageListHandle {
  scrollToBottom: () => void;
}

export const VirtualizedMessageList = forwardRef<VirtualizedMessageListHandle, VirtualizedMessageListProps>(
  ({ messages, aiTyping, streamingRenderer, renderItem }, ref) => {
    const parentRef = useRef<HTMLDivElement>(null);
    const rowHeightCache = useRef<Map<number, number>>(new Map());
    const [isNearBottom, setIsNearBottom] = useState(true);
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);

    const estimateRowHeight = useCallback((index: number) => {
      const cached = rowHeightCache.current.get(index);
      if (cached) return cached;
      const msg = messages[index];
      if (!msg) return ROW_HEIGHT_ESTIMATE;

      let height = ROW_HEIGHT_ESTIMATE;
      if (msg.content) {
        height += msg.content.split('\n').length * 4;
      }
      if (msg.toolEvents?.length) {
        height += msg.toolEvents.length * 28;
      }
      if (msg.subAgents?.length) {
        height += 60;
      }
      if (msg.plan) {
        height += 80;
      }
      if (msg.artifacts?.length) {
        height += msg.artifacts.length * 100;
      }
      if (msg.commands?.length) {
        height += msg.commands.length * 24;
      }
      if (msg.images?.length) {
        height += msg.images.length * 150;
      }
      return Math.min(Math.max(height, MIN_ROW_HEIGHT), MAX_ROW_HEIGHT);
    }, [messages]);

    const virtualizer = useVirtualizer({
      count: messages.length,
      getScrollElement: () => parentRef.current,
      estimateSize: estimateRowHeight,
      overscan: 5,
    });

    useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        if (messages.length === 0) return;
        virtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'smooth' });
        setIsNearBottom(true);
        setShowJumpToLatest(false);
      },
    }), [messages.length, virtualizer]);

    const handleScroll = useCallback(() => {
      const el = parentRef.current;
      if (!el) return;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      setIsNearBottom(near);
      setShowJumpToLatest(!near && messages.length > 1);
    }, [messages.length]);

    // Follow the stream: auto-scroll when a new message arrives OR when the
    // last message grows (token streaming) — but only if the user is already
    // near the bottom. Never yank the user out of history while reading.
    const lastMessageLength = messages.length > 0 ? (messages[messages.length - 1].content?.length ?? 0) : 0;
    useEffect(() => {
      if (messages.length === 0 || !isNearBottom) return;
      // Instant scroll while streaming avoids smooth-scroll jank per token.
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: aiTyping ? 'auto' : 'smooth' });
    }, [messages.length, lastMessageLength, isNearBottom, aiTyping, virtualizer]);

    const virtualItems = virtualizer.getVirtualItems();

    // Screen-reader announcements. This is a dedicated visually-hidden live
    // region rather than aria-live on the scroll container: virtualized rows
    // are added/removed from the DOM on every scroll, which would otherwise
    // spam "live region changed" announcements. We only announce message
    // arrivals / stream start & completion (not per token).
    const liveRegionText = useMemo(() => {
      if (messages.length === 0) return '';
      const last = messages[messages.length - 1];
      if (last.role === 'user') return 'You sent a message.';
      return aiTyping ? 'Assistant is responding.' : `Assistant: ${last.content.slice(-160)}`;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length, aiTyping]);

    const defaultRenderItem = useCallback((msg: ChatMessage, idx: number, isLast: boolean) => (
      <ChatMessageRow
        msg={msg}
        idx={idx}
        isLast={isLast}
        aiTyping={aiTyping}
        streamingRenderer={streamingRenderer}
      />
    ), [aiTyping, streamingRenderer]);

    const renderMessage = renderItem || defaultRenderItem;

    return (
      <div
        ref={parentRef}
        className="ai-messages"
        onScroll={handleScroll}
        style={{
          // Bottom spacer keeps the last message from sitting flush against the
          // composer; flex:1 (from .ai-messages) sizes the scroll area itself.
          // The 120px floor keeps the composer visible on short viewports.
          paddingBottom: 60,
          overflowY: 'auto',
          position: 'relative',
          minHeight: 120,
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map(virtualRow => {
            const msg = messages[virtualRow.index];
            if (!msg) return null;
            // No explicit height: the row auto-sizes to its content and
            // measureElement() reads the true rendered height. Hard-coding
            // `height` here pinned every row to its estimate and produced the
            // large gaps between messages.
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingBottom: 10,
                }}
              >
                {renderMessage(msg, virtualRow.index, virtualRow.index === messages.length - 1)}
              </div>
            );
          })}
        </div>
        {showJumpToLatest && (
          <button
            className="chat-jump-latest"
            onClick={() => {
              // Flipping isNearBottom re-triggers the follow-stream effect,
              // which performs the actual smooth scroll — single source of truth.
              setIsNearBottom(true);
              setShowJumpToLatest(false);
            }}
            aria-label="Jump to latest message"
            title="Jump to latest"
          >
            <ArrowDown size={12} /> Latest
          </button>
        )}
        <div className="visually-hidden" role="log" aria-live="polite">
          {liveRegionText}
        </div>
      </div>
    );
  }
);

VirtualizedMessageList.displayName = 'VirtualizedMessageList';

export { VirtualizedMessageList as default };
export type { VirtualizedMessageListHandle };
