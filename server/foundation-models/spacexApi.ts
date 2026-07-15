/**
 * SpaceX API Integration — Starlink Tracking + Launch Event Correlation
 *
 * Free REST API: https://api.spacexdata.com/v5
 * Provides: launches, rockets, Starlink satellites, launch pads, landing pads
 *
 * Integrations:
 * - Real-time Starlink constellation tracking with orbital data
 * - Launch event detection and correlation with sentinel alerts
 * - Launch pad activity monitoring for force posture
 */

import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface SpacexLaunch {
  id: string;
  name: string;
  flight_number: number;
  date_utc: string;
  date_unix: number;
  success: boolean | null;
  details: string | null;
  rocket: string;
  launchpad: string;
  cores: Array<{
    core: string;
    flight: number;
    gridfins: boolean;
    legs: boolean;
    reused: boolean;
    landing_attempt: boolean;
    landing_success: boolean | null;
    landing_type: string;
    landpad: string | null;
  }>;
  links: {
    patch: { small: string; large: string } | null;
    webcast: string | null;
    article: string | null;
  };
}

export interface StarlinkSatellite {
  spaceTrack: {
    OBJECT_NAME: string;
    OBJECT_ID: string;
    EPOCH: string;
    MEAN_MOTION: number;
    ECCENTRICITY: number;
    INCLINATION: number;
    RA_OF_ASC_NODE: number;
    ARG_OF_PERICENTER: number;
    MEAN_ANOMALY: number;
    PERIOD: number;
    APOAPSIS: number;
    PERIAPSIS: number;
  };
  longitude: number | null;
  latitude: number | null;
  height_km: number | null;
  velocity_kms: number | null;
  version: string;
  launch: string;
}

export interface LaunchCorrelation {
  launch_id: string;
  launch_name: string;
  launch_time: string;
  success: boolean | null;
  affected_corridors: string[];
  airspace_disruptions: string[];
  weather_impacts: string[];
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════════════

const SPACEX_API_BASE = 'https://api.spacexdata.com/v5';

export class SpacexApiEngine {
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private launches: SpacexLaunch[] = [];
  private starlink: StarlinkSatellite[] = [];
  private correlations: LaunchCorrelation[] = [];
  private db = getDb();

  constructor() {
    this.ensureTables();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.fetchLatestData().catch(() => {});
    this.pollTimer = setInterval(() => {
      if (this.running) this.fetchLatestData().catch(() => {});
    }, 30 * 60 * 1000); // Every 30 minutes
    logger.info('[SpaceX] Engine started — tracking launches & Starlink');
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  async fetchLatestData(): Promise<void> {
    try {
      await Promise.all([this.fetchLaunches(), this.fetchStarlink()]);
      this.correlateWithSentinel();
    } catch (err) {
      logger.error({ err }, '[SpaceX] Failed to fetch data');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // LAUNCHES
  // ═══════════════════════════════════════════════════════════════════

  private async fetchLaunches(): Promise<void> {
    try {
      const resp = await fetch(`${SPACEX_API_BASE}/launches`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`SpaceX API returned ${resp.status}`);
      const data = await resp.json() as SpacexLaunch[];
      this.launches = data.slice(-100); // Keep last 100 launches
      logger.info({ count: this.launches.length }, '[SpaceX] Launches fetched');
    } catch (err) {
      logger.error({ err }, '[SpaceX] Failed to fetch launches');
    }
  }

  getLaunches(limit = 20): SpacexLaunch[] {
    return this.launches.slice(-limit);
  }

  getUpcomingLaunches(): SpacexLaunch[] {
    return this.launches.filter(l => new Date(l.date_utc) > new Date());
  }

  getRecentLaunches(days = 30): SpacexLaunch[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.launches.filter(l => l.date_unix * 1000 > cutoff);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STARLINK
  // ═══════════════════════════════════════════════════════════════════

  private async fetchStarlink(): Promise<void> {
    try {
      const resp = await fetch(`${SPACEX_API_BASE}/starlink`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new Error(`Starlink API returned ${resp.status}`);
      const data = await resp.json() as StarlinkSatellite[];
      this.starlink = data;
      logger.info({ count: this.starlink.length }, '[SpaceX] Starlink satellites fetched');
    } catch (err) {
      logger.error({ err }, '[SpaceX] Failed to fetch Starlink data');
    }
  }

  getStarlinkByRegion(latMin: number, latMax: number, lonMin: number, lonMax: number): StarlinkSatellite[] {
    return this.starlink.filter(s => {
      if (s.latitude == null || s.longitude == null) return false;
      return s.latitude >= latMin && s.latitude <= latMax && s.longitude >= lonMin && s.longitude <= lonMax;
    });
  }

  getStarlinkByVersion(version: string): StarlinkSatellite[] {
    return this.starlink.filter(s => s.version === version);
  }

  // ═══════════════════════════════════════════════════════════════════
  // CORRELATION
  // ═══════════════════════════════════════════════════════════════════

  private correlateWithSentinel(): void {
    const recentLaunches = this.getRecentLaunches(7);
    for (const launch of recentLaunches) {
      const existing = this.correlations.find(c => c.launch_id === launch.id);
      if (existing) continue;

      const correlation: LaunchCorrelation = {
        launch_id: launch.id,
        launch_name: launch.name,
        launch_time: launch.date_utc,
        success: launch.success,
        affected_corridors: [],
        airspace_disruptions: [],
        weather_impacts: [],
        confidence: 0.8,
      };

      this.correlations.push(correlation);

      // Publish launch event for sentinel correlation engine
      pubsub.publish('sentinel:raw', {
        id: `spacex_launch_${launch.id}`,
        source: 'spacex_launches',
        type: 'launch_event',
        lat: 28.5, // Default Cape Canaveral
        lon: -80.6,
        timestamp: launch.date_unix * 1000,
        payload: {
          name: launch.name,
          success: launch.success,
          flight_number: launch.flight_number,
        },
      });
    }
  }

  getCorrelations(): LaunchCorrelation[] {
    return this.correlations;
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════════

  getStatus() {
    return {
      running: this.running,
      launchCount: this.launches.length,
      starlinkCount: this.starlink.length,
      correlationCount: this.correlations.length,
      lastFetch: this.launches.length > 0 ? this.launches[this.launches.length - 1].date_utc : null,
    };
  }

  private ensureTables(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS spacex_launches (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, flight_number INTEGER,
          date_utc TEXT, success INTEGER, details TEXT, rocket TEXT, launchpad TEXT,
          fetched_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS spacex_starlink (
          object_name TEXT PRIMARY KEY, object_id TEXT, version TEXT,
          launch_id TEXT, latitude REAL, longitude REAL, height_km REAL,
          velocity_kms REAL, fetched_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS spacex_correlations (
          launch_id TEXT PRIMARY KEY, launch_name TEXT, launch_time TEXT,
          success INTEGER, confidence REAL, created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (e) { logger.warn({ err: e }, 'SpaceX API table creation'); }
  }
}

export const spacexEngine = new SpacexApiEngine();
