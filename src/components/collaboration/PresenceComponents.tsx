import type { PresenceUser } from '@/hooks/useCollaboration';

export function PresenceIndicator({ users, typingUsers }: { users: PresenceUser[]; typingUsers: string[] }) {
  const others = users.filter(u => u.id !== 'browser-user');
  const typingOthers = typingUsers.filter(id => id !== 'browser-user');

  if (others.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
      borderTop: '1px solid var(--border)', fontSize: 10,
    }}>
      <div style={{ display: 'flex', marginRight: 4 }}>
        {others.slice(0, 3).map(user => (
          <div
            key={user.id}
            style={{
              width: 20, height: 20, borderRadius: '50%', background: user.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 600, color: '#fff', marginLeft: -4,
              border: '2px solid var(--panel)',
            }}
            title={user.name}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
        ))}
        {others.length > 3 && (
          <div style={{
            width: 20, height: 20, borderRadius: '50%', background: 'var(--text-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, marginLeft: -4, border: '2px solid var(--panel)',
          }}>
            +{others.length - 3}
          </div>
        )}
      </div>
      <span style={{ color: 'var(--text-dim)' }}>
        {others.length} viewer{others.length > 1 ? 's' : ''}
        {typingOthers.length > 0 && ` · ${typingOthers.length} typing`}
      </span>
    </div>
  );
}

export function RemoteCursor({ user, inputWidth }: { user: PresenceUser; inputWidth: number }) {
  if (user.cursorPosition === undefined) return null;

  const left = Math.min((user.cursorPosition / 100) * inputWidth, inputWidth - 10);

  return (
    <div
      style={{
        position: 'absolute', left, top: 0, bottom: 0, width: 2,
        background: user.color, transition: 'left 0.1s ease', pointerEvents: 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: -18, left: 0, fontSize: 8, padding: '1px 4px',
        background: user.color, color: '#fff', borderRadius: '2px 4px 4px 4px',
        whiteSpace: 'nowrap',
      }}>
        {user.name}
      </div>
    </div>
  );
}