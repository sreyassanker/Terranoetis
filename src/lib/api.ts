const API_BASE = import.meta.env.VITE_API_PROXY ?? '/api';

/** Direct upstream URLs used when the local proxy is down or misconfigured */
const DIRECT_SOURCES: Record<string, string> = {
  '/earthquakes': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  '/earthquakes/significant':
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
  '/tectonic':
    'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json',
  '/eonet': 'https://eonet.gsfc.nasa.gov/api/v3/events?days=30&status=open',
  '/iss': 'https://api.wheretheiss.at/v1/satellites/25544',
  '/satellites/tle': 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json',
  '/flights': 'https://opensky-network.org/api/states/all',
  '/weather/alerts': 'https://api.weather.gov/alerts/active',
  '/space-weather/kp': 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  '/aurora': 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
  '/submarine-cables': 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
};

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const proxyUrl = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const directUrl = DIRECT_SOURCES[path];

  try {
    const resp = await fetch(proxyUrl, { ...init, cache: 'no-store' });
    if (resp.ok) return resp.json() as Promise<T>;
    throw new Error(`API ${path} failed (${resp.status})`);
  } catch (proxyErr) {
    if (!directUrl) throw proxyErr;
    const headers = new Headers(init?.headers);
    if (path === '/weather/alerts' && !headers.has('User-Agent')) {
      headers.set('User-Agent', 'LiveGlobe/1.0 (earth-intelligence)');
    }
    const resp = await fetch(directUrl, { ...init, headers, cache: 'no-store' });
    if (!resp.ok) throw new Error(`Direct ${path} failed (${resp.status})`);
    return resp.json() as Promise<T>;
  }
}

export function apiUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}
