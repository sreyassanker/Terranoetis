/**
 * Analysis Engine — computes impact using turf.js and generates
 * globe commands + chart data for any scenario.
 */

import * as turf from '@turf/turf';
import type { RegionData, ElevationPoint } from './dataFetch';
import type { GlobeCommand } from '../agent';
import type { PanelData } from '../agent';

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface AnalysisResult {
  scenarioType: string;
  title: string;
  summary: string;
  affectedAreaKm2: number;
  affectedPopulation: number;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  globeCommands: GlobeCommand[];
  panelData: PanelData;
  affectedInfrastructure: { type: string; name: string; lat: number; lon: number; risk: string }[];
}

// ═══════════════════════════════════════════════════════════════════════
// SCENARIO DETECTION — parse user query for scenario type + params
// ═══════════════════════════════════════════════════════════════════════

export interface ScenarioParams {
  type: string;
  value?: number;
  unit?: string;
}

export function detectScenario(query: string): ScenarioParams {
  const lower = query.toLowerCase();

  // Sea level rise / inundation
  const slrMatch = lower.match(/(\d+)\s*m\s*(?:sea level|rise|flood|inundat)/);
  if (slrMatch) return { type: 'inundation', value: parseInt(slrMatch[1]), unit: 'meters' };

  if (/\b(sea level|inundat|flood|submerg|coastal flood)\b/.test(lower)) {
    const numMatch = lower.match(/(\d+)\s*(?:m|meter|metre|ft|feet)/);
    return { type: 'inundation', value: numMatch ? parseInt(numMatch[1]) : 5, unit: 'meters' };
  }

  // Earthquake damage
  const magMatch = lower.match(/m(?:agnitude)?\s*(\d+\.?\d*)/);
  if (/\b(earthquake|seismic|quake|shakemap|damage.*earthquake)\b/.test(lower)) {
    return { type: 'earthquake', value: magMatch ? parseFloat(magMatch[1]) : 6.0, unit: 'magnitude' };
  }

  // Wildfire spread
  if (/\b(wildfire|fire spread|burn area|fire.*zone)\b/.test(lower)) {
    return { type: 'wildfire', value: 10, unit: 'km radius' };
  }

  // Storm surge
  const windMatch = lower.match(/(\d+)\s*(?:km\/h|kph|mph|knots?)\s*(?:wind|storm|hurricane|cyclone)/);
  if (/\b(storm surge|hurricane|cyclone|typhoon|storm.*impact)\b/.test(lower)) {
    return { type: 'storm', value: windMatch ? parseInt(windMatch[1]) : 120, unit: 'km/h wind' };
  }

  // Pollution / dispersion
  if (/\b(pollution|contaminat|toxic|chemical|gas leak|plume|dispersion)\b/.test(lower)) {
    return { type: 'pollution', value: 10, unit: 'km radius' };
  }

  // Generic impact analysis — default to inundation with 5m
  if (/\b(impact|damage|risk|what if|simulate|scenario)\b/.test(lower)) {
    return { type: 'inundation', value: 5, unit: 'meters' };
  }

  return { type: 'inundation', value: 5, unit: 'meters' };
}

// ═══════════════════════════════════════════════════════════════════════
// ELEVATION GRID — convert point array to 2D grid for analysis
// ═══════════════════════════════════════════════════════════════════════

function buildElevationGrid(points: ElevationPoint[]): {
  grid: number[][];
  latMin: number;
  lonMin: number;
  latStep: number;
  lonStep: number;
  rows: number;
  cols: number;
} {
  if (points.length === 0) {
    return { grid: [], latMin: 0, lonMin: 0, latStep: 0, lonStep: 0, rows: 0, cols: 0 };
  }

  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  const latStep = (latMax - latMin) / 50;
  const lonStep = (lonMax - lonMin) / 50;
  const rows = 51;
  const cols = 51;

  const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (const p of points) {
    const row = Math.min(rows - 1, Math.max(0, Math.round((p.lat - latMin) / latStep)));
    const col = Math.min(cols - 1, Math.max(0, Math.round((p.lon - lonMin) / lonStep)));
    grid[row][col] = p.elev;
  }

  return { grid, latMin, lonMin, latStep, lonStep, rows, cols };
}

// ═══════════════════════════════════════════════════════════════════════
// INUNDATION ANALYSIS
// ═══════════════════════════════════════════════════════════════════════

function analyzeInundation(
  region: RegionData,
  waterLevelM: number,
): AnalysisResult {
  const { grid, latMin, lonMin, latStep, lonStep, rows, cols } = buildElevationGrid(region.elevation);

  // Find flooded cells
  const floodedCells: [number, number][] = [];
  let floodedAreaCount = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const elev = grid[r]?.[c] ?? 0;
      if (elev > 0 && elev <= waterLevelM) {
        floodedCells.push([r, c]);
        floodedAreaCount++;
      }
    }
  }

  // Convert to GeoJSON polygon coordinates
  const cellKm2 = (latStep * 111) * (lonStep * 111 * Math.cos((region.center.lat * Math.PI) / 180));
  const affectedAreaKm2 = floodedAreaCount * cellKm2;

  // Build flood polygon from flooded cell boundaries — [lat, lon] format for CesiumJS
  const floodCoords: [number, number][] = [];
  const turfCoords: [number, number][] = [];
  for (const [r, c] of floodedCells) {
    const lat = latMin + r * latStep;
    const lon = lonMin + c * lonStep;
    floodCoords.push([lat, lon]);
    turfCoords.push([lon, lat]); // turf.js uses [lon, lat]
  }

  // Compute convex hull of flooded points for clean polygon
  let floodPolygon: GeoJSON.Feature | null = null;
  if (turfCoords.length >= 3) {
    const pointsFC = turf.featureCollection(turfCoords.map(c => turf.point(c)));
    try {
      floodPolygon = turf.convex(pointsFC);
    } catch {
      // Not enough points for convex hull
    }
  }

  // Estimate affected population
  const populationRatio = Math.min(affectedAreaKm2 / (Math.PI * region.radiusKm * region.radiusKm), 1);
  const coastalWeight = 1.5; // Coastal areas are more densely populated
  const affectedPopulation = Math.round(region.population.total * populationRatio * coastalWeight);

  // Find infrastructure at risk
  const affectedInfrastructure: AnalysisResult['affectedInfrastructure'] = [];
  for (const h of region.infrastructure.hospitals) {
    const dist = turf.distance(turf.point([region.center.lon, region.center.lat]), turf.point([h.lon, h.lat]), { units: 'kilometers' });
    if (dist <= region.radiusKm * 0.6) {
      affectedInfrastructure.push({ type: 'Hospital', name: h.name, lat: h.lat, lon: h.lon, risk: dist < 5 ? 'CRITICAL' : 'HIGH' });
    }
  }
  for (const s of region.infrastructure.schools) {
    const dist = turf.distance(turf.point([region.center.lon, region.center.lat]), turf.point([s.lon, s.lat]), { units: 'kilometers' });
    if (dist <= region.radiusKm * 0.6) {
      affectedInfrastructure.push({ type: 'School', name: s.name, lat: s.lat, lon: s.lon, risk: dist < 5 ? 'CRITICAL' : 'HIGH' });
    }
  }

  // Risk level
  const riskLevel: AnalysisResult['riskLevel'] =
    affectedPopulation > 500000 ? 'CRITICAL' :
    affectedPopulation > 100000 ? 'HIGH' :
    affectedPopulation > 20000 ? 'MODERATE' : 'LOW';

  // Globe commands
  const globeCommands: GlobeCommand[] = [
    { action: 'flyTo', lat: region.center.lat, lon: region.center.lon, label: region.boundaryName, zoom: 10 },
  ];

  // Add district boundary shapefile polygon
  if (region.boundary?.geometry) {
    const geom = region.boundary.geometry as GeoJSON.Geometry;
    if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
      const boundaryCoords = geom.coordinates[0].map((c: number[]) => [c[1], c[0]]);
      if (boundaryCoords.length >= 3) {
        globeCommands.push({
          action: 'addPolygon',
          coordinates: boundaryCoords,
          label: `${region.boundaryName} Boundary`,
          color: 'rgba(34, 197, 94, 0.4)',
        });
      }
    } else if (geom.type === 'MultiPolygon' && geom.coordinates?.[0]?.[0]) {
      const boundaryCoords = geom.coordinates[0][0].map((c: number[]) => [c[1], c[0]]);
      if (boundaryCoords.length >= 3) {
        globeCommands.push({
          action: 'addPolygon',
          coordinates: boundaryCoords,
          label: `${region.boundaryName} Boundary`,
          color: 'rgba(34, 197, 94, 0.15)',
        });
      }
    }
  }

  if (floodPolygon) {
    const floodGeoJSON = floodPolygon as GeoJSON.Feature<GeoJSON.Polygon>;
    // GeoJSON coords are [lon, lat] — convert to [lat, lon] for CesiumJS addPolygon
    const coords = floodGeoJSON.geometry?.coordinates[0]?.map((c: number[]) => [c[1], c[0]]) || [];
    if (coords.length > 0) {
      globeCommands.push({
        action: 'addPolygon',
        coordinates: coords,
        label: `Flood Zone (${waterLevelM}m)`,
        color: 'rgba(30, 90, 200, 0.35)',
        extrudedHeight: Math.min(waterLevelM * 3, 60),
      });
    }

    // Also add as GeoJSON for better rendering
    globeCommands.push({
      action: 'addGeoJSON',
      geojson: floodGeoJSON,
      label: `Inundation Area`,
      color: '#1e5ac8',
      extrudedHeight: waterLevelM * 5,
    });
  }

  // Add depth gradient zones (concentric flood rings)
  const depthZones = [
    { fraction: 0.3, color: 'rgba(30, 90, 200, 0.15)', label: 'Shallow (< 5m)' },
    { fraction: 0.6, color: 'rgba(25, 70, 180, 0.25)', label: 'Moderate (5-12m)' },
    { fraction: 0.9, color: 'rgba(20, 50, 160, 0.4)', label: 'Deep (> 12m)' },
  ];
  if (turfCoords.length >= 3) {
    for (const zone of depthZones) {
      try {
        const zoneRadius = affectedAreaKm2 > 0 ? Math.sqrt(affectedAreaKm2 * zone.fraction / Math.PI) : 5;
        const zoneKm = Math.min(zoneRadius, region.radiusKm * 0.8);
        const zoneCircle = turf.circle([region.center.lon, region.center.lat], zoneKm, { steps: 48, units: 'kilometers' });
        const zoneCoords = (zoneCircle.geometry as GeoJSON.Polygon)?.coordinates?.[0]?.map((c: number[]) => [c[1], c[0]]) || [];
        if (zoneCoords.length >= 3) {
          globeCommands.push({
            action: 'addPolygon',
            coordinates: zoneCoords,
            label: zone.label,
            color: zone.color,
            extrudedHeight: waterLevelM * zone.fraction * 3,
          });
        }
      } catch { /* skip failed zone */ }
    }
  }

  // Add infrastructure risk pins
  for (const infra of affectedInfrastructure.slice(0, 15)) {
    globeCommands.push({
      action: 'addPin',
      lat: infra.lat,
      lon: infra.lon,
      label: `${infra.type}: ${infra.name} (${infra.risk})`,
      color: infra.risk === 'CRITICAL' ? '#ef4444' : infra.risk === 'HIGH' ? '#f59e0b' : '#22c55e',
    });
  }

  // Chart data
  const chartData = generateInundationCharts(region, waterLevelM, affectedAreaKm2, affectedPopulation, affectedInfrastructure);

  return {
    scenarioType: 'inundation',
    title: `${waterLevelM}m Sea Level Rise — ${region.boundaryName}`,
    summary: `A ${waterLevelM}m sea level rise would flood ${affectedAreaKm2.toFixed(1)} km² of land, affecting approximately ${affectedPopulation.toLocaleString()} people. ${affectedInfrastructure.length} critical infrastructure points identified at risk.`,
    affectedAreaKm2,
    affectedPopulation,
    riskLevel,
    globeCommands,
    panelData: chartData,
    affectedInfrastructure,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// EARTHQUAKE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════

function analyzeEarthquake(
  region: RegionData,
  magnitude: number,
): AnalysisResult {
  // Simplified ShakeMap: MMI intensity decays with distance
  // MMI = -1.5 + 1.2*M - 0.006*D (approximate)
  const epicenter = [region.center.lon, region.center.lat];

  // Create damage zones as concentric circles
  const severeZone = turf.circle(epicenter, magnitude * 5, { steps: 64, units: 'kilometers' });
  const heavyZone = turf.circle(epicenter, magnitude * 15, { steps: 64, units: 'kilometers' });
  const moderateZone = turf.circle(epicenter, magnitude * 40, { steps: 64, units: 'kilometers' });

  const affectedAreaKm2 = turf.area(moderateZone) / 1e6;

  // Population affected (decays with distance)
  const popWeight = Math.min(magnitude / 8, 1);
  const affectedPopulation = Math.round(region.population.total * popWeight * 0.6);

  // Infrastructure at risk
  const affectedInfrastructure: AnalysisResult['affectedInfrastructure'] = [];
  for (const h of region.infrastructure.hospitals) {
    const dist = turf.distance(turf.point(epicenter), turf.point([h.lon, h.lat]), { units: 'kilometers' });
    let risk = 'LOW';
    if (dist < magnitude * 5) risk = 'CRITICAL';
    else if (dist < magnitude * 15) risk = 'HIGH';
    else if (dist < magnitude * 40) risk = 'MODERATE';
    if (risk !== 'LOW') {
      affectedInfrastructure.push({ type: 'Hospital', name: h.name, lat: h.lat, lon: h.lon, risk });
    }
  }

  const riskLevel: AnalysisResult['riskLevel'] =
    magnitude >= 7 ? 'CRITICAL' :
    magnitude >= 6 ? 'HIGH' :
    magnitude >= 5 ? 'MODERATE' : 'LOW';

  const coordsToPoly = (f: GeoJSON.Feature): number[][] => {
    const geom = f.geometry as GeoJSON.Polygon;
    const c = geom?.coordinates?.[0] || [];
    return c.map((p: number[]) => [p[1], p[0]]);
  };

  const globeCommands: GlobeCommand[] = [
    { action: 'flyTo', lat: region.center.lat, lon: region.center.lon, label: `M${magnitude} Epicenter`, zoom: 9 },
    { action: 'addPin', lat: region.center.lat, lon: region.center.lon, label: `Epicenter M${magnitude}`, color: '#ef4444' },
    { action: 'addPolygon', coordinates: coordsToPoly(severeZone), label: 'Severe Damage', color: 'rgba(239, 68, 68, 0.4)' },
    { action: 'addPolygon', coordinates: coordsToPoly(heavyZone), label: 'Heavy Damage', color: 'rgba(245, 158, 11, 0.3)' },
    { action: 'addPolygon', coordinates: coordsToPoly(moderateZone), label: 'Moderate Damage', color: 'rgba(234, 179, 8, 0.2)' },
  ];

  for (const infra of affectedInfrastructure.slice(0, 10)) {
    globeCommands.push({
      action: 'addPin', lat: infra.lat, lon: infra.lon,
      label: `${infra.name} (${infra.risk})`, color: infra.risk === 'CRITICAL' ? '#ef4444' : '#f59e0b',
    });
  }

  const chartData = generateEarthquakeCharts(region, magnitude, affectedAreaKm2, affectedPopulation, affectedInfrastructure);

  return {
    scenarioType: 'earthquake',
    title: `M${magnitude} Earthquake — ${region.boundaryName}`,
    summary: `A magnitude ${magnitude} earthquake would cause ${riskLevel.toLowerCase()} damage within ${Math.round(magnitude * 40)}km of the epicenter. Approximately ${affectedPopulation.toLocaleString()} people and ${affectedInfrastructure.length} critical facilities at risk.`,
    affectedAreaKm2,
    affectedPopulation,
    riskLevel,
    globeCommands,
    panelData: chartData,
    affectedInfrastructure,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// GENERIC ANALYSIS (wildfire, storm, pollution)
// ═══════════════════════════════════════════════════════════════════════

function analyzeGeneric(
  region: RegionData,
  params: ScenarioParams,
): AnalysisResult {
  const radiusKm = params.value || 10;
  const zone = turf.circle([region.center.lon, region.center.lat], radiusKm, { steps: 64, units: 'kilometers' });
  const affectedAreaKm2 = turf.area(zone) / 1e6;

  const populationRatio = Math.min(affectedAreaKm2 / (Math.PI * region.radiusKm * region.radiusKm), 1);
  const affectedPopulation = Math.round(region.population.total * populationRatio);

  const affectedInfrastructure: AnalysisResult['affectedInfrastructure'] = [];
  for (const h of region.infrastructure.hospitals) {
    const dist = turf.distance(turf.point([region.center.lon, region.center.lat]), turf.point([h.lon, h.lat]), { units: 'kilometers' });
    if (dist <= radiusKm) {
      affectedInfrastructure.push({ type: 'Hospital', name: h.name, lat: h.lat, lon: h.lon, risk: dist < radiusKm * 0.3 ? 'CRITICAL' : 'HIGH' });
    }
  }

  const riskLevel: AnalysisResult['riskLevel'] =
    affectedPopulation > 200000 ? 'HIGH' :
    affectedPopulation > 50000 ? 'MODERATE' : 'LOW';

  const coordsToPoly = (f: GeoJSON.Feature): number[][] => {
    const geom = f.geometry as GeoJSON.Polygon;
    const c = geom?.coordinates?.[0] || [];
    return c.map((p: number[]) => [p[1], p[0]]);
  };

  const colors: Record<string, string> = {
    wildfire: 'rgba(239, 68, 68, 0.35)',
    storm: 'rgba(99, 102, 241, 0.35)',
    pollution: 'rgba(168, 85, 247, 0.35)',
  };

  const globeCommands: GlobeCommand[] = [
    { action: 'flyTo', lat: region.center.lat, lon: region.center.lon, label: region.boundaryName, zoom: 10 },
    { action: 'addPolygon', coordinates: coordsToPoly(zone), label: `${params.type} Zone`, color: colors[params.type] || 'rgba(100,100,100,0.3)' },
  ];

  for (const infra of affectedInfrastructure.slice(0, 10)) {
    globeCommands.push({
      action: 'addPin', lat: infra.lat, lon: infra.lon,
      label: `${infra.name} (${infra.risk})`, color: infra.risk === 'CRITICAL' ? '#ef4444' : '#f59e0b',
    });
  }

  const chartData = generateGenericCharts(region, params, affectedAreaKm2, affectedPopulation, affectedInfrastructure);

  return {
    scenarioType: params.type,
    title: `${params.type.charAt(0).toUpperCase() + params.type.slice(1)} Scenario — ${region.boundaryName}`,
    summary: `${params.type} scenario affecting ${affectedAreaKm2.toFixed(1)} km². Approximately ${affectedPopulation.toLocaleString()} people and ${affectedInfrastructure.length} infrastructure points at risk.`,
    affectedAreaKm2,
    affectedPopulation,
    riskLevel,
    globeCommands,
    panelData: chartData,
    affectedInfrastructure,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// CHART GENERATORS
// ═══════════════════════════════════════════════════════════════════════

function generateInundationCharts(
  region: RegionData,
  waterLevel: number,
  affectedArea: number,
  affectedPop: number,
  infra: AnalysisResult['affectedInfrastructure'],
): PanelData {
  // Elevation profile — sample along a transect
  const transectData: { distance: string; elevation: number; waterLevel: number }[] = [];
  const sortedElev = [...region.elevation].sort((a, b) => a.lon - b.lon);
  const step = Math.max(Math.floor(sortedElev.length / 15), 1);
  for (let i = 0; i < sortedElev.length; i += step) {
    const p = sortedElev[i];
    const dist = turf.distance(turf.point([region.center.lon, region.center.lat]), turf.point([p.lon, p.lat]), { units: 'kilometers' });
    transectData.push({ distance: `${dist.toFixed(1)}km`, elevation: p.elev, waterLevel });
  }

  // Population by zone
  const popData = [
    { zone: 'Coastal (0-5m)', population: Math.round(affectedPop * 0.5) },
    { zone: 'Low-lying (5-10m)', population: Math.round(affectedPop * 0.3) },
    { zone: 'Moderate (10-20m)', population: Math.round(affectedPop * 0.15) },
    { zone: 'Inland (>20m)', population: Math.round(affectedPop * 0.05) },
  ];

  // Infrastructure breakdown
  const infraCounts: Record<string, number> = {};
  for (const i of infra) {
    infraCounts[i.type] = (infraCounts[i.type] || 0) + 1;
  }
  const infraData = Object.entries(infraCounts).map(([name, value]) => ({ name, value }));

  // Risk summary
  const riskCounts = { CRITICAL: 0, HIGH: 0, MODERATE: 0 };
  for (const i of infra) {
    if (i.risk in riskCounts) riskCounts[i.risk as keyof typeof riskCounts]++;
  }

  return {
    stats: [
      { label: 'Water Level', value: `${waterLevel}`, unit: 'meters', icon: '🌊' },
      { label: 'Area Flooded', value: affectedArea.toFixed(1), unit: 'km²', icon: '📐' },
      { label: 'People at Risk', value: affectedPop.toLocaleString(), unit: '', icon: '👥' },
      { label: 'Risk Level', value: affectedPop > 500000 ? 'CRITICAL' : affectedPop > 100000 ? 'HIGH' : 'MODERATE', unit: '', icon: '⚠️' },
    ],
    charts: [
      {
        type: 'area',
        title: 'Elevation Profile vs Water Level',
        data: transectData,
        keys: [
          { dataKey: 'elevation', color: '#8B4513', name: 'Terrain' },
          { dataKey: 'waterLevel', color: '#3B82F6', name: 'Water Level' },
        ],
      },
      {
        type: 'bar',
        title: 'Population at Risk by Zone',
        data: popData,
        keys: [{ dataKey: 'population', color: '#EF4444', name: 'Population' }],
      },
      {
        type: 'pie',
        title: 'Infrastructure at Risk',
        data: infraData.length > 0 ? infraData : [{ name: 'No data', value: 1 }],
        keys: [{ dataKey: 'value', color: '#F59E0B', name: 'Count' }],
      },
    ],
    table: {
      title: 'Critical Infrastructure',
      columns: ['Type', 'Name', 'Risk Level'],
      rows: infra.slice(0, 15).map(i => [i.type, i.name, i.risk]),
    },
    recommendations: [
      'Evacuate coastal wards within flood zone immediately',
      'Activate emergency shelters in elevated areas',
      'Deploy flood barriers at critical infrastructure',
      'Monitor real-time water levels via tide gauges',
      'Prepare emergency supply distribution points',
    ],
  };
}

function generateEarthquakeCharts(
  region: RegionData,
  magnitude: number,
  affectedArea: number,
  affectedPop: number,
  infra: AnalysisResult['affectedInfrastructure'],
): PanelData {
  const distData = Array.from({ length: 10 }, (_, i) => {
    const dist = (i + 1) * 10;
    const mmi = Math.max(1, Math.min(12, -1.5 + 1.2 * magnitude - 0.006 * dist));
    return { distance: `${dist}km`, mmi: parseFloat(mmi.toFixed(1)) };
  });

  const damageData = [
    { zone: 'Severe', structures: Math.round(affectedPop * 0.02) },
    { zone: 'Heavy', structures: Math.round(affectedPop * 0.08) },
    { zone: 'Moderate', structures: Math.round(affectedPop * 0.2) },
    { zone: 'Light', structures: Math.round(affectedPop * 0.4) },
  ];

  return {
    stats: [
      { label: 'Magnitude', value: `${magnitude}`, unit: 'Mw', icon: '🔴' },
      { label: 'Affected Area', value: affectedArea.toFixed(0), unit: 'km²', icon: '📐' },
      { label: 'People at Risk', value: affectedPop.toLocaleString(), unit: '', icon: '👥' },
      { label: 'Max Intensity', value: `MMI ${Math.min(12, Math.round(-1.5 + 1.2 * magnitude))}`, unit: '', icon: '📊' },
    ],
    charts: [
      {
        type: 'line',
        title: 'Shake Intensity vs Distance',
        data: distData,
        keys: [{ dataKey: 'mmi', color: '#EF4444', name: 'MMI Intensity' }],
      },
      {
        type: 'bar',
        title: 'Estimated Structural Damage',
        data: damageData,
        keys: [{ dataKey: 'structures', color: '#F59E0B', name: 'Structures' }],
      },
    ],
    table: {
      title: 'Infrastructure at Risk',
      columns: ['Type', 'Name', 'Risk Level'],
      rows: infra.slice(0, 15).map(i => [i.type, i.name, i.risk]),
    },
    recommendations: [
      'Search and rescue operations in severe damage zone',
      'Inspect all bridges and overpasses for structural damage',
      'Establish emergency medical stations at hospitals outside damage zone',
      'Shut down gas and electrical mains in affected areas',
      'Set up temporary shelters for displaced residents',
    ],
  };
}

function generateGenericCharts(
  region: RegionData,
  params: ScenarioParams,
  affectedArea: number,
  affectedPop: number,
  infra: AnalysisResult['affectedInfrastructure'],
): PanelData {
  return {
    stats: [
      { label: 'Scenario', value: params.type, unit: '', icon: '🔮' },
      { label: 'Affected Area', value: affectedArea.toFixed(1), unit: 'km²', icon: '📐' },
      { label: 'People at Risk', value: affectedPop.toLocaleString(), unit: '', icon: '👥' },
      { label: 'Facilities at Risk', value: `${infra.length}`, unit: '', icon: '🏗️' },
    ],
    charts: [
      {
        type: 'pie',
        title: 'Impact Distribution',
        data: [
          { name: 'At Risk', value: affectedPop },
          { name: 'Safe', value: Math.max(0, region.population.total - affectedPop) },
        ],
        keys: [{ dataKey: 'value', color: '#EF4444', name: 'Population' }],
      },
    ],
    table: {
      title: 'Infrastructure at Risk',
      columns: ['Type', 'Name', 'Risk Level'],
      rows: infra.slice(0, 15).map(i => [i.type, i.name, i.risk]),
    },
    recommendations: [
      'Assess the situation and monitor for changes',
      'Evacuate if within the affected zone',
      'Coordinate with local emergency services',
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN — run analysis based on query
// ═══════════════════════════════════════════════════════════════════════

export function runAnalysis(
  query: string,
  region: RegionData,
): AnalysisResult {
  const params = detectScenario(query);

  switch (params.type) {
    case 'inundation':
      return analyzeInundation(region, params.value || 5);
    case 'earthquake':
      return analyzeEarthquake(region, params.value || 6.0);
    case 'wildfire':
    case 'storm':
    case 'pollution':
      return analyzeGeneric(region, params);
    default:
      return analyzeInundation(region, params.value || 5);
  }
}
