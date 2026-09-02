import { useEffect, useRef, useState } from 'react';
import { Search as SearchIcon, Pencil, Download, Trash2 } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { groupChatsByDate, getChat, saveChat } from '@/lib/chatStore';
import { formatISTDate } from '@/lib/formatTime';

export function ChatHistoryPanel({
  loadChat,
  deleteChatSession,
  clearAllChats,
  currentChatId,
}: {
  loadChat: (id: string) => void;
  deleteChatSession: (id: string) => void;
  clearAllChats: () => void;
  currentChatId: string | null;
}) {
  const {
    chatList, showChatHistory, setShowChatHistory,
    chatSearch, setChatSearch, setChatList,
  } = useChatStore();

  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameBusyRef = useRef(false);

  // Escape closes the history drawer (listener only active while open).
  useEffect(() => {
    if (!showChatHistory) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowChatHistory(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showChatHistory, setShowChatHistory]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const filtered = chatSearch.trim()
    ? chatList.filter(c => c.title?.toLowerCase().includes(chatSearch.toLowerCase()) || c.id.toLowerCase().includes(chatSearch.toLowerCase()))
    : chatList;

  const handleClearAll = () => {
    if (!confirmClear) {
      // Two-step inline confirm — no native confirm() dialog.
      setConfirmClear(true);
      confirmTimerRef.current = setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setConfirmClear(false);
    clearAllChats();
  };

  const submitRename = async (id: string) => {
    // Enter fires form onSubmit AND input onBlur — dedupe with a busy flag.
    if (renameBusyRef.current) return;
    renameBusyRef.current = true;
    const title = renameValue.trim();
    setRenamingId(null);
    try {
      if (!title) return;
      // Optimistic local update first.
      setChatList(prev => prev.map(c => c.id === id ? { ...c, title } : c));
      // Persist: fetch the stored messages first so the upsert doesn't wipe them.
      const existing = await getChat(id);
      if (existing) {
        await saveChat({ id, title, messages: existing.messages, updatedAt: new Date().toISOString() });
      }
    } finally {
      renameBusyRef.current = false;
    }
  };

  const handleExport = async (id: string) => {
    const session = await getChat(id);
    if (!session) return;
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(session.title || 'chat').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`chat-history-panel glass-panel ${showChatHistory ? 'open' : ''}`}
      style={{
        position: 'fixed', top: 0, left: 0, width: 300, height: '100vh', zIndex: 1001,
        transform: showChatHistory ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      <div className="chat-history-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Chat History</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {chatList.length > 0 && (
            <button
              onClick={handleClearAll}
              title="Clear all chats"
              aria-label="Clear all chats"
              style={{
                background: confirmClear ? 'rgba(239,68,68,0.2)' : 'none',
                border: '1px solid rgba(239,68,68,0.3)', color: confirmClear ? '#fca5a5' : '#ef4444',
                cursor: 'pointer', fontSize: 10, padding: '2px 6px', borderRadius: 4,
                display: 'inline-flex', alignItems: 'center', gap: 3,
              }}
            >
              {confirmClear ? 'Sure?' : 'Clear all'}
            </button>
          )}
          <button onClick={() => setShowChatHistory(false)} aria-label="Close history" style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      </div>

      {chatList.length > 0 && (
        <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative' }}>
            <SearchIcon size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input
              value={chatSearch}
              onChange={e => setChatSearch(e.target.value)}
              placeholder="Search chats..."
              aria-label="Search chats"
              style={{ width: '100%', padding: '5px 8px 5px 26px', fontSize: 11, background: 'var(--bg-input,rgba(255,255,255,0.04))', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', outline: 'none' }}
            />
            {chatSearch && (
              <button onClick={() => setChatSearch('')} aria-label="Clear search" style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}>✕</button>
            )}
          </div>
        </div>
      )}

      <div className="chat-history-list" style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {chatList.length === 0 && <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>No saved chats yet.</div>}
        {chatSearch.trim() && filtered.length === 0 && <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>No chats match "{chatSearch}".</div>}
        {groupChatsByDate(filtered).map(group => (
          <div key={group.label}>
            <div className="chat-date-group" style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{group.label}</div>
            {group.items.map(chat => (
              <div
                key={chat.id}
                className={`chat-history-item ${chat.id === currentChatId ? 'active' : ''}`}
                onClick={() => loadChat(chat.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') loadChat(chat.id); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 14px', cursor: 'pointer', fontSize: 12, borderRadius: 0,
                  background: chat.id === currentChatId ? 'rgba(96,165,250,0.08)' : 'transparent',
                  borderLeft: chat.id === currentChatId ? '3px solid #60a5fa' : '3px solid transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingId === chat.id ? (
                    <form
                      onSubmit={e => { e.preventDefault(); submitRename(chat.id); }}
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => submitRename(chat.id)}
                        onKeyDown={e => { if (e.key === 'Escape') setRenamingId(null); }}
                        autoFocus
                        aria-label="Rename chat"
                        style={{ width: '100%', fontSize: 11, padding: '2px 6px', background: 'rgba(255,255,255,0.06)', border: '1px solid #60a5fa', borderRadius: 4, color: 'var(--text)', outline: 'none' }}
                      />
                    </form>
                  ) : (
                    <>
                      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.title}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                        {chat.messageCount} messages · {formatISTDate(chat.updatedAt || chat.createdAt)}
                      </div>
                    </>
                  )}
                </div>
                <div
                  className="chat-history-actions"
                  onClick={e => e.stopPropagation()}
                  style={{ display: 'flex', gap: 2, alignItems: 'center' }}
                >
                  <button
                    onClick={() => { setRenamingId(chat.id); setRenameValue(chat.title || ''); }}
                    title="Rename"
                    aria-label={`Rename ${chat.title}`}
                    className="delete-btn"
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => handleExport(chat.id)}
                    title="Export JSON"
                    aria-label={`Export ${chat.title}`}
                    className="delete-btn"
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}
                  >
                    <Download size={11} />
                  </button>
                  <button
                    onClick={async (e) => { e.stopPropagation(); await deleteChatSession(chat.id); }}
                    title="Delete"
                    aria-label={`Delete ${chat.title}`}
                    className="delete-btn"
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
