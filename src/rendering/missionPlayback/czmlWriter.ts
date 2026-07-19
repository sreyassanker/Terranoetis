/**
 * CzmlWriter
 * Converts MissionSnapshot arrays into Cesium-compatible CZML documents.
 * CZML is a JSON schema for describing time-dynamic graphical scenes.
 * See: https://github.com/CesiumGS/czml-writer/wiki
 */

import type { MissionSnapshot, EntitySnapshot } from './recorder';

/** CZML packet structure (simplified for mission playback) */
interface CzmlPacket {
  id: string;
  name?: string;
  description?: string;
  availability?: string;
  position?: {
    cartographicDegrees: number[];
  };
  point?: {
    pixelSize: number;
    color: { rgba: number[] };
    outlineColor: { rgba: number[] };
    outlineWidth: number;
    heightReference?: string;
  };
  label?: {
    text: string;
    font: string;
    fillColor: { rgba: number[] };
    outlineColor: { rgba: number[] };
    outlineWidth: number;
    style: string;
    pixelOffset: { cartesian2: number[] };
    verticalOrigin: string;
    showBackground?: boolean;
    backgroundColor?: { rgba: number[] };
  };
  path?: {
    leadTime: number;
    trailTime: number;
    width: number;
    material: {
      solidColor: { color: { rgba: number[] } };
    };
    resolution: number;
  };
  polyline?: {
    positions: { cartographicDegrees: number[] };
    width: number;
    material: { solidColor: { color: { rgba: number[] } } };
    clampToGround: boolean;
  };
  properties?: Record<string, unknown>;
}

/** Category → color mapping (RGBA) */
const CATEGORY_COLORS: Record<string, number[]> = {
  bft: [59, 130, 246, 255],          // blue
  cop: [34, 197, 94, 255],           // green
  targeting: [239, 68, 68, 255],     // red
  tewa: [249, 115, 22, 255],         // orange
  airDefense: [220, 38, 38, 255],    // dark red
  missionPlanning: [139, 92, 246, 255], // violet
  dataLinks: [139, 92, 246, 255],    // violet
  ew: [245, 158, 11, 255],           // amber
  isr: [6, 182, 212, 255],           // cyan
  maritime: [14, 165, 233, 255],     // sky blue
  geoint: [168, 85, 247, 255],       // purple
  nuclear: [255, 255, 0, 255],       // yellow
  cde: [239, 68, 68, 255],           // red
  cyber: [16, 185, 129, 255],        // emerald
  fp: [245, 158, 11, 255],           // amber
  wargaming: [168, 85, 247, 255],    // purple
  aar: [148, 163, 184, 255],         // slate
  hadr: [234, 179, 8, 255],          // yellow
  orbat: [251, 191, 36, 255],        // amber
};

/** Affiliation → color override */
const AFFILIATION_COLORS: Record<string, number[]> = {
  friend: [59, 130, 246, 255],
  hostile: [239, 68, 68, 255],
  neutral: [234, 179, 8, 255],
  unknown: [148, 163, 184, 255],
};

function getColor(entity: EntitySnapshot): number[] {
  if (entity.affiliation && AFFILIATION_COLORS[entity.affiliation]) {
    return AFFILIATION_COLORS[entity.affiliation];
  }
  if (entity.color) {
    // Parse hex color
    const hex = entity.color.replace('#', '');
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        255,
      ];
    }
  }
  return CATEGORY_COLORS[entity.category] || [148, 163, 184, 255];
}

function julianDateFromMs(ms: number): string {
  // CZML uses ISO 8601 dates
  return new Date(ms).toISOString();
}

/**
 * Convert an array of MissionSnapshot into a CZML document.
 * Each entity gets a CZML packet with time-dynamic positions and point styling.
 */
export function snapshotsToCzml(snapshots: MissionSnapshot[]): CzmlPacket[] {
  if (snapshots.length === 0) return [];

  const czml: CzmlPacket[] = [];

  // CZML document header
  czml.push({
    id: 'document',
    name: 'Mission Replay',
    version: '1.0',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // Collect all unique entity IDs across all snapshots
  const entityTimelineMap = new Map<string, Array<{
    timestamp: number;
    entity: EntitySnapshot;
  }>>();

  for (const snap of snapshots) {
    for (const ent of snap.entities) {
      let timeline = entityTimelineMap.get(ent.id);
      if (!timeline) {
        timeline = [];
        entityTimelineMap.set(ent.id, timeline);
      }
      timeline.push({ timestamp: snap.timestamp, entity: ent });
    }
  }

  // Build a CZML packet for each unique entity
  for (const [entityId, timeline] of entityTimelineMap) {
    if (timeline.length === 0) continue;
    const first = timeline[0].entity;
    const color = getColor(first);

    const startTime = julianDateFromMs(timeline[0].timestamp);
    const endTime = julianDateFromMs(timeline[timeline.length - 1].timestamp);

    const packet: CzmlPacket = {
      id: entityId,
      name: first.name,
      availability: `${startTime}/${endTime}`,
      position: {
        cartographicDegrees: [0, 0, 0, 0], // will be overridden by epochs
      },
      point: {
        pixelSize: first.category === 'bft' ? 10 : 8,
        color: { rgba: color },
        outlineColor: { rgba: [255, 255, 255, 255] },
        outlineWidth: 2,
        heightReference: 'CLAMP_TO_GROUND',
      },
      label: {
        text: first.label || first.name,
        font: '9px monospace',
        fillColor: { rgba: color },
        outlineColor: { rgba: [0, 0, 0, 255] },
        outlineWidth: 2,
        style: 'FILL_AND_OUTLINE',
        pixelOffset: { cartesian2: [0, 14] },
        verticalOrigin: 'TOP',
        showBackground: true,
        backgroundColor: { rgba: [0, 0, 0, 128] },
      },
      properties: {
        category: first.category,
        affiliation: first.affiliation || 'unknown',
        severity: first.severity || 'none',
      },
    };

    // Convert timeline to CZML epoch-based position
    // CZML positions use ISO 8601 dates as epoch markers
    if (timeline.length === 1) {
      // Single position
      packet.position = {
        cartographicDegrees: [0, first.lon, first.lat, first.alt],
      };
    } else {
      // Multi-position with epoch interpolation
      // Use CZML "epoch" and "interpolationAlgorithm" for smooth playback
      const epochs: Array<{ date: string; position: number[] }> = [];
      for (const { timestamp, entity } of timeline) {
        epochs.push({
          date: julianDateFromMs(timestamp),
          position: [0, entity.lon, entity.lat, entity.alt],
        });
      }

      // Encode as epoch-based position (CZML supports this via a special format)
      // Each position in the array is preceded by its epoch date
      const positions: (string | number)[] = [];
      for (const ep of epochs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        positions.push(ep.date as any);
        positions.push(...ep.position);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (packet.position as any) = {
        epoch: epochs[0].date,
        interpolationAlgorithm: 'LAGRANGE',
        interpolationDegree: 2,
        // Use cartographicDegrees: [timeOffset, lon, lat, alt, ...]
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        cartographicDegrees: epochs.flatMap((ep, i) => [
          (new Date(ep.date).getTime() - new Date(epochs[0].date).getTime()) / 1000,
          ep.position[1],
          ep.position[2],
          ep.position[3],
        ]),
      };
    }

    czml.push(packet);
  }

  return czml;
}

/**
 * Convert snapshots to a simpler CZML using per-snapshot entity positions
 * with ISO 8601 availability intervals. This is more compatible with
 * basic CZML readers.
 */
export function snapshotsToSimpleCzml(snapshots: MissionSnapshot[]): CzmlPacket[] {
  if (snapshots.length === 0) return [];

  const czml: CzmlPacket[] = [];
  czml.push({
    id: 'document',
    name: 'Mission Replay',
    version: '1.0',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // Build per-entity time ranges
  const entityFirstSeen = new Map<string, number>();
  const entityLastSeen = new Map<string, number>();

  for (const snap of snapshots) {
    for (const ent of snap.entities) {
      if (!entityFirstSeen.has(ent.id)) entityFirstSeen.set(ent.id, snap.timestamp);
      entityLastSeen.set(ent.id, snap.timestamp);
    }
  }

  // For each entity, create a CZML packet with all positions over time
  for (const [entityId] of entityFirstSeen) {
    const positions: number[] = [];
    let firstEntity: EntitySnapshot | null = null;

    for (const snap of snapshots) {
      const ent = snap.entities.find(e => e.id === entityId);
      if (ent) {
        if (!firstEntity) firstEntity = ent;
        // time offset from first snapshot in seconds
        const tOffset = (snap.timestamp - snapshots[0].timestamp) / 1000;
        positions.push(tOffset, ent.lon, ent.lat, ent.alt);
      }
    }

    if (!firstEntity || positions.length < 4) continue;

    const color = getColor(firstEntity);
    const startTime = julianDateFromMs(snapshots[0].timestamp);
    const endTime = julianDateFromMs(snapshots[snapshots.length - 1].timestamp);

    const packet: CzmlPacket = {
      id: entityId,
      name: firstEntity.name,
      availability: `${startTime}/${endTime}`,
      position: {
        epoch: startTime,
        interpolationAlgorithm: 'LINEAR',
        interpolationDegree: 1,
        cartographicDegrees: positions,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      point: {
        pixelSize: firstEntity.category === 'bft' ? 10 : 8,
        color: { rgba: color },
        outlineColor: { rgba: [255, 255, 255, 255] },
        outlineWidth: 2,
        heightReference: 'CLAMP_TO_GROUND',
      },
      label: {
        text: firstEntity.label || firstEntity.name,
        font: '9px monospace',
        fillColor: { rgba: color },
        outlineColor: { rgba: [0, 0, 0, 255] },
        outlineWidth: 2,
        style: 'FILL_AND_OUTLINE',
        pixelOffset: { cartesian2: [0, 14] },
        verticalOrigin: 'TOP',
      },
      properties: {
        category: firstEntity.category,
        affiliation: firstEntity.affiliation || 'unknown',
      },
    };

    czml.push(packet);
  }

  return czml;
}

/** Download CZML as a file */
export function downloadCzml(snapshots: MissionSnapshot[], filename = 'mission-replay.czml'): void {
  const czml = snapshotsToSimpleCzml(snapshots);
  const blob = new Blob([JSON.stringify(czml, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
