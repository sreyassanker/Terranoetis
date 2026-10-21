import { ArchaeologyEngine } from '../server/archaeology/archaeologyEngine';
import type { StudyAreaBoundingBox } from '../server/archaeology/types';

interface LocationTestCase {
  name: string;
  expectedType: 'STANDING_HERITAGE' | 'SUBTERRANEAN_DISCOVERY' | 'TERRAIN_CLEAR_NEGATIVE';
  bbox: StudyAreaBoundingBox;
  notes: string;
}

const TEST_LOCATIONS: LocationTestCase[] = [
  // 1. Standing Architectural Monuments (Europe & SE Asia)
  {
    name: 'Colosseum & Roman Forum (Rome, Italy)',
    expectedType: 'STANDING_HERITAGE',
    bbox: { latMin: 41.887, latMax: 41.893, lonMin: 12.488, lonMax: 12.496 },
    notes: 'Flavian Amphitheatre (72–80 CE). Must identify standing Roman architecture without false subterranean flags.',
  },
  {
    name: 'Angkor Wat Temple Complex (Siem Reap, Cambodia)',
    expectedType: 'STANDING_HERITAGE',
    bbox: { latMin: 13.408, latMax: 13.417, lonMin: 103.861, lonMax: 103.873 },
    notes: 'Khmer Monumental Temple (1113–1150 CE). Must identify standing temple complex without false subterranean flags.',
  },

  // 2. Pure Subterranean Archaeological Discoveries (Unexcavated / Buried)
  {
    name: 'Silchester Roman Town (Calleva Atrebatum, UK)',
    expectedType: 'SUBTERRANEAN_DISCOVERY',
    bbox: { latMin: 51.350, latMax: 51.365, lonMin: -1.105, lonMax: -1.075 },
    notes: 'Buried Roman street grid and insulae beneath arable wheat fields. Multi-temporal NDRE differential must detect.',
  },
  {
    name: 'Ahramat Ancient Nile Branch (Giza Plateau, Egypt)',
    expectedType: 'SUBTERRANEAN_DISCOVERY',
    bbox: { latMin: 29.968, latMax: 29.982, lonMin: 31.130, lonMax: 31.148 },
    notes: 'Subsurface extinct Nile paleochannel beneath aeolian desert sand.',
  },

  // 3. Negative Controls: Modern Metropolises & Undisturbed Natural Wilderness
  {
    name: 'Times Square / Midtown Manhattan (New York, USA)',
    expectedType: 'TERRAIN_CLEAR_NEGATIVE',
    bbox: { latMin: 40.753, latMax: 40.762, lonMin: -73.992, lonMax: -73.980 },
    notes: 'Dense modern skyscraper grid. Must cleanly report 0 anomalies (no fake ancient discoveries).',
  },
  {
    name: 'Grand Erg Occidental (Open Sahara Dunes, Algeria)',
    expectedType: 'TERRAIN_CLEAR_NEGATIVE',
    bbox: { latMin: 30.250, latMax: 30.270, lonMin: 0.850, lonMax: 0.875 },
    notes: 'Pure natural windblown sand dunes. Must report 0 anomalies (clean natural baseline).',
  },
];

async function runDiverseLocationsAudit() {
  console.log('================================================================');
  console.log('   GLOBAL DIVERSE LOCATIONS MULTI-ARCHETYPE VERIFICATION AUDIT  ');
  console.log('================================================================\n');

  const engine = new ArchaeologyEngine();
  let passedCount = 0;

  for (const loc of TEST_LOCATIONS) {
    console.log(`\n-------------------------------------------------------------`);
    console.log(`📍 Testing: ${loc.name}`);
    console.log(`   Type: ${loc.expectedType} | Bounds: [${loc.bbox.latMin}, ${loc.bbox.lonMin}] to [${loc.bbox.latMax}, ${loc.bbox.lonMax}]`);
    console.log(`   Notes: ${loc.notes}`);

    const t0 = Date.now();
    try {
      const scan = await engine.scanStudyArea(loc.bbox);
      const elapsed = Date.now() - t0;

      console.log(`   Scan completed in ${elapsed}ms:`);
      console.log(`   • Status: ${scan.status}`);
      console.log(`   • Subterranean Anomalies: ${scan.anomalies.length}`);
      if (scan.cadastralHeritage && scan.cadastralHeritage.length > 0) {
        console.log(`   • Cadastral Heritage: "${scan.cadastralHeritage[0].name}" (${scan.cadastralHeritage[0].periodOrEpoch || 'Standing Architecture'})`);
      }
      if (scan.liveSensors.sentinel2) {
        console.log(`   • Optical: ${scan.liveSensors.sentinel2.platform} (Cloud ${scan.liveSensors.sentinel2.cloudCoverPercent}%)`);
      }
      if (scan.liveSensors.dem) {
        console.log(`   • Topography: SRTM elevation ${scan.liveSensors.dem.minElevationM}m–${scan.liveSensors.dem.maxElevationM}m (Slope ${scan.liveSensors.dem.slopeDegrees}°)`);
      }
      if (scan.liveSensors.landCover) {
        console.log(`   • Land Cover: Built-up ${scan.liveSensors.landCover.builtUpPercent}%, Cropland ${scan.liveSensors.landCover.croplandPercent}%`);
      }

      let checkPassed = false;
      if (loc.expectedType === 'STANDING_HERITAGE') {
        const hasHeritage = Boolean(scan.cadastralHeritage && scan.cadastralHeritage.length > 0);
        const zeroSubterraneanFalsePositives = scan.anomalies.length === 0;
        checkPassed = hasHeritage && zeroSubterraneanFalsePositives && scan.status === 'STANDING_HERITAGE_VERIFIED';
        if (checkPassed) {
          console.log(`   ✅ [PASS] Successfully cataloged standing heritage; 0 false subterranean anomalies.`);
        } else {
          console.error(`   ❌ [FAIL] Expected standing heritage without subterranean anomalies. hasHeritage=${hasHeritage}, anomalies=${scan.anomalies.length}, status=${scan.status}`);
        }
      } else if (loc.expectedType === 'SUBTERRANEAN_DISCOVERY') {
        const confirmedAnomalies = scan.anomalies.length >= 1;
        checkPassed = confirmedAnomalies && scan.status === 'ANOMALY_CONFIRMED';
        if (checkPassed) {
          console.log(`   ✅ [PASS] Successfully confirmed genuine buried subterranean anomaly: "${scan.anomalies[0].name}" (${(scan.anomalies[0].confidenceScore * 100).toFixed(1)}% conf).`);
        } else {
          console.error(`   ❌ [FAIL] Expected genuine subterranean anomaly. anomalies=${scan.anomalies.length}, status=${scan.status}`);
        }
      } else if (loc.expectedType === 'TERRAIN_CLEAR_NEGATIVE') {
        const zeroAnomalies = scan.anomalies.length === 0;
        checkPassed = zeroAnomalies && scan.status === 'NO_ANOMALY_DETECTED';
        if (checkPassed) {
          console.log(`   ✅ [PASS] Clean terrain verified; zero false positive detections.`);
        } else {
          console.error(`   ❌ [FAIL] Expected 0 anomalies for negative control. anomalies=${scan.anomalies.length}, status=${scan.status}`);
        }
      }

      if (checkPassed) passedCount++;
    } catch (err) {
      console.error(`   ❌ [ERROR] Scan threw exception:`, (err as Error).message);
    }
  }

  console.log('\n================================================================');
  console.log(`   FINAL AUDIT SUMMARY: ${passedCount} / ${TEST_LOCATIONS.length} LOCATIONS PASSED`);
  console.log('================================================================');

  if (passedCount === TEST_LOCATIONS.length) {
    console.log('🎉 ALL ARCHETYPES (STANDING MONUMENTS, SUBTERRANEAN, & NEGATIVES) CONFIRMED WORKING GLOBALLY.');
    process.exit(0);
  } else {
    console.error('⚠️ SOME LOCATIONS FAILED.');
    process.exit(1);
  }
}

runDiverseLocationsAudit();
