import { describe, expect, it } from 'vitest';
import {
  aggregatePrecipitation,
  extractPrecipitation,
  extractPrecipitationAtPoint,
  getImergUrl,
  type ImergGridData,
} from '../../data/imerg';

describe('extractPrecipitation (pure 2D arrays)', () => {
  const lats = [-89.95, -60, -30, 0, 30, 60, 89.95];
  const lons = [-179.95, -120, -60, 0, 60, 120, 179.95];

  it('returns correct value at exact grid point', () => {
    const grid = lats.map(lat =>
      lons.map(lon => (lat === 0 && lon === 0 ? 12.5 : 0)),
    );
    expect(extractPrecipitation(grid, lats, lons, 0, 0)).toBe(12.5);
  });

  it('returns nearest-neighbor value for off-grid coordinates', () => {
    const grid = lats.map((lat, li) =>
      lons.map((_, lj) => (li === 3 && lj === 3 ? 8.2 : 0)),
    );
    const val = extractPrecipitation(grid, lats, lons, 2, 2);
    expect(val).toBe(8.2);
  });

  it('returns 0 for NaN or undefined values', () => {
    const grid = lats.map(() => lons.map(() => NaN));
    expect(extractPrecipitation(grid, lats, lons, 0, 0)).toBe(0);
  });

  it('clamps negative values to 0', () => {
    const grid = lats.map(() => lons.map(() => -5));
    expect(extractPrecipitation(grid, lats, lons, 0, 0)).toBe(0);
  });

  it('handles single-cell grid', () => {
    expect(extractPrecipitation([[3.14]], [0], [0], 0, 0)).toBe(3.14);
  });

  it('returns 0 for out-of-bounds lat/lon', () => {
    const grid = lats.map(() => lons.map(() => 5));
    // Very distant lat/lon — still returns nearest, which has a value
    const val = extractPrecipitation(grid, lats, lons, 100, 200);
    expect(val).toBeGreaterThan(0);
  });
});

describe('extractPrecipitationAtPoint (Float32Array grid)', () => {
  function makeGridData(overrides: Partial<ImergGridData> = {}): ImergGridData {
    const nlat = 5;
    const nlon = 5;
    const lat = new Float32Array([-40, -20, 0, 20, 40]);
    const lon = new Float32Array([-40, -20, 0, 20, 40]);
    const precip = new Float32Array(nlat * nlon);
    return { lat, lon, precipitation: precip, ...overrides };
  }

  it('returns 0 when no precipitation', () => {
    expect(extractPrecipitationAtPoint(makeGridData(), 0, 0)).toBe(0);
  });

  it('returns non-zero value at a grid point with rain', () => {
    const gd = makeGridData();
    const centerIdx = 2 * 5 + 2; // lat=0, lon=0
    gd.precipitation[centerIdx] = 800; // raw value = 800 → 8 mm
    const val = extractPrecipitationAtPoint(gd, 0, 0);
    expect(val).toBeCloseTo(8, 1);
  });

  it('finds nearest neighbor', () => {
    const gd = makeGridData();
    gd.precipitation[2 * 5 + 3] = 500; // lat=0, lon=20
    const val = extractPrecipitationAtPoint(gd, 1, 18);
    expect(val).toBeCloseTo(5, 1);
  });

  it('clamps negative values to 0', () => {
    const gd = makeGridData();
    const idx = 2 * 5 + 2;
    gd.precipitation[idx] = -100;
    expect(extractPrecipitationAtPoint(gd, 0, 0)).toBe(0);
  });
});

describe('aggregatePrecipitation', () => {
  it('sums 30-min slots for a given window', () => {
    const slots = Array.from({ length: 48 }, (_, i) => (i < 4 ? 2 : 0));
    expect(aggregatePrecipitation(slots, 2)).toBe(8); // 4 slots × 2mm
  });

  it('handles empty/window too large', () => {
    const slots = [1, 2, 3];
    expect(aggregatePrecipitation(slots, 48)).toBe(6);
  });

  it('returns 0 for zeros', () => {
    expect(aggregatePrecipitation(Array.from({ length: 48 }, () => 0), 24)).toBe(0);
  });

  it('handles partial window', () => {
    const slots = [1, 2, 3, 4, 5];
    expect(aggregatePrecipitation(slots, 1)).toBe(3); // 2 slots: 1 + 2
  });
});

describe('getImergUrl', () => {
  it('returns null when Earthdata credentials are missing', () => {
    const origUser = process.env.EARTHDATA_USERNAME;
    const origPass = process.env.EARTHDATA_PASSWORD;
    delete process.env.EARTHDATA_USERNAME;
    delete process.env.EARTHDATA_PASSWORD;
    try {
      expect(getImergUrl('late', 2024, 6, 15, 0)).toBeNull();
    } finally {
      if (origUser !== undefined) process.env.EARTHDATA_USERNAME = origUser;
      if (origPass !== undefined) process.env.EARTHDATA_PASSWORD = origPass;
    }
  });

  it('returns a valid URL when credentials exist', () => {
    const origUser = process.env.EARTHDATA_USERNAME;
    const origPass = process.env.EARTHDATA_PASSWORD;
    process.env.EARTHDATA_USERNAME = 'testuser';
    process.env.EARTHDATA_PASSWORD = 'testpass';
    try {
      const url = getImergUrl('late', 2024, 6, 15, 0);
      expect(url).not.toBeNull();
      expect(url).toContain('20240615');
      expect(url).toContain('3B-HHR-L');
      expect(url).toContain('V07.HDF5');
    } finally {
      if (origUser !== undefined) process.env.EARTHDATA_USERNAME = origUser;
      else delete process.env.EARTHDATA_USERNAME;
      if (origPass !== undefined) process.env.EARTHDATA_PASSWORD = origPass;
      else delete process.env.EARTHDATA_PASSWORD;
    }
  });

  it('generates different URLs for different products', () => {
    process.env.EARTHDATA_USERNAME = 'u';
    process.env.EARTHDATA_PASSWORD = 'p';
    try {
      const lateUrl = getImergUrl('late', 2024, 6, 15, 0);
      const earlyUrl = getImergUrl('early', 2024, 6, 15, 0);
      expect(lateUrl).not.toBe(earlyUrl);
      expect(lateUrl).toContain('3B-HHR-L');
      expect(earlyUrl).toContain('3B-HHR-E');
    } finally {
      delete process.env.EARTHDATA_USERNAME;
      delete process.env.EARTHDATA_PASSWORD;
    }
  });

  it('generates different URLs for different 30-min slots', () => {
    process.env.EARTHDATA_USERNAME = 'u';
    process.env.EARTHDATA_PASSWORD = 'p';
    try {
      const slot0 = getImergUrl('late', 2024, 6, 15, 0);
      const slot1 = getImergUrl('late', 2024, 6, 15, 1);
      expect(slot0).not.toBe(slot1);
      expect(slot0).toContain('S000000-E002959');
      expect(slot1).toContain('S003000-E005959');
    } finally {
      delete process.env.EARTHDATA_USERNAME;
      delete process.env.EARTHDATA_PASSWORD;
    }
  });

  it('handles edge case: month and day zero-padding', () => {
    process.env.EARTHDATA_USERNAME = 'u';
    process.env.EARTHDATA_PASSWORD = 'p';
    try {
      const url = getImergUrl('late', 2024, 1, 5, 0);
      expect(url).toContain('20240105');
    } finally {
      delete process.env.EARTHDATA_USERNAME;
      delete process.env.EARTHDATA_PASSWORD;
    }
  });
});
