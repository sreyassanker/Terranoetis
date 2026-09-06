/**
 * Audit P2 (roadmap item 4) — render the world-model's hazard forecast on the
 * globe, not just in text. When computeHazardForecast runs for a located
 * query, this builds DETERMINISTIC globe commands (no LLM involvement):
 *
 *   - a ground-clamped risk circle around the forecast location, filled by
 *     severity color (green→amber→red) — the ensemble's spatial expression
 *   - a labeled pin stating the top hazard's probability, timeframe and the
 *     words "MODEL FORECAST" so it can never be mistaken for an observation
 *
 * Entities are tagged layer:'forecast' so the chat's per-query cleanup removes
 * them when the next question is asked (same lifecycle as heatmap results).
 */

export interface ForecastPredLike {
  hazardType: string;
  probability: number;
  severity: string;
  timeframe: string;
  confidence: number;
}

const SEVERITY_FILL: Record<string, string> = {
  low: 'rgba(34,197,94,0.22)',
  medium: 'rgba(245,158,11,0.26)',
  high: 'rgba(239,68,68,0.30)',
  extreme: 'rgba(190,18,60,0.36)',
};
const SEVERITY_EDGE: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
  extreme: '#be123c',
};

const RADIUS_KM = 200;
const RING_POINTS = 48;

export function buildForecastGlobeCommands(
  loc: { lat: number; lon: number; label?: string } | null | undefined,
  preds: ForecastPredLike[] | null | undefined,
): Array<Record<string, unknown>> {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return [];
  if (!preds || preds.length === 0) return [];
  const top = [...preds].sort((a, b) => b.probability * b.confidence - a.probability * a.confidence)[0];
  if (!top || !Number.isFinite(top.probability)) return [];

  const pct = Math.round(top.probability * 100);
  const severity = SEVERITY_FILL[top.severity] ? top.severity : 'low';
  const label = `MODEL FORECAST — ${top.hazardType} ${pct}% / ${top.timeframe}`;

  // Circle in [lat, lon] pairs (the client's addPolygon convention), with
  // longitude stretched by 1/cos(lat) so it looks round on the globe.
  const dLat = RADIUS_KM / 111.32;
  const cosLat = Math.max(0.1, Math.abs(Math.cos((loc.lat * Math.PI) / 180)));
  const dLon = dLat / cosLat;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < RING_POINTS; i++) {
    const ang = (i / RING_POINTS) * Math.PI * 2;
    const lat = Math.max(-89.9, Math.min(89.9, loc.lat + dLat * Math.cos(ang)));
    const lonRaw = loc.lon + dLon * Math.sin(ang);
    const lon = ((lonRaw + 540) % 360) - 180;
    ring.push([Number(lat.toFixed(4)), Number(lon.toFixed(4))]);
  }

  // Pin sits on the circle's northern edge, offset from the flyTo focus
  // marker so the two labels never stack on the same pixel.
  const pinLat = Math.max(-89.9, Math.min(89.9, loc.lat + dLat * 0.85));

  return [
    {
      action: 'addPolygon',
      coordinates: ring,
      label,
      color: SEVERITY_FILL[severity],
      layer: 'forecast',
    },
    {
      action: 'addPin',
      lat: Number(pinLat.toFixed(4)),
      lon: Number(loc.lon.toFixed(4)),
      label,
      color: SEVERITY_EDGE[severity],
      layer: 'forecast',
    },
  ];
}
