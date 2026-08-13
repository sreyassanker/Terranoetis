/**
 * Unit tests for src/lib/landCoverDetect.ts — the DETR panoptic → land-cover
 * classifier. Covers the COCO-Stuff label mapping and the majority-vote
 * downsample. Pure logic, no DOM/Cesium.
 */
import { describe, expect, it } from 'vitest';
import {
  cocoLabelToLulc,
  classMapToGrid,
  classesUsed,
  spectralClassIndex,
  spectralClassify,
} from '@/lib/landCoverDetect';

/* ── cocoLabelToLulc ── */

describe('cocoLabelToLulc', () => {
  it('maps water terms to Water', () => {
    expect(cocoLabelToLulc('water')).toBe(1);
    expect(cocoLabelToLulc('sea')).toBe(1);
    expect(cocoLabelToLulc('river')).toBe(1);
    expect(cocoLabelToLulc('water_other')).toBe(1);
    expect(cocoLabelToLulc('lake')).toBe(1);
  });

  it('maps snow/ice to Snow/Ice', () => {
    expect(cocoLabelToLulc('snow')).toBe(5);
    expect(cocoLabelToLulc('ice')).toBe(5);
  });

  it('maps buildings/roads/vehicles to Urban / Built-up', () => {
    expect(cocoLabelToLulc('building_other')).toBe(3);
    expect(cocoLabelToLulc('house')).toBe(3);
    expect(cocoLabelToLulc('road')).toBe(3);
    expect(cocoLabelToLulc('wall_brick')).toBe(3);
    expect(cocoLabelToLulc('skyscraper')).toBe(3);
    expect(cocoLabelToLulc('car')).toBe(3);
  });

  it('maps bare-ground terms to Bare Land / Soil', () => {
    expect(cocoLabelToLulc('dirt')).toBe(4);
    expect(cocoLabelToLulc('sand')).toBe(4);
    expect(cocoLabelToLulc('field')).toBe(4);
    expect(cocoLabelToLulc('cropland')).toBe(4);
  });

  it('maps vegetation terms to Vegetation', () => {
    expect(cocoLabelToLulc('grass')).toBe(2);
    expect(cocoLabelToLulc('tree')).toBe(2);
    expect(cocoLabelToLulc('forest')).toBe(2);
    expect(cocoLabelToLulc('shrub')).toBe(2);
    expect(cocoLabelToLulc('crop')).toBe(2);
  });

  it('maps shadows to Shadow / Dark', () => {
    expect(cocoLabelToLulc('shadow')).toBe(6);
  });

  it('returns 0 for non-land-cover things', () => {
    expect(cocoLabelToLulc('person')).toBe(0);
    expect(cocoLabelToLulc('cat')).toBe(0);
    expect(cocoLabelToLulc('sofa')).toBe(0);
    expect(cocoLabelToLulc('sky')).toBe(0); // sky is not ground cover
  });
});

/* ── classMapToGrid ── */

describe('classMapToGrid', () => {
  it('folds a uniform map into a single-class grid', () => {
    // 4×4 map, all Vegetation (2).
    const classes = new Uint8Array(16).fill(2);
    const { gridValues, classCounts } = classMapToGrid({ classes, w: 4, h: 4 }, 2);
    expect(gridValues).toHaveLength(4);
    expect(gridValues.every(v => v === 2)).toBe(true);
    expect(classCounts.get(2)).toBe(4);
    expect(classCounts.size).toBe(1);
  });

  it('downsamples by majority, not by area-weight', () => {
    // 4×4 map: top half Water (1), bottom half Vegetation (2), one stray pixel.
    const classes = new Uint8Array(16);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) classes[y * 4 + x] = 1;
    for (let y = 2; y < 4; y++) for (let x = 0; x < 4; x++) classes[y * 4 + x] = 2;

    const { gridValues } = classMapToGrid({ classes, w: 4, h: 4 }, 2);
    // With a 2×2 grid, top-row cells see only Water, bottom-row only Vegetation.
    expect(gridValues[0]).toBe(1);
    expect(gridValues[1]).toBe(1);
    expect(gridValues[2]).toBe(2);
    expect(gridValues[3]).toBe(2);
  });

  it('leaves cells at 0 when no labeled source pixels cover them', () => {
    const classes = new Uint8Array(16); // all 0
    const { gridValues, classCounts } = classMapToGrid({ classes, w: 4, h: 4 }, 2);
    expect(gridValues.every(v => v === 0)).toBe(true);
    expect(classCounts.size).toBe(0);
  });

  it('handles non-square source maps correctly', () => {
    // 8×2 map: left half Water, right half Vegetation.
    const classes = new Uint8Array(16);
    for (let i = 0; i < 8 * 2; i++) classes[i] = (i % 8) < 4 ? 1 : 2;
    const { gridValues } = classMapToGrid({ classes, w: 8, h: 2 }, 2);
    // Left column of grid = Water, right column = Vegetation.
    expect(gridValues[0]).toBe(1);
    expect(gridValues[1]).toBe(2);
    expect(gridValues[2]).toBe(1);
    expect(gridValues[3]).toBe(2);
  });
});

/* ── classesUsed ── */

describe('classesUsed', () => {
  it('returns only classes that actually have cells in the grid', () => {
    const counts = new Map<number, number>([[2, 10], [4, 3]]);
    const used = classesUsed(counts);
    expect(used.map(c => c.id)).toEqual([2, 4]); // only Vegetation and Bare
  });

  it('returns empty for an empty grid', () => {
    expect(classesUsed(new Map())).toEqual([]);
  });
});

/* ── spectralClassIndex / spectralClassify ── */

describe('spectralClassIndex', () => {
  it('classifies water as blue-dominant', () => {
    expect(spectralClassIndex(30, 60, 120)).toBe(1); // Nile-ish dark blue
    expect(spectralClassIndex(20, 90, 140)).toBe(1);
  });

  it('classifies turbid water (blue-green, not clearly blue)', () => {
    expect(spectralClassIndex(40, 70, 80)).toBe(1); // muddy river / coast
  });

  it('classifies vegetation as green-dominant', () => {
    expect(spectralClassIndex(60, 140, 70)).toBe(2); // irrigated field
    expect(spectralClassIndex(45, 110, 55)).toBe(2);
  });

  it('classifies bare ground as warm/bright', () => {
    expect(spectralClassIndex(190, 150, 110)).toBe(4); // desert sand
    expect(spectralClassIndex(160, 120, 90)).toBe(4);
  });

  it('classifies urban as low-saturation gray', () => {
    expect(spectralClassIndex(128, 130, 132)).toBe(3); // concrete
  });

  it('classifies dark-olive built-up areas as urban', () => {
    // Real Cairo capture: dense city pixels average (75,76,42) — near-neutral
    // with a strong blue deficit. The wide saturation window catches these.
    expect(spectralClassIndex(75, 76, 42)).toBe(3);
  });

  it('classifies snow as very bright + flat', () => {
    expect(spectralClassIndex(235, 238, 240)).toBe(5);
  });

  it('classifies shadow as very dark', () => {
    expect(spectralClassIndex(20, 22, 24)).toBe(6);
  });

  it('returns 0 for genuinely ambiguous pixels', () => {
    expect(spectralClassIndex(200, 200, 60)).toBe(0); // saturated yellow — no land-cover index
  });
});

describe('spectralClassify', () => {
  it('produces a full class map from an RGBA buffer', () => {
    // 2×2 RGBA: water, veg, bare, shadow
    const rgba = new Uint8ClampedArray([
      30, 60, 120, 255,
      60, 140, 70, 255,
      190, 150, 110, 255,
      20, 22, 24, 255,
    ]);
    const map = spectralClassify(rgba, 2, 2);
    expect(Array.from(map)).toEqual([1, 2, 4, 6]);
  });
});
