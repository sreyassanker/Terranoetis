export interface SpaceDebrisItem {
  name: string;
  id: string;
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raOfAscNode: number;
  argOfPericenter: number;
  meanAnomaly: number;
  semimajorAxis: number;
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function semimajorAxisFromMeanMotion(meanMotion: number): number {
  const periodSeconds = 86_400 / meanMotion;
  return Math.cbrt((398_600.4418 * periodSeconds * periodSeconds) / (4 * Math.PI * Math.PI));
}

export function normalizeSpaceDebrisRecords(records: unknown[], limit = 1500): SpaceDebrisItem[] {
  const seen = new Set<string>();
  const normalized: SpaceDebrisItem[] = [];

  for (const value of records) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const name = typeof record.OBJECT_NAME === 'string' ? record.OBJECT_NAME.trim() : '';
    const epoch = typeof record.EPOCH === 'string' ? record.EPOCH : '';
    const meanMotion = finiteNumber(record.MEAN_MOTION);
    if (!name || !epoch || !meanMotion || meanMotion <= 0) continue;

    const id = String(record.NORAD_CAT_ID ?? record.OBJECT_ID ?? name);
    if (seen.has(id)) continue;
    seen.add(id);

    normalized.push({
      name,
      id,
      epoch,
      meanMotion,
      eccentricity: finiteNumber(record.ECCENTRICITY) ?? 0.001,
      inclination: finiteNumber(record.INCLINATION) ?? 98.6,
      raOfAscNode: finiteNumber(record.RA_OF_ASC_NODE) ?? 0,
      argOfPericenter: finiteNumber(record.ARG_OF_PERICENTER) ?? 0,
      meanAnomaly: finiteNumber(record.MEAN_ANOMALY) ?? 0,
      semimajorAxis: finiteNumber(record.SEMIMAJOR_AXIS) ?? semimajorAxisFromMeanMotion(meanMotion),
    });
  }

  if (normalized.length <= limit) return normalized;
  const sampled: SpaceDebrisItem[] = [];
  const step = normalized.length / limit;
  for (let index = 0; index < limit; index += 1) {
    sampled.push(normalized[Math.floor(index * step)]);
  }
  return sampled;
}
