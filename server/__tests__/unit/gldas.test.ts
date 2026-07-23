import { describe, expect, it } from 'vitest';
import {
  buildGldasUrl,
  soilMoistureToVolumetric,
  weightedSoilMoisture,
  groundwaterStorageToDepth,
  latToIndex,
  type GldasPointData,
} from '../../data/gldas';

describe('latToIndex', () => {
  it('returns 0 for -89.875', () => {
    expect(latToIndex(-89.875)).toBe(0);
  });

  it('returns 360 for 0°', () => {
    expect(latToIndex(0)).toBe(360);
  });

  it('returns 719 for 89.875°', () => {
    expect(latToIndex(89.875)).toBe(719);
  });

  it('handles mid-values', () => {
    expect(latToIndex(40)).toBe(520);
  });
});

describe('buildGldasUrl', () => {
  it('returns null when Earthdata credentials are missing', () => {
    const origUser = process.env.EARTHDATA_USERNAME;
    const origPass = process.env.EARTHDATA_PASSWORD;
    delete process.env.EARTHDATA_USERNAME;
    delete process.env.EARTHDATA_PASSWORD;
    try {
      expect(buildGldasUrl(2024, 6, 15)).toBeNull();
    } finally {
      if (origUser !== undefined) process.env.EARTHDATA_USERNAME = origUser;
      if (origPass !== undefined) process.env.EARTHDATA_PASSWORD = origPass;
    }
  });

  it('returns correct URL for a given date', () => {
    process.env.EARTHDATA_USERNAME = 'u';
    process.env.EARTHDATA_PASSWORD = 'p';
    try {
      const url = buildGldasUrl(2024, 1, 1);
      expect(url).not.toBeNull();
      expect(url).toContain('GLDAS_NOAH025_3H.A20240101.1200.021.nc4');
    } finally {
      delete process.env.EARTHDATA_USERNAME;
      delete process.env.EARTHDATA_PASSWORD;
    }
  });

  it('includes hour in URL when specified', () => {
    process.env.EARTHDATA_USERNAME = 'u';
    process.env.EARTHDATA_PASSWORD = 'p';
    try {
      const url = buildGldasUrl(2024, 6, 15, 6);
      expect(url).toContain('0600');
    } finally {
      delete process.env.EARTHDATA_USERNAME;
      delete process.env.EARTHDATA_PASSWORD;
    }
  });

  it('rounds hour to nearest 3-hourly slot', () => {
    process.env.EARTHDATA_USERNAME = 'u';
    process.env.EARTHDATA_PASSWORD = 'p';
    try {
      const url14 = buildGldasUrl(2024, 6, 15, 14);
      expect(url14).toContain('1500');
      const url13 = buildGldasUrl(2024, 6, 15, 13);
      expect(url13).toContain('1200');
    } finally {
      delete process.env.EARTHDATA_USERNAME;
      delete process.env.EARTHDATA_PASSWORD;
    }
  });
});

describe('soilMoistureToVolumetric', () => {
  it('converts kg/m² to volumetric fraction for 0-10cm layer', () => {
    // 15 kg/m² over 100mm → 0.15 m³/m³
    expect(soilMoistureToVolumetric(15, 10)).toBeCloseTo(0.15, 3);
  });

  it('returns null for null input', () => {
    expect(soilMoistureToVolumetric(null, 10)).toBeNull();
  });

  it('clamps to [0, 1]', () => {
    expect(soilMoistureToVolumetric(-5, 10)).toBe(0);
    expect(soilMoistureToVolumetric(2000, 10)).toBe(1);
  });

  it('handles different layer thicknesses', () => {
    expect(soilMoistureToVolumetric(30, 30)).toBeCloseTo(0.1, 3);
    expect(soilMoistureToVolumetric(50, 100)).toBeCloseTo(0.05, 3);
  });
});

describe('weightedSoilMoisture', () => {
  function makeData(overrides: Partial<GldasPointData> = {}): GldasPointData {
    return {
      tkeDissipation: null,
      soilMoisture0_10: null,
      soilMoisture10_40: null,
      soilMoisture40_100: null,
      soilMoisture100_200: null,
      groundwaterStorage: null,
      snowWaterEquivalent: null,
      canopyInterception: null,
      surfaceTemp: null,
      source: null,
      ...overrides,
    };
  }

  it('returns null when all layers are null', () => {
    expect(weightedSoilMoisture(makeData())).toBeNull();
  });

  it('computes thickness-weighted average', () => {
    const data = makeData({
      soilMoisture0_10: 15,    // 10cm × 15 = 150
      soilMoisture10_40: 45,   // 30cm × 45 = 1350
    });
    // (150 + 1350) / (10 + 30) = 1500/40 = 37.5
    expect(weightedSoilMoisture(data)).toBeCloseTo(37.5, 1);
  });

  it('respects maxDepthCm', () => {
    const data = makeData({
      soilMoisture0_10: 15,      // 10cm × 15
      soilMoisture10_40: 45,     // 30cm × 45 (excluded if maxDepth=10)
    });
    expect(weightedSoilMoisture(data, 10)).toBeCloseTo(15, 0);
  });

  it('includes deeper layers when maxDepth is larger', () => {
    const data = makeData({
      soilMoisture0_10: 5,
      soilMoisture10_40: 30,
      soilMoisture40_100: 120,
    });
    // (5*10 + 30*30 + 120*60) / (10+30+60) = (50+900+7200)/100 = 81.5
    expect(weightedSoilMoisture(data, 200)).toBeCloseTo(81.5, 1);
  });

  it('handles partial data (missing middle layer)', () => {
    const data = makeData({
      soilMoisture0_10: 15,
      soilMoisture40_100: 90,
    });
    // (15*10 + 90*60) / (10+60) = (150+5400)/70 = 79.29
    expect(weightedSoilMoisture(data)).toBeCloseTo(79.29, 1);
  });
});

describe('groundwaterStorageToDepth', () => {
  it('converts kg/m² to depth using specific yield', () => {
    // 50000 kg/m² → 50m water equivalent → /0.2 = 250m depth
    expect(groundwaterStorageToDepth(50000, 0.2)).toBeCloseTo(250, 0);
  });

  it('returns null for null input', () => {
    expect(groundwaterStorageToDepth(null)).toBeNull();
  });

  it('uses default specific yield of 0.2', () => {
    expect(groundwaterStorageToDepth(10000)).toBeCloseTo(50, 0);
  });

  it('returns 0 for low storage', () => {
    expect(groundwaterStorageToDepth(0)).toBe(0);
  });

  it('handles different specific yield values', () => {
    expect(groundwaterStorageToDepth(10000, 0.1)).toBeCloseTo(100, 0);
    expect(groundwaterStorageToDepth(10000, 0.3)).toBeCloseTo(33.33, 1);
  });
});
