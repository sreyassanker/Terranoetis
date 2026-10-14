import * as Cesium from 'cesium';

export interface Waypoint {
  lat: number;
  lon: number;
  height: number;
  heading: number;
  pitch: number;
  roll?: number;
  duration?: number; // Segment duration in seconds (optional)
  narration?: string; // Narration text for this keyframe
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
  const heading = interpolateAngleDeg(waypoints[i1].heading, waypoints[i2].heading, u);
  const pitch = interpolatePitchDeg(waypoints[i1].pitch, waypoints[i2].pitch, u);

  // Bank angle based on heading rate of change
  const headingDiff = ((waypoints[i2].heading - waypoints[i1].heading + 540) % 360) - 180;
  const naturalBank = -Math.max(-15, Math.min(15, headingDiff * 0.25 * (1 - Math.abs(2 * u - 1))));
  const baseRoll = (waypoints[i1].roll ?? 0) * (1 - u) + (waypoints[i2].roll ?? 0) * u;
  const roll = baseRoll + naturalBank;

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
