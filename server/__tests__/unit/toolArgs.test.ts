import { describe, it, expect } from 'vitest';
import { normalizeToolCall } from '../../toolsV2/toolArgs';

const weather = { name: 'weather_forecast', schema: { params: { lat: 'latitude', lon: 'longitude', startDate: 'ISO date', endDate: 'ISO date' } } };
const quakes = { name: 'earthquakes', schema: { params: { minLat: 'a', maxLat: 'b', minLon: 'c', maxLon: 'd', hours: 'e', minMag: 'f' } } };

describe('normalizeToolCall (P2 typed tool calling)', () => {
  it('maps synonyms (latitude→lat, longitude→lon)', () => {
    const r = normalizeToolCall(weather, { latitude: 35.68, longitude: 139.65 });
    expect(r.args).toEqual({ lat: 35.68, lon: 139.65 });
    expect(r.renames.sort()).toEqual(['latitude→lat', 'longitude→lon']);
    expect(r.errors).toEqual([]);
  });

  it('coerces numeric strings for numeric params', () => {
    const r = normalizeToolCall(weather, { lat: '35.68', lon: '139.65' });
    expect(r.args.lat).toBe(35.68);
    expect(typeof r.args.lat).toBe('number');
  });

  it('snake_case params match camelCase declarations', () => {
    const r = normalizeToolCall(quakes, { min_mag: 4.5, start_time: '2026-01-01' });
    expect(r.args.minMag).toBe(4.5);
    // start_time has no declared match on earthquakes → dropped
    expect(r.dropped).toContain('start_time');
  });

  it('drops unknown params the tool does not declare', () => {
    const r = normalizeToolCall(weather, { lat: 1, lon: 2, nonsense: 'x' });
    expect(r.dropped).toEqual(['nonsense']);
    expect(r.args).not.toHaveProperty('nonsense');
  });

  it('flags out-of-range coordinates', () => {
    const r = normalizeToolCall(weather, { lat: 123, lon: 400 });
    expect(r.errors.length).toBe(2);
    expect(r.errors.join(' ')).toMatch(/latitude range/);
    expect(r.errors.join(' ')).toMatch(/longitude range/);
  });

  it('passes through when a tool declares no params', () => {
    const r = normalizeToolCall({ name: 'x', schema: { params: {} } }, { foo: 'bar' });
    expect(r.args).toEqual({ foo: 'bar' });
    expect(r.dropped).toEqual([]);
  });

  it('does not rename a param that already matches exactly', () => {
    const r = normalizeToolCall(weather, { lat: 10, lon: 20 });
    expect(r.renames).toEqual([]);
  });
});
