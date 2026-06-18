/**
 * Safe JSON parse helpers. Centralizes error handling so callers can
 * never accidentally throw on malformed input.
 */

export function safeJsonParse<T = unknown>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function tryJsonParse<T = unknown>(text: string | null | undefined): T | null {
  if (text == null || text === '') return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
