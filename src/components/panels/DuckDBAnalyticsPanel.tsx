import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Database, Upload, Play, Trash2, Table, BarChart3,
  ChevronRight, ChevronDown, AlertCircle, CheckCircle, Loader,
  FileSpreadsheet, MapPin, Search,
} from 'lucide-react';
import Panel from '@/components/ui/Panel';
import {
  initDuckDB, queryDuckDB, importFile, importCSV, importGeoJSON,
  listTables, describeTable, isDuckDBReady, closeDuckDB,
  getColumnStats,
} from '@/lib/duckdbAnalytics';

/* ═══════════════════════════════════════════════════════════════════════════
   DuckDB Analytics Panel — Client-Side SQL on CSV/GeoJSON
   ═══════════════════════════════════════════════════════════════════════════ */

interface TableInfo {
  name: string;
  columns: Array<{ name: string; type: string }>;
  rowCount?: number;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  durationMs: number;
  error?: string;
}

const SAMPLE_QUERIES = [
  { label: 'List tables', sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'" },
  { label: 'Count rows', sql: 'SELECT COUNT(*) AS total_rows FROM {table}' },
  { label: 'Schema', sql: 'DESCRIBE {table}' },
  { label: 'Sample data', sql: 'SELECT * FROM {table} LIMIT 10' },
  { label: 'Column stats', sql: 'SELECT MIN({col}) AS min_val, MAX({col}) AS max_val, AVG({col}) AS mean, COUNT(*) AS count FROM {table}' },
];

export default function DuckDBAnalyticsPanel({ onClose }: { onClose?: () => void }) {
  /* ── State ── */
  const [ready, setReady] = useState(isDuckDBReady());
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* ── Init DuckDB on mount ── */
  useEffect(() => {
    if (!ready) {
      setLoading(true);
      initDuckDB().then(() => {
        setReady(true);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [ready]);

  /* ── Refresh table list ── */
  const refreshTables = useCallback(async () => {
    const names = await listTables();
    const info: TableInfo[] = [];
    for (const name of names) {
      const cols = await describeTable(name);
      info.push({ name, columns: cols });
    }
    setTables(info);
  }, []);

  useEffect(() => {
    if (ready) refreshTables();
  }, [ready, refreshTables]);

  /* ── File import ── */
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setImporting(true);
    setImportMsg(null);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        setImportMsg(`Importing ${file.name}...`);
        await importFile(file);
      }
      setImportMsg(`Successfully imported ${files.length} file(s)`);
      await refreshTables();
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    } finally {
      setImporting(false);
      setTimeout(() => setImportMsg(null), 4000);
    }
  }, [refreshTables]);

  /* ── Drag-and-drop ── */
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  /* ── Execute SQL ── */
  const executeQuery = useCallback(async () => {
    if (!sql.trim()) return;
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const rows = await queryDuckDB(sql.trim());
      const durationMs = Math.round(performance.now() - start);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      setResult({ columns, rows, durationMs });
    } catch (e) {
      setResult({ columns: [], rows: [], durationMs: 0, error: (e as Error).message });
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sql]);

  /* ── Keyboard shortcut: Ctrl/Cmd+Enter to run ── */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
    }
  }, []);

  /* ── Load sample query ── */
  const loadSample = useCallback((template: string) => {
    let q = template;
    if (tables.length > 0) {
      q = q.replace('{table}', tables[0].name);
      if (tables[0].columns.length > 0) {
        const numCol = tables[0].columns.find(c => c.type.includes('INT') || c.type.includes('FLOAT') || c.type.includes('DOUBLE') || c.type.includes('NUMERIC'));
        q = q.replace('{col}', numCol?.name || tables[0].columns[0].name);
      }
    }
    setSql(q);
    textareaRef.current?.focus();
  }, [tables]);

  /* ── Delete table ── */
  const deleteTable = useCallback(async (name: string) => {
    try {
      await queryDuckDB(`DROP TABLE IF EXISTS ${name}`);
      await refreshTables();
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`);
    }
  }, [refreshTables]);

  /* ── Get column stats ── */
  const analyzeColumn = useCallback(async (table: string, column: string) => {
    setLoading(true);
    try {
      const stats = await getColumnStats(table, column);
      const sqlStr = `SELECT '${table}' AS table_name, '${column}' AS column_name, ${stats.count} AS count, ROUND(${stats.mean}, 4) AS mean, ROUND(${stats.stddev}, 4) AS stddev, ${stats.min} AS min_val, ${stats.max} AS max_val, ROUND(${stats.percentiles.p25}, 4) AS p25, ROUND(${stats.percentiles.p50}, 4) AS p50, ROUND(${stats.percentiles.p75}, 4) AS p75, ROUND(${stats.percentiles.p95}, 4) AS p95`;
      // Execute directly to avoid stale state
      const start = performance.now();
      const rows = await queryDuckDB(sqlStr);
      const durationMs = Math.round(performance.now() - start);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      setResult({ columns, rows, durationMs });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Render ── */
  return (
    <Panel
          title="DuckDB Analytics"
          icon={<Database size={16} />}
          accentColor="#8B5CF6"
          onClose={onClose}
          width={520}>
      <div
        style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* ── Drag overlay ── */}
        {dragOver && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'rgba(139, 92, 246, 0.15)', border: '2px dashed #8B5CF6',
            borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{ textAlign: 'center', color: '#c4b5fd' }}>
              <Upload size={40} style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 16, fontWeight: 600 }}>Drop CSV or GeoJSON files here</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Files will be imported as queryable tables</div>
            </div>
          </div>
        )}

        {/* ── Status bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 11,
        }}>
          {loading ? (
            <><Loader size={12} className="animate-spin" style={{ color: '#8B5CF6' }} /> <span style={{ color: '#94a3b8' }}>Processing...</span></>
          ) : ready ? (
            <><CheckCircle size={12} style={{ color: '#22c55e' }} /> <span style={{ color: '#94a3b8' }}>DuckDB ready · {tables.length} table{tables.length !== 1 ? 's' : ''}</span></>
          ) : (
            <><AlertCircle size={12} style={{ color: '#f59e0b' }} /> <span style={{ color: '#94a3b8' }}>Initializing DuckDB-WASM...</span></>
          )}
          {importMsg && (
            <span style={{ color: '#8B5CF6', marginLeft: 'auto', fontWeight: 500 }}>{importMsg}</span>
          )}
          {error && (
            <span style={{ color: '#ef4444', marginLeft: 'auto' }}>{error}</span>
          )}
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* ── Left: Table browser ── */}
          <div style={{
            width: 180, borderRight: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tables</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: 'none', border: 'none', color: '#8B5CF6', cursor: 'pointer',
                    padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center',
                  }}
                  title="Import file"
                >
                  <Upload size={14} />
                </button>
                <button
                  onClick={refreshTables}
                  style={{
                    background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer',
                    padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center',
                  }}
                  title="Refresh"
                >
                  <Search size={14} />
                </button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,.geojson,.tsv"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {tables.length === 0 && (
                <div style={{ padding: '16px 10px', fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                  <FileSpreadsheet size={24} style={{ margin: '0 auto 6px', opacity: 0.4 }} />
                  <div>No tables yet</div>
                  <div style={{ marginTop: 4 }}>Drag & drop files here</div>
                  <div>or click <Upload size={10} style={{ display: 'inline' }} /> to import</div>
                </div>
              )}
              {tables.map(t => (
                <div key={t.name}>
                  <div
                    onClick={() => setExpandedTable(expandedTable === t.name ? null : t.name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                      cursor: 'pointer', fontSize: 12, color: '#e2e8f0',
                      background: expandedTable === t.name ? 'rgba(139,92,246,0.08)' : 'transparent',
                    }}
                  >
                    {expandedTable === t.name ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Table size={12} style={{ color: '#8B5CF6', flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteTable(t.name); }}
                      style={{
                        background: 'none', border: 'none', color: '#64748b', cursor: 'pointer',
                        padding: 1, borderRadius: 2, display: 'flex', opacity: 0.6,
                      }}
                      title={`Drop table ${t.name}`}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                  {expandedTable === t.name && (
                    <div style={{ padding: '2px 0 4px 26px' }}>
                      {t.columns.map(c => (
                        <div
                          key={c.name}
                          onClick={() => analyzeColumn(t.name, c.name)}
                          style={{
                            fontSize: 10, color: '#94a3b8', padding: '1px 4px',
                            cursor: 'pointer', display: 'flex', gap: 6,
                            borderRadius: 3,
                          }}
                          title={`Analyze ${t.name}.${c.name}`}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139,92,246,0.08)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ color: '#c4b5fd' }}>{c.name}</span>
                          <span style={{ opacity: 0.5, marginLeft: 'auto' }}>{c.type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: SQL editor + results ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* ── SQL editor ── */}
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
              }}>
                <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SQL</span>
                <span style={{ fontSize: 10, color: '#475569' }}>⌘+Enter to run</span>
                <button
                  onClick={executeQuery}
                  disabled={loading || !sql.trim()}
                  style={{
                    marginLeft: 'auto', background: '#8B5CF6', color: 'white',
                    border: 'none', borderRadius: 4, padding: '3px 10px',
                    fontSize: 11, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
                    opacity: loading || !sql.trim() ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Play size={11} /> Run
                </button>
              </div>
              <textarea
                ref={textareaRef}
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="SELECT * FROM table_name LIMIT 10"
                spellCheck={false}
                style={{
                  width: '100%', minHeight: 64, maxHeight: 120, resize: 'vertical',
                  background: 'rgba(0,0,0,0.2)', color: '#e2e8f0',
                  border: 'none', outline: 'none', padding: '6px 10px',
                  fontFamily: 'JetBrains Mono, Fira Code, monospace', fontSize: 12,
                  lineHeight: 1.5,
                }}
              />
              {/* ── Quick queries ── */}
              <div style={{ display: 'flex', gap: 4, padding: '4px 8px', flexWrap: 'wrap' }}>
                {SAMPLE_QUERIES.map(s => (
                  <button
                    key={s.label}
                    onClick={() => loadSample(s.sql)}
                    style={{
                      background: 'rgba(139,92,246,0.1)', color: '#c4b5fd',
                      border: '1px solid rgba(139,92,246,0.2)', borderRadius: 4,
                      padding: '2px 6px', fontSize: 10, cursor: 'pointer',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Results ── */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {result?.error ? (
                <div style={{ padding: 12, color: '#ef4444', fontSize: 12, fontFamily: 'monospace' }}>
                  {result.error}
                </div>
              ) : result ? (
                <div>
                  <div style={{
                    padding: '4px 10px', fontSize: 10, color: '#64748b',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', gap: 12,
                  }}>
                    <span>{result.rows.length} row{result.rows.length !== 1 ? 's' : ''}</span>
                    <span>{result.columns.length} column{result.columns.length !== 1 ? 's' : ''}</span>
                    <span>{result.durationMs}ms</span>
                  </div>
                  {result.rows.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{
                        width: '100%', borderCollapse: 'collapse', fontSize: 11,
                      }}>
                        <thead>
                          <tr>
                            {result.columns.map(col => (
                              <th key={col} style={{
                                padding: '4px 8px', textAlign: 'left',
                                color: '#8B5CF6', fontWeight: 600,
                                borderBottom: '1px solid rgba(139,92,246,0.3)',
                                whiteSpace: 'nowrap', fontSize: 10,
                                textTransform: 'uppercase', letterSpacing: '0.03em',
                              }}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i} style={{
                              background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                            }}>
                              {result.columns.map(col => (
                                <td key={col} style={{
                                  padding: '3px 8px', color: '#cbd5e1',
                                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                                  maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11,
                                }}>
                                  {row[col] == null ? <span style={{ color: '#475569' }}>null</span> : String(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {result.rows.length === 0 && (
                    <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
                      Query returned no results
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  padding: 30, textAlign: 'center', color: '#475569', fontSize: 12,
                }}>
                  <BarChart3 size={28} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                  <div>Write a SQL query and press Run</div>
                  <div style={{ marginTop: 4, fontSize: 11 }}>or drop a CSV/GeoJSON file to get started</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
