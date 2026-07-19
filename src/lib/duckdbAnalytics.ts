/**
 * DuckDB-WASM Client-Side Analytics Engine
 *
 * Brings analytical database capabilities to the browser via DuckDB-WASM.
 * Enables SQL queries on GeoParquet, CSV, and GeoJSON files without server
 * round-trips. Supports drag-and-drop data import and interactive analysis.
 *
 * Based on: https://duckdb.org/docs/api/wasm/overview.html
 * Used by: Felt, Observable, and other modern geospatial platforms
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let duckdbInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let connection: any = null;
let initialized = false;

/**
 * Initialize DuckDB-WASM in a Web Worker for non-blocking execution
 */
export async function initDuckDB(): Promise<void> {
  if (initialized) return;

  try {
    // Dynamic import to avoid blocking initial page load
    const duckdbWasm = await import('@duckdb/duckdb-wasm');
    
    // Get the bundle from jsDelivr
    const bundles = await duckdbWasm.getJsDelivrBundles();
    const bundle = await duckdbWasm.selectBundle(bundles);
    
    // Create worker and logger
    const logger = new duckdbWasm.ConsoleLogger();
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts('${bundle.mainWorker}')`], { type: 'text/javascript' })
    );
    const worker = new Worker(workerUrl);
    
    // Create in-memory database
    duckdbInstance = new duckdbWasm.AsyncDuckDB(logger, worker);
    await duckdbInstance.instantiate(bundle.mainModule);
    connection = await duckdbInstance.connect();

    initialized = true;
    console.log('[DuckDB] Initialized successfully');
  } catch (e) {
    console.warn('[DuckDB] Failed to initialize:', e);
  }
}

/**
 * Execute a SQL query and return results as an array of objects
 * @param sql SQL query string
 * @returns Query results
 */
export async function queryDuckDB<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  if (!initialized || !connection) {
    await initDuckDB();
    if (!connection) return [];
  }

  try {
    const result = await connection.query(sql);
    const rows: T[] = [];
    for (const batch of result.batches) {
      for (let i = 0; i < batch.numRows; i++) {
        const row: Record<string, unknown> = {};
        for (let j = 0; j < batch.numCols; j++) {
          row[batch.schema.fields[j].name] = batch.getChild(j)?.get(i);
        }
        rows.push(row as T);
      }
    }
    return rows;
  } catch (e) {
    console.error('[DuckDB] Query failed:', e);
    return [];
  }
}

/**
 * Import a CSV string into a DuckDB table
 * @param csvData CSV string data
 * @param tableName Table name to create
 */
export async function importCSV(csvData: string, tableName: string): Promise<void> {
  if (!initialized || !connection) {
    await initDuckDB();
    if (!connection) return;
  }

  try {
    // Register the CSV data as a file first
    const fileName = `${tableName}.csv`;
    await duckdbInstance.registerFileText(fileName, csvData);
    
    // Then create the table from the registered file
    await connection.query(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${fileName}')`);
    console.log(`[DuckDB] Imported CSV as table '${tableName}'`);
  } catch (e) {
    console.error('[DuckDB] CSV import failed:', e);
  }
}

/**
 * Import GeoJSON features into a DuckDB table with geometry
 * @param geojson GeoJSON FeatureCollection
 * @param tableName Table name to create
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function importGeoJSON(geojson: { type: string; features?: any[] }, tableName: string): Promise<void> {
  if (!initialized || !connection) {
    await initDuckDB();
    if (!connection) return;
  }

  try {
    // Convert GeoJSON to CSV for import
    const features = geojson.features || [];
    if (features.length === 0) return;

    const firstFeature = features[0];
    const properties = firstFeature.properties || {};
    const headers = Object.keys(properties);

    // Build CSV with geometry columns
    let csv = 'id,' + headers.join(',') + ',longitude,latitude\n';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    features.forEach((f: any, idx: number) => {
      const props = f.properties || {};
      const geometry = f.geometry;
      let lon = '';
      let lat = '';
      
      // Handle different geometry types
      if (geometry && geometry.coordinates) {
        const coords = geometry.coordinates;
        if (geometry.type === 'Point') {
          lon = coords[0] ?? '';
          lat = coords[1] ?? '';
        } else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
          lon = coords[0]?.[0] ?? '';
          lat = coords[0]?.[1] ?? '';
        } else if (geometry.type === 'Polygon') {
          lon = coords[0]?.[0]?.[0] ?? '';
          lat = coords[0]?.[0]?.[1] ?? '';
        } else if (geometry.type === 'MultiPolygon') {
          lon = coords[0]?.[0]?.[0]?.[0] ?? '';
          lat = coords[0]?.[0]?.[0]?.[1] ?? '';
        }
      }
      
      const values = headers.map(h => {
        const v = props[h];
        return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v ?? '';
      });
      csv += `${idx},${values.join(',')},${lon},${lat}\n`;
    });

    await importCSV(csv, tableName);
    console.log(`[DuckDB] Imported GeoJSON as table '${tableName}' with ${features.length} features`);
  } catch (e) {
    console.error('[DuckDB] GeoJSON import failed:', e);
  }
}

/**
 * Import a File object (CSV, JSON, GeoJSON) into DuckDB
 * @param file File object from file input or drag-and-drop
 * @param tableName Optional table name (defaults to filename without extension)
 */
export async function importFile(file: File, tableName?: string): Promise<void> {
  const name = tableName || file.name.replace(/\.[^.]+$/, '');
  const text = await file.text();

  if (file.name.endsWith('.geojson') || file.name.endsWith('.json')) {
    try {
      const geojson = JSON.parse(text) as GeoJSON.FeatureCollection;
      await importGeoJSON(geojson, name);
    } catch {
      // Try as regular JSON
      await importCSV(text, name);
    }
  } else {
    await importCSV(text, name);
  }
}

/**
 * Get all table names in the database
 */
export async function listTables(): Promise<string[]> {
  if (!initialized || !connection) return [];
  try {
    const result = await connection.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'");
    const tables: string[] = [];
    for (const batch of result.batches) {
      for (let i = 0; i < batch.numRows; i++) {
        tables.push(batch.getChild(0)?.get(i) as string);
      }
    }
    return tables;
  } catch {
    return [];
  }
}

/**
 * Get table schema (column names and types)
 */
export async function describeTable(tableName: string): Promise<Array<{ name: string; type: string }>> {
  if (!initialized || !connection) return [];
  try {
    const result = await connection.query(`DESCRIBE ${tableName}`);
    const columns: Array<{ name: string; type: string }> = [];
    for (const batch of result.batches) {
      for (let i = 0; i < batch.numRows; i++) {
        columns.push({
          name: batch.getChild('column_name')?.get(i) as string,
          type: batch.getChild('column_type')?.get(i) as string,
        });
      }
    }
    return columns;
  } catch {
    return [];
  }
}

/**
 * Perform spatial aggregation using H3
 * @param tableName Source table
 * @param latColumn Latitude column name
 * @param lonColumn Longitude column name
 * @param valueColumn Value column to aggregate
 * @param resolution H3 resolution (0-15)
 */
export async function h3Aggregate(
  tableName: string,
  latColumn: string,
  lonColumn: string,
  valueColumn: string,
  resolution: number = 5,
): Promise<Array<{ h3: string; count: number; sum: number; avg: number }>> {
  if (!initialized || !connection) return [];

  try {
    const sql = `
      SELECT
        h3_latlng_to_cell(${latColumn}, ${lonColumn}, ${resolution}) as h3,
        COUNT(*) as count,
        SUM(${valueColumn}) as sum,
        AVG(${valueColumn}) as avg
      FROM ${tableName}
      WHERE ${latColumn} IS NOT NULL AND ${lonColumn} IS NOT NULL
      GROUP BY h3
      ORDER BY count DESC
    `;
    return await queryDuckDB(sql);
  } catch {
    return [];
  }
}

/**
 * Calculate statistics for a numeric column
 */
export async function getColumnStats(
  tableName: string,
  columnName: string,
): Promise<{ count: number; mean: number; stddev: number; min: number; max: number; percentiles: Record<string, number> }> {
  if (!initialized || !connection) {
    return { count: 0, mean: 0, stddev: 0, min: 0, max: 0, percentiles: {} };
  }

  try {
    const sql = `
      SELECT
        COUNT(${columnName}) as count,
        AVG(${columnName}) as mean,
        STDDEV(${columnName}) as stddev,
        MIN(${columnName}) as min_val,
        MAX(${columnName}) as max_val,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${columnName}) as p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${columnName}) as p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${columnName}) as p75,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${columnName}) as p95
      FROM ${tableName}
      WHERE ${columnName} IS NOT NULL
    `;
    const result = await queryDuckDB(sql);
    if (result.length === 0) {
      return { count: 0, mean: 0, stddev: 0, min: 0, max: 0, percentiles: {} };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result[0] as any;
    return {
      count: Number(r.count),
      mean: Number(r.mean),
      stddev: Number(r.stddev),
      min: Number(r.min_val),
      max: Number(r.max_val),
      percentiles: {
        p25: Number(r.p25),
        p50: Number(r.p50),
        p75: Number(r.p75),
        p95: Number(r.p95),
      },
    };
  } catch {
    return { count: 0, mean: 0, stddev: 0, min: 0, max: 0, percentiles: {} };
  }
}

/**
 * Clean up DuckDB resources
 */
export async function closeDuckDB(): Promise<void> {
  if (connection) {
    await connection.close();
    connection = null;
  }
  if (duckdbInstance) {
    await duckdbInstance.terminate();
    duckdbInstance = null;
  }
  initialized = false;
}

export function isDuckDBReady(): boolean {
  return initialized;
}
