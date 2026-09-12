/**
 * Cockpit anchor geometry + deck projection (Pillar B, hybrid mode).
 *
 * Everything lives in the aircraft HPR local frame, in METRES:
 *   x = right of nose · y = nose-forward · z = up.
 *
 * Anchors are sampled from the authored Apache interior geometry
 * (see src/rendering/apacheModel.ts cockpitInterior(), authored axes
 * nose=X up=Y right=Z, scale APACHE_MODEL_SCALE=1.35):
 *
 *   rear-pilot eye   model(0.75+0.28, 0.40+0.62)      → 1.39 fwd, 1.38 up
 *   console bezels   model(1.51, 0.66, ±0.24)         → 2.04 fwd, 0.89 up, ±0.32
 *   amber DDU        model(1.50, 0.44, 0)             → 2.03 fwd, 0.59 up
 *   standby ADI      on the frame, forward-up         → 1.75 fwd, 1.70 up
 *
 * `projectDeck` turns anchors into screen-space rects for the DOM deck
 * overlay, giving true parallax: lean the head, the console slides under
 * the instruments because they are pinned to console GEOMETRY.
 */

import * as Cesium from 'cesium';

export interface DeckAnchor {
  /** local HPR-frame position [right, nose, up] in metres */
  p: [number, number, number];
  /** half-width / half-height of the bezel, in local right/up metres */
  hw: number;
  hh: number;
}

export const COCKPIT = {
  EYE: [0, 1.39, 1.30] as [number, number, number],
  GUNNER_EYE: [0, 2.92, 1.02] as [number, number, number],
  /** bezels (left DIU / right DIU / centre amber DDU / standby on frame) */
  ANCHORS: {
    diuLeft:  { p: [-0.32, 2.04, 0.95], hw: 0.155, hh: 0.17 },
    diuRight: { p: [ 0.32, 2.04, 0.95], hw: 0.155, hh: 0.17 },
    ddu:      { p: [ 0.00, 2.03, 0.63], hw: 0.17,  hh: 0.10 },
    stbyAdi:  { p: [ 0.00, 1.72, 1.22], hw: 0.055, hh: 0.055 },
  } satisfies Record<string, DeckAnchor>,
  /** look limits — the neck cone of a cockpit that has no sliding canopy rails */
  YAW_MAX: 0.70,        // ±40°
  PITCH_UP_MAX: 0.52,   // +30° nose-up
  PITCH_DOWN_MAX: 1.05, // −60°
} as const;

export interface DeckPanel {
  id: string;
  x: number; y: number;    // screen px of center
  w: number; h: number;    // screen px size
  skew: number;            // apparent roll of the bezel in screen space (rad)
  vis: boolean;            // in front of camera & on screen
  depth: number;           // metres from eye (for z-index + fog shading)
}

/**
 * Project all anchors against the current camera. `modelMatrix` is the
 * airframe HPR matrix; `eyeLocal` the head position in the same frame.
 */
export function projectDeck(
  scene: Cesium.Scene,
  modelMatrix: Cesium.Matrix4,
  eyeLocal: [number, number, number],
  anchors: Record<string, DeckAnchor> = COCKPIT.ANCHORS,
): Record<string, DeckPanel> {
  const out: Record<string, DeckPanel> = {};
  const canvas = scene.canvas;
  const eyeWorld = Cesium.Matrix4.multiplyByPoint(modelMatrix,
    new Cesium.Cartesian3(eyeLocal[0], eyeLocal[1], eyeLocal[2]), new Cesium.Cartesian3());
  for (const [id, a] of Object.entries(anchors)) {
    const world = Cesium.Matrix4.multiplyByPoint(modelMatrix,
      new Cesium.Cartesian3(a.p[0], a.p[1], a.p[2]), new Cesium.Cartesian3());
    const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, world);
    if (!win) {
      out[id] = { id, x: 0, y: 0, w: 0, h: 0, skew: 0, vis: false, depth: 999 };
      continue;
    }
    // scale: project the bezel's right/up half-extensions
    const pRight = Cesium.Matrix4.multiplyByPoint(modelMatrix,
      new Cesium.Cartesian3(a.p[0] + a.hw, a.p[1], a.p[2]), new Cesium.Cartesian3());
    const pUp = Cesium.Matrix4.multiplyByPoint(modelMatrix,
      new Cesium.Cartesian3(a.p[0], a.p[1], a.p[2] + a.hh), new Cesium.Cartesian3());
    const wR = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pRight);
    const wU = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pUp);
    const w = wR ? Math.hypot(wR.x - win.x, wR.y - win.y) * 2 : 60;
    const h = wU ? Math.hypot(wU.x - win.x, wU.y - win.y) * 2 : 60;
    const skew = wR && wU ? Math.atan2(wU.y - win.y, wU.x - win.x) + Math.PI / 2 : 0;
    const depth = Cesium.Cartesian3.distance(eyeWorld, world);
    const vis = w > 4 && w < canvas.width * 3 &&
      win.x > -canvas.width * 0.15 && win.y > -canvas.height * 0.15 &&
      win.x < canvas.width * 1.15 && win.y < canvas.height * 1.15;
    out[id] = { id, x: win.x, y: win.y, w: Math.max(24, Math.min(340, w)),
      h: Math.max(24, Math.min(340, h)), skew, vis: vis && depth < 500, depth };
  }
  return out;
}
