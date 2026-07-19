import { describe, expect, it, beforeEach } from 'vitest';
import { addEntity, addRelation, spatialQuery, graphTraversal, assembleContext } from '../../utils/geoGraphRAG';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { GeoEntity, GeoRelation } from '../../utils/geoGraphRAG';

describe('GeoGraphRAG', () => {
  const entity1: GeoEntity = {
    id: 'e1', type: 'military_base', name: 'Base Alpha',
    lat: 34.05, lon: -118.24, properties: { capacity: 5000 },
  };
  const entity2: GeoEntity = {
    id: 'e2', type: 'port', name: 'Port LA',
    lat: 33.74, lon: -118.27, properties: { type: 'commercial' },
  };
  const entity3: GeoEntity = {
    id: 'e3', type: 'airport', name: 'LAX',
    lat: 33.94, lon: -118.41, properties: { iata: 'LAX' },
  };
  const entity4: GeoEntity = {
    id: 'e4', type: 'military_base', name: 'Base Delta',
    lat: 40.71, lon: -74.00, properties: { capacity: 3000 },
  };

  beforeEach(() => {
    addEntity(entity1);
    addEntity(entity2);
    addEntity(entity3);
    addEntity(entity4);
    addRelation({ from: 'e1', to: 'e2', type: 'supports', weight: 0.8, properties: {} });
    addRelation({ from: 'e1', to: 'e3', type: 'transport', weight: 0.6, properties: {} });
  });

  describe('spatialQuery', () => {
    it('finds entities within radius', () => {
      const results = spatialQuery({ lat: 34.05, lon: -118.24, radiusKm: 50 });
      expect(results.length).toBe(3);
      const ids = results.map(e => e.id);
      expect(ids).toContain('e1');
      expect(ids).toContain('e2');
      expect(ids).toContain('e3');
    });

    it('excludes entities outside radius', () => {
      const results = spatialQuery({ lat: 34.05, lon: -118.24, radiusKm: 10 });
      expect(results.length).toBeLessThan(4);
      const ids = results.map(e => e.id);
      expect(ids).not.toContain('e4');
    });

    it('filters by entity type', () => {
      const results = spatialQuery({
        lat: 34.05, lon: -118.24, radiusKm: 50,
        entityTypes: ['military_base'],
      });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('e1');
    });

    it('returns empty for no matches', () => {
      const results = spatialQuery({ lat: -50, lon: -50, radiusKm: 10 });
      expect(results).toEqual([]);
    });
  });

  describe('graphTraversal', () => {
    it('traverses neighbors from starting entity', () => {
      const results = graphTraversal('e1', 2, 10);
      const ids = results.map(e => e.id);
      expect(ids).toContain('e1');
      expect(ids).toContain('e2');
      expect(ids).toContain('e3');
    });

    it('respects depth limit', () => {
      // Depth 0 should only return the start entity
      const results = graphTraversal('e1', 0, 10);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('e1');
    });

    it('respects maxNodes limit', () => {
      const results = graphTraversal('e1', 5, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('assembleContext', () => {
    it('returns context with entities and relations', async () => {
      const ctx = await assembleContext('military assets', 34.05, -118.24, 50);
      expect(ctx.query).toBe('military assets');
      expect(ctx.entities.length).toBeGreaterThan(0);
      expect(ctx.relations.length).toBeGreaterThan(0);
      expect(ctx.contextText).toContain('military assets');
    });

    it('includes nearby entities in context text', async () => {
      const ctx = await assembleContext('test query', 34.05, -118.24, 10);
      expect(ctx.contextText).toContain('Base Alpha');
    });

    it('returns confidence based on entity count', async () => {
      const ctx = await assembleContext('q', 34.05, -118.24, 50);
      expect(ctx.confidence).toBeGreaterThan(0);
      expect(ctx.confidence).toBeLessThanOrEqual(1);
    });
  });
});
