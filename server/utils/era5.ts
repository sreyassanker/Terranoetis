/**
 * ECMWF ERA5 Climate Reanalysis — Historical Climate Data
 *
 * ERA5 is the most accurate global climate reanalysis (1940-present):
 * - 0.25° resolution (~31km grid)
 * - Millions of observations assimilated daily
 * - Variables: temperature, precipitation, wind, pressure, humidity,
 *   solar radiation, soil moisture, snow cover, sea ice
 * - Updated monthly with 5-15 day delay
 *
 * Data access: CDS API (Climate Data Store)
 * API: https://cds.climate.copernicus.eu/
 * Auth: Requires CDS API key (free registration)
 * Set CDS_API_KEY in server/.env
 *
 * Alternative: Open-Meteo Historical Weather API (free, no auth)
 */

import { logger } from '../observability/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface Era5DailyData {
  date: string;           // YYYY-MM-DD
  lat: number;
  lon: number;
  temperature2m: number;  // °C (daily mean)
  temperatureMax: number; // °C (daily max)
  temperatureMin: number; // °C (daily min)
  precipitation: number;  // mm (daily sum)
  windSpeed10m: number;   // m/s (daily mean)
  windDirection10m: number; // degrees
  surfacePressure: number; // hPa
  relativeHumidity: number; // %
  solarRadiation: number; // MJ/m²
  soilMoisture: number;   // m³/m³
}

export interface Era5ClimateStats {
  period: string;
  location: { lat: number; lon: number };
  temperature: {
    mean: number;
    max: number;
    min: number;
    anomaly: number; // deviation from 30-year mean
  };
  precipitation: {
    total: number;
    rainyDays: number;
    anomaly: number;
  };
  extremes: {
    heatwaves: number;
    coldSnaps: number;
    droughtDays: number;
    heavyRainDays: number;
  };
  source: string;
}

export interface Era5ExtremeEvent {
  type: 'heatwave' | 'cold_snap' | 'drought' | 'heavy_rain' | 'wind_storm';
  startDate: string;
  endDate: string;
  intensity: number; // 0-1
  description: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch historical daily data from Open-Meteo Archive API
 * (Free, no auth required — falls back when CDS is unavailable)
 */
export async function getHistoricalDaily(
  lat: number,
  lon: number,
  startDate: string,  // YYYY-MM-DD
  endDate: string,    // YYYY-MM-DD
): Promise<Era5DailyData[]> {
  try {
    // Open-Meteo Historical Weather API (free, uses ERA5 data)
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,wind_speed_10m_max&timezone=auto`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, '[ERA5] Open-Meteo API returned error');
      return [];
    }

    const data = await response.json() as {
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        temperature_2m_mean?: number[];
        precipitation_sum?: number[];
        wind_speed_10m_max?: number[];
        wind_direction_10m_dominant?: number[];
        surface_pressure?: number[];
      };
    };

    const daily = data.daily;
    if (!daily?.time) return [];

    return daily.time.map((date, i) => ({
      date,
      lat,
      lon,
      temperature2m: daily.temperature_2m_mean?.[i] ?? 0,
      temperatureMax: daily.temperature_2m_max?.[i] ?? 0,
      temperatureMin: daily.temperature_2m_min?.[i] ?? 0,
      precipitation: daily.precipitation_sum?.[i] ?? 0,
      windSpeed10m: daily.wind_speed_10m_max?.[i] ?? 0,
      windDirection10m: daily.wind_direction_10m_dominant?.[i] ?? 0,
      surfacePressure: daily.surface_pressure?.[i] ?? 1013,
      relativeHumidity: 0,
      solarRadiation: 0,
      soilMoisture: 0,
    }));
  } catch (e) {
    logger.error({ err: e }, '[ERA5] Failed to fetch historical data');
    return [];
  }
}

/**
 * Calculate climate statistics for a period
 */
export function calculateClimateStats(
  data: Era5DailyData[],
  periodLabel: string = 'custom',
): Era5ClimateStats | null {
  if (data.length === 0) return null;

  const temps = data.map((d) => d.temperature2m).filter((t) => t !== 0);
  const precips = data.map((d) => d.precipitation);
  const maxTemps = data.map((d) => d.temperatureMax);
  const minTemps = data.map((d) => d.temperatureMin);

  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const maxT = Math.max(...maxTemps);
  const minT = Math.min(...minTemps);
  const totalPrecip = precips.reduce((a, b) => a + b, 0);
  const rainyDays = precips.filter((p) => p > 1).length;

  // 30-year baseline for anomaly calculation (simplified)
  const baselineMean = 15; // Global average — in production use actual 30-year data
  const anomaly = mean - baselineMean;
  const precipAnomaly = totalPrecip - (rainyDays * 5); // rough baseline

  // Extreme events
  const heatwaveDays = data.filter((d) => d.temperatureMax > mean + 5).length;
  const coldDays = data.filter((d) => d.temperatureMin < mean - 10).length;
  const droughtDays = data.filter((d) => d.precipitation < 0.1).length;
  const heavyRainDays = data.filter((d) => d.precipitation > 20).length;

  return {
    period: periodLabel,
    location: { lat: data[0].lat, lon: data[0].lon },
    temperature: {
      mean: Math.round(mean * 10) / 10,
      max: maxT,
      min: minT,
      anomaly: Math.round(anomaly * 10) / 10,
    },
    precipitation: {
      total: Math.round(totalPrecip * 10) / 10,
      rainyDays,
      anomaly: Math.round(precipAnomaly * 10) / 10,
    },
    extremes: {
      heatwaves: heatwaveDays,
      coldSnaps: coldDays,
      droughtDays,
      heavyRainDays,
    },
    source: 'ERA5 via Open-Meteo',
  };
}

/**
 * Detect extreme climate events in a time series
 */
export function detectExtremes(data: Era5DailyData[]): Era5ExtremeEvent[] {
  if (data.length === 0) return [];

  const temps = data.map((d) => d.temperature2m);
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const stddev = Math.sqrt(temps.reduce((a, b) => a + (b - mean) ** 2, 0) / temps.length);

  const events: Era5ExtremeEvent[] = [];

  // Find consecutive extreme periods
  let i = 0;
  while (i < data.length) {
    if (data[i].temperatureMax > mean + 2 * stddev) {
      const start = i;
      while (i < data.length && data[i].temperatureMax > mean + 2 * stddev) i++;
      events.push({
        type: 'heatwave',
        startDate: data[start].date,
        endDate: data[i - 1].date,
        intensity: Math.min(1, (data[start].temperatureMax - mean) / (3 * stddev)),
        description: `Heatwave: ${data[start].temperatureMax}°C peak`,
      });
    } else if (data[i].temperatureMin < mean - 2 * stddev) {
      const start = i;
      while (i < data.length && data[i].temperatureMin < mean - 2 * stddev) i++;
      events.push({
        type: 'cold_snap',
        startDate: data[start].date,
        endDate: data[i - 1].date,
        intensity: Math.min(1, (mean - data[start].temperatureMin) / (3 * stddev)),
        description: `Cold snap: ${data[start].temperatureMin}°C low`,
      });
    } else if (data[i].precipitation > 30) {
      events.push({
        type: 'heavy_rain',
        startDate: data[i].date,
        endDate: data[i].date,
        intensity: Math.min(1, data[i].precipitation / 50),
        description: `Heavy rain: ${data[i].precipitation}mm`,
      });
      i++;
    } else {
      i++;
    }
  }

  return events;
}
