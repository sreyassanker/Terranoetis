import { globalArchaeologyEngine } from '../server/archaeology/archaeologyEngine';

async function testBalikh() {
  console.log('================================================================');
  console.log('   UNRECORDED DISCOVERY DOSSIER: BALIKH VALLEY CANDIDATE SITE   ');
  console.log('================================================================\n');

  const bbox = {
    latMin: 36.5430,
    latMax: 36.5570,
    lonMin: 39.0230,
    lonMax: 39.0370,
  };

  const scan = await globalArchaeologyEngine.scanStudyArea(bbox, 'agricultural_plain');

  console.log('STATUS:', scan.status);
  console.log('STATUS MESSAGE:', scan.statusMessage);
  console.log('STUDY AREA:', `${scan.studyAreaKm2.toFixed(3)} km²`);
  console.log('OSM CADASTRAL HERITAGE SITES:', scan.cadastralHeritage?.length ?? 0);
  console.log('TOTAL CONFIRMED ANOMALIES:', scan.anomalies.length);

  console.log('\n--- SATELLITE SENSORS TELEMETRY ---');
  if (scan.liveSensors.sentinel2) {
    const s2 = scan.liveSensors.sentinel2;
    console.log(`Sentinel-2 Scene: ${s2.sceneId}`);
    console.log(`Platform: ${s2.platform} | Cloud Cover: ${s2.cloudCoverPercent}%`);
    if (s2.pixelStatistics) {
      console.log(`Copernicus Pixels Evaluated: ${s2.pixelStatistics.validPixelsAnalyzed.toLocaleString()}`);
      console.log(`NDRE: ${s2.pixelStatistics.computedNdre.toFixed(4)} | NDVI: ${s2.pixelStatistics.computedNdvi.toFixed(4)} | NDMI: ${s2.pixelStatistics.computedNdmi.toFixed(4)}`);
    }
  }

  if (scan.liveSensors.sentinel1) {
    const s1 = scan.liveSensors.sentinel1;
    console.log(`Sentinel-1 SAR Scene: ${s1.sceneId}`);
    console.log(`Mode: ${s1.mode} | Platform: ${s1.platform} | Polarizations: ${s1.polarizations.join('/')}`);
  }

  if (scan.liveSensors.dem) {
    const dem = scan.liveSensors.dem;
    console.log(`SRTM 30m Global Elevation: Min ${dem.minElevationM}m, Max ${dem.maxElevationM}m (Relief: ${(dem.maxElevationM - dem.minElevationM).toFixed(1)}m, Slope: ${dem.slopeDegrees}°)`);
  }

  if (scan.liveSensors.landCover) {
    const lc = scan.liveSensors.landCover;
    console.log(`ESA WorldCover 10m: Cropland ${lc.croplandPercent}%, Built-Up ${lc.builtUpPercent}%, TreeCover ${lc.treeCoverPercent}%, Bare ${lc.barePercent}% (Urban: ${lc.isUrbanFabric})`);
  }

  console.log('\n--- DETECTED ANTHROPOGENIC ANOMALIES ---');
  scan.anomalies.forEach((a, idx) => {
    console.log(`\nAnomaly #${idx + 1}: ${a.name}`);
    console.log(`  Category: ${a.category}`);
    console.log(`  Centroid: ${a.centroid.lat}° N, ${a.centroid.lon}° E`);
    console.log(`  Elevation: ${a.centroid.elevationMeters}m`);
    console.log(`  Footprint Area: ${a.areaM2?.toLocaleString()} m² (${((a.areaM2 || 0) / 10000).toFixed(2)} hectares)`);
    console.log(`  Perimeter: ${a.perimeterMeters?.toFixed(1)} m`);
    console.log(`  Circularity: ${a.evidence.circularityScore} | Micro-Relief TPI: ${a.evidence.microReliefDepthMeters > 0 ? '+' : ''}${a.evidence.microReliefDepthMeters}m`);
    console.log(`  Confidence Score: ${(a.confidenceScore * 100).toFixed(1)}%`);
    console.log(`  Evidence: ${a.evidenceSummary}`);
  });
}

testBalikh().catch(console.error);
