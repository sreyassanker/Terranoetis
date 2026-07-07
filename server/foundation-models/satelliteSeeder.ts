import { getDb } from '../db/index';
import { prithviEngine } from './prithvi';
import { logger } from '../observability/logger';

const DEFAULT_SPACING_DEG = 2;
const DEFAULT_CONCURRENCY = 3;
const SAMPLE_SPACING_KEY = 'seeder_spacing_deg';
const SEEDER_LAST_LAT_KEY = 'seeder_last_lat';
const SEEDER_LAST_LON_KEY = 'seeder_last_lon';
const SEEDER_TOTAL_KEY = 'seeder_total_cells';
const SEEDER_DONE_KEY = 'seeder_done_cells';

interface SeederStatus {
  running: boolean;
  spacingDeg: number;
  totalCells: number;
  completedCells: number;
  percentComplete: number;
  lastLat: number | null;
  lastLon: number | null;
  lastError: string | null;
  activeJobs: number;
}

export class SatelliteSeeder {
  private running = false;
  private abortController: AbortController | null = null;
  private activeJobs = 0;
  private lastError: string | null = null;
  private lastLat: number | null = null;
  private lastLon: number | null = null;
  private spacingDeg = DEFAULT_SPACING_DEG;

  private ensureTables(): void {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS seeder_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      const db = getDb();
      const row = db.prepare('SELECT value FROM seeder_config WHERE key = ?').get(SAMPLE_SPACING_KEY) as { value: string } | undefined;
      if (row) this.spacingDeg = parseFloat(row.value) || DEFAULT_SPACING_DEG;
    } catch { /* ignore */ }
  }

  private saveConfig(key: string, value: string): void {
    try {
      const db = getDb();
      db.prepare('INSERT OR REPLACE INTO seeder_config (key, value) VALUES (?, ?)').run(key, value);
    } catch { /* ignore */ }
  }

  getStatus(): SeederStatus {
    const db = getDb();
    let totalCells = 0;
    let completedCells = 0;
    try {
      const totalRow = db.prepare('SELECT value FROM seeder_config WHERE key = ?').get(SEEDER_TOTAL_KEY) as { value: string } | undefined;
      const doneRow = db.prepare('SELECT value FROM seeder_config WHERE key = ?').get(SEEDER_DONE_KEY) as { value: string } | undefined;
      if (totalRow) totalCells = parseInt(totalRow.value, 10) || 0;
      if (doneRow) completedCells = parseInt(doneRow.value, 10) || 0;
    } catch { /* ignore */ }
    return {
      running: this.running,
      spacingDeg: this.spacingDeg,
      totalCells,
      completedCells,
      percentComplete: totalCells > 0 ? Math.round((completedCells / totalCells) * 10000) / 100 : 0,
      lastLat: this.lastLat,
      lastLon: this.lastLon,
      lastError: this.lastError,
      activeJobs: this.activeJobs,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(options?: { spacingDeg?: number; latMin?: number; latMax?: number; lonMin?: number; lonMax?: number; resume?: boolean }): Promise<void> {
    if (this.running) {
      logger.warn('[SatelliteSeeder] Already running');
      return;
    }

    this.abortController = new AbortController();
    this.running = true;
    this.lastError = null;

    const spacing = options?.spacingDeg || this.spacingDeg;
    const latMin = options?.latMin ?? -60;
    const latMax = options?.latMax ?? 60;
    const lonMin = options?.lonMin ?? -180;
    const lonMax = options?.lonMax ?? 180;
    const resume = options?.resume ?? false;

    // Build grid
    const grid: Array<{ lat: number; lon: number }> = [];
    for (let lat = latMin; lat <= latMax; lat += spacing) {
      for (let lon = lonMin; lon <= lonMax; lon += spacing) {
        grid.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
      }
    }

    const totalCells = grid.length;
    this.saveConfig(SEEDER_TOTAL_KEY, String(totalCells));
    this.saveConfig(SAMPLE_SPACING_KEY, String(spacing));

    let startIndex = 0;
    if (resume && this.lastLat != null && this.lastLon != null) {
      const idx = grid.findIndex(p => p.lat === this.lastLat && p.lon === this.lastLon);
      if (idx >= 0) startIndex = idx + 1;
    }

    const remaining = grid.slice(startIndex);
    const doneCount = startIndex;
    logger.info({ total: totalCells, remaining: remaining.length, spacing }, '[SatelliteSeeder] Starting grid seeder');

    // Process with concurrency limit
    const signal = this.abortController.signal;
    const semaphore = Array(DEFAULT_CONCURRENCY).fill(null);

    await Promise.allSettled(
      semaphore.map(async (_, i) => {
        for (let j = i; j < remaining.length; j += DEFAULT_CONCURRENCY) {
          if (signal.aborted) break;
          const point = remaining[j];
          this.activeJobs++;
          this.lastLat = point.lat;
          this.lastLon = point.lon;
          try {
            await prithviEngine.analyze({ lat: point.lat, lon: point.lon, radiusKm: 10 });
            const completed = doneCount + Math.floor(j / DEFAULT_CONCURRENCY) + 1;
            this.saveConfig(SEEDER_DONE_KEY, String(completed));
            if (completed % 100 === 0) {
              logger.info({ completed, total: totalCells, pct: Math.round((completed / totalCells) * 100) }, '[SatelliteSeeder] Progress');
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            // Don't log every failure — many ocean points will fail
            this.lastError = msg;
          } finally {
            this.activeJobs--;
          }
          // Small delay between requests to avoid rate limiting
          if (!signal.aborted) {
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }),
    );

    this.saveConfig(SEEDER_DONE_KEY, String(totalCells));
    const finalDoneRow = (() => { try { const db = getDb(); return db.prepare('SELECT value FROM seeder_config WHERE key = ?').get(SEEDER_DONE_KEY) as { value: string } | undefined; } catch { return undefined; } })();
    const finalDone = finalDoneRow ? parseInt(finalDoneRow.value, 10) : totalCells;
    logger.info({ completed: finalDone, total: totalCells }, '[SatelliteSeeder] Finished');
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.running = false;
    logger.info('[SatelliteSeeder] Stopped');
  }

  resetProgress(): void {
    const db = getDb();
    db.prepare('DELETE FROM seeder_config WHERE key IN (?, ?, ?, ?)').run(
      SEEDER_LAST_LAT_KEY, SEEDER_LAST_LON_KEY, SEEDER_TOTAL_KEY, SEEDER_DONE_KEY,
    );
    this.lastLat = null;
    this.lastLon = null;
    this.lastError = null;
    logger.info('[SatelliteSeeder] Progress reset');
  }

  async seedLocation(lat: number, lon: number): Promise<void> {
    try {
      await prithviEngine.analyze({ lat, lon, radiusKm: 10 });
      logger.info({ lat, lon }, '[SatelliteSeeder] Single location seeded');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ lat, lon, err: msg }, '[SatelliteSeeder] Location seed failed');
      throw err;
    }
  }
}

export const satelliteSeeder = new SatelliteSeeder();
