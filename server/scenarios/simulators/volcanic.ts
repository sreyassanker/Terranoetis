import type { ScenarioParams, ScenarioTimeSeries, TimeStep, ShapeData, Point3D } from '../templates';
import { SeededRNG, scenarioSeed } from './rng';

/** VEI scale — column height (km), ejecta volume (km³), blast radius (km) */
const VEI_PARAMS: Record<number, { colHeightKm: number; ejectaVol: number; blastRadiusKm: number; label: string }> = {
  0: { colHeightKm: 0.1, ejectaVol: 0.00001, blastRadiusKm: 1, label: 'Effusive' },
  1: { colHeightKm: 1, ejectaVol: 0.001, blastRadiusKm: 5, label: 'Gentle' },
  2: { colHeightKm: 5, ejectaVol: 0.01, blastRadiusKm: 10, label: 'Explosive' },
  3: { colHeightKm: 10, ejectaVol: 0.1, blastRadiusKm: 30, label: 'Severe' },
  4: { colHeightKm: 15, ejectaVol: 1, blastRadiusKm: 50, label: 'Cataclysmic' },
  5: { colHeightKm: 20, ejectaVol: 10, blastRadiusKm: 100, label: 'Paroxysmal' },
  6: { colHeightKm: 25, ejectaVol: 100, blastRadiusKm: 200, label: 'Colossal' },
  7: { colHeightKm: 30, ejectaVol: 1000, blastRadiusKm: 300, label: 'Subplinian' },
  8: { colHeightKm: 40, ejectaVol: 10000, blastRadiusKm: 500, label: 'Super-colossal' },
};

function geoToSphere(lat: number, lon: number, height: number): Point3D {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const r = 1 - height * 0.0000001;
  return { x: r * Math.cos(latRad) * Math.cos(lonRad), y: r * Math.cos(latRad) * Math.sin(lonRad), z: r * Math.sin(latRad) };
}

/** Lava flow rate from VEI (m³/s simplified FLOWGO) */
function _lavaFlowRate(vei: number, slopeDeg: number): number {
  const baseRate = [1, 10, 50, 200, 500, 1000, 5000, 10000, 20000][Math.min(vei, 8)];
  return baseRate * (1 + Math.tan(slopeDeg * Math.PI / 180) * 0.5);
}

/** Pyroclastic density current runout distance (km) — simplified Energy Line model */
function pdcRunout(vei: number, slopeDeg: number): number {
  const base = [0, 2, 8, 20, 50, 100, 200, 400, 800][Math.min(vei, 8)];
  const slopeFactor = Math.max(0.5, 1 + (15 - slopeDeg) * 0.03);
  return base * slopeFactor;
}

/** Ash fallout thickness (cm) at distance — exponential decay from vent */
function ashThickness(distKm: number, vei: number): number {
  const maxThick = [0.1, 1, 5, 20, 50, 100, 200, 400, 800][Math.min(vei, 8)];
  return maxThick * Math.exp(-distKm * 0.02);
}

/** Lahar volume from VEI (million m³) */
function laharVolume(vei: number): number {
  return [0, 0.1, 1, 10, 50, 200, 1000, 3000, 10000][Math.min(vei, 8)];
}

/** Generate lava flow path — follows steepest descent */
function lavaFlowPath(
  lat: number, lon: number, windDir: number, distKm: number,
  numSegments: number, rng: SeededRNG,
): { lat: number; lon: number }[] {
  const kmToDeg = 1 / 111;
  const path: { lat: number; lon: number }[] = [{ lat, lon }];
  let curLat = lat;
  let curLon = lon;
  const segLen = distKm / numSegments;
  for (let i = 0; i < numSegments; i++) {
    const jitter = (rng.next() - 0.5) * 0.4;
    const angle = windDir * Math.PI / 180 + jitter;
    curLat += segLen * kmToDeg * Math.cos(angle);
    curLon += segLen * kmToDeg * Math.sin(angle) / Math.cos(lat * Math.PI / 180);
    path.push({ lat: curLat, lon: curLon });
  }
  return path;
}

/** Generate PDC front — widening arc */
function pdcFront(
  lat: number, lon: number, runoutKm: number, timeFrac: number,
  rng: SeededRNG,
): { lat: number; lon: number }[] {
  const kmToDeg = 1 / 111;
  const pts: { lat: number; lon: number }[] = [];
  const numPts = 24;
  const currentDist = runoutKm * timeFrac;
  const halfAngle = Math.PI * 0.4;
  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts;
    const angle = -halfAngle + t * halfAngle * 2;
    const jitter = (rng.next() - 0.5) * 0.05;
    const r = currentDist * (1 - 0.2 * Math.abs(t - 0.5));
    pts.push({
      lat: lat + (r * kmToDeg) * Math.cos(angle + jitter),
      lon: lon + (r * kmToDeg) * Math.sin(angle + jitter) / Math.cos(lat * Math.PI / 180),
    });
  }
  return pts;
}

/** Generate hazard zone rings */
function hazardRings(
  lat: number, lon: number, maxRadiusKm: number,
): { lat: number; lon: number }[][] {
  const kmToDeg = 1 / 111;
  const rings: { lat: number; lon: number }[][] = [];
  const radii = [maxRadiusKm * 0.1, maxRadiusKm * 0.3, maxRadiusKm * 0.6, maxRadiusKm];
  const numPts = 32;
  for (const radius of radii) {
    const pts: { lat: number; lon: number }[] = [];
    for (let i = 0; i <= numPts; i++) {
      const angle = (i / numPts) * 2 * Math.PI;
      pts.push({
        lat: lat + (radius * kmToDeg) * Math.cos(angle),
        lon: lon + (radius * kmToDeg) * Math.sin(angle) / Math.cos(lat * Math.PI / 180),
      });
    }
    rings.push(pts);
  }
  return rings;
}

export function simulateVolcanic(params: ScenarioParams): ScenarioTimeSeries {
  const p = params as { lat: number; lon: number; vei: number; ashHeight: number; windDir: number; duration: number };
  const rng = new SeededRNG(scenarioSeed('volcanic_eruption', p));
  const steps: TimeStep[] = [];
  const durationH = p.duration;
  const dt = Math.max(0.5, durationH / 60);
  const vei = Math.max(0, Math.min(8, p.vei));
  // Meteorological FROM convention: ash/plume are transported in the TO
  // direction, i.e. 180° from the reported wind bearing. This matches the
  // rigorous volcano kernel (wind_dir is "from", drift = wind_dir + 180).
  const driftRad = ((p.windDir + 180) % 360) * Math.PI / 180;
  const veiInfo = VEI_PARAMS[vei];
  const maxPlumeH = p.ashHeight > 0 ? p.ashHeight : veiInfo.colHeightKm * 1000;
  const eruptionPhaseH = Math.min(6, durationH * 0.15);
  const dispersalPhaseH = durationH - eruptionPhaseH;
  const KM_TO_DEG = 1 / 111;

  // Pre-generate lava flow paths
  const numLavaFlows = Math.min(vei + 1, 4);
  const lavaFlows: { lat: number; lon: number }[][] = [];
  for (let i = 0; i < numLavaFlows; i++) {
    const angle = (i / numLavaFlows) * Math.PI * 2;
    const dist = 5 + rng.next() * 15;
    const lavaRng = new SeededRNG(scenarioSeed('lava_' + i, p));
    lavaFlows.push(lavaFlowPath(p.lat, p.lon, (p.windDir + angle * 180 / Math.PI) % 360, dist, 20, lavaRng));
  }

  // Pre-generate hazard zone rings
  const hazardRingsData = hazardRings(p.lat, p.lon, veiInfo.blastRadiusKm);

  for (let t = 0; t <= durationH; t += dt) {
    const points: Point3D[] = [];
    const intensities: number[] = [];
    const shapes: ShapeData[] = [];
    const timeFrac = Math.min(1, t / durationH);

    // ─── 1. Eruption Column (persistent vent cylinder) ────────
    shapes.push({
      type: 'cylinder',
      color: '#d946ef',
      opacity: 0.5 * (t <= eruptionPhaseH ? Math.min(1, t / eruptionPhaseH) : Math.max(0.2, 1 - (t - eruptionPhaseH) / dispersalPhaseH)),
      center: { lat: p.lat, lon: p.lon },
      radius: 800 + vei * 200,
      height: maxPlumeH * 0.4,
    });

    // ─── 2. Eruption Column Particles ────────────────────────
    if (t <= eruptionPhaseH) {
      const plumeFrac = t / eruptionPhaseH;
      const plumeH = maxPlumeH * plumeFrac;
      const numParticles = Math.floor(200 + vei * 100);
      for (let i = 0; i < numParticles; i++) {
        const h = plumeH * rng.next();
        const drift = (h / maxPlumeH) * 3 * (rng.next() - 0.5);
        const lat = p.lat + drift * Math.cos(driftRad) + (rng.next() - 0.5) * 0.5;
        const lon = p.lon + drift * Math.sin(driftRad) / Math.cos(p.lat * Math.PI / 180) + (rng.next() - 0.5) * 0.5;
        points.push(geoToSphere(lat, lon, h));
        intensities.push(h / maxPlumeH);
      }

      // Umbrella cloud (spreading at top of column)
      const umbrellaRadius = plumeFrac * veiInfo.blastRadiusKm * 0.3;
      const umbrellaPts: { lat: number; lon: number }[] = [];
      for (let i = 0; i <= 24; i++) {
        const angle = (i / 24) * 2 * Math.PI;
        umbrellaPts.push({
          lat: p.lat + (umbrellaRadius * KM_TO_DEG) * Math.cos(angle + driftRad * 0.3),
          lon: p.lon + (umbrellaRadius * KM_TO_DEG) * Math.sin(angle + driftRad * 0.3) / Math.cos(p.lat * Math.PI / 180),
        });
      }
      shapes.push({
        type: 'intensity_zone',
        color: '#c084fc',
        opacity: 0.12,
        positions: umbrellaPts,
        center: { lat: p.lat, lon: p.lon },
        radius: umbrellaRadius,
        mmi: Math.min(10, Math.round(plumeH / 2000)),
      });
    }

    // ─── 3. Ash Cloud Dispersal (HYSPLIT-inspired) ───────────
    if (t > eruptionPhaseH * 0.3) {
      const elapsed = Math.max(0, t - eruptionPhaseH * 0.3);
      const decayH = Math.exp(-elapsed / (dispersalPhaseH * 0.4));
      const ashH = maxPlumeH * decayH * 0.6;
      const driftDist = elapsed * 2;
      const crossSpread = 2 + elapsed * 0.3;

      // Ash plume cone
      const ashLat = p.lat + (driftDist * 0.5 * KM_TO_DEG) * Math.cos(driftRad);
      const ashLon = p.lon + (driftDist * 0.5 * KM_TO_DEG) * Math.sin(driftRad) / Math.cos(p.lat * Math.PI / 180);
      const ashRadius = driftDist * 0.8 + crossSpread;
      const ashPts: { lat: number; lon: number }[] = [];
      for (let i = 0; i <= 32; i++) {
        const angle = (i / 32) * 2 * Math.PI;
        const r = ashRadius * (1 + 0.3 * Math.cos(angle - driftRad));
        ashPts.push({
          lat: ashLat + (r * KM_TO_DEG) * Math.cos(angle),
          lon: ashLon + (r * KM_TO_DEG) * Math.sin(angle) / Math.cos(ashLat * Math.PI / 180),
        });
      }
      shapes.push({
        type: 'intensity_zone',
        color: '#6b7280',
        opacity: 0.08 * decayH,
        positions: ashPts,
        center: { lat: ashLat, lon: ashLon },
        radius: ashRadius,
        mmi: Math.min(10, Math.round(ashH / 1500)),
      });

      // Ash fallout zone (exponential thickness)
      const falloutDist = driftDist + crossSpread;
      const falloutThick = ashThickness(falloutDist, vei);
      if (falloutThick > 0.1) {
        shapes.push({
          type: 'intensity_zone',
          color: '#a1a1aa',
          opacity: 0.06,
          positions: ashPts.map(p => ({ lat: p.lat * 1.1 - ashLat * 0.1, lon: p.lon * 1.1 - ashLon * 0.1 })),
          center: { lat: ashLat * 1.1 - ashLat * 0.1, lon: ashLon * 1.1 - ashLon * 0.1 },
          radius: falloutDist * 1.2,
          mmi: Math.min(10, Math.round(falloutThick)),
        });
      }

      // Ash particles
      const numParticles = Math.floor(150 * decayH);
      for (let i = 0; i < numParticles; i++) {
        const h = ashH * rng.next();
        const drift = elapsed * 2 + (rng.next() - 0.5) * (5 + elapsed * 0.5);
        const cross = (rng.next() - 0.5) * crossSpread;
        const lat = p.lat + drift * Math.cos(driftRad) + cross * Math.cos(driftRad + Math.PI / 2);
        const lon = p.lon + (drift * Math.sin(driftRad) + cross * Math.sin(driftRad + Math.PI / 2)) / Math.cos(p.lat * Math.PI / 180);
        points.push(geoToSphere(lat, lon, h));
        intensities.push(decayH * (1 - h / ashH));
      }
    }

    // ─── 4. Lava Flows (FLOWGO-inspired) ─────────────────────
    if (vei >= 1 && t > eruptionPhaseH * 0.2) {
      const flowProgress = Math.min(1, (t - eruptionPhaseH * 0.2) / (durationH * 0.6));
      for (let f = 0; f < numLavaFlows; f++) {
        const flow = lavaFlows[f];
        const visibleLen = Math.floor(flow.length * flowProgress);
        if (visibleLen >= 2) {
          const flowSlice = flow.slice(0, visibleLen + 1);
          // Lava flow front (bright red head)
          const front = flowSlice[flowSlice.length - 1];
          shapes.push({
            type: 'ring',
            color: '#ff4500',
            opacity: 0.7,
            center: { lat: front.lat, lon: front.lon },
            radius: 300 + rng.next() * 500,
            waveType: 'lava',
          });
          // Lava flow path (dark red)
          shapes.push({
            type: 'polyline',
            color: '#991b1b',
            opacity: 0.5,
            positions: flowSlice,
            width: 3 + vei,
          });
        }
      }
    }

    // ─── 5. Pyroclastic Density Current (PDC) ────────────────
    if (vei >= 3 && t > eruptionPhaseH * 0.5) {
      const pdcElapsed = t - eruptionPhaseH * 0.5;
      const pdcRunoutKm = pdcRunout(vei, 10);
      const pdcTimeFrac = Math.min(1, pdcElapsed / (dispersalPhaseH * 0.3));
      const pdcPts = pdcFront(p.lat, p.lon, pdcRunoutKm, pdcTimeFrac, rng);
      if (pdcPts.length >= 3) {
        shapes.push({
          type: 'intensity_zone',
          color: '#f97316',
          opacity: 0.18,
          positions: pdcPts,
          center: { lat: p.lat, lon: p.lon },
          radius: pdcRunoutKm * pdcTimeFrac,
          mmi: Math.min(10, Math.round(vei * 1.5)),
          waveType: 'pdc',
        });
      }
    }

    // ─── 6. Lahars (volcanic mudflows) ────────────────────────
    if (vei >= 3 && t > eruptionPhaseH * 0.8) {
      const lahaElapsed = t - eruptionPhaseH * 0.8;
      const lahaProgress = Math.min(1, lahaElapsed / (dispersalPhaseH * 0.4));
      const numLahars = Math.min(3, vei - 1);
      for (let l = 0; l < numLahars; l++) {
        // Lahars are gravity-driven mudflows that follow valleys/downhill
        // drainage — they do NOT respond to wind. With no DEM available in
        // this illustrative layer we radiate them on evenly-spaced bearings
        // away from the vent rather than tying them to the wind direction.
        const lahaAngle = (l / Math.max(1, numLahars)) * 2 * Math.PI + 0.3;
        const lahaDist = lahaProgress * 30 * Math.pow(laharVolume(vei), 0.33);
        const lahaWidth = 1 + lahaProgress * 3;
        const lahaPts: { lat: number; lon: number }[] = [];
        const numLahaPts = 16;
        for (let i = 0; i <= numLahaPts; i++) {
          const t2 = i / numLahaPts;
          const d = t2 * lahaDist;
          const w = lahaWidth * (1 - t2 * 0.5);
          const jitter = (rng.next() - 0.5) * 0.05;
          lahaPts.push({
            lat: p.lat + (d * KM_TO_DEG) * Math.cos(lahaAngle + jitter) + (w * KM_TO_DEG * 0.5) * Math.cos(lahaAngle + Math.PI / 2),
            lon: p.lon + (d * KM_TO_DEG) * Math.sin(lahaAngle + jitter) / Math.cos(p.lat * Math.PI / 180) + (w * KM_TO_DEG * 0.5) * Math.sin(lahaAngle + Math.PI / 2) / Math.cos(p.lat * Math.PI / 180),
          });
        }
        // Reverse side
        for (let i = numLahaPts; i >= 0; i--) {
          const t2 = i / numLahaPts;
          const d = t2 * lahaDist;
          const w = lahaWidth * (1 - t2 * 0.5);
          const jitter = (rng.next() - 0.5) * 0.05;
          lahaPts.push({
            lat: p.lat + (d * KM_TO_DEG) * Math.cos(lahaAngle + jitter) - (w * KM_TO_DEG * 0.5) * Math.cos(lahaAngle + Math.PI / 2),
            lon: p.lon + (d * KM_TO_DEG) * Math.sin(lahaAngle + jitter) / Math.cos(p.lat * Math.PI / 180) - (w * KM_TO_DEG * 0.5) * Math.sin(lahaAngle + Math.PI / 2) / Math.cos(p.lat * Math.PI / 180),
          });
        }
        shapes.push({
          type: 'intensity_zone',
          color: '#78350f',
          opacity: 0.15 + lahaProgress * 0.1,
          positions: lahaPts,
          center: { lat: p.lat, lon: p.lon },
          radius: lahaDist,
          mmi: Math.min(10, Math.round(lahaProgress * 8)),
          waveType: 'lahar',
        });
      }
    }

    // ─── 7. Ballistic Projectile Zone ────────────────────────
    if (t <= eruptionPhaseH) {
      const ballisticRadius = veiInfo.blastRadiusKm * 0.1 * (t / eruptionPhaseH);
      const ballPts: { lat: number; lon: number }[] = [];
      for (let i = 0; i <= 24; i++) {
        const angle = (i / 24) * 2 * Math.PI;
        ballPts.push({
          lat: p.lat + (ballisticRadius * KM_TO_DEG) * Math.cos(angle),
          lon: p.lon + (ballisticRadius * KM_TO_DEG) * Math.sin(angle) / Math.cos(p.lat * Math.PI / 180),
        });
      }
      shapes.push({
        type: 'ring',
        color: '#fbbf24',
        opacity: 0.4,
        center: { lat: p.lat, lon: p.lon },
        radius: ballisticRadius * 1000,
        waveType: 'ballistic',
      });
    }

    // ─── 8. Hazard Zone Rings (persistent) ───────────────────
    if (t < durationH * 0.8) {
      const zoneAlpha = 0.04 + (1 - timeFrac) * 0.04;
      for (let r = 0; r < hazardRingsData.length; r++) {
        const ring = hazardRingsData[r];
        const zoneColors = ['#ef4444', '#f97316', '#facc15', '#a3e635'];
        shapes.push({
          type: 'intensity_zone',
          color: zoneColors[r] || '#a3e635',
          opacity: zoneAlpha * (1 - r * 0.2),
          positions: ring,
          center: { lat: p.lat, lon: p.lon },
          radius: veiInfo.blastRadiusKm * [0.1, 0.3, 0.6, 1][r],
          mmi: [10, 8, 6, 4][r],
        });
      }
    }

    const phase = t <= eruptionPhaseH ? 'eruption' : 'dispersal';
    const label = `[VOLCANO] VEI ${vei} — ${veiInfo.label} — ${phase} — ${t.toFixed(1)}h`;
    steps.push({ time: t * 3600, points, shapes, intensity: intensities, label });
  }

  return {
    steps,
    metadata: { duration: durationH * 3600, dt: dt * 3600, type: 'volcanic_eruption', params: p as Record<string, unknown> },
  };
}
