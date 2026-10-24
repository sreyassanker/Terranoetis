// Shared chart helpers for analytical-tool results (non-component module so
// the Q1-journal style helpers are unit-testable without React fast-refresh).

export interface ToolSeries {
  label: string;
  points: Array<{ x: number; y: number }>;
  color?: string;
  /** Optional X-axis title override (e.g. "Radial distance r (m)" for the
   *  Thiem drawdown profile instead of the generic "Depth / Height"). When
   *  absent the renderer falls back to the per-vizType default label. */
  xLabel?: string;
  /** When true the X axis uses a log10 scale (physically correct for
   *  log-spaced x data such as the Thiem radial distance sweep). */
  logX?: boolean;
}

// Q1-journal / colour-blind-safe palette (Okabe-Ito): high contrast, print-safe.
export const CHART_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#F0E442', '#000000'];

/**
 * Merge multiple series into a single chart-data array where each element
 * has { x, y0, y1, ... } so recharts can draw multiple lines from one data
 * array (the chart-level data). Non-finite y values are dropped; genuine
 * zeros are preserved.
 */
export function mergeSeries(series: ToolSeries[]): { data: Record<string, number>[]; keys: string[] } {
  if (!series || !Array.isArray(series) || series.length === 0) {
    return { data: [], keys: [] };
  }
  const validSeries = series.filter(s => s && Array.isArray(s.points));
  if (validSeries.length === 0) {
    return { data: [], keys: [] };
  }
  const xSet = new Set<number>();
  for (const s of validSeries) {
    for (const p of s.points) {
      if (p && typeof p.x === 'number' && Number.isFinite(p.x)) {
        xSet.add(p.x);
      }
    }
  }
  const xSorted = [...xSet].sort((a, b) => a - b);
  const lookups = validSeries.map(s => {
    const m = new Map<number, number>();
    for (const p of s.points) {
      if (p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.y)) {
        m.set(p.x, p.y);
      }
    }
    return m;
  });
  const keys = validSeries.map((_, i) => `y${i}`);
  const data = xSorted.map(x => {
    const row: Record<string, number> = { x };
    for (let i = 0; i < validSeries.length; i++) {
      const y = lookups[i].get(x);
      row[keys[i]] = y != null && Number.isFinite(y) ? y : 0;
    }
    return row;
  });
  return { data, keys };
}
