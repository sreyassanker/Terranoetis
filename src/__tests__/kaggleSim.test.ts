import { describe, expect, it } from 'vitest';
import {
  SimulationRequestSchema,
  buildSimulationRequest,
  deriveCenter,
  deriveExtentKm,
  derivePhysicsFormOverrides,
  type StudyAreaBbox,
} from '@/services/kaggleSim';

// A realistic bbox covering a ~1°×1° Houston metro block
const bbox: StudyAreaBbox = { latMin: 29.5, latMax: 30.0, lonMin: -95.5, lonMax: -95.0 };

describe('geometry', () => {
  it('deriveCenter: midpoint of bbox', () => {
    const { lat, lon } = deriveCenter(bbox);
    expect(lat).toBeCloseTo(29.75, 6);
    expect(lon).toBeCloseTo(-95.25, 6);
  });

  it('deriveExtentKm: positive and bounded by degree math', () => {
    const extent = deriveExtentKm(bbox);
    // 0.5° of lat is ~55.5 km; lon shrinks with cos(lat)
    expect(extent).toBeGreaterThan(50);
    expect(extent).toBeLessThan(70);
  });

  it('deriveExtentKm: always ≥ 1 km even for a point', () => {
    const point = deriveExtentKm({ latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 });
    expect(point).toBe(1);
  });
});

describe('schema', () => {
  it('rejects out-of-range latitude', () => {
    const r = SimulationRequestSchema.safeParse({
      type: 'flood_inundation',
      lat: 100,
      lon: 0,
      grid_size: 256,
      extent_km: 10,
      rainfall_mm: 500,
      duration_hours: 24,
      soil_saturation: 0.8,
      dam_breach: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing required field (silently-faked input is impossible)', () => {
    const r = SimulationRequestSchema.safeParse({
      type: 'flood_inundation',
      lat: 29.76,
      lon: -95.37,
      grid_size: 256,
      extent_km: 10,
      // rainfall_mm is missing
      duration_hours: 24,
      soil_saturation: 0.8,
      dam_breach: true,
    });
    expect(r.success).toBe(false);
  });
});

describe('buildSimulationRequest', () => {
  it('flood: maps UI keys to wire keys faithfully', () => {
    const req = buildSimulationRequest(
      {
        scenarioType: 'flood_inundation',
        gridSize: 256,
        params: {
          rainfall: 500,
          duration: 72,
          soilSaturation: 0.8,
          windSpeed: 40,
        },
      },
      bbox,
    );
    if (req.type !== 'flood_inundation') throw new Error('wrong type');
    expect(req.type).toBe('flood_inundation');
    expect(req.rainfall_mm).toBe(500);
    expect(req.duration_hours).toBe(72);
    expect(req.soil_saturation).toBe(0.8);
    expect(req.dam_breach).toBe(true);
    // km/h → m/s conversion is a *deterministic* transform, not a fake default
    expect(req.wind_speed_ms).toBeCloseTo(40 / 3.6, 6);
  });

  it('wildfire: rejects unsupported fuel_type', () => {
    expect(() =>
      buildSimulationRequest(
        {
          scenarioType: 'wildfire_spread',
          gridSize: 256,
          params: {
            windSpeed: 20, windDir: 270, humidity: 15, duration: 72,
            fuelType: 'unknown_fuel_type',
          },
        },
        bbox,
      ),
    ).toThrow(/fuel_type/);
  });

  it('earthquake: throws on missing magnitude instead of fabricating a value', () => {
    expect(() =>
      buildSimulationRequest(
        {
          scenarioType: 'earthquake_swarm',
          gridSize: 256,
          params: { depthMax: 30 }, // magnitudeMax is missing
        },
        bbox,
      ),
    ).toThrow(/magnitudeMax/);
  });

  it('tsunami: schema enforces physically plausible bounds', () => {
    const ok = buildSimulationRequest(
      {
        scenarioType: 'tsunami_wave',
        gridSize: 256,
        params: { magnitude: 8.5, depth: 20, waveHeight: 15 },
      },
      bbox,
    );
    if (ok.type !== 'tsunami_wave') throw new Error('wrong type');
    expect(ok.magnitude).toBe(8.5);
    // waveHeight as seafloor displacement — the kernel reads displacement
    expect(ok.seafloor_displacement_m).toBe(15);

    expect(() =>
      buildSimulationRequest(
        {
          scenarioType: 'tsunami_wave',
          gridSize: 256,
          params: { magnitude: 15 /* implausible */, depth: 20, waveHeight: 10 },
        },
        bbox,
      ),
    ).toThrow();
  });
});

describe('derivePhysicsFormOverrides', () => {
  it('hurricane: category drives wind/pressure deterministically', () => {
    const p = derivePhysicsFormOverrides('hurricane_landfall', { category: 4 });
    expect(p.windSpeed).toBe(70);
    expect(p.pressure).toBe(930);
    expect(p.radius).toBe(90);
  });

  it('tsunami: displacement scales with M8.5 baseline', () => {
    const p = derivePhysicsFormOverrides('tsunami_wave', { magnitude: 8.5, depth: 20 });
    // displacement = 10^(8.5-6) * 5 ~= 1581
    expect(p.seafloorDisplacement).toBeGreaterThan(1000);
    expect(p.arrivalTime).toBeGreaterThan(0);
  });

  it('flood: SCS-CN produces physically signed runoff', () => {
    const p = derivePhysicsFormOverrides('flood_inundation', {
      rainfall: 500,
      catchmentArea: 2000,
      soilSaturation: 0.8,
      duration: 72,
    });
    expect(p.runoffDepth).toBeGreaterThan(0);
    expect(p.floodExtent).toBeGreaterThan(0);
  });
});
