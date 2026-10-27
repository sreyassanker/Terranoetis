import { logger } from '../observability/logger';
import { keyManager } from '../keyManager';

/** How a camera feed is meant to be rendered by the client. */
export type CctvFeedType = 'youtube' | 'm3u8' | 'mjpeg' | 'video' | 'image' | 'iframe' | 'unknown';

export type CctvSubcategory =
  | 'volcano'
  | 'space'
  | 'maritime'
  | 'wildlife'
  | 'cityscape'
  | 'nature'
  | 'traffic'
  | 'weather';

export const CCTV_SUBCATEGORIES: readonly CctvSubcategory[] = [
  'volcano',
  'space',
  'maritime',
  'wildlife',
  'cityscape',
  'nature',
  'traffic',
  'weather',
];

export interface WorldwideCctvCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pageUrl: string;
  previewUrl?: string;
  streamUrl?: string;
  thumbnailUrl?: string;
  source: string;
  category?: string;
  subcategory?: CctvSubcategory;
  city?: string;
  region?: string;
  country?: string;
  location?: string;
  updatedAt: number;
  description?: string;
  feedType?: CctvFeedType;
  youtubeVideoId?: string;
  /** Embeddable iframe URL for providers that expose a player page (e.g. Windy). */
  playerEmbedUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Curated 24/7 Global Live Streams Catalog
//
// These are hand-picked, long-running public YouTube live streams. Availability
// is controlled by the broadcaster, so entries can go offline without notice.
// ─────────────────────────────────────────────────────────────────────────────

export interface CuratedStreamDef {
  id: string; // YouTube Video ID
  name: string;
  lat: number;
  lon: number;
  city: string;
  country: string;
  region: string;
  subcategory: Exclude<CctvSubcategory, 'traffic' | 'weather'>;
  description?: string;
}

export const CURATED_LIVE_STREAMS: CuratedStreamDef[] = [
  // ── Landmarks: Americas ──
  {
    id: '1EiC9bvVGnk',
    name: 'Jackson Hole — Town Square Live Cam',
    lat: 43.4799,
    lon: -110.7624,
    city: 'Jackson Hole',
    country: 'US',
    region: 'Wyoming',
    subcategory: 'cityscape',
    description: 'Town Square, elk-antler arches and the Teton mountain backdrop.',
  },

  // ── Space & Orbital Observations ──
  {
    id: 'awQzjn72bI0',
    name: 'ISS Space Station Live HD Earth Observation (NASA JSC)',
    lat: 29.5593,
    lon: -95.0900,
    city: 'Houston',
    country: 'US',
    region: 'Texas',
    subcategory: 'space',
    description: 'High-definition live Earth views downlinked from the International Space Station via NASA Johnson Space Center Mission Control.',
  },
  {
    id: 'DDU-rZs-Ic4',
    name: 'NASA Official Live Space Broadcast',
    lat: 28.5729,
    lon: -80.6490,
    city: 'Cape Canaveral',
    country: 'US',
    region: 'Florida',
    subcategory: 'space',
    description: 'Official NASA continuous stream featuring live rocket launches, astronaut spacewalks, and planetary missions.',
  },
  {
    id: '21X5lGlDOfg',
    name: 'NASA Kennedy Space Center — Launch Complex 39A Live',
    lat: 28.6083,
    lon: -80.6043,
    city: 'Cape Canaveral',
    country: 'US',
    region: 'Florida',
    subcategory: 'space',
    description: 'Live broadcast of historic Launch Complex 39A at NASA Kennedy Space Center.',
  },
  {
    id: 'mhJRzQsLZGg',
    name: 'Starbase Boca Chica — Starship Orbital Launch Site Live 4K',
    lat: 25.9972,
    lon: -97.1561,
    city: 'Boca Chica',
    country: 'US',
    region: 'Texas',
    subcategory: 'space',
    description: 'Real-time 24/7 telescope tracking of the Starship orbital launch pad in South Texas.',
  },

  // ── Maritime, Coastlines & Waterfalls ──
  {
    id: 'r8N6IsoIkTk',
    name: 'Venice — Grand Canal & Rialto Bridge 4K Live',
    lat: 45.4371,
    lon: 12.3326,
    city: 'Venice',
    country: 'IT',
    region: 'Veneto',
    subcategory: 'maritime',
    description: 'Historic gondolas, water taxis and maritime traffic along the Grand Canal.',
  },
  {
    id: 'BSWhGNXxT9A',
    name: 'San Francisco — Golden Gate Bridge & Bay Maritime Cam',
    lat: 37.8199,
    lon: -122.4783,
    city: 'San Francisco',
    country: 'US',
    region: 'California',
    subcategory: 'maritime',
    description: 'Maritime entrance to San Francisco Bay showing container ships passing beneath the Golden Gate.',
  },
  {
    id: 'v97JpT3ZA0w',
    name: 'Santa Monica Pier & Pacific Ocean Live Cam',
    lat: 34.0195,
    lon: -118.4912,
    city: 'Santa Monica',
    country: 'US',
    region: 'California',
    subcategory: 'maritime',
    description: 'Pacific coastline overview of Santa Monica Pier and beach.',
  },
  {
    id: '7gBzLGlJnwk',
    name: 'Niagara Falls — Horseshoe Falls 4K Ultra HD Live',
    lat: 43.0896,
    lon: -79.0849,
    city: 'Niagara Falls',
    country: 'CA',
    region: 'Ontario',
    subcategory: 'nature',
    description: 'Continuous panoramic view of the massive Canadian Horseshoe Falls.',
  },

  // ── Wildlife & Polar Wilderness ──
  {
    id: 'ydYDqZQpim8',
    name: 'Namibia — Namib Desert Wildlife Waterhole 24/7 Live',
    lat: -24.0000,
    lon: 16.0000,
    city: 'Namib Desert',
    country: 'NA',
    region: 'Hardap',
    subcategory: 'wildlife',
    description: 'Wild oryx, springbok, giraffes, zebras, and jackals gathering at a remote desert waterhole.',
  },
  {
    id: 'jOqASqt3vVI',
    name: 'Cape Town — Table Mountain & Atlantic Seaboard Live',
    lat: -33.9249,
    lon: 18.4241,
    city: 'Cape Town',
    country: 'ZA',
    region: 'Western Cape',
    subcategory: 'nature',
    description: 'Iconic flat-topped Table Mountain plateau overlooking the Atlantic Ocean.',
  },

  // ── World Metropolises & Global Hubs ──
  {
    id: 'VGnFLdQW39A',
    name: 'New York City — Times Square 24/7 Live 4K Cam',
    lat: 40.7580,
    lon: -73.9855,
    city: 'New York',
    country: 'US',
    region: 'New York',
    subcategory: 'cityscape',
    description: 'Broadway & 7th Avenue intersection, iconic digital billboards and pedestrian flow.',
  },
  {
    id: 'dfVK7ld38Ys',
    name: 'Tokyo — Shibuya Scramble Crossing 24/7 Cam',
    lat: 35.6595,
    lon: 139.7005,
    city: 'Tokyo',
    country: 'JP',
    region: 'Kanto',
    subcategory: 'cityscape',
    description: 'World-famous multi-directional pedestrian crossing outside Shibuya Station.',
  },
  {
    id: 'eJ7ZkQ5TC08',
    name: 'Tokyo — Shinjuku High-Rise District 4K Live',
    lat: 35.6938,
    lon: 139.7034,
    city: 'Tokyo',
    country: 'JP',
    region: 'Kanto',
    subcategory: 'cityscape',
    description: 'Bustling Shinjuku urban center and skyline panorama.',
  },
  {
    id: 'zMCea32gpmg',
    name: 'London — Abbey Road Crossing Live Cam',
    lat: 51.5320,
    lon: -0.1774,
    city: 'London',
    country: 'GB',
    region: 'England',
    subcategory: 'cityscape',
    description: 'Historic pedestrian zebra crossing outside Abbey Road recording studios.',
  },
  {
    id: 'QI-PPEW2Bgc',
    name: 'Paris — Eiffel Tower & Champ de Mars Live',
    lat: 48.8584,
    lon: 2.2945,
    city: 'Paris',
    country: 'FR',
    region: 'Île-de-France',
    subcategory: 'cityscape',
    description: 'View of the Eiffel Tower, Seine River cruise boats and Paris skyline.',
  },
  {
    id: 'yVS7l0AsJW0',
    name: 'Chicago — Downtown Skyline & Riverwalk 4K Live',
    lat: 41.8781,
    lon: -87.6298,
    city: 'Chicago',
    country: 'US',
    region: 'Illinois',
    subcategory: 'cityscape',
    description: 'Chicago River bridges and skyscraper architecture in downtown Loop.',
  },
  {
    id: 'cmkAbDUEoyA',
    name: 'Miami Beach — Ocean Drive & Boardwalk Live Cam',
    lat: 25.7907,
    lon: -80.1300,
    city: 'Miami Beach',
    country: 'US',
    region: 'Florida',
    subcategory: 'cityscape',
    description: 'Art Deco district, Atlantic beachfront and coastal palm trees.',
  },
  {
    id: '4CK0CsimBHs',
    name: 'Honolulu — Waikiki Beach & Diamond Head Crater Live',
    lat: 21.2766,
    lon: -157.8284,
    city: 'Honolulu',
    country: 'US',
    region: 'Hawaii',
    subcategory: 'nature',
    description: 'Pacific surf breaks, catamaran sailors, and Diamond Head volcanic tuff cone.',
  },
  {
    id: 'WEl_I5vmuSs',
    name: 'Rio de Janeiro — Copacabana Beach Live Cam',
    lat: -22.9711,
    lon: -43.1822,
    city: 'Rio de Janeiro',
    country: 'BR',
    region: 'Rio de Janeiro',
    subcategory: 'cityscape',
    description: 'Atlantic promenade, Sugarloaf Mountain backdrop, and Copacabana sands.',
  },
  {
    id: 'Gd9d4q6WvUY',
    name: 'Amsterdam — Dam Square 4K Ultra HD Live',
    lat: 52.3702,
    lon: 4.8952,
    city: 'Amsterdam',
    country: 'NL',
    region: 'North Holland',
    subcategory: 'cityscape',
    description: 'Royal Palace of Amsterdam, National Monument, and canal city center.',
  },
  {
    id: '4Xg-wkPazp4',
    name: 'Berlin — Tiergarten & Skyline Live Cam',
    lat: 52.5200,
    lon: 13.4050,
    city: 'Berlin',
    country: 'DE',
    region: 'Berlin',
    subcategory: 'cityscape',
    description: 'Berlin urban forest park and central city landmarks.',
  },
  {
    id: 'Rvn7Z5bwJWE',
    name: 'Madrid — Gran Vía & Puerta del Sol Live 4K',
    lat: 40.4168,
    lon: -3.7038,
    city: 'Madrid',
    country: 'ES',
    region: 'Community of Madrid',
    subcategory: 'cityscape',
    description: 'Historic Spanish architecture, Gran Vía boulevard and street life.',
  },
  {
    id: '03pYP2Nmreo',
    name: 'Rome — Vatican City & St. Peter\'s Square Live',
    lat: 41.8902,
    lon: 12.4922,
    city: 'Rome',
    country: 'IT',
    region: 'Lazio',
    subcategory: 'cityscape',
    description: 'St. Peter\'s Basilica dome, colonnades, and Vatican papal square.',
  },
  {
    id: 'tmlE1ct0cYk',
    name: 'Prague — Old Town & Central Station 4K Live',
    lat: 50.0875,
    lon: 14.4214,
    city: 'Prague',
    country: 'CZ',
    region: 'Prague',
    subcategory: 'cityscape',
    description: 'Historic Old Town district and Prague Central Station.',
  },
  {
    id: '3nyPER2kzqk',
    name: 'Dublin — O\'Connell Bridge & River Liffey Live',
    lat: 53.3498,
    lon: -6.2603,
    city: 'Dublin',
    country: 'IE',
    region: 'Leinster',
    subcategory: 'cityscape',
    description: 'River Liffey waterfront, city bridges, and Dublin quays.',
  },
  {
    id: 'HfgIFGbdGJ0',
    name: 'Dubai — Burj Khalifa & Downtown Marina Skyline',
    lat: 25.1972,
    lon: 55.2744,
    city: 'Dubai',
    country: 'AE',
    region: 'Dubai',
    subcategory: 'cityscape',
    description: 'World\'s tallest skyscraper Burj Khalifa and illuminated city skyscrapers.',
  },
  {
    id: 'UemFRPrl1hk',
    name: 'Bangkok — Sukhumvit Boulevard 4K Live Cam',
    lat: 13.7563,
    lon: 100.5018,
    city: 'Bangkok',
    country: 'TH',
    region: 'Bangkok',
    subcategory: 'cityscape',
    description: 'Elevated BTS Skytrain lines, vibrant street markets, and Bangkok metropolis.',
  },
  {
    id: 'vk5BHoDxXf0',
    name: 'Seoul — Han River & Yeouido Skyline 4K Live',
    lat: 37.5665,
    lon: 126.9780,
    city: 'Seoul',
    country: 'KR',
    region: 'Seoul Capital',
    subcategory: 'cityscape',
    description: 'Bridges across the Han River, N Seoul Tower, and Gangnam district.',
  },
  {
    id: 'z_fY1pj1VBw',
    name: 'Taipei — Taipei 101 & Elephant Mountain 4K Live',
    lat: 25.0330,
    lon: 121.5654,
    city: 'Taipei',
    country: 'TW',
    region: 'Taipei',
    subcategory: 'cityscape',
    description: 'Iconic bamboo-styled Taipei 101 tower rising above the Taipei basin.',
  },
  {
    id: '5uZa3-RMFos',
    name: 'Sydney — Sydney Harbour & Opera House 4K Live',
    lat: -33.8568,
    lon: 151.2153,
    city: 'Sydney',
    country: 'AU',
    region: 'New South Wales',
    subcategory: 'cityscape',
    description: 'Harbour Bridge, Sydney Opera House sail architecture, and ferry routes.',
  },
];

export function getCuratedLiveCams(): WorldwideCctvCamera[] {
  return CURATED_LIVE_STREAMS.map(item => ({
    id: `yt_live_${item.id}`,
    name: item.name,
    lat: item.lat,
    lon: item.lon,
    pageUrl: `https://www.youtube.com/watch?v=${item.id}`,
    previewUrl: `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`,
    streamUrl: `https://www.youtube.com/watch?v=${item.id}`,
    thumbnailUrl: `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`,
    source: 'youtube',
    category: `${item.subcategory} webcam`,
    subcategory: item.subcategory,
    city: item.city,
    region: item.region,
    country: item.country,
    location: `${item.city}, ${item.country}`,
    updatedAt: Date.now(),
    description: item.description || `24/7 live YouTube stream: ${item.name}`,
    feedType: 'youtube',
    youtubeVideoId: item.id,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Windy Webcams API v3 Integration
// ─────────────────────────────────────────────────────────────────────────────

interface WindyApiResponse {
  webcams?: Array<{
    webcamId: number | string;
    title: string;
    status: string;
    location: {
      city?: string;
      region?: string;
      country?: string;
      latitude: number;
      longitude: number;
    };
    images?: {
      current?: {
        icon?: string;
        thumbnail?: string;
        preview?: string;
      };
    };
    player?: {
      live?: string;
      day?: string;
      month?: string;
      year?: string;
    };
    urls?: {
      detail?: string;
      edit?: string;
    };
    categories?: Array<{
      id: string;
      name: string;
    }>;
  }>;
  total?: number;
}

/**
 * Windy image and player URLs are tokenised and expire after roughly 15
 * minutes, so cache comfortably inside that window.
 */
const WINDY_CACHE_TTL_MS = 10 * 60 * 1000;
const WINDY_CACHE_MAX_ENTRIES = 32;

interface WindyCacheEntry {
  data: WorldwideCctvCamera[];
  expiresAt: number;
  total: number;
}

const windyCache = new Map<string, WindyCacheEntry>();

export interface WindyFetchOptions {
  bbox?: { south: number; west: number; north: number; east: number };
  category?: string;
  limit?: number;
  /**
   * Explicit API key override. Primarily for tests: pass `''` to exercise the
   * unconfigured path without depending on ambient environment state.
   */
  apiKey?: string;
}

export interface WindyFetchResult {
  cameras: WorldwideCctvCamera[];
  total: number;
  source: 'windy.com';
  configured: boolean;
  error?: string;
}

/** Clear the in-memory Windy cache (used by tests and on key rotation). */
export function clearWindyCache(): void {
  windyCache.clear();
}

function resolveWindyApiKey(override?: string): string {
  if (override !== undefined) return override.trim();
  return (keyManager.get('WINDY_API_KEY') ?? process.env.WINDY_API_KEY ?? '').trim();
}

function windySubcategory(categoryName: string): CctvSubcategory {
  const name = categoryName.toLowerCase();
  if (name.includes('traffic') || name.includes('road')) return 'traffic';
  if (name.includes('beach') || name.includes('port') || name.includes('water') || name.includes('sea')) return 'maritime';
  if (name.includes('city')) return 'cityscape';
  if (name.includes('mountain') || name.includes('landscape') || name.includes('nature')) return 'nature';
  if (name.includes('volcano') || name.includes('volcanic')) return 'volcano';
  return 'weather';
}

/** Only allow https Windy URLs into client-rendered iframes and anchors. */
function safeWindyUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return undefined;
    if (host !== 'windy.com' && !host.endsWith('.windy.com')) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function fetchWindyWebcams(options: WindyFetchOptions = {}): Promise<WindyFetchResult> {
  const apiKey = resolveWindyApiKey(options.apiKey);

  if (!apiKey) {
    return {
      cameras: [],
      total: 0,
      source: 'windy.com',
      configured: false,
      error: 'WINDY_API_KEY is not set. Add your free key in Settings or .env to unlock 70,000+ live webcams.',
    };
  }

  // Windy v3 API rejects requests with limit > 50 with HTTP 400
  const limit = Math.min(Math.max(options.limit || 50, 1), 50);
  const cacheKey = JSON.stringify({ bbox: options.bbox, category: options.category, limit });
  const cached = windyCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    // Refresh the LRU position so frequently requested slices survive eviction.
    windyCache.delete(cacheKey);
    windyCache.set(cacheKey, cached);
    return {
      cameras: cached.data,
      total: cached.total,
      source: 'windy.com',
      configured: true,
    };
  }
  if (cached) windyCache.delete(cacheKey);

  try {
    const params = new URLSearchParams({
      limit: String(limit),
      include: 'player,urls,images,location,categories',
    });

    if (options.bbox) {
      // Windy v3 expects bbox formatted as south,west,north,east.
      params.set('bbox', `${options.bbox.south},${options.bbox.west},${options.bbox.north},${options.bbox.east}`);
    }

    if (options.category) {
      params.set('categories', options.category);
    }

    const url = `https://api.windy.com/webcams/api/v3/webcams?${params.toString()}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'x-windy-api-key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'Terranoetis/3.0 (Earth Intelligence Desktop)',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status, statusText: resp.statusText }, 'Windy webcams API request failed');
      return {
        cameras: [],
        total: 0,
        source: 'windy.com',
        configured: true,
        error: `Windy API responded with HTTP ${resp.status}${resp.statusText ? ` (${resp.statusText})` : ''}`,
      };
    }

    const body = await resp.json().catch(() => null) as WindyApiResponse | null;
    const items = Array.isArray(body?.webcams) ? body.webcams : [];

    const cameras: WorldwideCctvCamera[] = items.flatMap((w): WorldwideCctvCamera[] => {
      const lat = w.location?.latitude;
      const lon = w.location?.longitude;
      if (typeof lat !== 'number' || !Number.isFinite(lat)) return [];
      if (typeof lon !== 'number' || !Number.isFinite(lon)) return [];
      if (w.status && /inactive|disabled|offline/i.test(w.status)) return [];

      const name = w.title?.trim() || `Windy Cam ${w.webcamId}`;
      const feedSnapshot = w.images?.current?.preview || w.images?.current?.thumbnail;
      const thumbnail = w.images?.current?.thumbnail || feedSnapshot;
      // `player.live`/`player.day` are embeddable HTML pages, not HLS playlists.
      const embedUrl = safeWindyUrl(w.player?.live) || safeWindyUrl(w.player?.day);
      const detailUrl = safeWindyUrl(w.urls?.detail) || `https://www.windy.com/-Webcams/webcam/${w.webcamId}`;
      const category = w.categories?.[0]?.name?.trim() || 'Weather';

      return [{
        id: `windy_${w.webcamId}`,
        name,
        lat,
        lon,
        pageUrl: detailUrl,
        previewUrl: feedSnapshot,
        thumbnailUrl: thumbnail,
        streamUrl: feedSnapshot,
        playerEmbedUrl: embedUrl,
        source: 'windy.com',
        category,
        subcategory: windySubcategory(category),
        city: w.location?.city,
        region: w.location?.region,
        country: w.location?.country,
        location: [w.location?.city, w.location?.region, w.location?.country].filter(Boolean).join(', ') || 'Global',
        updatedAt: Date.now(),
        description: `Windy live webcam: ${name} (${category})`,
        feedType: embedUrl ? 'iframe' : 'image',
      }];
    });

    if (windyCache.size >= WINDY_CACHE_MAX_ENTRIES) {
      const oldestKey = windyCache.keys().next().value;
      if (oldestKey !== undefined) windyCache.delete(oldestKey);
    }
    windyCache.set(cacheKey, {
      data: cameras,
      expiresAt: Date.now() + WINDY_CACHE_TTL_MS,
      total: body?.total || cameras.length,
    });

    return {
      cameras,
      total: body?.total || cameras.length,
      source: 'windy.com',
      configured: true,
    };
  } catch (err) {
    logger.warn({ err }, 'Error fetching Windy webcams');
    return {
      cameras: [],
      total: 0,
      source: 'windy.com',
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Category Analytics Helper
// ─────────────────────────────────────────────────────────────────────────────

export function getWebcamCategoryStats(cameras: WorldwideCctvCamera[]): Record<string, number> {
  const counts: Record<string, number> = {
    all: cameras.length,
    youtube: 0,
    windy: 0,
    video: 0,
    image: 0,
    iframe: 0,
  };
  for (const sub of CCTV_SUBCATEGORIES) counts[sub] = 0;

  for (const c of cameras) {
    if (c.source === 'youtube' || c.feedType === 'youtube' || c.youtubeVideoId) counts.youtube++;
    if (c.source === 'windy.com') counts.windy++;
    switch (c.feedType) {
      case 'm3u8':
      case 'mjpeg':
        counts.video++;
        break;
      case 'image':
        counts.image++;
        break;
      case 'iframe':
        counts.iframe++;
        break;
      default:
        break;
    }
    if (c.subcategory) counts[c.subcategory]++;
  }

  return counts;
}
