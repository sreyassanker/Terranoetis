/**
 * Tesla Roadster (2nd Generation) with SpaceX Thruster Flight Package.
 *
 * Ultra-realistic procedural binary glTF reconstruction faithful to the official
 * Tesla Roadster (https://www.tesla.com/en_in/roadster) and reference images:
 * - Signature Multi-Coat Ultra Red metallic candy clearcoat finish.
 * - Solid, cohesive aerodynamic fuselage: low shark nose, continuous sculpted hood,
 *   twin muscular front fender haunches, pinched Coke-bottle waist, and voluptuous rear hips.
 * - Enclosed inner wheel wells and full carbon-fiber ground-effect undertray (zero gaps).
 * - Continuous edge-to-edge curved LED taillight blade & razor front LED DRL light strips.
 * - Seamless panoramic curved solar-tinted glass canopy (Coupe) / open-air convertible cockpit (Targa).
 * - Hyper-realistic Ultra-White bolstered racing bucket seats, center console spine,
 *   glowing 17" portrait touchscreen, and steer-by-wire aerospace racing yoke.
 * - 4x directional forged turbine alloy wheels with Michelin Pilot Sport rubber,
 *   machined diamond-cut outer lip, drilled carbon-ceramic rotors, and gloss-red Brembo calipers.
 * - Dynamic scene-graph nodes ('wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr') for 60 FPS
 *   spinning and front-wheel steering.
 * - Dual rear titanium SpaceX cold-gas rocket thruster bells, 4 underbody hover thrusters,
 *   and dual internal 10,000 PSI COPV composite tanks.
 *
 * Coordinate Convention (glTF Standard):
 * Forward = +X, Up = +Y, Right = +Z.
 * Bottom of tires touches ground at Y = 0.00.
 */

import {
  GltfBuilder,
  buildBoxMesh,
  buildCylinderMesh,
  buildSphereMesh,
  buildTorusMesh,
  buildContinuousTubeMesh,
  buildConeMesh,
  type GltfMaterialSpec,
  type GltfNodeSpec,
} from './gltfBuilder';
import {
  mtxTR,
  mtxTranslation,
  mtxRotX,
  mtxRotZ,
  matMult,
  type M4,
} from './m4';

/* ═══════════════ WHEEL PIVOT ANCHORS ═══════════════ */
export const WHEEL_PIVOT_FL: [number, number, number] = [ 0.585, 0.1852,  0.961];
export const WHEEL_PIVOT_FR: [number, number, number] = [-0.585, 0.1852,  0.961];
export const WHEEL_PIVOT_RL: [number, number, number] = [ 0.585, 0.1979, -0.951];
export const WHEEL_PIVOT_RR: [number, number, number] = [-0.585, 0.1979, -0.951];

/* ═══════════════ MATERIALS & SHADERS ═══════════════ */

const MATERIALS = {
  // Tesla Signature Multi-Coat Ultra Red (candy metallic with high-gloss clearcoat)
  paintRed: {
    base: [0.82, 0.04, 0.07],
    metallic: 0.92,
    roughness: 0.12,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Deep shadow red for recessed aero channels and door cuts
  paintShadow: {
    base: [0.38, 0.02, 0.04],
    metallic: 0.85,
    roughness: 0.22,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Gloss Aero Carbon Fiber (splitter, skirts, diffuser, spoiler, louvres)
  carbonFiber: {
    base: [0.032, 0.035, 0.040],
    metallic: 0.60,
    roughness: 0.20,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Panoramic Solar-Tinted Glass Canopy
  glassTint: {
    base: [0.06, 0.10, 0.14],
    metallic: 0.35,
    roughness: 0.02,
    opacity: 0.40,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Dark blackout ceramic frit border
  glassTrim: {
    base: [0.015, 0.018, 0.022],
    metallic: 0.40,
    roughness: 0.10,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Signature Front Headlight DRL & LED Projectors
  headlightLED: {
    base: [0.96, 0.98, 1.0],
    emissive: [1.0, 1.0, 1.0],
    emissiveIntensity: 5.0,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Smoked inner headlight housing
  headlightHousing: {
    base: [0.025, 0.035, 0.045],
    metallic: 0.85,
    roughness: 0.18,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Signature Edge-to-Edge Rear LED Light Blade (Roadster hallmark)
  taillightLED: {
    base: [0.98, 0.02, 0.02],
    emissive: [1.0, 0.04, 0.04],
    emissiveIntensity: 6.0,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Soft ambient taillight glow casing
  taillightGlow: {
    base: [0.65, 0.01, 0.01],
    emissive: [0.85, 0.02, 0.02],
    emissiveIntensity: 2.6,
    doubleSided: true,
  } as GltfMaterialSpec,

  // High-performance Michelin Pilot Sport tire rubber
  tireRubber: {
    base: [0.045, 0.045, 0.050],
    metallic: 0.02,
    roughness: 0.90,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Satin dark charcoal forged turbine alloy wheels
  alloyRim: {
    base: [0.14, 0.15, 0.17],
    metallic: 0.95,
    roughness: 0.18,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Diamond-cut machined aluminum rim lip highlight
  alloyLip: {
    base: [0.92, 0.94, 0.96],
    metallic: 0.98,
    roughness: 0.08,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Carbon-ceramic cross-drilled brake rotor
  brakeRotor: {
    base: [0.42, 0.44, 0.46],
    metallic: 0.92,
    roughness: 0.28,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Tesla performance Brembo brake caliper (gloss red)
  brakeCaliper: {
    base: [0.94, 0.03, 0.03],
    metallic: 0.45,
    roughness: 0.16,
    doubleSided: true,
  } as GltfMaterialSpec,

  // SpaceX COPV Composite Tank Shell
  copvTank: {
    base: [0.08, 0.10, 0.12],
    metallic: 0.65,
    roughness: 0.35,
    doubleSided: true,
  } as GltfMaterialSpec,

  // SpaceX Thruster Blue Illuminated Collar
  copvGlow: {
    base: [0.10, 0.45, 0.95],
    emissive: [0.20, 0.70, 1.0],
    emissiveIntensity: 3.0,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Titanium Rocket Nozzle Bells
  thrusterNozzle: {
    base: [0.22, 0.24, 0.28],
    metallic: 0.96,
    roughness: 0.14,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Supersonic Cold-Gas Plasma Core Glow
  thrusterCore: {
    base: [0.40, 0.85, 1.0],
    emissive: [0.45, 0.90, 1.0],
    emissiveIntensity: 4.0,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Luminous electric-cyan SpaceX cold-gas thruster exhaust plumes
  thrusterPlume: {
    base: [0.25, 0.80, 1.0],
    emissive: [0.40, 0.92, 1.0],
    emissiveIntensity: 7.0,
    roughness: 0.08,
    opacity: 0.68,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Tesla signature Ultra-White vegan leather interior
  interiorWhite: {
    base: [0.96, 0.97, 0.98],
    metallic: 0.02,
    roughness: 0.55,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Dark Alcantara cabin floor, bulkhead & dash
  interiorDark: {
    base: [0.04, 0.05, 0.06],
    metallic: 0.08,
    roughness: 0.85,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Floating portrait 17" center touchscreen display
  interiorScreen: {
    base: [0.03, 0.15, 0.26],
    emissive: [0.22, 0.70, 1.0],
    emissiveIntensity: 3.2,
    doubleSided: true,
  } as GltfMaterialSpec,

  // Chrome Badges & Emblems
  chrome: {
    base: [0.95, 0.96, 0.98],
    metallic: 0.98,
    roughness: 0.05,
    doubleSided: true,
  } as GltfMaterialSpec,
} as const;

type Mat = keyof typeof MATERIALS;

let cachedRoadsterCoupeUri: string | null = null;
let cachedRoadsterTargaUri: string | null = null;
let cachedRoadsterCoupePlumeUri: string | null = null;
let cachedRoadsterTargaPlumeUri: string | null = null;

export interface RoadsterModelOptions {
  targaOpen?: boolean;
  showThrusterPlumes?: boolean;
}

/**
 * Builds the complete ultra-realistic Tesla Roadster binary glTF data URI.
 */
export function getTeslaRoadsterGltf(options?: RoadsterModelOptions): string {
  const isTarga = !!options?.targaOpen;
  const isPlume = !!options?.showThrusterPlumes;

  // Browser runtime: stream the high-fidelity GLBs from public/models/
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    if (isTarga && isPlume) return '/models/roadster_targa_fire.glb';
    if (isTarga && !isPlume) return '/models/roadster_targa.glb';
    if (!isTarga && isPlume) return '/models/roadster_coupe_fire.glb';
    return '/models/roadster_coupe.glb';
  }


  if (!isTarga && !isPlume && cachedRoadsterCoupeUri) return cachedRoadsterCoupeUri;
  if (isTarga && !isPlume && cachedRoadsterTargaUri) return cachedRoadsterTargaUri;
  if (!isTarga && isPlume && cachedRoadsterCoupePlumeUri) return cachedRoadsterCoupePlumeUri;
  if (isTarga && isPlume && cachedRoadsterTargaPlumeUri) return cachedRoadsterTargaPlumeUri;

  const builder = new GltfBuilder(false);

  function box(w: number, h: number, d: number, mat: Mat, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): GltfNodeSpec {
    const mesh = builder.addMesh(buildBoxMesh(w, h, d), MATERIALS[mat]);
    return { mesh, matrix: mtxTR(x, y, z, rx, ry, rz) };
  }

  function cylinder(r: number, len: number, mat: Mat, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', rBottom = r): GltfNodeSpec {
    const mesh = builder.addMesh(buildCylinderMesh(r, len / 2, 24, rBottom), MATERIALS[mat]);
    let m: M4;
    if (axis === 'x') m = matMult(mtxTranslation(x, y, z), mtxRotZ(Math.PI / 2));
    else if (axis === 'z') m = matMult(mtxTranslation(x, y, z), mtxRotX(Math.PI / 2));
    else m = mtxTranslation(x, y, z);
    return { mesh, matrix: m };
  }

  function sphere(r: number, mat: Mat, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): GltfNodeSpec {
    const mesh = builder.addMesh(buildSphereMesh(r, 16, 20), MATERIALS[mat]);
    return { mesh, matrix: mtxTR(x, y, z, rx, ry, rz) };
  }

  function torus(r: number, tubeRadius: number, mat: Mat, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): GltfNodeSpec {
    const mesh = builder.addMesh(buildTorusMesh(r, tubeRadius, 14, 28), MATERIALS[mat]);
    return { mesh, matrix: mtxTR(x, y, z, rx, ry, rz) };
  }

  function tube(pts: [number, number, number][], radius: number, mat: Mat, radialSeg = 10): GltfNodeSpec {
    const mesh = builder.addMesh(buildContinuousTubeMesh(pts, radius, radialSeg), MATERIALS[mat]);
    return { mesh, matrix: mtxTranslation(0, 0, 0) };
  }

  function cone(r: number, h: number, mat: Mat, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): GltfNodeSpec {
    const mesh = builder.addMesh(buildConeMesh(r, h, 18), MATERIALS[mat]);
    return { mesh, matrix: mtxTR(x, y, z, rx, ry, rz) };
  }

  function loftMesh(grid: [number, number, number][][], mat: Mat, flip = false): GltfNodeSpec {
    const uCount = grid.length;
    const vCount = grid[0].length;
    const pos: number[] = [];
    const idx: number[] = [];

    for (let u = 0; u < uCount; u++) {
      for (let v = 0; v < vCount; v++) {
        const pt = grid[u][v];
        pos.push(pt[0], pt[1], pt[2]);
      }
    }

    for (let u = 0; u < uCount - 1; u++) {
      for (let v = 0; v < vCount - 1; v++) {
        const a = u * vCount + v;
        const b = (u + 1) * vCount + v;
        const c = u * vCount + (v + 1);
        const d = (u + 1) * vCount + (v + 1);
        if (!flip) {
          idx.push(a, b, c, c, b, d);
        } else {
          idx.push(a, c, b, c, d, b);
        }
      }
    }

    const mesh = builder.addMesh({ pos, idx }, MATERIALS[mat]);
    return { mesh, matrix: mtxTranslation(0, 0, 0) };
  }

  const nodes: GltfNodeSpec[] = [];

  /* ═══════════════ 1. UNDERBODY FLAT TRAY & HOVER THRUSTERS ═══════════════ */
  // Full-length aerodynamic carbon-fiber ground effect undertray
  nodes.push(box(4.45, 0.04, 1.94, 'carbonFiber', 0.0, 0.10, 0));
  // Central structural 200 kWh battery pack casing
  nodes.push(box(2.80, 0.08, 1.52, 'interiorDark', 0.0, 0.14, 0));

  // 4x Underbody Vertical SpaceX Cold-Gas Hover/Flight Thruster Nozzles
  const hoverThrusters: [number, number, number][] = [
    [ 1.38, 0.10,  0.46],
    [ 1.38, 0.10, -0.46],
    [-1.38, 0.10,  0.48],
    [-1.38, 0.10, -0.48],
  ];
  for (const [tx, ty, tz] of hoverThrusters) {
    nodes.push(cylinder(0.065, 0.04, 'thrusterNozzle', tx, ty, tz, 'y', 0.085));
    nodes.push(sphere(0.045, 'thrusterCore', tx, ty - 0.01, tz));
  }

  /* ═══════════════ 2. FRONT CARBON SPLITTER & LOWER AERO ═══════════════ */
  // Curved front carbon-fiber splitter lip hugging the ground (Matching Image 8 & 9)
  const splitterPts: [number, number, number][] = [];
  const splitterSteps = 22;
  for (let i = 0; i <= splitterSteps; i++) {
    const a = (i / splitterSteps - 0.5) * Math.PI * 0.90;
    const sx = 2.14 + 0.16 * Math.cos(a * 1.15);
    const sz = Math.sin(a) * 0.94;
    splitterPts.push([sx, 0.10, sz]);
  }
  nodes.push(tube(splitterPts, 0.024, 'carbonFiber', 10));
  nodes.push(box(0.36, 0.035, 1.80, 'carbonFiber', 2.12, 0.10, 0));

  // Lower aerodynamic radiator cooling intake duct
  nodes.push(box(0.18, 0.12, 1.18, 'carbonFiber', 2.08, 0.18, 0));
  nodes.push(box(0.04, 0.10, 1.14, 'interiorDark', 2.10, 0.18, 0));

  /* ═══════════════ 3. SCULPTED FRONT HOOD & MUSCULAR FRONT FENDERS ═══════════════
   * Front fuselage from shark nose tip (X = 2.22m) back to windshield cowl (X = 0.76m):
   * - Sweeping low shark nose prow
   * - Sunken center hood valley with twin extractor creases
   * - Voluptuous front fender humps arching over the front wheels to Z = ±0.96m!
   * - Outer fender flank rolling down to carbon side skirts.
   */
  const frontStations = [
    { x: 2.22, yRocker: 0.12, zRocker: 0.40, yMid: 0.20, zMid: 0.46, yShoulder: 0.24, zShoulder: 0.44, yTop: 0.25, zTop: 0.35, yCenter: 0.24 },
    { x: 2.12, yRocker: 0.11, zRocker: 0.74, yMid: 0.26, zMid: 0.80, yShoulder: 0.35, zShoulder: 0.78, yTop: 0.38, zTop: 0.60, yCenter: 0.34 },
    { x: 1.95, yRocker: 0.11, zRocker: 0.82, yMid: 0.32, zMid: 0.86, yShoulder: 0.44, zShoulder: 0.84, yTop: 0.48, zTop: 0.70, yCenter: 0.43 },
    { x: 1.68, yRocker: 0.11, zRocker: 0.86, yMid: 0.38, zMid: 0.94, yShoulder: 0.60, zShoulder: 0.96, yTop: 0.65, zTop: 0.84, yCenter: 0.50 },
    { x: 1.41, yRocker: 0.11, zRocker: 0.86, yMid: 0.40, zMid: 0.98, yShoulder: 0.66, zShoulder: 0.98, yTop: 0.69, zTop: 0.86, yCenter: 0.54 },
    { x: 1.08, yRocker: 0.11, zRocker: 0.84, yMid: 0.38, zMid: 0.92, yShoulder: 0.60, zShoulder: 0.90, yTop: 0.67, zTop: 0.84, yCenter: 0.60 },
    { x: 0.76, yRocker: 0.11, zRocker: 0.83, yMid: 0.37, zMid: 0.85, yShoulder: 0.58, zShoulder: 0.84, yTop: 0.66, zTop: 0.82, yCenter: 0.65 },
  ];

  const frontBodyGrid: [number, number, number][][] = [];
  for (const st of frontStations) {
    const ring: [number, number, number][] = [
      [st.x, st.yRocker, -st.zRocker],
      [st.x, st.yMid, -st.zMid],
      [st.x, st.yShoulder, -st.zShoulder],
      [st.x, st.yTop, -st.zTop],
      [st.x, (st.yTop + st.yCenter) * 0.5 - 0.02, -st.zTop * 0.55],
      [st.x, st.yCenter, 0.0],
      [st.x, (st.yTop + st.yCenter) * 0.5 - 0.02, st.zTop * 0.55],
      [st.x, st.yTop, st.zTop],
      [st.x, st.yShoulder, st.zShoulder],
      [st.x, st.yMid, st.zMid],
      [st.x, st.yRocker, st.zRocker],
    ];
    frontBodyGrid.push(ring);
  }
  nodes.push(loftMesh(frontBodyGrid, 'paintRed', false));

  // Front Nose Cap Prow closing the nose
  const noseSt = frontStations[0];
  nodes.push(box(0.08, noseSt.yTop - noseSt.yRocker, noseSt.zRocker * 2, 'paintRed', noseSt.x + 0.02, (noseSt.yTop + noseSt.yRocker) * 0.5, 0));

  // Chrome Tesla 'T' Emblem on Front Prow (Image 9)
  nodes.push(box(0.045, 0.012, 0.075, 'chrome', 2.16, 0.31, 0));
  nodes.push(box(0.065, 0.010, 0.018, 'chrome', 2.14, 0.30, 0));

  /* ═══════════════ 4. DOORS & PINCHED COKE-BOTTLE WAIST FLANKS ═══════════════
   * Side doors from cowl (X = 0.76m) back to rear intake (X = -0.85m).
   * Leaves the central cockpit open for the seats, yoke, and console!
   */
  for (const s of [1, -1]) {
    const doorStations = [
      { x:  0.76, yRocker: 0.11, zRocker: 0.83, yMid: 0.37, zMid: 0.85, ySill: 0.66, zSill: 0.82, zInner: 0.62 },
      { x:  0.20, yRocker: 0.11, zRocker: 0.82, yMid: 0.37, zMid: 0.79, ySill: 0.65, zSill: 0.81, zInner: 0.60 },
      { x: -0.30, yRocker: 0.11, zRocker: 0.83, yMid: 0.37, zMid: 0.81, ySill: 0.66, zSill: 0.83, zInner: 0.60 },
      { x: -0.85, yRocker: 0.11, zRocker: 0.84, yMid: 0.38, zMid: 0.86, ySill: 0.68, zSill: 0.87, zInner: 0.64 },
    ];

    const doorGrid: [number, number, number][][] = [];
    for (const d of doorStations) {
      const ring: [number, number, number][] = [
        [d.x, d.yRocker, d.zRocker * s],
        [d.x, d.yMid, d.zMid * s],
        [d.x, d.ySill, d.zSill * s],
        [d.x, d.ySill - 0.02, d.zInner * s],
      ];
      doorGrid.push(ring);
    }
    nodes.push(loftMesh(doorGrid, 'paintRed', s < 0));

    // Gloss carbon-fiber ground-effect side skirts running under doors
    nodes.push(box(2.45, 0.045, 0.08, 'carbonFiber', 0.02, 0.11, 0.88 * s));

    // Digital rearview side-camera repeater pod (flush on front fender)
    nodes.push(box(0.12, 0.032, 0.045, 'carbonFiber', 0.86, 0.65, 0.85 * s));
    nodes.push(sphere(0.015, 'headlightHousing', 0.89, 0.65, 0.87 * s));
  }

  /* ═══════════════ 5. REAR HAUNCHES, DECK LID & DUCKTAIL SPOILER ═══════════════
   * Rear fuselage from rear intake (X = -0.85m) back to active ducktail (X = -2.18m):
   * - Swelling muscular rear haunches arching out to Z = ±1.00m over wide 325 rear tires!
   * - Rear deck lid covering SpaceX tanks and motors
   * - Integrated active carbon-fiber ducktail spoiler & continuous taillight blade
   */
  const rearStations = [
    { x: -0.85, yRocker: 0.11, zRocker: 0.84, yMid: 0.38, zMid: 0.88, yShoulder: 0.62, zShoulder: 0.90, yTop: 0.70, zTop: 0.88, yCenter: 0.68 },
    { x: -1.15, yRocker: 0.11, zRocker: 0.85, yMid: 0.40, zMid: 0.95, yShoulder: 0.66, zShoulder: 0.97, yTop: 0.74, zTop: 0.92, yCenter: 0.70 },
    { x: -1.41, yRocker: 0.11, zRocker: 0.86, yMid: 0.42, zMid: 0.98, yShoulder: 0.68, zShoulder: 1.00, yTop: 0.76, zTop: 0.94, yCenter: 0.72 },
    { x: -1.78, yRocker: 0.11, zRocker: 0.86, yMid: 0.42, zMid: 0.95, yShoulder: 0.68, zShoulder: 0.96, yTop: 0.76, zTop: 0.90, yCenter: 0.74 },
    { x: -2.08, yRocker: 0.12, zRocker: 0.84, yMid: 0.44, zMid: 0.90, yShoulder: 0.68, zShoulder: 0.90, yTop: 0.80, zTop: 0.86, yCenter: 0.78 },
    { x: -2.18, yRocker: 0.14, zRocker: 0.82, yMid: 0.44, zMid: 0.86, yShoulder: 0.66, zShoulder: 0.86, yTop: 0.76, zTop: 0.82, yCenter: 0.75 },
  ];

  const rearBodyGrid: [number, number, number][][] = [];
  for (const st of rearStations) {
    const ring: [number, number, number][] = [
      [st.x, st.yRocker, -st.zRocker],
      [st.x, st.yMid, -st.zMid],
      [st.x, st.yShoulder, -st.zShoulder],
      [st.x, st.yTop, -st.zTop],
      [st.x, (st.yTop + st.yCenter) * 0.5 - 0.01, -st.zTop * 0.55],
      [st.x, st.yCenter, 0.0],
      [st.x, (st.yTop + st.yCenter) * 0.5 - 0.01, st.zTop * 0.55],
      [st.x, st.yTop, st.zTop],
      [st.x, st.yShoulder, st.zShoulder],
      [st.x, st.yMid, st.zMid],
      [st.x, st.yRocker, st.zRocker],
    ];
    rearBodyGrid.push(ring);
  }
  nodes.push(loftMesh(rearBodyGrid, 'paintRed', false));

  // Solid Rear Transom Bumper Face closing off the tail
  const tailSt = rearStations[rearStations.length - 1];
  nodes.push(box(0.12, tailSt.yTop - tailSt.yRocker, tailSt.zRocker * 2, 'paintRed', tailSt.x - 0.02, (tailSt.yTop + tailSt.yRocker) * 0.5, 0));
  nodes.push(box(0.08, 0.16, tailSt.zRocker * 1.8, 'paintShadow', tailSt.x - 0.03, 0.38, 0));

  /* ═══════════════ 6. SIGNATURE FRONT HEADLIGHTS & AIR CURTAINS ═══════════════ */
  for (const s of [1, -1]) {
    // Sharp razor DRL LED blade curving precisely along front fender crease
    const drlPts: [number, number, number][] = [
      [1.78, 0.50, 0.78 * s],
      [1.94, 0.46, 0.81 * s],
      [2.08, 0.40, 0.77 * s],
      [2.15, 0.34, 0.64 * s],
    ];
    nodes.push(tube(drlPts, 0.012, 'headlightLED', 8));

    // Smoked inner projector housing with jewel LED lenses
    nodes.push(box(0.24, 0.065, 0.12, 'headlightHousing', 1.96, 0.43, 0.75 * s, 0, 0.12 * s, -0.14));
    nodes.push(cylinder(0.022, 0.04, 'headlightLED', 1.96, 0.43, 0.74 * s, 'x'));
    nodes.push(cylinder(0.022, 0.04, 'headlightLED', 2.03, 0.41, 0.76 * s, 'x'));

    // Vertical aerodynamic air-curtain slit dropping down the bumper corner
    const airCurtainPts: [number, number, number][] = [
      [2.10, 0.34, 0.82 * s],
      [2.08, 0.24, 0.84 * s],
      [2.04, 0.14, 0.85 * s],
    ];
    nodes.push(tube(airCurtainPts, 0.016, 'carbonFiber', 8));
  }

  /* ═══════════════ 7. SIGNATURE FULL-WIDTH EDGE-TO-EDGE LED TAILLIGHT ═══════════════ */
  const taillightPts: [number, number, number][] = [
    [-2.02, 0.66, -0.90],
    [-2.09, 0.73, -0.84],
    [-2.14, 0.76, -0.56],
    [-2.16, 0.77,  0.00],
    [-2.14, 0.76,  0.56],
    [-2.09, 0.73,  0.84],
    [-2.02, 0.66,  0.90],
  ];
  nodes.push(tube(taillightPts, 0.016, 'taillightLED', 10));
  nodes.push(tube(taillightPts, 0.024, 'taillightGlow', 8));

  // Lower rear red reflectors
  nodes.push(box(0.04, 0.035, 0.24, 'taillightLED', -2.13, 0.38,  0.64));
  nodes.push(box(0.04, 0.035, 0.24, 'taillightLED', -2.13, 0.38, -0.64));

  /* ═══════════════ 8. CARBON REAR DIFFUSER & SPACEX THRUSTER MATRIX ═══════════════ */
  // Massive carbon fiber rear aerodynamic diffuser with venturi tunnels
  nodes.push(box(0.42, 0.05, 1.78, 'carbonFiber', -2.08, 0.13, 0, 0, 0, -0.16));
  // 4x vertical aerodynamic guide strakes/fins
  const diffuserFins = [-0.60, -0.20, 0.20, 0.60];
  for (const fz of diffuserFins) {
    nodes.push(box(0.38, 0.16, 0.025, 'carbonFiber', -2.09, 0.18, fz, 0, 0, -0.16));
  }

  // Dual Rear SpaceX Cold-Gas Rocket Thruster Nozzles
  for (const s of [1, -1]) {
    nodes.push(cylinder(0.055, 0.08, 'thrusterNozzle', -2.16, 0.44, 0.16 * s, 'x', 0.075));
    nodes.push(sphere(0.035, 'thrusterCore', -2.15, 0.44, 0.16 * s));
  }
  // SpaceX carbon badge
  nodes.push(box(0.02, 0.04, 0.18, 'carbonFiber', -2.15, 0.44, 0));

  // SpaceX Cold-Gas Exhaust Thruster Plumes (when firing/flying)
  if (options?.showThrusterPlumes) {
    // 4 Underbody vertical lift plumes (hover / flight)
    for (const [hx, , hz] of hoverThrusters) {
      nodes.push(cylinder(0.045, 0.42, 'thrusterPlume', hx, -0.16, hz, 'y'));
      nodes.push(cone(0.065, 0.32, 'thrusterCore', hx, -0.12, hz, Math.PI, 0, 0));
    }
    // 2 Rear rocket booster exhaust plumes
    for (const s of [1, -1]) {
      nodes.push(cylinder(0.05, 0.58, 'thrusterPlume', -2.44, 0.44, 0.16 * s, 'x'));
      nodes.push(cone(0.07, 0.40, 'thrusterCore', -2.36, 0.44, 0.16 * s, 0, 0, -Math.PI / 2));
    }
  }

  /* ═══════════════ 9. INTERNAL FIREWALL & SPACEX COPV 10,000 PSI TANKS ═══════════════ */
  // Solid carbon bulkhead completely isolating passenger cockpit from rear propulsion bay
  nodes.push(box(0.08, 0.74, 1.42, 'interiorDark', -0.88, 0.54, 0));

  // Dual SpaceX COPV Composite 10,000 PSI Air Tanks (visible under fastback glass)
  for (const s of [1, -1]) {
    const copvX = -1.24, copvY = 0.56, copvZ = 0.34 * s;
    nodes.push(cylinder(0.16, 0.58, 'copvTank', copvX, copvY, copvZ, 'x'));
    nodes.push(sphere(0.16, 'copvTank', copvX + 0.29, copvY, copvZ));
    nodes.push(sphere(0.16, 'copvTank', copvX - 0.29, copvY, copvZ));
    // High-pressure illuminated telemetry collars
    nodes.push(torus(0.165, 0.015, 'copvGlow', copvX, copvY, copvZ, 0, Math.PI / 2, 0));
    nodes.push(torus(0.165, 0.015, 'copvGlow', copvX + 0.18, copvY, copvZ, 0, Math.PI / 2, 0));
    nodes.push(cylinder(0.024, 0.44, 'thrusterNozzle', copvX - 0.34, copvY, copvZ, 'x'));
  }

  /* ═══════════════ 10. COCKPIT & SEAMLESS PANORAMIC GLASS CANOPY ═══════════════ */
  const targaOpen = !!options?.targaOpen;
  if (!targaOpen) {
    // Full Coupe: Continuous double-curved aerodynamic glass canopy (Matching Image 8)
    // from cowl (X = +0.76m) over roof apex (X = -0.15m, Y = 1.18m) down to fastback deck (X = -1.72m)
    const canopyGrid: [number, number, number][][] = [];
    const canopyXSteps = 24;
    const canopyZSteps = 14;
    for (let i = 0; i <= canopyXSteps; i++) {
      const u = i / canopyXSteps; // 0 = cowl, 0.37 = roof apex, 1.0 = rear deck
      const x = 0.76 - 2.48 * u;

      let baseY = 0;
      if (u < 0.37) {
        const t = u / 0.37;
        baseY = 0.65 + 0.53 * Math.sin(t * Math.PI * 0.5);
      } else {
        const t = (u - 0.37) / 0.63;
        baseY = 1.18 - 0.46 * (t * t);
      }

      const halfW = 0.64 + 0.12 * (1 - Math.sin(u * Math.PI));

      const row: [number, number, number][] = [];
      for (let j = 0; j <= canopyZSteps; j++) {
        const v = (j / canopyZSteps) * 2 - 1;
        const z = v * halfW;
        const crown = Math.cos(v * Math.PI * 0.5) * 0.052;
        row.push([x, baseY + crown, z]);
      }
      canopyGrid.push(row);
    }
    nodes.push(loftMesh(canopyGrid, 'glassTint', false));
  } else {
    // Targa Open-Top Convertible: Removable glass roof stowed in trunk (Matching Image 9)
    // 1. Front Raked Panoramic Windshield
    const wsGrid: [number, number, number][][] = [];
    const wsSteps = 10;
    const canopyZSteps = 14;
    for (let i = 0; i <= wsSteps; i++) {
      const u = (i / wsSteps) * 0.28;
      const x = 0.76 - 2.48 * u;
      const t = u / 0.37;
      const baseY = 0.65 + 0.53 * Math.sin(t * Math.PI * 0.5);
      const halfW = 0.64 + 0.12 * (1 - Math.sin(u * Math.PI));
      const row: [number, number, number][] = [];
      for (let j = 0; j <= canopyZSteps; j++) {
        const v = (j / canopyZSteps) * 2 - 1;
        const z = v * halfW;
        const crown = Math.cos(v * Math.PI * 0.5) * 0.052;
        row.push([x, baseY + crown, z]);
      }
      wsGrid.push(row);
    }
    nodes.push(loftMesh(wsGrid, 'glassTint', false));

    // 2. Rear Fastback Engine/Battery Glass Hatch
    const rearGlassGrid: [number, number, number][][] = [];
    const rhSteps = 12;
    for (let i = 0; i <= rhSteps; i++) {
      const u = 0.58 + (i / rhSteps) * 0.42;
      const x = 0.76 - 2.48 * u;
      const t = (u - 0.37) / 0.63;
      const baseY = 1.18 - 0.46 * (t * t);
      const halfW = 0.64 + 0.12 * (1 - Math.sin(u * Math.PI));
      const row: [number, number, number][] = [];
      for (let j = 0; j <= canopyZSteps; j++) {
        const v = (j / canopyZSteps) * 2 - 1;
        const z = v * halfW;
        const crown = Math.cos(v * Math.PI * 0.5) * 0.052;
        row.push([x, baseY + crown, z]);
      }
      rearGlassGrid.push(row);
    }
    nodes.push(loftMesh(rearGlassGrid, 'glassTint', false));
  }

  // Aerodynamic carbon-fiber A-pillars, windshield header & roof side cantrails
  for (const s of [1, -1]) {
    const aPillarPts: [number, number, number][] = [
      [ 0.76, 0.65, 0.72 * s],
      [ 0.45, 0.90, 0.66 * s],
      [ 0.15, 1.10, 0.60 * s],
      [-0.15, 1.18, 0.58 * s],
      [-0.55, 1.13, 0.58 * s],
      [-0.98, 1.00, 0.60 * s],
      [-1.42, 0.84, 0.66 * s],
      [-1.76, 0.76, 0.70 * s],
    ];
    nodes.push(tube(aPillarPts, 0.026, 'carbonFiber', 10));
  }

  // Windshield top header bar
  nodes.push(box(0.06, 0.035, 1.18, 'carbonFiber', 0.06, 1.14, 0));
  // Windshield cowl base blackout glass trim
  nodes.push(box(0.08, 0.035, 1.48, 'glassTrim', 0.74, 0.64, 0));

  /* ═══════════════ 11. HYPER-REALISTIC COCKPIT INTERIOR (Image 9) ═══════════════ */
  // Minimalist Alcantara dashboard shelf running along cowl
  nodes.push(box(0.50, 0.06, 1.40, 'interiorDark', 0.50, 0.62, 0));
  // White accent dash trim ribbon
  nodes.push(box(0.04, 0.015, 1.36, 'interiorWhite', 0.46, 0.63, 0));
  // Interior cockpit floor carpet
  nodes.push(box(1.70, 0.04, 1.36, 'interiorDark', -0.10, 0.20, 0));

  // Twin Tesla Ultra-White Bolstered Front Racing Bucket Seats (Image 9)
  const seatPositions = [-0.34, 0.34];
  for (const sz of seatPositions) {
    const seatX = -0.15;
    const seatY = 0.26;
    // Ergonomic seat base cushion with thigh bolsters
    nodes.push(box(0.56, 0.10, 0.48, 'interiorWhite', seatX, seatY, sz));
    // High-back racing backrest with lateral kidney wings
    nodes.push(box(0.12, 0.62, 0.46, 'interiorWhite', seatX - 0.26, seatY + 0.32, sz, 0, 0, -0.24));
    // Sculpted aerodynamic headrest
    nodes.push(box(0.10, 0.18, 0.28, 'interiorWhite', seatX - 0.36, seatY + 0.68, sz, 0, 0, -0.20));
    // Lateral thigh bolsters
    nodes.push(box(0.46, 0.16, 0.06, 'interiorWhite', seatX, seatY + 0.12, sz + 0.23));
    nodes.push(box(0.46, 0.16, 0.06, 'interiorWhite', seatX, seatY + 0.12, sz - 0.23));
    // Shoulder wings
    nodes.push(box(0.12, 0.22, 0.08, 'interiorWhite', seatX - 0.24, seatY + 0.48, sz + 0.24, 0, 0.20, -0.24));
    nodes.push(box(0.12, 0.22, 0.08, 'interiorWhite', seatX - 0.24, seatY + 0.48, sz - 0.24, 0, -0.20, -0.24));
    // Dark harness pass-through slots
    nodes.push(box(0.04, 0.04, 0.12, 'interiorDark', seatX - 0.31, seatY + 0.58, sz));
  }

  // Rear 2+2 sculpted white bucket seats
  for (const rz of [-0.30, 0.30]) {
    nodes.push(box(0.44, 0.10, 0.40, 'interiorWhite', -0.76, 0.32, rz));
    nodes.push(box(0.10, 0.46, 0.38, 'interiorWhite', -0.86, 0.54, rz, 0, 0, -0.20));
  }

  // Floating 17-inch curved center touchscreen display glowing with Tesla OS navigation
  nodes.push(box(0.04, 0.36, 0.26, 'interiorScreen', 0.26, 0.54, 0, 0, 0, -0.40));
  // Central white floating console bridge between the seats
  nodes.push(box(0.92, 0.12, 0.22, 'interiorDark', -0.02, 0.34, 0));
  nodes.push(box(0.86, 0.025, 0.20, 'interiorWhite', -0.02, 0.41, 0));

  // Steer-by-wire aerospace racing yoke (driver side at Z = -0.34m)
  const yokeX = 0.28, yokeY = 0.63, yokeZ = -0.34;
  nodes.push(cylinder(0.022, 0.18, 'interiorDark', yokeX + 0.08, yokeY - 0.04, yokeZ, 'x'));
  nodes.push(box(0.03, 0.08, 0.26, 'interiorDark', yokeX, yokeY, yokeZ));
  nodes.push(torus(0.12, 0.016, 'interiorDark', yokeX, yokeY, yokeZ, 0, Math.PI / 2, 0));
  nodes.push(cylinder(0.028, 0.012, 'chrome', yokeX - 0.01, yokeY, yokeZ, 'x'));

  // Dual A-Pillar Digital Rearview Display Screens
  for (const s of [1, -1]) {
    nodes.push(box(0.02, 0.09, 0.065, 'interiorScreen', 0.42, 0.74, 0.62 * s, 0, 0.22 * s, 0));
  }

  // Brake Calipers on Chassis (Mounted at wheel positions)
  // Staying on chassis ensures calipers stay upright while rotors spin!
  for (const [whX, whY, whZ, side, rotorR, w] of [
    [WHEEL_PIVOT_FL[0], WHEEL_PIVOT_FL[1], WHEEL_PIVOT_FL[2], -1, 0.345 * 0.72 * 0.82, 0.26],
    [WHEEL_PIVOT_FR[0], WHEEL_PIVOT_FR[1], WHEEL_PIVOT_FR[2],  1, 0.345 * 0.72 * 0.82, 0.26],
    [WHEEL_PIVOT_RL[0], WHEEL_PIVOT_RL[1], WHEEL_PIVOT_RL[2], -1, 0.360 * 0.72 * 0.82, 0.32],
    [WHEEL_PIVOT_RR[0], WHEEL_PIVOT_RR[1], WHEEL_PIVOT_RR[2],  1, 0.360 * 0.72 * 0.82, 0.32],
  ] as const) {
    const calAngle = Math.PI * 0.66;
    const calX = whX + Math.cos(calAngle) * rotorR * 0.88;
    const calY = whY + Math.sin(calAngle) * rotorR * 0.88;
    nodes.push(box(0.18, 0.075, 0.055, 'brakeCaliper', calX, calY, whZ + (w * 0.24) * side, 0, 0, calAngle + Math.PI / 2));
  }

  /* ═══════════════ 12. 4X ROTATING WHEEL SCENE-GRAPH NODES ═══════════════
   * Dedicated scene-graph nodes ('wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr')
   * with local geometry centered at (0, 0, 0).
   * Driven at 60 FPS by groundWalkController!
   */
  function buildWheelSubtree(radius: number, width: number, side: 1 | -1): GltfNodeSpec[] {
    const parts: GltfNodeSpec[] = [];
    const rimRadius = radius * 0.72;

    // A. Performance Michelin Pilot Sport Rubber Tire (aligned with Z spin axle)
    parts.push(cylinder(radius, width, 'tireRubber', 0, 0, 0, 'z'));
    parts.push(torus(radius - 0.026, 0.026, 'tireRubber', 0, 0, (width * 0.46) * side, 0, 0, 0));
    parts.push(torus(radius - 0.026, 0.026, 'tireRubber', 0, 0, -(width * 0.46) * side, 0, 0, 0));

    // B. Satin Dark Charcoal Forged Turbine Rim Barrel
    parts.push(cylinder(rimRadius, width * 0.94, 'alloyRim', 0, 0, 0, 'z'));
    // Diamond-cut machined outer rim lip highlight ring
    parts.push(torus(rimRadius * 0.96, 0.010, 'alloyLip', 0, 0, (width * 0.50) * side, 0, 0, 0));

    // C. 10 Sculpted Directional Turbine Spokes
    const spokeCount = 10;
    const spokeZ = (width * 0.46) * side;
    for (let k = 0; k < spokeCount; k++) {
      const angle = (k / spokeCount) * Math.PI * 2;
      const midR = rimRadius * 0.54;
      const sx = Math.cos(angle) * midR;
      const sy = Math.sin(angle) * midR;
      parts.push(box(rimRadius * 0.62, 0.024, 0.016, 'alloyRim', sx, sy, spokeZ, 0, 0, angle + 0.12 * side));
    }

    // D. Central Wheel Hub & Tesla Logo Emblem
    parts.push(cylinder(rimRadius * 0.28, 0.04, 'alloyRim', 0, 0, (width * 0.48) * side, 'z'));
    parts.push(cylinder(rimRadius * 0.12, 0.01, 'chrome', 0, 0, (width * 0.51) * side, 'z'));

    // E. 380mm Cross-Drilled Carbon-Ceramic Brake Rotor (spins with wheel)
    const rotorRadius = rimRadius * 0.82;
    parts.push(cylinder(rotorRadius, 0.028, 'brakeRotor', 0, 0, (width * 0.22) * side, 'z'));

    return parts;
  }

  // Register the 4 preserved wheel nodes at their respective chassis pivots
  nodes.push({
    name: 'wheel_fl',
    matrix: mtxTranslation(WHEEL_PIVOT_FL[0], WHEEL_PIVOT_FL[1], WHEEL_PIVOT_FL[2]),
    children: buildWheelSubtree(0.345, 0.26, -1),
  });

  nodes.push({
    name: 'wheel_fr',
    matrix: mtxTranslation(WHEEL_PIVOT_FR[0], WHEEL_PIVOT_FR[1], WHEEL_PIVOT_FR[2]),
    children: buildWheelSubtree(0.345, 0.26, 1),
  });

  nodes.push({
    name: 'wheel_rl',
    matrix: mtxTranslation(WHEEL_PIVOT_RL[0], WHEEL_PIVOT_RL[1], WHEEL_PIVOT_RL[2]),
    children: buildWheelSubtree(0.360, 0.32, -1),
  });

  nodes.push({
    name: 'wheel_rr',
    matrix: mtxTranslation(WHEEL_PIVOT_RR[0], WHEEL_PIVOT_RR[1], WHEEL_PIVOT_RR[2]),
    children: buildWheelSubtree(0.360, 0.32, 1),
  });

  /* ═══════════════ ROOT ASSEMBLY ═══════════════ */
  const rootNode: GltfNodeSpec = {
    name: 'tesla_roadster_root',
    children: nodes,
  };

  builder.registerNodes([rootNode]);

  // Preserve wheel nodes so their matrices can be transformed at 60 FPS by Cesium!
  const compiled = builder.build({
    preserveNodeNames: new Set(['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']),
  });

  const uri = compiled.dataUri;

  if (!isTarga && !isPlume) cachedRoadsterCoupeUri = uri;
  else if (isTarga && !isPlume) cachedRoadsterTargaUri = uri;
  else if (!isTarga && isPlume) cachedRoadsterCoupePlumeUri = uri;
  else if (isTarga && isPlume) cachedRoadsterTargaPlumeUri = uri;

  return uri;
}

/** Backward compatibility alias */
export function getRoverGltf(options?: RoadsterModelOptions): string {
  return getTeslaRoadsterGltf(options);
}
