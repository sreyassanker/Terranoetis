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
  '/adsb-lol': 'https://api.adsb.lol/v2/point/48/10/250',
  '/adsb-fi': 'https://opendata.adsb.fi/api/v3/lat/48/lon/10/dist/250',
  '/openflights': 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat',
  '/volcanoes': 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated',
};

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

function addAuthHeader(init?: RequestInit): RequestInit {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

function handleUnauthorized(resp: Response): void {
  if (resp.status === 401) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.dispatchEvent(new CustomEvent('auth:required'));
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const proxyUrl = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const directUrl = DIRECT_SOURCES[path];

  try {
    const resp = await fetch(proxyUrl, { ...addAuthHeader(init), cache: 'no-store' });
    if (resp.ok) return resp.json() as Promise<T>;
    handleUnauthorized(resp);
    throw new Error(`API ${path} failed (${resp.status})`);
  } catch (proxyErr) {
    if (!directUrl) throw proxyErr;
    // Direct upstream fallback — DO NOT leak the Authorization header to third parties
    const headers = new Headers(init?.headers);
    headers.delete('Authorization');
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

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const resp = await fetch(url, addAuthHeader(init));
  handleUnauthorized(resp);
  return resp;
}

/* ── Sandbox API helpers ── */

export async function sandboxExecute(language: string, code: string, workspaceId?: string, timeout?: number) {
  const resp = await authFetch('/api/sandbox/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language, code, workspaceId, timeout }),
  });
  if (!resp.ok) throw new Error(`Sandbox execute failed (${resp.status})`);
  return resp.json();
}

export async function sandboxBatchExecute(tasks: Array<{ language: string; code: string }>) {
  const resp = await authFetch('/api/sandbox/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tasks }),
  });
  if (!resp.ok) throw new Error(`Sandbox batch failed (${resp.status})`);
  return resp.json();
}

export async function sandboxCreateWorkspace(userId = 'default') {
  const resp = await authFetch('/api/sandbox/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!resp.ok) throw new Error(`Workspace creation failed (${resp.status})`);
  return resp.json();
}

export async function sandboxUploadFile(workspaceId: string, fileName: string, content: string) {
  const resp = await authFetch(`/api/sandbox/workspace/${workspaceId}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, content }),
  });
  if (!resp.ok) throw new Error(`File upload failed (${resp.status})`);
  return resp.json();
}

export async function sandboxListFiles(workspaceId: string) {
  const resp = await authFetch(`/api/sandbox/workspace/${workspaceId}/files`);
  if (!resp.ok) throw new Error(`List files failed (${resp.status})`);
  return resp.json();
}

export async function sandboxReadFile(workspaceId: string, fileName: string) {
  const resp = await authFetch(`/api/sandbox/workspace/${workspaceId}/read?file=${encodeURIComponent(fileName)}`);
  if (!resp.ok) throw new Error(`Read file failed (${resp.status})`);
  return resp.json();
}
