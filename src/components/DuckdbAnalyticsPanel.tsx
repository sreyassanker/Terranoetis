/**
 * DuckDB Spatial Analytics Panel — run real SQL over the platform's live
 * data layers in the browser. Loads earthquakes, flights, satellites, radio,
 * CCTV, weather alerts, EONET and GDACS into in-memory DuckDB tables and
 * executes user queries (filter, aggregate, join, export).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, Play, RefreshCw, Table2, TerminalSquare, X } from 'lucide-react';
import { runQuery, listTables, type QueryResult } from '@/lib/duckdbAnalytics';
import { loadAllLayers, type LoadResult } from '@/lib/duckdbLoader';

interface DuckdbAnalyticsPanelProps {
  open: boolean;
  onClose: () => void;
  zIndex?: number;
}

const SAMPLE_QUERIES = [
  'SELECT event, severity, COUNT(*) AS n FROM weather_alerts GROUP BY event, severity ORDER BY n DESC LIMIT 20',
  'SELECT place, mag FROM earthquakes WHERE mag >= 5 ORDER BY mag DESC LIMIT 20',
  'SELECT callsign, origin, ROUND(velocity) AS kts FROM flights WHERE velocity > 400 ORDER BY velocity DESC LIMIT 20',
  "SELECT name, ROUND(altitude/1000) AS km, inclination FROM satellites WHERE inclination BETWEEN 45 AND 60 LIMIT 20",
  'SELECT lat, lon, mag FROM earthquakes WHERE lat BETWEEN 30 AND 40 AND lon BETWEEN -110 AND -90',
  'SELECT COUNT(*) AS flights_near_austin FROM flights WHERE ABS(lat-30.27) < 1 AND ABS(lon+97.74) < 1',
];

export function DuckdbAnalyticsPanel({ open, onClose, zIndex = 110 }: DuckdbAnalyticsPanelProps) {
  const [loadSummary, setLoadSummary] = useState<LoadResult[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'done'>('idle');
  const refreshToken = useRef(0);

  const refreshTables = useCallback(async () => {
    try { setTables(await listTables()); } catch { setTables([]); }
  }, []);

  const doLoad = useCallback(async () => {
    setLoadState('loading');
    try {
      const summary = await loadAllLayers();
      setLoadSummary(summary);
    } catch {
      setLoadSummary([]);
    }
    setLoadState('done');
    await refreshTables();
  }, [refreshTables]);

  useEffect(() => {
    if (!open) return;
    const token = ++refreshToken.current;
    void doLoad();
    return () => { refreshToken.current = token; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (sql === '' && SAMPLE_QUERIES.length > 0) setSql(SAMPLE_QUERIES[0]);
  }, [open, sql]);

  const doQuery = useCallback(async () => {
    if (!sql.trim()) return;
    setLoading(true);
    const r = await runQuery(sql);
    setResult(r);
    setLoading(false);
  }, [sql]);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 90, width: 720, maxWidth: 'calc(100vw - 32px)',
      background: 'rgba(10,12,28,0.94)', backdropFilter: 'blur(18px)',
      border: '1px solid rgba(139,92,246,0.3)', borderRadius: 12, zIndex,
      boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', maxHeight: '70vh',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(139,92,246,0.15)', background: 'rgba(139,92,246,0.08)' }}>
        <Database size={15} color="#a78bfa" />
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>DuckDB Spatial SQL</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }} title="Close"><X size={14} /></button>
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', flex: 1 }}>
        {/* Layer load status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={doLoad} disabled={loadState === 'loading'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.15)', color: '#a78bfa', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
            <RefreshCw size={12} className={loadState === 'loading' ? 'animate-spin' : ''} /> {loadState === 'loading' ? 'Loading real data…' : 'Reload layers'}
          </button>
          <span style={{ fontSize: 10, color: '#64748b' }}>{loadSummary.filter(s => !s.error).length}/{loadSummary.length} layers loaded</span>
        </div>
        {loadSummary.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {loadSummary.map((s) => (
              <div key={s.id} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: s.error ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', border: `1px solid ${s.error ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, color: s.error ? '#f87171' : '#4ade80' }}>
                {s.label}: {s.rows.toLocaleString()} rows
              </div>
            ))}
          </div>
        )}

        {/* Tables */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Table2 size={12} color="#64748b" />
          <span style={{ fontSize: 11, color: '#94a3b8' }}>Tables:</span>
          {tables.length === 0 && <span style={{ fontSize: 11, color: '#64748b' }}>none yet</span>}
          {tables.map((t) => (
            <button key={t} onClick={() => setSql(`SELECT * FROM "${t}" LIMIT 50`)}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(148,163,184,0.3)', background: 'rgba(148,163,184,0.08)', color: '#94a3b8', cursor: 'pointer' }}>
              {t}
            </button>
          ))}
        </div>

        {/* SQL editor */}
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doQuery(); }}
          placeholder="SELECT event, severity, COUNT(*) FROM weather_alerts GROUP BY event, severity ORDER BY 3 DESC"
          style={{
            width: '100%', minHeight: 90, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
            background: 'rgba(0,0,0,0.35)', color: '#d4d4d8', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 8, padding: 10, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={doQuery} disabled={loading || !sql.trim()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', cursor: loading ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
            <Play size={12} /> {loading ? 'Running…' : 'Run Query'} <span style={{ opacity: 0.6, fontSize: 10 }}>(⌘↵)</span>
          </button>
          <TerminalSquare size={12} color="#64748b" />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {SAMPLE_QUERIES.map((q, i) => (
              <button key={i} onClick={() => setSql(q)} title={q}
                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(148,163,184,0.25)', background: 'none', color: '#64748b', cursor: 'pointer' }}>
                Q{i + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Result */}
        {result && (
          <div style={{ border: '1px solid rgba(139,92,246,0.2)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '6px 10px', fontSize: 11, color: result.error ? '#f87171' : '#4ade80', background: result.error ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)', borderBottom: '1px solid rgba(139,92,246,0.15)' }}>
              {result.error ? `Error: ${result.error}` : `${result.rowCount.toLocaleString()} rows in ${result.timeMs.toFixed(0)} ms`}
            </div>
            {!result.error && result.columns.length > 0 && (
              <div style={{ maxHeight: 220, overflow: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: 'rgba(139,92,246,0.12)' }}>
                      {result.columns.map((c) => (
                        <th key={c} style={{ textAlign: 'left', padding: '5px 8px', color: '#a78bfa', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(139,92,246,0.2)' }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 200).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                        {result.columns.map((c) => (
                          <td key={c} style={{ padding: '4px 8px', color: '#cbd5e1', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {String(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}