/**
 * Unit tests for src/lib/landCoverDetect.ts — Scientific Multi-Spectral-Spatial
 * Land Cover Classification Engine. Pure logic, zero DOM/Cesium dependencies.
 */
import { describe, expect, it } from 'vitest';
import {
  rgbToLab,
  spectralClassIndex,
  spectralClassify,
  applyMajorityFilter,
  classMapToGrid,
  classesUsed,
} from '@/lib/landCoverDetect';

/* ── rgbToLab ── */

describe('rgbToLab', () => {
  it('converts pure black to L=0, a=0, b=0', () => {
    const [L, a, b, chroma] = rgbToLab(0, 0, 0);
    expect(L).toBeCloseTo(0, 1);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
    expect(chroma).toBeCloseTo(0, 1);
  });

  it('converts pure white to L=100, a=0, b=0', () => {
    const [L, a, b, chroma] = rgbToLab(255, 255, 255);
    expect(L).toBeCloseTo(100, 1);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
    expect(chroma).toBeCloseTo(0, 1);
  });

  it('correctly identifies negative a* for green chlorophyll', () => {
    const [, a] = rgbToLab(40, 140, 50);
    expect(a).toBeLessThan(-20); // Strongly negative in green axis
  });

  it('correctly identifies positive b* and positive a* for warm desert sand', () => {
    const [, a, b] = rgbToLab(200, 150, 100);
    expect(a).toBeGreaterThan(5);
    expect(b).toBeGreaterThan(20);
  });
});

/* ── spectralClassIndex ── */

describe('spectralClassIndex', () => {
  describe('Water Body Classification (Classes 1 & 2)', () => {
    it('classifies deep ocean water (strong red absorption, blue/green bias) as Deep Ocean (1)', () => {
      expect(spectralClassIndex(10, 56, 52)).toBe(1); // Real Arabian Sea off Kerala
      expect(spectralClassIndex(15, 70, 60)).toBe(1);
    });

    it('classifies blue-dominant river/lake water as Inland Water (2)', () => {
      expect(spectralClassIndex(20, 80, 130)).toBe(2); // Nile River / Lake Geneva
      expect(spectralClassIndex(30, 60, 120)).toBe(2);
    });

    it('classifies turbid coastal / estuary water with sediment as Inland Water (2)', () => {
      expect(spectralClassIndex(35, 75, 70)).toBe(2);
    });
  });

  describe('Forest & Agricultural Classification (Classes 3, 4, 5)', () => {
    it('classifies dark dense canopy as Closed Forest (3)', () => {
      expect(spectralClassIndex(35, 65, 40)).toBe(3); // Dense alpine / evergreen canopy
      expect(spectralClassIndex(13, 58, 47)).toBe(3); // Shadowed tree canopy next to airfield
    });

    it('classifies open woodlands and canopy trees as Open Forest (4)', () => {
      expect(spectralClassIndex(45, 100, 55)).toBe(4);
      expect(spectralClassIndex(60, 130, 70)).toBe(4);
    });

    it('classifies high-VARI cultivated fields as Crop / Agriculture (5)', () => {
      expect(spectralClassIndex(100, 175, 70)).toBe(5); // Nile Delta bright crop field
    });
  });

  describe('Built Up, Residentials (Class 6)', () => {
    it('classifies dense residential settlements and terracotta roof tiles as Built Up (6)', () => {
      expect(spectralClassIndex(180, 110, 80)).toBe(6);  // Terracotta roof tile
      expect(spectralClassIndex(160, 155, 150)).toBe(6);  // Residential building
    });
  });

  describe('Transportation / Runway / Vessel (Class 7)', () => {
    it('classifies airport runways, taxiways, and asphalt as Transportation (7)', () => {
      expect(spectralClassIndex(128, 130, 132)).toBe(7); // Pure grey concrete runway
      expect(spectralClassIndex(145, 148, 142)).toBe(7); // Sunlit airport apron
      expect(spectralClassIndex(85, 87, 84)).toBe(7);   // Dark weathered asphalt
      expect(spectralClassIndex(92, 105, 91)).toBe(7);  // Airport taxiway weathered asphalt shoulder
      expect(spectralClassIndex(96, 106, 93)).toBe(7);  // Airport tarmac runway verge
      expect(spectralClassIndex(108, 124, 109)).toBe(7); // Airport diagonal taxiway pavement
    });

    it('classifies maritime vessels floating in open water as Transportation / Vessel (7)', () => {
      // White/metal ship deck surrounded by water
      expect(spectralClassIndex(210, 210, 215, 8.0, false, true)).toBe(7);
      expect(spectralClassIndex(110, 110, 110, 5.0, false, true)).toBe(7);
    });
  });

  describe('Open Barren / Mountain Rock (Class 8)', () => {
    it('classifies alpine mountain massifs and rock faces in alpine scenes as Open Barren (8)', () => {
      // Mont Blanc rocky scree (dark neutral rock in alpine context)
      expect(spectralClassIndex(45, 48, 52, 6.0, true, false)).toBe(8);
      expect(spectralClassIndex(75, 75, 78, 8.0, true, false)).toBe(8);
    });

    it('classifies rugged mountain rock outside alpine scenes as Open Barren (8)', () => {
      expect(spectralClassIndex(40, 42, 45, 7.0)).toBe(8);
    });
  });

  describe('Bare Soil / Beach Sand Classification (Class 9)', () => {
    it('classifies desert sand and dry arid terrain as Bare Soil (9)', () => {
      expect(spectralClassIndex(190, 150, 110)).toBe(9); // Saharan sand
      expect(spectralClassIndex(210, 170, 120)).toBe(9);
    });

    it('classifies coastal beach sand as Bare Soil (9)', () => {
      expect(spectralClassIndex(160, 135, 100)).toBe(9);
    });
  });

  describe('Snow / Ice / Glacier Classification (Class 10)', () => {
    it('classifies bright alpine snow and glacial ice as Snow / Ice (10)', () => {
      expect(spectralClassIndex(235, 238, 240)).toBe(10); // Mont Blanc summit
      expect(spectralClassIndex(220, 230, 235)).toBe(10);
    });
  });

  describe('Shadow / Dark Classification (Class 11)', () => {
    it('classifies pitch-black terrain and cloud shadows as Shadow / Dark (11)', () => {
      expect(spectralClassIndex(8, 9, 10)).toBe(11);
      expect(spectralClassIndex(12, 11, 10)).toBe(11);
    });
  });
});

/* ── applyMajorityFilter ── */

describe('applyMajorityFilter', () => {
  it('eliminates isolated single-pixel salt-and-pepper noise', () => {
    // 3×3 patch: all Inland Water (2) except center pixel is erroneously Soil (9)
    const raw = new Uint8Array([
      2, 2, 2,
      2, 9, 2,
      2, 2, 2,
    ]);
    const filtered = applyMajorityFilter(raw, 3, 3);
    // Center pixel should be regularized to Water (2)
    expect(filtered[4]).toBe(2);
  });

  it('preserves sharp geographical boundaries across large regions', () => {
    // 4×4 patch: top half Water (2), bottom half Open Forest (4)
    const raw = new Uint8Array([
      2, 2, 2, 2,
      2, 2, 2, 2,
      4, 4, 4, 4,
      4, 4, 4, 4,
    ]);
    const filtered = applyMajorityFilter(raw, 4, 4);
    expect(filtered[5]).toBe(2); // row 1 col 1 is Water
    expect(filtered[10]).toBe(4); // row 2 col 2 is Open Forest
  });
});

/* ── classMapToGrid & classesUsed ── */

describe('classMapToGrid', () => {
  it('folds a uniform map into a single-class grid', () => {
    const classes = new Uint8Array(16).fill(4); // all Open Forest
    const { gridValues, classCounts } = classMapToGrid({ classes, w: 4, h: 4 }, 2);
    expect(gridValues).toHaveLength(4);
    expect(gridValues.every(v => v === 4)).toBe(true);
    expect(classCounts.get(4)).toBe(4);
  });

  it('downsamples by majority class voting', () => {
    const classes = new Uint8Array(16);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) classes[y * 4 + x] = 1;
    for (let y = 2; y < 4; y++) for (let x = 0; x < 4; x++) classes[y * 4 + x] = 4;

    const { gridValues } = classMapToGrid({ classes, w: 4, h: 4 }, 2);
    expect(gridValues[0]).toBe(1);
    expect(gridValues[1]).toBe(1);
    expect(gridValues[2]).toBe(4);
    expect(gridValues[3]).toBe(4);
  });
});

describe('classesUsed', () => {
  it('returns only classes present in the grid', () => {
    const counts = new Map<number, number>([[1, 20], [4, 10], [7, 5]]);
    const used = classesUsed(counts);
    expect(used.map(c => c.id)).toEqual([1, 4, 7]);
  });
});

describe('spectralClassify', () => {
  it('produces expected class array from raw RGBA buffer', () => {
    const rgba = new Uint8ClampedArray([
      10, 60, 55, 255,   // Deep Ocean (1)
      50, 120, 60, 255,  // Open Forest (4)
      128, 128, 128, 255,// Transportation / Runway (7)
      190, 150, 110, 255,// Bare Soil (9)
    ]);
    const map = spectralClassify(rgba, 2, 2);
    expect(Array.from(map)).toEqual([1, 4, 7, 9]);
  });
});
