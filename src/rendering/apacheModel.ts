/**
 * AH-64E Apache — runtime glTF reconstruction, faithfully ported from
 * src/gaming mode/helicopter.html (Three.js) into a single self-contained
 * binary glTF Cesium model.
 *
 * - Axis convention: nose +X, up +Y, right +Z (Cesium default forward=+X,
 *   up=+Y — no axis swap needed; heading quaternion aligns nose to heading).
 * - Named nodes `mainRotor` and `tailRotor` expose local transforms so the
 *   App's per-frame animation can spin them via model.getNode(name).matrix.
 * - All geometry is built at runtime (no assets), cached after first build.
 */

import {
  GltfBuilder,
  buildBoxMesh,
  buildCylinderMesh,
  buildSphereMesh,
  buildHemisphereCapMesh,
  buildConeMesh,
  buildTorusMesh,
  buildContinuousTubeMesh,
  type GltfMaterialSpec,
  type GltfNodeSpec,
} from './gltfBuilder';
import {
  mtxTR, mtxTranslation, mtxRotX, mtxRotY, mtxRotZ, mtxFromUnitVectors, matMult,
  type M4,
} from './m4';

/* ═══════════════ MATERIALS (mirrored from helicopter.html) ═══════════════ */

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function hexToLinear(hex: number): [number, number, number] {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return [
    parseFloat(srgbToLinear(r).toFixed(4)),
    parseFloat(srgbToLinear(g).toFixed(4)),
    parseFloat(srgbToLinear(b).toFixed(4)),
  ];
}

const MATERIALS = {
  airframe:   { base: hexToLinear(0x3d4550), metallic: 0.16, roughness: 0.72, doubleSided: true } as GltfMaterialSpec,
  composite:  { base: hexToLinear(0x14181f), metallic: 0.25, roughness: 0.62, doubleSided: true } as GltfMaterialSpec,
  frame:      { base: hexToLinear(0x0e1116), metallic: 0.55, roughness: 0.42, doubleSided: true } as GltfMaterialSpec,
  interior:   { base: hexToLinear(0x0c0e12), metallic: 0.08, roughness: 0.85, doubleSided: true } as GltfMaterialSpec,
  seatFrame:  { base: hexToLinear(0x1a1e26), metallic: 0.35, roughness: 0.55, doubleSided: true } as GltfMaterialSpec,
  seatCushion:{ base: hexToLinear(0x22262d), metallic: 0.05, roughness: 0.85, doubleSided: true } as GltfMaterialSpec,
  seatRed:    { base: hexToLinear(0x5c1319), metallic: 0.20, roughness: 0.62, doubleSided: true } as GltfMaterialSpec,
  titanium:   { base: hexToLinear(0x242a32), metallic: 0.88, roughness: 0.38, doubleSided: true } as GltfMaterialSpec,
  steel:      { base: hexToLinear(0x9aa6b6), metallic: 0.98, roughness: 0.14, doubleSided: true } as GltfMaterialSpec,
  graphite:   { base: hexToLinear(0x1c2028), metallic: 0.65, roughness: 0.45, doubleSided: true } as GltfMaterialSpec,
  tire:       { base: hexToLinear(0x101216), metallic: 0.05, roughness: 0.92, doubleSided: true } as GltfMaterialSpec,
  panel:      { base: hexToLinear(0x090b0f), metallic: 0.45, roughness: 0.55, doubleSided: true } as GltfMaterialSpec,
  green:      { base: [0.003, 0.024, 0.007], emissive: [0.133, 1, 0.267], emissiveIntensity: 2.2, roughness: 0.3, doubleSided: true } as GltfMaterialSpec,
  red:        { base: [0.024, 0.003, 0.003], emissive: [1, 0.133, 0.133], emissiveIntensity: 2.2, roughness: 0.3, doubleSided: true } as GltfMaterialSpec,
  warn:       { base: hexToLinear(0xc92a1a), metallic: 0.15, roughness: 0.55, emissive: [0.13, 0, 0], emissiveIntensity: 0.3, doubleSided: true } as GltfMaterialSpec,
  canopyGlass: { base: hexToLinear(0xa8c8e0), metallic: 0.08, roughness: 0.03, opacity: 0.26, doubleSided: true } as GltfMaterialSpec,
  hudGlass:    { base: [0.005, 0.05, 0.02], emissive: [0, 1, 0.4], emissiveIntensity: 0.4, opacity: 0.40, roughness: 0.05, doubleSided: true } as GltfMaterialSpec,
  screenGreen: { base: [0.001, 0.015, 0.005], emissive: [0, 1, 0.4], emissiveIntensity: 1.8, roughness: 0.3, doubleSided: true } as GltfMaterialSpec,
  screenAmber: { base: [0.015, 0.006, 0], emissive: [1, 0.667, 0.133], emissiveIntensity: 1.5, roughness: 0.3, doubleSided: true } as GltfMaterialSpec,
} as const;
type Mat = keyof typeof MATERIALS;

const g = new GltfBuilder(false);

const UP: [number, number, number] = [0, 1, 0];

/* ═══════════════ MESH-REGISTERING PRIMITIVE HELPERS ═══════════════
 * Each `*Node()` registers a fresh mesh on `g` and returns a GltfNodeSpec
 * (mesh index + transform), so every part is placed exactly where the
 * original helicopter.html placed it. */

function boxNode(w: number, h: number, d: number, mat: Mat, x: number, y: number, z: number,
  rz = 0, ry = 0, rx = 0): GltfNodeSpec {
  const mesh = g.addMesh(buildBoxMesh(w, h, d), MATERIALS[mat]);
  return { mesh, matrix: mtxTR(x, y, z, rx, ry, rz) };
}

function cylNode(r: number, len: number, mat: Mat, x: number, y: number, z: number,
  axis: 'y' | 'x' | 'z' = 'y', rBottom = r): GltfNodeSpec {
  const mesh = g.addMesh(buildCylinderMesh(r, len / 2, 16, rBottom), MATERIALS[mat]);
  let m: M4;
  if (axis === 'x') m = matMult(mtxTranslation(x, y, z), mtxRotZ(Math.PI / 2));
  else if (axis === 'z') m = matMult(mtxTranslation(x, y, z), mtxRotX(Math.PI / 2));
  else m = mtxTranslation(x, y, z);
  return { mesh, matrix: m };
}

function sphereNode(r: number, mat: Mat, x: number, y: number, z: number): GltfNodeSpec {
  const mesh = g.addMesh(buildSphereMesh(r, 10, 12), MATERIALS[mat]);
  return { mesh, matrix: mtxTranslation(x, y, z) };
}

function hubCapNode(radius: number, height: number, mat: Mat, x: number, y: number, z: number): GltfNodeSpec {
  const mesh = g.addMesh(buildHemisphereCapMesh(radius, height, 8, 20), MATERIALS[mat]);
  return { mesh, matrix: mtxTranslation(x, y, z) };
}

function coneNode(r: number, h: number, mat: Mat, x: number, y: number, z: number, rz = 0): GltfNodeSpec {
  const mesh = g.addMesh(buildConeMesh(r, h, 16), MATERIALS[mat]);
  return { mesh, matrix: matMult(mtxTranslation(x, y, z), mtxRotZ(Math.PI / 2 + rz)) };
}

function torusNode(r: number, t: number, mat: Mat, x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0): GltfNodeSpec {
  const mesh = g.addMesh(buildTorusMesh(r, t, 10, 22), MATERIALS[mat]);
  return { mesh, matrix: mtxTR(x, y, z, rx, ry, rz) };
}

function tubeNode(a: [number, number, number], b: [number, number, number], r: number,
  mat: Mat, seg = 12): GltfNodeSpec {
  const { mesh, matrix } = tubeMesh(a, b, r, seg);
  const idx = g.addMesh(mesh, MATERIALS[mat]);
  return { mesh: idx, matrix };
}

/** Thick tube primitive between two points with the tube's own transform. */
function tubeMesh(a: [number, number, number], b: [number, number, number], r: number, seg = 12) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const dir: [number, number, number] = len > 1e-9 ? [dx / len, dy / len, dz / len] : UP;
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const mesh = buildCylinderMesh(r, len / 2, seg);
  const matrix = matMult(mtxTranslation(mid[0], mid[1], mid[2]), mtxFromUnitVectors(UP, dir));
  return { mesh, matrix };
}

/** Polygon extrusion (prism) with optional z-offset and taper function. Returns a node. */
function prismNode(pts: [number, number][], depth: number, mat: Mat,
  x = 0, y = 0, z = 0, rz = 0, ry = 0, rx = 0,
  taper?: (px: number, py: number) => number): GltfNodeSpec {
  const halfZ = depth / 2;
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const [px, py] of pts) { cx += px; cy += py; }
  cx /= n; cy /= n;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [px, py] of pts) {
    const s = taper ? taper(px, py) : 1;
    pos.push(px, py, -halfZ * s);
  }
  for (const [px, py] of pts) {
    const s = taper ? taper(px, py) : 1;
    pos.push(px, py, +halfZ * s);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, i + n, j, j + n, i + n);
  }
  const cs = taper ? taper(cx, cy) : 1;
  const bot = 2 * n; pos.push(cx, cy, -halfZ * cs);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(bot, i, j); }
  const top = 2 * n + 1; pos.push(cx, cy, +halfZ * cs);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(top, j, i); }
  const mesh = g.addMesh({ pos, idx }, MATERIALS[mat]);
  return { mesh, matrix: mtxTR(x, y, z, rx, ry, rz) };
}

/* ═══════════════ SHARED ASSEMBLIES ═══════════════ */

/* Rotor pivots in authored (pre-AXIS_FIX) model space — exported so the App
   can compose per-frame node matrices as T(pivot)·R(spin). */
export const MAIN_ROTOR_PIVOT: [number, number, number] = [-0.55, 2.16, 0];
export const TAIL_ROTOR_PIVOT: [number, number, number] = [-6.40, 1.36, 0.24];

/** Distance from the model origin (fuselage centre) down to the lowest wheel
 *  in authored units: tail wheel centre y = -1.94, radius 0.22. Multiply by
 *  APACHE_MODEL_SCALE to get the ground-clearance offset so the helicopter
 *  sits ON the terrain instead of half-buried in the globe. */
export const APACHE_GEAR_BOTTOM = 2.16;

/** Main rotor head + 4 blades. Spins about local +Y via `mainRotor` node. */
function mainRotorHead(): GltfNodeSpec {
  const kids: GltfNodeSpec[] = [];
  kids.push(cylNode(0.42, 0.36, 'titanium', 0, 0, 0, 'y', 0.54));
  kids.push(hubCapNode(0.42, 0.23, 'titanium', 0, 0.18, 0));
  kids.push(torusNode(0.54, 0.038, 'graphite', 0, -0.18, 0, Math.PI / 2, 0, 0));
  kids.push(cylNode(0.18, 0.04, 'graphite', 0, 0.40, 0));

  for (let i = 0; i < 4; i++) {
    const arm: GltfNodeSpec[] = [];
    arm.push(cylNode(0.16, 0.30, 'titanium', 0.30, 0, 0, 'x'));
    arm.push(torusNode(0.16, 0.022, 'graphite', 0.44, 0, 0, 0, Math.PI / 2, 0));
    arm.push(boxNode(0.34, 0.16, 0.24, 'titanium', 0.56, 0, 0));
    arm.push(boxNode(0.13, 0.11, 0.20, 'steel', 0.50, 0.02, -0.22));
    arm.push(tubeNode([0.50, -0.32, -0.22], [0.50, 0.02, -0.22], 0.018, 'steel', 8));
    arm.push(cylNode(0.048, 0.42, 'graphite', 0.42, -0.02, 0.22, 'x'));
    arm.push(sphereNode(0.035, 'steel', 0.60, -0.02, 0.30));
    arm.push(cylNode(0.15, 0.22, 'composite', 0.76, 0, 0, 'x'));
    arm.push(torusNode(0.155, 0.018, 'steel', 0.66, 0, 0, 0, Math.PI / 2, 0));

    const blade: GltfNodeSpec[] = [];
    const mainLen = 4.25; // BLADE_TIP_START(4.85) - BLADE_ROOT(0.60)
    const blX = 0.60 + mainLen / 2;
    blade.push(boxNode(mainLen, 0.045, 0.44, 'graphite', blX, 0, 0));
    blade.push(boxNode(mainLen, 0.048, 0.045, 'titanium', blX, 0, -0.22));
    blade.push(boxNode(mainLen * 0.94, 0.018, 0.055, 'steel', blX, 0.032, 0.188));
    const tip: GltfNodeSpec[] = [];
    const tipLen = 0.60;
    tip.push(boxNode(tipLen, 0.045, 0.35, 'graphite', tipLen / 2, 0, 0));
    tip.push(boxNode(tipLen, 0.048, 0.042, 'titanium', tipLen / 2, 0, -0.16));
    tip.push(boxNode(0.045, 0.048, 0.36, 'titanium', tipLen, 0, 0));
    blade.push({ children: tip, matrix: mtxTR(4.85, 0, 0, 0, -0.32, 0) });
    arm.push({ children: blade, matrix: mtxTR(0, 0, 0, 0, 0, -0.030) });
    kids.push({ children: arm, matrix: mtxRotY(i * Math.PI / 2) });
  }
  return { name: 'mainRotor', matrix: mtxTranslation(...MAIN_ROTOR_PIVOT), children: kids };
}

/** Tail rotor. Spins about local +Z... actually +Y of the noodle model:
 *  helicopter.html spun tailRotor.rotation.z. To mirror exactly we rotate
 *  the whole group about local Z. */
function tailRotorHead(): GltfNodeSpec {
  const kids: GltfNodeSpec[] = [];
  kids.push(cylNode(0.24, 0.20, 'titanium', -0.05, 0, 0.04, 'x'));
  kids.push(sphereNode(0.20, 'titanium', -0.05, 0, 0.14));
  kids.push(torusNode(0.24, 0.020, 'steel', -0.05, 0, -0.02, Math.PI / 2, 0, 0));
  for (let i = 0; i < 4; i++) {
    const arm: GltfNodeSpec[] = [];
    arm.push(cylNode(0.055, 0.16, 'titanium', 0, 0.20, 0));
    arm.push(boxNode(0.10, 0.06, 0.06, 'steel', 0, 0.20, 0.10));
    arm.push(tubeNode([0.02, 0.24, 0.10], [0.02, 0.40, 0.10], 0.010, 'steel', 6));
    arm.push(boxNode(0.11, 1.05, 0.032, 'graphite', 0, 0.75, 0));
    arm.push(boxNode(0.11, 1.05, 0.020, 'titanium', -0.055, 0.75, 0));
    arm.push(boxNode(0.11, 1.05, 0.010, 'steel', 0.050, 0.75, 0.022));
    arm.push(boxNode(0.12, 0.08, 0.035, 'steel', 0, 1.30, 0));
    arm.push(boxNode(0.10, 0.05, 0.036, 'steel', 0, 0.26, 0));
    kids.push({ children: arm, matrix: mtxRotZ(i * Math.PI / 2 + (i % 2 ? 0.10 : 0)) });
  }
  return { name: 'tailRotor', matrix: mtxTranslation(...TAIL_ROTOR_PIVOT), children: kids };
}

/** TADS / nose sensor cluster. */
function noseSights(): GltfNodeSpec[] {
  const kids: GltfNodeSpec[] = [];
  kids.push(cylNode(0.40, 0.70, 'titanium', 0, 0, 0, 'x'));
  kids.push(torusNode(0.40, 0.020, 'graphite', 0.30, 0, 0, 0, Math.PI / 2, 0));
  kids.push(cylNode(0.22, 0.28, 'titanium', -0.05, 0.42, 0));
  kids.push({ mesh: g.addMesh(buildCylinderMesh(0.13, 0.03, 18), MATERIALS.canopyGlass), matrix: matMult(mtxTranslation(0.12, 0.42, 0), mtxRotZ(Math.PI / 2)) });
  kids.push(sphereNode(0.24, 'titanium', 0.30, 0.06, 0.14));
  kids.push({ mesh: g.addMesh(buildCylinderMesh(0.14, 0.04, 18), MATERIALS.canopyGlass), matrix: matMult(mtxTranslation(0.50, 0.06, 0.14), mtxRotZ(Math.PI / 2)) });
  kids.push(cylNode(0.14, 0.14, 'steel', 0.46, -0.18, -0.14, 'x'));
  kids.push(tubeNode([0.30, 0.30, 0.24], [1.10, 0.30, 0.24], 0.020, 'steel'));
  kids.push(tubeNode([0.30, 0.30, -0.24], [1.10, 0.30, -0.24], 0.020, 'steel'));
  return kids;
}

/** M230 chain gun. */
function gunAssembly(): GltfNodeSpec[] {
  return [
    boxNode(0.70, 0.42, 0.48, 'titanium', 0, 0, 0),
    boxNode(0.68, 0.10, 0.50, 'graphite', 0, 0.16, 0),
    tubeNode([0.32, -0.05, 0], [2.00, -0.05, 0], 0.048, 'titanium', 14),
    boxNode(0.05, 0.10, 0.14, 'graphite', 1.10, -0.05, 0),
    boxNode(0.18, 0.11, 0.09, 'titanium', 2.08, -0.05, 0),
  ];
}

/** Main landing gear (per side, s = ±1). */
function landingGear(s: number): GltfNodeSpec[] {
  const kids: GltfNodeSpec[] = [];
  const side = (p: [number, number, number]): [number, number, number] => [p[0], p[1], p[2]];
  const U: [number, number, number] = [0.95, -0.88, 0.62 * s];
  const R: [number, number, number] = [-0.25, -0.68, 0.55 * s];
  const W: [number, number, number] = [0.32, -1.68, 1.10 * s];
  const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const M = lerp3(U, W, 0.60);
  const T2 = lerp3(M, W, 0.45);

  // brackets + pins
  kids.push(boxNode(0.32, 0.22, 0.18, 'titanium', U[0] + 0.02, U[1] + 0.08, U[2]));
  kids.push(boxNode(0.24, 0.18, 0.16, 'titanium', R[0] + 0.05, R[1] + 0.06, R[2]));
  kids.push(cylNode(0.050, 0.24, 'steel', U[0], U[1], U[2], 'z'));
  kids.push(cylNode(0.045, 0.22, 'steel', R[0], R[1], R[2], 'z'));
  kids.push(sphereNode(0.055, 'graphite', U[0], U[1], U[2]));
  kids.push(sphereNode(0.050, 'graphite', R[0], R[1], R[2]));

  // trailing arm + rib
  kids.push(tubeNode(U, W, 0.085, 'titanium', 16));
  kids.push(tubeNode([U[0], U[1] + 0.02, U[2] + 0.07 * s], [W[0], W[1] + 0.08, W[2] + 0.07 * s], 0.028, 'graphite', 10));

  // oleo
  {
    const dir: [number, number, number] = norm3(sub3(M, R));
    const olen = dist3(R, M);
    const bodyLen = olen * 0.55;
    const mid = add3(R, scale3(dir, bodyLen * 0.5));
    const m = buildCylinderMesh(0.085, bodyLen / 2, 14);
    kids.push({ mesh: g.addMesh({ pos: m.pos, idx: m.idx }, MATERIALS.graphite), matrix: matMult(mtxTranslation(mid[0], mid[1], mid[2]), mtxFromUnitVectors(UP, dir)) });
    const pistonLen = olen * 0.62;
    const pmid = sub3(M, scale3(dir, pistonLen * 0.5));
    const pm = buildCylinderMesh(0.055, pistonLen / 2, 12);
    kids.push({ mesh: g.addMesh({ pos: pm.pos, idx: pm.idx }, MATERIALS.steel), matrix: matMult(mtxTranslation(pmid[0], pmid[1], pmid[2]), mtxFromUnitVectors(UP, dir)) });
  }
  kids.push(sphereNode(0.085, 'graphite', R[0], R[1], R[2]));
  kids.push(sphereNode(0.058, 'steel', M[0], M[1], M[2]));

  // junction block
  kids.push(boxNode(0.18, 0.20, 0.18, 'titanium', M[0], M[1], M[2]));
  kids.push(cylNode(0.038, 0.22, 'steel', M[0], M[1], M[2], 'z'));

  // torque/scissor links
  const T1 = lerp3(R, M, 0.45);
  const T3: [number, number, number] = [W[0] + 0.12, W[1] + 0.12, W[2] - 0.02 * s];
  kids.push(tubeNode(T1, T2, 0.024, 'steel', 10));
  kids.push(tubeNode(T2, T3, 0.024, 'steel', 10));
  kids.push(sphereNode(0.032, 'graphite', T2[0], T2[1], T2[2]));
  kids.push(cylNode(0.024, 0.10, 'graphite', T1[0], T1[1], T1[2], 'z'));
  kids.push(cylNode(0.024, 0.10, 'graphite', T3[0], T3[1], T3[2], 'z'));

  // brake line
  const BL1: [number, number, number] = [U[0] - 0.06, U[1] - 0.04, U[2] - 0.06 * s];
  const BL2 = [...lerp3(U, W, 0.45)] as [number, number, number];
  BL2[2] -= 0.05 * s;
  const BL3: [number, number, number] = [W[0] - 0.02, W[1] + 0.16, W[2] + 0.19 * s];
  kids.push(tubeNode(BL1, BL2, 0.011, 'graphite', 7));
  kids.push(tubeNode(BL2, BL3, 0.011, 'graphite', 7));
  kids.push(boxNode(0.05, 0.05, 0.05, 'graphite', BL2[0], BL2[1], BL2[2]));

  // axle + wheel (axle runs laterally = model Z, matching the original
  // cylinder.rotation.x = PI/2 which orients the +Y axis onto Z)
  kids.push(cylNode(0.070, 0.40, 'titanium', W[0], W[1], W[2], 'z'));
  kids.push(cylNode(0.46, 0.32, 'tire', W[0], W[1], W[2], 'z'));
  kids.push(torusNode(0.42, 0.010, 'graphite', W[0], W[1], W[2], 0, Math.PI / 2, 0));
  kids.push(cylNode(0.25, 0.34, 'titanium', W[0], W[1], W[2], 'z'));
  kids.push(cylNode(0.21, 0.025, 'steel', W[0], W[1], W[2] + 0.16 * s, 'z'));
  kids.push(boxNode(0.16, 0.22, 0.11, 'graphite', W[0], W[1], W[2] + 0.19 * s));
  kids.push(sphereNode(0.026, 'graphite', W[0] - 0.05, W[1] + 0.13, W[2] + 0.19 * s));
  kids.push(cylNode(0.12, 0.36, 'steel', W[0], W[1], W[2], 'z'));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    kids.push(sphereNode(0.020, 'graphite', W[0] + Math.cos(a) * 0.17, W[1] + Math.sin(a) * 0.17, W[2] + 0.18 * s));
  }

  // steering damper
  const SA1: [number, number, number] = [U[0] - 0.20, U[1] - 0.35, U[2] - 0.08 * s];
  const SA2 = [...lerp3(U, W, 0.30)] as [number, number, number];
  SA2[2] += 0.02 * s;
  kids.push(boxNode(0.14, 0.32, 0.12, 'titanium', SA1[0], SA1[1] + 0.16, SA1[2]));
  kids.push(tubeNode(SA1, SA2, 0.024, 'graphite', 8));
  kids.push(sphereNode(0.032, 'steel', SA1[0], SA1[1], SA1[2]));
  kids.push(sphereNode(0.032, 'steel', SA2[0], SA2[1], SA2[2]));
  kids.push(tubeNode(
    [SA1[0] - 0.02, SA1[1] + 0.06, SA1[2]],
    [SA1[0] - 0.10, SA1[1] + 0.10, SA1[2]], 0.008, 'graphite', 6,
  ));
  void side;
  return kids;
}

/** Tail wheel with drag brace. */
function tailWheel(): GltfNodeSpec[] {
  const TW_TOP: [number, number, number] = [-5.90, -0.20, 0];
  const TW_FWD: [number, number, number] = [-5.55, -0.60, 0];
  const TW_BOT: [number, number, number] = [-6.20, -1.88, 0];
  const TW_W: [number, number, number] = [-6.20, -1.94, 0];
  const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const TW_MID = lerp3(TW_TOP, TW_BOT, 0.55);
  const kids: GltfNodeSpec[] = [];
  kids.push(boxNode(0.26, 0.20, 0.26, 'titanium', TW_TOP[0], TW_TOP[1] + 0.04, 0));
  kids.push(cylNode(0.045, 0.24, 'steel', TW_TOP[0], TW_TOP[1], 0, 'z'));
  kids.push(boxNode(0.12, 0.32, 0.12, 'titanium', TW_FWD[0], -0.38, 0));
  kids.push(boxNode(0.18, 0.16, 0.18, 'titanium', TW_FWD[0], TW_FWD[1] + 0.06, 0));
  kids.push(cylNode(0.038, 0.20, 'steel', TW_FWD[0], TW_FWD[1], 0, 'z'));

  const dir = norm3(sub3(TW_BOT, TW_TOP));
  const slen = dist3(TW_TOP, TW_BOT);
  const bodyLen = slen * 0.55;
  {
    const mid = add3(TW_TOP, scale3(dir, bodyLen * 0.275));
    const m = buildCylinderMesh(0.078, bodyLen / 2, 14);
    kids.push({ mesh: g.addMesh(m, MATERIALS.graphite), matrix: matMult(mtxTranslation(mid[0], mid[1], mid[2]), mtxFromUnitVectors(UP, dir)) });
  }
  const pistonLen = slen * 0.60;
  {
    const mid = sub3(TW_BOT, scale3(dir, pistonLen * 0.5));
    const m = buildCylinderMesh(0.048, pistonLen / 2, 12);
    kids.push({ mesh: g.addMesh(m, MATERIALS.steel), matrix: matMult(mtxTranslation(mid[0], mid[1], mid[2]), mtxFromUnitVectors(UP, dir)) });
  }
  kids.push(sphereNode(0.078, 'graphite', TW_TOP[0], TW_TOP[1], 0));
  kids.push(sphereNode(0.052, 'steel', TW_BOT[0], TW_BOT[1], 0));
  kids.push(tubeNode(TW_FWD, TW_MID, 0.045, 'titanium', 10));
  kids.push(sphereNode(0.050, 'graphite', TW_MID[0], TW_MID[1], 0));
  kids.push(cylNode(0.030, 0.10, 'graphite', TW_MID[0], TW_MID[1], 0, 'z'));

  kids.push(boxNode(0.20, 0.26, 0.26, 'titanium', TW_BOT[0], TW_BOT[1] - 0.02, 0));
  for (const fs of [1, -1]) {
    kids.push(boxNode(0.055, 0.22, 0.04, 'titanium', TW_BOT[0], TW_BOT[1] - 0.16, 0.13 * fs));
    kids.push(cylNode(0.020, 0.06, 'steel', TW_BOT[0], TW_W[1], 0.14 * fs, 'z'));
  }
  kids.push(cylNode(0.035, 0.22, 'titanium', TW_W[0], TW_W[1], 0, 'x'));
  kids.push(cylNode(0.22, 0.16, 'tire', TW_W[0], TW_W[1], 0, 'x'));
  kids.push(cylNode(0.10, 0.18, 'steel', TW_W[0], TW_W[1], 0, 'x'));
  kids.push(cylNode(0.05, 0.20, 'graphite', TW_W[0], TW_W[1], 0, 'x'));
  kids.push(tubeNode([-5.95, -0.45, 0.06], [-6.10, -1.20, 0.06], 0.008, 'graphite', 6));
  return kids;
}

/* ═══════════════ VECTOR HELPERS ═══════════════ */
function sub3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale3(a: [number, number, number], s: number): [number, number, number] {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function norm3(a: [number, number, number]): [number, number, number] {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (l < 1e-9) return [0, 1, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}
function dist3(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* ═══════════════ CANOPY ═══════════════ */
type CanopySection = { x: number; sillY: number; sillZ: number; ridgeY: number };
const canopySections: CanopySection[] = [
  { x: -0.15, sillY: 0.30, sillZ: 0.55, ridgeY: 1.32 },
  { x:  0.20, sillY: 0.30, sillZ: 0.58, ridgeY: 1.35 },
  { x:  0.70, sillY: 0.28, sillZ: 0.60, ridgeY: 1.35 },
  { x:  1.20, sillY: 0.26, sillZ: 0.61, ridgeY: 1.30 },
  { x:  1.55, sillY: 0.24, sillZ: 0.62, ridgeY: 1.20 },
  { x:  1.85, sillY: 0.22, sillZ: 0.62, ridgeY: 1.08 },
  { x:  2.20, sillY: 0.22, sillZ: 0.62, ridgeY: 0.98 },
  { x:  2.70, sillY: 0.22, sillZ: 0.61, ridgeY: 0.86 },
  { x:  3.10, sillY: 0.20, sillZ: 0.60, ridgeY: 0.72 },
  { x:  3.50, sillY: 0.16, sillZ: 0.55, ridgeY: 0.55 },
  { x:  3.85, sillY: 0.08, sillZ: 0.46, ridgeY: 0.36 },
  { x:  4.12, sillY: -0.04, sillZ: 0.36, ridgeY: 0.16 },
  { x:  4.32, sillY: -0.14, sillZ: 0.26, ridgeY: -0.02 },
];
const X_MIN = canopySections[0].x;
const X_MAX = canopySections[canopySections.length - 1].x;

function sampleCanopy(x: number): CanopySection {
  for (let i = 0; i < canopySections.length - 1; i++) {
    const a = canopySections[i], b = canopySections[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      const ts = t * t * (3 - 2 * t);
      return {
        x, sillY: a.sillY + (b.sillY - a.sillY) * ts,
        sillZ: a.sillZ + (b.sillZ - a.sillZ) * ts,
        ridgeY: a.ridgeY + (b.ridgeY - a.ridgeY) * ts,
      };
    }
  }
  return canopySections[canopySections.length - 1];
}

function buildCanopyShell(): GltfNodeSpec[] {
  const X_STEPS = 56, ARC_STEPS = 22;
  const pos: number[] = [];
  for (let i = 0; i <= X_STEPS; i++) {
    const t = i / X_STEPS;
    const x = X_MIN + (X_MAX - X_MIN) * t;
    const s = sampleCanopy(x);
    for (let j = 0; j <= ARC_STEPS; j++) {
      const u = j / ARC_STEPS;
      const theta = (u - 0.5) * Math.PI;
      pos.push(x, s.sillY + (s.ridgeY - s.sillY) * Math.cos(theta), Math.sin(theta) * s.sillZ);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < X_STEPS; i++) {
    for (let j = 0; j < ARC_STEPS; j++) {
      const a = i * (ARC_STEPS + 1) + j;
      const b = a + (ARC_STEPS + 1);
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const mesh = g.addMesh({ pos, idx }, MATERIALS.canopyGlass);
  return [{ mesh, matrix: mtxTranslation(0, 0, 0) }];
}

function canopyFrames(): GltfNodeSpec[] {
  const kids: GltfNodeSpec[] = [];
  const ring = (x: number, thick = 0.028) => {
    const s = sampleCanopy(x);
    const pts: [number, number, number][] = [];
    for (let j = 0; j <= 28; j++) {
      const u = j / 28;
      const theta = (u - 0.5) * Math.PI;
      pts.push([x, s.sillY + (s.ridgeY - s.sillY) * Math.cos(theta), Math.sin(theta) * s.sillZ]);
    }
    const mesh = g.addMesh(buildContinuousTubeMesh(pts, thick, 12), MATERIALS.frame);
    kids.push({ mesh, matrix: mtxTranslation(0, 0, 0) });
  };
  ring(-0.15, 0.030);
  ring(1.75, 0.032);
  ring(3.45, 0.028);
  ring(4.32, 0.024);
  for (const side of [1, -1]) {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 56; i++) {
      const x = X_MIN + (X_MAX - X_MIN) * (i / 56);
      const s = sampleCanopy(x);
      pts.push([x, s.sillY, side * s.sillZ]);
    }
    const mesh = g.addMesh(buildContinuousTubeMesh(pts, 0.026, 12), MATERIALS.frame);
    kids.push({ mesh, matrix: mtxTranslation(0, 0, 0) });
  }
  {
    const ridge: [number, number, number][] = [];
    for (let i = 0; i <= 56; i++) {
      const x = X_MIN + (X_MAX - X_MIN) * (i / 56);
      const s = sampleCanopy(x);
      ridge.push([x, s.ridgeY, 0]);
    }
    const mesh = g.addMesh(buildContinuousTubeMesh(ridge, 0.022, 12), MATERIALS.frame);
    kids.push({ mesh, matrix: mtxTranslation(0, 0, 0) });
  }
  kids.push(boxNode(0.10, 0.06, 0.16, 'titanium', 3.60, 0.28, 0));
  kids.push(boxNode(0.10, 0.06, 0.16, 'titanium', 1.85, 0.80, 0));
  return kids;
}

function cockpitInterior(): GltfNodeSpec[] {
  const kids: GltfNodeSpec[] = [];
  kids.push(boxNode(3.30, 0.05, 1.05, 'interior', 1.65, 0.06, 0));
  kids.push(boxNode(0.10, 0.95, 1.05, 'interior', -0.10, 0.58, 0));
  kids.push(boxNode(0.08, 0.30, 1.00, 'interior', 1.70, 0.22, 0));
  kids.push(boxNode(0.10, 0.40, 0.95, 'interior', 3.20, 0.30, 0));
  for (const s of [1, -1]) kids.push(boxNode(3.20, 0.50, 0.05, 'interior', 1.65, 0.30, 0.60 * s));

  const station = (xCenter: number, seatY: number, isPilot: boolean): GltfNodeSpec => {
    const k2: GltfNodeSpec[] = [];
    const seatX = 0;
    k2.push(boxNode(0.62, 0.10, 0.58, 'seatFrame', seatX, seatY, 0));
    k2.push(boxNode(0.58, 0.05, 0.54, 'seatCushion', seatX, seatY + 0.075, 0));
    k2.push(boxNode(0.58, 0.02, 0.10, 'seatRed', seatX, seatY + 0.105, 0));
    k2.push(boxNode(0.14, 0.72, 0.58, 'seatFrame', seatX - 0.30, seatY + 0.36, 0));
    k2.push(boxNode(0.06, 0.66, 0.52, 'seatCushion', seatX - 0.22, seatY + 0.36, 0));
    k2.push(boxNode(0.16, 0.22, 0.34, 'seatFrame', seatX - 0.32, seatY + 0.84, 0));
    k2.push(boxNode(0.08, 0.18, 0.30, 'seatCushion', seatX - 0.23, seatY + 0.84, 0));
    for (const s of [1, -1]) k2.push(boxNode(0.42, 0.20, 0.05, 'seatFrame', seatX - 0.05, seatY + 0.22, 0.32 * s));
    k2.push(boxNode(0.03, 0.32, 0.05, 'seatRed', seatX - 0.22, seatY + 0.50, 0.14));
    k2.push(boxNode(0.03, 0.32, 0.05, 'seatRed', seatX - 0.22, seatY + 0.50, -0.14));
    const panelX = seatX + 0.68, panelY = seatY + 0.22;
    k2.push(boxNode(0.12, 0.46, 0.88, 'composite', panelX, panelY, 0, -0.38));
    k2.push(boxNode(0.24, 0.06, 0.90, 'composite', panelX - 0.04, panelY + 0.26, 0, -0.38));
    k2.push(boxNode(0.02, 0.20, 0.24, 'screenGreen', panelX + 0.08, panelY + 0.04, 0.24, -0.38));
    k2.push(boxNode(0.02, 0.20, 0.24, 'screenGreen', panelX + 0.08, panelY + 0.04, -0.24, -0.38));
    k2.push(boxNode(0.02, 0.14, 0.26, 'screenAmber', panelX + 0.07, panelY - 0.18, 0, -0.38));
    k2.push(boxNode(0.14, 0.035, 0.60, 'composite', panelX - 0.02, panelY + 0.28, 0, -0.38));
    for (let i = -2; i <= 2; i++) {
      const col: [number, number, number] =
        i === 0 ? [1, 0.2, 0.13] : (Math.abs(i) === 1 ? [1, 0.667, 0.133] : [0.13, 1, 0.53]);
      const lamp: GltfMaterialSpec = {
        base: [0.08, 0.08, 0.08], emissive: col, emissiveIntensity: 1.4, doubleSided: true,
      };
      const lampIdx = g.addMesh(buildBoxMesh(0.015, 0.025, 0.025), lamp);
      k2.push({ mesh: lampIdx, matrix: mtxTR(panelX + 0.03, panelY + 0.28, 0.12 * i, -0.38) });
    }
    const stickBase: [number, number, number] = [seatX + 0.28, seatY + 0.05, 0];
    const stickTop: [number, number, number] = [seatX + 0.32, seatY + 0.42, 0];
    k2.push(tubeNode(stickBase, stickTop, 0.024, 'titanium', 9));
    k2.push(sphereNode(0.055, 'seatRed', stickTop[0], stickTop[1], stickTop[2]));
    k2.push(tubeNode([seatX - 0.05, seatY + 0.10, 0.42], [seatX + 0.30, seatY + 0.30, 0.42], 0.022, 'titanium', 9));
    k2.push(sphereNode(0.05, 'seatRed', seatX + 0.30, seatY + 0.30, 0.42));
    for (const s of [1, -1]) {
      k2.push(boxNode(0.18, 0.035, 0.14, 'composite', panelX - 0.30, seatY - 0.06, 0.16 * s));
      k2.push(tubeNode([panelX - 0.30, seatY - 0.06, 0.16 * s], [panelX - 0.42, seatY + 0.06, 0.16 * s], 0.012, 'titanium', 7));
    }

    // Collimated HUD unit (housing, projector lens, mount tubes, and HUD glass combiner)
    const hudX = seatX + 0.55, hudY = seatY + 0.50;
    k2.push(boxNode(0.26, 0.14, 0.34, 'composite', hudX, hudY - 0.16, 0));
    k2.push(cylNode(0.09, 0.14, 'titanium', hudX + 0.10, hudY - 0.06, 0, 'x', 0.10));
    for (const s of [1, -1]) {
      k2.push(tubeNode([hudX - 0.05, hudY - 0.10, 0.20 * s], [hudX + 0.05, hudY + 0.22, 0.20 * s], 0.014, 'titanium', 8));
    }
    k2.push(boxNode(0.012, 0.28, 0.38, 'hudGlass', hudX + 0.08, hudY + 0.14, 0, 0.55));

    void isPilot;
    return { children: k2, matrix: mtxTranslation(xCenter, 0, 0) };
  };

  kids.push(station(2.20, 0.15, false));
  kids.push(station(0.75, 0.40, true));
  return kids;
}

/* ═══════════════ FUSELAGE ═══════════════ */
function fuselage(): GltfNodeSpec[] {
  const kids: GltfNodeSpec[] = [];
  const aftShape: [number, number][] = [
    [1.55, 1.14], [0.24, 1.14], [-0.45, 1.00], [-1.10, 0.95], [-2.05, 0.74],
    [-2.62, 0.36], [-2.62, -0.34], [-1.70, -0.76], [0.50, -0.94], [1.55, -0.94],
  ];
  kids.push(prismNode(aftShape, 1.32, 'airframe'));
  const tubShape: [number, number][] = [
    [1.55, -0.94], [3.55, -0.90], [4.32, -0.48], [4.35, -0.14], [3.35, 0.20], [1.55, 0.22],
  ];
  const tubTaper = (px: number) => {
    if (px > 1.55) {
      const t = Math.min(1.0, (px - 1.55) / 2.80);
      return 1 - 0.52 * t;
    }
    return 1;
  };
  kids.push(prismNode(tubShape, 1.32, 'airframe', 0, 0, 0, 0, 0, 0, tubTaper));
  kids.push(boxNode(1.75, 0.44, 0.98, 'composite', 3.00, -0.86, 0, -0.06));
  kids.push(tubeNode([2.40, -0.96, 0], [2.72, -1.16, 0], 0.066, 'titanium', 12));

  for (const s of [1, -1]) {
    kids.push(boxNode(3.80, 0.014, 0.010, 'panel', -0.42, 0.55, 0.665 * s));
    kids.push(boxNode(3.80, 0.014, 0.010, 'panel', -0.42, -0.25, 0.68 * s));
    kids.push(boxNode(0.70, 0.42, 0.012, 'panel', 0.20, -0.55, 0.665 * s));
    kids.push(boxNode(0.32, 0.22, 0.012, 'panel', -0.90, 0.30, 0.66 * s));
    kids.push(boxNode(0.30, 0.20, 0.012, 'panel', -1.80, 0.10, 0.60 * s));
    kids.push(boxNode(0.24, 0.18, 0.012, 'panel', -2.25, 0.30, 0.55 * s));
    kids.push(boxNode(0.18, 0.045, 0.06, 'green', 0.60, -0.88, 0.55 * s));
    kids.push(boxNode(0.04, 0.42, 0.02, 'warn', -0.15, -0.55, 0.672 * s));
  }
  kids.push(boxNode(0.55, 0.24, 0.012, 'panel', 3.10, -0.60, 0.42, 0, -0.10, 0));
  kids.push(boxNode(0.40, 0.18, 0.012, 'panel', 3.55, -0.55, 0.30, 0, -0.14, 0));
  kids.push(boxNode(0.50, 0.20, 0.012, 'panel', 3.85, -0.30, 0.20, 0, -0.20, 0));

  for (const s of [1, -1]) {
    kids.push(boxNode(2.65, 0.55, 0.06, 'airframe', 0.65, -0.38, 0.745 * s));
    kids.push(boxNode(2.60, 0.012, 0.02, 'panel', 0.65, -0.10, 0.775 * s));
    kids.push(boxNode(2.60, 0.012, 0.02, 'panel', 0.65, -0.66, 0.775 * s));
    for (const xr of [-0.65, -0.25, 0.35, 0.90, 1.40, 1.85]) {
      kids.push(boxNode(0.014, 0.50, 0.02, 'panel', xr, -0.38, 0.778 * s));
    }
    kids.push(boxNode(0.06, 0.06, 0.05, 'red', 1.95, -0.20, 0.74 * s));
  }
  return kids;
}

/** Static rotor pylon: doghouse, mast, swash plates (ported from original). */
function rotorMast(): GltfNodeSpec[] {
  const kids: GltfNodeSpec[] = [];
  const RC = MAIN_ROTOR_PIVOT[0]; // -0.55
  const dhShape: [number, number][] = [
    [-1.55, 0.00], [1.45, 0.00], [1.18, 0.34], [0.55, 0.60], [-0.30, 0.66], [-0.95, 0.60], [-1.48, 0.30],
  ];
  kids.push(prismNode(dhShape, 0.96, 'airframe', RC, 1.14, 0));
  kids.push(boxNode(2.10, 0.08, 0.42, 'composite', RC - 0.05, 1.81, 0));
  kids.push(boxNode(0.48, 0.03, 0.22, 'graphite', RC - 0.55, 1.74, 0.28));
  kids.push(boxNode(0.48, 0.03, 0.22, 'graphite', RC - 0.55, 1.74, -0.28));
  kids.push(boxNode(0.24, 0.03, 0.42, 'graphite', RC - 1.25, 1.48, 0));
  kids.push(cylNode(0.36, 0.32, 'titanium', RC, 1.46, 0, 'y', 0.56));
  kids.push(torusNode(0.52, 0.030, 'graphite', RC, 1.32, 0, Math.PI / 2, 0, 0));
  kids.push(cylNode(0.16, 0.78, 'titanium', RC, 2.00, 0));
  kids.push(torusNode(0.44, 0.055, 'titanium', RC, 1.76, 0, Math.PI / 2, 0, 0));
  kids.push(torusNode(0.44, 0.055, 'steel', RC, 1.83, 0, Math.PI / 2, 0, 0));
  // pitch links from doghouse to swash
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI;
    kids.push(tubeNode(
      [RC + Math.cos(a) * 0.30, 1.62, Math.sin(a) * 0.30],
      [RC + Math.cos(a) * 0.42, 1.84, Math.sin(a) * 0.42], 0.020, 'steel', 8,
    ));
  }
  // 3 angled swashplate hydraulic cylinders from helicopter.html
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const bot: [number, number, number] = [RC + Math.cos(a) * 0.78, 1.34, Math.sin(a) * 0.78];
    const top: [number, number, number] = [RC + Math.cos(a) * 0.60, 1.74, Math.sin(a) * 0.60];
    kids.push(tubeNode(bot, top, 0.038, 'titanium', 10));

    const dx = top[0] - bot[0], dy = top[1] - bot[1], dz = top[2] - bot[2];
    const L = Math.hypot(dx, dy, dz);
    if (L > 1e-6) {
      const ux = dx / L, uy = dy / L, uz = dz / L;
      const cx = bot[0] + dx * 0.55, cy = bot[1] + dy * 0.55, cz = bot[2] + dz * 0.55;
      const c1: [number, number, number] = [cx - ux * 0.18, cy - uy * 0.18, cz - uz * 0.18];
      const c2: [number, number, number] = [cx + ux * 0.18, cy + uy * 0.18, cz + uz * 0.18];
      kids.push(tubeNode(c1, c2, 0.058, 'graphite', 12));
    }
  }
  return kids;
}

/* ═══════════════ ENGINES / WEAPONS / TAIL ═══════════════ */
function enginesAndWeapons(): GltfNodeSpec[] {
  const kids: GltfNodeSpec[] = [];
  for (const s of [1, -1]) {
    const eng: GltfNodeSpec[] = [];
    eng.push(boxNode(2.2, 0.58, 0.46, 'airframe', 0, 0, 0));
    eng.push(boxNode(2.15, 0.012, 0.02, 'panel', 0, 0.20, 0.235));
    eng.push(boxNode(2.15, 0.012, 0.02, 'panel', 0, -0.05, 0.235));
    for (const xr of [-0.70, -0.10, 0.55]) eng.push(boxNode(0.014, 0.55, 0.02, 'panel', xr, 0, 0.235));
    eng.push(cylNode(0.26, 0.35, 'composite', 1.12, 0, 0, 'x', 0.28));
    eng.push(torusNode(0.28, 0.018, 'steel', 1.29, 0, 0, 0, Math.PI / 2, 0));
    eng.push(coneNode(0.14, 0.30, 'graphite', 1.05, 0, 0, -Math.PI / 2));
    eng.push(cylNode(0.25, 0.70, 'titanium', -1.25, 0, 0, 'x', 0.30));
    eng.push(cylNode(0.32, 0.40, 'graphite', -1.38, 0, 0, 'x'));
    kids.push({ children: eng, matrix: mtxTranslation(-1.45, 0.76, 0.72 * s) });

    kids.push(boxNode(1.1, 0.16, 2.2, 'airframe', -0.95, -0.28, 1.55 * s));
    kids.push(boxNode(1.05, 0.012, 0.02, 'panel', -0.95, -0.19, 1.55 * s));
    // Inboard pylon mounting the rocket pod to the wing
    kids.push(boxNode(0.55, 0.28, 0.16, 'composite', -0.95, -0.50, 1.15 * s));
    kids.push(boxNode(0.52, 0.012, 0.02, 'panel', -0.95, -0.42, 1.15 * s));
    kids.push(cylNode(0.32, 1.7, 'airframe', -0.95, -0.88, 1.15 * s, 'x'));
    kids.push(cylNode(0.20, 0.20, 'airframe', 0.05, -0.88, 1.15 * s, 'x', 0.32));
    for (let r = 0; r < 2; r++) {
      const ringRad = 0.11 + r * 0.11;
      const n = r === 0 ? 7 : 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r * 0.4;
        const idx = g.addMesh(buildCylinderMesh(0.028, 0.025, 6), { base: [0.012, 0.016, 0.016], roughness: 1.0 } as GltfMaterialSpec);
        kids.push({ mesh: idx, matrix: matMult(mtxTranslation(-0.08, -0.88 + Math.cos(a) * ringRad, 1.15 * s + Math.sin(a) * ringRad), mtxRotZ(Math.PI / 2)) });
      }
    }
    // Outboard pylon mounting the Hellfire launcher rail to the wing
    kids.push(boxNode(0.55, 0.38, 0.16, 'composite', -0.95, -0.55, 2.15 * s));
    kids.push(boxNode(0.52, 0.012, 0.02, 'panel', -0.95, -0.45, 2.15 * s));
    kids.push(boxNode(1.3, 0.08, 0.55, 'composite', -0.95, -0.74, 2.15 * s));
    kids.push(boxNode(1.25, 0.012, 0.02, 'panel', -0.95, -0.69, 2.15 * s));
    for (const py of [-0.85, -0.98]) {
      for (const pz of [2.05, 2.25]) {
        const miss: GltfNodeSpec[] = [];
        miss.push(cylNode(0.065, 1.35, 'composite', 0, 0, 0, 'x'));
        miss.push(sphereNode(0.065, 'canopyGlass', 0.68, 0, 0));
        miss.push(cylNode(0.067, 0.06, 'warn', 0.10, 0, 0, 'x'));
        for (let f = 0; f < 4; f++) {
          const fa = f * Math.PI / 2 + Math.PI / 4;
          const finMesh = g.addMesh(buildBoxMesh(0.22, 0.14, 0.010), MATERIALS.graphite);
          miss.push({ mesh: finMesh, matrix: matMult(mtxTranslation(-0.55, Math.cos(fa) * 0.08, Math.sin(fa) * 0.08), mtxRotX(fa)) });
        }
        kids.push({ children: miss, matrix: mtxTranslation(-0.95, py, pz * s) });
      }
    }
    kids.push(boxNode(0.05, 0.05, 0.06, 'green', -0.95, -0.30, 2.68 * s));
  }
  return kids;
}

function tailBoomFin(): GltfNodeSpec[] {
  const kids: GltfNodeSpec[] = [];
  // Tapered tail boom: thick at fuselage (x=-2.6, R=0.44), slender at tail (x=-7.2, R=0.24)
  kids.push(cylNode(0.24, 4.6, 'airframe', -4.9, 0.06, 0, 'x', 0.44));
  kids.push(cylNode(0.14, 4.3, 'airframe', -4.85, 0.44, 0, 'x'));
  for (const xr of [-3.10, -4.00, -4.90, -5.80, -6.40]) {
    kids.push(torusNode(0.145, 0.010, 'graphite', xr, 0.44, 0, 0, Math.PI / 2, 0));
  }
  // Flush access hatches conforming to the local radius of the tapered boom
  for (const s of [1, -1]) {
    kids.push(boxNode(0.42, 0.20, 0.010, 'panel', -3.60, 0.10, 0.39 * s));
    kids.push(boxNode(0.42, 0.20, 0.010, 'panel', -5.10, 0.10, 0.33 * s));
    kids.push(boxNode(0.28, 0.16, 0.010, 'panel', -4.20, 0.28, 0.36 * s));
    kids.push(boxNode(0.02, 0.14, 0.05, 'graphite', -3.20, 0.20, 0.40 * s));
    kids.push(boxNode(0.02, 0.14, 0.05, 'graphite', -5.60, 0.18, 0.31 * s));
  }
  kids.push(boxNode(0.02, 0.30, 0.06, 'graphite', -4.20, -0.20, 0));
  kids.push(boxNode(0.03, 0.04, 0.07, 'titanium', -4.20, -0.34, 0));

  // Snug warning stripe at x = -6.55 (local boom radius ~0.268)
  kids.push(cylNode(0.272, 0.10, 'warn', -6.55, 0.06, 0, 'x'));
  kids.push(boxNode(0.14, 0.04, 0.04, 'green', -3.85, 0.06, 0.385));
  kids.push(boxNode(0.14, 0.04, 0.04, 'red', -3.85, 0.06, -0.385));

  // Horizontal stabilator
  kids.push(boxNode(0.9, 0.08, 2.9, 'airframe', -6.55, -0.12, 0));
  kids.push(boxNode(0.86, 0.010, 2.85, 'panel', -6.55, -0.075, 0));
  kids.push(boxNode(0.86, 0.008, 0.012, 'panel', -6.55, -0.075, 0.90));
  kids.push(boxNode(0.86, 0.008, 0.012, 'panel', -6.55, -0.075, -0.90));
  kids.push(boxNode(0.35, 0.20, 0.30, 'titanium', -6.40, -0.22, 0));
  kids.push(tubeNode([-6.20, -0.20, 0], [-5.85, -0.15, 0], 0.030, 'steel', 8));

  // Vertical fin: centered at Z = 0
  const finShape: [number, number][] = [
    [-5.62, 0.30], [-6.12, 2.05], [-7.02, 2.05], [-7.02, 0.16], [-6.28, -0.04],
  ];
  kids.push(prismNode(finShape, 0.16, 'airframe', 0, -0.1, 0));
  kids.push(tubeNode([-5.66, 0.22, 0], [-6.15, 1.98, 0], 0.032, 'graphite', 8));
  for (const s of [1, -1]) {
    kids.push(boxNode(0.70, 0.010, 0.012, 'panel', -6.55, 0.80, 0.082 * s));
    kids.push(boxNode(0.90, 0.010, 0.012, 'panel', -6.55, 1.40, 0.082 * s));
  }
  kids.push(boxNode(0.10, 0.06, 0.18, 'titanium', -6.57, 2.08, 0));

  // Tail rotor gearbox: firmly connects vertical fin (z=0) to tail rotor hub (z=0.24)
  kids.push(boxNode(0.28, 0.44, 0.32, 'titanium', -6.40, 1.36, 0.10));

  // Tail skid strut (steel tube) + bumper
  kids.push(tubeNode([-6.65, -0.15, 0], [-7.10, -0.42, 0], 0.030, 'steel', 8));
  kids.push(boxNode(0.14, 0.04, 0.06, 'graphite', -7.10, -0.42, 0));
  kids.push(boxNode(0.05, 0.05, 0.06, 'red', -5.85, 0.35, 0.082));

  return kids;
}

function longbowRadome(): GltfNodeSpec {
  const kids: GltfNodeSpec[] = [];
  // Mast & collar below radome drum (origin is radome drum center y = 3.02)
  kids.push(cylNode(0.095, 0.66, 'titanium', 0, -0.42, 0, 'y', 0.115));
  kids.push(cylNode(0.16, 0.08, 'graphite', 0, -0.71, 0));
  // APG-78 Longbow Radar drum
  kids.push(cylNode(0.58, 0.42, 'composite', 0, 0, 0));
  kids.push(torusNode(0.58, 0.030, 'graphite', 0, -0.21, 0, Math.PI / 2, 0, 0));
  // Radome upper tapered top (vertical cylinder tapering from 0.58 at bottom to 0.32 at top)
  kids.push(cylNode(0.32, 0.22, 'composite', 0, 0.32, 0, 'y', 0.58));
  kids.push(cylNode(0.32, 0.05, 'composite', 0, 0.46, 0));
  kids.push(torusNode(0.585, 0.014, 'graphite', 0, 0.12, 0, Math.PI / 2, 0, 0));
  kids.push(sphereNode(0.06, 'steel', 0, 0.50, 0));
  return { name: 'longbow', children: kids, matrix: mtxTranslation(-0.55, 3.02, 0) };
}

/* ═══════════════ ROOT ═══════════════ */
let cache: string | null = null;

/** Root permutation mapping our authored axes (nose=+X, up=+Y, right=+Z)
 *  into glTF model space. Cesium ModelUtility maps glTF (+X, +Y, +Z)
 *  to Cesium ENU model space (+Z, +X, +Y) via Y_UP_TO_Z_UP * Z_UP_TO_X_UP.
 *  Thus authored nose (+X) maps to Cesium +Y (North/forward), authored up (+Y)
 *  maps to Cesium +Z (Up), and authored right (+Z) maps to Cesium +X (East/right).
 *  Identity aligns perfectly with Cesium's headingPitchRollToFixedFrame. */
const AXIS_FIX: M4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** Returns a self-contained binary glTF data-URI of the Apache. */
export function getApacheGltf(): string {
  if (cache) return cache;
  const inner: GltfNodeSpec[] = [
    { children: fuselage(), name: 'airframe' },
    { children: rotorMast(), name: 'rotorMast' },
    { children: noseSights(), matrix: mtxTranslation(4.25, -0.34, 0), name: 'noseSights' },
    { children: gunAssembly(), matrix: mtxTranslation(2.85, -1.20, 0), name: 'gun' },
    { children: [...landingGear(1), ...landingGear(-1)], name: 'landingGear' },
    { children: tailWheel(), name: 'tailWheel' },
    { children: enginesAndWeapons(), name: 'enginesWeapons' },
    { children: tailBoomFin(), name: 'tail' },
    longbowRadome(),
    { children: [...canopyFrames(), ...cockpitInterior(), ...buildCanopyShell()], name: 'canopy' },
    mainRotorHead(),
    tailRotorHead(),
  ];
const root: GltfNodeSpec[] = [{ name: 'modelFrame', matrix: AXIS_FIX, children: inner }];
  g.registerNodes(root);

  const compiled = g.build({ preserveNodeNames: new Set(['mainRotor', 'tailRotor']) });
  if (import.meta.env?.DEV) {
    const names = [...compiled.nodeMap.keys()];
    if (!names.includes('mainRotor')) console.warn('[Apache] mainRotor node missing');
    if (!names.includes('tailRotor')) console.warn('[Apache] tailRotor node missing');
  }
  cache = compiled.dataUri;
  return cache;
}

/** Reset cached binary glTF data URI (useful for test suites and dynamic updates). */
export function resetApacheGltfCache(): void {
  cache = null;
}

/** Real-size scale for the Apache in the globe. The model spans ~13 units
 *  nose-to-tail; at 1.35 that is 17.5 m (true AH-64E length) with a 14.7 m
 *  rotor disc — matching the real 17.5 × 14.65 m airframe. */
export const APACHE_MODEL_SCALE = 1.35;