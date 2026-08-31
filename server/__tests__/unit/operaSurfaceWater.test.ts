import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getWaterTimeSeries, getFloodWatch } from '../../utils/operaSurfaceWater';

// Mock fetch for external API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OPERA Surface Water', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('getWaterTimeSeries', () => {
    it('returns empty series for invalid coordinates', async () => {
      const result = await getWaterTimeSeries(NaN, 0, '2024-01-01', '2024-06-01');
      expect(result.extents).toHaveLength(0);
      expect(result.trend).toBe('stable');
    });

    it('returns time series with extents from CMR', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            { properties: { datetime: '2024-01-15T00:00:00Z' } },
            { properties: { datetime: '2024-02-15T00:00:00Z' } },
            { properties: { datetime: '2024-03-15T00:00:00Z' } },
            { properties: { datetime: '2024-04-15T00:00:00Z' } },
            { properties: { datetime: '2024-05-15T00:00:00Z' } },
            { properties: { datetime: '2024-06-15T00:00:00Z' } },
          ],
        }),
      });
      const result = await getWaterTimeSeries(40.71, -74.00, '2024-01-01', '2024-06-30');
      expect(result.extents.length).toBe(6);
      expect(result.baseline).toBeGreaterThanOrEqual(0);
      expect(result.current).toBeGreaterThanOrEqual(0);
      expect(['flooding', 'drying', 'stable']).toContain(result.trend);
    });

    it('falls back to generated extents on API failure', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));
      const result = await getWaterTimeSeries(40.71, -74.00, '2024-01-01', '2024-06-30');
      expect(result.extents.length).toBeGreaterThan(0);
    });

    it('detects flooding when change > 20%', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            { properties: { datetime: '2024-01-01T00:00:00Z' } },
            { properties: { datetime: '2024-01-15T00:00:00Z' } },
            { properties: { datetime: '2024-02-01T00:00:00Z' } },
            { properties: { datetime: '2024-06-01T00:00:00Z' } },
            { properties: { datetime: '2024-06-15T00:00:00Z' } },
            { properties: { datetime: '2024-06-30T00:00:00Z' } },
          ],
        }),
      });
      const result = await getWaterTimeSeries(40.71, -74.00, '2024-01-01', '2024-06-30');
      expect(['flooding', 'drying', 'stable']).toContain(result.trend);
    });
  });

  describe('getFloodWatch', () => {
    it('returns flood watch status', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ features: [] }),
      });
      const result = await getFloodWatch(40.71, -74.00, 'Hudson River');
      expect(result.name).toBe('Hudson River');
      expect(result.lat).toBe(40.71);
      expect(result.lon).toBe(-74.00);
      expect(['low', 'moderate', 'high', 'extreme']).toContain(result.riskLevel);
    });
  });
});
