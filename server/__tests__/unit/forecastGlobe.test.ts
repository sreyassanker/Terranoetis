import { describe, it, expect } from 'vitest';
import { buildForecastGlobeCommands, type ForecastPredLike } from '../../world-model/forecastGlobe';

const preds: ForecastPredLike[] = [
  { hazardType: 'earthquake', probability: 0.32, severity: 'low', timeframe: '7 days', confidence: 0.74 },
  { hazardType: 'aftershock', probability: 0.99, severity: 'high', timeframe: '7 days', confidence: 0.6 },
];

describe('buildForecastGlobeCommands (forecast on globe)', () => {
  const cmds = buildForecastGlobeCommands({ lat: 35.68, lon: 139.65, label: 'Tokyo' }, preds);

  it('emits a risk polygon + labeled pin, both tagged layer:forecast', () => {
    expect(cmds.map(c => c.action)).toEqual(['addPolygon', 'addPin']);
    expect(cmds[0].layer).toBe('forecast');
    expect(cmds[1].layer).toBe('forecast');
  });

  it('polygon is a closed 48-point ring within coordinate bounds', () => {
    const ring = cmds[0].coordinates as Array<[number, number]>;
    expect(ring).toHaveLength(48);
    for (const [lat, lon] of ring) {
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
  });

  it('labels the top prediction as a MODEL FORECAST with its probability', () => {
    // top by probability*confidence: aftershock 0.99*0.6=0.594 > earthquake 0.32*0.74=0.237
    const label = cmds[0].label as string;
    expect(label).toMatch(/MODEL FORECAST/);
    expect(label).toContain('aftershock');
    expect(label).toContain('99%');
    expect(label).toContain('7 days');
  });

  it('severity drives the fill color (high → red family)', () => {
    expect(cmds[0].color).toMatch(/rgba\(239,\s*68,\s*68/);
    expect(cmds[1].color).toBe('#ef4444');
  });

  it('wraps longitude across the antimeridian instead of producing >180', () => {
    const nearDateline = buildForecastGlobeCommands({ lat: 0, lon: 179.5 }, preds);
    for (const [lat, lon] of nearDateline[0].coordinates as Array<[number, number]>) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
  });

  it('returns nothing without a location or predictions', () => {
    expect(buildForecastGlobeCommands(null, preds)).toEqual([]);
    expect(buildForecastGlobeCommands({ lat: 35, lon: 139 }, [])).toEqual([]);
    expect(buildForecastGlobeCommands({ lat: NaN, lon: 139 }, preds)).toEqual([]);
  });
});
