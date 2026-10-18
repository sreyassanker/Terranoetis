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
  {
    id: 1,
    name: 'Deep Ocean Water',
    color: '#0077B6',
    rgb: [0, 119, 182],
    description: 'Deep ocean, open sea, low reflectance bathymetry',
  },
  {
    id: 2,
    name: 'Inland Water / Estuary',
    color: '#00AFEF',
    rgb: [0, 175, 239],
    description: 'Lakes, rivers, reservoirs, coastal estuaries (Section 4.0 Standard)',
  },
  {
    id: 3,
    name: 'Closed Forest',
    color: '#537374',
    rgb: [83, 115, 116],
    description: 'Dense canopy forest, evergreen woods (Section 4.0 Standard)',
  },
  {
    id: 4,
    name: 'Open Forest / Tree Cover',
    color: '#00A859',
    rgb: [0, 168, 89],
    description: 'Agroforestry, woodlands, palm canopy (Section 4.0 Standard)',
  },
  {
    id: 5,
    name: 'Crop / Agriculture',
    color: '#FFF212',
    rgb: [255, 242, 18],
    description: 'Annual & perennial crops, cultivated fields (Section 4.0 Standard)',
  },
  {
    id: 6,
    name: 'Built Up, Residentials',
    color: '#ED2F59',
    rgb: [237, 47, 89],
    description: 'Settlements, houses, commercial buildings (Section 4.0 Standard)',
  },
  {
    id: 7,
    name: 'Transportation / Runway / Vessel',
    color: '#BEBEBE',
    rgb: [190, 190, 190],
    description: 'Runways, taxiways, piers, docking areas, vessels (Section 3.0 Standard)',
  },
  {
    id: 8,
    name: 'Open Barren / Mountain Rock',
    color: '#71577F',
    rgb: [113, 87, 127],
    description: 'Mountain rock, alpine scree, exposed massifs (Section 4.0 Standard)',
  },
  {
    id: 9,
    name: 'Bare Soil / Beach Sand',
    color: '#CE8F64',
    rgb: [206, 143, 100],
    description: 'Dry soil, beach sand, cleared land, desert (Section 4.0 Standard)',
  },
  {
    id: 10,
    name: 'Snow / Ice / Glacier',
    color: '#FFFFFF',
    rgb: [255, 255, 255],
    description: 'Glaciers, alpine snow, permanent snowpack (Global RS Standard)',
  },
  {
    id: 11,
    name: 'Shadow / Dark',
    color: '#212529',
    rgb: [33, 37, 41],
    description: 'Cloud shadow, deep terrain shade, low albedo (Global RS Standard)',
  },
] as const;

export const DEFAULT_K = 6;

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