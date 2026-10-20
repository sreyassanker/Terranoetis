import { describe, it, expect } from 'vitest';
import {
  globalArchaeologyEngine,
  calculateHaversineDistanceMeters,
} from '../../archaeology/archaeologyEngine';
import { inferBiomeFromCoordinates } from '../../archaeology/biomeInference';
import { PEER_REVIEWED_REFERENCE_SITES } from '../../archaeology/referenceSites';
import {
  runPeerReviewedValidationBenchmark,
  calculateBboxIoU,
} from '../../archaeology/validationBenchmark';

import { extractAutonomousAnomalies } from '../../archaeology/autonomousDetection';

describe('Space Archaeology & Validation Engine', () => {
  it('has 5 peer-reviewed reference sites with valid coordinates and citations', () => {
    expect(PEER_REVIEWED_REFERENCE_SITES.length).toBe(5);

    for (const site of PEER_REVIEWED_REFERENCE_SITES) {
      expect(site.id).toBeTruthy();
      expect(site.name).toBeTruthy();
      expect(site.referenceCoordinates.lat).toBeGreaterThanOrEqual(-90);
      expect(site.referenceCoordinates.lat).toBeLessThanOrEqual(90);
      expect(site.referenceCoordinates.lon).toBeGreaterThanOrEqual(-180);
      expect(site.referenceCoordinates.lon).toBeLessThanOrEqual(180);

      // Verify study area bounding box correctly contains the reference point
      expect(site.referenceBoundingBox.latMin).toBeLessThan(site.referenceBoundingBox.latMax);
      expect(site.referenceBoundingBox.lonMin).toBeLessThan(site.referenceBoundingBox.lonMax);
      expect(site.referenceCoordinates.lat).toBeGreaterThanOrEqual(site.referenceBoundingBox.latMin);
      expect(site.referenceCoordinates.lat).toBeLessThanOrEqual(site.referenceBoundingBox.latMax);
      expect(site.referenceCoordinates.lon).toBeGreaterThanOrEqual(site.referenceBoundingBox.lonMin);
      expect(site.referenceCoordinates.lon).toBeLessThanOrEqual(site.referenceBoundingBox.lonMax);

      // Verify scholarly citation
      expect(site.citation.authors).toBeTruthy();
      expect(site.citation.journal).toBeTruthy();
      expect(site.citation.volumeOrDoi).toBeTruthy();
      expect(site.documentedSurveyBounds.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('calculates geodesic haversine distance accurately', () => {
    // Distance between London (51.5074, -0.1278) and Paris (48.8566, 2.3522) is ~343-344 km
    const dist = calculateHaversineDistanceMeters(51.5074, -0.1278, 48.8566, 2.3522);
    expect(dist).toBeGreaterThan(340000);
    expect(dist).toBeLessThan(346000);

    // Distance to self is 0
    expect(calculateHaversineDistanceMeters(30.0, 31.0, 30.0, 31.0)).toBe(0);
  });

  it('calculates spatial IoU correctly', () => {
    const boxA = { latMin: 10, latMax: 20, lonMin: 10, lonMax: 20 };
    const boxB = { latMin: 10, latMax: 20, lonMin: 10, lonMax: 20 };
    expect(calculateBboxIoU(boxA, boxB)).toBe(1.0);

    const boxC = { latMin: 30, latMax: 40, lonMin: 30, lonMax: 40 };
    expect(calculateBboxIoU(boxA, boxC)).toBe(0.0);
  });

  it('accurately infers biomes geographically across global coordinates', () => {
    // Eastfort, Kerala, India (8.48, 76.95) must NOT be arid desert
    expect(inferBiomeFromCoordinates(8.4829, 76.9516)).toBe('tropical_coastal');

    // Giza, Egypt (29.97, 31.13)
    expect(inferBiomeFromCoordinates(29.9744, 31.1378)).toBe('arid_desert');

    // Tanis Nile Delta (30.97, 31.88)
    expect(inferBiomeFromCoordinates(30.9767, 31.8803)).toBe('alluvial_floodplain');

    // Silchester, UK (51.35, -1.08)
    expect(inferBiomeFromCoordinates(51.3564, -1.0828)).toBe('agricultural_plain');

    // Upano Valley, Amazon (-2.13, -78.10)
    expect(inferBiomeFromCoordinates(-2.1317, -78.1053)).toBe('jungle_canopy');

    // Ubar, Rub al Khali (18.25, 53.64)
    expect(inferBiomeFromCoordinates(18.2550, 53.6489)).toBe('arid_desert');
  });

  it('never fabricates anomalies in arbitrary locations like Eastfort, Kerala', async () => {
    // Study area bounding box for Eastfort, Kerala as shown in user screenshot
    const eastfortBbox = {
      latMin: 8.4767,
      latMax: 8.4877,
      lonMin: 76.9415,
      lonMax: 76.9519,
    };

    const scan = await globalArchaeologyEngine.scanStudyArea(eastfortBbox);

    // Biome must be geographically inferred
    expect(scan.biome).toBe('tropical_coastal');

    // MUST NOT fabricate anomalies
    expect(scan.anomalies.length).toBe(0);
    expect(scan.status).toBe('NO_ANOMALY_DETECTED');
    expect(scan.highConfidenceCount).toBe(0);
    expect(scan.statusMessage).toContain('No archaeological anomalies detected');

    // Must have queried real live telemetry
    expect(scan.liveSensors).toBeDefined();
    if (scan.liveSensors.dem) {
      expect(scan.liveSensors.dem.dataset).toContain('SRTM');
      expect(scan.liveSensors.dem.meanElevationM).toBeGreaterThanOrEqual(0);
    }
  }, 20000);

  it('executes the full peer-reviewed validation benchmark using real satellite feeds and achieves >= 95% accuracy', async () => {
    const report = await runPeerReviewedValidationBenchmark();

    expect(report.totalSitesEvaluated).toBe(5);
    expect(report.verifiedCount).toBe(5);
    expect(report.truePositives).toBe(5);
    expect(report.trueNegatives).toBeGreaterThanOrEqual(1);
    expect(report.falsePositives).toBe(0);
    expect(report.falseNegatives).toBe(0);
    expect(report.sensitivity).toBe(1.0);
    expect(report.specificity).toBe(1.0);
    expect(report.benchmarkAccuracyPercentage).toBe(100.0);
    expect(report.scientificIntegrityCheck.minimumAccuracyMet).toBe(true);
    expect(report.scientificIntegrityCheck.noSyntheticFallbacks).toBe(true);
    expect(report.scientificIntegrityCheck.dataSources).toContain('Planetary Computer STAC');

    // Check each of the 5 results individually
    for (const res of report.results) {
      expect(res.verificationStatus).toBe('VERIFIED');
      expect(res.meetsConfidenceThreshold).toBe(true);
      expect(res.predictedConfidenceScore).toBeGreaterThanOrEqual(0.95);
      expect(res.meetsSpatialPrecisionThreshold).toBe(true);
      expect(res.centroidErrorDistanceMeters).toBeLessThanOrEqual(45.0);
      expect(res.evidenceCitation).toBeTruthy();
    }
  }, 45000);

  it('generates a real spatial evaluation grid derived directly from SRTM elevation without synthetic sine waves', async () => {
    const scan = await globalArchaeologyEngine.scanStudyArea({
      latMin: 29.9680,
      latMax: 29.9820,
      lonMin: 31.1300,
      lonMax: 31.1480,
    });

    expect(scan.spatialGrid).toBeDefined();
    expect(scan.spatialGrid!.points.length).toBe(1024); // 32x32 resolution (1,024 physical points)
    for (const pt of scan.spatialGrid!.points) {
      expect(Number.isFinite(pt.value)).toBe(true);
      expect(pt.value).toBeGreaterThanOrEqual(0.0);
      expect(pt.value).toBeLessThanOrEqual(1.0);
      expect(Number.isFinite(pt.confidence)).toBe(true);
      expect(pt.confidence).toBeGreaterThanOrEqual(0.1);
    }
    // Live DEM must have sampled real elevation points
    expect(scan.liveSensors.dem).toBeDefined();
    expect(scan.liveSensors.dem!.pointsSampled).toBeGreaterThanOrEqual(9);
    expect(scan.liveSensors.dem!.meanElevationM).toBeGreaterThanOrEqual(0);
  });

  it('autonomously detects uncataloged archaeological tell mound features with dynamic multi-modal confidence', () => {
    const gridCols = 32;
    const gridRows = 32;
    const studyArea = {
      latMin: 35.1000,
      latMax: 35.1200,
      lonMin: 42.1000,
      lonMax: 42.1200,
    };

    const gridPoints: any[] = [];
    for (let r = 0; r < gridRows; r++) {
      const lat = studyArea.latMin + (r / 31) * 0.02;
      for (let c = 0; c < gridCols; c++) {
        const lon = studyArea.lonMin + (c / 31) * 0.02;
        gridPoints.push({
          lat,
          lon,
          value: 0.1,
          confidence: 0.95,
          opticalDelta: 0.02,
          radarDb: -16.0,
          slopeDegrees: 1.5,
        });
      }
    }

    // 5x5 DEM grid with a pronounced 4.5m tell mound in center
    const demGrid = [
      120.0, 120.1, 120.0, 119.9, 120.0,
      120.1, 121.0, 122.5, 121.2, 120.1,
      120.0, 122.2, 124.5, 122.4, 120.0,
      119.9, 121.1, 122.6, 121.0, 119.9,
      120.0, 120.0, 120.1, 120.0, 120.0,
    ];

    const liveSensors: any = {
      dem: {
        dataset: 'SRTM GL1 30m',
        minElevationM: 119.9,
        maxElevationM: 124.5,
        meanElevationM: 120.8,
        elevationStdDevM: 1.1,
        slopeDegrees: 2.5,
        elevationGrid: demGrid,
        gridRows: 5,
        gridCols: 5,
      },
      sentinel2: {
        platform: 'Sentinel-2B',
        cloudCoverPercent: 2.0,
        pixelStatistics: {
          computedNdre: 0.18, // Significant crop mark contrast
        },
      },
      sentinel1: {
        platform: 'Sentinel-1A',
        polarizations: ['VV', 'VH'],
      },
      soil: {
        clayPercent: 42,
        sandPercent: 30,
      },
    };

    const discoveries = extractAutonomousAnomalies(
      studyArea,
      'steppe_grassland',
      gridPoints,
      gridCols,
      gridRows,
      liveSensors
    );

    expect(discoveries.length).toBeGreaterThanOrEqual(1);
    const tell = discoveries[0];
    expect(tell.name).toContain('Autonomous Discovery');
    expect(tell.confidenceScore).toBeGreaterThanOrEqual(0.76);
    expect(tell.confidenceScore).toBeLessThanOrEqual(0.95);
    expect(tell.areaM2).toBeGreaterThanOrEqual(500);
    expect(tell.polygonCoordinates.length).toBeGreaterThanOrEqual(4);
    expect(tell.evidence.microReliefDepthMeters).toBeGreaterThan(0.5);
    expect(tell.centroid.lat).toBeCloseTo(35.11, 1);
    expect(tell.centroid.lon).toBeCloseTo(42.11, 1);
  });
});
