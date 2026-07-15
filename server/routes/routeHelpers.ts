import NodeCache from 'node-cache';

export const cache = new NodeCache({ stdTTL: 60, checkperiod: 120, maxKeys: 100 });

export async function cachedFetch<T>(key: string, url: string, ttl = 60, init?: RequestInit): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit) return hit;
  const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`${key} upstream ${resp.status}`);
  const data = (await resp.json()) as T;
  cache.set(key, data, ttl);
  return data;
}

export async function cachedFetchGroup<T>(key: string, fetcher: () => Promise<T>, ttl = 600): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit) return hit;
  const data = await fetcher();
  cache.set(key, data, ttl);
  return data;
}

export function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
