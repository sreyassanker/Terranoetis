import { computeEquation, EQUATION_ENGINE, normalizeInputs as _normalizeInputs, type ComputeResult } from './engine';

interface StudyArea {
  mode: 'point' | 'bbox' | 'two-points';
  point?: [number, number];
  bbox?: [[number, number], [number, number]];
  twoPoints?: [[number, number], [number, number]];
}

interface TimeContext {
  granularity: string | null;
  start: string;
  end: string;
}

export interface ContextResult extends ComputeResult {
  dataSource: string;
  fetchedParams: Record<string, number>;
  location: { lat: number; lon: number };
}

function mean(arr: number[] | undefined): number | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function fetchWeather(lat: number, lon: number, time?: TimeContext): Promise<Record<string, number>> {
  try {
    const startDate = time?.start && time.start.length >= 10 ? time.start.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const endDate = time?.end && time.end.length >= 10 ? time.end.slice(0, 10) : startDate;
    const today = new Date().toISOString().slice(0, 10);
    const isHistorical = startDate < today;

    if (isHistorical) {
      const url = `https://archive-api.open-meteo.com/v1/archive`
        + `?latitude=${lat}&longitude=${lon}`
        + `&start_date=${startDate}&end_date=${endDate}`
        + `&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code`
        + `&timezone=auto`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return {};
      const data = await resp.json();
      const h = data.hourly ?? {};
      return {
        temperature_2m: mean(h.temperature_2m),
        relative_humidity_2m: mean(h.relative_humidity_2m),
        apparent_temperature: mean(h.apparent_temperature),
        precipitation: mean(h.precipitation),
        pressure_msl: mean(h.pressure_msl),
        wind_speed_10m: mean(h.wind_speed_10m),
        wind_direction_10m: mean(h.wind_direction_10m),
        weather_code: h.weather_code?.[0],
      };
    }

    const resp = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code&timezone=auto`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return {};
    const data = await resp.json();
    const c = data.current ?? {};
    return {
      temperature_2m: c.temperature_2m,
      relative_humidity_2m: c.relative_humidity_2m,
      apparent_temperature: c.apparent_temperature,
      precipitation: c.precipitation,
      pressure_msl: c.pressure_msl,
      wind_speed_10m: c.wind_speed_10m,
      wind_direction_10m: c.wind_direction_10m,
      weather_code: c.weather_code,
    };
  } catch {
    return {};
  }
}

const SIGMA = 5.670374419e-8;
const R_SPEC = 287.058;
const G_GRAV = 9.80665;
const _OMEGA = 7.292115e-5;

function mapWeatherToDomain1Inputs(
  toolId: number,
  weather: Record<string, number>,
  lat: number,
  lon: number,
  userInputs: Record<string, number>,
): Record<string, number> {
  const T = weather.temperature_2m ?? userInputs['T'] ?? 288;
  const P = weather.pressure_msl ?? userInputs['P0'] ?? 1013.25;
  const ws = weather.wind_speed_10m ?? userInputs['u'] ?? 5;
  const rh = weather.relative_humidity_2m ?? 50;

  switch (toolId) {
    case 1:
      return {
        'T₁₀': userInputs['T₁₀'] ?? T + 273.15,
        'T₁₁': userInputs['T₁₁'] ?? T + 273.15 - 2,
        'ε₁₀': userInputs['ε₁₀'] ?? 0.97,
        'ε₁₁': userInputs['ε₁₁'] ?? 0.98,
        'w': userInputs['w'] ?? Math.max(0.5, rh / 100 * 3),
      };
    case 2:
      return { 'λ': userInputs['λ'] ?? 10, T: T + 273.15 };
    case 3:
      return { T };
    case 4:
      return { P0: userInputs['P0'] ?? P, z: userInputs['z'] ?? 0, T: userInputs['T'] ?? T + 273.15 };
    case 5:
      return {
        'f': userInputs['f'] ?? 2 * _OMEGA * Math.sin(lat * Math.PI / 180),
        'ρ': userInputs['ρ'] ?? P * 100 / (R_SPEC * (T + 273.15)),
        'dPdx': userInputs['dPdx'] ?? 0.001,
        'dPdy': userInputs['dPdy'] ?? 0.001,
      };
    case 6:
      return { u: ws, D: userInputs['D'] ?? 100, 'C₀': userInputs['C₀'] ?? 100, t: userInputs['t'] ?? 3600 };
    case 7:
      return {
        'z_g': userInputs['z_g'] ?? 100,
        'z_s': userInputs['z_s'] ?? 2,
        'θᵥ(z)': userInputs['θᵥ(z)'] ?? T + 273.15 + 5,
        'θᵥ(s)': userInputs['θᵥ(s)'] ?? T + 273.15,
        'u(z)': userInputs['u(z)'] ?? ws + 2,
        'u(s)': userInputs['u(s)'] ?? ws * 0.3,
      };
    case 8:
      return { C: userInputs['C'] ?? 1.5, 'ε': userInputs['ε'] ?? 0.001, k: userInputs['k'] ?? 0.01 };
    default:
      return userInputs;
  }
}

export async function computeWithContext(
  id: number,
  inputs: Record<string, number>,
  context?: { studyArea?: StudyArea; time?: TimeContext; filters?: Record<string, unknown> },
): Promise<ContextResult | null> {
  if (!EQUATION_ENGINE[id]) return null;

  let weather: Record<string, number> = {};
  let lat = 0, lon = 0;

  if (context?.studyArea) {
    const sa = context.studyArea;
    if (sa.mode === 'point' && sa.point) {
      lat = sa.point[0]; lon = sa.point[1];
    } else if (sa.mode === 'bbox' && sa.bbox) {
      lat = (sa.bbox[0][0] + sa.bbox[1][0]) / 2;
      lon = (sa.bbox[0][1] + sa.bbox[1][1]) / 2;
    } else if (sa.mode === 'two-points' && sa.twoPoints) {
      lat = (sa.twoPoints[0][0] + sa.twoPoints[1][0]) / 2;
      lon = (sa.twoPoints[0][1] + sa.twoPoints[1][1]) / 2;
    }

    weather = await fetchWeather(lat, lon, context?.time);
  }

  const enrichedInputs = mapWeatherToDomain1Inputs(id, weather, lat, lon, inputs);

  const baseResult = computeEquation(id, enrichedInputs, context);
  if (!baseResult) return null;

  return {
    ...baseResult,
    dataSource: weather.temperature_2m !== undefined ? 'open-meteo' : 'user-provided',
    fetchedParams: weather,
    location: { lat, lon },
  };
}
