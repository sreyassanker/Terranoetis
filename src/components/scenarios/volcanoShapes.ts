/**
 * volcanoShapes.ts — generate the hazard-zone ShapeData[] for the spatial
 * sketch of a volcanic eruption. These are the schematic zones rendered by
 * `VolcanicVisualizer` on the Cesium globe:
 *   - BALLISTIC ZONE   (innermost ring around the vent)
 *   - LAVA FLOW        (polyline downslope from the vent, glowing)
 *   - PYROCLASTIC CURRENT (intensity_zone fan around the vent)
 *   - LAHAR            (intensity_zone wedge down a drainage)
 *   - ERUPTION COLUMN  (pulsing cylinder over the vent)
 *
 * The zones are schematic (analytical, derived from the sketched bbox), NOT
 * the kernel's PDE outputs — the kernel outputs are rendered separately by
 * KaggleVolcanoOverlay / VolcanoEnsembleOverlay. This gives instant visual
 * feedback during sketching before a full run completes.
 */

import type { ShapeData } from './types';

export interface VolcanoSketchInput {
  center: { lat: number; lon: number };
  /** Approximate radius of the hazard footprint in km. */
  radiusKm: number;
  /** Downslope bearing (degrees, 0 = N) — drives lava/PDC direction. */
  downslopeDeg?: number;
}

const ZONE_COLORS = {
  lava: '#ff4500',
  pdc: '#a855f7',
  lahar: '#8b4513',
  ballistic: '#f59e0b',
  column: '#d946ef',
};

/** Bearing → unit (lat, lon) offset for a given km distance. */
function offsetAtBearing(lat: number, lon: number, km: number, deg: number): { lat: number; lon: number } {
  const rad = deg * (Math.PI / 180);
  const dLat = km / 111.0;
  const dLon = km / (111.0 * Math.max(0.1, Math.cos(lat * (Math.PI / 180))));
  return {
    lat: lat + dLat * Math.cos(rad),
    lon: lon + dLon * Math.sin(rad),
  };
}

/** Fan of points: from `bearing - half` to `bearing + half` at `radiusKm`. */
function fan(
  center: { lat: number; lon: number },
  radiusKm: number,
  bearingDeg: number,
  halfAngleDeg: number,
  n = 16,
): { lat: number; lon: number }[] {
  const pts: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const a = bearingDeg - halfAngleDeg + (2 * halfAngleDeg * i) / n;
    pts.push(offsetAtBearing(center.lat, center.lon, radiusKm, a));
  }
  return pts;
}

/**
 * Build the schematic volcanic hazard zones for the spatial sketch.
 * `downslopeDeg` defaults to 180 (south) when the real terrain slope is
 * unknown — the caller can pass the local slope bearing for realism.
 */
export function buildVolcanoShapes(input: VolcanoSketchInput): ShapeData[] {
  const { center, radiusKm, downslopeDeg = 180 } = input;
  const shapes: ShapeData[] = [];

  // ── ERUPTION COLUMN (pulsing cylinder over the vent) ──
  shapes.push({
    type: 'cylinder',
    color: ZONE_COLORS.column,
    opacity: 0.4,
    center,
    radius: Math.max(radiusKm * 0.15, 0.3),
    height: Math.max(radiusKm * 2.5, 3),
  } as unknown as ShapeData);

  // ── BALLISTIC ZONE (innermost ring) ──
  shapes.push({
    type: 'ring',
    color: ZONE_COLORS.ballistic,
    opacity: 0.25,
    center,
    radius: radiusKm * 0.25,
    waveType: 'ballistic',
  } as unknown as ShapeData);

  // ── LAVA FLOW (glowing polyline downslope) ──
  const lavaStart = offsetAtBearing(center.lat, center.lon, radiusKm * 0.1, downslopeDeg);
  const lavaMid = offsetAtBearing(center.lat, center.lon, radiusKm * 0.45, downslopeDeg);
  const lavaEnd = offsetAtBearing(center.lat, center.lon, radiusKm * 0.85, downslopeDeg);
  const lateral = offsetAtBearing(center.lat, center.lon, radiusKm * 0.08, downslopeDeg + 90);
  shapes.push({
    type: 'polyline',
    color: '#991b1b', // dark lava — VolcanicVisualizer gives it the glow
    opacity: 0.9,
    width: 5,
    positions: [
      lavaStart,
      offsetAtBearing(lavaMid.lat, lavaMid.lon, radiusKm * 0.05, downslopeDeg + 70),
      lavaMid,
      offsetAtBearing(lavaMid.lat, lavaMid.lon, radiusKm * 0.05, downslopeDeg - 60),
      lavaEnd,
      offsetAtBearing(lavaEnd.lat, lavaEnd.lon, radiusKm * 0.02, downslopeDeg + 20),
      lateral,
    ],
  } as unknown as ShapeData);

  // ── PYROCLASTIC CURRENT (intensity_zone fan around the vent) ──
  shapes.push({
    type: 'intensity_zone',
    color: ZONE_COLORS.pdc,
    opacity: 0.2,
    center,
    waveType: 'pdc',
    positions: [
      center,
      ...fan(center, radiusKm * 0.6, downslopeDeg, 55),
    ],
  } as unknown as ShapeData);

  // ── LAHAR (wedge down a drainage, narrower than the PDC fan) ──
  shapes.push({
    type: 'intensity_zone',
    color: ZONE_COLORS.lahar,
    opacity: 0.25,
    center,
    waveType: 'lahar',
    positions: [
      center,
      ...fan(center, radiusKm * 0.75, downslopeDeg + 18, 20),
    ],
  } as unknown as ShapeData);

  return shapes;
}
