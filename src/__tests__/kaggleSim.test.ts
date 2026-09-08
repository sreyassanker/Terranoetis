import { describe, expect, it } from 'vitest';
import {
  SimulationRequestSchema,
  buildSimulationRequest,
  computeVentFractions,
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

describe('computeVentFractions (volcano vent location regression)', () => {
  // Non-square study area (wider than tall) — the case that exposed the bug:
  // fractions were computed vs the bbox but the grid is a SQUARE of extent_km
  // centred on the bbox centroid, so the vent appeared shifted.
  const wideBbox: StudyAreaBbox = { latMin: 46.0, latMax: 46.4, lonMin: -122.6, lonMax: -121.8 };
  const vent = { lat: 46.35, lon: -121.9 }; // NE region of the bbox

  it('maps a vent back to the exact clicked location (round-trip)', () => {
    const vf = computeVentFractions(wideBbox, vent);
    expect(vf).not.toBeNull();
    const c = deriveCenter(wideBbox);
    const extentKm = deriveExtentKm(wideBbox);
    const latHalf = extentKm / 2 / 111;
    const lonHalf = extentKm / 2 / (111 * Math.max(0.1, Math.cos((c.lat * Math.PI) / 180)));
    const backLat = c.lat + latHalf - vf!.vent_frac_y * 2 * latHalf;
    const backLon = c.lon - lonHalf + vf!.vent_frac_x * 2 * lonHalf;
    expect(backLat).toBeCloseTo(vent.lat, 3);
    expect(backLon).toBeCloseTo(vent.lon, 3);
  });

  it('is clamped into [0,1] even for a vent at the bbox corner', () => {
    const corner = computeVentFractions(wideBbox, { lat: 46.4, lon: -122.6 });
    expect(corner!.vent_frac_x).toBeGreaterThanOrEqual(0);
    expect(corner!.vent_frac_x).toBeLessThanOrEqual(1);
    expect(corner!.vent_frac_y).toBeGreaterThanOrEqual(0);
    expect(corner!.vent_frac_y).toBeLessThanOrEqual(1);
  });

  it('differs from the OLD bbox-relative fraction (regression: was ~0.125, now ~0.23)', () => {
    const vf = computeVentFractions(wideBbox, vent);
    // Old buggy fy = (latMax - lat)/latSpan = 0.4/0.4 = ... wait, 46.4-46.35=0.05/0.4=0.125
    const oldFy = (wideBbox.latMax - vent.lat) / (wideBbox.latMax - wideBbox.latMin);
    expect(vf!.vent_frac_y).not.toBeCloseTo(oldFy, 3); // must differ from the buggy frame
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

  it('tsunami: derived form defaults stay within the wire schema', () => {
    const derived = derivePhysicsFormOverrides('tsunami_wave', {
      magnitude: 8.5,
      depth: 20,
      waveHeight: 15,
    });

    const req = buildSimulationRequest(
      {
        scenarioType: 'tsunami_wave',
        gridSize: 256,
        params: derived,
      },
      bbox,
    );

    if (req.type !== 'tsunami_wave') throw new Error('wrong type');
    expect(req.seafloor_displacement_m).toBeLessThanOrEqual(40);
    expect(req.seafloor_displacement_m).toBeGreaterThan(0);
  });

  it('tsunami: schema accepts optional benchmark stations', () => {
    const r = SimulationRequestSchema.safeParse({
      type: 'tsunami_wave',
      lat: 35,
      lon: 140,
      grid_size: 256,
      extent_km: 100,
      magnitude: 8.5,
      seafloor_displacement_m: 5,
      duration_minutes: 30,
      bathymetry: [120, 120, 120, 120],
      bathy_gs: 2,
      benchmark_stations: [{
        name: 'NDBC-01',
        row: 10,
        col: 12,
        observed_times_min: [0, 10, 20],
        observed_eta_m: [0.0, 0.3, 0.1],
        arrival_threshold_m: 0.1,
      }],
    });
    expect(r.success).toBe(true);
  });

  it('landslide: scientific knobs pass through (μ, ξ, entrainment, thresholds)', () => {
    const req = buildSimulationRequest(
      {
        scenarioType: 'landslide',
        gridSize: 256,
        params: {
          triggerType: 'earthquake', magnitude: 6.5, pgaThreshold: 0.15,
          rainfall: 200, frictionAngle: 35, cohesion: 500, duration: 2,
          mu: 0.25, xi: 300, entrainmentRate: 0.002, erodibleDepthM: 5,
          rainfallThreshold: 150,
        },
      },
      bbox,
    );
    if (req.type !== 'landslide') throw new Error('wrong type');
    expect(req.mu).toBe(0.25);
    expect(req.xi).toBe(300);
    expect(req.entrainment_rate).toBe(0.002);
    expect(req.erodible_depth_m).toBe(5);
    expect(req.rainfall_threshold).toBe(150);
  });

  it('landslide: optional scientific knobs are omitted, not fabricated', () => {
    const req = buildSimulationRequest(
      {
        scenarioType: 'landslide',
        gridSize: 256,
        params: {
          triggerType: 'earthquake', magnitude: 6.5, pgaThreshold: 0.15,
          rainfall: 200, frictionAngle: 35, cohesion: 500, duration: 2,
          // mu/xi/entrainment intentionally absent
        },
      },
      bbox,
    );
    if (req.type !== 'landslide') throw new Error('wrong type');
    expect(req.mu).toBeUndefined();
    expect(req.xi).toBeUndefined();
    expect(req.entrainment_rate).toBeUndefined();
  });

  it('landslide: schema rejects implausible Voellmy friction', () => {
    const r = SimulationRequestSchema.safeParse({
      type: 'landslide', lat: 29.76, lon: -95.37, grid_size: 256, extent_km: 10,
      trigger_type: 'earthquake', magnitude: 6.5, pga_threshold: 0.15,
      rainfall_mm: 200, friction_angle: 35, cohesion: 500, duration_hours: 2,
      mu: 5 /* Coulomb friction can't exceed 1 */,
    });
    expect(r.success).toBe(false);
  });

  it('hurricane: "Hours to Landfall" is the eye-arrival time, not the run length', () => {
    // The kernel centres the track at MID-duration, so a 24 h lead time must
    // produce a 48 h run — otherwise landfall happens at t=12 h (the old bug).
    const req = buildSimulationRequest(
      {
        scenarioType: 'hurricane_landfall',
        gridSize: 256,
        params: {
          category: 3, forwardSpeed: 15, pressure: 950, radius: 50,
          landfallTime: 24,
        },
      },
      bbox,
    );
    if (req.type !== 'hurricane_landfall') throw new Error('wrong type');
    expect(req.duration_hours).toBe(48);
    expect(req.category).toBe(3);
    expect(req.central_pressure_hpa).toBe(950);
  });

  it('hurricane: manual heading passes through; auto (omitted) drops heading_deg', () => {
    const manual = buildSimulationRequest(
      {
        scenarioType: 'hurricane_landfall',
        gridSize: 256,
        params: {
          category: 3, forwardSpeed: 15, pressure: 950, radius: 50,
          landfallTime: 24, heading: 45,
        },
      },
      bbox,
    );
    if (manual.type !== 'hurricane_landfall') throw new Error('wrong type');
    expect(manual.heading_deg).toBe(45);

    const auto = buildSimulationRequest(
      {
        scenarioType: 'hurricane_landfall',
        gridSize: 256,
        params: {
          category: 3, forwardSpeed: 15, pressure: 950, radius: 50,
          landfallTime: 24, // heading intentionally absent → kernel auto-aims
        },
      },
      bbox,
    );
    if (auto.type !== 'hurricane_landfall') throw new Error('wrong type');
    expect(auto.heading_deg).toBeUndefined();
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
    expect(p.seafloorDisplacement).toBeLessThanOrEqual(40);
    expect(p.seafloorDisplacement).toBeGreaterThan(0);
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
