import { useState, useRef, useCallback } from 'react';
import { Plus, X, MessageCircle } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import type { ChatTab } from '@/store/chatStore';

const TAB_CHIP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  whiteSpace: 'nowrap',
  maxWidth: 120,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  border: '1px solid transparent',
};

const TAB_ACTIVE_STYLE: React.CSSProperties = {
  ...TAB_CHIP_STYLE,
  background: 'rgba(129, 140, 248, 0.18)',
  border: '1px solid rgba(129, 140, 248, 0.4)',
  color: '#a5b4fc',
};

const TAB_INACTIVE_STYLE: React.CSSProperties = {
  ...TAB_CHIP_STYLE,
  background: 'rgba(100, 116, 139, 0.1)',
  border: '1px solid rgba(100, 116, 139, 0.2)',
  color: '#94a3b8',
};

const CLOSE_BTN_STYLE: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'inherit',
  opacity: 0.5,
  transition: 'opacity 0.15s',
  flexShrink: 0,
};

const ADD_BTN_STYLE: React.CSSProperties = {
  ...TAB_CHIP_STYLE,
  background: 'rgba(34, 197, 94, 0.1)',
  border: '1px solid rgba(34, 197, 94, 0.3)',
  color: '#4ade80',
  padding: '3px 6px',
};

export function ChatTabs({
  onBeforeTabSwitch,
}: {
  onBeforeTabSwitch?: () => void;
}) {
  const {
    chatTabs,
    activeTabId,
    openChatTab,
    closeChatTab,
    activateChatTab,
    renameChatTab,
    tabTyping,
  } = useChatStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback((tab: ChatTab) => {
    setEditingId(tab.id);
    setEditValue(tab.title);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      renameChatTab(editingId, editValue.trim());
    }
    setEditingId(null);
  }, [editingId, editValue, renameChatTab]);

  const handleClose = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    closeChatTab(id);
  }, [closeChatTab]);

  const handleActivate = useCallback((id: string) => {
    activateChatTab(id, onBeforeTabSwitch);
  }, [activateChatTab, onBeforeTabSwitch]);

  if (chatTabs.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderBottom: '1px solid rgba(129, 140, 248, 0.15)',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
      className="chat-tabs-strip"
    >
      {chatTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isEditing = editingId === tab.id;

        return (
          <div
            key={tab.id}
            style={isActive ? TAB_ACTIVE_STYLE : TAB_INACTIVE_STYLE}
            className={`chat-tab-chip ${isActive ? 'active' : ''}`}
            onClick={() => handleActivate(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab)}
            title={tab.title}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') activateChatTab(tab.id);
              if (e.key === 'Delete') closeChatTab(tab.id);
            }}
          >
            <MessageCircle size={10} style={{ flexShrink: 0, opacity: 0.6 }} />
            {tabTyping[tab.id] && (
              <span
                title="Generating…"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: '#4ade80',
                  boxShadow: '0 0 4px rgba(74, 222, 128, 0.8)',
                }}
              />
            )}
            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'inherit',
                  fontSize: 'inherit',
                  fontWeight: 'inherit',
                  padding: 0,
                  margin: 0,
                  width: '100%',
                  minWidth: 40,
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {tab.title}
              </span>
            )}
            {chatTabs.length > 1 && (
              <button
                style={CLOSE_BTN_STYLE}
                onClick={(e) => handleClose(e, tab.id)}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; }}
                title={`Close "${tab.title}"`}
                aria-label={`Close tab ${tab.title}`}
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}
      <button
        style={ADD_BTN_STYLE}
        onClick={() => openChatTab()}
        title="New Chat"
        aria-label="Open new chat tab"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
