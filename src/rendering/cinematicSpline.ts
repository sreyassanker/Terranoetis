import * as Cesium from 'cesium';

export interface TargetPoint {
  lat: number;
  lon: number;
  height: number;
  name?: string;
}

export interface Waypoint {
  lat: number;
  lon: number;
  height: number;
  heading: number;
  pitch: number;
  roll?: number;
  duration?: number; // Segment duration in seconds (optional)
  narration?: string; // Narration text for this keyframe
  targetLock?: TargetPoint; // Optional point-of-interest gaze tracking
}

export interface CameraPath {
  id?: string;
  name: string;
  description: string;
  category: string;
  duration: number;
  waypoints: Waypoint[];
  narration: string[];
  isCustom?: boolean;
  targetLock?: TargetPoint;
  sensorStyle?: 'normal' | 'flir' | 'nvg' | 'crt' | 'noir' | 'snow';
}

export interface EvaluatedCameraFrame {
  position: Cesium.Cartesian3;
  cartographic: Cesium.Cartographic;
  lat: number;
  lon: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
  segmentIndex: number;
  segmentProgress: number;
}

/**
 * Shortest-arc angular degree interpolation.
 * Avoids the 360-degree reverse spin bug when crossing 0/360 degrees.
 */
export function interpolateAngleDeg(a0: number, a1: number, t: number): number {
  let diff = (a1 - a0) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (a0 + diff * t + 360) % 360;
}

/**
 * Linear degree interpolation for pitch (clamped to safe visual ranges).
 */
export function interpolatePitchDeg(p0: number, p1: number, t: number): number {
  return p0 + (p1 - p0) * t;
}

/**
 * Standard cubic ease in/out.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Calculates exact heading and pitch from a camera Cartesian position to a target Cartesian position.
 * Uses local East-North-Up coordinate frame for instantaneous line-of-sight tracking.
 */
export function calculateHeadingPitchToTarget(
  camPos: Cesium.Cartesian3,
  targetPos: Cesium.Cartesian3,
): { heading: number; pitch: number } {
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(camPos);
  const invTransform = Cesium.Matrix4.inverseTransformation(transform, new Cesium.Matrix4());
  const localTarget = Cesium.Matrix4.multiplyByPoint(invTransform, targetPos, new Cesium.Cartesian3());

  // In East-North-Up frame at camPos: X = East, Y = North, Z = Up
  const east = localTarget.x;
  const north = localTarget.y;
  const up = localTarget.z;

  const horizontalDist = Math.sqrt(east * east + north * north);
  if (horizontalDist < 0.001) {
    return {
      heading: 0,
      pitch: up >= 0 ? 89.9 : -89.9,
    };
  }

  // Heading: angle clockwise from North (Y) toward East (X)
  let heading = (Math.atan2(east, north) * 180) / Math.PI;
  heading = (heading + 360) % 360;

  // Pitch: angle from horizontal plane
  const pitch = (Math.atan2(up, horizontalDist) * 180) / Math.PI;

  return {
    heading: Number(heading.toFixed(1)),
    pitch: Number(Math.max(-89.9, Math.min(89.9, pitch)).toFixed(1)),
  };
}

/**
 * Catmull-Rom 3D cubic spline evaluation between P1 and P2 with control points P0 and P3.
 */
export function catmullRomPoint(
  p0: Cesium.Cartesian3,
  p1: Cesium.Cartesian3,
  p2: Cesium.Cartesian3,
  p3: Cesium.Cartesian3,
  u: number,
): Cesium.Cartesian3 {
  const u2 = u * u;
  const u3 = u2 * u;

  const f0 = -0.5 * u3 + u2 - 0.5 * u;
  const f1 = 1.5 * u3 - 2.5 * u2 + 1.0;
  const f2 = -1.5 * u3 + 2.0 * u2 + 0.5 * u;
  const f3 = 0.5 * u3 - 0.5 * u2;

  return new Cesium.Cartesian3(
    p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3,
    p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3,
    p0.z * f0 + p1.z * f1 + p2.z * f2 + p3.z * f3,
  );
}

/**
 * Evaluates the full camera state at global normalized parameter t in [0, 1].
 * Uses Catmull-Rom spline through Cartesian space and shortest-arc angular slerp.
 */
export function evaluateSplinePath(
  waypoints: Waypoint[],
  t: number,
  minClearanceHeight = 50,
): EvaluatedCameraFrame {
  const n = waypoints.length;
  if (n === 0) {
    const dummy = Cesium.Cartesian3.fromDegrees(0, 0, 100000);
    return {
      position: dummy,
      cartographic: Cesium.Cartographic.fromCartesian(dummy),
      lat: 0,
      lon: 0,
      height: 100000,
      heading: 0,
      pitch: -45,
      roll: 0,
      segmentIndex: 0,
      segmentProgress: 0,
    };
  }

  if (n === 1) {
    const wp = waypoints[0];
    const pos = Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, Math.max(minClearanceHeight, wp.height));
    return {
      position: pos,
      cartographic: Cesium.Cartographic.fromCartesian(pos),
      lat: wp.lat,
      lon: wp.lon,
      height: wp.height,
      heading: wp.heading,
      pitch: wp.pitch,
      roll: wp.roll ?? 0,
      segmentIndex: 0,
      segmentProgress: 0,
    };
  }

  // Segment index and local progress u in [0, 1]
  const clampedT = Math.max(0, Math.min(1, t));
  const totalSegments = n - 1;
  const rawIdx = clampedT * totalSegments;
  const i1 = Math.min(Math.floor(rawIdx), totalSegments - 1);
  const i2 = i1 + 1;
  const uRaw = rawIdx - i1;
  const u = easeInOutCubic(uRaw);

  const i0 = Math.max(0, i1 - 1);
  const i3 = Math.min(n - 1, i2 + 1);

  const p0 = Cesium.Cartesian3.fromDegrees(waypoints[i0].lon, waypoints[i0].lat, waypoints[i0].height);
  const p1 = Cesium.Cartesian3.fromDegrees(waypoints[i1].lon, waypoints[i1].lat, waypoints[i1].height);
  const p2 = Cesium.Cartesian3.fromDegrees(waypoints[i2].lon, waypoints[i2].lat, waypoints[i2].height);
  const p3 = Cesium.Cartesian3.fromDegrees(waypoints[i3].lon, waypoints[i3].lat, waypoints[i3].height);

  const pos = catmullRomPoint(p0, p1, p2, p3, u);
  const carto = Cesium.Cartographic.fromCartesian(pos);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const height = Math.max(minClearanceHeight, carto.height);

  // Shortest-arc heading and pitch
  let heading = interpolateAngleDeg(waypoints[i1].heading, waypoints[i2].heading, u);
  let pitch = interpolatePitchDeg(waypoints[i1].pitch, waypoints[i2].pitch, u);

  // Dynamic point-of-interest target lock
  const activeLock = waypoints[i1].targetLock || waypoints[i2].targetLock;
  if (activeLock) {
    const targetCartesian = Cesium.Cartesian3.fromDegrees(activeLock.lon, activeLock.lat, activeLock.height);
    const lockedAngles = calculateHeadingPitchToTarget(pos, targetCartesian);
    heading = lockedAngles.heading;
    pitch = lockedAngles.pitch;
  }

  // Bank angle based on heading rate of change
  const headingDiff = ((waypoints[i2].heading - waypoints[i1].heading + 540) % 360) - 180;
  const naturalBank = -Math.max(-18, Math.min(18, headingDiff * 0.28 * (1 - Math.abs(2 * u - 1))));
  const baseRoll = (waypoints[i1].roll ?? 0) * (1 - u) + (waypoints[i2].roll ?? 0) * u;
  const roll = Number((baseRoll + naturalBank).toFixed(1));

  return {
    position: pos,
    cartographic: carto,
    lat,
    lon,
    height,
    heading,
    pitch,
    roll,
    segmentIndex: i1,
    segmentProgress: uRaw,
  };
}

/**
 * Formats seconds into MM:SS.s timecode.
 */
export function formatTimecode(seconds: number): string {
  const safeSec = Math.max(0, isNaN(seconds) ? 0 : seconds);
  const m = Math.floor(safeSec / 60);
  const s = Math.floor(safeSec % 60);
  const tenths = Math.floor((safeSec % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${tenths}`;
}

/**
 * Procedural Maneuver: 360° Hollywood Orbit.
 * Generates an 8-waypoint circular trajectory around a center target with inward targetLock and aerodynamic banking.
 */
export function generateOrbitPath(
  center: TargetPoint,
  radiusMeters = 3500,
  altitudeMeters = 1800,
  duration = 24,
): CameraPath {
  const points = 8;
  const waypoints: Waypoint[] = [];
  const narrations: string[] = [];

  for (let i = 0; i <= points; i++) {
    const angleRad = (i / points) * 2 * Math.PI;
    const latOffset = (radiusMeters / 111320) * Math.cos(angleRad);
    const lonOffset = (radiusMeters / (111320 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)))) * Math.sin(angleRad);

    const lat = Number((center.lat + latOffset).toFixed(4));
    const lon = Number((center.lon + lonOffset).toFixed(4));
    const height = Math.max(100, Math.round(center.height + altitudeMeters));

    const heading = Math.round(((Math.atan2(-lonOffset, -latOffset) * 180) / Math.PI + 360) % 360);
    const pitch = -22;

    const sectorName = i === 0 ? 'Initial Approach' : i === 2 ? 'East Quadrant' : i === 4 ? 'Southern Periphery' : i === 6 ? 'Western Ridge' : 'Orbit Closure';
    const narrationText = `360° orbital survey — ${sectorName}. Locked on ${center.name || 'target objective'} at ${Math.round(height).toLocaleString()}m altitude.`;

    waypoints.push({
      lat,
      lon,
      height,
      heading,
      pitch,
      roll: 10,
      targetLock: center,
      narration: narrationText,
    });
    narrations.push(narrationText);
  }

  return {
    id: `orbit_${Date.now()}`,
    name: `360° Orbit — ${center.name || 'Target Recon'}`,
    description: `Automated 360-degree circular orbit reconnaissance with coordinated banking and continuous target lock.`,
    category: 'custom',
    duration,
    waypoints,
    narration: narrations,
    isCustom: true,
    targetLock: center,
  };
}

/**
 * Procedural Maneuver: High-Altitude Recon Dive.
 * Supersonic entry from low orbit down to tactical ground clearance.
 */
export function generateReconDivePath(
  target: TargetPoint,
  duration = 26,
): CameraPath {
  const waypoints: Waypoint[] = [
    {
      lat: Number((target.lat - 0.5).toFixed(4)),
      lon: Number((target.lon - 0.3).toFixed(4)),
      height: 80000,
      heading: 35,
      pitch: -55,
      targetLock: target,
      narration: `Orbital ingress established at 80 kilometers. Commencing high-velocity dive toward ${target.name || 'target coordinates'}.`,
    },
    {
      lat: Number((target.lat - 0.25).toFixed(4)),
      lon: Number((target.lon - 0.15).toFixed(4)),
      height: 25000,
      heading: 35,
      pitch: -40,
      targetLock: target,
      narration: `Stratospheric transition layer. Sensor suite locked on target at 25,000 meters.`,
    },
    {
      lat: Number((target.lat - 0.1).toFixed(4)),
      lon: Number((target.lon - 0.05).toFixed(4)),
      height: 8000,
      heading: 32,
      pitch: -28,
      targetLock: target,
      narration: `Supersonic descent decelerating. Radar altimeter engaging at 8,000 meters altitude.`,
    },
    {
      lat: Number((target.lat - 0.02).toFixed(4)),
      lon: target.lon,
      height: 1800,
      heading: 30,
      pitch: -15,
      targetLock: target,
      narration: `Pull-up maneuver over objective. High-resolution multispectral scan in progress at 1,800m.`,
    },
    {
      lat: Number((target.lat + 0.1).toFixed(4)),
      lon: Number((target.lon + 0.05).toFixed(4)),
      height: 3500,
      heading: 25,
      pitch: -12,
      narration: `Egress corridor established. Climbing out past target perimeter with telemetry confirmed.`,
    },
  ];

  return {
    id: `dive_${Date.now()}`,
    name: `Recon Dive — ${target.name || 'Tactical Target'}`,
    description: `High-velocity stratospheric dive transitioning to a low-level target pass and tactical pull-up.`,
    category: 'custom',
    duration,
    waypoints,
    narration: waypoints.map(w => w.narration || ''),
    isCustom: true,
    targetLock: target,
  };
}

/**
 * Procedural Maneuver: Horizon Reveal (Crane Pull-Up).
 * Dramatic cinematic ascent revealing sweeping panoramic horizon.
 */
export function generateHorizonRevealPath(
  center: TargetPoint,
  duration = 20,
): CameraPath {
  const waypoints: Waypoint[] = [
    {
      lat: center.lat,
      lon: center.lon,
      height: Math.max(200, center.height + 600),
      heading: 0,
      pitch: -85,
      narration: `Vertical ground scan over ${center.name || 'nadir target'}. Preparing cinematic horizon reveal.`,
    },
    {
      lat: Number((center.lat + 0.015).toFixed(4)),
      lon: center.lon,
      height: Math.max(300, center.height + 1200),
      heading: 0,
      pitch: -55,
      narration: `Camera boom extending. Tilting forward to acquire terrain contours.`,
    },
    {
      lat: Number((center.lat + 0.04).toFixed(4)),
      lon: center.lon,
      height: Math.max(500, center.height + 2500),
      heading: 0,
      pitch: -25,
      narration: `Accelerating across the flight axis. Atmospheric horizon coming into view.`,
    },
    {
      lat: Number((center.lat + 0.08).toFixed(4)),
      lon: center.lon,
      height: Math.max(1000, center.height + 5000),
      heading: 0,
      pitch: -10,
      narration: `Full panoramic reveal established. Continental horizon illuminated at 5,000m altitude.`,
    },
  ];

  return {
    id: `reveal_${Date.now()}`,
    name: `Horizon Reveal — ${center.name || 'Scenic Vista'}`,
    description: `Cinematic vertical boom shot transitioning from a nadir ground view to a sweeping panoramic horizon reveal.`,
    category: 'custom',
    duration,
    waypoints,
    narration: waypoints.map(w => w.narration || ''),
    isCustom: true,
  };
}

/**
 * Procedural Maneuver: Corkscrew Spiral Climb.
 * Ascends in an expanding spiral staircase trajectory around target.
 */
export function generateSpiralClimbPath(
  target: TargetPoint,
  baseRadiusMeters = 2000,
  maxAltitudeMeters = 7000,
  duration = 28,
): CameraPath {
  const points = 7;
  const waypoints: Waypoint[] = [];
  const narrations: string[] = [];

  for (let i = 0; i < points; i++) {
    const fraction = i / (points - 1);
    const angleRad = fraction * (2.5 * Math.PI);
    const curRadius = baseRadiusMeters + fraction * 3500;
    const curAltitude = Math.round(target.height + 800 + fraction * (maxAltitudeMeters - 800));

    const latOffset = (curRadius / 111320) * Math.cos(angleRad);
    const lonOffset = (curRadius / (111320 * Math.max(0.01, Math.cos((target.lat * Math.PI) / 180)))) * Math.sin(angleRad);

    const lat = Number((target.lat + latOffset).toFixed(4));
    const lon = Number((target.lon + lonOffset).toFixed(4));

    const line = `Spiral ascent level #${i + 1} at ${curAltitude.toLocaleString()}m altitude. Corkscrewing around ${target.name || 'target axis'}.`;
    waypoints.push({
      lat,
      lon,
      height: curAltitude,
      heading: 0,
      pitch: -20,
      roll: 12,
      targetLock: target,
      narration: line,
    });
    narrations.push(line);
  }

  return {
    id: `spiral_${Date.now()}`,
    name: `Spiral Climb — ${target.name || 'Towering Target'}`,
    description: `Ascending corkscrew flight path spiraling upwards while maintaining continuous target lock.`,
    category: 'custom',
    duration,
    waypoints,
    narration: narrations,
    isCustom: true,
    targetLock: target,
  };
}

/**
 * Generates an intelligent, authentic military / documentary narration line
 * for a waypoint based on its altitude, position, and optional hazard context.
 */
export function generateContextualNarration(
  wp: Waypoint,
  idx: number,
  total: number,
  hazardContext?: string,
): string {
  const alt = Math.round(wp.height);
  const latStr = `${Math.abs(wp.lat).toFixed(1)}°${wp.lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(wp.lon).toFixed(1)}°${wp.lon >= 0 ? 'E' : 'W'}`;

  if (hazardContext) {
    return `${hazardContext} — Telemetry: ${alt.toLocaleString()}m altitude at ${latStr}, ${lonStr}. Optical sensors tracking anomaly.`;
  }

  if (idx === 0) {
    if (alt > 50000) {
      return `Orbital entry vector established over ${latStr}, ${lonStr}. Commencing global wide-spectrum scan from ${Math.round(alt / 1000)} kilometers altitude.`;
    }
    return `Flight approach corridor active at ${latStr}, ${lonStr}. Altimeter reading ${alt.toLocaleString()} meters, gyros calibrated.`;
  }

  if (idx === total - 1) {
    return `Mission waypoint sequence complete over ${latStr}, ${lonStr}. Leveling flight corridor at ${alt.toLocaleString()} meters; telemetry synchronized.`;
  }

  if (alt > 25000) {
    return `Stratospheric surveillance corridor at ${alt.toLocaleString()}m. Crosswinds nominal; multispectral sensors scanning surface contours.`;
  }
  if (alt > 6000) {
    return `Alpine reconnaissance flight at ${alt.toLocaleString()} meters. Banking along topographic ridgelines with terrain elevation confirmed.`;
  }
  if (alt > 1500) {
    return `Tactical low-altitude transit at ${alt.toLocaleString()}m. Forward-looking sensors locked on ground features; optical clarity optimal.`;
  }
  return `Close-range terrain contour sweep at ${alt.toLocaleString()} meters. Radar altimeter tracking ground profile; sector scan nominal.`;
}
