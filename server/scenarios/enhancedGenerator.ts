import { randomUUID } from 'crypto';
import fs from 'fs';
import { type ScenarioType, type ScenarioBase } from './templates';
import { generateScenario } from './scenarioGenerator';
import { fetchRealDataForBBox, deriveParams, type BBox } from '../simulation/realDataBridge';
import { openFile, readVariable, subsetGrid, gridToPointCloud, closeFile, type GridSubset } from '../grid/netcdfReader';

const WLDAS_PATH = process.env.WLDAS_NC_PATH || '';

const HAZARD_TO_NC_VARS: Record<string, string[]> = {
  wildfire_spread: ['SoilMoi00_10cm_tavg', 'Wind_f_tavg', 'VegT_tavg', 'Swnet_tavg', 'Lwnet_tavg'],
  flood_inundation: ['Rainf_tavg', 'SoilMoi00_10cm_tavg', 'Qs_tavg', 'Qsb_tavg'],
  hurricane_landfall: ['Psurf_f_tavg', 'Wind_f_tavg', 'Qair_f_tavg', 'Tair_f_tavg'],
  earthquake_swarm: [],  // earthquakes use USGS data, not NC
  volcanic_eruption: ['Swnet_tavg', 'Lwnet_tavg', 'Qair_f_tavg'],
  tsunami_wave: [],  // tsunamis use USGS data
};

function computeStats(vals: number[]): { min: number; max: number; avg: number; median: number } {
  if (vals.length === 0) return { min: 0, max: 0, avg: 0, median: 0 };
  const sorted = [...vals].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: vals.reduce((s, v) => s + v, 0) / vals.length,
    median: sorted[Math.floor(sorted.length / 2)],
  };
}

export interface EnhancedScenario extends ScenarioBase {
  colorValues?: number[];
  valueMin?: number;
  valueMax?: number;
  variableName?: string;
  dataSources: string[];
  bbox: BBox;
}

export async function generateScenarioFromBBox(
  hazardType: string,
  bbox: BBox,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<EnhancedScenario> {
  const dataSources: string[] = [];

  const isNcLayer = hazardType === 'data_layer';

  // If pure NC data layer, skip real data and synthetic generation
  if (isNcLayer) {
    try {
      if (WLDAS_PATH && fs.existsSync(WLDAS_PATH)) {
        const h5 = await openFile(WLDAS_PATH);
        const latVar = readVariable(h5, 'lat');
        const lonVar = readVariable(h5, 'lon');
        const coordKeys = new Set(['lat', 'lon', 'latitude', 'longitude', 'time', 'bnds', 'time_bnds', 'crs']);
        const chosenVar = h5.keys.find((k: string) => !coordKeys.has(k)) || '';
        if (chosenVar && latVar && lonVar) {
          const rawData = readVariable(h5, chosenVar);
          if (rawData && rawData.length > 0) {
            const gridSubset = subsetGrid(latVar, lonVar, rawData, chosenVar, bbox, 8000);
            const pointCloud = gridToPointCloud(gridSubset);
            const values = gridSubset.values;
            const stats = computeStats(values);
            closeFile(h5);
            dataSources.push(`netcdf-${chosenVar}`);
            return {
              id: `scenario_${randomUUID().slice(0, 8)}`,
              type: 'data_layer',
              params: {},
              location: { lat: (bbox.latMin + bbox.latMax) / 2, lon: (bbox.lonMin + bbox.lonMax) / 2 },
              pointCloud,
              validationScore: 0.85,
              createdAt: new Date().toISOString(),
              dataSources,
              bbox,
              colorValues: values,
              valueMin: gridSubset.valueMin,
              valueMax: gridSubset.valueMax,
              variableName: chosenVar,
              metadata: {
                validation: { model: 'netcdf-layer', score: 0.85 },
                realData: { netcdfVariable: chosenVar, dataSources, bbox },
                stats: {
                  min: stats.min.toFixed(2),
                  max: stats.max.toFixed(2),
                  avg: stats.avg.toFixed(2),
                  median: stats.median.toFixed(2),
                },
                isLayer: true,
              },
            };
          }
        }
        closeFile(h5);
      }
    } catch { /* noop */ }
    // Fallback: return empty point cloud
    return {
      id: `scenario_${randomUUID().slice(0, 8)}`,
      type: 'data_layer',
      params: {},
      location: { lat: (bbox.latMin + bbox.latMax) / 2, lon: (bbox.lonMin + bbox.lonMax) / 2 },
      pointCloud: [],
      validationScore: 0,
      createdAt: new Date().toISOString(),
      dataSources: [],
      bbox,
      metadata: { isLayer: true, error: 'NetCDF file not found or variable missing' },
    };
  }

  // Step 1: Fetch real data from all available APIs
  const realData = await fetchRealDataForBBox(bbox);
  for (const src of ['earthquakes', 'weather', 'fires', 'volcanoes', 'eonet', 'gdacs'] as const) {
    if ((realData[src] as unknown as unknown[]).length > 0) dataSources.push(src);
  }

  // Step 2: Derive simulation parameters from real data
  const derived = deriveParams(realData, hazardType);
  const mergedParams = { ...derived.params, ...overrides };
  dataSources.push(...derived.dataSources);

  // Step 3: Generate the base synthetic point cloud
  const syntheticScenario = await generateScenario(hazardType as ScenarioType, mergedParams);

  // Step 4: Try to augment with NetCDF gridded data for environmental context
  let colorValues: number[] | undefined;
  let valueMin: number | undefined;
  let valueMax: number | undefined;
  let variableName: string | undefined;
  let gridSubset: GridSubset | null = null;    try {
    if (WLDAS_PATH && fs.existsSync(WLDAS_PATH)) {
      const ncVars = HAZARD_TO_NC_VARS[hazardType] || [];
      const h5 = await openFile(WLDAS_PATH);
      const latVar = readVariable(h5, 'lat');
      const lonVar = readVariable(h5, 'lon');

      // Pick the first matching variable that exists in the file
      let chosenVar = '';
      for (const v of ncVars) {
        if (v && h5.keys.includes(v)) { chosenVar = v; break; }
      }
      if (!chosenVar) {
        // Fallback: pick first non-coordinate variable
        const coordKeys = new Set(['lat', 'lon', 'latitude', 'longitude', 'time', 'bnds', 'time_bnds', 'crs']);
        chosenVar = h5.keys.find(k => !coordKeys.has(k)) || '';
      }

      if (chosenVar && latVar && lonVar) {
        const rawData = readVariable(h5, chosenVar);
        if (rawData && rawData.length > 0) {
          gridSubset = subsetGrid(latVar, lonVar, rawData, chosenVar, bbox, 5000);
          colorValues = gridSubset.values;
          valueMin = gridSubset.valueMin;
          valueMax = gridSubset.valueMax;
          variableName = gridSubset.variableName;
          dataSources.push(`netcdf-${chosenVar}`);
        }
      }
      closeFile(h5);
    }
  } catch { /* noop */ }

  // Step 5: Build enhanced scenario
  const stats = colorValues ? computeStats(colorValues) : null;
  const id = `scenario_${randomUUID().slice(0, 8)}`;

  return {
    id,
    type: hazardType as ScenarioType,
    params: mergedParams,
    location: { lat: (bbox.latMin + bbox.latMax) / 2, lon: (bbox.lonMin + bbox.lonMax) / 2 },
    pointCloud: syntheticScenario.pointCloud,
    validationScore: syntheticScenario.validationScore,
    createdAt: new Date().toISOString(),
    dataSources,
    bbox,
    colorValues,
    valueMin,
    valueMax,
    variableName,
    timeSeries: syntheticScenario.timeSeries,
    metadata: {
      validation: syntheticScenario.metadata.validation,
      realData: {
        earthquakes: realData.earthquakes.length,
        weather: realData.weather.length > 0,
        fires: realData.fires.length,
        volcanoes: realData.volcanoes.length,
        eonetEvents: realData.eonet.length,
        gdacsAlerts: realData.gdacs.length,
        netcdfVariable: variableName,
        dataSources,
      },
      stats: stats ? {
        min: stats.min.toFixed(2),
        max: stats.max.toFixed(2),
        avg: stats.avg.toFixed(2),
        median: stats.median.toFixed(2),
      } : undefined,
    },
  };
}
