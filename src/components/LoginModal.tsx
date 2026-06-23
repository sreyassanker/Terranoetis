import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginModal() {
  const { isLoggedIn, login } = useAuth();
  const [manualOpen, setManualOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const open = isLoggedIn ? false : manualOpen;

  useEffect(() => {
    const handler = () => {
      const token = localStorage.getItem('auth_token');
      if (!token) setManualOpen(true);
    };
    window.addEventListener('auth:required', handler);
    return () => window.removeEventListener('auth:required', handler);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) { setError('Username and password required'); return; }
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      setManualOpen(false);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16, padding: 32, width: 360,
        boxShadow: '0 0 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🌍</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>Earth Intelligence</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>Sign in to continue</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{
              padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 14, outline: 'none',
            }}
            autoFocus
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{
              padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 14, outline: 'none',
            }}
          />
          {error && <div style={{ color: '#ef4444', fontSize: 12, padding: '4px 0' }}>{error}</div>}
          <button
            type="submit" disabled={loading}
            style={{
              padding: '10px', borderRadius: 8, border: 'none',
              background: loading ? '#334155' : '#3b82f6', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'default' : 'pointer', marginTop: 4,
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        {import.meta.env.DEV && (
          <div style={{ marginTop: 16, fontSize: 11, color: '#64748b', textAlign: 'center' }}>
            Dev mode — check the server console for the auto-generated admin password on first start.
          </div>
        )}
      </div>
    </div>
  );
}
