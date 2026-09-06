import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, X, MessageCircle } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import type { ChatTab } from '@/store/chatStore';

export function ChatTabs({
  onBeforeTabSwitch,
}: {
  onBeforeTabSwitch?: () => void;
}) {
  // Audit L4: subscribe to a minimal signature (ids+titles+active+typing dots)
  // instead of the whole store. Token-streaming mutates chatTabs[].messages
  // every ~40ms; the tab strip renders none of that, so it must not re-render.
  const tabsSig = useChatStore((s) =>
    s.chatTabs.map((t) => `${t.id}\u0000${t.title}`).join('\u0001')
    + '\u0002' + (s.activeTabId ?? '')
    + '\u0002' + Object.keys(s.tabTyping).filter((k) => s.tabTyping[k]).join(','),
  );
  void tabsSig; // subscription trigger only — data read fresh below
  const { chatTabs, activeTabId, tabTyping, openChatTab, closeChatTab, activateChatTab, renameChatTab } = useChatStore.getState();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  // Roving arrow-key navigation across the tab strip (WAI-ARIA tabs pattern).
  const onTabKeyDown = useCallback((e: React.KeyboardEvent, tab: ChatTab) => {
    const idx = chatTabs.findIndex(t => t.id === tab.id);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (chatTabs.length < 2) return;
      const next = e.key === 'ArrowRight'
        ? chatTabs[(idx + 1) % chatTabs.length]
        : chatTabs[(idx - 1 + chatTabs.length) % chatTabs.length];
      handleActivate(next.id);
      requestAnimationFrame(() => tabRefs.current.get(next.id)?.focus());
    } else if (e.key === 'Home') {
      e.preventDefault();
      const first = chatTabs[0];
      handleActivate(first.id);
      requestAnimationFrame(() => tabRefs.current.get(first.id)?.focus());
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = chatTabs[chatTabs.length - 1];
      handleActivate(last.id);
      requestAnimationFrame(() => tabRefs.current.get(last.id)?.focus());
    } else if (e.key === 'Enter') {
      handleActivate(tab.id);
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
      closeChatTab(tab.id);
    } else if (e.key === 'F2') {
      e.preventDefault();
      handleDoubleClick(tab);
    }
  }, [chatTabs, handleActivate, closeChatTab, handleDoubleClick]);

  // Keep the active tab visible in the horizontal strip when it changes.
  useEffect(() => {
    if (!activeTabId) return;
    tabRefs.current.get(activeTabId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  if (chatTabs.length === 0) return null;

  return (
    <div
      className="chat-tabs-strip"
      role="tablist"
      aria-label="Chat tabs"
      aria-orientation="horizontal"
    >
      {chatTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isEditing = editingId === tab.id;

        return (
          <div
            key={tab.id}
            ref={el => { if (el) tabRefs.current.set(tab.id, el); else tabRefs.current.delete(tab.id); }}
            className={`chat-tab-chip ${isActive ? 'active' : ''}`}
            onClick={() => handleActivate(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab)}
            title={tab.title}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(e) => onTabKeyDown(e, tab)}
          >
            <MessageCircle size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
            {tabTyping[tab.id] && (
              <span
                className="chat-tab-typing-dot"
                title="Generating…"
                aria-label="Generating"
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
                className="chat-tab-rename-input"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="chat-tab-title">
                {tab.title}
              </span>
            )}
            {chatTabs.length > 1 && (
              <button
                className="chat-tab-close"
                onClick={(e) => handleClose(e, tab.id)}
                title={`Close "${tab.title}"`}
                aria-label={`Close tab ${tab.title}`}
              >
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}
      <button
        className="chat-tab-add"
        onClick={() => openChatTab()}
        title="New Chat"
        aria-label="Open new chat tab"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
