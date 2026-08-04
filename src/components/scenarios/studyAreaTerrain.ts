/**
 * studyAreaTerrain.ts — sample the real Cesium globe elevation for a drawn
 * study-area box, so a landslide can run on actual terrain (not synthetic).
 *
 * The sample is a square, row-major grid (row 0 = north, meters above the
 * WGS84 ellipsoid) at a modest resolution (default 64×64) that is bilinearly
 * upsampled by the kernel to the simulation grid size — this keeps the wired
 * payload small (~4k floats) while preserving the region's slopes/relief.
 *
 * Returns `null` when the globe has no real elevation for the box (either no
 * Cesium ion token is configured or the terrain tiles haven't streamed yet) —
 * the caller keeps synthetic terrain in that case.
 */

import * as Cesium from 'cesium';
import type { StudyAreaBbox } from '@/services/kaggleSim';
import { deriveCenter, deriveExtentKm } from '@/services/kaggleSim';
import { buildGeoFrame } from '@/components/kaggle/gpu/fieldData';
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