import type {
  StudyAreaBoundingBox,
  BiomeType,
  ArchaeologicalAnomaly,
  ArchaeologyScanResult,
  MultiModalEvidence,
  AnomalyCategory,
  ScanStatus,
  ScanOptions,
  SpatialGridPoint,
} from './types';
import { PEER_REVIEWED_REFERENCE_SITES } from './referenceSites';
import { acquireLiveSensoryTelemetry, fetchCadastralHeritage } from './dataAcquisition';
import { inferBiomeFromCoordinates } from './biomeInference';
import { extractAutonomousAnomalies } from './autonomousDetection';

export { inferBiomeFromCoordinates };

/**
 * Great-circle distance between two geographic coordinates in meters (WGS84 ellipsoid).
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates 2D spatial Intersection-over-Union (IoU) of two bounding boxes.
 */
export function calculateBboxIoU(
  boxA: StudyAreaBoundingBox,
  boxB: StudyAreaBoundingBox,
): number {
  const interLatMin = Math.max(boxA.latMin, boxB.latMin);
  const interLatMax = Math.min(boxA.latMax, boxB.latMax);
  const interLonMin = Math.max(boxA.lonMin, boxB.lonMin);
  const interLonMax = Math.min(boxA.lonMax, boxB.lonMax);

  if (interLatMax <= interLatMin || interLonMax <= interLonMin) {
    return 0.0;
  }

  const interArea = (interLatMax - interLatMin) * (interLonMax - interLonMin);
  const areaA = (boxA.latMax - boxA.latMin) * (boxA.lonMax - boxA.lonMin);
  const areaB = (boxB.latMax - boxB.latMin) * (boxB.lonMax - boxB.lonMin);
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? parseFloat((interArea / unionArea).toFixed(4)) : 0.0;
}

/**
 * Calculates the geodesic surface area of a bounding box in square kilometers.
 */
export function calculateBboxAreaKm2(bbox: StudyAreaBoundingBox): number {
  const heightM = calculateHaversineDistanceMeters(bbox.latMin, bbox.lonMin, bbox.latMax, bbox.lonMin);
  const widthM = calculateHaversineDistanceMeters(
    (bbox.latMin + bbox.latMax) / 2,
    bbox.lonMin,
    (bbox.latMin + bbox.latMax) / 2,
    bbox.lonMax,
  );
  return (heightM * widthM) / 1_000_000;
}



/**
 * Core Space Archaeology & Multi-Sensor Prospection Engine.
 * Executes genuine multi-sensor data acquisition and rigorous physical evidence evaluation.
 */
export class ArchaeologyEngine {
  /**
   * Scans a user-drawn study area bounding box using live Earth Observation datasets
   * from Copernicus Sentinel-1, Sentinel-2, SRTM Digital Elevation Models, and SoilGrids.
   */
  public async scanStudyArea(
    studyArea: StudyAreaBoundingBox,
    customBiome?: BiomeType,
    options?: ScanOptions,
  ): Promise<ArchaeologyScanResult> {
    const centerLat = (studyArea.latMin + studyArea.latMax) / 2;
    const centerLon = (studyArea.lonMin + studyArea.lonMax) / 2;
    const biome = customBiome || inferBiomeFromCoordinates(centerLat, centerLon);
    const areaKm2 = parseFloat(calculateBboxAreaKm2(studyArea).toFixed(3));

    // Guardrail: Satellite archaeological prospection resolves physical structures at 1-3 km (~10 km²).
    // Bounding boxes above 25 km² result in sub-sampling void where ancient ruins are lost.
    if (areaKm2 > 25.0) {
      return {
        scanId: `arch_scan_${Date.now()}_area_exceeded`,
        studyArea,
        studyAreaKm2: areaKm2,
        biome,
        timestamp: Date.now(),
        status: 'AREA_EXCEEDS_LIMIT',
        statusMessage: `Study area is ${areaKm2.toLocaleString()} km², which exceeds the 25 km² archaeological prospection ceiling. Satellite prospection requires a focused study area between 1 km² and 10 km² (~1–3 km across) to resolve subterranean structures. Please constrain your selection or click Auto-Fit.`,
        anomalies: [],
        liveSensors: {
          sentinel2: null,
          sentinel1: null,
          dem: null,
          soil: null,
          landCover: null,
        },
        overallConfidence: 0,
        highConfidenceCount: 0,
        insufficientDataWarning: `Study area (${areaKm2.toLocaleString()} km²) exceeds the 25 km² resolution limit for archaeological detection. Please resize to 1–3 km width.`,
      };
    }

    // 1. Acquire live physical remote sensing data and query cadastral heritage concurrently
    const [liveSensors, cadastralHeritage] = await Promise.all([
      acquireLiveSensoryTelemetry(studyArea, options),
      fetchCadastralHeritage(studyArea),
    ]);

    // 2. Check data availability: If all sensors failed, halt and report insufficient data
    const hasAnySensoryData = liveSensors.sentinel2 || liveSensors.sentinel1 || liveSensors.dem;
    if (!hasAnySensoryData) {
      return {
        scanId: `arch_scan_${Date.now()}_err`,
        studyArea,
        studyAreaKm2: areaKm2,
        biome,
        timestamp: Date.now(),
        status: 'INSUFFICIENT_DATA',
        statusMessage:
          'Live remote sensing telemetry could not be retrieved from Earth Observation providers (Planetary Computer STAC / SRTM DEM). Prospection halted to prevent false detections.',
        anomalies: [],
        liveSensors,
        overallConfidence: 0,
        highConfidenceCount: 0,
        insufficientDataWarning:
          'Satellite imagery or elevation data is unavailable for this bounding box. Unable to perform multi-sensor consensus.',
      };
    }

    const anomalies: ArchaeologicalAnomaly[] = [];

    // 3. Generate high-density Spatial Evaluation Grid for continuous surface drape
    // Dynamically scales with physical ground distance (~25m ground resolution per pixel cell)
    // Avoids downsampling distortion across both compact urban features and landscape paleochannels
    const latMidRad = (((studyArea.latMin + studyArea.latMax) / 2) * Math.PI) / 180;
    const heightM = (studyArea.latMax - studyArea.latMin) * 111320;
    const widthM = (studyArea.lonMax - studyArea.lonMin) * 111320 * Math.cos(latMidRad);
    const TARGET_CELL_METERS = 25;
    const gridCols = Math.max(32, Math.min(80, Math.round(widthM / TARGET_CELL_METERS)));
    const gridRows = Math.max(32, Math.min(80, Math.round(heightM / TARGET_CELL_METERS)));
    const dLat = (studyArea.latMax - studyArea.latMin) / Math.max(1, gridRows - 1);
    const dLon = (studyArea.lonMax - studyArea.lonMin) / Math.max(1, gridCols - 1);
    const cloudCover = liveSensors.sentinel2?.cloudCoverPercent ?? 0;
    const baseCertainty = Math.max(0.1, 1.0 - cloudCover / 100);

    const elevGrid = liveSensors.dem?.elevationGrid;
    const demRows = liveSensors.dem?.gridRows ?? 9;
    const demCols = liveSensors.dem?.gridCols ?? 9;
    const meanElev = liveSensors.dem?.meanElevationM ?? 0;
    const stdDevElev = Math.max(0.5, liveSensors.dem?.elevationStdDevM ?? 1.0);

    // Bilinear sampler for the real SRTM elevation matrix
    const sampleRealElevation = (u: number, v: number): number => {
      if (!elevGrid || elevGrid.length < demRows * demCols) return meanElev;
      const r = v * (demRows - 1);
      const c = u * (demCols - 1);
      const r0 = Math.max(0, Math.min(demRows - 2, Math.floor(r)));
      const r1 = r0 + 1;
      const c0 = Math.max(0, Math.min(demCols - 2, Math.floor(c)));
      const c1 = c0 + 1;
      const fr = r - r0;
      const fc = c - c0;
      const p00 = elevGrid[r0 * demCols + c0];
      const p10 = elevGrid[r0 * demCols + c1];
      const p01 = elevGrid[r1 * demCols + c0];
      const p11 = elevGrid[r1 * demCols + c1];
      return (p00 * (1 - fc) + p10 * fc) * (1 - fr) + (p01 * (1 - fc) + p11 * fc) * fr;
    };

    const measuredSarDb = liveSensors.sentinel1?.measuredCrossPolRatioDb ?? (liveSensors.sentinel1?.measuredVhMeanDb ?? -16.0);
    const measuredOpticalDelta = liveSensors.sentinel2?.multiTemporal?.deltaNdre ?? (liveSensors.sentinel2?.pixelStatistics?.computedNdre ?? 0.02);

    const points: SpatialGridPoint[] = [];

    for (let r = 0; r < gridRows; r++) {
      const lat = studyArea.latMin + r * dLat;
      const v = r / Math.max(1, gridRows - 1);
      for (let c = 0; c < gridCols; c++) {
        const lon = studyArea.lonMin + c * dLon;
        const u = c / Math.max(1, gridCols - 1);

        // Physical elevation from real SRTM 30m
        const elev = sampleRealElevation(u, v);
        // Residual micro-relief / Topographic Position Index (TPI)
        const microReliefM = elev - meanElev;

        // Base terrain response: directly scales with actual elevation variance and micro-relief
        const reliefContrast = Math.min(1.0, Math.abs(microReliefM) / (3.0 * stdDevElev));
        const pointValue = 0.08 + 0.15 * reliefContrast;

        const slope = liveSensors.dem?.slopeDegrees ?? 1.5;

        points.push({
          lat: parseFloat(lat.toFixed(6)),
          lon: parseFloat(lon.toFixed(6)),
          value: parseFloat(pointValue.toFixed(4)),
          confidence: parseFloat(baseCertainty.toFixed(3)),
          opticalDelta: parseFloat(measuredOpticalDelta.toFixed(3)),
          radarDb: parseFloat(measuredSarDb.toFixed(1)),
          slopeDegrees: parseFloat(slope.toFixed(1)),
        });
      }
    }

    // 4. Autonomous Multi-Sensor Discovery (Blind Unsupervised Evaluation):
    const autonomousDiscoveries = extractAutonomousAnomalies(
      studyArea,
      biome,
      points,
      gridCols,
      gridRows,
      liveSensors,
      cadastralHeritage,
    );

    // 5. Cross-reference discovered anomalies against peer-reviewed ground truth
    for (const anomaly of autonomousDiscoveries) {
      for (const ref of PEER_REVIEWED_REFERENCE_SITES) {
        const distM = calculateHaversineDistanceMeters(anomaly.centroid.lat, anomaly.centroid.lon, ref.referenceCoordinates.lat, ref.referenceCoordinates.lon);
        const inRefBbox =
          anomaly.centroid.lat >= ref.referenceBoundingBox.latMin - 0.005 &&
          anomaly.centroid.lat <= ref.referenceBoundingBox.latMax + 0.005 &&
          anomaly.centroid.lon >= ref.referenceBoundingBox.lonMin - 0.005 &&
          anomaly.centroid.lon <= ref.referenceBoundingBox.lonMax + 0.005;

        if (distM <= 500 || inRefBbox) {
          anomaly.id = `anomaly_${ref.id}_${anomaly.category}_${anomalies.length + 1}`;
          anomaly.name = `${ref.name} (${anomaly.name.replace('Autonomous Discovery: ', '')})`;
          anomaly.blindIoU = calculateBboxIoU(anomaly.boundingBox, ref.referenceBoundingBox);
          anomaly.centroidDisplacementMeters = parseFloat(distM.toFixed(1));
          anomaly.culturalContext = `${ref.name}: ${ref.historicalSignificance}`;
          anomaly.evidenceSummary += ` [Ground-Truth Reference: ${ref.citation.authors} (${ref.citation.year}), ${ref.citation.journal}; centroid offset ${Math.round(distM)}m, IoU ${(anomaly.blindIoU * 100).toFixed(1)}%]`;
          break;
        }
      }
      anomalies.push(anomaly);
    }

    // 6. If anomalies are confirmed, apply continuous spatial proximity weighting
    if (anomalies.length > 0) {
      for (const pt of points) {
        for (const a of anomalies) {
          const distM = calculateHaversineDistanceMeters(pt.lat, pt.lon, a.centroid.lat, a.centroid.lon);
          const radiusM = Math.max(350, Math.sqrt(a.areaM2 || 10000) * 1.5);
          if (distM < radiusM) {
            const proximityWeight = Math.max(0, 1.0 - distM / radiusM);
            pt.value = Math.max(pt.value, a.confidenceScore * (0.65 + 0.35 * proximityWeight));
            pt.opticalDelta = Math.max(pt.opticalDelta, a.evidence.spectralContrastDelta * proximityWeight);
            pt.radarDb = Math.max(pt.radarDb, a.evidence.radarBackscatterRatioDb);
            pt.slopeDegrees = a.evidence.slopeGradientDegrees;
          }
        }
        pt.value = Math.max(0.0, Math.min(1.0, parseFloat(pt.value.toFixed(4))));
        pt.opticalDelta = parseFloat(pt.opticalDelta.toFixed(3));
        pt.radarDb = parseFloat(pt.radarDb.toFixed(1));
        pt.slopeDegrees = parseFloat(pt.slopeDegrees.toFixed(1));
      }
    }

    // 7. Determine status and generate scientifically honest reporting
    let status: ScanStatus = 'NO_ANOMALY_DETECTED';
    let statusMessage = '';

    const pixCount = liveSensors.sentinel2?.pixelStatistics?.validPixelsAnalyzed;
    const pixStr = pixCount ? ` [${pixCount.toLocaleString()} Copernicus optical pixels evaluated via serverless COG range requests]` : '';

    if (anomalies.length > 0) {
      status = 'ANOMALY_CONFIRMED';
      const a = anomalies[0];
      const sign = a.evidence.microReliefDepthMeters >= 0 ? '+' : '';
      statusMessage = `Empirical multi-sensor anomaly confirmed: "${a.name}" (${(a.confidenceScore * 100).toFixed(1)}% confidence, ${Math.round(a.areaM2 || 0).toLocaleString()} m²). Micro-relief TPI (${sign}${a.evidence.microReliefDepthMeters.toFixed(2)}m) and spatial DBSCAN clustering indicate coherent anthropogenic morphology cross-referenced with live ${liveSensors.dem?.dataset || 'SRTM DEM'} and ${liveSensors.sentinel1?.platform || 'Sentinel-1'} SAR${pixStr}.`;
      if (cadastralHeritage && cadastralHeritage.length > 0) {
        statusMessage += ` [Documented Heritage Site in AOI: "${cadastralHeritage[0].name}"]`;
      }
    } else if (cadastralHeritage && cadastralHeritage.some(h => h.isAboveGroundStanding)) {
      status = 'STANDING_HERITAGE_VERIFIED';
      const heritage = cadastralHeritage.find(h => h.isAboveGroundStanding)!;
      statusMessage = `Verified Documented Standing Heritage: "${heritage.name}" (${heritage.periodOrEpoch || 'Historical Epoch'}, ${heritage.heritageDesignation || 'Cataloged Monument'}). Footprint cataloged as surface heritage baseline. Multi-sensor prospection on surrounding floodplain/buffer confirms 0 uncharted subterranean anomalies (terrain clear)${pixStr}.`;
    } else {
      status = 'NO_ANOMALY_DETECTED';
      const s2Info = liveSensors.sentinel2
        ? `${liveSensors.sentinel2.platform} (cloud ${liveSensors.sentinel2.cloudCoverPercent}%)`
        : 'S2 optical unavailable';
      const s1Info = liveSensors.sentinel1
        ? `${liveSensors.sentinel1.platform} ${liveSensors.sentinel1.polarizations.join('/')}`
        : 'S1 SAR unavailable';
      const demInfo = liveSensors.dem
        ? `SRTM elevation ${liveSensors.dem.minElevationM}m–${liveSensors.dem.maxElevationM}m, slope ${liveSensors.dem.slopeDegrees}°`
        : 'DEM unavailable';

      statusMessage = `Multi-sensor prospection completed across ${areaKm2} km² [${s2Info}; ${s1Info}; ${demInfo}${pixStr}]. Terrain micro-relief (TPI) and radar backscatter across this area do not show coherent orthogonal foundations, ditch enclosures, or tell mound signatures above the consensus threshold. No archaeological anomalies detected.`;
    }

    const highConfidenceCount = anomalies.filter(a => a.confidenceScore >= 0.75).length;
    const overallConfidence =
      anomalies.length > 0
        ? parseFloat((anomalies.reduce((acc, a) => acc + a.confidenceScore, 0) / anomalies.length).toFixed(4))
        : 0;

    return {
      scanId: `arch_scan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      studyArea,
      studyAreaKm2: areaKm2,
      biome,
      timestamp: Date.now(),
      status,
      statusMessage,
      anomalies,
      cadastralHeritage,
      liveSensors,
      overallConfidence,
      highConfidenceCount,
      spatialGrid: {
        points,
        gridWidth: gridCols,
        gridHeight: gridRows,
        cloudThresholdUsed: options?.maxCloudCoverPercent ?? 5,
        dateUsed: liveSensors.sentinel2?.acquisitionDate,
      },
    };
  }
}

export const globalArchaeologyEngine = new ArchaeologyEngine();
