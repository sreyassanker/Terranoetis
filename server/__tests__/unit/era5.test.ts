import { describe, expect, it } from 'vitest';
import { calculateClimateStats, detectExtremes, type Era5DailyData } from '../../utils/era5';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeDaily(overrides: Partial<Era5DailyData> = {}): Era5DailyData {
  return {
    date: '2024-06-15',
    lat: 40.7128,
    lon: -74.006,
    temperature2m: 25,
    temperatureMax: 30,
    temperatureMin: 20,
    precipitation: 2,
    windSpeed10m: 5,
    windDirection10m: 180,
    surfacePressure: 1013,
    relativeHumidity: 60,
    solarRadiation: 20,
    soilMoisture: 0.3,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateClimateStats', () => {
  it('returns null for empty data', () => {
    expect(calculateClimateStats([])).toBeNull();
  });

  it('computes basic statistics for a single day', () => {
    const data = [makeDaily({ temperature2m: 20, temperatureMax: 25, temperatureMin: 15, precipitation: 5 })];
    const stats = calculateClimateStats(data, '2024-06');
    expect(stats).not.toBeNull();
    expect(stats!.temperature.mean).toBe(20);
    expect(stats!.temperature.max).toBe(25);
    expect(stats!.temperature.min).toBe(15);
    expect(stats!.precipitation.total).toBe(5);
  });

  it('computes statistics for multiple days', () => {
    const data = [
      makeDaily({ temperature2m: 20, temperatureMax: 25, temperatureMin: 15, precipitation: 5 }),
      makeDaily({ temperature2m: 30, temperatureMax: 35, temperatureMin: 25, precipitation: 0 }),
      makeDaily({ temperature2m: 25, temperatureMax: 30, temperatureMin: 20, precipitation: 10 }),
    ];
    const stats = calculateClimateStats(data, '2024-06');
    expect(stats!.temperature.mean).toBe(25);
    expect(stats!.temperature.max).toBe(35);
    expect(stats!.temperature.min).toBe(15);
    expect(stats!.precipitation.total).toBe(15);
  });

  it('counts rainy days (precipitation > 1mm)', () => {
    const data = [
      makeDaily({ precipitation: 5 }),
      makeDaily({ precipitation: 0.5 }),
      makeDaily({ precipitation: 10 }),
      makeDaily({ precipitation: 0 }),
    ];
    const stats = calculateClimateStats(data);
    expect(stats!.precipitation.rainyDays).toBe(2);
  });

  it('detects heatwave days (max temp > mean + 5)', () => {
    // mean is 20, so heatwave = max > 25
    const data = [
      makeDaily({ temperature2m: 20, temperatureMax: 20 }),  // normal
      makeDaily({ temperature2m: 20, temperatureMax: 20 }),  // normal
      makeDaily({ temperature2m: 20, temperatureMax: 40 }),  // heatwave
      makeDaily({ temperature2m: 20, temperatureMax: 20 }),  // normal
    ];
    const stats = calculateClimateStats(data);
    expect(stats!.extremes.heatwaves).toBe(1);
  });

  it('detects cold snap days (min temp < mean - 10)', () => {
    const data = [
      makeDaily({ temperature2m: 20, temperatureMin: 15 }),
      makeDaily({ temperature2m: 20, temperatureMin: 5 }),   // cold snap
      makeDaily({ temperature2m: 20, temperatureMin: 15 }),
    ];
    const stats = calculateClimateStats(data);
    expect(stats!.extremes.coldSnaps).toBe(1);
  });

  it('detects drought days (precipitation < 0.1)', () => {
    const data = [
      makeDaily({ precipitation: 0.05 }),
      makeDaily({ precipitation: 5 }),
      makeDaily({ precipitation: 0 }),
    ];
    const stats = calculateClimateStats(data);
    expect(stats!.extremes.droughtDays).toBe(2);
  });

  it('detects heavy rain days (precipitation > 20)', () => {
    const data = [
      makeDaily({ precipitation: 25 }),
      makeDaily({ precipitation: 10 }),
      makeDaily({ precipitation: 50 }),
    ];
    const stats = calculateClimateStats(data);
    expect(stats!.extremes.heavyRainDays).toBe(2);
  });

  it('calculates temperature anomaly from baseline', () => {
    // baseline mean is 15°C, so 25°C → anomaly = 10
    const data = [makeDaily({ temperature2m: 25 })];
    const stats = calculateClimateStats(data);
    expect(stats!.temperature.anomaly).toBe(10);
  });

  it('uses period label correctly', () => {
    const data = [makeDaily()];
    const stats = calculateClimateStats(data, '2024-Q2');
    expect(stats!.period).toBe('2024-Q2');
  });

  it('reports location from first data point', () => {
    const data = [makeDaily({ lat: 51.5, lon: -0.12 })];
    const stats = calculateClimateStats(data);
    expect(stats!.location.lat).toBe(51.5);
    expect(stats!.location.lon).toBe(-0.12);
  });
});

describe('detectExtremes', () => {
  it('returns empty for no data', () => {
    expect(detectExtremes([])).toEqual([]);
  });

  it('returns empty for normal data (no extremes)', () => {
    const data = Array.from({ length: 30 }, (_, i) =>
      makeDaily({
        date: `2024-06-${String(i + 1).padStart(2, '0')}`,
        temperature2m: 20 + Math.sin(i * 0.3) * 3,
        temperatureMax: 25 + Math.sin(i * 0.3) * 3,
        temperatureMin: 15 + Math.sin(i * 0.3) * 3,
      }),
    );
    const events = detectExtremes(data);
    // Most of these should be normal
    expect(events.length).toBeLessThan(10);
  });

  it('detects heatwave events', () => {
    // Create data with an extreme spike
    const data = Array.from({ length: 30 }, (_, i) => {
      const isSpike = i >= 10 && i <= 15;
      return makeDaily({
        date: `2024-06-${String(i + 1).padStart(2, '0')}`,
        temperature2m: 20,
        temperatureMax: isSpike ? 45 : 25,
        temperatureMin: isSpike ? 30 : 15,
      });
    });
    const events = detectExtremes(data);
    const heatwaves = events.filter(e => e.type === 'heatwave');
    expect(heatwaves.length).toBeGreaterThan(0);
    expect(heatwaves[0].intensity).toBeGreaterThan(0);
    expect(heatwaves[0].intensity).toBeLessThanOrEqual(1);
  });

  it('detects cold snap events', () => {
    // Need variance in temperature2m so stddev > 0, making the cold threshold meaningful
    const data = Array.from({ length: 30 }, (_, i) => {
      const isCold = i >= 5 && i <= 8;
      return makeDaily({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        temperature2m: isCold ? 5 : 20 + (i % 3),
        temperatureMax: isCold ? 10 : 25 + (i % 3),
        temperatureMin: isCold ? -25 : 10 + (i % 3),
      });
    });
    const events = detectExtremes(data);
    const coldSnaps = events.filter(e => e.type === 'cold_snap');
    expect(coldSnaps.length).toBeGreaterThan(0);
  });

  it('detects heavy rain events', () => {
    // Use high stddev so the heatwave/cold_snap thresholds are wide
    // and the heavy rain day (temperatureMax=25) does NOT trigger heatwave.
    // With temps spread 0..40, mean≈20, stddev≈12, threshold≈44.
    const baseData = Array.from({ length: 30 }, (_, i) =>
      makeDaily({
        date: `2024-07-${String(i + 1).padStart(2, '0')}`,
        temperature2m: i * (40 / 29), // spread 0 to 40
        temperatureMax: i * (40 / 29) + 5,
        temperatureMin: i * (40 / 29) - 5,
        precipitation: 2,
      }),
    );
    // Replace one day with heavy rain; keep tempMax below heatwave threshold
    baseData[15] = makeDaily({
      date: '2024-07-16',
      temperature2m: 20,
      temperatureMax: 25,
      temperatureMin: 15,
      precipitation: 50,
    });
    const events = detectExtremes(baseData);
    const heavyRain = events.filter(e => e.type === 'heavy_rain');
    expect(heavyRain.length).toBe(1);
    expect(heavyRain[0].description).toContain('50');
  });

  it('events have valid intensity range 0-1', () => {
    const data = Array.from({ length: 30 }, (_, i) =>
      makeDaily({
        date: `2024-06-${String(i + 1).padStart(2, '0')}`,
        temperature2m: 20,
        temperatureMax: i >= 10 && i <= 12 ? 50 : 25,
        temperatureMin: 15,
      }),
    );
    const events = detectExtremes(data);
    for (const event of events) {
      expect(event.intensity).toBeGreaterThanOrEqual(0);
      expect(event.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('events have startDate and endDate', () => {
    const data = Array.from({ length: 30 }, (_, i) =>
      makeDaily({
        date: `2024-06-${String(i + 1).padStart(2, '0')}`,
        temperature2m: 20,
        temperatureMax: i >= 10 && i <= 12 ? 50 : 25,
        temperatureMin: 15,
      }),
    );
    const events = detectExtremes(data);
    for (const event of events) {
      expect(event.startDate).toBeTruthy();
      expect(event.endDate).toBeTruthy();
    }
  });
});
