import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { memoryManagerV2 } from '../memory-v2/memoryManager-v2';
import { causalGraph } from '../world-model/causalGraph';

export interface RadarScan {
  station: string;
  lat: number;
  lon: number;
  timestamp: number;
  reflectivity: number[][];
  velocity: number[][];
  maxReflectivity: number;
  maxVelocity: number;
  precipitationType: 'rain' | 'snow' | 'hail' | 'mixed' | 'none';
}

export interface StormCell {
  id: string;
  lat: number;
  lon: number;
  intensity: number;
  rotationDetected: boolean;
  hailProbability: number;
  movement: { direction: number; speedKmh: number };
  projectedPath: Array<{ lat: number; lon: number; time: number }>;
  tornadoSignature: boolean;
  timestamp: number;
}

export interface StormTrack {
  cellId: string;
  positions: Array<{ lat: number; lon: number; time: number }>;
  intensityHistory: number[];
  predictedPositions: Array<{ lat: number; lon: number; time: number }>;
}

export class RadarInterpreter {
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly noaaBase = 'https://opendata.weather.gov/noaaport/radar';

  init(): void {
    this.ensureTables();
    logger.info('RadarInterpreter initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollTimer = setInterval(() => this.pollRadar(), 300000);
    logger.info('RadarInterpreter started');
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    logger.info('RadarInterpreter stopped');
  }

  /** Fetch NEXRAD radar data for a given station */
  async fetchRadar(stationId: string): Promise<RadarScan | null> {
    try {
      const url = `${this.noaaBase}/${stationId}/latest`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return null;
      const data = await resp.json() as Record<string, unknown>;

      const reflectivity = (data.reflectivity as number[][]) || [[]];
      const velocity = (data.velocity as number[][]) || [[]];

      const scan: RadarScan = {
        station: stationId,
        lat: (data.lat as number) || 0,
        lon: (data.lon as number) || 0,
        timestamp: Date.now(),
        reflectivity,
        velocity,
        maxReflectivity: Math.max(...reflectivity.flat().filter(v => isFinite(v) && v > 0), 0),
        maxVelocity: Math.max(...velocity.flat().filter(v => isFinite(v) && Math.abs(v) > 0).map(Math.abs), 0),
        precipitationType: this.classifyPrecipitation(reflectivity),
      };

      this.cacheRadarScan(scan);
      return scan;
    } catch {
      return null;
    }
  }

  /** Detect storm cells from reflectivity data */
  detectStormCells(scan: RadarScan): StormCell[] {
    const cells: StormCell[] = [];
    const threshold = 35; // dBZ threshold for storm cell detection

    for (let i = 0; i < scan.reflectivity.length; i++) {
      for (let j = 0; j < (scan.reflectivity[i]?.length || 0); j++) {
        const dbz = scan.reflectivity[i]?.[j] || 0;
        if (dbz >= threshold) {
          const centroid = this.findCellCentroid(scan.reflectivity, i, j, threshold);
          if (!cells.some(c => Math.abs(c.lat - centroid.lat) < 0.1 && Math.abs(c.lon - centroid.lon) < 0.1)) {
            const rotationDetected = this.detectRotation(scan.velocity, i, j);
            const hailProb = this.estimateHailProbability(dbz, scan.maxReflectivity);
            const projected = this.projectStormPath(centroid.lat, centroid.lon);

            cells.push({
              id: `storm_${scan.station}_${cells.length}_${Date.now()}`,
              lat: centroid.lat,
              lon: centroid.lon,
              intensity: dbz,
              rotationDetected,
              hailProbability: hailProb,
              movement: { direction: 0, speedKmh: 0 },
              projectedPath: projected,
              tornadoSignature: rotationDetected && dbz > 50,
              timestamp: scan.timestamp,
            });
          }
        }
      }
    }

    return cells;
  }

  /** Track storm cell movement over successive scans */
  trackStorm(previousCells: StormCell[], currentCells: StormCell[]): StormTrack[] {
    const tracks: StormTrack[] = [];

    for (const current of currentCells) {
      const matched = previousCells
        .map(p => ({ cell: p, dist: this.haversine(p.lat, p.lon, current.lat, current.lon) }))
        .filter(m => m.dist < 50) // within 50km = same storm
        .sort((a, b) => a.dist - b.dist);

      if (matched.length > 0) {
        const prev = matched[0].cell;
        const dx = current.lon - prev.lon;
        const dy = current.lat - prev.lat;
        const direction = Math.atan2(dx, dy) * 180 / Math.PI;
        const speedKmh = (matched[0].dist * 1000) / ((current.timestamp - prev.timestamp) / 3600000);
        current.movement = { direction: (direction + 360) % 360, speedKmh: Math.round(speedKmh) };

        const projected = this.projectStormPath(current.lat, current.lon);
        current.projectedPath = projected;
      }

      tracks.push({
        cellId: current.id,
        positions: [{ lat: current.lat, lon: current.lon, time: current.timestamp }],
        intensityHistory: [current.intensity],
        predictedPositions: current.projectedPath,
      });
    }

    return tracks;
  }

  /** Predict storm trajectory 1-6 hours ahead */
  predictStormPath(cell: StormCell, hoursAhead = 6): Array<{ lat: number; lon: number; time: number }> {
    const path: Array<{ lat: number; lon: number; time: number }> = [];
    const speedKmh = cell.movement.speedKmh || 30;
    const rad = cell.movement.direction * Math.PI / 180;
    const kmPerDeg = 111.32;

    for (let h = 1; h <= hoursAhead; h++) {
      const dist = speedKmh * h;
      const dLat = (dist * Math.cos(rad)) / kmPerDeg;
      const dLon = (dist * Math.sin(rad)) / (kmPerDeg * Math.cos(cell.lat * Math.PI / 180));

      path.push({
        lat: cell.lat + dLat,
        lon: cell.lon + dLon,
        time: Date.now() + h * 3600000,
      });
    }

    return path;
  }

  /** Get precipitation intensity from reflectivity */
  getPrecipitationIntensity(dbz: number): 'none' | 'light' | 'moderate' | 'heavy' | 'extreme' {
    if (dbz < 5) return 'none';
    if (dbz < 20) return 'light';
    if (dbz < 35) return 'moderate';
    if (dbz < 50) return 'heavy';
    return 'extreme';
  }

  /** Convert reflectivity to rainfall rate (mm/h) using Z-R relationship */
  reflectivityToRainfall(dbz: number): number {
    const z = Math.pow(10, dbz / 10);
    const a = 200;
    const b = 1.6;
    return Math.pow(z / a, 1 / b);
  }

  /** Publish storm alert for significant cells */
  publishStormAlert(cell: StormCell, scan: RadarScan): void {
    const severity = cell.tornadoSignature ? 'critical' : cell.intensity > 45 ? 'warning' : 'advisory';
    const title = cell.tornadoSignature
      ? `TORNADO WARNING — ${scan.station} radar`
      : `Storm alert — ${scan.station} radar`;

    pubsub.publish('radar:storm_alert', {
      cellId: cell.id,
      lat: cell.lat,
      lon: cell.lon,
      severity,
      title,
      intensity: cell.intensity,
      rotationDetected: cell.rotationDetected,
      hailProbability: cell.hailProbability,
      movement: cell.movement,
      projectedPath: cell.projectedPath,
      timestamp: Date.now(),
    });

    causalGraph.addNode(cell.id, 'event', 0.5, {
      intensity: cell.intensity,
      rotationDetected: cell.rotationDetected,
      tornadoSignature: cell.tornadoSignature,
      hailProbability: cell.hailProbability,
    }).catch(() => {});

    memoryManagerV2.store('episodic', { userId: '', query: 'storm_cell', response: JSON.stringify(cell), intentType: 'weather' } as unknown as Record<string, unknown>).catch(() => {});
  }

  private async pollRadar(): Promise<void> {
    const stations = ['KTLX', 'KHTX', 'KIND', 'KATX', 'KICT', 'KAMA', 'KGWX', 'KHPX'];
    for (const station of stations) {
      try {
        const scan = await this.fetchRadar(station);
        if (scan) {
          const cells = this.detectStormCells(scan);
          const severeCells = cells.filter(c => c.intensity > 40 || c.tornadoSignature);
          for (const cell of severeCells) {
            this.publishStormAlert(cell, scan);
          }
        }
      } catch { /* continue */ }
    }
  }

  private classifyPrecipitation(reflectivity: number[][]): 'rain' | 'snow' | 'hail' | 'mixed' | 'none' {
    const max = Math.max(...reflectivity.flat().filter(v => isFinite(v)), 0);
    if (max < 5) return 'none';
    if (max > 55) return 'hail';
    if (max > 45) return 'rain';
    return 'rain';
  }

  private detectRotation(velocity: number[][], i: number, j: number): boolean {
    // Check for velocity couplet (inbound/outbound adjacent) indicating rotation
    let coupletCount = 0;
    for (const di of [-1, 0, 1]) {
      for (const dj of [-1, 0, 1]) {
        if (di === 0 && dj === 0) continue;
        const v = velocity[i + di]?.[j + dj] || 0;
        const center = velocity[i]?.[j] || 0;
        if (center * v < -100) coupletCount++;
      }
    }
    return coupletCount >= 2;
  }

  private findCellCentroid(grid: number[][], startI: number, startJ: number, threshold: number): { lat: number; lon: number } {
    let sumI = 0, sumJ = 0, count = 0;
    for (let i = Math.max(0, startI - 3); i <= Math.min(grid.length - 1, startI + 3); i++) {
      for (let j = Math.max(0, startJ - 3); j <= Math.min((grid[i]?.length || 0) - 1, startJ + 3); j++) {
        if ((grid[i]?.[j] || 0) >= threshold) {
          sumI += i;
          sumJ += j;
          count++;
        }
      }
    }
    if (count === 0) return { lat: 0, lon: 0 };
    return { lat: sumI / count, lon: sumJ / count };
  }

  private estimateHailProbability(dbz: number, _maxDbz: number): number {
    if (dbz < 45) return 0;
    if (dbz < 55) return (dbz - 45) / 10 * 0.5;
    return 0.5 + (dbz - 55) / 15 * 0.5;
  }

  private projectStormPath(lat: number, lon: number): Array<{ lat: number; lon: number; time: number }> {
    return [];
  }

  private cacheRadarScan(scan: RadarScan): void {
    try {
      const db = getDb();
      db.prepare(
        'INSERT INTO radar_scans (station, lat, lon, timestamp, scan_json, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
      ).run(scan.station, scan.lat, scan.lon, scan.timestamp, JSON.stringify(scan));
    } catch { /* ignore */ }
  }

  /** Query recent radar scans */
  getRecentScans(limit = 10): RadarScan[] {
    try {
      const db = getDb();
      return db.prepare('SELECT * FROM radar_scans ORDER BY timestamp DESC LIMIT ?').all(limit) as RadarScan[];
    } catch { return []; }
  }

  getStats() {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM radar_scans').get() as { c: number }).c;
      return { totalScans: count, running: this.running };
    } catch { return { totalScans: 0, running: this.running }; }
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS radar_scans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          station TEXT NOT NULL,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          timestamp INTEGER NOT NULL,
          scan_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_radar_station ON radar_scans(station);
        CREATE INDEX IF NOT EXISTS idx_radar_timestamp ON radar_scans(timestamp DESC);

        CREATE TABLE IF NOT EXISTS storm_cells (
          id TEXT PRIMARY KEY,
          station TEXT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          intensity REAL,
          rotation_detected INTEGER DEFAULT 0,
          tornado_signature INTEGER DEFAULT 0,
          hail_probability REAL,
          track_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_storm_location ON storm_cells(lat, lon);
      `);
    } catch { /* tables exist */ }
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export const radarInterpreter = new RadarInterpreter();
