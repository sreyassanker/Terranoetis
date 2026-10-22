import * as Cesium from 'cesium';
import type {
  ArchaeologicalAnomaly,
  StudyAreaBoundingBox,
  ArchaeologyScanResult,
  SpatialGridPoint,
  CadastralHeritageSite,
} from '../../server/archaeology/types';
import { throttledRender } from '@/lib/throttledRender';
import { interpolateIDW, interpolateStructuredGrid, type InterpPoint } from './idwInterpolation';
import { showInterpSurface, clearInterpSurface, probeGridValue } from './surfaceRenderer';

export const ARCHAEOLOGY_ENTITY_PREFIX = 'arch_entity_';

/**
 * 4-Tier Defense / Intelligence Colormap for Archaeological Surface Interpolation.
 * 0.00: Undisturbed Natural Baseline (Deep Slate Blue, transparent/soft baseline tint)
 * 0.20: Natural Hydrological / Terrain variance (Teal / Cyan)
 * 0.45: Normal Vegetative variance (Emerald Green)
 * 0.65: Single-sensor divergence (Amber / Gold)
 * 0.82: Strong multi-modal consensus (Orange)
 * 1.00: Corroborated Archaeological Anomaly Hotspot (Electric Crimson, fully opaque)
 */
export const ARCHAEOLOGY_IDW_COLORMAP = [
  { stop: 0.0, r: 15, g: 23, b: 42, a: 30 },     // Deep Slate (0.00: Undisturbed Natural Baseline - subtle transparent tint)
  { stop: 0.20, r: 14, g: 116, b: 144, a: 110 }, // Cyan / Teal (0.20: Natural Hydrological / Terrain variance)
  { stop: 0.45, r: 34, g: 197, b: 94, a: 160 },  // Emerald (0.45: Normal Vegetative variance)
  { stop: 0.65, r: 245, g: 158, b: 11, a: 210 }, // Gold / Amber (0.65: Single-sensor divergence)
  { stop: 0.82, r: 249, g: 115, b: 22, a: 235 }, // Orange (0.82: Multi-Modal Consensus)
  { stop: 1.0, r: 239, g: 68, b: 68, a: 255 },   // Crimson Hotspot (1.00: Corroborated Archaeological Anomaly)
];

let activeProbeHandler: Cesium.ScreenSpaceEventHandler | null = null;

/**
 * High-contrast color mappings for archaeological prospection categories.
 * Tuned for maximum visibility over dark satellite and aerial imagery.
 */
export const ANOMALY_COLOR_MAP: Record<
  string,
  { stroke: string; fill: string; fillVibrant: string; pin: string; name: string }
> = {
  linear_foundation: {
    stroke: '#f59e0b', // Vibrant Gold / Amber
    fill: 'rgba(245, 158, 11, 0.28)',
    fillVibrant: 'rgba(245, 158, 11, 0.42)',
    pin: '#fbbf24',
    name: 'Linear Foundation',
  },
  enclosure_ditch: {
    stroke: '#06b6d4', // Bright Cyan
    fill: 'rgba(6, 182, 212, 0.28)',
    fillVibrant: 'rgba(6, 182, 212, 0.42)',
    pin: '#22d3ee',
    name: 'Enclosure Ditch',
  },
  paleochannel_segment: {
    stroke: '#38bdf8', // Electric Sky Blue
    fill: 'rgba(56, 189, 248, 0.32)',
    fillVibrant: 'rgba(56, 189, 248, 0.48)',
    pin: '#60a5fa',
    name: 'Paleochannel Segment',
  },
  settlement_mound: {
    stroke: '#f97316', // Bright Terracotta Orange
    fill: 'rgba(249, 115, 22, 0.30)',
    fillVibrant: 'rgba(249, 115, 22, 0.45)',
    pin: '#fb923c',
    name: 'Settlement Mound / Tell',
  },
  caravan_waypoint: {
    stroke: '#c084fc', // Vibrant Amethyst Purple
    fill: 'rgba(192, 132, 252, 0.30)',
    fillVibrant: 'rgba(192, 132, 252, 0.45)',
    pin: '#d8b4fe',
    name: 'Caravan Nexus / Oasis',
  },
};

/**
 * Creates an SVG pin image data URL for high-resolution globe billboard rendering.
 * Ground-anchored, compact, and optimized for 3D globe perspective.
 */
function createPinDataUrl(category: string, confidencePct: number): string {
  const colors = ANOMALY_COLOR_MAP[category] || ANOMALY_COLOR_MAP.linear_foundation;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
    <defs>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.75"/>
      </filter>
    </defs>
    <path d="M20 2C11.16 2 4 9.16 4 18c0 11.5 16 28 16 28s16-16.5 16-28c0-8.84-7.16-16-16-16z" fill="${colors.pin}" stroke="#ffffff" stroke-width="2" filter="url(#glow)"/>
    <circle cx="20" cy="18" r="10" fill="#0f172a"/>
    <text x="20" y="21.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="8.5" font-weight="900" fill="#ffffff" text-anchor="middle">${confidencePct}%</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Creates an architectural temple / monument pin SVG for verified standing historical heritage.
 */
function createHeritagePinDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="52" viewBox="0 0 44 52">
    <defs>
      <filter id="glow-gold" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.8"/>
        <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#f59e0b" flood-opacity="0.7"/>
      </filter>
    </defs>
    <path d="M22 2C12.06 2 4 10.06 4 20c0 13 18 30 18 30s18-17 18-30c0-9.94-8.06-20-18-20z" fill="#f59e0b" stroke="#ffffff" stroke-width="2" filter="url(#glow-gold)"/>
    <circle cx="22" cy="20" r="11" fill="#0f172a"/>
    <path d="M16 26h12v-1.5H16v1.5zm10.5-3V17h-2.2v6h-1.5V17h-1.6v6h-1.5V17h-2.2v6H16v1.5h12V23h-1.5zm-4.5-9.7l6.7 3.3V15H15.3v-1.4l6.7-3.3z" fill="#fde68a"/>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Removes all rendered archaeology entities, IDW surfaces, and screen handlers from the Cesium globe.
 * @param keepBoundaryBox If true, preserves any rendered study area boundary box entity.
 */
export function clearArchaeologyOverlays(viewer: Cesium.Viewer | null, keepBoundaryBox = false): void {
  if (!viewer || viewer.isDestroyed()) return;

  if (activeProbeHandler) {
    activeProbeHandler.destroy();
    activeProbeHandler = null;
  }
  clearInterpSurface(viewer);

  const entitiesToRemove: Cesium.Entity[] = [];
  viewer.entities.values.forEach(entity => {
    if (entity.id && entity.id.startsWith(ARCHAEOLOGY_ENTITY_PREFIX)) {
      if (
        keepBoundaryBox &&
        (entity.id.includes('study_area') || entity.id.includes('fly_scan_bbox'))
      ) {
        return;
      }
      entitiesToRemove.push(entity);
    }
  });

  entitiesToRemove.forEach(e => viewer.entities.remove(e));
  if (viewer.canvas) {
    viewer.canvas.style.cursor = 'default';
  }
  throttledRender(viewer);
}

/**
 * Removes archaeological study area boundary box entities only from the Cesium globe.
 */
export function clearArchaeologyBoundaryBox(viewer: Cesium.Viewer | null): void {
  if (!viewer || viewer.isDestroyed()) return;

  const ids = [
    `${ARCHAEOLOGY_ENTITY_PREFIX}fly_scan_bbox`,
    `${ARCHAEOLOGY_ENTITY_PREFIX}study_area_border`,
    `${ARCHAEOLOGY_ENTITY_PREFIX}study_area_fill`,
  ];
  ids.forEach(id => {
    const e = viewer.entities.getById(id);
    if (e) viewer.entities.remove(e);
  });
  throttledRender(viewer);
}

/**
 * Fast Jordan curve theorem ray-casting algorithm to test whether a geographic
 * coordinate (lat, lon) is contained within an anomaly polygon footprint.
 */
export function isPointInPolygon(lat: number, lon: number, polygon: Array<[number, number]>): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    // polygon coordinates are [lon, lat] pairs
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface ArchaeologyOverlayOptions {
  showIdwSurface?: boolean;
  surfaceOpacity?: number;
  showConfidenceFog?: boolean;
  showPins?: boolean;
  showInspector?: boolean;
  onProbe?: (probe: { lat: number; lon: number; value: number; confidencePct: number } | null) => void;
  onHoverAnomaly?: (
    anomaly: ArchaeologicalAnomaly | null,
    screenPosition?: { x: number; y: number }
  ) => void;
  onHoverHeritage?: (
    heritage: CadastralHeritageSite | null,
    screenPosition?: { x: number; y: number }
  ) => void;
}

/**
 * Renders the Continuous IDW Archaeological Classification Raster, Interactive HUD Reticle Probe,
 * and Discovered Output Vector Features on the 3D Cesium globe.
 */
export function renderArchaeologyAnomaliesOnGlobe(
  viewer: Cesium.Viewer | null,
  scanOrAnomalies: ArchaeologyScanResult | ArchaeologicalAnomaly[],
  studyAreaFallback?: StudyAreaBoundingBox,
  onSelectAnomaly?: (anomaly: ArchaeologicalAnomaly) => void,
  options?: ArchaeologyOverlayOptions,
): void {
  if (!viewer || viewer.isDestroyed()) return;

  // Clear previous overlay entities and surfaces
  clearArchaeologyOverlays(viewer);

  // Normalize inputs: either an ArchaeologyScanResult or an array of ArchaeologicalAnomaly
  const isScanResult = !Array.isArray(scanOrAnomalies) && 'studyArea' in scanOrAnomalies;
  const scanResult = isScanResult ? (scanOrAnomalies as ArchaeologyScanResult) : null;
  const anomalies: ArchaeologicalAnomaly[] = isScanResult
    ? scanResult!.anomalies
    : (scanOrAnomalies as ArchaeologicalAnomaly[]);
  const studyArea: StudyAreaBoundingBox = isScanResult
    ? scanResult!.studyArea
    : studyAreaFallback!;

  if (!studyArea) return;

  const { lonMin, latMin, lonMax, latMax } = studyArea;

  // =========================================================================
  // 1b. RENDER STUDY AREA BOUNDARY BOX (OUTLINE & RECTANGULAR FOOTPRINT)
  // =========================================================================
  const hasAppStudyArea = viewer.entities.values.some(
    e => e.id && typeof e.id === 'string' && (
      e.id.startsWith('study_area_') ||
      e.id.startsWith('arch_study_area_') ||
      e.id === 'study_area_rect' ||
      e.id === `${ARCHAEOLOGY_ENTITY_PREFIX}fly_scan_bbox`
    )
  );

  if (!hasAppStudyArea) {
    const borderPositions = [
      Cesium.Cartesian3.fromDegrees(lonMin, latMax, 0),
      Cesium.Cartesian3.fromDegrees(lonMax, latMax, 0),
      Cesium.Cartesian3.fromDegrees(lonMax, latMin, 0),
      Cesium.Cartesian3.fromDegrees(lonMin, latMin, 0),
      Cesium.Cartesian3.fromDegrees(lonMin, latMax, 0),
    ];

    viewer.entities.add({
      id: `${ARCHAEOLOGY_ENTITY_PREFIX}study_area_border`,
      name: 'Archaeological Study Area Boundary Box',
      polyline: {
        positions: borderPositions,
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.15,
          color: Cesium.Color.fromCssColorString('#f59e0b'),
        }),
        clampToGround: true,
      },
    });

    viewer.entities.add({
      id: `${ARCHAEOLOGY_ENTITY_PREFIX}study_area_fill`,
      name: 'Archaeological Study Area Footprint',
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(lonMin, latMin, lonMax, latMax),
        material: Cesium.Color.fromCssColorString('rgba(245, 158, 11, 0.04)'),
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
    });
  }

  // =========================================================================
  // 1. RENDER CONTINUOUS IDW CLASSIFICATION & CONFIDENCE RASTER ON 3D TERRAIN
  // =========================================================================
  if (options?.showIdwSurface !== false) {
    const rawPoints = scanResult?.spatialGrid?.points;
    const gridCols = scanResult?.spatialGrid?.gridWidth ?? 32;
    const gridRows = scanResult?.spatialGrid?.gridHeight ?? 32;

    try {
      let grid;
      if (rawPoints && rawPoints.length >= gridCols * gridRows) {
        // Continuous 2D Bilinear Matrix Resampling for structured archaeological evaluation grids.
        // Completely eliminates Inverse Distance Weighting (IDW) 1/d^2 distance singularities
        // and polka-dot / bull's-eye artifacts across the 3D globe.
        grid = interpolateStructuredGrid(rawPoints, studyArea, gridCols, gridRows, 128, 128);
      } else {
        // Fallback for sparse irregular point collections
        let interpPoints: InterpPoint[] = [];
        if (rawPoints && rawPoints.length > 0) {
          interpPoints = rawPoints.map(p => ({
            lat: p.lat,
            lon: p.lon,
            value: p.value,
          }));
        } else {
          const cols = 14;
          const rows = 14;
          const dLat = (latMax - latMin) / (rows - 1 || 1);
          const dLon = (lonMax - lonMin) / (cols - 1 || 1);
          for (let r = 0; r < rows; r++) {
            const pLat = latMin + r * dLat;
            for (let c = 0; c < cols; c++) {
              const pLon = lonMin + c * dLon;
              interpPoints.push({ lat: pLat, lon: pLon, value: 0.08 });
            }
          }
        }
        grid = interpolateIDW(interpPoints, studyArea, 128, 128, 2, 12);
      }

      // Force absolute 0.00 to 1.00 colormap calibration
      grid.valueMin = 0.0;
      grid.valueMax = 1.0;

      const opacity = options?.surfaceOpacity ?? 0.65;
      // Do not superimpose the inverted neighbor variance fog on archaeological grids (prevents shadow circles)
      const showConf = options?.showConfidenceFog ?? false;
      showInterpSurface(viewer, grid, ARCHAEOLOGY_IDW_COLORMAP, opacity, showConf);
    } catch (e) {
      console.warn('[Archaeology-Overlay] Surface generation failed:', e);
    }
  }

  // =========================================================================
  // 2. ATTACH INTERACTIVE SCREEN-SPACE MOUSE HOVER PROBE & SELECTION HANDLER
  // =========================================================================
  if (options?.onProbe || options?.onHoverAnomaly || options?.onHoverHeritage || onSelectAnomaly) {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((movement: { endPosition: Cesium.Cartesian2 }) => {
      // If live inspector HUD is not explicitly enabled (default is off), guarantee default cursor and suppress all hover callbacks
      if (options?.showInspector !== true) {
        if (viewer.canvas && viewer.canvas.style.cursor !== 'default') {
          viewer.canvas.style.cursor = 'default';
        }
        options?.onHoverAnomaly?.(null, undefined);
        options?.onHoverHeritage?.(null, undefined);
        options?.onProbe?.(null);
        return;
      }

      let matchedAnomaly: ArchaeologicalAnomaly | null = null;
      let matchedHeritage: CadastralHeritageSite | null = null;

      // 1. Direct Cesium Hardware Scene Pick (pins, polylines, 3D tiles)
      const picked = viewer.scene.pick(movement.endPosition);
      if (Cesium.defined(picked) && picked.id) {
        if ((picked.id as any).__archaeologyAnomaly) {
          matchedAnomaly = (picked.id as any).__archaeologyAnomaly;
        } else if ((picked.id as any).__archaeologyHeritage) {
          matchedHeritage = (picked.id as any).__archaeologyHeritage;
        }
      }

      // 2. 2D Screen-Space Proximity (instantly catches pins & centroids without raycast drops)
      if (!matchedAnomaly && !matchedHeritage) {
        let bestDist = 42; // 42px screen radius
        for (const anom of anomalies) {
          try {
            const cPos = Cesium.Cartesian3.fromDegrees(anom.centroid.lon, anom.centroid.lat, 0);
            const winPos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cPos);
            if (winPos) {
              const screenDist = Math.hypot(winPos.x - movement.endPosition.x, winPos.y - movement.endPosition.y);
              if (screenDist < bestDist) {
                bestDist = screenDist;
                matchedAnomaly = anom;
              }
            }
          } catch {
            // ignore projection quirks
          }
        }
      }

      // 3. Guaranteed Ellipsoid Intersection + Point-in-Polygon Fallback
      let probeCoord: { lat: number; lon: number } | null = null;
      let cartesian: Cesium.Cartesian3 | undefined = undefined;
      const ray = viewer.camera.getPickRay(movement.endPosition);
      if (ray) {
        cartesian = viewer.scene.globe.pick(ray, viewer.scene) || undefined;
      }
      if (!cartesian) {
        cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid) || undefined;
      }

      if (cartesian) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        probeCoord = { lat, lon };

        if (!matchedAnomaly && !matchedHeritage && lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) {
          // A. Inside polygon
          for (const anom of anomalies) {
            if (anom.polygonCoordinates && isPointInPolygon(lat, lon, anom.polygonCoordinates)) {
              matchedAnomaly = anom;
              break;
            }
          }

          // B. Centroid geographic proximity (within polygon radius + 40m)
          if (!matchedAnomaly) {
            for (const anom of anomalies) {
              const dLat = (anom.centroid.lat - lat) * 111320;
              const dLon = (anom.centroid.lon - lon) * (111320 * Math.cos(lat * Math.PI / 180));
              const distM = Math.hypot(dLat, dLon);
              const approxRadiusM = Math.sqrt((anom.areaM2 || 1000) / Math.PI);
              if (distM <= Math.max(45, approxRadiusM * 1.15)) {
                matchedAnomaly = anom;
                break;
              }
            }
          }

          // C. Heritage monuments
          if (!matchedAnomaly && scanResult?.cadastralHeritage) {
            for (const her of scanResult.cadastralHeritage) {
              if (her.polygonCoordinates && isPointInPolygon(lat, lon, her.polygonCoordinates)) {
                matchedHeritage = her;
                break;
              }
              const dLat = (her.coordinates.lat - lat) * 111320;
              const dLon = (her.coordinates.lon - lon) * (111320 * Math.cos(lat * Math.PI / 180));
              if (Math.hypot(dLat, dLon) <= 60) {
                matchedHeritage = her;
                break;
              }
            }
          }
        }
      }

      // 4. Screen coordinates for UI Tooltip positioning
      const canvasRect = viewer.scene.canvas.getBoundingClientRect();
      const screenPos = {
        x: canvasRect.left + movement.endPosition.x,
        y: canvasRect.top + movement.endPosition.y,
      };

      // 5. Update cursor styling
      if (viewer.canvas) {
        viewer.canvas.style.cursor = (matchedAnomaly || matchedHeritage) ? 'pointer' : 'default';
      }

      // 6. Fire hover callbacks
      options?.onHoverAnomaly?.(matchedAnomaly, matchedAnomaly ? screenPos : undefined);
      options?.onHoverHeritage?.(matchedHeritage, matchedHeritage ? screenPos : undefined);

      // 6. Fire raster probe callback if active
      if (options?.onProbe) {
        if (probeCoord && probeCoord.lat >= latMin && probeCoord.lat <= latMax && probeCoord.lon >= lonMin && probeCoord.lon <= lonMax) {
          const probe = probeGridValue(probeCoord.lat, probeCoord.lon);
          if (probe) {
            const cloudCover = scanResult?.liveSensors?.sentinel2?.cloudCoverPercent ?? 0;
            options.onProbe({
              lat: probe.lat,
              lon: probe.lon,
              value: probe.value,
              confidencePct: Math.round(Math.max(10, (1.0 - cloudCover / 100) * 100)),
            });
          } else {
            options.onProbe(null);
          }
        } else {
          options.onProbe(null);
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Left click selection handler
    if (onSelectAnomaly) {
      handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
        const picked = viewer.scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id && (picked.id as any).__archaeologyAnomaly) {
          onSelectAnomaly((picked.id as any).__archaeologyAnomaly);
          return;
        }

        const ray = viewer.camera.getPickRay(click.position);
        if (ray) {
          const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
          if (cartesian) {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            const cLat = Cesium.Math.toDegrees(cartographic.latitude);
            const cLon = Cesium.Math.toDegrees(cartographic.longitude);

            for (const anom of anomalies) {
              if (anom.polygonCoordinates && isPointInPolygon(cLat, cLon, anom.polygonCoordinates)) {
                onSelectAnomaly(anom);
                return;
              }
              const dLat = (anom.centroid.lat - cLat) * 111320;
              const dLon = (anom.centroid.lon - cLon) * (111320 * Math.cos(cLat * Math.PI / 180));
              const approxRadiusM = Math.sqrt((anom.areaM2 || 1000) / Math.PI);
              if (Math.hypot(dLat, dLon) <= Math.max(30, approxRadiusM)) {
                onSelectAnomaly(anom);
                return;
              }
            }
          }
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    activeProbeHandler = handler;
  }

  // =========================================================================
  // 3. RENDER DISCOVERED OUTPUT FEATURES (ANOMALIES) INSIDE THE USER'S STUDY AREA
  // =========================================================================
  anomalies.forEach((anomaly, index) => {
    const categoryColors = ANOMALY_COLOR_MAP[anomaly.category] || ANOMALY_COLOR_MAP.linear_foundation;
    const confidencePct = Math.round(anomaly.confidenceScore * 100);

    // 2a. Anomaly Semi-Transparent Vibrant Fill
    if (anomaly.polygonCoordinates && anomaly.polygonCoordinates.length >= 3) {
      const degreesArray: number[] = [];
      anomaly.polygonCoordinates.forEach(([pLon, pLat]) => {
        const clampedLat = Math.max(latMin, Math.min(latMax, pLat));
        const clampedLon = Math.max(lonMin, Math.min(lonMax, pLon));
        degreesArray.push(clampedLon, clampedLat);
      });

      const polygonEntity = viewer.entities.add({
        id: `${ARCHAEOLOGY_ENTITY_PREFIX}anomaly_fill_${anomaly.id}_${index}`,
        name: anomaly.name,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(degreesArray),
          material: Cesium.Color.fromCssColorString(categoryColors.fillVibrant),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      });
      (polygonEntity as any).__archaeologyAnomaly = anomaly;

      // 2b. Anomaly Glowing Perimeter Polyline (Ground-clamped for crisp visibility)
      const closedDegreesArray = [...degreesArray];
      if (
        closedDegreesArray[0] !== closedDegreesArray[closedDegreesArray.length - 2] ||
        closedDegreesArray[1] !== closedDegreesArray[closedDegreesArray.length - 1]
      ) {
        closedDegreesArray.push(closedDegreesArray[0], closedDegreesArray[1]);
      }

      const glowEntity = viewer.entities.add({
        id: `${ARCHAEOLOGY_ENTITY_PREFIX}anomaly_glow_${anomaly.id}_${index}`,
        name: `${anomaly.name} Glowing Boundary`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(closedDegreesArray),
          width: 5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            taperPower: 1.0,
            color: Cesium.Color.fromCssColorString(categoryColors.stroke),
          }),
          clampToGround: true,
        },
      });
      (glowEntity as any).__archaeologyAnomaly = anomaly;

      // 2c. Internal Archaeological Structural Vectors (Street Grids, Canals, Causeways)
      renderInternalStructuralVectors(viewer, anomaly, categoryColors.stroke, index);
    }

    // 2d. Discovery Pin Billboard & Informative Label
    if (options?.showPins !== false) {
      const clampedCentroidLat = Math.max(latMin, Math.min(latMax, anomaly.centroid.lat));
      const clampedCentroidLon = Math.max(lonMin, Math.min(lonMax, anomaly.centroid.lon));

      const pinEntity = viewer.entities.add({
        id: `${ARCHAEOLOGY_ENTITY_PREFIX}pin_${anomaly.id}_${index}`,
        name: `${anomaly.name} (${confidencePct}% Confidence)`,
        position: Cesium.Cartesian3.fromDegrees(
          clampedCentroidLon,
          clampedCentroidLat,
          0,
        ),
        billboard: {
          image: createPinDataUrl(anomaly.category, confidencePct),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scale: 0.55,
          scaleByDistance: new Cesium.NearFarScalar(600, 0.70, 35000, 0.38),
          disableDepthTestDistance: 250,
        },
        label: {
          text: anomaly.name.replace(/^Autonomous Discovery:\s*/i, ''),
          font: 'bold 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#fde68a'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('rgba(11, 17, 32, 0.90)'),
          backgroundPadding: new Cesium.Cartesian2(7, 4),
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 6),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1200),
          disableDepthTestDistance: 250,
        },
      });

      (pinEntity as any).__archaeologyAnomaly = anomaly;
    }
  });

  // =========================================================================
  // 4. RENDER VERIFIED STANDING HERITAGE MONUMENTS (TIER 1 CADASTRAL BASELINE)
  // =========================================================================
  if (scanResult?.cadastralHeritage && scanResult.cadastralHeritage.length > 0) {
    scanResult.cadastralHeritage.forEach((heritage, hIdx) => {
      const lat = heritage.coordinates.lat;
      const lon = heritage.coordinates.lon;
      if (lat < latMin || lat > latMax || lon < lonMin || lon > lonMax) return;

      // Golden boundary polygon
      if (heritage.polygonCoordinates && heritage.polygonCoordinates.length >= 3) {
        const degreesArray: number[] = [];
        heritage.polygonCoordinates.forEach(([pLon, pLat]) => {
          degreesArray.push(pLon, pLat);
        });

        const fillEntity = viewer.entities.add({
          id: `${ARCHAEOLOGY_ENTITY_PREFIX}heritage_fill_${heritage.id}_${hIdx}`,
          name: `🏛️ ${heritage.name}`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(degreesArray),
            material: Cesium.Color.fromCssColorString('rgba(245, 158, 11, 0.25)'),
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        });
        (fillEntity as any).__archaeologyHeritage = heritage;

        const closed = [...degreesArray];
        if (closed[0] !== closed[closed.length - 2] || closed[1] !== closed[closed.length - 1]) {
          closed.push(closed[0], closed[1]);
        }
        const glowEntity = viewer.entities.add({
          id: `${ARCHAEOLOGY_ENTITY_PREFIX}heritage_glow_${heritage.id}_${hIdx}`,
          name: `${heritage.name} Perimeter Boundary`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(closed),
            width: 4,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.4,
              taperPower: 1.0,
              color: Cesium.Color.fromCssColorString('#fbbf24'),
            }),
            clampToGround: true,
          },
        });
        (glowEntity as any).__archaeologyHeritage = heritage;
      }

      // Heritage Billboard Pin & Golden Badge
      const pinEntity = viewer.entities.add({
        id: `${ARCHAEOLOGY_ENTITY_PREFIX}heritage_pin_${heritage.id}_${hIdx}`,
        name: `🏛️ ${heritage.name} (${heritage.periodOrEpoch || 'Standing Heritage'})`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        billboard: {
          image: createHeritagePinDataUrl(),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scale: 0.62,
          scaleByDistance: new Cesium.NearFarScalar(600, 0.75, 40000, 0.40),
          disableDepthTestDistance: 250,
        },
        label: {
          text: `🏛️ ${heritage.name}`,
          font: 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#fde68a'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('rgba(20, 16, 10, 0.92)'),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 6),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2000),
          disableDepthTestDistance: 250,
        },
      });
      (pinEntity as any).__archaeologyHeritage = heritage;
    });
  }

  throttledRender(viewer);
}

/**
 * Computes 2D Principal Component Analysis (PCA) metric axes from the physical
 * anomaly footprint polygon coordinates. No hardcoded or fabricated offsets.
 */
function computePolygonPcaAxes(polygon: Array<[number, number]>): {
  majorAxis: [number, number, number, number] | null;
  minorAxis: [number, number, number, number] | null;
  eccentricity: number;
} {
  if (!polygon || polygon.length < 3) {
    return { majorAxis: null, minorAxis: null, eccentricity: 1.0 };
  }

  // 1. Centroid of the polygon vertices
  let sumLon = 0;
  let sumLat = 0;
  const n = polygon.length;
  for (const [pLon, pLat] of polygon) {
    sumLon += pLon;
    sumLat += pLat;
  }
  const cLon = sumLon / n;
  const cLat = sumLat / n;

  // 2. Covariance tensor in metric space (accounting for latitude scaling)
  const latMeters = 111320;
  const lonMeters = 111320 * Math.cos((cLat * Math.PI) / 180);

  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const [pLon, pLat] of polygon) {
    const dx = (pLon - cLon) * lonMeters;
    const dy = (pLat - cLat) * latMeters;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= n;
  cyy /= n;
  cxy /= n;

  // 3. Eigenvalues of 2x2 covariance matrix
  const diff = cxx - cyy;
  const disc = Math.sqrt(diff * diff + 4 * cxy * cxy);
  const lambda1 = (cxx + cyy + disc) / 2; // Major variance
  const lambda2 = Math.max(1, (cxx + cyy - disc) / 2); // Minor variance

  const eccentricity = Math.sqrt(lambda1 / lambda2);

  // If feature is nearly circular / isotropic (mound or oasis pool, eccentricity < 1.15),
  // do not draw arbitrary linear axes
  if (eccentricity < 1.15 || lambda1 < 25) {
    return { majorAxis: null, minorAxis: null, eccentricity };
  }

  // 4. Principal eigenvector orientation angle (radians)
  const theta = 0.5 * Math.atan2(2 * cxy, diff);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Half-lengths scaled to 1.3 standard deviations
  const majorLenM = Math.sqrt(lambda1) * 1.3;
  const minorLenM = Math.sqrt(lambda2) * 1.0;

  // Convert back to geographic coordinates
  const majorDx = (majorLenM * cosT) / lonMeters;
  const majorDy = (majorLenM * sinT) / latMeters;
  const majorAxis: [number, number, number, number] = [
    cLon - majorDx,
    cLat - majorDy,
    cLon + majorDx,
    cLat + majorDy,
  ];

  // Minor eigenvector is orthogonal (-sinT, cosT)
  const minorDx = (-minorLenM * sinT) / lonMeters;
  const minorDy = (minorLenM * cosT) / latMeters;
  const minorAxis: [number, number, number, number] = [
    cLon - minorDx,
    cLat - minorDy,
    cLon + minorDx,
    cLat + minorDy,
  ];

  return { majorAxis, minorAxis, eccentricity };
}

/**
 * Truly derives internal archaeological linear axes from the detected polygon geometry
 * using 2D Principal Component Analysis (PCA). No hardcoded offsets or artificial templates.
 */
function renderInternalStructuralVectors(
  viewer: Cesium.Viewer,
  anomaly: ArchaeologicalAnomaly,
  strokeColor: string,
  index: number,
): void {
  if (!anomaly.polygonCoordinates || anomaly.polygonCoordinates.length < 3) return;

  // Truly derive the principal morphological flow/elongation axes via 2D PCA from the anomaly polygon
  const { majorAxis, minorAxis, eccentricity } = computePolygonPcaAxes(anomaly.polygonCoordinates);

  if (!majorAxis) return; // If isotropic (mound or circular depression), do not render artificial lines

  // 1. Primary Elongation Axis (Blue/Cyan Dashed Polyline - PCA 1st Eigenvector)
  viewer.entities.add({
    id: `${ARCHAEOLOGY_ENTITY_PREFIX}pca_major_axis_${anomaly.id}_${index}`,
    name: `${anomaly.name} Morphological Flow Axis (PCA 1st Eigenvector, Eccentricity: ${eccentricity.toFixed(2)})`,
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(majorAxis),
      width: 3.5,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString(strokeColor),
        dashLength: 12.0,
      }),
      clampToGround: true,
    },
  });

  // 2. Orthogonal Transverse Axis (Amber Polyline - PCA 2nd Eigenvector, if orthogonality evidence >= 0.70)
  if (minorAxis && (anomaly.evidence?.orthogonalityScore ?? 0) >= 0.70) {
    viewer.entities.add({
      id: `${ARCHAEOLOGY_ENTITY_PREFIX}pca_minor_axis_${anomaly.id}_${index}`,
      name: `${anomaly.name} Orthogonal Transverse Axis (PCA 2nd Eigenvector)`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(minorAxis),
        width: 3.5,
        material: Cesium.Color.fromCssColorString('#f59e0b'),
        clampToGround: true,
      },
    });
  }
}

/**
 * Smoothly flies the 3D globe camera to inspect an archaeological anomaly,
 * keeping both the study area and discovery feature perfectly centered.
 */
export function flyToAnomaly(
  viewer: Cesium.Viewer | null,
  anomaly: ArchaeologicalAnomaly,
  pitchDegrees = -45,
): void {
  if (!viewer || viewer.isDestroyed()) return;

  const lat = anomaly.centroid.lat;
  const lon = anomaly.centroid.lon;
  const radiusMeters = Math.max(400, Math.sqrt(anomaly.areaM2 || 10000) * 1.5);
  // Cap range between 800m and 2400m for an immediate close-up 3D inspection view
  const targetRange = Math.min(2400, Math.max(800, radiusMeters * 1.5));

  const sphere = new Cesium.BoundingSphere(
    Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    radiusMeters,
  );

  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(0),
      Cesium.Math.toRadians(pitchDegrees),
      targetRange,
    ),
    duration: 1.5,
  });
}
