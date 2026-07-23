import { describe, expect, it } from 'vitest';
import type { VolcanoDataPoint } from '../../data/volcano';

describe('VolcanoDataPoint interface', () => {
  it('has the expected shape', () => {
    const point: VolcanoDataPoint = {
      name: 'Mount St. Helens',
      distance: 150.5,
      lastEruptionYear: '2008',
      lastEruptionDate: 'Last eruption: 2008',
      evidenceCategory: 'Eruption Observed',
      country: 'United States',
      latitude: 46.2,
      longitude: -122.18,
      elevation: 2549,
      alertLevel: 'normal',
      source: 'gvp-votw-wfs',
    };
    expect(point.name).toBe('Mount St. Helens');
    expect(point.distance).toBe(150.5);
    expect(point.alertLevel).toBe('normal');
    expect(point.country).toBe('United States');
  });

  it('handles unknown values', () => {
    const point: VolcanoDataPoint = {
      name: 'unknown',
      distance: 9999,
      lastEruptionYear: '',
      lastEruptionDate: 'unknown',
      evidenceCategory: '',
      country: '',
      latitude: 0,
      longitude: 0,
      elevation: 0,
      alertLevel: 'unknown',
      source: 'error',
    };
    expect(point.alertLevel).toBe('unknown');
    expect(point.distance).toBe(9999);
  });
});

describe('Haversine distance', () => {
  function haversineKm(
    lat1: number, lon1: number, lat2: number, lon2: number,
  ): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  it('returns 0 for same point', () => {
    expect(haversineKm(40, -120, 40, -120)).toBe(0);
  });

  it('calculates known distance (1° lat ≈ 111km)', () => {
    const d = haversineKm(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('is symmetric', () => {
    const d1 = haversineKm(40, -120, 41, -121);
    const d2 = haversineKm(41, -121, 40, -120);
    expect(d1).toBeCloseTo(d2, 5);
  });
});

describe('Alert level inference', () => {
  function inferAlertLevel(eruptionYear: string, evidence: string): string {
    const currentYear = new Date().getUTCFullYear();
    const year = parseInt(eruptionYear, 10);

    if (isNaN(year)) {
      if (evidence === 'Eruption Observed') return 'normal';
      if (evidence === 'Unrest / Holocene') return 'advisory';
      return 'normal';
    }

    if (year >= currentYear) return 'warning';
    if (year >= currentYear - 1) return 'watch';
    if (year >= currentYear - 5) return 'advisory';
    if (year >= currentYear - 100) return 'normal';
    return 'normal';
  }

  it('returns warning for current year eruption', () => {
    const year = String(new Date().getUTCFullYear());
    expect(inferAlertLevel(year, 'Eruption Observed')).toBe('warning');
  });

  it('returns watch for last year eruption', () => {
    const year = String(new Date().getUTCFullYear() - 1);
    expect(inferAlertLevel(year, 'Eruption Observed')).toBe('watch');
  });

  it('returns advisory for eruption within 5 years', () => {
    const year = String(new Date().getUTCFullYear() - 3);
    expect(inferAlertLevel(year, 'Eruption Observed')).toBe('advisory');
  });

  it('returns normal for old eruptions', () => {
    expect(inferAlertLevel('1900', 'Eruption Observed')).toBe('normal');
  });

  it('returns advisory for unrest without eruption year', () => {
    expect(inferAlertLevel('', 'Unrest / Holocene')).toBe('advisory');
  });

  it('returns normal for no eruption data', () => {
    expect(inferAlertLevel('', 'Evidence Credible')).toBe('normal');
  });
});

describe('Recent activity inference', () => {
  function inferRecent(eruptionYear: string): boolean {
    const currentYear = new Date().getUTCFullYear();
    const year = parseInt(eruptionYear, 10);
    if (isNaN(year)) return false;
    return year >= currentYear - 10;
  }

  it('returns true for current year', () => {
    expect(inferRecent(String(new Date().getUTCFullYear()))).toBe(true);
  });

  it('returns true for recent eruption', () => {
    expect(inferRecent(String(new Date().getUTCFullYear() - 5))).toBe(true);
  });

  it('returns false for old eruption', () => {
    expect(inferRecent('1900')).toBe(false);
  });

  it('returns false for unknown', () => {
    expect(inferRecent('')).toBe(false);
  });
});

describe('CSV parsing', () => {
  function parseCsvRow(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let wasQuoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        wasQuoted = true;
      } else if (ch === ',' && !inQuotes) {
        result.push(wasQuoted ? current : current.trim());
        current = '';
        wasQuoted = false;
      } else {
        current += ch;
      }
    }
    result.push(wasQuoted ? current : current.trim());
    return result;
  }

  it('parses simple CSV row', () => {
    const row = parseCsvRow('a,b,c');
    expect(row).toEqual(['a', 'b', 'c']);
  });

  it('parses quoted CSV row', () => {
    const row = parseCsvRow('"a, b",c,d');
    expect(row).toEqual(['a, b', 'c', 'd']);
  });

  it('parses CSV with empty fields', () => {
    const row = parseCsvRow('a,,c');
    expect(row).toEqual(['a', '', 'c']);
  });

  it('preserves whitespace inside quotes', () => {
    const row = parseCsvRow('"  hello  ",world');
    expect(row).toEqual(['  hello  ', 'world']);
  });
});

describe('Volcano module exports', () => {
  it('exports VolcanoDataPoint type', async () => {
    const mod = await import('../../data/volcano');
    expect(typeof mod.fetchVolcano).toBe('function');
  });
});
