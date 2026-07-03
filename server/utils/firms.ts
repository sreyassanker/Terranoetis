import Papa from 'papaparse';

export interface FirmsHotspot {
  latitude: number;
  longitude: number;
  [key: string]: unknown;
}

export function readFirmsDayRange(value: unknown): number | null {
  if (value === undefined) return 1;
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string' || !/^\d+$/.test(candidate.trim())) return null;
  const dayRange = Number(candidate);
  return Number.isInteger(dayRange) && dayRange >= 1 && dayRange <= 31 ? dayRange : null;
}

export function parseFirmsCsv(csv: string): FirmsHotspot[] {
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return parsed.data.flatMap((row) => {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
      || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      return [];
    }
    return [{ ...row, latitude, longitude }];
  });
}
