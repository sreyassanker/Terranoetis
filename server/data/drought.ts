/**
 * NOAA PSL Dai Self-Calibrated PDSI Client
 * ── Palmer Drought Severity Index (Dai 2011) ──
 *
 * Fetches monthly self-calibrated Palmer Drought Severity Index (scPDSI)
 * from the NOAA Physical Sciences Laboratory OPeNDAP server.
 *
 * Dataset: pdsi.mon.mean.selfcalibrated.nc
 *   Lat: 55 values (88.75°N to -88.75°N, 2.5°)
 *   Lon: 144 values (0° to 357.5°E, 2.5°)
 *   Time: monthly from 1850-01 to ~2018-12
 *   Units: standardized (typically -8 to +8)
 *
 * scPDSI interpretation:
 *   > +4  = extreme wet
 *   +2 to +4  = moderate wet
 *   -2 to +2  = near normal
 *   -4 to -2  = moderate drought
 *   < -4  = extreme drought
 *
 * Access: NOAA PSL OPeNDAP (no auth required).
 */

import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

const OPeNDAP_BASE = 'https://psl.noaa.gov/thredds/dodsC/Datasets/dai_pdsi';

export interface DroughtDataPoint {
  /** Self-calibrated PDSI value */
  scPDSI: number | null;
  /** Drought class string based on scPDSI */
  droughtClass: string;
  /** Date of the data (YYYY-MM) */
  date: string | null;
  /** Source identifier */
  source: string | null;
}

function classifyPDSI(pdsi: number): string {
  if (pdsi > 4) return 'extreme wet';
  if (pdsi > 2) return 'moderate wet';
  if (pdsi >= -2) return 'near normal';
  if (pdsi >= -4) return 'moderate drought';
  return 'extreme drought';
}

function latToNearest(lat: number, grid: number[]): number {
  let best = 0;
  let minDist = Infinity;
  for (let i = 0; i < grid.length; i++) {
    const d = Math.abs(grid[i] - lat);
    if (d < minDist) { minDist = d; best = i; }
  }
  return best;
}

function lonToNearest(lon: number, grid: number[]): number {
  // The PDSI grid spans -180…178.75°E. Wrap inputs given in 0–360 form.
  let lonW = lon;
  if (lonW > 180) lonW -= 360;
  return latToNearest(lonW, grid);
}

/**
 * Fetch monthly scPDSI at a lat/lon point.
 * Returns the most recent available month.
 */
export async function fetchDroughtPDSI(
  lat: number,
  lon: number,
): Promise<DroughtDataPoint> {
  const cacheKey = `pdsi:${Math.round(lat * 10)}:${Math.round(lon * 10)}`;
  const cached = cache.get<DroughtDataPoint>(cacheKey);
  if (cached) return cached;

  try {
    // First fetch the lat/lon grids to find nearest indices
    const latLonUrl = `${OPeNDAP_BASE}/pdsi.mon.mean.selfcalibrated.nc.ascii?lat,lon`;
    const resp = await fetch(latLonUrl, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return { scPDSI: null, droughtClass: 'unknown', date: null, source: null };

    const text = await resp.text();
    const lines = text.trim().split('\n');

    // DODS ASCII layout: header line (e.g. "lat[55]") followed by a
    // comma-separated value list on the next non-empty line.
    const findGrid = (prefix: string): number[] => {
      const idx = lines.findIndex(l => l.trim().startsWith(prefix));
      if (idx < 0) return [];
      for (let i = idx + 1; i < lines.length; i++) {
        const nums = lines[i].split(',').map(Number).filter((n): n is number => !isNaN(n));
        if (nums.length > 0) return nums;
      }
      return [];
    };

    const latGrid = findGrid('lat');
    const lonGrid = findGrid('lon');

    if (latGrid.length === 0 || lonGrid.length === 0) {
      return { scPDSI: null, droughtClass: 'unknown', date: null, source: null };
    }

    const li = latToNearest(lat, latGrid);
    const lj = lonToNearest(lon, lonGrid);

    // Get the last 12 months and find the most recent valid
    const dataUrl = `${OPeNDAP_BASE}/pdsi.mon.mean.selfcalibrated.nc.ascii?pdsi[1968:1:1979][${li}:1:${li}][${lj}:1:${lj}],time[1968:1:1979]`;
    const dataResp = await fetch(dataUrl, { signal: AbortSignal.timeout(15000) });
    if (!dataResp.ok) {
      return { scPDSI: null, droughtClass: 'unknown', date: null, source: null };
    }

    const dataText = await dataResp.text();
    const dataLines = dataText.trim().split('\n');

    // Parse the DAP ASCII response. The data block is headed by a
    // descriptor line (e.g. "pdsi.pdsi[12][1][1]") followed by one
    // comma-separated value line per time step ("[i][0], value").
    const collectValues = (prefix: string): number[] => {
      const start = dataLines.findIndex(l => l.trim().startsWith(prefix));
      if (start < 0) return [];
      const out: number[] = [];
      // Per-step format: "[i][0], value" — one line per step.
      const stepRe = /\[(\d+)\]\[0\],\s*(-?[\d.eE+-]+)/;
      // Inline format: "val, val, ..." on the next non-empty line.
      for (let i = start + 1; i < dataLines.length; i++) {
        const line = dataLines[i].trim();
        if (line === '' || line.startsWith('Dataset') || line.startsWith('} ')) break;
        const m = line.match(stepRe);
        if (m) {
          const v = Number(m[2]);
          if (Number.isFinite(v)) out[Number(m[1])] = v;
        } else if (line.startsWith('[') === false) {
          const nums = line.split(',').map(Number);
          nums.forEach((v, k) => { if (Number.isFinite(v)) out[k] = v; });
          break;
        }
      }
      return out;
    };

    const pdsiValues = collectValues('pdsi.pdsi');
    const timeValues = collectValues('pdsi.time');

    if (pdsiValues.length === 0) {
      return { scPDSI: null, droughtClass: 'unknown', date: null, source: null };
    }

    // Find most recent valid PDSI value
    let recentPDSI: number | null = null;
    let recentTime: number | null = null;

    for (let i = pdsiValues.length - 1; i >= 0; i--) {
      if (Number.isFinite(pdsiValues[i]) && Math.abs(pdsiValues[i]) < 100) {
        recentPDSI = pdsiValues[i];
        recentTime = timeValues[i] ?? null;
        break;
      }
    }

    if (recentPDSI == null) {
      return { scPDSI: null, droughtClass: 'unknown', date: null, source: null };
    }

    // Convert time (hours since 1800-01-01) to YYYY-MM
    let dateStr: string | null = null;
    if (recentTime != null) {
      const EPOCH_1800_MS = Date.UTC(1800, 0, 1);
      const date = new Date(EPOCH_1800_MS + recentTime * 3600000);
      dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    const result: DroughtDataPoint = {
      scPDSI: Math.round(recentPDSI * 100) / 100,
      droughtClass: classifyPDSI(recentPDSI),
      date: dateStr,
      source: 'noaa-psl-dai-scpdsi',
    };

    cache.set(cacheKey, result);
    return result;
  } catch {
    return { scPDSI: null, droughtClass: 'unknown', date: null, source: null };
  }
}
