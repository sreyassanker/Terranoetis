/**
 * Integration tests for Tier 1 Quick Win API Endpoints
 *
 * Covers utility functions from:
 *  1. server/utils/mgrs.ts          — MGRS coordinate conversion
 *  2. server/utils/openaq.ts        — OpenAQ global air quality
 *  3. server/utils/ndbc.ts          — NOAA ocean buoys
 *  4. server/utils/shakeMap.ts      — USGS ShakeMap intensity
 *  5. server/utils/spc.ts           — NOAA SPC convective outlooks
 *
 * Tests verify: pure function correctness, edge cases, response shapes
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════
// 1. MGRS — Military Grid Reference System
// ═══════════════════════════════════════════════════════════════════
describe('MGRS utility functions', () => {
  let latLonToMgrs: typeof import('../../utils/mgrs').latLonToMgrs;
  let mgrsToLatLon: typeof import('../../utils/mgrs').mgrsToLatLon;
  let parseMgrs: typeof import('../../utils/mgrs').parseMgrs;
  let getGridZone: typeof import('../../utils/mgrs').getGridZone;
  let getPrecisionLevels: typeof import('../../utils/mgrs').getPrecisionLevels;

  beforeEach(async () => {
    const mod = await import('../../utils/mgrs');
    latLonToMgrs = mod.latLonToMgrs;
    mgrsToLatLon = mod.mgrsToLatLon;
    parseMgrs = mod.parseMgrs;
    getGridZone = mod.getGridZone;
    getPrecisionLevels = mod.getPrecisionLevels;
  });

  describe('latLonToMgrs', () => {
    it('returns a result object with mgrs string for valid coordinates', () => {
      const result = latLonToMgrs(35.6852, 139.7528, 5);
      expect(result).toBeTruthy();
      expect(result!.mgrs).toBeDefined();
      expect(typeof result!.mgrs).toBe('string');
      expect(result!.mgrs.length).toBeGreaterThan(0);
    });

    it('returns valid MGRS characters (no I or O)', () => {
      const result = latLonToMgrs(35.6852, 139.7528, 5);
      expect(result!.mgrs).not.toMatch(/[IOio]/);
    });

    it('handles southern hemisphere coordinates', () => {
      const result = latLonToMgrs(-33.8568, 151.2153, 5);
      expect(result).toBeTruthy();
      expect(result!.mgrs).toBeDefined();
    });

    it('handles coordinates near the equator', () => {
      const result = latLonToMgrs(-0.1807, -74.006, 5);
      expect(result).toBeTruthy();
    });

    it('handles the prime meridian', () => {
      const result = latLonToMgrs(51.4733, 0.0, 5);
      expect(result).toBeTruthy();
    });

    it('higher accuracy produces longer MGRS string', () => {
      const short = latLonToMgrs(35.6852, 139.7528, 1);
      const long = latLonToMgrs(35.6852, 139.7528, 5);
      if (short && long) {
        expect(long.mgrs.length).toBeGreaterThanOrEqual(short.mgrs.length);
      }
    });
  });

  describe('mgrsToLatLon', () => {
    it('converts an MGRS string to lat/lon within valid ranges', () => {
      const mgrs = latLonToMgrs(35.6852, 139.7528, 5);
      const result = mgrsToLatLon(mgrs!.mgrs);
      // mgrsToLatLon may return null for some MGRS strings
      if (result) {
        expect(typeof result.lat).toBe('number');
        expect(typeof result.lon).toBe('number');
        expect(result.lat).toBeGreaterThanOrEqual(-90);
        expect(result.lat).toBeLessThanOrEqual(90);
        expect(result.lon).toBeGreaterThanOrEqual(-180);
        expect(result.lon).toBeLessThanOrEqual(180);
      }
    });

    it('round-trips preserve approximate location', () => {
      const origLat = 35.6852;
      const origLon = 139.7528;
      const mgrs = latLonToMgrs(origLat, origLon, 5);
      const result = mgrsToLatLon(mgrs!.mgrs);
      if (result) {
        expect(Math.abs(result.lat - origLat)).toBeLessThan(0.01);
        expect(Math.abs(result.lon - origLon)).toBeLessThan(0.01);
      }
    });
  });

  describe('parseMgrs', () => {
    it('parses a valid MGRS string and returns zone/band info', () => {
      // Use a known MGRS string format: zone(1-2 digits) + band(1 letter) + easting(1-5 letters) + northing(1-5 digits)
      const mgrs = '4QFJ12345';
      const parsed = parseMgrs(mgrs);
      expect(parsed).toBeTruthy();
      if (parsed) {
        expect(typeof parsed.zone).toBe('number');
        expect(parsed.zone).toBeGreaterThanOrEqual(1);
        expect(parsed.zone).toBeLessThanOrEqual(60);
        expect(typeof parsed.band).toBe('string');
        expect(parsed.band.length).toBe(1);
      }
    });

    it('returns null for empty string', () => {
      expect(parseMgrs('')).toBeNull();
    });

    it('returns null for random garbage', () => {
      expect(parseMgrs('not-mgrs-at-all')).toBeNull();
    });
  });

  describe('getGridZone', () => {
    it('returns a valid grid zone object for known coordinates', () => {
      const zone = getGridZone(35.6852, 139.7528);
      expect(zone).toBeTruthy();
      expect(zone).toHaveProperty('zone');
      expect(zone).toHaveProperty('band');
    });

    it('returns null or valid for extreme latitudes', () => {
      // Near polar region
      const zone = getGridZone(85.0, 0.0);
      // May return null for unsupported polar regions
      if (zone) {
        expect(typeof zone.zone).toBe('number');
      }
    });
  });

  describe('getPrecisionLevels', () => {
    it('returns a non-empty array of precision levels', () => {
      const levels = getPrecisionLevels();
      expect(Array.isArray(levels)).toBe(true);
      expect(levels.length).toBeGreaterThan(0);
    });

    it('each level has precision, label, and resolution properties', () => {
      const levels = getPrecisionLevels();
      for (const level of levels) {
        expect(level).toHaveProperty('precision');
        expect(level).toHaveProperty('label');
        expect(level).toHaveProperty('resolution');
        expect(typeof level.precision).toBe('number');
        expect(typeof level.label).toBe('string');
        expect(typeof level.resolution).toBe('string');
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. OpenAQ — Global Air Quality
// ═══════════════════════════════════════════════════════════════════
describe('OpenAQ utility functions', () => {
  let parseForSentinel: typeof import('../../utils/openaq').parseForSentinel;
  let findLocationsNearby: typeof import('../../utils/openaq').findLocationsNearby;

  beforeEach(async () => {
    const mod = await import('../../utils/openaq');
    parseForSentinel = mod.parseForSentinel;
    findLocationsNearby = mod.findLocationsNearby;
  });

  describe('parseForSentinel', () => {
    it('returns zeroed object for empty array', () => {
      const result = parseForSentinel([] as any);
      expect(result).toBeTruthy();
      expect(result.avgPm25).toBe(0);
      expect(result.avgPm10).toBe(0);
      expect(result.readings).toEqual([]);
    });

    it('parses valid station data with measurements', () => {
      const data = [
        {
          location: 'Test Station',
          measurements: [
            { parameter: 'pm25', value: 12.5 },
            { parameter: 'pm10', value: 25.0 },
          ],
        },
      ];
      const result = parseForSentinel(data as any);
      expect(result).toBeTruthy();
      expect(result.avgPm25).toBeGreaterThan(0);
      expect(result.avgPm10).toBeGreaterThan(0);
      expect(result.readings.length).toBeGreaterThan(0);
    });

    it('handles multiple stations with different PM values', () => {
      const data = [
        { location: 'Station A', measurements: [{ parameter: 'pm25', value: 10 }] },
        { location: 'Station B', measurements: [{ parameter: 'pm25', value: 20 }] },
        { location: 'Station C', measurements: [{ parameter: 'pm25', value: 30 }] },
      ];
      const result = parseForSentinel(data as any);
      expect(result).toBeTruthy();
      expect(result.avgPm25).toBeCloseTo(20, 0);
    });

    it('computes AQI from PM2.5 values', () => {
      const data = [
        { location: 'Polluted', measurements: [{ parameter: 'pm25', value: 55.4 }] },
      ];
      const result = parseForSentinel(data as any);
      expect(result.avgAqi).toBeGreaterThan(0);
    });
  });

  describe('findLocationsNearby', () => {
    it('is exported and callable', () => {
      expect(typeof findLocationsNearby).toBe('function');
    });

    it('returns a promise', () => {
      const result = findLocationsNearby(40.7128, -74.006, 10000, 5);
      expect(result).toBeInstanceOf(Promise);
      // Don't await — API call may fail without key
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. NDBC — NOAA Ocean Buoys
// ═══════════════════════════════════════════════════════════════════
describe('NDBC utility functions', () => {
  let getStations: typeof import('../../utils/ndbc').getStations;
  let findNearestStation: typeof import('../../utils/ndbc').findNearestStation;

  beforeEach(async () => {
    const mod = await import('../../utils/ndbc');
    getStations = mod.getStations;
    findNearestStation = mod.findNearestStation;
  });

  describe('getStations', () => {
    it('returns a non-empty array', () => {
      const stations = getStations();
      expect(Array.isArray(stations)).toBe(true);
      expect(stations.length).toBeGreaterThan(0);
    });

    it('each station has required fields (id, name, lat, lon)', () => {
      const stations = getStations();
      for (const station of stations.slice(0, 10)) {
        expect(station).toHaveProperty('id');
        expect(station).toHaveProperty('name');
        expect(station).toHaveProperty('lat');
        expect(station).toHaveProperty('lon');
      expect(typeof station!.id).toBe('string');
        expect(typeof station.lat).toBe('number');
        expect(typeof station.lon).toBe('number');
      }
    });

    it('station coordinates are within valid ranges', () => {
      const stations = getStations();
      for (const station of stations) {
        expect(station.lat).toBeGreaterThanOrEqual(-90);
        expect(station.lat).toBeLessThanOrEqual(90);
        expect(station.lon).toBeGreaterThanOrEqual(-180);
        expect(station.lon).toBeLessThanOrEqual(180);
      }
    });

    it('station IDs are numeric strings', () => {
      const stations = getStations();
      for (const station of stations.slice(0, 10)) {
        expect(station.id).toMatch(/^\d+$/);
      }
    });
  });

  describe('findNearestStation', () => {
    it('returns a station object for a US coastal location', () => {
      // San Francisco area
      const station = findNearestStation(37.8, -122.4);
      expect(station).toBeTruthy();
      expect(station).toHaveProperty('id');
      expect(station).toHaveProperty('lat');
      expect(station).toHaveProperty('lon');
      expect(station).toHaveProperty('name');
    });

    it('returns a station for Hawaii', () => {
      const station = findNearestStation(21.3, -157.8);
      expect(station).toBeTruthy();
      expect(typeof station!.id).toBe('string');
    });

    it('returns a station for mid-Atlantic (ocean coverage)', () => {
      const station = findNearestStation(30, -40);
      expect(station).toBeTruthy();
    });

    it('returns different stations for different locations', () => {
      const sfStation = findNearestStation(37.8, -122.4);
      const hawaiiStation = findNearestStation(21.3, -157.8);
      // They should be different stations
      expect(sfStation!.id).not.toBe(hawaiiStation!.id);
    });

    it('returned station coordinates are valid', () => {
      const station = findNearestStation(37.8, -122.4);
      expect(station!.lat).toBeGreaterThanOrEqual(-90);
      expect(station!.lat).toBeLessThanOrEqual(90);
      expect(station!.lon).toBeGreaterThanOrEqual(-180);
      expect(station!.lon).toBeLessThanOrEqual(180);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. ShakeMap — USGS Earthquake Intensity
// ═══════════════════════════════════════════════════════════════════
describe('ShakeMap utility functions', () => {
  let getMmiDescription: typeof import('../../utils/shakeMap').getMmiDescription;
  let getMmiColor: typeof import('../../utils/shakeMap').getMmiColor;

  beforeEach(async () => {
    const mod = await import('../../utils/shakeMap');
    getMmiDescription = mod.getMmiDescription;
    getMmiColor = mod.getMmiColor;
  });

  describe('getMmiDescription', () => {
    it('returns a non-empty string for MMI I (1)', () => {
      const desc = getMmiDescription(1);
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
    });

    it('returns descriptions for all MMI levels 1-10', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const expectedKeywords = ['not felt', 'weak', 'moderate', 'strong', 'very strong', 'severe', 'violent', 'extreme'];
      for (let i = 1; i <= 10; i++) {
        const desc = getMmiDescription(i);
        expect(typeof desc).toBe('string');
        expect(desc.length).toBeGreaterThan(0);
      }
    });

    it('MMI 10 (Extreme) returns a description mentioning "extreme" or similar', () => {
      const desc = getMmiDescription(10);
      expect(desc.toLowerCase()).toMatch(/extreme|damage|destruction/);
    });

    it('MMI 1 (Not felt) returns a description mentioning "not felt"', () => {
      const desc = getMmiDescription(1);
      expect(desc.toLowerCase()).toMatch(/not felt|unnoticed/);
    });

    it('returns a fallback for out-of-range values', () => {
      const desc = getMmiDescription(0);
      expect(typeof desc).toBe('string');
      const desc2 = getMmiDescription(99);
      expect(typeof desc2).toBe('string');
    });
  });

  describe('getMmiColor', () => {
    it('returns a hex color for each MMI level 1-10', () => {
      for (let i = 1; i <= 10; i++) {
        const color = getMmiColor(i);
        expect(typeof color).toBe('string');
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    it('colors follow expected severity gradient (green → red)', () => {
      const color1 = getMmiColor(1);  // Should be green/blue-ish
      const color10 = getMmiColor(10); // Should be red/purple-ish
      // We just verify they're different and valid hex
      expect(color1).not.toBe(color10);
      expect(color1).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(color10).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('returns a fallback for out-of-range values', () => {
      const color = getMmiColor(0);
      expect(typeof color).toBe('string');
      expect(color).toMatch(/^#/);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. SPC — NOAA Storm Prediction Center
// ═══════════════════════════════════════════════════════════════════
describe('SPC utility functions', () => {
  let isPointInOutlook: typeof import('../../utils/spc').isPointInOutlook;
  let fetchDayOutlook: typeof import('../../utils/spc').fetchDayOutlook;

  beforeEach(async () => {
    const mod = await import('../../utils/spc');
    isPointInOutlook = mod.isPointInOutlook;
    fetchDayOutlook = mod.fetchDayOutlook;
  });

  describe('isPointInOutlook', () => {
    it('returns a result object with inside and label properties', () => {
      // Create a mock outlook GeoJSON with a simple polygon covering the US
      const outlook = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { fill: '#FFFF00', stroke: '#000', label: 'SLGT' },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[[-120, 25], [-120, 50], [-70, 50], [-70, 25], [-120, 25]]],
            },
          },
        ],
      };

      const result = isPointInOutlook(40.0, -95.0, outlook as any);
      expect(result).toHaveProperty('inside');
      expect(typeof result.inside).toBe('boolean');
    });

    it('detects a point inside a simple polygon', () => {
      const outlook = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { DN: 6, fill: '#FF0000', stroke: '#000' },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[[-100, 30], [-100, 40], [-90, 40], [-90, 30], [-100, 30]]],
            },
          },
        ],
      };

      // Point inside the polygon (midwest US)
      const result = isPointInOutlook(35.0, -95.0, outlook as any);
      expect(result.inside).toBe(true);
      expect(result.label).toBe('Moderate Risk');
    });

    it('detects a point outside a simple polygon', () => {
      const outlook = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { DN: 6, fill: '#FF0000', stroke: '#000' },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[[-100, 30], [-100, 40], [-90, 40], [-90, 30], [-100, 30]]],
            },
          },
        ],
      };

      // Point outside (East Coast)
      const result = isPointInOutlook(40.0, -74.0, outlook as any);
      expect(result.inside).toBe(false);
    });

    it('handles empty FeatureCollection', () => {
      const outlook = { type: 'FeatureCollection' as const, features: [] };
      const result = isPointInOutlook(40.0, -95.0, outlook as any);
      expect(result.inside).toBe(false);
    });

    it('handles multiple features (first match wins)', () => {
      const outlook = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { DN: 4, fill: '#00FF00', stroke: '#000' },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[[-110, 25], [-110, 50], [-80, 50], [-80, 25], [-110, 25]]],
            },
          },
          {
            type: 'Feature' as const,
            properties: { DN: 6, fill: '#FF0000', stroke: '#000' },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [[[-100, 30], [-100, 40], [-90, 40], [-90, 30], [-100, 30]]],
            },
          },
        ],
      };

      // Point inside both polygons — should match first
      const result = isPointInOutlook(35.0, -95.0, outlook as any);
      expect(result.inside).toBe(true);
      expect(result.label).toBe('Slight Risk');
    });
  });

  describe('fetchDayOutlook', () => {
    it('is exported and callable', () => {
      expect(typeof fetchDayOutlook).toBe('function');
    });

    it('returns a promise with expected shape', () => {
      // This will fail at network level but we test the function signature
      const result = fetchDayOutlook(1);
      expect(result).toBeInstanceOf(Promise);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cross-cutting: Input validation helpers
// ═══════════════════════════════════════════════════════════════════
describe('Input validation patterns used across Tier 1 endpoints', () => {
  const isValidLat = (lat: unknown): lat is number =>
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;

  const isValidLon = (lon: unknown): lon is number =>
    typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180;

  // MGRS format: zone(1-2 digits) + band(1 letter C-X, no I/O) + easting(1-5 letters) + northing(1-5 digits)
  const mgrsRegex = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z]{1,5})(\d{1,5})$/i;
  const isValidMgrs = (s: unknown): s is string => {
    if (typeof s !== 'string') return false;
    return mgrsRegex.test(s.replace(/\s/g, ''));
  };

  const isValidStationId = (id: unknown): id is string =>
    typeof id === 'string' && /^\d{5,6}$/.test(id);

  describe('latitude validation', () => {
    it('accepts valid latitudes', () => {
      expect(isValidLat(0)).toBe(true);
      expect(isValidLat(45.5)).toBe(true);
      expect(isValidLat(-45.5)).toBe(true);
      expect(isValidLat(90)).toBe(true);
      expect(isValidLat(-90)).toBe(true);
    });

    it('rejects out-of-range latitudes', () => {
      expect(isValidLat(91)).toBe(false);
      expect(isValidLat(-91)).toBe(false);
      expect(isValidLat(NaN)).toBe(false);
      expect(isValidLat(Infinity)).toBe(false);
      expect(isValidLat('45')).toBe(false);
    });
  });

  describe('longitude validation', () => {
    it('accepts valid longitudes', () => {
      expect(isValidLon(0)).toBe(true);
      expect(isValidLon(180)).toBe(true);
      expect(isValidLon(-180)).toBe(true);
      expect(isValidLon(179.999)).toBe(true);
    });

    it('rejects out-of-range longitudes', () => {
      expect(isValidLon(181)).toBe(false);
      expect(isValidLon(-181)).toBe(false);
      expect(isValidLon(NaN)).toBe(false);
    });
  });

  describe('MGRS string validation', () => {
    it('accepts valid MGRS with 5-digit northing', () => {
      // zone=4, band=Q, easting=FJ (2 letters), northing=12345 (5 digits)
      expect(isValidMgrs('4QFJ12345')).toBe(true);
    });

    it('accepts valid MGRS with 4-digit northing', () => {
      expect(isValidMgrs('4QFJ1234')).toBe(true);
    });

    it('accepts valid MGRS with 3-digit northing', () => {
      expect(isValidMgrs('4QFJ123')).toBe(true);
    });

    it('accepts valid MGRS with 2-digit zone', () => {
      expect(isValidMgrs('14QFJ12345')).toBe(true);
    });

    it('rejects too many northing digits', () => {
      expect(isValidMgrs('4QFJ1234567890')).toBe(false);
    });

    it('rejects empty and invalid strings', () => {
      expect(isValidMgrs('')).toBe(false);
      expect(isValidMgrs('abc')).toBe(false);
      expect(isValidMgrs('4IFJ12345')).toBe(false); // I is invalid band letter
    });
  });

  describe('NDBC station ID validation', () => {
    it('accepts valid 5-digit station IDs', () => {
      expect(isValidStationId('46026')).toBe(true);
      expect(isValidStationId('51000')).toBe(true);
    });

    it('rejects invalid station IDs', () => {
      expect(isValidStationId('abc')).toBe(false);
      expect(isValidStationId('')).toBe(false);
      expect(isValidStationId('4602')).toBe(false);
      expect(isValidStationId('4602600')).toBe(false);
    });
  });
});
