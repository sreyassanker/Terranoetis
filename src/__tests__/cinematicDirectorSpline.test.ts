import { describe, it, expect } from 'vitest';
import * as Cesium from 'cesium';
import {
  interpolateAngleDeg,
  interpolatePitchDeg,
  catmullRomPoint,
  evaluateSplinePath,
  formatTimecode,
  calculateHeadingPitchToTarget,
  generateOrbitPath,
  generateContextualNarration,
  type Waypoint,
} from '@/rendering/cinematicSpline';

describe('Cinematic Spline & Angular Interpolation', () => {
  it('interpolates heading via the shortest arc without 360-degree flip', () => {
    // 350 to 10 should go through 0/360 (+20 deg total arc)
    const mid = interpolateAngleDeg(350, 10, 0.5);
    expect(mid).toBeCloseTo(0, 1);

    // 10 to 350 should go in reverse through 0/360 (-20 deg total arc)
    const midRev = interpolateAngleDeg(10, 350, 0.5);
    expect(midRev).toBeCloseTo(0, 1);

    // Regular angular step 90 to 180 should be 135
    expect(interpolateAngleDeg(90, 180, 0.5)).toBeCloseTo(135, 1);
  });

  it('interpolates pitch linearly', () => {
    expect(interpolatePitchDeg(-30, -60, 0.5)).toBeCloseTo(-45, 1);
    expect(interpolatePitchDeg(-10, -90, 0)).toBeCloseTo(-10, 1);
    expect(interpolatePitchDeg(-10, -90, 1)).toBeCloseTo(-90, 1);
  });

  it('passes through control points P1 at u=0 and P2 at u=1 in Catmull-Rom spline', () => {
    const p0 = new Cesium.Cartesian3(0, 0, 0);
    const p1 = new Cesium.Cartesian3(10, 20, 30);
    const p2 = new Cesium.Cartesian3(40, 50, 60);
    const p3 = new Cesium.Cartesian3(70, 80, 90);

    const start = catmullRomPoint(p0, p1, p2, p3, 0);
    expect(start.x).toBeCloseTo(p1.x, 2);
    expect(start.y).toBeCloseTo(p1.y, 2);
    expect(start.z).toBeCloseTo(p1.z, 2);

    const end = catmullRomPoint(p0, p1, p2, p3, 1);
    expect(end.x).toBeCloseTo(p2.x, 2);
    expect(end.y).toBeCloseTo(p2.y, 2);
    expect(end.z).toBeCloseTo(p2.z, 2);
  });

  it('evaluates spline path accurately across waypoints', () => {
    const waypoints: Waypoint[] = [
      { lat: 35.0, lon: 139.0, height: 1000, heading: 0, pitch: -30 },
      { lat: 35.5, lon: 139.5, height: 2000, heading: 45, pitch: -40 },
      { lat: 36.0, lon: 140.0, height: 3000, heading: 90, pitch: -50 },
    ];

    // At t=0, camera matches first waypoint
    const f0 = evaluateSplinePath(waypoints, 0);
    expect(f0.lat).toBeCloseTo(35.0, 1);
    expect(f0.lon).toBeCloseTo(139.0, 1);
    expect(f0.height).toBeCloseTo(1000, 1);
    expect(f0.heading).toBeCloseTo(0, 1);

    // At t=1, camera matches last waypoint
    const f1 = evaluateSplinePath(waypoints, 1);
    expect(f1.lat).toBeCloseTo(36.0, 1);
    expect(f1.lon).toBeCloseTo(140.0, 1);
    expect(f1.height).toBeCloseTo(3000, 1);
    expect(f1.heading).toBeCloseTo(90, 1);

    // At t=0.5, camera should be near waypoint 1
    const fMid = evaluateSplinePath(waypoints, 0.5);
    expect(fMid.lat).toBeCloseTo(35.5, 0.5);
    expect(fMid.lon).toBeCloseTo(139.5, 0.5);
    expect(fMid.heading).toBeCloseTo(45, 1);
  });

  it('formats timecodes cleanly', () => {
    expect(formatTimecode(0)).toBe('00:00.0');
    expect(formatTimecode(65.4)).toBe('01:05.4');
    expect(formatTimecode(125.99)).toBe('02:05.9');
  });

  it('calculates exact heading and pitch to target from camera', () => {
    // Camera directly south of target at equator
    const camPos = Cesium.Cartesian3.fromDegrees(0, 0, 1000);
    // Target is directly north at lat 1.0 deg
    const targetPos = Cesium.Cartesian3.fromDegrees(0, 1.0, 0);

    const { heading, pitch } = calculateHeadingPitchToTarget(camPos, targetPos);
    // Heading should point directly North (~0 or 360)
    expect(Math.min(heading, Math.abs(360 - heading))).toBeLessThan(1.0);
    // Pitch should be slightly negative (looking down toward earth surface)
    expect(pitch).toBeLessThan(0);
  });

  it('generates a 360-degree orbit path with targetLock and smooth banking', () => {
    const orbit = generateOrbitPath({ lat: 27.988, lon: 86.925, height: 8848, name: 'Mt. Everest' }, 5000, 2000, 30);
    expect(orbit.waypoints.length).toBe(9); // 8 segments + closure
    expect(orbit.targetLock).toBeDefined();
    expect(orbit.targetLock?.name).toBe('Mt. Everest');
    expect(orbit.waypoints[0].roll).toBe(10);
    expect(orbit.duration).toBe(30);
  });

  it('generates an intelligent contextual military/documentary narration line', () => {
    const lineHigh = generateContextualNarration({ lat: 35.6, lon: 139.7, height: 75000, heading: 0, pitch: -45 }, 0, 5);
    expect(lineHigh).toContain('Orbital');

    const lineAlpine = generateContextualNarration({ lat: 28.0, lon: 86.9, height: 9000, heading: 45, pitch: -20 }, 2, 5);
    expect(lineAlpine).toContain('Alpine');
    expect(lineAlpine).toContain('meters');

    const lineHazard = generateContextualNarration({ lat: -33.8, lon: 151.2, height: 1200, heading: 90, pitch: -15 }, 1, 5, 'Wildfire Sector 4');
    expect(lineHazard).toContain('Wildfire Sector 4');
  });
});
