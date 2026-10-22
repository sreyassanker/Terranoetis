import { describe, it, expect, vi } from 'vitest';

// Mock all external data fetchers to return fast fixture objects instantly
vi.mock('../../data/dataFetchers', () => ({
  fetchCurrentWeather: vi.fn().mockResolvedValue({ temperature_2m: 20, relative_humidity_2m: 50, surface_pressure: 1013, wind_speed_10m: 5, precipitation: 0 }),
  fetchCurrentWeatherMulti: vi.fn().mockResolvedValue([]),
  fetchHistoricalWeather: vi.fn().mockResolvedValue({ temperature_2m: 20, relative_humidity_2m: 50, surface_pressure: 1013, wind_speed_10m: 5, precipitation: 0 }),
  fetchMarineData: vi.fn().mockResolvedValue({ waveHeight: 1.5, wavePeriod: 8, waveDirection: 270, seaSurfaceTemp: 18 }),
  fetchAirQuality: vi.fn().mockResolvedValue({ aqi: 45, pm25: 12, pm10: 25, o3: 35, no2: 15, so2: 5, co: 400 }),
  fetchElevation: vi.fn().mockResolvedValue({ elevation: 50 }),
  fetchElevationsMulti: vi.fn().mockResolvedValue([50]),
  fetchEarthquakes: vi.fn().mockResolvedValue({ count: 1, maxMagnitude: 4.5, avgMagnitude: 3.2, avgDepth: 10, bValue: 1.0, aValue: 2.1, mcMagnitude: 2.5, omoriFit: null, events: [] }),
  fetchNearestEarthquakeRupture: vi.fn().mockResolvedValue(null),
  fetchSoilData: vi.fn().mockResolvedValue({ clay: 25, sand: 40, silt: 35, organic_carbon: 2.5, ph_h2o: 6.8, bulk_density: 1.3, cec: 18, texture_class: 'loam' }),
  fetchPopulation: vi.fn().mockResolvedValue(5000),
  fetchVegetationIndices: vi.fn().mockResolvedValue({ ndvi: 0.65, evi: 0.45, lai: 2.5, fpar: 0.7, landCover: 'cropland' }),
  fetchSeaIce: vi.fn().mockResolvedValue({ concentration: 0, extent: 0, thickness: 0 }),
  fetchTectonicContext: vi.fn().mockResolvedValue({ plateBoundary: false, faultProximity: 50, subductionZone: false, riftZone: false, transformBoundary: false }),
  fetchSpaceWeather: vi.fn().mockResolvedValue({ kpIndex: 2, dstIndex: -10, solarWindSpeed: 420, f107: 130, bZ: 1.5 }),
  fetchWaterData: vi.fn().mockResolvedValue({ streamflow: 25, gageHeight: 2.1, waterTemp: 15, conductivity: 250, dissolvedOxygen: 8.5 }),
  fetchLandCover: vi.fn().mockResolvedValue({ class: 'forest', code: 10, treeCover: 75, impervious: 5, cropland: 0, wetland: 0 }),
  fetchAnnualMaximaGumbel: vi.fn().mockResolvedValue(null),
  fetchTerrain: vi.fn().mockResolvedValue({ elevation: 50, slope: 5, aspect: 180, curvature: 0.01, hillshade: 180 }),
  fetchShorelineBearing: vi.fn().mockResolvedValue(90),
  fetchGlacierData: vi.fn().mockResolvedValue({ area: 0, volume: 0, massBalance: 0, equilibriumLine: 0 }),
  fetchVolcanoData: vi.fn().mockResolvedValue({ nearestVolcano: 'none', distance: 9999, alertLevel: 'unknown', recentActivity: false, lastEruption: 'unknown' }),
  fetchTropoDelay: vi.fn().mockResolvedValue({ zenithDelay: 2.4, wetDelay: 0.1, hydrostaticDelay: 2.3 }),
  fetchPermafrostData: vi.fn().mockResolvedValue({ activeLayerDepth: 0, permafrostProb: 0, groundTemp: 15 }),
  fetchDroughtData: vi.fn().mockResolvedValue({ pdsi: -0.5, precipitation: 500, temperature: 18, soilMoisture: 0.25, droughtClass: 'normal' }),
  fetchRiverData: vi.fn().mockResolvedValue({ discharge: 15, velocity: 1.2, width: 20, depth: 1.5, slope: 0.001 }),
  fetchEra5HighFidelity: vi.fn().mockResolvedValue({ frictionVelocity: 0.3, totalColumnWaterVapour: 25, surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null, source: 'ERA5' }),
  fetchFIRMSFires: vi.fn().mockResolvedValue([]),
  fetchStationObservations: vi.fn().mockResolvedValue({ obs: [], paramCd: '00010', unit: '°C' }),
  fetchRFactor: vi.fn().mockResolvedValue({ R: 150, annualPrecipMm: 600, station: 'SF DOWNTOWN', sid: '047772', stationLat: 37.77, stationLon: -122.42, distanceKm: 2 }),
  fetchGddStationData: vi.fn().mockResolvedValue(null),
  fetchGppModis: vi.fn().mockResolvedValue({ gpp: 5.5, quality: 'good' }),
  fetchCo2Gml: vi.fn().mockResolvedValue({ co2Ppm: 420, date: '2025-01-15' }),
  fetchAnnualGppModis: vi.fn().mockResolvedValue({ annualGpp: 1200 }),
  fetchSST: vi.fn().mockResolvedValue({ sst: 18.5, anomaly: 0.2 }),
}));

vi.mock('../../data/imerg', () => ({
  fetchImergPrecipitation: vi.fn().mockResolvedValue({ totalPrecipitation: 5.2, maxIntensity: 2.1, source: 'IMERG' }),
}));

vi.mock('../../data/gldas', () => ({
  fetchGldasData: vi.fn().mockResolvedValue({
    tkeDissipation: 0.01, soilMoisture0_10: 0.22, soilMoisture10_40: 0.25,
    soilMoisture40_100: 0.28, soilMoisture100_200: 0.30, groundwaterStorage: 150,
    snowWaterEquivalent: 0, canopyInterception: 0.5, surfaceTemp: 295, granuleTime: '2025-01-15', source: 'GLDAS',
  }),
  soilMoistureToVolumetric: vi.fn().mockReturnValue(0.25),
}));

vi.mock('../../data/pmelPco2', () => ({
  fetchPmelPco2: vi.fn().mockResolvedValue({ station: 'SF_BUOY', lat: 37.7, lon: -122.5, distanceKm: 15, dtDays: 0.5, pCO2_sw: 410, pCO2_air: 415, sst: 18.5, sss: 35 }),
}));

vi.mock('../../data/satelliteThermal', () => ({
  fetchLandsatThermal: vi.fn().mockResolvedValue({ bt10: 298, bt11: 296, surfaceTemperature: 295, emissivity: 0.98, ndvi: 0.6 }),
  fetchLandsatThermalGrid: vi.fn().mockResolvedValue(null),
  fetchColumnWaterVapor: vi.fn().mockResolvedValue(1.5),
  emissivityFromNdvi: vi.fn().mockReturnValue({ eps: 0.98, method: 'NDVI-threshold' }),
}));

vi.mock('../../data/oceanData', () => ({
  getOceanProfile: vi.fn().mockResolvedValue({ depths: [0, 50, 100], temps: [18, 15, 12], salinities: [35, 35.1, 35.2] }),
  computeN2: vi.fn().mockReturnValue(0.0001),
}));

vi.mock('../../data/noaaTides', () => ({
  fetchTidePrediction: vi.fn().mockResolvedValue({ station: { id: '9414290', name: 'San Francisco' }, heightM: 1.2, heightAboveMslM: 0.5, timestamp: '2025-01-15T12:00:00Z', datums: null, constituentCount: 4, schuremanHeightM: 1.2, harmonicTerms: [0.5, 0.3], harmonicNames: ['M2', 'S2'], source: 'noaa-coops-official-prediction' }),
}));

vi.mock('../../data/noaaSeaLevelTrend', () => ({
  fetchSeaLevelTrend: vi.fn().mockResolvedValue({ stationId: '9414290', trendMPerYr: 0.002, errorMPerYr: 0.0003 }),
  gmslRateDefault: 0.0034,
}));

vi.mock('../../kaggle/bathymetry', () => ({
  fetchGebco2020Elevations: vi.fn().mockResolvedValue([-50]),
}));

import { EQUATION_ENGINE, computeEquation } from '../../analytical-models/engine';
import { computeWithContext } from '../../analytical-models/contextEngine';
import { PARTS } from '../../../src/data/analyticalModels';

describe('Comprehensive Bounded Verification — All 150 Analytical Tools', () => {
  const allTools: Array<{ id: number; name: string; domain: string; defaultInputs: Record<string, number> }> = [];

  for (const part of PARTS) {
    for (const domain of part.domains) {
      for (const tool of domain.tools) {
        const defaultInputs: Record<string, number> = {};
        if (tool.inputs) {
          for (const inp of tool.inputs) {
            if (inp.default !== null && typeof inp.default === 'number') {
              defaultInputs[inp.symbol] = inp.default;
            }
          }
        }
        allTools.push({
          id: tool.id,
          name: tool.name,
          domain: domain.name,
          defaultInputs,
        });
      }
    }
  }

  it('verifies all 150 tools are registered in EQUATION_ENGINE', () => {
    expect(allTools.length).toBe(150);
    for (const tool of allTools) {
      expect(EQUATION_ENGINE[tool.id], `Tool ${tool.id} missing in engine`).toBeDefined();
    }
  });

  it('verifies all 150 tools execute safely without crashing on empty inputs (resilience)', () => {
    for (const tool of allTools) {
      let res;
      expect(() => {
        res = computeEquation(tool.id, {});
      }, `Tool ${tool.id} threw on empty input`).not.toThrow();
      expect(res).toBeDefined();
      expect(res).not.toBeNull();
      expect(typeof res!.result).toBe('number');
    }
  });

  it('verifies all 150 tools execute safely on default inputs and return steps', () => {
    for (const tool of allTools) {
      const res = computeEquation(tool.id, tool.defaultInputs);
      expect(res).toBeDefined();
      expect(res).not.toBeNull();
      expect(typeof res!.result).toBe('number');
      expect(Array.isArray(res!.steps)).toBe(true);
      expect(res!.steps.length).toBeGreaterThan(0);
    }
  });

  it('verifies string input coercion works across sample tools', () => {
    const sampleIds = [1, 9, 21, 56, 81, 86, 87, 103, 118, 150];
    for (const id of sampleIds) {
      const tool = allTools.find(t => t.id === id)!;
      const strInputs: Record<string, any> = {};
      for (const [k, v] of Object.entries(tool.defaultInputs)) {
        strInputs[k] = String(v);
      }
      expect(() => {
        const res = computeEquation(id, strInputs);
        expect(res).toBeDefined();
      }).not.toThrow();
    }
  });

  const CONTEXT = {
    studyArea: {
      mode: 'point' as const,
      point: [37.7749, -122.4194] as [number, number],
      bbox: [[37.7, -122.5], [37.8, -122.4]] as [[number, number], [number, number]],
      twoPoints: [[37.7, -122.5], [37.8, -122.4]] as [[number, number], [number, number]],
    },
    time: {
      start: '2025-01-15',
      end: '2025-01-15',
      granularity: 'instant' as const,
    },
  };

  it('verifies computeWithContext executes cleanly for all 150 tools via bounded pipeline', async () => {
    let successCount = 0;
    for (const tool of allTools) {
      let res;
      try {
        res = await computeWithContext(tool.id, {}, CONTEXT);
      } catch (err: any) {
        console.error('Stack trace for tool ' + tool.id + ':', err?.stack);
        expect.fail(`Tool ${tool.id} (${tool.name}) threw an unhandled error: ${err}`);
      }
      expect(res, `Tool ${tool.id} returned null`).not.toBeNull();
      expect(typeof res!.result).toBe('number');
      successCount++;
    }
    expect(successCount).toBe(150);
  }, 30000);
});
