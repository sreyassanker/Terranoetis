/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Cesium from 'cesium';
import * as satellite from 'satellite.js';

export interface SatnogsTransmitter {
  uuid: string;
  description: string;
  alive: boolean;
  type: string;
  uplink_low: number | null;
  uplink_high: number | null;
  downlink_low: number | null;
  downlink_high: number | null;
  mode: string;
  baud: number | null;
  norad_cat_id: number;
  status: string;
  service: string;
  updated: string;
}

export interface NormalizedSatelliteFrequencies {
  noradId: number;
  transmitters: {
    description: string;
    downlink: string;
    uplink: string;
    mode: string;
    baud: string;
    type: string;
    status: string;
  }[];
}

const satnogsData = new Map<number, NormalizedSatelliteFrequencies>();

export function getSatnogsData(): Map<number, NormalizedSatelliteFrequencies> {
  return satnogsData;
}

export function getSatnogsForNorad(noradId: number): NormalizedSatelliteFrequencies | undefined {
  return satnogsData.get(noradId);
}

export function normalizeTransmitters(data: SatnogsTransmitter[]): NormalizedSatelliteFrequencies[] {
  const grouped = new Map<number, NormalizedSatelliteFrequencies>();
  for (const t of data) {
    if (!t.norad_cat_id) continue;
    let entry = grouped.get(t.norad_cat_id);
    if (!entry) {
      entry = { noradId: t.norad_cat_id, transmitters: [] };
      grouped.set(t.norad_cat_id, entry);
    }
    entry.transmitters.push({
      description: t.description || '',
      downlink: t.downlink_low ? formatFreq(t.downlink_low) : '',
      uplink: t.uplink_low ? formatFreq(t.uplink_low) : '',
      mode: t.mode || '',
      baud: t.baud ? `${t.baud}` : '',
      type: t.type || '',
      status: t.status || '',
    });
  }
  return Array.from(grouped.values());
}

export async function fetchAndStoreSatnogsData(
  apiGet: <T>(path: string) => Promise<T>,
  progressCallback?: (count: number) => void,
): Promise<NormalizedSatelliteFrequencies[]> {
  const raw = await apiGet<SatnogsTransmitter[]>('/satnogs/transmitters');
  const normalized = normalizeTransmitters(raw);
  satnogsData.clear();
  for (const entry of normalized) {
    satnogsData.set(entry.noradId, entry);
  }
  progressCallback?.(normalized.length);
  return normalized;
}

function formatFreq(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(2)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
  return `${hz} Hz`;
}

function colorByFrequencyBand(freqs: NormalizedSatelliteFrequencies): Cesium.Color {
  let maxFreq = 0;
  for (const t of freqs.transmitters) {
    const v = parseFloat(t.downlink);
    if (isFinite(v) && v > maxFreq) maxFreq = v;
    const u = parseFloat(t.uplink);
    if (isFinite(u) && u > maxFreq) maxFreq = u;
  }
  if (maxFreq >= 10) return Cesium.Color.RED;
  if (maxFreq >= 4) return Cesium.Color.ORANGE;
  if (maxFreq >= 2) return Cesium.Color.YELLOW;
  if (maxFreq >= 1) return Cesium.Color.LIME;
  if (maxFreq >= 0.1) return Cesium.Color.CYAN;
  return Cesium.Color.fromCssColorString('#94a3b8');
}

export async function addSatnogsEntities(
  viewer: Cesium.Viewer,
  apiGet: <T>(path: string) => Promise<T>,
): Promise<Cesium.Entity[]> {
  const ents: Cesium.Entity[] = [];
  if (satnogsData.size === 0) return ents;

  let tleItems: any[] = [];
  try {
    tleItems = await apiGet<any[]>('/satellites/tle');
  } catch {
    return ents;
  }

  for (const item of tleItems) {
    const noradId = parseInt(item.id, 10);
    if (!noradId) continue;
    const freqs = satnogsData.get(noradId);
    if (!freqs) continue;
    if (!item.tle1 || !item.tle2) continue;

    let satrec: any;
    try { satrec = satellite.twoline2satrec(item.tle1, item.tle2); } catch { continue; }

    const color = colorByFrequencyBand(freqs);
    const name = item.name || String(noradId);

    const position = new Cesium.CallbackProperty(
      (time: Cesium.JulianDate | undefined) => {
        try {
          const date = Cesium.JulianDate.toDate(time!);
          const pv = satellite.propagate(satrec, date);
          const pos = pv?.position;
          if (pos && typeof pos.x === 'number' && isFinite(pos.x)) {
            const gmst = satellite.gstime(date);
            const gd = satellite.eciToGeodetic(pos, gmst);
            return Cesium.Cartesian3.fromDegrees(
              satellite.degreesLong(gd.longitude),
              satellite.degreesLat(gd.latitude),
              gd.height * 1000,
            );
          }
        } catch { /* fall through */ }
        return Cesium.Cartesian3.ZERO;
      },
      false,
    ) as unknown as Cesium.PositionProperty;

    const ent = viewer.entities.add({
      position,
      name,
      point: {
        pixelSize: 5,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.NONE,
        scaleByDistance: new Cesium.NearFarScalar(1.5e6, 2.0, 1.5e8, 0.3),
      },
      properties: {
        layer: 'satnogs_db',
        noradId,
        name,
        transmitterCount: freqs.transmitters.length,
        transmitters: freqs.transmitters,
        frequencySummary: freqs.transmitters.map(t => t.downlink).filter(Boolean).join(', '),
      },
    });
    ents.push(ent);
  }
  return ents;
}
