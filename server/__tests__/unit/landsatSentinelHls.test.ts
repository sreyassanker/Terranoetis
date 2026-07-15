import { describe, expect, it, vi } from 'vitest';
import { searchHlsScenes, getTimeSeries } from '../../utils/landsatSentinelHls';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Landsat + Sentinel HLS', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('searchHlsScenes', () => {
    it('returns empty for invalid coordinates', async () => {
      const scenes = await searchHlsScenes({ lat: NaN, lon: 0, startDate: '2024-01-01', endDate: '2024-06-01' });
      expect(scenes).toEqual([]);
    });

    it('fetches scenes from CMR STAC', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              id: 'hls_scene_1',
              collection: 'HLSS30',
              properties: { datetime: '2024-06-15T00:00:00Z', 'eo:cloud_cover': 10 },
              assets: { B02: { href: 's3://bucket/B02.tif' } },
              geometry: { coordinates: [[[40.71, -74.00]]] },
            },
          ],
        }),
      });
      const scenes = await searchHlsScenes({ lat: 40.71, lon: -74.00, startDate: '2024-06-01', endDate: '2024-06-30' });
      expect(scenes.length).toBe(1);
      expect(scenes[0].id).toBe('hls_scene_1');
      expect(scenes[0].cloudCover).toBe(10);
    });

    it('filters by cloud cover', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            { id: 'a', collection: 'HLSS30', properties: { datetime: '2024-06-15T00:00:00Z', 'eo:cloud_cover': 5 }, assets: {}, geometry: null },
            { id: 'b', collection: 'HLSS30', properties: { datetime: '2024-06-16T00:00:00Z', 'eo:cloud_cover': 80 }, assets: {}, geometry: null },
          ],
        }),
      });
      const scenes = await searchHlsScenes({ lat: 40.71, lon: -74.00, startDate: '2024-06-01', endDate: '2024-06-30', cloudMax: 20 });
      expect(scenes.length).toBe(1);
      expect(scenes[0].id).toBe('a');
    });

    it('returns fallback scenes on API failure', async () => {
      mockFetch.mockRejectedValue(new Error('timeout'));
      const scenes = await searchHlsScenes({ lat: 40.71, lon: -74.00, startDate: '2024-01-01', endDate: '2024-06-30' });
      expect(scenes.length).toBeGreaterThan(0);
    });
  });

  describe('getTimeSeries', () => {
    it('returns time series with scenes and stats', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ features: [] }),
      });
      const ts = await getTimeSeries(40.71, -74.00, '2024-01-01', '2024-06-30', 'NDVI');
      expect(ts.lat).toBe(40.71);
      expect(ts.lon).toBe(-74.00);
      expect(ts.dateRange.start).toBe('2024-01-01');
      expect(ts.dateRange.end).toBe('2024-06-30');
      expect(ts.scenes).toBeDefined();
    });
  });
});
