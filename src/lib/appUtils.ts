import type { ApiVaultState, AiProvider, LocalSearchResult } from './appTypes';
import { CITY_DATA, CESIUM_ION_ENV_TOKEN, LEGACY_VAULT_KEYS, LEGACY_VAULT_STATE, SESSION_VAULT_KEY, LOCAL_SEARCH_INDEX, normalizeLocationQuery } from './appData';

export const DEFAULT_API_VAULT: ApiVaultState = {
  gemini: '',
  anthropic: '',
  cesiumIonAccessToken: '',
  sentinelHubClientId: '',
  sentinelHubClientSecret: '',
  marineTrafficApiKey: '',
  aisStreamApiKey: '',
  flightAwareAeroApiKey: '',
  airLabsApiKey: '',
  preferredAiProvider: 'gemini',
  vaultDismissed: false,
};

export function extractYoutubeId(url?: string): string | undefined {
  if (!url) return;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v') || undefined;
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || undefined;
  } catch { /* */ }
}

export function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

export function sanitizeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}

export function vaultFromFlatKeys(keys: Record<string, string>): ApiVaultState {
  return {
    ...DEFAULT_API_VAULT,
    gemini: keys.GOOGLE_GEMINI_API_KEY ?? '',
    anthropic: keys.ANTHROPIC_API_KEY ?? '',
    cesiumIonAccessToken: keys.CESIUM_ION_ACCESS_TOKEN ?? CESIUM_ION_ENV_TOKEN,
    sentinelHubClientId: keys.SENTINEL_HUB_CLIENT_ID ?? '',
    sentinelHubClientSecret: keys.SENTINEL_HUB_CLIENT_SECRET ?? '',
    marineTrafficApiKey: keys.MARINE_TRAFFIC_API_KEY ?? '',
    aisStreamApiKey: keys.AIS_STREAM_API_KEY ?? '',
    flightAwareAeroApiKey: keys.FLIGHTAWARE_AEROAPI_KEY ?? '',
    airLabsApiKey: keys.AIRLABS_API_KEY ?? '',
  };
}

export function loadApiVault(): ApiVaultState {
  try {
    const cached = sessionStorage.getItem(SESSION_VAULT_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<ApiVaultState>;
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_API_VAULT, ...parsed, cesiumIonAccessToken: parsed.cesiumIonAccessToken || CESIUM_ION_ENV_TOKEN };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    ...DEFAULT_API_VAULT,
    cesiumIonAccessToken: CESIUM_ION_ENV_TOKEN,
  };
}

export function purgeLegacyVaultStorage(): void {
  try {
    localStorage.removeItem(LEGACY_VAULT_KEYS);
    localStorage.removeItem(LEGACY_VAULT_STATE);
  } catch {
    /* ignore */
  }
}

export function hasAnyApiVaultValue(vault: ApiVaultState): boolean {
  return Boolean(
    vault.gemini.trim() ||
    vault.anthropic.trim() ||
    vault.cesiumIonAccessToken.trim() ||
    vault.sentinelHubClientId.trim() ||
    vault.sentinelHubClientSecret.trim() ||
    vault.marineTrafficApiKey.trim() ||
    vault.aisStreamApiKey.trim() ||
    vault.flightAwareAeroApiKey.trim() ||
    vault.airLabsApiKey.trim()
  );
}

export function resolveAiProvider(vault: ApiVaultState): AiProvider {
  if (vault.preferredAiProvider === 'anthropic' && vault.anthropic.trim()) return 'anthropic';
  if (vault.preferredAiProvider === 'gemini' && vault.gemini.trim()) return 'gemini';
  if (vault.gemini.trim()) return 'gemini';
  if (vault.anthropic.trim()) return 'anthropic';
  return 'local';
}

export function resolveCesiumIonToken(vault: ApiVaultState): string | undefined {
  const token = vault.cesiumIonAccessToken.trim() || CESIUM_ION_ENV_TOKEN;
  return token || undefined;
}

export function parseCoordinateQuery(query: string): LocalSearchResult | null {
  const compact = query.trim().replace(/\s+/g, ' ');
  const pair = compact.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  const split = pair
    ? pair
    : compact.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  if (!split) return null;
  const first = Number(split[1]);
  const second = Number(split[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const lat = Math.abs(first) <= 90 ? first : second;
  const lon = Math.abs(first) <= 90 ? second : first;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon };
}

export function findLocalLocationMatches(query: string, limit = 6): LocalSearchResult[] {
  const normalized = normalizeLocationQuery(query);
  if (!normalized) return [];

  const scoreEntry = (entry: (typeof LOCAL_SEARCH_INDEX)[number]) => {
    let score = 0;
    if (entry.searchText === normalized) score += 100;
    if (entry.searchText.startsWith(normalized)) score += 60;
    if (entry.searchText.includes(normalized)) score += 30;
    for (const part of normalized.split(' ')) {
      if (!part) continue;
      if (entry.searchText.includes(part)) score += 8;
    }
    return score;
  };

  return LOCAL_SEARCH_INDEX
    .map(entry => ({ entry, score: scoreEntry(entry) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map(item => ({ name: item.entry.name, lat: item.entry.lat, lon: item.entry.lon }));
}

export function makeSafeAnimatedRadiusPair(
  baseRadius: () => number,
  majorMultiplier: number = 1.08
) {
  let cachedBucket = -1;
  let cachedRadius = 1;
  const sample = () => {
    const bucket = Math.floor(Date.now() / 33);
      if (bucket !== cachedBucket) {
        cachedBucket = bucket;
        cachedRadius = Math.max(1.0, baseRadius());
      }
      return cachedRadius;
    };
  return {
    minor: () => sample(),
    major: () => sample() * majorMultiplier,
  };
}

export function destinationPoint(lat: number, lon: number, distance: number, bearing: number): { lat: number; lon: number } {
  const R = 6371;
  const d = distance / R;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const brng = bearing * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}

export function calculatePopulationImpact(lat: number, lon: number) {
  const affected = CITY_DATA.filter(c => {
    const dLat = c.lat - lat, dLon = c.lon - lon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    return dist < 5;
  });
  if (affected.length === 0) return null;
  const totalPop = affected.reduce((s, c) => s + c.pop, 0);
  let severity: 'high'|'medium'|'low';
  if (totalPop > 20) severity = 'high';
  else if (totalPop > 5) severity = 'medium';
  else severity = 'low';
  return { cities: affected, totalPop, severity };
}

export function greatCircleDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
