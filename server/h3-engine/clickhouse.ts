export interface ClickhouseH3Config {
  host: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
}

interface H3MetricEvent {
  h3: string;
  time: Date;
  metric: string;
  value: number;
  tags?: Record<string, string>;
}

export class ClickhouseH3 {
  private config: ClickhouseH3Config;
  private tables: Set<string> = new Set();
  private mockStore: Map<string, H3MetricEvent[]> = new Map();

  constructor(config: string | ClickhouseH3Config) {
    this.config = typeof config === 'string'
      ? { host: config, port: 8123 }
      : config;
  }

  getDatabase(): string {
    return this.config.database || 'default';
  }

  async createTable(tableName: string): Promise<void> {
    if (this.tables.has(tableName)) return;
    this.tables.add(tableName);
    const db = this.getDatabase();
    const ddl = `
      CREATE TABLE IF NOT EXISTS ${db}.${tableName}
      (
        h3 String,
        time DateTime,
        metric String,
        value Float64,
        tags Map(String, String) DEFAULT {}
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(time)
      ORDER BY (h3, time);
    `;
    console.log(`[ClickhouseH3] table DDL:\n${ddl}`);
  }

  async insertBatch(tableName: string, events: H3MetricEvent[]): Promise<void> {
    const existing = this.mockStore.get(tableName) || [];
    existing.push(...events);
    this.mockStore.set(tableName, existing);
  }

  async insertEvent(tableName: string, event: H3MetricEvent): Promise<void> {
    const existing = this.mockStore.get(tableName) || [];
    existing.push(event);
    this.mockStore.set(tableName, existing);
  }

  async queryH3(
    h3Index: string,
    metric: string,
    timeRange?: [Date, Date],
  ): Promise<{ h3: string; metric: string; avg: number; min: number; max: number; count: number }> {
    const table = this.mockStore.get('metrics') || [];
    const filtered = table.filter(e =>
      e.h3 === h3Index && e.metric === metric &&
      (!timeRange || (e.time >= timeRange[0] && e.time <= timeRange[1]))
    );
    if (filtered.length === 0) {
      return { h3: h3Index, metric, avg: 0, min: 0, max: 0, count: 0 };
    }
    const values = filtered.map(e => e.value);
    return {
      h3: h3Index,
      metric,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    };
  }

  async queryByRegion(
    h3Indices: string[],
    metric: string,
    timeRange?: [Date, Date],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const h3 of h3Indices) {
      const q = await this.queryH3(h3, metric, timeRange);
      result.set(h3, q.avg);
    }
    return result;
  }

  async materializedView(
    viewName: string,
    selectQuery: string,
    tableName?: string,
  ): Promise<void> {
    const db = this.getDatabase();
    const target = tableName || viewName.replace('_view', '');
    const ddl = `
      CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.${viewName}
      TO ${db}.${target}_mv
      AS ${selectQuery};
    `;
    console.log(`[ClickhouseH3] materialized view DDL:\n${ddl}`);
  }

  async queryRaw(sql: string): Promise<unknown> {
    const trimmed = sql.trim().toLowerCase();
    if (trimmed.startsWith('select count')) {
      return [{ count: Array.from(this.mockStore.values()).flat().length }];
    }
    return [{ result: 'mock' }];
  }

  async close(): Promise<void> {
    this.mockStore.clear();
    this.tables.clear();
  }
}
