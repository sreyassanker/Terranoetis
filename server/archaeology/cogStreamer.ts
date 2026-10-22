import { fromUrl } from 'geotiff';
import type { StudyAreaBoundingBox } from './types';

const FETCH_TIMEOUT_MS = 12000;

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Standard WGS84 Universal Transverse Mercator (UTM) forward projection.
 * Projects (lat, lon) in degrees to planar easting and northing in meters.
 */
export function latLonToUtm(lat: number, lon: number, forcedZone?: number): { easting: number; northing: number; zone: number } {
  const a = 6378137.0; // WGS84 major axis
  const f = 1 / 298.257223563; // WGS84 flattening
  const e2 = 2 * f - f * f;
  const ePrime2 = e2 / (1 - e2);

  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  const zone = forcedZone || Math.floor((lon + 180) / 6) + 1;
  const lonOrigin = (zone - 1) * 6 - 180 + 3; // Central meridian
  const lonOriginRad = (lonOrigin * Math.PI) / 180;

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = ePrime2 * Math.cos(latRad) * Math.cos(latRad);
  const A = Math.cos(latRad) * (lonRad - lonOriginRad);

  const M = a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * latRad
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * latRad)
    + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * latRad)
    - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * latRad)
  );

  const k0 = 0.9996;
  const x = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ePrime2) * Math.pow(A, 5) / 120) + 500000.0;
  let y = k0 * (M + N * Math.tan(latRad) * (Math.pow(A, 2) / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ePrime2) * Math.pow(A, 6) / 720));
  if (lat < 0) y += 10000000.0; // False northing for southern hemisphere

  return { easting: x, northing: y, zone };
}

/**
 * Signs an Azure Blob asset URL using Microsoft Planetary Computer SAS token service.
 */
export async function signPlanetaryComputerUrl(assetHref: string): Promise<string> {
  try {
    const signUrl = `https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(assetHref)}`;
    const resp = await fetchWithTimeout(signUrl, {}, 6000);
    if (!resp.ok) return assetHref;
    const data = await resp.json();
    return data.href || assetHref;
  } catch {
    return assetHref;
  }
}

export interface WindowedRasterResult {
  data: Float32Array;
  width: number;
  height: number;
  pixelSpacingM: number;
}

/**
 * Streams only the required study area sub-window from a Cloud-Optimized GeoTIFF
 * using HTTP Range requests. Never downloads the entire scene.
 */
export async function readCogWindow(
  assetHref: string,
  bbox: StudyAreaBoundingBox,
  zoneNumber?: number,
): Promise<WindowedRasterResult | null> {
  try {
    const signedUrl = await signPlanetaryComputerUrl(assetHref);
    const tiff = await fromUrl(signedUrl);
    const image = await tiff.getImage();
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const imgWidth = image.getWidth();
    const imgHeight = image.getHeight();

    // Determine projected UTM coordinates of bounding box
    const utmMin = latLonToUtm(bbox.latMin, bbox.lonMin, zoneNumber);
    const utmMax = latLonToUtm(bbox.latMax, bbox.lonMax, utmMin.zone);

    // Compute pixel window
    const resX = Math.abs(resolution[0]) || 10;
    const resY = Math.abs(resolution[1]) || 10;

    const col0 = Math.max(0, Math.min(imgWidth - 1, Math.floor((utmMin.easting - origin[0]) / resX)));
    const col1 = Math.max(1, Math.min(imgWidth, Math.ceil((utmMax.easting - origin[0]) / resX)));
    const row0 = Math.max(0, Math.min(imgHeight - 1, Math.floor((origin[1] - utmMax.northing) / resY)));
    const row1 = Math.max(1, Math.min(imgHeight, Math.ceil((origin[1] - utmMin.northing) / resY)));

    const minCol = Math.min(col0, col1);
    const maxCol = Math.max(col0, col1);
    const minRow = Math.min(row0, row1);
    const maxRow = Math.max(row0, row1);

    const winWidth = maxCol - minCol;
    const winHeight = maxRow - minRow;

    if (winWidth <= 0 || winHeight <= 0) return null;

    // Stream the sub-window via HTTP Range request
    const rasters = await image.readRasters({
      window: [minCol, minRow, maxCol, maxRow],
    });

    const rawArray = rasters[0];
    if (!rawArray || rawArray.length === 0) return null;

    // Convert to Float32Array
    const floatData = new Float32Array(rawArray.length);
    for (let i = 0; i < rawArray.length; i++) {
      floatData[i] = Number(rawArray[i]);
    }

    return {
      data: floatData,
      width: winWidth,
      height: winHeight,
      pixelSpacingM: resX,
    };
  } catch (err) {
    console.warn('[COG-Streamer] Sub-window read failed:', (err as Error).message);
    return null;
  }
}
