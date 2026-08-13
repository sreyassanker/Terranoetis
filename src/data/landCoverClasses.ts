/**
 * Land Cover Classes & Palette Definitions
 *
 * Defines the core 6-class LULC scheme and high-performance canvas rasterization
 * utilities for discrete land-cover rendering over Cesium imagery layers.
 */

export interface LandCoverClass {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly rgb: readonly [number, number, number];
  readonly description: string;
}

export const LAND_COVER_CLASSES: readonly LandCoverClass[] = [
  { id: 1, name: 'Water', color: '#2E86DE', rgb: [46, 134, 222], description: 'Rivers, lakes, ocean, flooded extent' },
  { id: 2, name: 'Vegetation', color: '#2FA94F', rgb: [47, 169, 79], description: 'Forest, crops, grassland' },
  { id: 3, name: 'Urban / Built-up', color: '#C0392B', rgb: [192, 57, 43], description: 'Buildings, roads, settlements' },
  { id: 4, name: 'Bare Land / Soil', color: '#D9A441', rgb: [217, 164, 65], description: 'Dry soil, sand, rock, cropland fallow' },
  { id: 5, name: 'Snow / Ice', color: '#EFF4FB', rgb: [239, 244, 251], description: 'Snow cover, ice, clouds' },
  { id: 6, name: 'Shadow / Dark', color: '#3B4A5A', rgb: [59, 74, 90], description: 'Cloud shadow, dark water, low albedo' },
] as const;

export const DEFAULT_K = 4;

/** Full colour ramp covering every known class. */
export const LAND_COVER_DEFAULT_PALETTE: readonly string[] = LAND_COVER_CLASSES.map(c => c.color);

/**
 * High-performance lookup table mapping class IDs directly to 32-bit ABGR pixel values.
 * Speeds up canvas rendering by bypassing Map lookups and per-channel byte writes.
 */
const CLASS_ABGR_LOOKUP = new Uint32Array(256);
for (const c of LAND_COVER_CLASSES) {
  const [r, g, b] = c.rgb;
  // Little-Endian ABGR: (Alpha << 24) | (Blue << 16) | (Green << 8) | Red
  CLASS_ABGR_LOOKUP[c.id] = (0xFF << 24) | (b << 16) | (g << 8) | r;
}

export interface GridData {
  nLat: number;
  nLon: number;
  values: number[] | Uint8Array;
}

/**
 * Builds a discrete-color raster canvas from a class-labeled grid using high-performance
 * 32-bit direct buffer writes.
 */
export function classGridToCanvas(
  grid: GridData,
  classes: readonly LandCoverClass[] = LAND_COVER_CLASSES,
): HTMLCanvasElement {
  const { nLat, nLon, values } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = nLon;
  canvas.height = nLat;

  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) {
    throw new Error('Failed to obtain 2D rendering context for LandCover canvas.');
  }

  const imgData = ctx.createImageData(nLon, nLat);
  const buf32 = new Uint32Array(imgData.data.buffer);

  // Custom palette fallback lookup if non-standard classes are provided
  const usesCustomClasses = classes !== LAND_COVER_CLASSES;
  let customLookup: Uint32Array | null = null;

  if (usesCustomClasses) {
    customLookup = new Uint32Array(256);
    for (const c of classes) {
      const [r, g, b] = c.rgb;
      customLookup[c.id] = (0xFF << 24) | (b << 16) | (g << 8) | r;
    }
  }

  const lookup = customLookup ?? CLASS_ABGR_LOOKUP;
  const totalPixels = nLon * nLat;

  for (let i = 0; i < totalPixels; i++) {
    const id = values[i];
    if (id === 0) {
      buf32[i] = 0x00000000; // Transparent background
    } else {
      buf32[i] = lookup[id] ?? 0xFF000000;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}