/**
 * OpenAQ Global Air Quality Platform Integration
 *
 * Provides real-time air quality data from 15,300+ monitoring locations
 * across 141 countries. Covers PM2.5, PM10, SO2, NO2, CO, O3, and more.
 *
 * API: https://api.openaq.org/v3
 * Docs: https://docs.openaq.org/
 *
 * Note: OpenAQ API requires an API key (free registration).
 * Set OPENAQ_API_KEY in server/.env to enable.
 */

import { logger } from '../observability/logger';

export interface OpenAQLocation {
  id: number;
  name: string;
  locality?: string;
  country: { code: string; name: string };
  coordinates: { latitude: number; longitude: number };
  sensors: Array<{
    id: number;
    name: string;
    parameter: { name: string; units: string };
  }>;
  distance?: number;
}

export interface OpenAQMeasurement {
  locationId: number;
  locationName: string;
  parameter: string;
  value: number;
  units: string;
  datetime: string;
  coordinates: { latitude: number; longitude: number };
}

export interface OpenAQAqiResult {
  location: string;
  lat: number;
  lon: number;
  country: string;
  measurements: Array<{
    parameter: string;
    value: number;
    units: string;
    lastUpdated: string;
  }>;
  aqi?: number;
  aqiCategory?: string;
  source: string;
}

const BASE_URL = 'https://api.openaq.org/v3';

function getApiKey(): string | null {
  return process.env.OPENAQ_API_KEY || null;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  const apiKey = getApiKey();
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

/**
 * Find monitoring locations near a coordinate
 */
export async function findLocationsNearby(
  lat: number,
  lon: number,
  radiusMeters: number = 25000,
  limit: number = 10,
): Promise<OpenAQLocation[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return [];
  radiusMeters = Math.min(Math.max(radiusMeters, 100), 25000);
  limit = Math.min(Math.max(limit, 1), 100);

  try {
    const url = `${BASE_URL}/locations?coordinates=${lat.toFixed(6)},${lon.toFixed(6)}&radius=${radiusMeters}&limit=${limit}&order_by=distance&sort=asc`;
    const resp = await fetch(url, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      if (resp.status === 401) {
        logger.warn('OpenAQ API key not configured or invalid');
      }
      return [];
    }

    const data = await resp.json() as { results?: OpenAQLocation[] };
    return data.results || [];
  } catch (e) {
    logger.warn({ err: e }, 'OpenAQ location search failed');
    return [];
  }
}

/**
 * Get latest measurements for a specific location
 */
export async function getLatestMeasurements(locationId: number): Promise<OpenAQMeasurement[]> {
  if (!Number.isFinite(locationId) || locationId <= 0) return [];

  try {
    const url = `${BASE_URL}/locations/${locationId}/latest`;
    const resp = await fetch(url, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return [];

    const data = await resp.json() as { results?: Array<{
      datetime: { utc: string; local?: string };
      value: number;
      coordinates: { latitude: number; longitude: number };
      sensorsId: number;
      locationsId: number;
    }> };

    // Group by location and parameter
    const measurements: OpenAQMeasurement[] = [];
    for (const r of data.results || []) {
      measurements.push({
        locationId: r.locationsId,
        locationName: '',
        parameter: 'unknown',
        value: r.value,
        units: '',
        datetime: r.datetime?.utc || '',
        coordinates: r.coordinates || { latitude: 0, longitude: 0 },
      });
    }
    return measurements;
  } catch (e) {
    logger.warn({ err: e }, 'OpenAQ measurements fetch failed');
    return [];
  }
}

/**
 * Get air quality readings near a coordinate (convenience function)
 * Returns combined measurements from nearby stations
 */
export async function getAirQualityNearby(
  lat: number,
  lon: number,
  radiusMeters: number = 25000,
): Promise<OpenAQAqiResult[]> {
  const locations = await findLocationsNearby(lat, lon, radiusMeters, 5);
  if (locations.length === 0) return [];

  const results: OpenAQAqiResult[] = [];

  const locationResults = await Promise.allSettled(
    locations.map(async (loc) => {
      const url = `${BASE_URL}/locations/${loc.id}/latest`;
      const resp = await fetch(url, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as { results?: Array<{
        datetime: { utc: string };
        value: number;
        sensorsId: number;
        locationsId: number;
      }> };
      const measurements: OpenAQAqiResult['measurements'] = [];
      for (const r of (data.results || [])) {
        const sensor = loc.sensors?.find(s => s.id === r.sensorsId);
        measurements.push({
          parameter: sensor?.parameter?.name || 'unknown',
          value: r.value,
          units: sensor?.parameter?.units || '',
          lastUpdated: r.datetime?.utc || '',
        });
      }
      if (measurements.length > 0) {
        return {
          location: loc.name,
          lat: loc.coordinates?.latitude || lat,
          lon: loc.coordinates?.longitude || lon,
          country: loc.country?.name || '',
          measurements,
          source: 'openaq' as const,
        };
      }
      return null;
    })
  );
  for (const r of locationResults) {
    if (r.status === 'fulfilled' && r.value) results.push(r.value);
  }

  return results;
}

/**
 * Parse OpenAQ data into a simplified format for the Sentinel engine
 */
export function parseForSentinel(data: OpenAQAqiResult[]): {
  avgPm25: number;
  avgPm10: number;
  avgAqi: number;
  stationCount: number;
  readings: Array<{ param: string; value: number; station: string }>;
} {
  const readings: Array<{ param: string; value: number; station: string }> = [];
  let pm25Sum = 0, pm25Count = 0;
  let pm10Sum = 0, pm10Count = 0;

  for (const r of data) {
    for (const m of r.measurements) {
      readings.push({ param: m.parameter, value: m.value, station: r.location });
      if (m.parameter === 'pm25') { pm25Sum += m.value; pm25Count++; }
      if (m.parameter === 'pm10') { pm10Sum += m.value; pm10Count++; }
    }
  }

  const avgPm25 = pm25Count > 0 ? pm25Sum / pm25Count : 0;
  const avgPm10 = pm10Count > 0 ? pm10Sum / pm10Count : 0;
  // Simple AQI approximation from PM2.5 (US EPA breakpoints)
  let avgAqi = 0;
  if (avgPm25 > 0) {
    if (avgPm25 <= 12.0) avgAqi = (50 / 12.0) * avgPm25;
    else if (avgPm25 <= 35.4) avgAqi = 50 + (49 / 23.4) * (avgPm25 - 12.0);
    else if (avgPm25 <= 55.4) avgAqi = 100 + (49 / 20.0) * (avgPm25 - 35.4);
    else if (avgPm25 <= 150.4) avgAqi = 150 + (49 / 95.0) * (avgPm25 - 55.4);
    else avgAqi = 200 + (100 / 99.6) * (avgPm25 - 150.4);
  }

  return {
    avgPm25: Math.round(avgPm25 * 100) / 100,
    avgPm10: Math.round(avgPm10 * 100) / 100,
    avgAqi: Math.round(avgAqi),
    stationCount: data.length,
    readings,
  };
}