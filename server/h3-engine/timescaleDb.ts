interface TimescaleH3Config {
  connectionString: string;
  schema?: string;
}

interface H3Event {
  h3: string;
  time: Date;
  data: Record<string, unknown>;
  type?: string;
}

export class TimescaleH3 {
  private config: TimescaleH3Config;
  private mockStore: Map<string, H3Event[]> = new Map();
  private hypertables: Set<string> = new Set();

  constructor(config: string | TimescaleH3Config) {
    this.config = typeof config === 'string'
      ? { connectionString: config }
      : config;
  }

  private getSchema(): string {
    return this.config.schema || 'public';
  }

  async createHypertable(
    tableName: string,
    h3Column: string = 'h3',
    timeColumn: string = 'time',
  ): Promise<void> {
    if (this.hypertables.has(tableName)) return;
    this.hypertables.add(tableName);
    const schema = this.getSchema();
    const ddl = `
      CREATE TABLE IF NOT EXISTS ${schema}."${tableName}" (
        id UUID DEFAULT gen_random_uuid(),
        "${h3Column}" TEXT NOT NULL,
        "${timeColumn}" TIMESTAMPTZ NOT NULL,
        data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (id, "${timeColumn}")
      );
      SELECT create_hypertable('${schema}."${tableName}"', '${timeColumn}', if_not_exists => TRUE);
    `;
    console.log(`[TimescaleH3] hypertable DDL:\n${ddl}`);
  }

  async insertEvent(
    tableName: string,
    event: H3Event,
  ): Promise<void> {
    const existing = this.mockStore.get(tableName) || [];
    existing.push(event);
    this.mockStore.set(tableName, existing);
  }

  async insertBatch(tableName: string, events: H3Event[]): Promise<void> {
    const existing = this.mockStore.get(tableName) || [];
    existing.push(...events);
    this.mockStore.set(tableName, existing);
  }

  async queryEvents(
    h3Index: string,
    timeRange: [Date, Date],
    type?: string,
  ): Promise<H3Event[]> {
    const table = this.mockStore.get('events') || this.mockStore.get('default') || [];
    const [start, end] = timeRange;
    return table.filter(e => {
      if (e.h3 !== h3Index) return false;
      if (e.time < start || e.time > end) return false;
      if (type && e.type !== type) return false;
      return true;
    });
  }

  async queryByRegion(
    h3Indices: string[],
    timeRange: [Date, Date],
  ): Promise<H3Event[]> {
    const h3Set = new Set(h3Indices);
    const allEvents = Array.from(this.mockStore.values()).flat();
    const [start, end] = timeRange;
    return allEvents.filter(e => h3Set.has(e.h3) && e.time >= start && e.time <= end);
  }

  async continuousAggregate(
    viewName: string,
    h3Res: number,
    tableName: string = 'events',
  ): Promise<void> {
    const schema = this.getSchema();
    const ddl = `
      CREATE MATERIALIZED VIEW IF NOT EXISTS ${schema}."${viewName}"
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 hour', time) AS bucket,
        LEFT(h3, ${h3Res}) AS h3_res,
        COUNT(*) AS event_count,
        AVG((data->>'value')::numeric) AS avg_value
      FROM ${schema}."${tableName}"
      GROUP BY bucket, h3_res
      WITH NO DATA;
    `;
    console.log(`[TimescaleH3] continuous aggregate DDL:\n${ddl}`);
  }

  async getStats(): Promise<{
    hypertables: number;
    totalEvents: number;
    oldestEvent: Date | null;
    newestEvent: Date | null;
  }> {
    const allEvents = Array.from(this.mockStore.values()).flat();
    const times = allEvents.map(e => e.time).sort((a, b) => a.getTime() - b.getTime());
    return {
      hypertables: this.hypertables.size,
      totalEvents: allEvents.length,
      oldestEvent: times.length > 0 ? times[0] : null,
      newestEvent: times.length > 0 ? times[times.length - 1] : null,
    };
  }

  async createIndexes(tableName: string): Promise<void> {
    const schema = this.getSchema();
    const indexes = `
      CREATE INDEX IF NOT EXISTS idx_${tableName}_h3 ON ${schema}."${tableName}" (h3);
      CREATE INDEX IF NOT EXISTS idx_${tableName}_type ON ${schema}."${tableName}" ((data->>'type'));
      CREATE INDEX IF NOT EXISTS idx_${tableName}_time ON ${schema}."${tableName}" (time DESC);
    `;
    console.log(`[TimescaleH3] indexes:\n${indexes}`);
  }

  async createRetentionPolicy(
    tableName: string,
    intervalDays: number = 90,
  ): Promise<void> {
    const ddl = `
      SELECT add_retention_policy('${tableName}', INTERVAL '${intervalDays} days');
    `;
    console.log(`[TimescaleH3] retention policy:\n${ddl}`);
  }

  async compressChunks(tableName: string): Promise<void> {
    const ddl = `
      ALTER TABLE ${tableName} SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'h3'
      );
      SELECT add_compression_policy('${tableName}', INTERVAL '7 days');
    `;
    console.log(`[TimescaleH3] compression:\n${ddl}`);
  }

  async reorderChunks(tableName: string): Promise<void> {
    const ddl = `
      SELECT add_reorder_policy('${tableName}', '${tableName}_h3_time_idx');
    `;
    console.log(`[TimescaleH3] reorder policy:\n${ddl}`);
  }

  async close(): Promise<void> {
    this.mockStore.clear();
    this.hypertables.clear();
  }
}
