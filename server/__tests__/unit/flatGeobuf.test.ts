import { describe, expect, it } from 'vitest';
import { geojsonToFgbPayload, estimateSize } from '../../utils/flatGeobuf';

describe('FlatGeobuf utilities', () => {
  describe('geojsonToFgbPayload', () => {
    it('converts GeoJSON FeatureCollection to internal format', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { name: 'Test' },
          },
        ],
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = geojsonToFgbPayload(geojson as any);
      expect(result.type).toBe('FeatureCollection');
      expect(result.features).toHaveLength(1);
      expect(result.features[0].properties.name).toBe('Test');
    });

    it('handles empty features', () => {
      const result = geojsonToFgbPayload({ type: 'FeatureCollection', features: [] });
      expect(result.count).toBe(0);
      expect(result.features).toEqual([]);
    });

    it('preserves geometry coordinates', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
            properties: { id: 42 },
          },
        ],
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = geojsonToFgbPayload(geojson as any);
      expect(result.features[0].geometry.type).toBe('Polygon');
    });
  });

  describe('estimateSize', () => {
    it('estimates FGB and GeoJSON sizes', () => {
      const { fgbBytes, geojsonBytes, compressionRatio } = estimateSize(1000);
      expect(fgbBytes).toBeGreaterThan(0);
      expect(geojsonBytes).toBeGreaterThan(0);
      expect(geojsonBytes).toBeGreaterThan(fgbBytes);
      expect(compressionRatio).toBeGreaterThan(1);
    });

    it('scales with feature count', () => {
      const small = estimateSize(100);
      const large = estimateSize(10000);
      expect(large.fgbBytes).toBeGreaterThan(small.fgbBytes);
      expect(large.geojsonBytes).toBeGreaterThan(small.geojsonBytes);
    });

    it('custom avgPropertiesBytes affects estimate', () => {
      const small = estimateSize(100, 50);
      const large = estimateSize(100, 500);
      expect(large.fgbBytes).toBeGreaterThan(small.fgbBytes);
    });
  });
});
