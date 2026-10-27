/**
 * Cross-environment desktop app detection & network routing bootstrap.
 * Works safely across browser, Tauri WKWebView / WebView2, Node.js, and test mocks.
 */

export const isDesktopApp: boolean =
  typeof window !== 'undefined' &&
  Boolean(window.location) &&
  (window.location.hostname === 'tauri.localhost' ||
    (window.location.hostname === 'localhost' && window.location.port === '') ||
    window.location.protocol === 'tauri:' ||
    window.location.protocol === 'file:' ||
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
    Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__));

const apiEnv = typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_API_URL as string | undefined) : undefined;
export const DESKTOP_API_SERVER: string = (apiEnv ? apiEnv.replace(/\/+$/, '') : '') || 'http://127.0.0.1:3001';

const wsEnv = typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_WS_URL as string | undefined) : undefined;
export const DESKTOP_WS_SERVER: string = (wsEnv ? wsEnv.replace(/\/+$/, '') : '') || 'ws://127.0.0.1:3001';

let desktopFetchPatchInstalled = false;
let desktopXhrPatchInstalled = false;
let nativeFetch: typeof window.fetch | null = null;

const TOKEN_KEY = 'auth_token';

function shouldAttachAuth(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  try {
    const url = new URL(rawUrl, window.location.origin);
    const isApiPath = url.pathname.startsWith('/api/') || url.pathname === '/api';
    return (
      isApiPath &&
      (url.origin === window.location.origin ||
        url.hostname === '127.0.0.1' ||
        url.hostname === 'localhost' ||
        url.hostname.includes('tauri'))
    );
  } catch {
    return rawUrl.startsWith('/api/') || rawUrl === '/api';
  }
}

/**
 * Resolves any API path or relative endpoint to the proper host.
 * Inside Tauri desktop, rewrites relative /api URLs to 127.0.0.1:3001.
 */
export function resolveApiUrl(pathOrUrl: string): string {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return pathOrUrl || '';
  if (isDesktopApp) {
    if (
      pathOrUrl.startsWith('/api') ||
      pathOrUrl.startsWith('http://tauri.localhost/api') ||
      pathOrUrl.startsWith('https://tauri.localhost/api') ||
      pathOrUrl.startsWith('tauri://localhost/api') ||
      pathOrUrl.startsWith('http://localhost/api')
    ) {
      const cleanPath = pathOrUrl.replace(
        /^(https?:\/\/tauri\.localhost|tauri:\/\/localhost|https?:\/\/localhost)/,
        ''
      );
      return `${DESKTOP_API_SERVER}${cleanPath}`;
    }
  }
  return pathOrUrl;
}

/**
 * Early-install the desktop fetch patch so relative /api calls are seamlessly
 * redirected to the backend server (127.0.0.1:3001) with Authorization header attached.
 */
export function installDesktopFetchPatch(): void {
  if (desktopFetchPatchInstalled || typeof window === 'undefined') return;
  nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let reqInput = input;
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

    if (isDesktopApp) {
      let rawUrl = '';
      if (typeof reqInput === 'string') rawUrl = reqInput;
      else if (reqInput instanceof URL) rawUrl = reqInput.href;
      else if (reqInput instanceof Request) rawUrl = reqInput.url;

      const targetUrl = resolveApiUrl(rawUrl);
      if (targetUrl !== rawUrl) {
        if (reqInput instanceof Request) {
          reqInput = new Request(targetUrl, reqInput);
        } else {
          reqInput = targetUrl;
        }
      }
    }

    if (!token || !shouldAttachAuth(reqInput)) {
      return nativeFetch!(reqInput, init);
    }

    const headers = new Headers(init?.headers || (reqInput instanceof Request ? reqInput.headers : undefined));
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return nativeFetch!(reqInput, { ...init, headers });
  };

  desktopFetchPatchInstalled = true;
}

/**
 * Patch XMLHttpRequest.open so libraries using XHR (e.g. Hls.js, Axios, Cesium imagery)
 * seamlessly route relative /api requests to 127.0.0.1:3001 inside desktop Tauri webview.
 */
export function installDesktopXhrPatch(): void {
  if (desktopXhrPatchInstalled || typeof window === 'undefined' || !window.XMLHttpRequest) return;
  const originalOpen = window.XMLHttpRequest.prototype.open;

  window.XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    const rawUrl = typeof url === 'string' ? url : url.toString();
    const resolvedUrl = resolveApiUrl(rawUrl);
    return (originalOpen as any).call(this, method, resolvedUrl, ...rest);
  };

  desktopXhrPatchInstalled = true;
}

/**
 * Install global keyboard shortcuts for reload across desktop and webview:
 * - Cmd+R / Ctrl+R / F5: soft reload
 * - Cmd+Shift+R / Ctrl+Shift+R: hard reload (clears caches before reloading)
 */
export function installDesktopShortcuts(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    const isReloadKey =
      (event.key === 'r' || event.key === 'R') && (event.metaKey || event.ctrlKey);
    const isF5 = event.key === 'F5';

    if (isReloadKey || isF5) {
      event.preventDefault();
      if (event.shiftKey && typeof caches !== 'undefined') {
        caches
          .keys()
          .then((names) => Promise.all(names.map((name) => caches.delete(name))))
          .catch(() => {})
          .finally(() => {
            window.location.reload();
          });
      } else {
        window.location.reload();
      }
    }
  });
}

/**
 * Safely opens an external URL in the user's default system browser (Safari/Chrome/etc.)
 * when running inside Tauri, and falls back to window.open in standard browsers.
 */
export function openInBrowser(url: string): void {
  if (!url) return;
  const tauriInternals = typeof window !== 'undefined'
    ? (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__
    : undefined;

  if (isDesktopApp && tauriInternals?.invoke) {
    tauriInternals.invoke('open_external_url', { url }).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Intercepts external <a target="_blank"> clicks in the desktop app to route them
 * cleanly to the default system browser instead of failing or getting trapped in the webview.
 */
export function installExternalLinkHandler(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener(
    'click',
    (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.href || anchor.getAttribute('href');
      const target = anchor.target || anchor.getAttribute('target');
      if (
        isDesktopApp &&
        target === '_blank' &&
        href &&
        (href.startsWith('http://') || href.startsWith('https://'))
      ) {
        event.preventDefault();
        event.stopPropagation();
        openInBrowser(href);
      }
    },
    true
  );
}

// Local YouTube embed bridge state
let cachedEmbedPort = 18290;

export async function resolveEmbedPort(): Promise<number> {
  if (typeof window === 'undefined') return 18290;
  const tauriInternals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<number> } }).__TAURI_INTERNALS__;
  if (tauriInternals?.invoke) {
    try {
      const port = await tauriInternals.invoke('get_embed_port');
      if (typeof port === 'number' && port > 0) {
        cachedEmbedPort = port;
        return port;
      }
    } catch {
      // Fallback to default port
    }
  }
  return cachedEmbedPort;
}

/**
 * Returns a reliable YouTube embed URL.
 * Inside the desktop app, routes through the native Rust loopback server (127.0.0.1:18290)
 * which supplies a legitimate HTTP Referer, preventing YouTube Error 153 in WebKit.
 */
export function getYoutubeEmbedUrl(videoId: string): string {
  const cleanId = encodeURIComponent((videoId || '').trim());
  if (!cleanId) return '';
  if (isDesktopApp) {
    return `http://127.0.0.1:${cachedEmbedPort}/youtube-embed?v=${cleanId}`;
  }
  return `https://www.youtube.com/embed/${cleanId}?autoplay=1&playsinline=1`;
}

// Auto-install early upon module import in browser/webview environments
if (typeof window !== 'undefined') {
  installDesktopFetchPatch();
  installDesktopXhrPatch();
  installDesktopShortcuts();
  installExternalLinkHandler();
  void resolveEmbedPort();
  // Ensure Cesium base URL is set before any Cesium code initializes
  // @ts-expect-error global Cesium config
  window.CESIUM_BASE_URL = window.CESIUM_BASE_URL || `${import.meta.env?.BASE_URL || './'}cesium/`;
}

