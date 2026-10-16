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
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loginAsDesktopOperator: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const ROLE_KEY = 'auth_role';
const LOGGED_OUT_KEY = 'auth_logged_out';
import { isDesktopApp, installDesktopFetchPatch } from '@/lib/desktop';
export { isDesktopApp };

installDesktopFetchPatch();

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
  const isExplicitlyLoggedOut = localStorage.getItem(LOGGED_OUT_KEY) === 'true';
  if (isExplicitlyLoggedOut) {
    return { user: null, token: null, role: null, isLoggedIn: false, isAdmin: false };
  }

  const token = localStorage.getItem(TOKEN_KEY);
  const user = localStorage.getItem(USER_KEY);
  const storedRole = localStorage.getItem(ROLE_KEY);
  const role = storedRole || (token ? parseJwtRole(token) : (isDesktopApp ? 'admin' : null));
  if (token && user) {
    const isAdmin = role === 'admin' || isDesktopApp;
    return { user, token, role, isLoggedIn: true, isAdmin };
  }
  if (isDesktopApp) {
    return {
      user: user || 'desktop-operator',
      token: token || null,
      role: 'admin',
      isLoggedIn: true,
      isAdmin: true,
    };
  }
  return { user: null, token: null, role: null, isLoggedIn: false, isAdmin: false };
}

function persistAuth(token: string, userId: string, role: string): void {
  localStorage.removeItem(LOGGED_OUT_KEY);
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, userId);
  localStorage.setItem(ROLE_KEY, role);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(loadAuth);
  const [authReady, setAuthReady] = useState(true);

  useEffect(() => {
    const handler = () => setAuth(loadAuth());
    window.addEventListener('auth:updated', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('auth:updated', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  // DEV mode or Desktop App: always try dev-login for a fresh token, fall back to stored token
  useEffect(() => {
    if (!import.meta.env.DEV && !isDesktopApp) {
      setAuthReady(true);
      return;
    }
    if (localStorage.getItem(LOGGED_OUT_KEY) === 'true') {
      setAuthReady(true);
      return;
    }
    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 35;
    const RETRY_DELAY = 1000;
    const stored = loadAuth();

    (async function loginLoop() {
      while (!cancelled && retries < MAX_RETRIES) {
        try {
          const resp = await fetch('/api/auth/dev-login', { method: 'POST' });
          if (!resp.ok) throw new Error(`dev-login ${resp.status}`);
          const data = await resp.json();
          if (!data?.token) throw new Error('no token in dev-login response');
          persistAuth(data.token, data.userId, data.role ?? 'admin');
          setAuth({
            user: data.userId,
            token: data.token,
            role: data.role ?? 'admin',
            isLoggedIn: true,
            isAdmin: true,
          });
          window.dispatchEvent(new CustomEvent('auth:updated'));
          if (!cancelled) setAuthReady(true);
          return;
        } catch {
          retries++;
          if (retries < MAX_RETRIES && !cancelled) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY));
          }
        }
      }
      if (!cancelled) {
        if (stored.isLoggedIn) {
          setAuth(stored);
        }
        setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const register = useCallback(async (username: string, password: string) => {
    const resp = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Registration failed' }));
      throw new Error(err.error || `Registration failed (${resp.status})`);
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

  const loginAsDesktopOperator = useCallback(async () => {
    localStorage.removeItem(LOGGED_OUT_KEY);
    // Instant local admin state for smooth UI transition
    const opAuth: AuthState = {
      user: 'desktop-operator',
      token: null,
      role: 'admin',
      isLoggedIn: true,
      isAdmin: true,
    };
    setAuth(opAuth);
    window.dispatchEvent(new CustomEvent('auth:updated'));

    // Attempt to acquire fresh loopback token for authenticated backend services
    try {
      const resp = await fetch('/api/auth/dev-login', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.token) {
          persistAuth(data.token, data.userId || 'desktop-operator', data.role ?? 'admin');
          setAuth({
            user: data.userId || 'desktop-operator',
            token: data.token,
            role: data.role ?? 'admin',
            isLoggedIn: true,
            isAdmin: true,
          });
          window.dispatchEvent(new CustomEvent('auth:updated'));
        }
      }
    } catch {
      // Offline fallback: keep desktop-operator local admin
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.setItem(LOGGED_OUT_KEY, 'true');
    setAuth({ user: null, token: null, role: null, isLoggedIn: false, isAdmin: false });
    window.dispatchEvent(new CustomEvent('auth:updated'));
    window.dispatchEvent(new CustomEvent('auth:required'));
  }, []);

  return (
    <AuthContext.Provider value={{ ...auth, login, register, logout, loginAsDesktopOperator }}>
      {children}
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
