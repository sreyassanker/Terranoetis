/**
 * NOAA National Data Buoy Center (NDBC) Real-Time Data Integration
 *
 * Provides real-time oceanographic and meteorological data from 100+ moored
 * buoys and 50+ C-MAN stations. Includes wave height, wind, temperature,
 * pressure, and ocean current data.
 *
 * Data source: https://www.ndbc.noaa.gov/
 * Data format: Fixed-width text files, no authentication required
 */

import { logger } from '../observability/logger';

export interface NdbcStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevation?: number; // meters above sea level (C-MAN stations)
  type: 'buoy' | 'cman';
}

export interface NdbcReading {
  stationId: string;
  timestamp: string;
  // Wind
  windDirection?: number;    // WDIR - degrees true
  windSpeed?: number;        // WSPD - m/s
  windGust?: number;         // GST - m/s
  // Waves
  waveHeight?: number;       // WVHT - meters (significant)
  dominantPeriod?: number;   // DPD - seconds
  averagePeriod?: number;    // APD - seconds
  meanWaveDirection?: number; // MWD - degrees true
  // Atmospheric
  pressure?: number;         // PRES - hPa (sea level)
  airTemperature?: number;   // ATMP - Celsius
  dewPoint?: number;         // DEWP - Celsius
  // Ocean
  seaTemperature?: number;   // WTMP - Celsius
  // Station info
  lat?: number;
  lon?: number;
}

/** Key stations across major ocean basins */
export const KEY_STATIONS: NdbcStation[] = [
  // Atlantic
  { id: '41002', name: 'South Hatteras, NC', lat: 32.308, lon: -75.427, type: 'buoy' },
  { id: '41001', name: 'Cape Hatteras', lat: 34.681, lon: -72.663, type: 'buoy' },
  { id: '41004', name: 'Edisto, SC', lat: 32.501, lon: -79.099, type: 'buoy' },
  { id: '41008', name: 'Grays Reef, GA', lat: 31.402, lon: -80.869, type: 'buoy' },
  { id: '41009', name: 'Cape Canaveral', lat: 28.531, lon: -80.164, type: 'buoy' },
  { id: '41047', name: 'N. Miami', lat: 27.514, lon: -79.999, type: 'buoy' },
  { id: '44009', name: 'Delaware Bay', lat: 38.461, lon: -74.703, type: 'buoy' },
  { id: '44025', name: 'Long Island', lat: 40.251, lon: -73.164, type: 'buoy' },
  { id: '44017', name: 'Montauk Point', lat: 40.694, lon: -72.048, type: 'buoy' },
  { id: '44013', name: 'Boston Harbor', lat: 42.346, lon: -70.651, type: 'buoy' },
  { id: '44005', name: 'Gulf of Maine', lat: 43.189, lon: -69.140, type: 'buoy' },
  // Pacific
  { id: '46087', name: 'Monterey, CA', lat: 36.793, lon: -122.398, type: 'buoy' },
  { id: '46026', name: 'San Francisco', lat: 37.750, lon: -122.840, type: 'buoy' },
  { id: '46042', name: 'Monterey Bay', lat: 36.785, lon: -122.398, type: 'buoy' },
  { id: '46059', name: 'Oregon Offshore', lat: 42.888, lon: -130.011, type: 'buoy' },
  { id: '51002', name: 'South Pacific', lat: 16.877, lon: -163.105, type: 'buoy' },
  // Gulf of Mexico
  { id: '42001', name: 'Central Gulf', lat: 25.888, lon: -89.658, type: 'buoy' },
  { id: '42002', name: 'W. Gulf', lat: 26.968, lon: -93.211, type: 'buoy' },
  { id: '42003', name: 'E. Gulf', lat: 26.006, lon: -85.612, type: 'buoy' },
  { id: '42019', name: 'Freeport, TX', lat: 27.913, lon: -95.354, type: 'buoy' },
  // Caribbean / Hawaii
  { id: '51000', name: 'NW Hawaiian Islands', lat: 24.372, lon: -162.041, type: 'buoy' },
  // Great Lakes
  { id: '45007', name: 'Lake Superior', lat: 47.342, lon: -87.547, type: 'buoy' },
  { id: '45005', name: 'Lake Huron', lat: 45.495, lon: -82.854, type: 'buoy' },
  { id: '45006', name: 'Lake Michigan', lat: 44.282, lon: -86.975, type: 'buoy' },
  { id: '45002', name: 'Lake Michigan', lat: 45.350, lon: -86.417, type: 'buoy' },
  { id: '45001', name: 'Lake Superior', lat: 47.908, lon: -87.409, type: 'buoy' },
  { id: '45003', name: 'Lake Huron', lat: 45.575, lon: -83.859, type: 'buoy' },
  { id: '45004', name: 'Lake Erie', lat: 41.691, lon: -82.397, type: 'buoy' },
];

/**
 * Parse NDBC fixed-width text format into readings
 */
function parseNdbcText(text: string, stationId: string): NdbcReading[] {
  const rawLines = text.split('\n');
  // NDBC files have multiple # comment lines followed by a header line, then data
  // Find the header line (first non-comment, non-empty line)
  let headerLine = '';
  let dataStartIdx = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (l.startsWith('#') || !l.trim()) continue;
    headerLine = l;
    dataStartIdx = i + 1;
    break;
  }
  if (!headerLine) return [];
  const headerParts = headerLine.trim().split(/\s+/);

  // Standard column order for NDBC stdmet files:
  // #YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS TIDE
  // But column positions can vary. Parse by header names.
  const colMap: Record<string, number> = {};
  headerParts.forEach((h, i) => {
    colMap[h] = i;
  });

  const readings: NdbcReading[] = [];

  for (let i = dataStartIdx; i < rawLines.length; i++) {
    if (!rawLines[i].trim() || rawLines[i].startsWith('#')) continue;
    const parts = rawLines[i].trim().split(/\s+/);
    if (parts.length < 10) continue;

    const getVal = (col: string): number | undefined => {
      const idx = colMap[col];
      if (idx === undefined || idx >= parts.length) return undefined;
      const v = parts[idx];
      if (v === 'MM' || v === '999.0' || v === '99.00') return undefined;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    };

    const year = parts[colMap['YY']] || '';
    const month = parts[colMap['MM']] || '';
    const day = parts[colMap['DD']] || '';
    const hour = parts[colMap['hh']] || '';
    const minute = parts[colMap['mm']] || '';

    const reading: NdbcReading = {
      stationId,
      timestamp: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00Z`,
      windDirection: getVal('WDIR'),
      windSpeed: getVal('WSPD'),
      windGust: getVal('GST'),
      waveHeight: getVal('WVHT'),
      dominantPeriod: getVal('DPD'),
      averagePeriod: getVal('APD'),
      meanWaveDirection: getVal('MWD'),
      pressure: getVal('PRES'),
      airTemperature: getVal('ATMP'),
      dewPoint: getVal('DEWP'),
      seaTemperature: getVal('WTMP'),
      lat: getVal('OTHR') || undefined,
      lon: getVal('OTHR') || undefined,
    };

    readings.push(reading);
  }

  return readings;
}

/**
 * Fetch real-time data for a specific NDBC station
 */
export async function fetchStationData(stationId: string, dataType: string = 'stdmet'): Promise<NdbcReading[]> {
  if (!stationId || typeof stationId !== 'string') return [];

  try {
    const url = `https://www.ndbc.noaa.gov/data/realtime2/${stationId}.${dataType}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'EarthIntelligence/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return [];

    const text = await resp.text();
    return parseNdbcText(text, stationId);
  } catch (e) {
    logger.warn({ err: e, stationId }, 'NDBC fetch failed');
    return [];
  }
}

/**
 * Fetch data for multiple stations concurrently
 */

/**
 * Find nearest NDBC station to a coordinate
 */
export function findNearestStation(lat: number, lon: number): NdbcStation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  let nearest: NdbcStation | null = null;
  let minDist = Infinity;

  for (const station of KEY_STATIONS) {
    const dlat = station.lat - lat;
    const dlon = station.lon - lon;
    const dist = Math.sqrt(dlat * dlat + dlon * dlon);
    if (dist < minDist) {
      minDist = dist;
      nearest = station;
    }
  }

  return nearest;
}

/**
 * Get current ocean conditions near a coordinate
 */
export async function getConditionsNearby(
  lat: number,
  lon: number,
): Promise<{
  nearestStation: NdbcStation | null;
  readings: NdbcReading[];
  conditions: {
    waveHeight?: number;
    windSpeed?: number;
    windDirection?: number;
    seaTemperature?: number;
    airTemperature?: number;
    pressure?: number;
  };
}> {
  const station = findNearestStation(lat, lon);
  if (!station) {
    return { nearestStation: null, readings: [], conditions: {} };
  }

  const readings = await fetchStationData(station.id);
  const latest = readings[0] || null;

  return {
    nearestStation: station,
    readings: readings.slice(0, 24), // Last 24 readings
    conditions: latest ? {
      waveHeight: latest.waveHeight,
      windSpeed: latest.windSpeed,
      windDirection: latest.windDirection,
      seaTemperature: latest.seaTemperature,
      airTemperature: latest.airTemperature,
      pressure: latest.pressure,
    } : {},
  };
}

/**
 * Get all available stations
 */
export function getStations(): NdbcStation[] {
  return KEY_STATIONS;
}
