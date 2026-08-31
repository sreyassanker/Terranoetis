import { describe, expect, it } from 'vitest';
import { normalizeSpaceDebrisRecords } from '../../utils/spaceDebris';

const record = (id: number, overrides: Record<string, unknown> = {}) => ({
  OBJECT_NAME: `DEBRIS ${id}`,
  OBJECT_ID: `1999-025${id}`,
  NORAD_CAT_ID: id,
  EPOCH: '2026-06-19T00:00:00.000000',
  MEAN_MOTION: 14.8,
  ECCENTRICITY: 0.001,
  INCLINATION: 98.5,
  RA_OF_ASC_NODE: 20,
  ARG_OF_PERICENTER: 30,
  MEAN_ANOMALY: 40,
  ...overrides,
});

describe('normalizeSpaceDebrisRecords', () => {
  it('maps CelesTrak OMM fields and derives a realistic semimajor axis', () => {
    const [item] = normalizeSpaceDebrisRecords([record(100)]);

    expect(item.id).toBe('100');
    expect(item.meanMotion).toBe(14.8);
    expect(item.semimajorAxis).toBeGreaterThan(6500);
    expect(item.semimajorAxis).toBeLessThan(8000);
  });

  it('deduplicates catalog IDs and discards unusable records', () => {
    const items = normalizeSpaceDebrisRecords([
      record(100),
      record(100, { OBJECT_NAME: 'DUPLICATE' }),
      record(101, { EPOCH: null }),
      record(102, { MEAN_MOTION: 0 }),
    ]);

    expect(items.map((item) => item.id)).toEqual(['100']);
  });

  it('samples large datasets to the requested limit', () => {
    const items = normalizeSpaceDebrisRecords(
      Array.from({ length: 100 }, (_, index) => record(index + 1)),
      10,
    );

    expect(items).toHaveLength(10);
    expect(new Set(items.map((item) => item.id)).size).toBe(10);
  });
});
