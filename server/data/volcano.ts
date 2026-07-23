import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

export interface VolcanoDataPoint {
  name: string;
  distance: number;
  lastEruptionYear: string;
  lastEruptionDate: string;
  evidenceCategory: string;
  country: string;
  latitude: number;
  longitude: number;
  elevation: number;
  alertLevel: string;
  source: string;
}

interface VolcanoRecord {
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  lastEruptionYear: string;
  evidenceCategory: string;
  country: string;
}

function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let wasQuoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      wasQuoted = true;
    } else if (ch === ',' && !inQuotes) {
      result.push(wasQuoted ? current : current.trim());
      current = '';
      wasQuoted = false;
    } else {
      current += ch;
    }
  }
  result.push(wasQuoted ? current : current.trim());
  return result;
}

function inferAlertLevel(lastEruptionYear: string, evidenceCategory: string): string {
  const currentYear = new Date().getUTCFullYear();
  const year = parseInt(lastEruptionYear, 10);

  if (isNaN(year)) {
    if (evidenceCategory === 'Eruption Observed') return 'normal';
    if (evidenceCategory === 'Unrest / Holocene') return 'advisory';
    return 'normal';
  }

  if (year >= currentYear) return 'warning';
  if (year >= currentYear - 1) return 'watch';
  if (year >= currentYear - 5) return 'advisory';
  if (year >= currentYear - 100) return 'normal';
  return 'normal';
}

function inferRecentActivity(lastEruptionYear: string): boolean {
  const currentYear = new Date().getUTCFullYear();
  const year = parseInt(lastEruptionYear, 10);
  if (isNaN(year)) return false;
  return year >= currentYear - 10;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchVolcanoCatalog(): Promise<VolcanoRecord[]> {
  const cacheKey = 'volcano:catalog';
  const cached = cache.get<VolcanoRecord[]>(cacheKey);
  if (cached) return cached;

  const wfsUrl =
    'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/wfs?' +
    'service=WFS&version=1.1.0&request=GetFeature&' +
    'typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&' +
    'outputFormat=text%2Fcsv';

  const resp = await fetch(wfsUrl, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`GVP WFS returned ${resp.status}`);

  const text = await resp.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('No volcano data in response');

  const header = parseCsvRow(lines[0]);
  const nameIdx = header.indexOf('Volcano_Name');
  const latIdx = header.indexOf('Latitude');
  const lonIdx = header.indexOf('Longitude');
  const elevIdx = header.indexOf('Elevation');
  const eruptionIdx = header.indexOf('Last_Eruption_Year');
  const evidenceIdx = header.indexOf('Evidence_Category');
  const countryIdx = header.indexOf('Country');

  if (nameIdx < 0 || latIdx < 0 || lonIdx < 0) {
    throw new Error('Missing required columns in GVP CSV');
  }

  const volcanoes: VolcanoRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvRow(lines[i]);
    if (row.length <= Math.max(nameIdx, latIdx, lonIdx)) continue;
    const lat = parseFloat(row[latIdx]);
    const lon = parseFloat(row[lonIdx]);
    if (isNaN(lat) || isNaN(lon)) continue;

    volcanoes.push({
      name: row[nameIdx] || 'Unnamed',
      lat,
      lon,
      elevation: elevIdx >= 0 ? parseFloat(row[elevIdx]) || 0 : 0,
      lastEruptionYear: eruptionIdx >= 0 ? (row[eruptionIdx] || '') : '',
      evidenceCategory: evidenceIdx >= 0 ? (row[evidenceIdx] || '') : '',
      country: countryIdx >= 0 ? (row[countryIdx] || '') : '',
    });
  }

  cache.set(cacheKey, volcanoes);
  return volcanoes;
}

export async function fetchVolcano(lat: number, lon: number): Promise<VolcanoDataPoint> {
  const cacheKey = `volcano:${Math.round(lat * 10)}:${Math.round(lon * 10)}`;
  const cached = cache.get<VolcanoDataPoint>(cacheKey);
  if (cached) return cached;

  let catalog: VolcanoRecord[];
  try {
    catalog = await fetchVolcanoCatalog();
  } catch {
    return {
      name: 'unknown',
      distance: 9999,
      lastEruptionYear: '',
      lastEruptionDate: 'unknown',
      evidenceCategory: '',
      country: '',
      latitude: 0,
      longitude: 0,
      elevation: 0,
      alertLevel: 'unknown',
      source: 'error',
    };
  }

  if (catalog.length === 0) {
    return {
      name: 'unknown',
      distance: 9999,
      lastEruptionYear: '',
      lastEruptionDate: 'unknown',
      evidenceCategory: '',
      country: '',
      latitude: 0,
      longitude: 0,
      elevation: 0,
      alertLevel: 'unknown',
      source: 'gvp-empty',
    };
  }

  let best: VolcanoRecord | null = null;
  let bestDist = Infinity;

  for (const v of catalog) {
    const d = haversineKm(lat, lon, v.lat, v.lon);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }

  if (!best) {
    return {
      name: 'unknown',
      distance: 9999,
      lastEruptionYear: '',
      lastEruptionDate: 'unknown',
      evidenceCategory: '',
      country: '',
      latitude: 0,
      longitude: 0,
      elevation: 0,
      alertLevel: 'unknown',
      source: 'gvp-no-match',
    };
  }

  const alertLevel = inferAlertLevel(best.lastEruptionYear, best.evidenceCategory);
  const recentActivity = inferRecentActivity(best.lastEruptionYear);

  const result: VolcanoDataPoint = {
    name: best.name,
    distance: Math.round(bestDist * 10) / 10,
    lastEruptionYear: best.lastEruptionYear || 'unknown',
    lastEruptionDate: best.lastEruptionYear
      ? `Last eruption: ${best.lastEruptionYear}${recentActivity ? ' (recent)' : ''}`
      : 'No Holocene eruption recorded',
    evidenceCategory: best.evidenceCategory || 'unknown',
    country: best.country,
    latitude: best.lat,
    longitude: best.lon,
    elevation: best.elevation,
    alertLevel,
    source: 'gvp-votw-wfs',
  };

  cache.set(cacheKey, result);
  return result;
}
