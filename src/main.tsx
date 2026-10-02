import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import { Toaster, toast } from 'sonner';
import './index.css';
import App from './App';
import GlobePage from './pages/v2/GlobePage';
import CanvasPage from './pages/v2/CanvasPage';
import ScenariosPage from './pages/v2/ScenariosPage';
import ToursPage from './pages/v2/ToursPage';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';

// In desktop environments (Tauri webview / custom schemes), route relative `/api` calls
// to the backend server.
const isDesktopApp =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'tauri.localhost' ||
    window.location.protocol === 'file:' ||
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__));

if (isDesktopApp) {
  const originalFetch = window.fetch;
  const API_SERVER =
    (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || 'http://127.0.0.1:3001';
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    if (typeof input === 'string' && input.startsWith('/api')) {
      return originalFetch(`${API_SERVER}${input}`, init);
    }
    if (input instanceof URL && input.pathname.startsWith('/api')) {
      return originalFetch(`${API_SERVER}${input.pathname}${input.search}`, init);
    }
    return originalFetch(input, init);
  };
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Errors raised outside React's own call stack — WebSocket and timer callbacks,
// un-awaited promises — never reach an error boundary, so previously they left
// no recoverable trace at all. Surface them without disturbing the live tree.
let lastToastAt = 0;
const TOAST_COOLDOWN_MS = 15000;

function reportAsyncError(error: unknown, context: string) {
  // Console every occurrence with the stack; only toast the first per cooldown,
  // so a callback that throws every frame cannot bury the user in notifications.
  console.error(`[terranoetis] uncaught ${context}`, error);
  const now = Date.now();
  if (now - lastToastAt < TOAST_COOLDOWN_MS) return;
  lastToastAt = now;
  const message = error instanceof Error ? error.message : String(error);
  toast.error('Background error', { description: message.slice(0, 200), duration: 8000 });
}

window.addEventListener('error', (event) => {
  if (event.error) reportAsyncError(event.error, 'exception');
});

window.addEventListener('unhandledrejection', (event) => {
  reportAsyncError(event.reason, 'promise rejection');
});

// `#root` sits above every route, so without this boundary a throw during
// App's own render unmounts the whole tree — Cesium canvas included.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary label="Application">
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/v2/globe" element={<GlobePage />} />
          <Route path="/v2/canvas" element={<CanvasPage />} />
          <Route path="/v2/scenarios" element={<ScenariosPage />} />
          <Route path="/v2/tours" element={<ToursPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    {/* useChat.ts:517 already fires toasts; nothing mounted a renderer for them. */}
    <Toaster position="bottom-right" theme="dark" richColors closeButton />
  </ErrorBoundary>,
);
