import { describe, it, expect } from 'vitest';
import { normalizeToolCall } from '../../toolsV2/toolArgs';
import { dynamicTools } from '../../toolsV2/toolGenerator';

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

  it('cross-maps bbox params (latMin/lonMin to minLat/minLon)', () => {
    const r = normalizeToolCall(quakes, { latMin: 20.2, latMax: 45.7, lonMin: 122.9, lonMax: 153.9, minMag: 4 });
    expect(r.args).toEqual({ minLat: 20.2, maxLat: 45.7, minLon: 122.9, maxLon: 153.9, minMag: 4 });
    expect(r.renames).toContain('latMin→minLat');
    expect(r.renames).toContain('lonMin→minLon');
  });

  it('cross-maps bbox params reverse (minLat/minLon to latMin/lonMin)', () => {
    const overpass = { name: 'overpass_query', schema: { params: { latMin: 'a', latMax: 'b', lonMin: 'c', lonMax: 'd', amenity: 'e' } } };
    const r = normalizeToolCall(overpass, { minLat: 20.2, maxLat: 45.7, minLon: 122.9, maxLon: 153.9, amenity: 'hospital' });
    expect(r.args).toEqual({ latMin: 20.2, latMax: 45.7, lonMin: 122.9, lonMax: 153.9, amenity: 'hospital' });
    expect(r.renames).toContain('minLat→latMin');
    expect(r.renames).toContain('minLon→lonMin');
  });

  describe('DynamicToolRegistry tool name alias & fuzzy resolution', () => {
    it('resolves singular "earthquake" to registered "earthquakes"', () => {
      dynamicTools.register({ name: 'earthquakes', description: 'Seismic', category: 'seismic', exampleQueries: [], source: 'core', schema: { type: 'api', method: 'GET' }, code: null });
      expect(dynamicTools.get('earthquake')?.name).toBe('earthquakes');
      expect(dynamicTools.resolveToolName('earthquake')).toBe('earthquakes');
    });

    it('resolves "storm surge" to registered "storms"', () => {
      dynamicTools.register({ name: 'storms', description: 'Tropical storms', category: 'weather', exampleQueries: [], source: 'core', schema: { type: 'api', method: 'GET' }, code: null });
      expect(dynamicTools.get('storm surge')?.name).toBe('storms');
      expect(dynamicTools.resolveToolName('storm surge')).toBe('storms');
    });

    it('resolves "rainfall" to registered "weather_forecast"', () => {
      dynamicTools.register({ name: 'weather_forecast', description: 'Weather', category: 'weather', exampleQueries: [], source: 'core', schema: { type: 'api', method: 'GET' }, code: null });
      expect(dynamicTools.get('rainfall')?.name).toBe('weather_forecast');
      expect(dynamicTools.resolveToolName('rainfall')).toBe('weather_forecast');
    });

    it('resolves "cctv" to registered "live_cctv"', () => {
      dynamicTools.register({ name: 'live_cctv', description: 'CCTV', category: 'media', exampleQueries: [], source: 'core', schema: { type: 'api', method: 'GET' }, code: null });
      expect(dynamicTools.get('cctv')?.name).toBe('live_cctv');
      expect(dynamicTools.resolveToolName('cctv')).toBe('live_cctv');
    });

    it('resolves "flights" to registered "flights_all"', () => {
      dynamicTools.register({ name: 'flights_all', description: 'Flights', category: 'aviation', exampleQueries: [], source: 'core', schema: { type: 'api', method: 'GET' }, code: null });
      expect(dynamicTools.get('flights')?.name).toBe('flights_all');
      expect(dynamicTools.resolveToolName('flights')).toBe('flights_all');
    });
  });
});
