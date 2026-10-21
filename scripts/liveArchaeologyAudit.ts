import express from 'express';
import http from 'http';
import { globalArchaeologyEngine } from '../server/archaeology/archaeologyEngine';
import { PEER_REVIEWED_REFERENCE_SITES } from '../server/archaeology/referenceSites';
import { runPeerReviewedValidationBenchmark } from '../server/archaeology/validationBenchmark';
import { archaeologyRouter } from '../server/archaeology/routes';

async function runLiveAudit() {
  console.log('================================================================');
  console.log('   TERRANOETIS REAL-TIME LIVE ARCHAEOLOGY ENGINE AUDIT & TEST   ');
  console.log('================================================================\n');

  const overallStart = Date.now();
  let testCount = 0;
  let passCount = 0;

  function assert(desc: string, condition: boolean, extra?: any) {
    testCount++;
    if (condition) {
      passCount++;
      console.log(`  ✅ [PASS] ${desc}`);
    } else {
      console.error(`  ❌ [FAIL] ${desc}`, extra ?? '');
    }
  }

  // -------------------------------------------------------------
  // TEST 1: Benchmark Validation Run across all 5 Reference Sites
  // -------------------------------------------------------------
  console.log('--- STEP 1: 5 Peer-Reviewed Reference Sites Benchmark (Live APIs) ---');
  console.log(`Auditing Planetary Computer STAC, TiTiler COGs, Open-Meteo SRTM DEM & ISRIC SoilGrids...`);

  const benchStart = Date.now();
  const benchmarkReport = await runPeerReviewedValidationBenchmark();
  const benchDuration = Date.now() - benchStart;

  console.log(`Benchmark completed in ${benchDuration}ms.`);
  console.log(`  - Overall Benchmark Accuracy: ${benchmarkReport.benchmarkAccuracyPercentage}%`);
  console.log(`  - Mean Spatial Centroid Error: ${benchmarkReport.averageCentroidErrorMeters.toFixed(1)} meters`);
  console.log(`  - Mean Confidence Score: ${(benchmarkReport.averageConfidenceScore * 100).toFixed(1)}%`);
  console.log(`  - Balanced Sensitivity: ${(benchmarkReport.sensitivity * 100).toFixed(1)}% | Specificity: ${(benchmarkReport.specificity * 100).toFixed(1)}%`);
  console.log(`  - Reference Sites Audited: ${benchmarkReport.results.length}/${benchmarkReport.totalSitesEvaluated}\n`);

  assert('Benchmark overall accuracy is >= 95%', benchmarkReport.benchmarkAccuracyPercentage >= 95);
  assert('Processed exactly 5 peer-reviewed reference sites', benchmarkReport.results.length === 5);
  assert('Specificity is 100% (zero false positives on negative controls)', benchmarkReport.specificity === 1.0);

  for (const site of benchmarkReport.results) {
    console.log(`  📍 Site: "${site.siteName}" (${site.siteId})`);
    console.log(`     - Verification Status: ${site.verificationStatus}`);
    console.log(`     - Confidence Score: ${(site.predictedConfidenceScore * 100).toFixed(1)}% (Threshold Met: ${site.meetsConfidenceThreshold})`);
    console.log(`     - Spatial IoU: ${(site.spatialIoU * 100).toFixed(1)}%`);
    console.log(`     - Geodesic Error: ${site.centroidErrorDistanceMeters.toFixed(1)}m (Spatial Precision Met: ${site.meetsSpatialPrecisionThreshold})`);
    console.log(`     - Real SRTM Elevation: Mean=${site.liveSensorsRetrieved.measuredElevationM ?? 'N/A'}m`);
    console.log(`     - Live Sentinel-2 Scene: ${site.liveSensorsRetrieved.s2SceneId || 'Acquired'}`);
    console.log(`     - Peer-Reviewed Citation: ${site.evidenceCitation}`);

    assert(`"${site.siteName}" verified with high confidence`, site.verificationStatus === 'VERIFIED');
    assert(`"${site.siteName}" spatial error <= 45m`, site.centroidErrorDistanceMeters <= 45.0);
  }

  // -------------------------------------------------------------
  // TEST 2: High-Density 1,024-Point Evaluation Grid Test
  // -------------------------------------------------------------
  console.log('\n--- STEP 2: High-Density 1,024-Point Spatial Evaluation Grid Test ---');
  const ahramatBbox = PEER_REVIEWED_REFERENCE_SITES[0].referenceBoundingBox;
  console.log(`Executing live multi-sensor prospection on Ahramat Pyramid Zone (${ahramatBbox.latMin}, ${ahramatBbox.lonMin}) to (${ahramatBbox.latMax}, ${ahramatBbox.lonMax})...`);

  const scanStart = Date.now();
  const ahramatScan = await globalArchaeologyEngine.scanStudyArea(ahramatBbox, 'arid_desert');
  const scanDuration = Date.now() - scanStart;

  console.log(`Ahramat prospection completed in ${scanDuration}ms.`);
  console.log(`  - Status: ${ahramatScan.status}`);
  console.log(`  - Confirmed Anomalies: ${ahramatScan.anomalies.length}`);
  console.log(`  - Spatial Grid Matrix: ${ahramatScan.spatialGrid?.gridWidth} x ${ahramatScan.spatialGrid?.gridHeight}`);
  console.log(`  - Total Physical Grid Points: ${ahramatScan.spatialGrid?.points.length}`);

  assert('Scan returns confirmed anomalies for Ahramat', ahramatScan.anomalies.length > 0);
  assert('Spatial grid contains exactly 1,024 evaluation points (32x32)', ahramatScan.spatialGrid?.points.length === 1024);
  assert('Spatial grid gridWidth is 32', ahramatScan.spatialGrid?.gridWidth === 32);
  assert('Spatial grid gridHeight is 32', ahramatScan.spatialGrid?.gridHeight === 32);

  if (ahramatScan.spatialGrid) {
    const values = ahramatScan.spatialGrid.points.map(p => p.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const avgVal = values.reduce((a, b) => a + b, 0) / values.length;
    console.log(`  - Grid Point CAPI Values: Min=${minVal.toFixed(4)}, Max=${maxVal.toFixed(4)}, Mean=${avgVal.toFixed(4)}`);
    assert('Grid points exhibit dynamic physical variance from real SRTM DEM', maxVal > minVal);

    const lats = ahramatScan.spatialGrid.points.map(p => p.lat);
    const lons = ahramatScan.spatialGrid.points.map(p => p.lon);
    assert('Grid lat span correctly aligns with study area', Math.min(...lats) >= ahramatBbox.latMin && Math.max(...lats) <= ahramatBbox.latMax);
    assert('Grid lon span correctly aligns with study area', Math.min(...lons) >= ahramatBbox.lonMin && Math.max(...lons) <= ahramatBbox.lonMax);
  }

  // -------------------------------------------------------------
  // TEST 3: Negative Control Audit (Eastfort, Kerala)
  // -------------------------------------------------------------
  console.log('\n--- STEP 3: Brutal Negative Control Audit (Eastfort, Kerala) ---');
  const negativeBbox = { latMin: 8.475, latMax: 8.495, lonMin: 76.940, lonMax: 76.960 };
  console.log(`Prospection on arbitrary modern city: Eastfort (${negativeBbox.latMin}, ${negativeBbox.lonMin})...`);

  const negScanStart = Date.now();
  const negativeScan = await globalArchaeologyEngine.scanStudyArea(negativeBbox, 'tropical_coastal');
  const negScanDuration = Date.now() - negScanStart;

  console.log(`Negative scan completed in ${negScanDuration}ms.`);
  console.log(`  - Status: ${negativeScan.status}`);
  console.log(`  - Anomalies Count: ${negativeScan.anomalies.length}`);
  console.log(`  - Total Grid Points: ${negativeScan.spatialGrid?.points.length}`);

  assert('Zero fake anomalies detected in non-archaeological zone', negativeScan.anomalies.length === 0);
  assert('Status confirms NO_ANOMALY_DETECTED', negativeScan.status === 'NO_ANOMALY_DETECTED');
  assert('Spatial grid still generates 1,024 physical points from live SRTM', negativeScan.spatialGrid?.points.length === 1024);

  // -------------------------------------------------------------
  // TEST 3.5: Monument Urban Fabric & Cadastral Standing Heritage (Taj Mahal, Agra)
  // -------------------------------------------------------------
  console.log('\n--- STEP 3.5: Cadastral Standing Heritage Verification & Subterranean Masking (Taj Mahal, Agra) ---');
  const tajBbox = { latMin: 27.165, latMax: 27.178, lonMin: 78.038, lonMax: 78.055 };
  console.log(`Auditing known historical monument to verify Tier 1 Cadastral Heritage cataloging without subterranean false positives...`);

  const tajStart = Date.now();
  const tajScan = await globalArchaeologyEngine.scanStudyArea(tajBbox);
  const tajDuration = Date.now() - tajStart;

  console.log(`Taj Mahal scan completed in ${tajDuration}ms.`);
  console.log(`  - Status: ${tajScan.status}`);
  console.log(`  - Cadastral Heritage: ${tajScan.cadastralHeritage?.map(h => `${h.name} (${h.periodOrEpoch})`).join(', ')}`);
  console.log(`  - Subterranean Anomalies Count: ${tajScan.anomalies.length}`);
  console.log(`  - Land Cover: Built-up ${tajScan.liveSensors.landCover?.builtUpPercent}%, Cropland ${tajScan.liveSensors.landCover?.croplandPercent}%`);
  console.log(`  - Urban Fabric Flag: ${tajScan.liveSensors.landCover?.isUrbanFabric}`);

  assert('Taj Mahal status confirms STANDING_HERITAGE_VERIFIED', tajScan.status === 'STANDING_HERITAGE_VERIFIED');
  assert('Taj Mahal cadastral heritage accurately cataloged', Boolean(tajScan.cadastralHeritage?.length && tajScan.cadastralHeritage[0].name.includes('Taj Mahal')));
  assert('Taj Mahal correctly classified as above-ground standing architecture', tajScan.cadastralHeritage?.[0]?.isAboveGroundStanding === true);
  assert('Zero false positive subterranean discoveries on Taj Mahal monument', tajScan.anomalies.length === 0);
  assert('ESA WorldCover correctly flags urban/built-up fabric', tajScan.liveSensors.landCover?.isUrbanFabric === true);

  // -------------------------------------------------------------
  // TEST 3.6: Dual-Date Multi-Temporal Differential Analysis
  // -------------------------------------------------------------
  console.log('\n--- STEP 3.6: Dual-Date Multi-Temporal Differential Prospection ---');
  const silchesterBbox = { lonMin: -1.105, latMin: 51.350, lonMax: -1.075, latMax: 51.365 };
  console.log(`Executing dual-date seasonal differential (summer drought vs spring baseline) on Silchester Roman Town...`);

  const multiStart = Date.now();
  const multiScan = await globalArchaeologyEngine.scanStudyArea(silchesterBbox, 'agricultural_plain', {
    seasonWindow: 'multi_temporal_diff',
  });
  const multiDuration = Date.now() - multiStart;

  console.log(`Dual-date scan completed in ${multiDuration}ms.`);
  console.log(`  - Status: ${multiScan.status}`);
  console.log(`  - Confirmed Anomalies: ${multiScan.anomalies.length}`);
  console.log(`  - Stress Date (Summer): ${multiScan.liveSensors.sentinel2?.multiTemporal?.stressDate}`);
  console.log(`  - Baseline Date (Spring): ${multiScan.liveSensors.sentinel2?.multiTemporal?.baselineDate}`);
  console.log(`  - Temporal Separation: ${multiScan.liveSensors.sentinel2?.multiTemporal?.daysSeparation} days`);
  console.log(`  - Delta NDRE: ${multiScan.liveSensors.sentinel2?.multiTemporal?.deltaNdre}`);
  console.log(`  - Contrast Amplification: ${multiScan.liveSensors.sentinel2?.multiTemporal?.contrastAmplificationRatio}x`);

  assert('Dual-date differential confirms Silchester anomalies', multiScan.anomalies.length > 0);
  assert('Multi-temporal telemetry is attached', multiScan.liveSensors.sentinel2?.multiTemporal?.isMultiTemporal === true);
  assert('Inter-seasonal separation is >= 30 days', (multiScan.liveSensors.sentinel2?.multiTemporal?.daysSeparation ?? 0) >= 30);
  assert('Delta NDRE differential is positive', (multiScan.liveSensors.sentinel2?.multiTemporal?.deltaNdre ?? 0) > 0);

  // -------------------------------------------------------------
  // TEST 4: Live HTTP REST API Integration
  // -------------------------------------------------------------
  console.log('\n--- STEP 4: Live HTTP Express Server & REST API Verification ---');
  const app = express();
  app.use(express.json());
  app.use('/api/archaeology', archaeologyRouter);

  const server = http.createServer(app);
  const testPort = 3198;

  await new Promise<void>((resolve) => {
    server.listen(testPort, '127.0.0.1', () => {
      console.log(`Live HTTP API test server running on http://127.0.0.1:${testPort}`);
      resolve();
    });
  });

  try {
    // 4.1 GET /api/archaeology/benchmarks
    const resBenchmarks = await fetch(`http://127.0.0.1:${testPort}/api/archaeology/benchmarks`);
    assert('GET /api/archaeology/benchmarks returns HTTP 200 OK', resBenchmarks.status === 200);
    const benchmarksData = await resBenchmarks.json() as any;
    assert('GET /api/archaeology/benchmarks returns 5 reference sites', benchmarksData.count === 5 && Array.isArray(benchmarksData.sites));

    // 4.2 POST /api/archaeology/scan with live study area
    console.log('Sending live POST /api/archaeology/scan request...');
    const resScan = await fetch(`http://127.0.0.1:${testPort}/api/archaeology/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studyArea: { latMin: 18.20, latMax: 18.30, lonMin: 53.60, lonMax: 53.70 },
        biome: 'arid_desert'
      })
    });
    assert('POST /api/archaeology/scan returns HTTP 200 OK', resScan.status === 200);
    const scanData = await resScan.json() as any;
    assert('POST /api/archaeology/scan response includes scanId', typeof scanData.scanId === 'string');
    assert('POST /api/archaeology/scan response includes exactly 1,024 grid points', scanData.spatialGrid?.points.length === 1024);
    assert('POST /api/archaeology/scan response includes real DEM telemetry', Boolean(scanData.liveSensors?.dem));

    // 4.3 POST /api/archaeology/scan validation failure handling
    const resInvalid = await fetch(`http://127.0.0.1:${testPort}/api/archaeology/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studyArea: { latMin: 50.0, latMax: 40.0, lonMin: 10.0, lonMax: 20.0 }
      })
    });
    assert('POST /api/archaeology/scan correctly rejects invalid bbox with HTTP 400', resInvalid.status === 400);

  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log(`Live HTTP API test server gracefully stopped.`);
        resolve();
      });
    });
  }

  // -------------------------------------------------------------
  // AUDIT SUMMARY
  // -------------------------------------------------------------
  const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(2);
  console.log('\n================================================================');
  console.log(`   AUDIT RESULTS: ${passCount}/${testCount} TESTS PASSED in ${totalDuration}s`);
  console.log('================================================================');

  if (passCount === testCount) {
    console.log('🎉 LIVE VERIFICATION SUCCESSFUL: ALL ENDPOINTS & SENSORS OPERATING SMOOTHLY.');
    process.exit(0);
  } else {
    console.error(`⚠️ FAILED ${testCount - passCount} ASSERTIONS.`);
    process.exit(1);
  }
}

runLiveAudit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
