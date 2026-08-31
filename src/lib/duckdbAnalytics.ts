/**
 * In-browser geospatial SQL analytics via DuckDB-WASM.
 *
 * Loads real platform data layers (earthquakes, flights, satellites, radio
 * stations, CCTV, weather alerts, EONET events) into in-memory DuckDB tables,
 * then lets the user run real SQL over them — join, filter, aggregate,
 * export. All data comes from the live backend; nothing is fabricated.
 *
 * The wasm + worker are served from `self` (Vite asset imports), which
 * satisfies the platform CSP (worker-src: self, blob:).
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';

let dbPromise: Promise<AsyncDuckDB> | null = null;
let worker: Worker | null = null;

// DuckDB wasm + workers are copied verbatim into public/duckdb/ (served as-is,
// no Vite ESM transform) so they satisfy the platform CSP (worker-src: self).
// The worker is created via importScripts inside a Blob URL, which requires an
// ABSOLUTE URL — resolve against the document base so it works under
// base:'./' subpath deployments as well as dev.
function duckdbAsset(file: string): string {
  const base = (document.baseURI || window.location.href).replace(/\/[^/]*$/, '/');
  return new URL(`duckdb/${file}`, base).toString();
}

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdbAsset('duckdb-mvp.wasm'),
    mainWorker: duckdbAsset('duckdb-browser-mvp.worker.js'),
  },
  eh: {
    mainModule: duckdbAsset('duckdb-eh.wasm'),
    mainWorker: duckdbAsset('duckdb-browser-eh.worker.js'),
  },
};

/** Lazily initialise the DuckDB instance (singleton). */
export async function getDuckDB(): Promise<AsyncDuckDB> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const bundle = await duckdb.selectBundle(BUNDLES);
    const worker_url = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
    );
    worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(worker_url);
    return db;
  })();
  return dbPromise;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  timeMs: number;
  error?: string;
}

/** Run a SQL query and return the rows as plain objects. */
export async function runQuery(sql: string): Promise<QueryResult> {
  const t0 = performance.now();
  try {
    const db = await getDuckDB();
    const conn = await db.connect();
    try {
      const res = await conn.query(sql);
      const columns = res.schema.fields.map((f) => f.name);
      const rows = res.toArray().map((row) => {
        const obj: Record<string, unknown> = {};
        for (const col of columns) obj[col] = row[col];
        return obj;
      });
      return { columns, rows, rowCount: rows.length, timeMs: performance.now() - t0 };
    } finally {
      await conn.close();
    }
  } catch (e) {
    return { columns: [], rows: [], rowCount: 0, timeMs: performance.now() - t0, error: (e as Error).message };
  }
}

/** Register (or replace) a table from an array of flat objects. */
export async function registerTable(name: string, rows: Array<Record<string, unknown>>): Promise<void> {
  const db = await getDuckDB();
  const conn = await db.connect();
  try {
    await conn.query(`DROP TABLE IF EXISTS "${name}"`);
    if (rows.length === 0) {
      await conn.query(`CREATE TABLE "${name}" (__empty BOOLEAN)`);
      return;
    }
    // Build a CREATE TABLE from the union of keys across rows.
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const createCols = cols
      .map((c) => {
        const sample = rows.find((r) => r[c] !== null && r[c] !== undefined);
        const v = sample?.[c];
        const t = typeof v === 'number' ? 'DOUBLE' : typeof v === 'boolean' ? 'BOOLEAN' : 'VARCHAR';
        return `"${c}" ${t}`;
      })
      .join(', ');
    await conn.query(`CREATE TABLE "${name}" (${createCols})`);
    // Insert in batches to keep the query small.
    const insert = (batch: Array<Record<string, unknown>>) => {
      const valRows = batch.map((r) =>
        `(${cols.map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          const s = String(v).replace(/'/g, "''");
          return `'${s}'`;
        }).join(', ')})`,
      );
      return `INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${valRows.join(', ')}`;
    };
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await conn.query(insert(rows.slice(i, i + BATCH)));
    }
  } finally {
    await conn.close();
  }
}

/** List tables currently registered in DuckDB. */
export async function listTables(): Promise<string[]> {
  const res = await runQuery(`SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name`);
  return res.rows.map((r) => String(r.table_name));
}

/** Normalise lat/lon present on a row (handles lat/lon, latitude/longitude). */
export function extractLatLon(row: Record<string, unknown>): { lat?: number; lon?: number } {
  const lat = Number(row.lat ?? row.latitude ?? row.latN ?? NaN);
  const lon = Number(row.lon ?? row.longitude ?? row.lonN ?? NaN);
  return {
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
  };
}
