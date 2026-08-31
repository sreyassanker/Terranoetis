import { describe, expect, it } from 'vitest';
import { getSatclipEmbedding, findSimilarLocations, getLocationContext } from '../../utils/satclip';

describe('SatCLIP Location Embeddings', () => {
  describe('getSatclipEmbedding', () => {
    it('returns valid embedding for valid coordinates', async () => {
      const result = await getSatclipEmbedding(35.68, 139.76);
      expect(result.lat).toBe(35.68);
      expect(result.lon).toBe(139.76);
      expect(result.dimensions).toBe(512);
      expect(result.embedding).toHaveLength(512);
      expect(result.cached).toBe(false);
    });

    it('returns empty embedding for invalid lat', async () => {
      const result = await getSatclipEmbedding(NaN, 0);
      expect(result.embedding).toHaveLength(0);
      expect(result.dimensions).toBe(0);
    });

    it('returns empty embedding for lat out of range', async () => {
      const result = await getSatclipEmbedding(91, 0);
      expect(result.embedding).toHaveLength(0);
    });

    it('caches embeddings on second call', async () => {
      const first = await getSatclipEmbedding(40.71, -74.00);
      const second = await getSatclipEmbedding(40.71, -74.00);
      expect(second.cached).toBe(true);
      expect(second.embedding).toEqual(first.embedding);
    });

    it('generates deterministic embeddings for same coordinates', async () => {
      const a = await getSatclipEmbedding(10, 20);
      const b = await getSatclipEmbedding(10, 20);
      expect(a.embedding).toEqual(b.embedding);
    });
  });

  describe('findSimilarLocations', () => {
    it('returns array of similar locations', async () => {
      const results = await findSimilarLocations(35.68, 139.76, 500, 5);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('each result has lat, lon, similarity, distance_km', async () => {
      const results = await findSimilarLocations(35.68, 139.76, 200, 3);
      for (const r of results) {
        expect(typeof r.lat).toBe('number');
        expect(typeof r.lon).toBe('number');
        expect(typeof r.similarity).toBe('number');
        expect(typeof r.distance_km).toBe('number');
        expect(r.distance_km).toBeGreaterThan(0);
      }
    });

    it('results are sorted by similarity descending', async () => {
      const results = await findSimilarLocations(0, 0, 100, 5);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity).toBeLessThanOrEqual(results[i - 1].similarity);
      }
    });
  });

  describe('getLocationContext', () => {
    it('returns context with all feature fields', async () => {
      const ctx = await getLocationContext(35.68, 139.76);
      expect(ctx.lat).toBe(35.68);
      expect(ctx.lon).toBe(139.76);
      expect(ctx.urbanization).toBeGreaterThanOrEqual(0);
      expect(ctx.urbanization).toBeLessThanOrEqual(1);
      expect(ctx.vegetation).toBeGreaterThanOrEqual(0);
      expect(ctx.water_proximity).toBeGreaterThanOrEqual(0);
      expect(ctx.infrastructure).toBeGreaterThanOrEqual(0);
      expect(ctx.terrain_complexity).toBeGreaterThanOrEqual(0);
    });

    it('returns zero context for invalid coordinates', async () => {
      const ctx = await getLocationContext(NaN, 0);
      expect(ctx.urbanization).toBe(0);
      expect(ctx.vegetation).toBe(0);
    });
  });
});
