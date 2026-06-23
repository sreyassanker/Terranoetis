import * as satellite from 'satellite.js';

export interface IssTle {
  name: string;
  line1: string;
  line2: string;
}

export interface IssPosition {
  name: string;
  id: number;
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  timestamp: number;
  units: 'kilometers';
  source?: string;
  stale?: boolean;
  warning?: string;
  [key: string]: unknown;
}

export function isValidIssPosition(value: unknown): value is IssPosition {
  if (!value || typeof value !== 'object') return false;
  const position = value as Record<string, unknown>;
  const latitude = Number(position.latitude);
  const longitude = Number(position.longitude);
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

export function parseIssTle(text: string): IssTle {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line1Index = lines.findIndex((line) => line.startsWith('1 25544'));
  const line1 = lines[line1Index];
  const line2 = lines[line1Index + 1];
  if (!line1 || !line2?.startsWith('2 25544')) {
    throw new Error('CelesTrak response did not contain an ISS TLE');
  }

  const possibleName = lines[line1Index - 1];
  return {
    name: possibleName && !possibleName.startsWith('1 ') ? possibleName : 'ISS (ZARYA)',
    line1,
    line2,
  };
}

export function propagateIssPosition(tle: IssTle, at = new Date()): IssPosition {
  const record = satellite.twoline2satrec(tle.line1, tle.line2);
  const state = satellite.propagate(record, at);
  if (!state || !state.position || !state.velocity) {
    throw new Error('Unable to propagate ISS TLE');
  }

  const gmst = satellite.gstime(at);
  const geodetic = satellite.eciToGeodetic(state.position, gmst);
  const latitude = satellite.degreesLat(geodetic.latitude);
  const longitude = satellite.degreesLong(geodetic.longitude);
  const velocity = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) * 3600;
  if (![latitude, longitude, geodetic.height, velocity].every(Number.isFinite)) {
    throw new Error('ISS TLE propagation produced invalid coordinates');
  }

  return {
    name: 'iss',
    id: 25544,
    latitude,
    longitude,
    altitude: geodetic.height,
    velocity,
    timestamp: Math.floor(at.getTime() / 1000),
    units: 'kilometers',
    source: 'CelesTrak TLE (SGP4)',
  };
}
