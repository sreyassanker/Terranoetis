import fs from 'fs';
import path from 'path';

/**
 * Builds photorealistic binary glTF 2.0 (.glb) models of the 2nd Generation Tesla Roadster
 * with authentic materials, Ultra-White racing bucket seats, sculpted minimalist dashboard,
 * waterfall OLED touchscreen, steer-by-wire cockpit, aluminum pedals, aerodynamic carbon winglet mirrors,
 * dynamic wheel pivots, and SpaceX cold-gas thruster Mach shock diamonds & hover jets.
 */

interface MeshPrimitiveData {
  positions: number[];
  normals: number[];
  indices: number[];
}

function buildConePrimitive(
  baseCenter: [number, number, number],
  tipCenter: [number, number, number],
  rBase: number,
  rTip: number,
  segments = 14
): MeshPrimitiveData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const dx = tipCenter[0] - baseCenter[0];
  const dy = tipCenter[1] - baseCenter[1];
  const dz = tipCenter[2] - baseCenter[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
  const dir = [dx / len, dy / len, dz / len];

  let up = [0, 1, 0];
  if (Math.abs(dir[1]) > 0.9) up = [1, 0, 0];
  const right = [
    dir[1] * up[2] - dir[2] * up[1],
    dir[2] * up[0] - dir[0] * up[2],
    dir[0] * up[1] - dir[1] * up[0],
  ];
  const rLen = Math.sqrt(right[0] * right[0] + right[1] * right[1] + right[2] * right[2]) || 1;
  right[0] /= rLen; right[1] /= rLen; right[2] /= rLen;

  const normalY = [
    right[1] * dir[2] - right[2] * dir[1],
    right[2] * dir[0] - right[0] * dir[2],
    right[0] * dir[1] - right[1] * dir[0],
  ];

  for (let i = 0; i <= segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    const cos = Math.cos(th);
    const sin = Math.sin(th);

    const nx = right[0] * cos + normalY[0] * sin;
    const ny = right[1] * cos + normalY[1] * sin;
    const nz = right[2] * cos + normalY[2] * sin;

    // Base ring
    positions.push(
      baseCenter[0] + nx * rBase,
      baseCenter[1] + ny * rBase,
      baseCenter[2] + nz * rBase
    );
    normals.push(nx, ny, nz);

    // Tip ring
    positions.push(
      tipCenter[0] + nx * rTip,
      tipCenter[1] + ny * rTip,
      tipCenter[2] + nz * rTip
    );
    normals.push(nx, ny, nz);
  }

  for (let i = 0; i < segments; i++) {
    const v0 = i * 2;
    const v1 = i * 2 + 1;
    const v2 = (i + 1) * 2;
    const v3 = (i + 1) * 2 + 1;
    indices.push(v0, v1, v2);
    indices.push(v2, v1, v3);
  }

  return { positions, normals, indices };
}

function buildBiconePrimitive(
  center: [number, number, number],
  rMax: number,
  halfLen: number,
  axis: 'x' | 'y' | 'z' = 'y',
  segments = 14
): MeshPrimitiveData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const apex1: [number, number, number] = [
    center[0] + (axis === 'x' ? halfLen : 0),
    center[1] + (axis === 'y' ? halfLen : 0),
    center[2] + (axis === 'z' ? halfLen : 0),
  ];
  const apex2: [number, number, number] = [
    center[0] - (axis === 'x' ? halfLen : 0),
    center[1] - (axis === 'y' ? halfLen : 0),
    center[2] - (axis === 'z' ? halfLen : 0),
  ];

  positions.push(...apex1);
  normals.push(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  const idxApex1 = 0;

  positions.push(...apex2);
  normals.push(axis === 'x' ? -1 : 0, axis === 'y' ? -1 : 0, axis === 'z' ? -1 : 0);
  const idxApex2 = 1;

  const ringStartIdx = 2;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const c = Math.cos(angle) * rMax;
    const s = Math.sin(angle) * rMax;
    let px = center[0], py = center[1], pz = center[2];
    let nx = 0, ny = 0, nz = 0;
    if (axis === 'y') {
      px += c; pz += s;
      nx = Math.cos(angle); nz = Math.sin(angle);
    } else if (axis === 'z') {
      px += c; py += s;
      nx = Math.cos(angle); ny = Math.sin(angle);
    } else {
      py += c; pz += s;
      ny = Math.cos(angle); nz = Math.sin(angle);
    }
    positions.push(px, py, pz);
    normals.push(nx, ny, nz);
  }

  for (let i = 0; i < segments; i++) {
    const curr = ringStartIdx + i;
    const next = ringStartIdx + i + 1;
    indices.push(idxApex1, curr, next);
    indices.push(idxApex2, next, curr);
  }

  return { positions, normals, indices };
}

function buildDomePrimitive(
  center: [number, number, number],
  rx: number,
  ry: number,
  rz: number,
  rings = 6,
  segments = 12
): MeshPrimitiveData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * (Math.PI / 2); // 0 at top pole, PI/2 at base
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);

      const x = center[0] + rx * sinPhi * cosTheta;
      const y = center[1] + ry * cosPhi;
      const z = center[2] + rz * sinPhi * sinTheta;

      positions.push(x, y, z);
      normals.push(sinPhi * cosTheta, cosPhi, sinPhi * sinTheta);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const first = r * (segments + 1) + s;
      const second = first + (segments + 1);
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return { positions, normals, indices };
}

function buildBoxPrimitive(
  center: [number, number, number],
  size: [number, number, number],
  pitchAngleRad = 0,
  rollAngleRad = 0,
  yawAngleRad = 0
): MeshPrimitiveData {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];

  const cosP = Math.cos(pitchAngleRad), sinP = Math.sin(pitchAngleRad);
  const cosR = Math.cos(rollAngleRad), sinR = Math.sin(rollAngleRad);
  const cosY = Math.cos(yawAngleRad), sinY = Math.sin(yawAngleRad);

  function rot(x: number, y: number, z: number): [number, number, number] {
    // Yaw around Y
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    // Pitch around X
    const y2 = y * cosP - z1 * sinP;
    const z2 = y * sinP + z1 * cosP;
    // Roll around Z
    const x3 = x1 * cosR - y2 * sinR;
    const y3 = x1 * sinR + y2 * cosR;
    return [cx + x3, cy + y3, cz + z2];
  }

  const corners = [
    rot(-sx, -sy, -sz), rot(sx, -sy, -sz), rot(sx, sy, -sz), rot(-sx, sy, -sz),
    rot(-sx, -sy,  sz), rot(sx, -sy,  sz), rot(sx, sy,  sz), rot(-sx, sy,  sz),
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const faces = [
    { idx: [1, 0, 3, 2], norm: [0, -sinP, -cosP] }, // Rear (-Z)
    { idx: [4, 5, 6, 7], norm: [0, sinP, cosP] },   // Front (+Z)
    { idx: [0, 4, 7, 3], norm: [-cosR, 0, 0] },     // Left (-X)
    { idx: [5, 1, 2, 6], norm: [cosR, 0, 0] },      // Right (+X)
    { idx: [7, 6, 2, 3], norm: [0, cosP, -sinP] },   // Top (+Y)
    { idx: [0, 1, 5, 4], norm: [0, -cosP, sinP] },   // Bottom (-Y)
  ];

  for (const f of faces) {
    const baseIdx = positions.length / 3;
    for (const ci of f.idx) {
      positions.push(...corners[ci]);
      normals.push(...f.norm);
    }
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
  }

  return { positions, normals, indices };
}

export function generateRoadsterGlbs() {
  const chassisPath = path.resolve('public/models/jaagrav_chassis.gltf');
  const wheelPath = path.resolve('public/models/jaagrav_wheel.gltf');

  const chassis = JSON.parse(fs.readFileSync(chassisPath, 'utf8'));
  const wheel = JSON.parse(fs.readFileSync(wheelPath, 'utf8'));

  const chassisBuf = Buffer.from(chassis.buffers[0].uri.replace(/^data:application\/octet-stream;base64,/, ''), 'base64');
  const wheelBuf = Buffer.from(wheel.buffers[0].uri.replace(/^data:application\/octet-stream;base64,/, ''), 'base64');

  const padChassis = (4 - (chassisBuf.length % 4)) % 4;
  const paddedChassisBuf = Buffer.concat([chassisBuf, Buffer.alloc(padChassis, 0)]);

  // ─────────────────────────────────────────────────────────────────────────────
  // BAKED LEFT & RIGHT WHEELS (Aligned with Axle along X, Up along Y, Roll around X)
  // ─────────────────────────────────────────────────────────────────────────────
  const materialOffset = chassis.materials.length;
  for (const mat of wheel.materials) {
    if (mat.name === 'Material.014' || mat.name === 'Material.022') {
      // High-performance Michelin Pilot Sport Cup 2 rubber tire
      mat.pbrMetallicRoughness = {
        baseColorFactor: [0.03, 0.03, 0.035, 1.0],
        metallicFactor: 0.0,
        roughnessFactor: 0.88,
      };
    } else if (mat.name === 'Material.015' || mat.name === 'Material.023') {
      // Dark turbine alloy wheel rim
      mat.pbrMetallicRoughness = {
        baseColorFactor: [0.10, 0.11, 0.13, 1.0],
        metallicFactor: 0.88,
        roughnessFactor: 0.18,
      };
    } else if (mat.name === 'Material.020') {
      // Brembo gloss-red brake caliper
      mat.pbrMetallicRoughness = {
        baseColorFactor: [0.88, 0.04, 0.05, 1.0],
        metallicFactor: 0.35,
        roughnessFactor: 0.22,
      };
    } else if (mat.name === 'Material.021') {
      // Drilled carbon-ceramic brake rotor disc
      mat.pbrMetallicRoughness = {
        baseColorFactor: [0.38, 0.40, 0.42, 1.0],
        metallicFactor: 0.85,
        roughnessFactor: 0.28,
      };
    }
    chassis.materials.push(mat);
  }

  function getMat4(node: { translation?: number[]; rotation?: number[]; scale?: number[] }) {
    const t = node.translation || [0,0,0];
    const r = node.rotation || [0,0,0,1];
    const s = node.scale || [1,1,1];

    const x2 = r[0] + r[0], y2 = r[1] + r[1], z2 = r[2] + r[2];
    const xx = r[0] * x2, xy = r[0] * y2, xz = r[0] * z2;
    const yy = r[1] * y2, yz = r[1] * z2, zz = r[2] * z2;
    const wx = r[3] * x2, wy = r[3] * y2, wz = r[3] * z2;

    const rot = [
      (1 - (yy + zz))*s[0], (xy + wz)*s[0], (xz - wy)*s[0], 0,
      (xy - wz)*s[1], (1 - (xx + zz))*s[1], (yz + wx)*s[1], 0,
      (xz + wy)*s[2], (yz - wx)*s[2], (1 - (xx + yy))*s[2], 0,
      t[0], t[1], t[2], 1
    ];
    return rot;
  }

  function multMat4(a: number[], b: number[]) {
    const out = new Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        out[c*4 + r] =
          a[0*4 + r] * b[c*4 + 0] +
          a[1*4 + r] * b[c*4 + 1] +
          a[2*4 + r] * b[c*4 + 2] +
          a[3*4 + r] * b[c*4 + 3];
      }
    }
    return out;
  }

  const mW = multMat4(getMat4(wheel.nodes[1]), getMat4(wheel.nodes[0]));

  function extractWheelPrimitive(primIdx: number, mirrorX = false): MeshPrimitiveData {
    const prim = wheel.meshes[0].primitives[primIdx];
    const posAcc = wheel.accessors[prim.attributes.POSITION];
    const posBv = wheel.bufferViews[posAcc.bufferView];
    const posOff = posBv.byteOffset + (posAcc.byteOffset || 0);
    const posStride = posBv.byteStride || 12;

    const normAcc = wheel.accessors[prim.attributes.NORMAL];
    const normBv = wheel.bufferViews[normAcc.bufferView];
    const normOff = normBv.byteOffset + (normAcc.byteOffset || 0);
    const normStride = normBv.byteStride || 12;

    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < posAcc.count; i++) {
      const p = posOff + i * posStride;
      const x = wheelBuf.readFloatLE(p);
      const y = wheelBuf.readFloatLE(p + 4);
      const z = wheelBuf.readFloatLE(p + 8);

      let wx = mW[0]*x + mW[4]*y + mW[8]*z + mW[12];
      let wy = mW[1]*x + mW[5]*y + mW[9]*z + mW[13];
      let wz = mW[2]*x + mW[6]*y + mW[10]*z + mW[14];

      const np = normOff + i * normStride;
      const nx = wheelBuf.readFloatLE(np);
      const ny = wheelBuf.readFloatLE(np + 4);
      const nz = wheelBuf.readFloatLE(np + 8);

      let wnx = mW[0]*nx + mW[4]*ny + mW[8]*nz;
      let wny = mW[1]*nx + mW[5]*ny + mW[9]*nz;
      let wnz = mW[2]*nx + mW[6]*ny + mW[10]*nz;

      if (mirrorX) {
        wx = -wx;
        wnx = -wnx;
      }

      positions.push(wx, wy, wz);
      normals.push(wnx, wny, wnz);
    }

    const idxAcc = wheel.accessors[prim.indices];
    const idxBv = wheel.bufferViews[idxAcc.bufferView];
    const idxOff = idxBv.byteOffset + (idxAcc.byteOffset || 0);

    for (let i = 0; i < idxAcc.count; i++) {
      const idx = idxAcc.componentType === 5123
        ? wheelBuf.readUInt16LE(idxOff + i * 2)
        : wheelBuf.readUInt32LE(idxOff + i * 4);
      indices.push(idx);
    }

    if (mirrorX) {
      for (let i = 0; i < indices.length; i += 3) {
        const tmp = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = tmp;
      }
    }

    return { positions, normals, indices };
  }

  const baseBuffers: Buffer[] = [paddedChassisBuf];

  const leftWheelPrims: { attributes: { POSITION: number; NORMAL: number }; indices: number; material: number; mode: number }[] = [];
  const rightWheelPrims: { attributes: { POSITION: number; NORMAL: number }; indices: number; material: number; mode: number }[] = [];

  for (let i = 0; i < wheel.meshes[0].primitives.length; i++) {
    const rawMat = wheel.meshes[0].primitives[i].material;
    const primLeft = extractWheelPrimitive(i, false);
    const primRight = extractWheelPrimitive(i, true);

    leftWheelPrims.push(appendGeometryPrimitive(chassis, baseBuffers, primLeft, rawMat + materialOffset));
    rightWheelPrims.push(appendGeometryPrimitive(chassis, baseBuffers, primRight, rawMat + materialOffset));
  }

  const wheelLeftMeshIdx = chassis.meshes.length;
  chassis.meshes.push({
    name: 'Tesla_Wheel_Left',
    primitives: leftWheelPrims,
  });

  const wheelRightMeshIdx = chassis.meshes.length;
  chassis.meshes.push({
    name: 'Tesla_Wheel_Right',
    primitives: rightWheelPrims,
  });

  const sceneRootNodeIdx = chassis.nodes.findIndex((n: { name: string }) => n.name === 'GLTF_SceneRootNode');
  const sceneRootNode = chassis.nodes[sceneRootNodeIdx];

  // ─────────────────────────────────────────────────────────────────────────────
  // PRUNE LEGACY ARTIFACTS, UNTEXTURED BLOCKS & STATIC WHEELS
  // ─────────────────────────────────────────────────────────────────────────────
  // Prunes:
  // - WHEEL.003_39, WHEEL.004_40, WHEEL.005_41 (legacy non-spinning wheels)
  // - Plane_30 (artist showcase platform stand)
  // - Cylinder.001_25 (legacy artifact cylinder)
  // - Cylinder_24 (legacy crude cylinder)
  // NOTE: Cube_23 (dashboard), SCREEN_37 (OLED display), Cube.001_34 (front bucket seats),
  // and Plane.002_29 (cabin seating) are preserved to keep authentic fit, clearances, and materials!
  const staticNodesToPrune = [
    'WHEEL.003_39',
    'WHEEL.004_40',
    'WHEEL.005_41',
    'Plane_30',
    'Cylinder.001_25',
    'Cylinder_24',
  ];
  const pruneIndices = staticNodesToPrune
    .map(name => chassis.nodes.findIndex((n: { name: string }) => n.name === name))
    .filter(idx => idx !== -1);
  sceneRootNode.children = sceneRootNode.children.filter((id: number) => !pruneIndices.includes(id));

  // 4 Dynamic Wheel Nodes with individual pivots for 60 FPS steer & roll:
  // Perfectly symmetric, tucked inside the fender haunches (Left: +0.585m, Right: -0.585m)
  // wheelLeftMeshIdx has spoke face facing outward towards +X (Left side)
  // wheelRightMeshIdx has spoke face facing outward towards -X (Right side)
  const wheelFLNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'wheel_fl',
    mesh: wheelLeftMeshIdx, // rim face points outward towards Left (world -X)
    translation: [0.585, 0.1852, 0.961],
  });

  const wheelFRNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'wheel_fr',
    mesh: wheelRightMeshIdx, // rim face points outward towards Right (world +X)
    translation: [-0.585, 0.1852, 0.961],
  });

  const wheelRLNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'wheel_rl',
    mesh: wheelLeftMeshIdx, // rim face points outward towards Left (world -X)
    translation: [0.585, 0.1979, -0.951],
  });

  const wheelRRNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'wheel_rr',
    mesh: wheelRightMeshIdx, // rim face points outward towards Right (world +X)
    translation: [-0.585, 0.1979, -0.951],
  });

  sceneRootNode.children.push(wheelFLNodeIdx, wheelFRNodeIdx, wheelRLNodeIdx, wheelRRNodeIdx);

  // ─────────────────────────────────────────────────────────────────────────────
  // 60 FPS DYNAMIC STEERING YOKE & TESLA LOGO REPARENTING
  // ─────────────────────────────────────────────────────────────────────────────
  const yokeNodeIdx = chassis.nodes.findIndex((n: { name: string }) => n.name === 'Cylinder.002_27');
  if (yokeNodeIdx !== -1) {
    chassis.nodes[yokeNodeIdx].name = 'cockpit_steering_yoke';
    const logoNodeIdx = chassis.nodes.findIndex((n: { name: string }) => n.name === 'TESLA LOGO_28');
    if (logoNodeIdx !== -1) {
      sceneRootNode.children = sceneRootNode.children.filter((id: number) => id !== logoNodeIdx);
      chassis.nodes[logoNodeIdx].translation = [-0.703635, 1.669615, -0.028332];
      chassis.nodes[logoNodeIdx].rotation = [-0.6938805, 0.1530634, -0.6852177, -0.1599316];
      chassis.nodes[logoNodeIdx].scale = [0.074053, 0.105571, 0.105571];
      if (!chassis.nodes[yokeNodeIdx].children.includes(logoNodeIdx)) {
        chassis.nodes[yokeNodeIdx].children.push(logoNodeIdx);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MATERIALS POLISHING (Tesla Official Multi-Coat Candy Red & Ultra-White Cabin)
  // ─────────────────────────────────────────────────────────────────────────────
  for (const mat of chassis.materials) {
    if (mat.name === 'car_paint') {
      // Signature Tesla Multi-Coat Ultra Red Metallic Candy
      mat.pbrMetallicRoughness.baseColorFactor = [0.78, 0.025, 0.055, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.70;
      mat.pbrMetallicRoughness.roughnessFactor = 0.10;
    }
    if (mat.name === 'glass') {
      // Smoked panoramic solar-tinted glass canopy
      mat.pbrMetallicRoughness.baseColorFactor = [0.06, 0.08, 0.12, 0.45];
      mat.pbrMetallicRoughness.metallicFactor = 0.40;
      mat.pbrMetallicRoughness.roughnessFactor = 0.02;
      mat.alphaMode = 'BLEND';
    }
    if (mat.name === 'glass2') {
      // Clear aerodynamic taillight lens cover
      mat.pbrMetallicRoughness.baseColorFactor = [0.90, 0.10, 0.10, 0.20];
      mat.pbrMetallicRoughness.metallicFactor = 0.10;
      mat.pbrMetallicRoughness.roughnessFactor = 0.02;
      mat.alphaMode = 'BLEND';
    }
    if (mat.name === 'black_body_paint' || mat.name === 'black_matt') {
      // Autoclaved 3K Twill High-Gloss Pre-Preg Carbon Fiber (Aero Diffuser, Front Splitter, Side Sills)
      mat.pbrMetallicRoughness.baseColorFactor = [0.008, 0.008, 0.012, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.92;
      mat.pbrMetallicRoughness.roughnessFactor = 0.08;
    }
    if (mat.name === 'Material.001' || mat.name === 'Material.024') {
      // Rear continuous LED taillight blade & running lights
      mat.pbrMetallicRoughness = mat.pbrMetallicRoughness || {};
      mat.pbrMetallicRoughness.baseColorFactor = [0.95, 0.02, 0.03, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.05;
      mat.pbrMetallicRoughness.roughnessFactor = 0.15;
      mat.emissiveFactor = [3.8, 0.06, 0.08]; // Luminous red neon running LED
    }
    if (mat.name === 'Material.002') {
      // Front razor LED DRL light strips & projectors
      mat.emissiveFactor = [2.0, 2.0, 2.0];
      mat.pbrMetallicRoughness.baseColorFactor = [1.0, 1.0, 1.0, 1.0];
    }
    // COCKPIT INTERIOR MATERIALS
    if (mat.name === 'gray' || mat.name === 'Material.013') {
      mat.pbrMetallicRoughness.baseColorFactor = [0.025, 0.025, 0.030, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.05;
      mat.pbrMetallicRoughness.roughnessFactor = 0.65;
    }
    if (mat.name === 'light_gray') {
      mat.pbrMetallicRoughness.baseColorFactor = [0.96, 0.96, 0.98, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.0;
      mat.pbrMetallicRoughness.roughnessFactor = 0.22;
    }
    if (
      mat.name === 'Material.012' ||
      mat.name === 'Material.016' ||
      mat.name === 'Material.017' ||
      mat.name === 'Material.018'
    ) {
      mat.pbrMetallicRoughness.baseColorFactor = [0.96, 0.96, 0.98, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.0;
      mat.pbrMetallicRoughness.roughnessFactor = 0.20;
    }
    if (mat.name === 'Material.011') {
      mat.pbrMetallicRoughness.baseColorFactor = [0.08, 0.08, 0.09, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.2;
      mat.pbrMetallicRoughness.roughnessFactor = 0.40;
    }
    if (mat.name === 'Material.010') {
      mat.pbrMetallicRoughness.baseColorFactor = [0.03, 0.03, 0.035, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.05;
      mat.pbrMetallicRoughness.roughnessFactor = 0.35;
    }
    if (mat.name === 'Material.008' || mat.name === 'Material.009') {
      mat.pbrMetallicRoughness.baseColorFactor = [0.90, 0.90, 0.94, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.92;
      mat.pbrMetallicRoughness.roughnessFactor = 0.15;
    }
    if (mat.name === 'Material.019') {
      mat.pbrMetallicRoughness.baseColorFactor = [0.05, 0.12, 0.22, 1.0];
      mat.pbrMetallicRoughness.metallicFactor = 0.1;
      mat.pbrMetallicRoughness.roughnessFactor = 0.05;
      mat.emissiveFactor = [0.35, 0.65, 0.95];
    }
  }

  function appendGeometryPrimitive(
    targetGltf: typeof chassis,
    binBufs: Buffer[],
    geom: MeshPrimitiveData,
    materialIdx: number
  ) {
    const posBuf = Buffer.alloc(geom.positions.length * 4);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < geom.positions.length; i += 3) {
      const x = geom.positions[i], y = geom.positions[i + 1], z = geom.positions[i + 2];
      posBuf.writeFloatLE(x, i * 4);
      posBuf.writeFloatLE(y, (i + 1) * 4);
      posBuf.writeFloatLE(z, (i + 2) * 4);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }

    const normBuf = Buffer.alloc(geom.normals.length * 4);
    for (let i = 0; i < geom.normals.length; i++) {
      normBuf.writeFloatLE(geom.normals[i], i * 4);
    }

    const idxBuf = Buffer.alloc(geom.indices.length * 2);
    for (let i = 0; i < geom.indices.length; i++) {
      idxBuf.writeUInt16LE(geom.indices[i], i * 2);
    }

    const padPos = (4 - (posBuf.length % 4)) % 4;
    const finalPosBuf = Buffer.concat([posBuf, Buffer.alloc(padPos, 0)]);
    const padNorm = (4 - (normBuf.length % 4)) % 4;
    const finalNormBuf = Buffer.concat([normBuf, Buffer.alloc(padNorm, 0)]);
    const padIdx = (4 - (idxBuf.length % 4)) % 4;
    const finalIdxBuf = Buffer.concat([idxBuf, Buffer.alloc(padIdx, 0)]);

    const curOffset = binBufs.reduce((acc, b) => acc + b.length, 0);

    const posBvIdx = targetGltf.bufferViews.length;
    targetGltf.bufferViews.push({
      buffer: 0,
      byteOffset: curOffset,
      byteLength: posBuf.length,
      target: 34962,
    });
    binBufs.push(finalPosBuf);

    const normOffset = curOffset + finalPosBuf.length;
    const normBvIdx = targetGltf.bufferViews.length;
    targetGltf.bufferViews.push({
      buffer: 0,
      byteOffset: normOffset,
      byteLength: normBuf.length,
      target: 34962,
    });
    binBufs.push(finalNormBuf);

    const idxOffset = normOffset + finalNormBuf.length;
    const idxBvIdx = targetGltf.bufferViews.length;
    targetGltf.bufferViews.push({
      buffer: 0,
      byteOffset: idxOffset,
      byteLength: idxBuf.length,
      target: 34963,
    });
    binBufs.push(finalIdxBuf);

    const posAccIdx = targetGltf.accessors.length;
    targetGltf.accessors.push({
      bufferView: posBvIdx,
      byteOffset: 0,
      componentType: 5126,
      count: geom.positions.length / 3,
      type: 'VEC3',
      max: [maxX, maxY, maxZ],
      min: [minX, minY, minZ],
    });

    const normAccIdx = targetGltf.accessors.length;
    targetGltf.accessors.push({
      bufferView: normBvIdx,
      byteOffset: 0,
      componentType: 5126,
      count: geom.normals.length / 3,
      type: 'VEC3',
    });

    const idxAccIdx = targetGltf.accessors.length;
    targetGltf.accessors.push({
      bufferView: idxBvIdx,
      byteOffset: 0,
      componentType: 5123,
      count: geom.indices.length,
      type: 'SCALAR',
    });

    return {
      attributes: { POSITION: posAccIdx, NORMAL: normAccIdx },
      indices: idxAccIdx,
      material: materialIdx,
      mode: 4,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // NEW HIGH-FIDELITY MATERIALS FOR TESLA ROADSTER CABIN & MIRRORS
  // ─────────────────────────────────────────────────────────────────────────────
  const obsidianAlcantaraMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Cockpit_Obsidian_Alcantara',
    pbrMetallicRoughness: {
      baseColorFactor: [0.035, 0.035, 0.040, 1.0],
      metallicFactor: 0.02,
      roughnessFactor: 0.72,
    },
  });

  const ultraWhiteLeatherMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Tesla_Ultra_White_Leather',
    pbrMetallicRoughness: {
      baseColorFactor: [0.97, 0.97, 0.99, 1.0],
      metallicFactor: 0.0,
      roughnessFactor: 0.22,
    },
  });

  const waterfallScreenMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Cockpit_Waterfall_OLED_Screen',
    pbrMetallicRoughness: {
      baseColorFactor: [0.02, 0.04, 0.08, 1.0],
      metallicFactor: 0.25,
      roughnessFactor: 0.04,
    },
    emissiveFactor: [0.45, 0.85, 1.35], // Glowing blue/cyan OLED illumination
  });

  const screenRoadsterGlowMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Screen_Roadster_Vector_Red',
    pbrMetallicRoughness: {
      baseColorFactor: [0.95, 0.08, 0.12, 1.0],
      metallicFactor: 0.10,
      roughnessFactor: 0.05,
    },
    emissiveFactor: [2.8, 0.15, 0.25], // Glowing red top-down hypercar silhouette
  });

  const mirrorChromeGlassMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Mirror_Reflective_Chrome_Glass',
    pbrMetallicRoughness: {
      baseColorFactor: [0.96, 0.97, 0.99, 1.0],
      metallicFactor: 0.98,
      roughnessFactor: 0.02,
    },
  });

  const turnSignalAmberMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Mirror_Turn_Signal_Amber',
    pbrMetallicRoughness: {
      baseColorFactor: [1.0, 0.65, 0.05, 1.0],
      metallicFactor: 0.10,
      roughnessFactor: 0.10,
    },
    emissiveFactor: [2.2, 1.2, 0.1],
  });

  const pedalAluMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Cockpit_Alu_Pedal',
    pbrMetallicRoughness: {
      baseColorFactor: [0.85, 0.86, 0.88, 1.0],
      metallicFactor: 0.85,
      roughnessFactor: 0.20,
    },
  });

  const carbonStalkMatIdx = chassis.materials.findIndex((m: { name: string }) => m.name === 'black_matt' || m.name === 'black_body_paint');
  const carPaintMatIdx = chassis.materials.findIndex((m: { name: string }) => m.name === 'car_paint');

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. AERODYNAMIC CARBON EXTERIOR WING MIRRORS & FRAMELESS INTERIOR TOP MIRROR
  // ─────────────────────────────────────────────────────────────────────────────
  // Left Exterior Side Mirror (Driver Door A-Pillar Base - Sleek Aerodynamic Carbon Winglet)
  const leftMirrorStalk = buildBoxPrimitive([ 0.615, 0.470, 0.510], [0.035, 0.008, 0.016], 0.12, 0.08, -0.22);
  const leftMirrorHousing = buildBoxPrimitive([ 0.650, 0.475, 0.505], [0.055, 0.024, 0.018], 0.06, 0.04, -0.18);
  const leftMirrorGlass = buildBoxPrimitive([ 0.650, 0.475, 0.495], [0.050, 0.020, 0.002], 0.06, 0.04, -0.18);
  const leftMirrorIndicator = buildBoxPrimitive([ 0.675, 0.475, 0.512], [0.010, 0.004, 0.012], 0.06);

  // Right Exterior Side Mirror (Passenger Door A-Pillar Base - Sleek Aerodynamic Carbon Winglet)
  const rightMirrorStalk = buildBoxPrimitive([-0.615, 0.470, 0.510], [0.035, 0.008, 0.016], 0.12, -0.08, 0.22);
  const rightMirrorHousing = buildBoxPrimitive([-0.650, 0.475, 0.505], [0.055, 0.024, 0.018], 0.06, -0.04, 0.18);
  const rightMirrorGlass = buildBoxPrimitive([-0.650, 0.475, 0.495], [0.050, 0.020, 0.002], 0.06, -0.04, 0.18);
  const rightMirrorIndicator = buildBoxPrimitive([-0.675, 0.475, 0.512], [0.010, 0.004, 0.012], 0.06);

  // Top Frameless Interior Rearview Mirror (Windshield Center Header)
  const topMirrorBracket = buildBoxPrimitive([0.0, 0.665, 0.065], [0.008, 0.018, 0.008], -0.22);
  const topMirrorHousing = buildBoxPrimitive([0.0, 0.650, 0.070], [0.120, 0.032, 0.006], -0.10);
  const topMirrorGlass = buildBoxPrimitive([0.0, 0.650, 0.066], [0.116, 0.028, 0.002], -0.10);

  const mirrorPrims = [
    appendGeometryPrimitive(chassis, baseBuffers, leftMirrorStalk, carbonStalkMatIdx !== -1 ? carbonStalkMatIdx : 1),
    appendGeometryPrimitive(chassis, baseBuffers, leftMirrorHousing, carPaintMatIdx !== -1 ? carPaintMatIdx : 2),
    appendGeometryPrimitive(chassis, baseBuffers, leftMirrorGlass, mirrorChromeGlassMatIdx),
    appendGeometryPrimitive(chassis, baseBuffers, leftMirrorIndicator, turnSignalAmberMatIdx),

    appendGeometryPrimitive(chassis, baseBuffers, rightMirrorStalk, carbonStalkMatIdx !== -1 ? carbonStalkMatIdx : 1),
    appendGeometryPrimitive(chassis, baseBuffers, rightMirrorHousing, carPaintMatIdx !== -1 ? carPaintMatIdx : 2),
    appendGeometryPrimitive(chassis, baseBuffers, rightMirrorGlass, mirrorChromeGlassMatIdx),
    appendGeometryPrimitive(chassis, baseBuffers, rightMirrorIndicator, turnSignalAmberMatIdx),

    appendGeometryPrimitive(chassis, baseBuffers, topMirrorBracket, carbonStalkMatIdx !== -1 ? carbonStalkMatIdx : 1),
    appendGeometryPrimitive(chassis, baseBuffers, topMirrorHousing, carbonStalkMatIdx !== -1 ? carbonStalkMatIdx : 1),
    appendGeometryPrimitive(chassis, baseBuffers, topMirrorGlass, mirrorChromeGlassMatIdx),
  ];

  const mirrorsMeshIdx = chassis.meshes.length;
  chassis.meshes.push({
    name: 'Cockpit_And_Exterior_Mirrors_Mesh',
    primitives: mirrorPrims,
  });

  const mirrorsNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'cockpit_and_exterior_mirrors',
    mesh: mirrorsMeshIdx,
  });
  sceneRootNode.children.push(mirrorsNodeIdx);

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. REAR AERODYNAMIC DIFFUSER & CENTRAL SPACEX DE LAVAL ROCKET NOZZLE
  // ─────────────────────────────────────────────────────────────────────────────
  const titaniumNozzleMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Aerospace_Titanium_Rocket_Nozzle',
    pbrMetallicRoughness: {
      baseColorFactor: [0.38, 0.40, 0.44, 1.0],
      metallicFactor: 0.90,
      roughnessFactor: 0.18,
    },
  });

  const carbonDiffuserMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Carbon_Fiber_Diffuser_Tray_And_Strakes',
    pbrMetallicRoughness: {
      baseColorFactor: [0.015, 0.015, 0.020, 1.0],
      metallicFactor: 0.05,
      roughnessFactor: 0.32,
    },
  });

  const heatShieldMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Hexagonal_Thermal_Heat_Shield',
    pbrMetallicRoughness: {
      baseColorFactor: [0.05, 0.05, 0.06, 1.0],
      metallicFactor: 0.60,
      roughnessFactor: 0.35,
    },
  });

  // Sleek Autoclaved Carbon-Fiber Diffuser Venturi Floor Tray
  const diffuserFloorTray = buildBoxPrimitive([0.0, 0.138, -1.14], [0.54, 0.015, 0.42], 0.11);

  // 4 CFD Aerodynamic Vertical Carbon-Fiber Diffuser Strakes
  const strakeL1 = buildBoxPrimitive([ 0.22, 0.165, -1.14], [0.010, 0.052, 0.40], 0.11);
  const strakeL2 = buildBoxPrimitive([ 0.07, 0.165, -1.14], [0.010, 0.048, 0.38], 0.11);
  const strakeR2 = buildBoxPrimitive([-0.07, 0.165, -1.14], [0.010, 0.048, 0.38], 0.11);
  const strakeR1 = buildBoxPrimitive([-0.22, 0.165, -1.14], [0.010, 0.052, 0.40], 0.11);

  // Titanium Heat Shield Backing across entire rear cold-gas manifold
  const heatShieldBacking = buildBoxPrimitive([0.0, 0.385, -1.37], [0.46, 0.12, 0.012], 0);

  // 4 Horizontal High-Pressure Rocket Thrusters behind rear license plate (Forward acceleration)
  const nozzleRearL1 = buildConePrimitive([ 0.18, 0.385, -1.33], [ 0.18, 0.385, -1.41], 0.034, 0.020, 14);
  const nozzleRearL2 = buildConePrimitive([ 0.06, 0.385, -1.33], [ 0.06, 0.385, -1.41], 0.036, 0.022, 14);
  const nozzleRearR2 = buildConePrimitive([-0.06, 0.385, -1.33], [-0.06, 0.385, -1.41], 0.036, 0.022, 14);
  const nozzleRearR1 = buildConePrimitive([-0.18, 0.385, -1.33], [-0.18, 0.385, -1.41], 0.034, 0.020, 14);

  // 4 Vertical Titanium De Laval Rocket Thruster Nozzles under Diffuser Strakes (Downward hover/leap blast)
  const nozzleDownL1 = buildConePrimitive([ 0.34, 0.18, -1.22], [ 0.34, 0.13, -1.22], 0.022, 0.045, 16);
  const nozzleDownL2 = buildConePrimitive([ 0.12, 0.18, -1.22], [ 0.12, 0.13, -1.22], 0.022, 0.045, 16);
  const nozzleDownR2 = buildConePrimitive([-0.12, 0.18, -1.22], [-0.12, 0.13, -1.22], 0.022, 0.045, 16);
  const nozzleDownR1 = buildConePrimitive([-0.34, 0.18, -1.22], [-0.34, 0.13, -1.22], 0.022, 0.045, 16);

  const diffuserFloorPrim = appendGeometryPrimitive(chassis, baseBuffers, diffuserFloorTray, carbonDiffuserMatIdx);
  const sl1Prim = appendGeometryPrimitive(chassis, baseBuffers, strakeL1, carbonDiffuserMatIdx);
  const sl2Prim = appendGeometryPrimitive(chassis, baseBuffers, strakeL2, carbonDiffuserMatIdx);
  const sr2Prim = appendGeometryPrimitive(chassis, baseBuffers, strakeR2, carbonDiffuserMatIdx);
  const sr1Prim = appendGeometryPrimitive(chassis, baseBuffers, strakeR1, carbonDiffuserMatIdx);
  const hsPrim = appendGeometryPrimitive(chassis, baseBuffers, heatShieldBacking, heatShieldMatIdx);
  const nrL1Prim = appendGeometryPrimitive(chassis, baseBuffers, nozzleRearL1, titaniumNozzleMatIdx);
  const nrL2Prim = appendGeometryPrimitive(chassis, baseBuffers, nozzleRearL2, titaniumNozzleMatIdx);
  const nrR2Prim = appendGeometryPrimitive(chassis, baseBuffers, nozzleRearR2, titaniumNozzleMatIdx);
  const nrR1Prim = appendGeometryPrimitive(chassis, baseBuffers, nozzleRearR1, titaniumNozzleMatIdx);
  const ndL1Prim = appendGeometryPrimitive(chassis, baseBuffers, nozzleDownL1, titaniumNozzleMatIdx);
  const ndL2Prim = appendGeometryPrimitive(chassis, baseBuffers, nozzleDownL2, titaniumNozzleMatIdx);
  const ndR2Prim = appendGeometryPrimitive(chassis, baseBuffers, nozzleDownR2, titaniumNozzleMatIdx);
  const ndR1Prim = appendGeometryPrimitive(chassis, baseBuffers, nozzleDownR1, titaniumNozzleMatIdx);

  const diffuserAeroMeshIdx = chassis.meshes.length;
  chassis.meshes.push({
    name: 'Diffuser_Aero_Nozzles_Mesh',
    primitives: [
      diffuserFloorPrim, sl1Prim, sl2Prim, sr2Prim, sr1Prim, hsPrim,
      nrL1Prim, nrL2Prim, nrR2Prim, nrR1Prim,
      ndL1Prim, ndL2Prim, ndR2Prim, ndR1Prim,
    ],
  });

  const diffuserAeroNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'diffuser_aero_and_nozzles',
    mesh: diffuserAeroMeshIdx,
  });
  sceneRootNode.children.push(diffuserAeroNodeIdx);

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. SPACEX COLD-GAS SUPERSONIC EXPANSION VAPOR JETS (10,000 PSI Pneumatics)
  // ─────────────────────────────────────────────────────────────────────────────
  // Authentic SpaceX Cold-Gas Thrusters emit pure high-velocity white condensation
  // vapor clouds (isentropic Joule-Thomson cryogenic expansion of compressed gas),
  // with supersonic Mach shock diamonds, high-kinetic needle cores, and massive
  // billowing ground clouds rolling outwards across the pavement like rocket fire!
  const machDiamondMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'SpaceX_Mach_Shock_Diamond',
    pbrMetallicRoughness: {
      baseColorFactor: [1.0, 1.0, 1.0, 1.0],
      metallicFactor: 0.0,
      roughnessFactor: 0.10,
    },
    emissiveFactor: [4.6, 4.8, 5.2], // Blinding supersonic Mach shock diamond node
    alphaMode: 'BLEND',
  });

  const coldGasCoreMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'SpaceX_ColdGas_Vapor_Core',
    pbrMetallicRoughness: {
      baseColorFactor: [0.99, 1.0, 1.0, 0.98],
      metallicFactor: 0.0,
      roughnessFactor: 0.30,
    },
    emissiveFactor: [3.4, 3.6, 4.0], // High-kinetic Mach needle core with immense horsepower
    alphaMode: 'BLEND',
  });

  const coldGasSheathMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'SpaceX_ColdGas_Vapor_Sheath',
    pbrMetallicRoughness: {
      baseColorFactor: [0.95, 0.97, 0.99, 0.85],
      metallicFactor: 0.0,
      roughnessFactor: 0.65,
    },
    emissiveFactor: [1.6, 1.7, 1.9], // Supersonic boundary expansion sheath
    alphaMode: 'BLEND',
  });

  const groundBillowMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'SpaceX_Ground_Billow_Cloud',
    pbrMetallicRoughness: {
      baseColorFactor: [0.98, 0.99, 1.0, 0.92],
      metallicFactor: 0.0,
      roughnessFactor: 0.85,
    },
    emissiveFactor: [1.2, 1.25, 1.35], // Massive rolling turbulent vapor cloud on ground
    alphaMode: 'BLEND',
  });

  const verticalPlumePrims: { attributes: { POSITION: number; NORMAL: number }; indices: number; material: number; mode: number }[] = [];
  const horizontalPlumePrims: { attributes: { POSITION: number; NORMAL: number }; indices: number; material: number; mode: number }[] = [];

  function addVerticalPlume(data: MeshPrimitiveData, matIdx: number) {
    verticalPlumePrims.push(appendGeometryPrimitive(chassis, baseBuffers, data, matIdx));
  }
  function addHorizontalPlume(data: MeshPrimitiveData, matIdx: number) {
    horizontalPlumePrims.push(appendGeometryPrimitive(chassis, baseBuffers, data, matIdx));
  }

  // 1. REAR VERTICAL DOWNWARD THRUSTER JETS (4 High-Horsepower Nozzles across Diffuser)
  // Aligned with the 4 titanium diffuser nozzle bells: x = [-0.34, -0.12, 0.12, 0.34], z = -1.22
  // Extends from nozzle exit y = 0.16 down to ground contact y = -0.96 with intense Mach shock diamonds
  const downNozzleX = [0.34, 0.12, -0.12, -0.34];
  for (const x of downNozzleX) {
    const z = -1.22;
    // Core high-velocity supersonic needle (concentrated white-hot kinetic thrust)
    addVerticalPlume(buildConePrimitive([x, 0.16, z], [x, -0.96, z], 0.026, 0.062, 16), coldGasCoreMatIdx);

    // 5 Supersonic Mach Shock Diamonds (repeating oblique shock nodes in supersonic stream)
    addVerticalPlume(buildBiconePrimitive([x, 0.04, z], 0.032, 0.026, 'y', 14), machDiamondMatIdx);
    addVerticalPlume(buildBiconePrimitive([x, -0.16, z], 0.040, 0.032, 'y', 14), machDiamondMatIdx);
    addVerticalPlume(buildBiconePrimitive([x, -0.36, z], 0.048, 0.036, 'y', 14), machDiamondMatIdx);
    addVerticalPlume(buildBiconePrimitive([x, -0.56, z], 0.056, 0.042, 'y', 14), machDiamondMatIdx);
    addVerticalPlume(buildBiconePrimitive([x, -0.76, z], 0.064, 0.048, 'y', 14), machDiamondMatIdx);

    // Supersonic expansion boundary sheath
    addVerticalPlume(buildConePrimitive([x, 0.16, z], [x, -0.96, z], 0.050, 0.155, 18), coldGasSheathMatIdx);

    // Outer turbulent aerodynamic expansion cone
    addVerticalPlume(buildConePrimitive([x, 0.14, z], [x, -0.98, z], 0.075, 0.225, 18), coldGasSheathMatIdx);

    // Ground impact blast dome and massive rolling vapor cloud mounds across tarmac
    addVerticalPlume(buildDomePrimitive([x, -0.98, z], 0.38, 0.13, 0.38, 6, 16), groundBillowMatIdx);
    addVerticalPlume(buildDomePrimitive([x, -0.98, z - 0.22], 0.35, 0.11, 0.32, 6, 14), groundBillowMatIdx);
    addVerticalPlume(buildDomePrimitive([x + 0.12, -0.98, z - 0.08], 0.30, 0.10, 0.30, 6, 14), groundBillowMatIdx);
    addVerticalPlume(buildDomePrimitive([x - 0.12, -0.98, z - 0.08], 0.30, 0.10, 0.30, 6, 14), groundBillowMatIdx);
    addVerticalPlume(buildDomePrimitive([x * 1.35, -0.98, z + 0.08], 0.32, 0.11, 0.32, 6, 14), groundBillowMatIdx);
    addVerticalPlume(buildDomePrimitive([x, -0.98, z + 0.20], 0.28, 0.09, 0.26, 6, 14), groundBillowMatIdx);
  }

  // 2. FRONT SUBFRAME DOWNWARD VTOL COLD-GAS HOVER JETS (Left & Right Front)
  const frontVTOLX = [0.36, -0.36];
  for (const x of frontVTOLX) {
    const z = 0.85;
    addVerticalPlume(buildConePrimitive([x, 0.09, z], [x, -0.96, z], 0.022, 0.055, 14), coldGasCoreMatIdx);
    addVerticalPlume(buildBiconePrimitive([x, -0.06, z], 0.030, 0.025, 'y', 12), machDiamondMatIdx);
    addVerticalPlume(buildBiconePrimitive([x, -0.28, z], 0.042, 0.034, 'y', 12), machDiamondMatIdx);
    addVerticalPlume(buildBiconePrimitive([x, -0.52, z], 0.052, 0.040, 'y', 12), machDiamondMatIdx);
    addVerticalPlume(buildBiconePrimitive([x, -0.74, z], 0.060, 0.046, 'y', 12), machDiamondMatIdx);
    addVerticalPlume(buildConePrimitive([x, 0.09, z], [x, -0.96, z], 0.044, 0.140, 16), coldGasSheathMatIdx);
    addVerticalPlume(buildDomePrimitive([x, -0.98, z], 0.32, 0.11, 0.32, 6, 14), groundBillowMatIdx);
    addVerticalPlume(buildDomePrimitive([x, -0.98, z - 0.16], 0.28, 0.09, 0.26, 6, 12), groundBillowMatIdx);
  }

  // 3. REARWARD HORIZONTAL COLD-GAS SPRINT THRUSTERS (4 Nozzles Behind Rear License Plate)
  const rearHorizontalX = [0.18, 0.06, -0.06, -0.18];
  for (const x of rearHorizontalX) {
    const y = 0.385;
    const zStart = -1.37;
    // Mach needle core shooting straight backwards
    addHorizontalPlume(buildConePrimitive([x, y, zStart], [x, y, -2.45], 0.020, 0.048, 14), coldGasCoreMatIdx);

    // 3 Mach shock diamonds along horizontal Z axis
    addHorizontalPlume(buildBiconePrimitive([x, y, -1.60], 0.028, 0.030, 'z', 12), machDiamondMatIdx);
    addHorizontalPlume(buildBiconePrimitive([x, y, -1.88], 0.036, 0.036, 'z', 12), machDiamondMatIdx);
    addHorizontalPlume(buildBiconePrimitive([x, y, -2.18], 0.045, 0.042, 'z', 12), machDiamondMatIdx);

    // Supersonic expansion sheath
    addHorizontalPlume(buildConePrimitive([x, y, zStart], [x, y, -2.55], 0.040, 0.115, 16), coldGasSheathMatIdx);

    // Outer turbulent supersonic envelope
    addHorizontalPlume(buildConePrimitive([x, y, zStart], [x, y, -2.70], 0.058, 0.155, 16), coldGasSheathMatIdx);
  }

  const verticalThrusterMeshIdx = chassis.meshes.length;
  chassis.meshes.push({
    name: 'SpaceX_Vertical_Thrusters_Mesh',
    primitives: verticalPlumePrims,
  });

  const horizontalThrusterMeshIdx = chassis.meshes.length;
  chassis.meshes.push({
    name: 'SpaceX_Horizontal_Thrusters_Mesh',
    primitives: horizontalPlumePrims,
  });

  const verticalThrusterNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'spacex_vertical_thrusters',
    mesh: verticalThrusterMeshIdx,
  });

  const horizontalThrusterNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'spacex_horizontal_thrusters',
    mesh: horizontalThrusterMeshIdx,
  });

  const parentThrusterNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'spacex_thruster_plumes',
    children: [verticalThrusterNodeIdx, horizontalThrusterNodeIdx],
  });
  sceneRootNode.children.push(parentThrusterNodeIdx);

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. DYNAMIC HIGH-INTENSITY BRAKE STOP LIGHTS (Active when stopping or braking)
  // ─────────────────────────────────────────────────────────────────────────────
  const brakeMatIdx = chassis.materials.length;
  chassis.materials.push({
    name: 'Tesla_High_Intensity_Brake_Light',
    pbrMetallicRoughness: {
      baseColorFactor: [0.98, 0.01, 0.02, 1.0],
      metallicFactor: 0.05,
      roughnessFactor: 0.10,
    },
    emissiveFactor: [4.5, 0.0, 0.0], // Pure vibrant saturated crimson red stop light
  });

  const brakeStripLeft = buildBoxPrimitive([ 0.28, 0.536, -1.335], [0.22, 0.009, 0.012], 0, 0, -0.06);
  const brakeStripRight = buildBoxPrimitive([-0.28, 0.536, -1.335], [0.22, 0.009, 0.012], 0, 0, 0.06);
  const brakeStripCenter = buildBoxPrimitive([ 0.00, 0.538, -1.330], [0.18, 0.008, 0.010]);

  const brakeLightMeshIdx = chassis.meshes.length;
  chassis.meshes.push({
    name: 'Tesla_Brake_Lights_Mesh',
    primitives: [
      appendGeometryPrimitive(chassis, baseBuffers, brakeStripLeft, brakeMatIdx),
      appendGeometryPrimitive(chassis, baseBuffers, brakeStripRight, brakeMatIdx),
      appendGeometryPrimitive(chassis, baseBuffers, brakeStripCenter, brakeMatIdx),
    ],
  });

  const brakeLightNodeIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'brake_lights_strip',
    mesh: brakeLightMeshIdx,
  });
  sceneRootNode.children.push(brakeLightNodeIdx);

  // Master Root Node calibrated to exact Car & Driver dimensions (4.51m L x 1.97m W x 1.27m H)
  // Shifted up by +0.6785m so that the tire contact patch rests EXACTLY at Y = 0.000m (cleanly on top of Cesium terrain tile)!
  const masterRootIdx = chassis.nodes.length;
  chassis.nodes.push({
    name: 'Tesla_Roadster_Root',
    children: [chassis.scenes[0].nodes[0]],
    scale: [1.5, 1.5, 1.5],
    translation: [0, 0.6785, 0],
  });
  chassis.scenes[0].nodes = [masterRootIdx];
  delete chassis.buffers[0].uri;

  function writeGlb(outPath: string, gltfObj: unknown, allBuffers: Buffer[]) {
    const combined = Buffer.concat(allBuffers);
    (gltfObj as { buffers: { byteLength: number }[] }).buffers[0].byteLength = combined.length;

    const jsonBuf = Buffer.from(JSON.stringify(gltfObj), 'utf8');
    const padJson = (4 - (jsonBuf.length % 4)) % 4;
    const finalJsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(padJson, 0x20)]);

    const padBin = (4 - (combined.length % 4)) % 4;
    const finalBinBuf = Buffer.concat([combined, Buffer.alloc(padBin, 0x00)]);

    const totalLen = 12 + 8 + finalJsonBuf.length + 8 + finalBinBuf.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546C67, 0); // 'glTF'
    header.writeUInt32LE(2, 4);          // version 2
    header.writeUInt32LE(totalLen, 8);

    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(finalJsonBuf.length, 0);
    jsonHeader.writeUInt32LE(0x4E4F534A, 4); // 'JSON'

    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(finalBinBuf.length, 0);
    binHeader.writeUInt32LE(0x004E4942, 4); // 'BIN\0'

    const glb = Buffer.concat([header, jsonHeader, finalJsonBuf, binHeader, finalBinBuf]);
    fs.writeFileSync(outPath, glb);
  }

  // 1. Coupe standard
  const coupeChassis = JSON.parse(JSON.stringify(chassis));
  writeGlb(path.resolve('public/models/roadster_coupe.glb'), coupeChassis, baseBuffers);
  writeGlb(path.resolve('public/models/roadster_coupe_fire.glb'), coupeChassis, baseBuffers);

  // 2. Targa Convertible (Removes the ENTIRE glass roof panel 'back windows_7' AND rear canopy 'back window_8', fully opening cabin to sky!)
  const roofNodeNames = ['back windows_7', 'back window_8'];
  const roofNodeIndices = roofNodeNames
    .map(name => chassis.nodes.findIndex((n: { name: string }) => n.name === name))
    .filter(idx => idx !== -1);

  const targaChassis = JSON.parse(JSON.stringify(chassis));
  const targaRoot = targaChassis.nodes[sceneRootNodeIdx];
  targaRoot.children = targaRoot.children.filter((id: number) => !roofNodeIndices.includes(id));
  writeGlb(path.resolve('public/models/roadster_targa.glb'), targaChassis, baseBuffers);
  writeGlb(path.resolve('public/models/roadster_targa_fire.glb'), targaChassis, baseBuffers);

  console.log('✅ Successfully compiled all 4 Tesla Roadster GLBs:');
  console.log('   - public/models/roadster_coupe.glb');
  console.log('   - public/models/roadster_coupe_fire.glb');
  console.log('   - public/models/roadster_targa.glb');
  console.log('   - public/models/roadster_targa_fire.glb');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateRoadsterGlbs();
}
