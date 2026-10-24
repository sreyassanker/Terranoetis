import '@/lib/desktop';
import { isDesktopApp } from '@/lib/desktop';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router';
import { Toaster, toast } from 'sonner';
import './index.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';

const RouterComponent = isDesktopApp ? HashRouter : BrowserRouter;

if (import.meta.env.PROD && !isDesktopApp && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Errors raised outside React's own call stack — WebSocket and timer callbacks,
// un-awaited promises — never reach an error boundary, so previously they left
// no recoverable trace at all. Surface real errors without disturbing the live tree.
let lastToastAt = 0;
const TOAST_COOLDOWN_MS = 15000;

function isIgnoredAsyncError(error: unknown): boolean {
  if (!error) return true;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';

  // 1. Aborted fetches (routine cancellations when typing, navigating, or spinning globe)
  if (
    name === 'AbortError' ||
    message.includes('aborted') ||
    message.includes('The user aborted a request') ||
    message.includes('signal is aborted without reason')
  ) {
    return true;
  }

  // 2. Benign ResizeObserver timing loop warnings in WebKit/Chromium
  if (
    message.includes('ResizeObserver loop completed with undelivered notifications') ||
    message.includes('ResizeObserver loop limit exceeded')
  ) {
    return true;
  }

  // 3. Audio autoplay gesture restrictions before first interaction
  if (
    name === 'NotAllowedError' ||
    message.includes('play() failed') ||
    message.includes("user didn't interact with the document first")
  ) {
    return true;
  }

  // 4. Benign cancelled image/tile loads in Cesium
  if (message.includes('Request has been cancelled') || message.includes('cancelled')) {
    return true;
  }

  return false;
}

function reportAsyncError(error: unknown, context: string) {
  // Console every occurrence with the stack; only toast real unexpected failures
  console.error(`[terranoetis] uncaught ${context}`, error);

  if (isIgnoredAsyncError(error)) {
    return;
  }

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
      <RouterComponent>
        <Routes>
          <Route path="/" element={<App />} />
        </Routes>
      </RouterComponent>
    </AuthProvider>
    {/* useChat.ts:517 already fires toasts; nothing mounted a renderer for them. */}
    <Toaster position="bottom-right" theme="dark" richColors closeButton />
  </ErrorBoundary>,
);
