import { describe, expect, it } from 'vitest';
import { isValidIssPosition, parseIssTle, propagateIssPosition } from '../../utils/iss';

const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000+0  30200-3 0  9998
2 25544  51.6416  10.1234 0005000  20.0000 100.0000 15.50000000400000`;

describe('ISS TLE fallback', () => {
  it('parses the ISS record from a CelesTrak response', () => {
    const tle = parseIssTle(ISS_TLE);

    expect(tle.name).toBe('ISS (ZARYA)');
    expect(tle.line1).toMatch(/^1 25544/);
    expect(tle.line2).toMatch(/^2 25544/);
  });

  it('rejects a response without the ISS record', () => {
    expect(() => parseIssTle('NO DATA')).toThrow(/did not contain an ISS TLE/);
  });

  it('propagates a TLE into the existing API coordinate shape', () => {
    const position = propagateIssPosition(parseIssTle(ISS_TLE), new Date('2024-01-01T12:00:00Z'));

    expect(position.id).toBe(25544);
    expect(position.latitude).toBeGreaterThanOrEqual(-90);
    expect(position.latitude).toBeLessThanOrEqual(90);
    expect(position.longitude).toBeGreaterThanOrEqual(-180);
    expect(position.longitude).toBeLessThanOrEqual(180);
    expect(position.altitude).toBeGreaterThan(300);
    expect(position.velocity).toBeGreaterThan(20_000);
    expect(position.source).toMatch(/CelesTrak/);
  });
});

describe('isValidIssPosition', () => {
  it('accepts finite coordinates in range', () => {
    expect(isValidIssPosition({ latitude: 10, longitude: -20 })).toBe(true);
  });

  it('rejects missing, non-finite, and out-of-range coordinates', () => {
    expect(isValidIssPosition({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidIssPosition({ latitude: 0, longitude: Number.NaN })).toBe(false);
    expect(isValidIssPosition(null)).toBe(false);
  });
});
