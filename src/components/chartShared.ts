// Shared chart helpers for analytical-tool results (non-component module so
// the Q1-journal style helpers are unit-testable without React fast-refresh).

export interface ToolSeries {
  label: string;
  points: Array<{ x: number; y: number }>;
  color?: string;
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
  const xSet = new Set<number>();
  for (const s of series) for (const p of s.points) xSet.add(p.x);
  const xSorted = [...xSet].sort((a, b) => a - b);
  const lookups = series.map(s => {
    const m = new Map<number, number>();
    for (const p of s.points) m.set(p.x, p.y);
    return m;
  });
  const keys = series.map((_, i) => `y${i}`);
  const data = xSorted.map(x => {
    const row: Record<string, number> = { x: Number.isFinite(x) ? x : 0 };
    for (let i = 0; i < series.length; i++) {
      const y = lookups[i].get(x);
      row[keys[i]] = y != null && Number.isFinite(y) ? y : 0;
    }
    return row;
  });
  return { data, keys };
}
