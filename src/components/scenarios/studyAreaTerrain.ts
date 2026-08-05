/**
 * studyAreaTerrain.ts — sample the real Cesium globe elevation for a drawn
 * study-area box, so a landslide can run on actual terrain (not synthetic).
 *
 * The sample is a square, row-major grid (row 0 = north, meters above the
 * WGS84 ellipsoid). The default is a modest 64×64 grid (~4k floats) for the
 * coarse pre-run context; the landslide run path samples at FULL resolution
 * (256×256 = the kernel's simulation grid, no bilinear loss) so the debris
 * flow runs on the exact ground the user picked.
 *
 * Returns `null` when the globe has no real elevation for the box (either no
 * Cesium ion token is configured or the terrain tiles haven't streamed yet) —
 * the caller keeps synthetic terrain in that case.
 */

import * as Cesium from 'cesium';
import type { StudyAreaBbox } from '@/services/kaggleSim';
import { deriveCenter, deriveExtentKm } from '@/services/kaggleSim';
import { buildGeoFrame, cellToLatLon } from '@/components/kaggle/gpu/fieldData';
import { sampleDomainTerrain } from '@/components/kaggle/gpu/terrain';

export interface StudyAreaTerrainSample {
  gs: number;
  values: number[];
}

export function sampleStudyAreaTerrain(
  viewer: Cesium.Viewer,
  bbox: StudyAreaBbox,
  terrainGs = 64,
): StudyAreaTerrainSample | null {
  const { lat, lon } = deriveCenter(bbox);
  const extentKm = deriveExtentKm(bbox);
  const cellSizeM = (extentKm * 1000) / terrainGs;
  const frame = buildGeoFrame(lat, lon, terrainGs, cellSizeM);

  const elev = sampleDomainTerrain({
    viewer,
    frame,
    outGs: terrainGs,
    coarseLimit: terrainGs,
    debugName: 'study-area',
  });

  // If every sample is ~0 (flat ellipsoid / unstreamed tiles) there is no real
  // relief to simulate on — bail so the kernel falls back to synthetic terrain.
  let peak = 0;
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] > peak) peak = elev[i];
  }
  if (!(peak > 1)) return null;

  return { gs: terrainGs, values: Array.from(elev) };
}

/**
 * Async full-resolution sampler for the Generate Scenario run path.
 *
 * At 256×256 the sync sampler issues 65,536 synchronous `globe.getHeight()`
 * lookups on the main thread, freezing the whole browser for seconds when the
 * button is clicked. This variant yields to the event loop every `chunkRows`
 * rows so the UI (camera, overlays, button feedback) stays responsive while
 * sampling. Same shape and null-on-no-relief semantics as the sync version.
 */
export async function sampleStudyAreaTerrainAsync(
  viewer: Cesium.Viewer,
  bbox: StudyAreaBbox,
  terrainGs = 64,
  chunkRows = 8,
): Promise<StudyAreaTerrainSample | null> {
  const { lat, lon } = deriveCenter(bbox);
  const extentKm = deriveExtentKm(bbox);
  const cellSizeM = (extentKm * 1000) / terrainGs;
  const frame = buildGeoFrame(lat, lon, terrainGs, cellSizeM);
  const globe = viewer.scene.globe;

  const maxIdx = Math.max(1, terrainGs - 1);
  const elev = new Float32Array(terrainGs * terrainGs);
  let peak = 0;

  for (let r = 0; r < terrainGs; r++) {
    const t = r / maxIdx;
    for (let c = 0; c < terrainGs; c++) {
      const s = c / maxIdx;
      const cell = cellToLatLon(frame, s * maxIdx, t * maxIdx);
      const carto = Cesium.Cartographic.fromDegrees(cell.lon, cell.lat);
      const h = globe.getHeight(carto);
      const v = h !== undefined && Number.isFinite(h) ? h : 0;
      elev[r * terrainGs + c] = v;
      if (v > peak) peak = v;
    }
    if (chunkRows > 0 && r % chunkRows === chunkRows - 1 && r < terrainGs - 1) {
      // Yield between row-chunks so the browser paints/stays responsive.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  if (!(peak > 1)) return null;
  return { gs: terrainGs, values: Array.from(elev) };
}