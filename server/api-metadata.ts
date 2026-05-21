/**
 * API Metadata - Configuration for all supported APIs
 * Includes registration links, descriptions, and required credentials
 */

export interface ApiConfig {
  id: string;
  name: string;
  category: string;
  description: string;
  registrationUrl: string;
  docsUrl: string;
  envKey?: string;
  envKeys?: string[]; // For APIs requiring multiple keys
  free: boolean;
  rateLimit: string;
  status: 'public' | 'authenticated' | 'premium';
}

export const API_METADATA: ApiConfig[] = [
  // SATELLITE & IMAGERY
  {
    id: 'cesium_ion',
    name: 'Cesium Ion',
    category: 'Satellite & Imagery',
    description: '3D globe, terrain, and imagery layers',
    registrationUrl: 'https://ion.cesium.com/signup',
    docsUrl: 'https://cesium.com/learn/',
    envKey: 'CESIUM_ION_ACCESS_TOKEN',
    free: true,
    rateLimit: 'Unlimited (free tier)',
    status: 'authenticated',
  },
  {
    id: 'sentinel_hub',
    name: 'Sentinel Hub',
    category: 'Satellite & Imagery',
    description: 'ESA Sentinel-2 satellite imagery and analytics',
    registrationUrl: 'https://www.sentinel-hub.com/create_account/',
    docsUrl: 'https://www.sentinel-hub.com/develop/',
    envKeys: ['SENTINEL_HUB_CLIENT_ID', 'SENTINEL_HUB_CLIENT_SECRET'],
    free: true,
    rateLimit: '30 days free trial',
    status: 'authenticated',
  },
  {
    id: 'nasa_firms',
    name: 'NASA FIRMS',
    category: 'Satellite & Imagery',
    description: 'Wildfire detection (MODIS/VIIRS)',
    registrationUrl: 'https://firms.modaps.eosdis.nasa.gov/api/',
    docsUrl: 'https://firms.modaps.eosdis.nasa.gov/mapserver/',
    envKey: 'NASA_FIRMS_MAP_KEY',
    free: true,
    rateLimit: 'Free public API',
    status: 'public',
  },
  {
    id: 'planet',
    name: 'Planet Labs',
    category: 'Satellite & Imagery',
    description: 'High-resolution satellite imagery',
    registrationUrl: 'https://www.planet.com/',
    docsUrl: 'https://developers.planet.com/',
    envKey: 'PLANET_API_KEY',
    free: false,
    rateLimit: 'Usage-based',
    status: 'premium',
  },

  // AVIATION
  {
    id: 'opensky',
    name: 'OpenSky Network',
    category: 'Aviation',
    description: 'Live flight tracking and historical data',
    registrationUrl: 'https://opensky-network.org/community/',
    docsUrl: 'https://opensky-network.org/apidoc/rest.html',
    envKeys: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'],
    free: true,
    rateLimit: '400 req/hr (free), unlimited (premium)',
    status: 'authenticated',
  },

  // MARITIME
  {
    id: 'aisstream',
    name: 'AISStream',
    category: 'Maritime',
    description: 'Real-time vessel tracking via AIS',
    registrationUrl: 'https://aisstream.io/',
    docsUrl: 'https://aisstream.io/documentation',
    envKey: 'AIS_STREAM_API_KEY',
    free: true,
    rateLimit: 'Free trial, then paid',
    status: 'authenticated',
  },
  {
    id: 'marine_traffic',
    name: 'MarineTraffic',
    category: 'Maritime',
    description: 'Alternative vessel tracking service',
    registrationUrl: 'https://www.marinetraffic.com/en/ais-api-services',
    docsUrl: 'https://www.marinetraffic.com/en/ais-api-services',
    envKey: 'MARINE_TRAFFIC_API_KEY',
    free: false,
    rateLimit: 'Paid subscription',
    status: 'premium',
  },

  // WEATHER & DISASTER (mostly public)
  {
    id: 'usgs_earthquakes',
    name: 'USGS Earthquakes',
    category: 'Weather & Disaster',
    description: 'Real-time earthquake data (no auth required)',
    registrationUrl: 'https://earthquake.usgs.gov/fdsnws/event/1/',
    docsUrl: 'https://earthquake.usgs.gov/fdsnws/event/1/',
    envKey: 'N/A',
    free: true,
    rateLimit: 'Free public API',
    status: 'public',
  },
  {
    id: 'nasa_eonet',
    name: 'NASA EONET',
    category: 'Weather & Disaster',
    description: 'Natural events tracking (no auth required)',
    registrationUrl: 'https://eonet.gsfc.nasa.gov/api/v3/',
    docsUrl: 'https://eonet.gsfc.nasa.gov/api/v3/',
    envKey: 'N/A',
    free: true,
    rateLimit: 'Free public API',
    status: 'public',
  },
  {
    id: 'gdacs',
    name: 'GDACS',
    category: 'Weather & Disaster',
    description: 'Global Disaster Alerts (no auth required)',
    registrationUrl: 'https://www.gdacs.org/',
    docsUrl: 'https://www.gdacs.org/xml/rss.xml',
    envKey: 'N/A',
    free: true,
    rateLimit: 'Free public RSS',
    status: 'public',
  },
  {
    id: 'nws_alerts',
    name: 'NWS Alerts',
    category: 'Weather & Disaster',
    description: 'National Weather Service alerts (US only, no auth)',
    registrationUrl: 'https://api.weather.gov/',
    docsUrl: 'https://api.weather.gov/',
    envKey: 'N/A',
    free: true,
    rateLimit: 'Free public API',
    status: 'public',
  },
  {
    id: 'noaa_space',
    name: 'NOAA Space Weather',
    category: 'Weather & Disaster',
    description: 'Solar storms & Kp Index (no auth required)',
    registrationUrl: 'https://services.swpc.noaa.gov/',
    docsUrl: 'https://services.swpc.noaa.gov/products/',
    envKey: 'N/A',
    free: true,
    rateLimit: 'Free public API',
    status: 'public',
  },

  // AI & ANALYTICS
  {
    id: 'google_gemini',
    name: 'Google Gemini',
    category: 'AI & Analytics',
    description: 'AI analysis of events and alerts',
    registrationUrl: 'https://ai.google.dev/',
    docsUrl: 'https://ai.google.dev/tutorials',
    envKey: 'GOOGLE_GEMINI_API_KEY',
    free: true,
    rateLimit: '60 req/min (free)',
    status: 'authenticated',
  },
  {
    id: 'anthropic_claude',
    name: 'Anthropic Claude',
    category: 'AI & Analytics',
    description: 'Alternative AI for event analysis',
    registrationUrl: 'https://console.anthropic.com/',
    docsUrl: 'https://docs.anthropic.com/',
    envKey: 'ANTHROPIC_API_KEY',
    free: false,
    rateLimit: 'Pay-as-you-go',
    status: 'premium',
  },

  // SOCIAL & NEWS
  {
    id: 'twitter_api',
    name: 'Twitter/X API',
    category: 'Social & News',
    description: 'Real-time tweets about disasters',
    registrationUrl: 'https://developer.twitter.com/',
    docsUrl: 'https://developer.twitter.com/en/docs/twitter-api',
    envKeys: ['TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_BEARER_TOKEN'],
    free: true,
    rateLimit: 'v2 Essential (free)',
    status: 'authenticated',
  },
  {
    id: 'newsapi',
    name: 'NewsAPI',
    category: 'Social & News',
    description: 'News aggregation and search',
    registrationUrl: 'https://newsapi.org/',
    docsUrl: 'https://newsapi.org/docs',
    envKey: 'NEWS_API_KEY',
    free: true,
    rateLimit: '100 req/day (free)',
    status: 'authenticated',
  },

  // CAMERAS
  {
    id: 'opencctv',
    name: 'OpenCCTV',
    category: 'Cameras',
    description: 'Public camera network (no auth)',
    registrationUrl: 'https://opencctv.org/',
    docsUrl: 'https://opencctv.org/api',
    envKey: 'N/A',
    free: true,
    rateLimit: 'Free public API',
    status: 'public',
  },
];

export function getApiConfigById(id: string): ApiConfig | undefined {
  return API_METADATA.find((api) => api.id === id);
}

export function getApisByCategory(category: string): ApiConfig[] {
  return API_METADATA.filter((api) => api.category === category);
}

export function getCategories(): string[] {
  return Array.from(new Set(API_METADATA.map((api) => api.category)));
}

export function getConfigured(env: Record<string, string | undefined>): ApiConfig[] {
  return API_METADATA.filter((api) => {
    if (api.envKey && api.envKey !== 'N/A') {
      return !!env[api.envKey]?.trim();
    }
    if (api.envKeys && api.envKeys.length > 0) {
      return api.envKeys.some((key) => !!env[key]?.trim());
    }
    return api.status === 'public';
  });
}
