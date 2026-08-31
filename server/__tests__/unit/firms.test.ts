import { describe, expect, it } from 'vitest';
import { parseFirmsCsv, readFirmsDayRange } from '../../utils/firms';

describe('readFirmsDayRange', () => {
  it('defaults to one day and accepts the supported range', () => {
    expect(readFirmsDayRange(undefined)).toBe(1);
    expect(readFirmsDayRange('1')).toBe(1);
    expect(readFirmsDayRange('31')).toBe(31);
  });

  it('rejects decimals, junk, and out-of-range values', () => {
    expect(readFirmsDayRange('0')).toBeNull();
    expect(readFirmsDayRange('32')).toBeNull();
    expect(readFirmsDayRange('1.5')).toBeNull();
    expect(readFirmsDayRange('1day')).toBeNull();
  });
});

describe('parseFirmsCsv', () => {
  it('parses NASA FIRMS CSV rows and retains source fields', () => {
    const csv = [
      'latitude,longitude,bright_ti4,acq_date,satellite',
      '34.25,-118.50,330.4,2026-06-19,N',
      '-12.5,130.8,301.2,2026-06-19,N',
    ].join('\n');

    expect(parseFirmsCsv(csv)).toEqual([
      { latitude: 34.25, longitude: -118.5, bright_ti4: 330.4, acq_date: '2026-06-19', satellite: 'N' },
      { latitude: -12.5, longitude: 130.8, bright_ti4: 301.2, acq_date: '2026-06-19', satellite: 'N' },
    ]);
  });

  it('drops rows with invalid coordinates', () => {
    const csv = 'latitude,longitude,frp\n91,10,2\n20,not-a-number,3\n10,20,4';

    expect(parseFirmsCsv(csv)).toEqual([{ latitude: 10, longitude: 20, frp: 4 }]);
  });
});
