/**
 * Per-pixel land cover detection & classification engine.
 *
 * Employs normalized RGB spectral indices tuned specifically for satellite imagery:
 * - Water: High Red-absorption (G & B significantly exceed R).
 * - Vegetation: High Green-reflectance relative to BOTH Red and Blue (Chlorophyll peak).
 * - Urban / Built-up: Desaturated neutral/grey surfaces with tight channel variance.
 * - Bare Soil: Warm R-dominant reflectance.
 */

import { LAND_COVER_CLASSES, type LandCoverClass } from '@/data/landCoverClasses';

export interface TfModule {
  pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>;
}

export interface DetrPixelSegment {
  label: string;
  score?: number;
  mask: { data: Uint8Array | Uint8ClampedArray; width: number; height: number };
}

let detrPromise: Promise<unknown> | null = null;

export async function getDetr(tf: TfModule): Promise<unknown> {
  if (!detrPromise) {
    detrPromise = tf.pipeline('image-segmentation', 'Xenova/detr-resnet-50-panoptic', {
      quantized: true,
    }).catch((err) => {
      detrPromise = null;
      throw err;
    });
  }
  return detrPromise;
}

/* ── Pre-compiled Static Regular Expressions ── */
const REGEX_WATER = /water|sea|river|ocean|lake|pond|puddle|reservoir/i;
const REGEX_SNOW = /snow|ice|frost|glacier/i;
const REGEX_SHADOW = /shadow|dark/i;
const REGEX_URBAN_STRUCT = /building|house|wall|fence|roof|bridge|tunnel|road|street|sidewalk|pavement|highway|rail|skyscraper|structure/i;
const REGEX_URBAN_VEHICLE = /car|truck|bus|train|boat|ship|airplane|aircraft|bicycle|motorcycle/i;
const REGEX_URBAN_MAT = /concrete|brick|metal|steel|asphalt/i;
const REGEX_BARE = /dirt|soil|sand|beach|rock|stone|gravel|mud|clay|desert|field|cropland/i;
const REGEX_VEG_LOW = /grass|lawn|meadow|pasture|hay|moss|lichen|turf/i;
const REGEX_VEG_HIGH = /tree|shrub|bush|forest|wood|branch|leaf|leaves|plant|flower|crop|palm|vegetation/i;

export function cocoLabelToLulc(label: string): number {
  if (!label) return 0;
  if (REGEX_WATER.test(label)) return 1;
  if (REGEX_SNOW.test(label)) return 5;
  if (REGEX_SHADOW.test(label)) return 6;
  if (REGEX_URBAN_STRUCT.test(label) || REGEX_URBAN_VEHICLE.test(label) || REGEX_URBAN_MAT.test(label)) return 3;
  if (REGEX_BARE.test(label)) return 4;
  if (REGEX_VEG_LOW.test(label) || REGEX_VEG_HIGH.test(label)) return 2;
  return 0;
}

/**
 * Satellite Spectral Classifier (RGB-space NDWI / NDVI Approximations)
 *
 * Classifies satellite / aerial pixels based on physical reflectance properties.
 * The rules are deliberately conservative — a pixel is only committed to a land
 * cover class when its spectral signature is unambiguous, otherwise it returns 0
 * (unclassified) so downstream majority-voting never fabricates land cover.
 *
 * Ordering matters for accuracy:
 * 1. Shadow/Dark: extremely low luminance.
 * 2. Snow/Ice: high, flat luminance across all channels.
 * 3. Vegetation: chlorophyll green peak (G >> R AND G >> B) — checked BEFORE water
 *    so green canopies are never swallowed by the loose cyan/teal water rule.
 * 4. Water: strong blue/teal dominance with real saturation (grey asphalt and
 *    atmospheric haze, which read bluish-grey, must not become water).
 * 5. Bare Soil: warm Soil Line (R > G > B) with a saturation guard so saturated
 *    artificial yellows are not confused with sand.
 * 6. Urban/Built-up: desaturated concrete/asphalt/roofs.
 */
export function spectralClassIndex(r: number, g: number, b: number): number {
  const L = (r + g + b) / 3;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const spread = mx - mn;
  const sat = mx === 0 ? 0 : spread / mx;

  // 1. Shadow / Very Dark Terrain / Deep Shadowed Water
  if (L <= 22) return 6;

  // 2. Snow / Ice / Bright Clouds
  if (L > 215 && spread < 18) return 5;

  // 3. Vegetation (Forest, Grass, Crop Canopy)
  // Physical Principle: Chlorophyll reflects Green while absorbing BOTH Red and Blue.
  const vegStrong = g > r + 8 && g > b + 8 && L >= 25 && L <= 175;
  const vegMuted = g > r + 4 && g > b + 4 && L > 30 && L < 160 && spread > 12;

  if (vegStrong || vegMuted) {
    return 2; // Vegetation
  }

  // 4. Water (Cyan, Blue, Turbid Teal, Dark Reservoir Water)
  // Physical Principle: Water absorbs Red light. Requires real chromatic
  // saturation so neutral grey built-up surfaces do not register as water.
  const satOk = sat > 0.12;
  if (satOk) {
    const blueDominant = b > r + 12 && g >= r && L < 200;
    const teal = g >= b - 4 && b > r + 18 && L < 170;
    const deepBlue = b > g + 6 && b > r + 12 && L < 190;
    const darkWater = L < 70 && b > r + 6 && g > r + 6 && sat > 0.08;

    if (blueDominant || teal || deepBlue || darkWater) {
      return 1; // Water
    }
  }

  // 5. Bare Land / Soil / Sand / Rock
  // Physical Principle: Soil spectrum rises monotonically from Blue to Red (R > G > B).
  const soilLine = r > g + 8 && g > b + 2 && L > 55 && sat < 0.7;
  const sandy = r > 120 && g > 100 && b < r - 18 && r > g + 12 && sat < 0.7;

  if (soilLine || sandy) {
    return 4; // Bare Land / Soil
  }

  // 6. Urban / Built-up / Hard Surfaces / Roads
  // Physical Principle: Man-made materials (asphalt, concrete) are highly desaturated (grey).
  const isGreySurface = spread < 16 && L >= 35 && L <= 210;
  const isBrightRoof = L > 170 && spread < 30 && sat < 0.25;

  if (isGreySurface || isBrightRoof) {
    return 3; // Urban / Built-up
  }

  // 7. Conservative tie-break — near-neutral warm/cool pixels resolve to
  //    Soil / Urban. Strongly-coloured pixels matched nothing → unclassified (0),
  //    never fabricated land cover.
  if (sat < 0.5) {
    return r > g ? 4 : 3;
  }

  return 0;
}

export function spectralClassify(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const len = w * h;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const o = i * 4;
    out[i] = spectralClassIndex(data[o], data[o + 1], data[o + 2]);
  }
  return out;
}

export function pixelsFromImage(src: HTMLImageElement, w: number, h: number): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  canvas.width = 0;
  canvas.height = 0;
  return data;
}

export interface ClassMap {
  classes: Uint8Array;
  w: number;
  h: number;
}

export function spectralClassMap(src: HTMLImageElement, size = 1024): ClassMap {
  const px = pixelsFromImage(src, size, size) ?? new Uint8ClampedArray(size * size * 4);
  return { classes: spectralClassify(px, size, size), w: size, h: size };
}

export async function detectClassMap(
  tf: TfModule,
  imageUrl: string,
  srcImage?: HTMLImageElement,
): Promise<ClassMap | null> {
  const pipe = await getDetr(tf);

  const pipeObj = pipe as { processor?: { feature_extractor?: { size?: Record<string, unknown> } } };
  const fe = pipeObj.processor?.feature_extractor;
  if (fe?.size) {
    fe.size = { shortest_edge: 1024, longest_edge: 1024 };
  }

  const segmentFn = pipe as (url: string, opts?: Record<string, unknown>) => Promise<DetrPixelSegment[]>;
  const segments = await segmentFn(imageUrl, {
    threshold: 0.7,
    mask_threshold: 0.5,
    overlap_mask_area_threshold: 0.8,
  });

  if ((!Array.isArray(segments) || segments.length === 0) && srcImage) {
    return spectralClassMap(srcImage);
  }
  if (!Array.isArray(segments) || segments.length === 0) return null;

  const validSeg = segments.find(s => s?.mask && s.mask.width > 0 && s.mask.height > 0);
  if (!validSeg) {
    return srcImage ? spectralClassMap(srcImage) : null;
  }

  const w = validSeg.mask.width;
  const h = validSeg.mask.height;
  const totalPixels = w * h;
  const out = new Uint8Array(totalPixels);

  for (const seg of segments) {
    if (!seg?.mask?.data) continue;
    const id = cocoLabelToLulc(String(seg.label ?? ''));
    if (id === 0) continue;

    const m = seg.mask.data;
    if (m.length !== totalPixels) continue;

    // transformers.js panoptic pipelines emit either binarized Uint8Array masks
    // or continuous Float32 confidence masks. Any nonzero float (e.g. 1e-4) was
    // being treated as foreground, flooding the scene with garbage labels.
    const isFloat = m instanceof Float32Array || m instanceof Float64Array;
    if (isFloat) {
      for (let i = 0; i < totalPixels; i++) {
        if ((m[i] as number) >= 0.5) out[i] = id;
      }
    } else {
      for (let i = 0; i < totalPixels; i++) {
        if ((m[i] as number) !== 0) out[i] = id;
      }
    }
  }

  if (srcImage) {
    const px = pixelsFromImage(srcImage, w, h);
    if (px) {
      for (let i = 0; i < totalPixels; i++) {
        if (out[i] === 0) {
          const o = i * 4;
          out[i] = spectralClassIndex(px[o], px[o + 1], px[o + 2]);
        }
      }
    }
  }

  return { classes: out, w, h };
}

export function classMapToGrid(
  map: ClassMap,
  size: number,
): { gridValues: number[]; classCounts: Map<number, number> } {
  const { classes, w, h } = map;
  const gridValues = new Array<number>(size * size).fill(0);
  const classCounts = new Map<number, number>();

  const scaleX = w / size;
  const scaleY = h / size;
  const classBins = new Uint32Array(16);

  for (let gy = 0; gy < size; gy++) {
    const y0 = Math.floor(gy * scaleY);
    const y1 = Math.max(y0 + 1, Math.ceil((gy + 1) * scaleY));

    for (let gx = 0; gx < size; gx++) {
      const x0 = Math.floor(gx * scaleX);
      const x1 = Math.max(x0 + 1, Math.ceil((gx + 1) * scaleX));

      classBins.fill(0);

      for (let sy = y0; sy < y1; sy++) {
        const rowOff = sy * w;
        for (let sx = x0; sx < x1; sx++) {
          const code = classes[rowOff + sx];
          if (code > 0 && code < 16) {
            classBins[code]++;
          }
        }
      }

      let bestId = 0;
      let bestCnt = 0;

      for (let c = 1; c < 16; c++) {
        if (classBins[c] > bestCnt) {
          bestCnt = classBins[c];
          bestId = c;
        }
      }

      if (bestId > 0) {
        gridValues[gy * size + gx] = bestId;
        classCounts.set(bestId, (classCounts.get(bestId) ?? 0) + 1);
      }
    }
  }

  return { gridValues, classCounts };
}

export function classesUsed(classCounts: Map<number, number>): LandCoverClass[] {
  return LAND_COVER_CLASSES.filter(c => (classCounts.get(c.id) ?? 0) > 0);
}