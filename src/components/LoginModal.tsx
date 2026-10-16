import { useState, useEffect, useCallback } from 'react';
import { useAuth, isDesktopApp } from '../context/AuthContext';
import { Lock, Mail, AlertCircle, X, Eye, EyeOff, Loader, Zap, CheckCircle2, Globe } from 'lucide-react';

export default function LoginModal() {
  const { isLoggedIn, login, register, loginAsDesktopOperator } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [opLoading, setOpLoading] = useState(false);

  // If already logged in, do not show the modal
  const isOpen = !isLoggedIn && !dismissed;

  useEffect(() => {
    const handleAuthRequired = () => {
      setDismissed(false);
      setError('');
    };
    window.addEventListener('auth:required', handleAuthRequired);
    return () => window.removeEventListener('auth:required', handleAuthRequired);
  }, []);

  const handleOperatorLogin = useCallback(async () => {
    setError('');
    setOpLoading(true);
    try {
      await loginAsDesktopOperator();
      setDismissed(false);
    } catch (err) {
      setError((err as Error).message || 'Operator login failed');
    } finally {
      setOpLoading(false);
    }
  }, [loginAsDesktopOperator]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('Username is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }

    if (mode === 'register') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        await register(username.trim(), password);
      } else {
        await login(username.trim(), password);
      }
      setDismissed(false);
    } catch (err) {
      setError((err as Error).message || `${mode === 'register' ? 'Registration' : 'Login'} failed`);
    } finally {
      setLoading(false);
    }
  }, [username, password, confirmPassword, mode, login, register]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setError('');
  }, []);

  // Keyboard navigation: Escape dismisses modal
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleDismiss]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.25s ease-out',
      }}
    >
      {/* ── Deep Executive Dark Background ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse 80% 65% at 50% 40%, #0d1527 0%, #070c18 55%, #02050c 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Luminous Ambient Backlight Glow */}
      <div
        style={{
          position: 'absolute',
          width: '640px',
          height: '640px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(14, 165, 233, 0.14) 0%, rgba(59, 130, 246, 0.05) 50%, transparent 75%)',
          filter: 'blur(45px)',
          pointerEvents: 'none',
        }}
      />

      {/* Precision Architectural Dot Matrix Grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 85%)',
          pointerEvents: 'none',
        }}
      />

      {/* Top Bar Floating Quick Controls */}
      <div
        style={{
          position: 'absolute',
          top: 18,
          right: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          zIndex: 10001,
        }}
      >
        <button
          onClick={handleDismiss}
          title="Explore live 3D globe as guest"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 9999,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(12px)',
            color: '#e2e8f0',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)';
            e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.5)';
            e.currentTarget.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(15, 23, 42, 0.75)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
            e.currentTarget.style.color = '#e2e8f0';
          }}
        >
          <Globe size={13} color="#38bdf8" />
          <span>Explore 3D Globe</span>
        </button>
      </div>

      {/* ── Frosted Glass Modal Card ── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        style={{
          width: '100%',
          maxWidth: '390px',
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%)',
          backdropFilter: 'blur(32px) saturate(190%)',
          WebkitBackdropFilter: 'blur(32px) saturate(190%)',
          border: '1.5px solid rgba(255, 255, 255, 0.18)',
          borderRadius: 28,
          padding: '36px 32px 30px',
          boxShadow: '0 25px 65px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 0 40px rgba(56, 189, 248, 0.08)',
          position: 'relative',
          color: '#ffffff',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
          zIndex: 10002,
        }}
      >
        {/* Card Close Button */}
        <button
          onClick={handleDismiss}
          title="Dismiss (Esc)"
          aria-label="Dismiss login dialog"
          style={{
            position: 'absolute',
            top: 18,
            right: 18,
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'rgba(255, 255, 255, 0.75)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
            e.currentTarget.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.75)';
          }}
        >
          <X size={14} />
        </button>

        {/* ── Perfectly Centered Brand Header ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            marginBottom: 22,
          }}
        >
          {/* Official App Icon */}
          <img
            src="/icon-512.png"
            alt="Terranoetis Logo"
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.2)',
              objectFit: 'cover',
              marginBottom: 12,
            }}
          />

          {/* Title */}
          <h2
            id="login-title"
            style={{
              margin: '0 0 4px',
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#ffffff',
              textAlign: 'center',
            }}
          >
            {mode === 'login' ? 'Login' : 'Create Account'}
          </h2>

          {/* Subtitle - Exactly Centered */}
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'rgba(255, 255, 255, 0.75)',
              fontWeight: 400,
              textAlign: 'center',
              letterSpacing: '0.01em',
            }}
          >
            Terranoetis Geospatial Platform
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Username / Email Pill Input */}
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={mode === 'login' ? 'Username or Email' : 'Choose a Username'}
              autoComplete="username"
              autoFocus
              style={{
                width: '100%',
                padding: '13px 44px 13px 20px',
                borderRadius: 9999,
                border: '1.5px solid rgba(255, 255, 255, 0.25)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'all 0.15s ease',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.75)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
                e.currentTarget.style.boxShadow = '0 0 16px rgba(255, 255, 255, 0.15)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
            <div
              style={{
                position: 'absolute',
                right: 18,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'rgba(255, 255, 255, 0.75)',
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Mail size={17} />
            </div>
          </div>

          {/* Password Pill Input */}
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? 'Password' : 'Password (min 8 characters)'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              style={{
                width: '100%',
                padding: '13px 44px 13px 20px',
                borderRadius: 9999,
                border: '1.5px solid rgba(255, 255, 255, 0.25)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'all 0.15s ease',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.75)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
                e.currentTarget.style.boxShadow = '0 0 16px rgba(255, 255, 255, 0.15)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((p) => !p)}
              style={{
                position: 'absolute',
                right: 15,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.75)',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
              }}
              tabIndex={-1}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={17} /> : <Lock size={17} />}
            </button>
          </div>

          {/* Confirm Password Pill Input (for Register mode) */}
          {mode === 'register' && (
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm Password"
                autoComplete="new-password"
                style={{
                  width: '100%',
                  padding: '13px 44px 13px 20px',
                  borderRadius: 9999,
                  border: '1.5px solid rgba(255, 255, 255, 0.25)',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#ffffff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'all 0.15s ease',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.75)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
                  e.currentTarget.style.boxShadow = '0 0 16px rgba(255, 255, 255, 0.15)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((p) => !p)}
                style={{
                  position: 'absolute',
                  right: 15,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.75)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                }}
                tabIndex={-1}
                title={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? <EyeOff size={17} /> : <CheckCircle2 size={17} />}
              </button>
            </div>
          )}

          {/* Auxiliary Options: Remember Me & Guest mode (in Login mode) */}
          {mode === 'login' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'rgba(255, 255, 255, 0.85)',
                padding: '2px 6px',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{
                    accentColor: '#ffffff',
                    cursor: 'pointer',
                  }}
                />
                <span>Remember me</span>
              </label>

              <span
                onClick={handleDismiss}
                style={{
                  cursor: 'pointer',
                  opacity: 0.85,
                  transition: 'opacity 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.textDecoration = 'underline';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '0.85';
                  e.currentTarget.style.textDecoration = 'none';
                }}
              >
                Guest mode
              </span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 9999,
                background: 'rgba(239, 68, 68, 0.25)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                color: '#fecaca',
                fontSize: 12,
              }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Primary Solid White Pill Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              padding: '13px 20px',
              borderRadius: 9999,
              border: 'none',
              background: loading ? 'rgba(255, 255, 255, 0.7)' : '#ffffff',
              color: '#0f172a',
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background = '#f8fafc';
                e.currentTarget.style.transform = 'scale(1.01)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(255, 255, 255, 0.35)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.background = '#ffffff';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
              }
            }}
          >
            {loading ? (
              <>
                <Loader size={16} className="animate-spin" color="#0f172a" />
                <span>{mode === 'login' ? 'Logging in...' : 'Creating Account...'}</span>
              </>
            ) : (
              <span>{mode === 'login' ? 'Login' : 'Create Account'}</span>
            )}
          </button>

          {/* 1-Click Desktop Operator Frosted Pill Button (in Login mode) */}
          {mode === 'login' && (isDesktopApp || import.meta.env.DEV) && (
            <button
              type="button"
              onClick={handleOperatorLogin}
              disabled={opLoading}
              style={{
                padding: '11px 20px',
                borderRadius: 9999,
                border: '1.5px solid rgba(255, 255, 255, 0.25)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: opLoading ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!opLoading) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
                  e.currentTarget.style.transform = 'scale(1.01)';
                  e.currentTarget.style.boxShadow = '0 0 16px rgba(255, 255, 255, 0.15)';
                }
              }}
              onMouseLeave={(e) => {
                if (!opLoading) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = 'none';
                }
              }}
            >
              {opLoading ? (
                <>
                  <Loader size={15} className="animate-spin" />
                  <span>Entering Operator Session...</span>
                </>
              ) : (
                <>
                  <Zap size={14} fill="currentColor" />
                  <span>Continue as Desktop Operator</span>
                </>
              )}
            </button>
          )}
        </form>

        {/* ── Create Account / Login Switcher Row ── */}
        <div
          style={{
            marginTop: 20,
            fontSize: 13,
            color: 'rgba(255, 255, 255, 0.85)',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {mode === 'login' ? (
            <>
              <span>Don&apos;t have an account?</span>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                Register
              </button>
            </>
          ) : (
            <>
              <span>Already have an account?</span>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                Login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
