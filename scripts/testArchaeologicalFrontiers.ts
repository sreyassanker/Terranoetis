import { globalArchaeologyEngine } from '../server/archaeology/archaeologyEngine';

async function runFrontierTests() {
  console.log('========================================================================');
  console.log('  BRUTAL HONESTY AUDIT: 3 UNEXCAVATED GLOBAL ARCHAEOLOGICAL FRONTIERS   ');
  console.log('========================================================================\n');

  const candidates = [
    {
      id: 'amazon_acre_purus_frontier',
      name: 'Southwestern Amazonia (Acre / Upper Purús Basin, Brazil)',
      region: 'Amazon Primary Rainforest',
      biome: 'jungle_canopy' as const,
      bbox: { latMin: -10.05, latMax: -9.95, lonMin: -67.85, lonMax: -67.75 },
      literatureReference: 'Peripato et al. (Science 2023, DOI: 10.1126/science.ade2541): "More than 10,000 pre-Columbian earthworks are still hidden throughout Amazonia"',
      expectedTarget: 'Geometric ditched enclosures, ring earthworks, ceremonial roads buried under multi-layer evergreen forest canopy'
    },
    {
      id: 'cholistan_ghaggar_hakra_frontier',
      name: 'Ghaggar-Hakra Indus Paleochannel Belt (Cholistan Desert)',
      region: 'Indus Valley Harappan Frontier (Pakistan / India)',
      biome: 'alluvial_floodplain' as const,
      bbox: { latMin: 28.30, latMax: 28.42, lonMin: 71.35, lonMax: 71.48 },
      literatureReference: 'Giosan et al. (PNAS 2012) & Petrie et al. (JFA 2021): Fluvial landscapes and unexcavated mature Harappan tell mounds (ther) along extinct riverbeds',
      expectedTarget: 'Unexcavated Harappan mudbrick settlement tells, kiln slag concentrations, dried irrigation networks buried under shifting barchan dunes'
    },
    {
      id: 'rub_al_khali_mundafen_frontier',
      name: 'Rub\' al-Khali Al-Mundafen Paleolake Basin (Empty Quarter)',
      region: 'Southern Arabia / Empty Quarter Frontier (Saudi Arabia)',
      biome: 'arid_desert' as const,
      bbox: { latMin: 18.52, latMax: 18.64, lonMin: 45.25, lonMax: 45.38 },
      literatureReference: 'Groucutt et al. (Nature 2021) & Stewart et al. (Nature Comms 2020): Multiple Green Arabia phases, buried Holocene lake beds and prehistoric stone structures',
      expectedTarget: 'Buried neolithic mustatil stone monuments, ancient oasis trackways, and paleolake shores buried under 1-2m aeolian sand'
    }
  ];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`[CANDIDATE ${i + 1}/3] ${c.name}`);
    console.log(`  Target: ${c.expectedTarget}`);
    console.log(`  Scientific Basis: ${c.literatureReference}`);
    console.log(`  Querying live Sentinel-2 L2A, Sentinel-1 C-Band SAR, SRTM 30m DEM & SoilGrids...`);

    const t0 = Date.now();
    try {
      const scan = await globalArchaeologyEngine.scanStudyArea(c.bbox, c.biome);
      const elapsed = Date.now() - t0;

      console.log(`\n  Execution Time: ${elapsed}ms`);
      console.log(`  Status: ${scan.status}`);
      console.log(`  Status Message: ${scan.statusMessage}`);
      console.log(`  Anomalies Flagged: ${scan.anomalies.length}`);
      console.log(`  Study Area Size: ${scan.studyAreaKm2.toFixed(2)} km²`);
      console.log(`  Spatial Grid: ${scan.spatialGrid?.points.length} points (${scan.spatialGrid?.gridWidth}x${scan.spatialGrid?.gridHeight})`);

      console.log(`\n  Live Sensor Telemetry Acquired:`);
      if (scan.liveSensors.sentinel2) {
        console.log(`    - Sentinel-2: Scene ${scan.liveSensors.sentinel2.sceneId} (Cloud: ${scan.liveSensors.sentinel2.cloudCoverPercent}%)`);
        if (scan.liveSensors.sentinel2.pixelStatistics) {
          console.log(`      Valid Pixels Analyzed: ${scan.liveSensors.sentinel2.pixelStatistics.validPixelsAnalyzed.toLocaleString()}`);
          console.log(`      NDRE: ${scan.liveSensors.sentinel2.pixelStatistics.computedNdre.toFixed(4)}, NDVI: ${scan.liveSensors.sentinel2.pixelStatistics.computedNdvi.toFixed(4)}, NDMI: ${scan.liveSensors.sentinel2.pixelStatistics.computedNdmi.toFixed(4)}`);
        }
      } else {
        console.log(`    - Sentinel-2: Unavailable or obscured`);
      }

      if (scan.liveSensors.sentinel1) {
        console.log(`    - Sentinel-1 SAR: Scene ${scan.liveSensors.sentinel1.sceneId} (${scan.liveSensors.sentinel1.platform}, Pols: ${scan.liveSensors.sentinel1.polarizations.join('/')}, Mode: ${scan.liveSensors.sentinel1.mode})`);
      }

      if (scan.liveSensors.dem) {
        console.log(`    - SRTM 30m DEM: Elevation ${scan.liveSensors.dem.minElevationM}m - ${scan.liveSensors.dem.maxElevationM}m (Mean: ${scan.liveSensors.dem.meanElevationM}m, Slope: ${scan.liveSensors.dem.slopeDegrees}°, StdDev: ${scan.liveSensors.dem.elevationStdDevM}m)`);
      }

      if (scan.liveSensors.soil) {
        console.log(`    - SoilGrids: Sand ${scan.liveSensors.soil.sandPercent}%, Clay ${scan.liveSensors.soil.clayPercent}%, Silt ${scan.liveSensors.soil.siltPercent}% (${scan.liveSensors.soil.textureClass})`);
      }

      if (scan.spatialGrid) {
        const vals = scan.spatialGrid.points.map(p => p.value);
        const minVal = Math.min(...vals);
        const maxVal = Math.max(...vals);
        const meanVal = vals.reduce((a, b) => a + b, 0) / vals.length;
        console.log(`    - CAPI Terrain Response: Min=${minVal.toFixed(4)}, Max=${maxVal.toFixed(4)}, Mean=${meanVal.toFixed(4)}`);
      }

      if (scan.anomalies.length > 0) {
        console.log(`\n  🚨 DETECTED ANOMALIES (${scan.anomalies.length}):`);
        for (const a of scan.anomalies) {
          console.log(`    - [${a.category.toUpperCase()}] "${a.name}"`);
          console.log(`      Confidence: ${(a.confidenceScore * 100).toFixed(1)}%`);
          console.log(`      Centroid: (${a.centroid.lat.toFixed(6)}, ${a.centroid.lon.toFixed(6)})`);
          console.log(`      Evidence Summary: ${a.evidenceSummary}`);
        }
      } else {
        console.log(`\n  🔍 BRUTAL HONESTY RESULT: No consensus anomalies declared above threshold.`);
      }

    } catch (err) {
      console.error(`  Scan Error for ${c.name}:`, err);
    }
  }

  console.log(`\n========================================================================`);
  console.log(`                    FRONTIER AUDIT EXECUTION COMPLETE                   `);
  console.log(`========================================================================\n`);
}

runFrontierTests().catch(err => {
  console.error('Fatal frontier test error:', err);
  process.exit(1);
});
