/**
 * Street View Pegman & 3D Ground Orientation Marker for Cesium.
 *
 * Implements the iconic Google Maps yellow Pegman avatar on the 3D globe with
 * an active directional field-of-view (FOV) radar cone that reflects the
 * viewer's current heading and ground perspective.
 */

import * as Cesium from 'cesium';

const PEGMAN_ENTITY_ID = 'terranoetis_streetview_pegman';
const PEGMAN_CONE_ID = 'terranoetis_streetview_cone';

/**
 * High-resolution SVG data URI for Google Maps iconic yellow Pegman.
 */
export function getPegmanSvgUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.6"/>
    </filter>
    <g filter="url(#shadow)">
      <!-- Ground shadow -->
      <ellipse cx="24" cy="44" rx="10" ry="3.5" fill="rgba(0,0,0,0.4)"/>
      <!-- Pegman Body (Google Yellow) -->
      <!-- Head -->
      <circle cx="24" cy="9" r="6" fill="#FBBC04" stroke="#D97706" stroke-width="1.5"/>
      <!-- Torso -->
      <path d="M19 16 C19 14.5, 29 14.5, 29 16 L31 29 C31 30.5, 30 31, 28 31 L20 31 C18 31, 17 30.5, 17 29 Z" fill="#FBBC04" stroke="#D97706" stroke-width="1.5"/>
      <!-- Left arm -->
      <path d="M17 17 L12 25 C11 26.5, 12.5 28, 14 27 L18 21" fill="#F59E0B" stroke="#D97706" stroke-width="1.2" stroke-linecap="round"/>
      <!-- Right arm -->
      <path d="M31 17 L36 25 C37 26.5, 35.5 28, 34 27 L30 21" fill="#F59E0B" stroke="#D97706" stroke-width="1.2" stroke-linecap="round"/>
      <!-- Legs -->
      <path d="M20 31 L18 42 C17.8 43, 19.5 43.5, 21 43.2 L22.5 31" fill="#D97706" stroke="#B45309" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M28 31 L30 42 C30.2 43, 28.5 43.5, 27 43.2 L25.5 31" fill="#D97706" stroke="#B45309" stroke-width="1.2" stroke-linejoin="round"/>
      <!-- White tie / highlight accent -->
      <polygon points="24,17 25.5,21 24,25 22.5,21" fill="#FFFFFF" opacity="0.85"/>
    </g>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Calculates a field-of-view wedge polygon around (lat, lon) in direction of heading.
 */
function computeFovWedge(
  lat: number,
  lon: number,
  headingDeg: number,
  radiusMeters = 180,
  fovDeg = 80,
  steps = 16,
): Cesium.Cartesian3[] {
  const points: Cesium.Cartesian3[] = [];
  // Center point
  points.push(Cesium.Cartesian3.fromDegrees(lon, lat));

  const startAngle = headingDeg - fovDeg / 2;
  const radLat = Cesium.Math.toRadians(lat);
  const mPerDegLat = 111132.954;
  const mPerDegLon = 111132.954 * Math.cos(radLat);

  for (let i = 0; i <= steps; i++) {
    const angle = Cesium.Math.toRadians(startAngle + (fovDeg * i) / steps);
    // Heading 0 is North, 90 is East
    const dNorth = Math.cos(angle) * radiusMeters;
    const dEast = Math.sin(angle) * radiusMeters;

    const pLat = lat + dNorth / mPerDegLat;
    const pLon = lon + dEast / mPerDegLon;
    points.push(Cesium.Cartesian3.fromDegrees(pLon, pLat));
  }

  return points;
}

/**
 * Add or update Pegman on the Cesium viewer.
 */
export function updatePegman(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  headingDeg: number,
): void {
  if (viewer.isDestroyed()) return;

  const position = Cesium.Cartesian3.fromDegrees(lon, lat);
  const wedgePositions = computeFovWedge(lat, lon, headingDeg, 160, 75, 12);

  // 1. Pegman Avatar Billboard
  let pegmanEntity = viewer.entities.getById(PEGMAN_ENTITY_ID);
  if (!pegmanEntity) {
    pegmanEntity = viewer.entities.add({
      id: PEGMAN_ENTITY_ID,
      position,
      billboard: {
        image: getPegmanSvgUri(),
        width: 44,
        height: 44,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // always visible above terrain
      },
    });
  } else {
    pegmanEntity.position = new Cesium.ConstantPositionProperty(position);
  }

  // 2. Field-of-View Radar Wedge
  let coneEntity = viewer.entities.getById(PEGMAN_CONE_ID);
  if (!coneEntity) {
    coneEntity = viewer.entities.add({
      id: PEGMAN_CONE_ID,
      polygon: {
        hierarchy: new Cesium.ConstantProperty(new Cesium.PolygonHierarchy(wedgePositions)),
        material: Cesium.Color.fromCssColorString('rgba(251, 188, 4, 0.28)'),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('rgba(251, 188, 4, 0.85)'),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  } else if (coneEntity.polygon) {
    coneEntity.polygon.hierarchy = new Cesium.ConstantProperty(new Cesium.PolygonHierarchy(wedgePositions));
  }

  viewer.scene.requestRender();
}

/**
 * Remove Pegman entities from the viewer.
 */
export function removePegman(viewer: Cesium.Viewer): void {
  if (viewer.isDestroyed()) return;
  const p = viewer.entities.getById(PEGMAN_ENTITY_ID);
  if (p) viewer.entities.remove(p);
  const c = viewer.entities.getById(PEGMAN_CONE_ID);
  if (c) viewer.entities.remove(c);
  viewer.scene.requestRender();
}

/**
 * Google Earth / Google Maps style cinematic swoop down to street level.
 */
export function flyToStreetLevel(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  headingDeg = 0,
  duration = 1.8,
): Promise<void> {
  return new Promise((resolve) => {
    if (viewer.isDestroyed()) {
      resolve();
      return;
    }

    const destination = Cesium.Cartesian3.fromDegrees(lon, lat, 280);
    viewer.camera.flyTo({
      destination,
      orientation: {
        heading: Cesium.Math.toRadians(headingDeg),
        pitch: Cesium.Math.toRadians(-25),
        roll: 0,
      },
      duration,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
      complete: () => {
        resolve();
      },
      cancel: () => {
        resolve();
      },
    });
  });
}
