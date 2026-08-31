/**
 * Sentry error tracking.
 *
 * Initializes only when a SENTRY_DSN is present (e.g. in .env) — otherwise a
 * graceful no-op so local/dev runs never emit events or fail to boot.
 *
 * Captures server-side 5xx + unhandled errors only. 4xx client errors are NOT
 * reported (they are the client's fault, not the platform's, and would flood
 * the quota with noise).
 */

import * as Sentry from '@sentry/node';

let enabled = false;

/** Initialize Sentry from the SENTRY_DSN env var. No-op when unset. */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return; // not configured — graceful no-op
  }
  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: `terranoetis@${process.env.npm_package_version || '3.1'}`,
      dataCollection: { httpBodies: [] },
      tracesSampleRate: 0.05,
    });
    enabled = true;
    console.log('[Sentry] error tracking initialized');
  } catch (e) {
    // never let Sentry break the platform — log and continue
    console.warn('[Sentry] init failed (continuing without it):', (e as Error).message);
    enabled = false;
  }
}

/** Report an error to Sentry when it is a real server-side failure (5xx/unhandled). */
export function reportError(
  err: unknown,
  scope?: { correlationId?: string; path?: string; method?: string; user?: string },
): void {
  if (!enabled) return;
  try {
    Sentry.withScope((s) => {
      if (scope?.correlationId) s.setTag('correlation_id', scope.correlationId);
      if (scope?.path) s.setTag('path', scope.path);
      if (scope?.method) s.setTag('method', scope.method);
      if (scope?.user) s.setUser({ id: scope.user });
      Sentry.captureException(err);
    });
  } catch {
    // capturing must never throw into the request path
  }
}

export function isSentryEnabled(): boolean {
  return enabled;
}
