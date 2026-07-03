import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface AuthState {
  user: string | null;
  token: string | null;
  role: string | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const ROLE_KEY = 'auth_role';
let fetchPatchInstalled = false;
let originalFetch: typeof window.fetch | null = null;

function shouldAttachAuth(input: RequestInfo | URL): boolean {
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  try {
    const url = new URL(rawUrl, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return rawUrl.startsWith('/api/');
  }
}

function installAuthFetchPatch(): void {
  if (fetchPatchInstalled || typeof window === 'undefined') return;
  originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !shouldAttachAuth(input)) {
      return originalFetch!(input, init);
    }

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return originalFetch!(input, { ...init, headers });
  };
  fetchPatchInstalled = true;
}

installAuthFetchPatch();

function parseJwtRole(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function loadAuth(): AuthState {
  const token = localStorage.getItem(TOKEN_KEY);
  const user = localStorage.getItem(USER_KEY);
  const storedRole = localStorage.getItem(ROLE_KEY);
  const role = storedRole || (token ? parseJwtRole(token) : null);
  if (token && user) {
    const isAdmin = role === 'admin';
    return { user, token, role, isLoggedIn: true, isAdmin };
  }
  return { user: null, token: null, role: null, isLoggedIn: false, isAdmin: false };
}

function persistAuth(token: string, userId: string, role: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, userId);
  localStorage.setItem(ROLE_KEY, role);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(loadAuth);
  const [authReady, setAuthReady] = useState(() => !import.meta.env.DEV);

  useEffect(() => {
    const handler = () => setAuth(loadAuth());
    window.addEventListener('auth:updated', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('auth:updated', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  // DEV mode: always try dev-login for a fresh token, fall back to stored token
  useEffect(() => {
    if (!import.meta.env.DEV) {
      setAuthReady(true);
      return;
    }
    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1500;
    const stored = loadAuth();
    (async function tryLogin() {
      try {
        const resp = await fetch('/api/auth/dev-login', { method: 'POST' });
        if (!resp.ok) throw new Error(`dev-login ${resp.status}`);
        const data = await resp.json();
        if (!data?.token) throw new Error('no token in dev-login response');
        persistAuth(data.token, data.userId, data.role ?? 'user');
        setAuth({
          user: data.userId,
          token: data.token,
          role: data.role ?? 'user',
          isLoggedIn: true,
          isAdmin: data.role === 'admin',
        });
        window.dispatchEvent(new CustomEvent('auth:updated'));
      } catch {
        if (cancelled) return;
        retries++;
        if (retries < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY));
          if (!cancelled) return tryLogin();
        }
        if (!cancelled && stored.isLoggedIn) {
          setAuth(stored);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = () => {
      const reloaded = loadAuth();
      setAuth(reloaded);
      if (!reloaded.isLoggedIn) {
        window.dispatchEvent(new CustomEvent('auth:required'));
      }
    };
    window.addEventListener('auth:required', handler);
    return () => window.removeEventListener('auth:required', handler);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || `Login failed (${resp.status})`);
    }
    const data = await resp.json();
    const role = typeof data.role === 'string' ? data.role : 'user';
    persistAuth(data.token, data.userId, role);
    setAuth({
      user: data.userId,
      token: data.token,
      role,
      isLoggedIn: true,
      isAdmin: role === 'admin',
    });
    window.dispatchEvent(new CustomEvent('auth:updated'));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLE_KEY);
    setAuth({ user: null, token: null, role: null, isLoggedIn: false, isAdmin: false });
    window.dispatchEvent(new CustomEvent('auth:updated'));
    window.location.reload();
  }, []);

  return (
    <AuthContext.Provider value={{ ...auth, login, logout }}>
      {authReady ? children : null}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// eslint-disable-next-line react-refresh/only-export-components
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
