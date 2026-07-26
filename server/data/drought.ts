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
  // Normalize lon to [0, 360) for PDSI grid
  const lon360 = ((lon % 360) + 360) % 360;
  return latToNearest(lon360, grid);
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
    const latLine = lines.find(l => l.startsWith('lat'));
    const lonLine = lines.find(l => l.startsWith('lon'));

    if (!latLine || !lonLine) {
      return { scPDSI: null, droughtClass: 'unknown', date: null, source: null };
    }

    const latGrid = latLine.split(',').slice(1).map(Number).filter(n => !isNaN(n));
    const lonGrid = lonLine.split(',').slice(1).map(Number).filter(n => !isNaN(n));

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

    // Parse the DAP ASCII response — find the pdsi and time lines
    const pdsiLine = dataLines.find(l => l.startsWith('pdsi'));
    const timeLine = dataLines.find(l => l.startsWith('time'));

    if (!pdsiLine || !timeLine) {
      return { scPDSI: null, droughtClass: 'unknown', date: null, source: null };
    }

    const pdsiValues = pdsiLine.split(',').slice(1).map(Number).filter(n => !isNaN(n));
    const timeValues = timeLine.split(',').slice(1).map(Number).filter(n => !isNaN(n));

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
      const date = new Date((recentTime - 0) * 3600000);
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
