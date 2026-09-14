/**
 * Runtime glTF 2.0 builder shared by apacheModel (and future runtime models).
 *
 * - Meshes are registered as (positions, indices, material) parts; a node
 *   tree of GltfNodeSpec composes transforms, and at build() time everything
 *   is BAKED into one merged mesh per material, except nodes named in
 *   `preserveNodeNames` (e.g. spinning rotors) which stay as real scene-graph
 *   nodes whose matrices the caller can drive per-frame via
 *   Cesium Model.getNode(name).matrix.
 * - Output is a self-contained .glb data-URI (no external buffer files).
 */

export interface GltfMesh {
  pos: number[];
  idx: number[];
  normals?: number[];
}

export interface GltfMaterialSpec {
  base?: [number, number, number];
  metallic?: number;
  roughness?: number;
  opacity?: number;
  emissive?: [number, number, number];
  emissiveIntensity?: number;
  doubleSided?: boolean;
}

export interface GltfNodeSpec {
  name?: string;
  /** handle returned by addMesh(); undefined for pure group nodes */
  mesh?: number;
  matrix?: number[]; // column-major 4x4
  children?: GltfNodeSpec[];
}

export interface CompiledGltf {
  dataUri: string;
  /** preserved-node name → glTF node index */
  nodeMap: Map<string, number>;
  /** number of scene-graph nodes / draw primitives emitted */
  drawCount: number;
}

interface PendingPart {
  pos: number[];
  norm: Float32Array;
  idx: number[];
  material: number;
}

export interface BuildOptions {
  /** node names that must remain real scene-graph nodes (not baked). */
  preserveNodeNames?: Set<string>;
}

export class GltfBuilder {
  private readonly parts: PendingPart[] = [];
  private readonly materials: Record<string, unknown>[] = [];
  private readonly materialIndex = new Map<string, number>();
  private rootSpecs: GltfNodeSpec[] = [];

  constructor(_debug = false) { void _debug; }

  /** Register a mesh (part). Positions stay in the part's LOCAL space; node
   *  matrices compose them at build time. Returns a handle for GltfNodeSpec.mesh */
  addMesh(mesh: GltfMesh, material: GltfMaterialSpec = {}): number {
    const normal = mesh.normals
      ? new Float32Array(mesh.normals)
      : this.computeNormals(mesh.pos, mesh.idx, mesh.pos.length / 3);
    const handle = this.parts.length;
    this.parts.push({ pos: mesh.pos, norm: normal, idx: mesh.idx, material: this.addMaterial(material) });
    return handle;
  }

  /** Register a scene-graph node tree (called once per scene root). */
  registerNodes(roots: GltfNodeSpec[]): void {
    this.rootSpecs.push(...roots);
  }

  private computeNormals(pos: number[], idx: number[], count: number): Float32Array {
    const out = new Float32Array(count * 3);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { out[k * 3] += nx; out[k * 3 + 1] += ny; out[k * 3 + 2] += nz; }
    }
    for (let i = 0; i < count; i++) {
      const L = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
      if (L > 1e-6) { out[i * 3] /= L; out[i * 3 + 1] /= L; out[i * 3 + 2] /= L; }
    }
    return out;
  }

  private addMaterial(mat: GltfMaterialSpec): number {
    const key = JSON.stringify(mat);
    const existing = this.materialIndex.get(key);
    if (existing !== undefined) return existing;
    const json: Record<string, unknown> = {
      pbrMetallicRoughness: {
        baseColorFactor: [...(mat.base ?? [0.8, 0.8, 0.8]), mat.opacity ?? 1],
        metallicFactor: mat.metallic ?? 0.1,
        roughnessFactor: mat.roughness ?? 0.7,
      },
      name: `mat_${this.materials.length}`,
    };
    if (mat.emissive) {
      json.emissiveFactor = mat.emissive.map(v => Math.min(1, v));
      if (mat.emissiveIntensity && mat.emissiveIntensity > 1) {
        json.extensions = { KHR_materials_emissive_strength: { emissiveStrength: mat.emissiveIntensity } };
        json.extensionsRequired = undefined;
      }
    }
    if (mat.opacity !== undefined && mat.opacity < 1) {
      json.alphaMode = 'BLEND';
      json.doubleSided = true;
    } else if (mat.doubleSided) {
      json.doubleSided = true;
    }
    const idx = this.materials.length;
    this.materials.push(json);
    this.materialIndex.set(key, idx);
    return idx;
  }

/* ═════════ build: bake tree → merged per-material buckets + preserved cuts ═════════ */

build(opts: BuildOptions = {}): CompiledGltf {
    const preserve = opts.preserveNodeNames ?? new Set<string>();
    const nodeMap = new Map<string, number>();
    const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const mul = (a: number[], b: number[]): number[] => {
      const out = new Array(16).fill(0) as number[];
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      return out;
    };

    interface Bucket { material: number; pos: number[]; norm: number[]; idx: number[] }
    interface Cut { name: string; matrix: number[]; buckets: Map<number, Bucket> }

    const bakeInto = (b: Bucket, M: number[], part: PendingPart) => {
      const base = b.pos.length / 3;
      for (let i = 0; i < part.pos.length; i += 3) {
        const x = part.pos[i], y = part.pos[i + 1], z = part.pos[i + 2];
        b.pos.push(
          M[0] * x + M[4] * y + M[8] * z + M[12],
          M[1] * x + M[5] * y + M[9] * z + M[13],
          M[2] * x + M[6] * y + M[10] * z + M[14],
        );
        const nx = part.norm[i], ny = part.norm[i + 1], nz = part.norm[i + 2];
        const tx = M[0] * nx + M[4] * ny + M[8] * nz;
        const ty = M[1] * nx + M[5] * ny + M[9] * nz;
        const tz = M[2] * nx + M[6] * ny + M[10] * nz;
        const l = Math.hypot(tx, ty, tz) || 1;
        b.norm.push(tx / l, ty / l, tz / l);
      }
      for (const i of part.idx) b.idx.push(i + base);
    };

    const gltfNodes: Record<string, unknown>[] = [];
    const emitBucketNode = (b: Bucket, parentChildren: number[]): void => {
      const meshIdx = this.pushMeshFromArrays(b.pos, b.norm, b.idx, b.material);
      const nodeIdx = gltfNodes.length;
      gltfNodes.push({ name: `geo_${nodeIdx}`, mesh: meshIdx });
      parentChildren.push(nodeIdx);
    };

    // Walk a subtree (children of a root/cut), baking parts per material.
    const collect = (specs: GltfNodeSpec[], acc: number[],
      buckets: Map<number, Bucket>, cuts: Cut[], parentOfCuts: Cut[]): void => {
      for (const spec of specs) {
        const cur = mul(acc, spec.matrix ?? ID);
        if (spec.name && preserve.has(spec.name)) {
          const cut: Cut = { name: spec.name, matrix: cur, buckets: new Map() };
          cuts.push(cut);
          collect(spec.children ?? [], ID, cut.buckets, [], []);
          void parentOfCuts;
          continue;
        }
        if (spec.mesh !== undefined) {
          const part = this.parts[spec.mesh];
          let b = buckets.get(part.material);
          if (!b) { b = { material: part.material, pos: [], norm: [], idx: [] }; buckets.set(part.material, b); }
          bakeInto(b, cur, part);
        }
        collect(spec.children ?? [], cur, buckets, cuts, parentOfCuts);
      }
    };

    const sceneChildren: number[] = [];
    for (const root of this.rootSpecs) {
      const buckets = new Map<number, Bucket>();
      const cuts: Cut[] = [];
      collect(root.children ?? [], ID, buckets, cuts, []);
      const nodeIdx = gltfNodes.length;
      const node: Record<string, unknown> & { children: number[] } = { children: [] };
      if (root.name) node.name = root.name;
      if (root.matrix) node.matrix = root.matrix;
      gltfNodes.push(node);
      sceneChildren.push(nodeIdx);
      const sortBuckets = (list: Bucket[]) => {
        return [...list].sort((a, b) => {
          const matA = this.materials[a.material] as { alphaMode?: string };
          const matB = this.materials[b.material] as { alphaMode?: string };
          const aBlend = matA?.alphaMode === 'BLEND' ? 1 : 0;
          const bBlend = matB?.alphaMode === 'BLEND' ? 1 : 0;
          return aBlend - bBlend;
        });
      };
      for (const b of sortBuckets([...buckets.values()])) emitBucketNode(b, node.children);
      for (const cut of cuts) {
        const cutIdx = gltfNodes.length;
        const cutNode: Record<string, unknown> & { children: number[] } = { name: cut.name, matrix: cut.matrix, children: [] };
        gltfNodes.push(cutNode);
        node.children.push(cutIdx);
        nodeMap.set(cut.name, cutIdx);
        for (const b of sortBuckets([...cut.buckets.values()])) emitBucketNode(b, cutNode.children);
      }
    }

    const compiled = this.serialize(gltfNodes, sceneChildren, nodeMap);
    return compiled;
  }

  private pushMeshFromArrays(pos: number[], norm: number[], idx: number[], material: number): number {
    const meshIndex = this.bakedMeshes.length;
    this.bakedMeshes.push({ pos: new Float32Array(pos), norm: new Float32Array(norm), idx: new Uint16Array(idx), material });
    return meshIndex;
  }

  private bakedMeshes: { pos: Float32Array; norm: Float32Array; idx: Uint16Array; material: number }[] = [];

  private serialize(
    nodes: Record<string, unknown>[],
    sceneChildren: number[], nodeMap: Map<string, number>,
  ): CompiledGltf {
    // Build the binary buffer + bufferViews/accessors from bakedMeshes.
    const bufferViews: { buffer: number; byteOffset: number; byteLength: number; target: number }[] = [];
    const accessors: Record<string, unknown>[] = [];
    const bufferParts: Uint8Array[] = [];
    let byteOffset = 0;
    const meshesOut: Record<string, unknown>[] = [];
    for (const bm of this.bakedMeshes) {
      if (bm.idx.length > 0 && Math.max(...bm.idx) > 65535) {
        throw new Error(`baked mesh has index overflow (${Math.max(...bm.idx)} verts)`);
      }
      const posView = this.addBufferView(bm.pos.buffer as ArrayBuffer, 34962, bufferParts, bufferViews, () => byteOffset);
      byteOffset = bufferViews[bufferViews.length - 1].byteOffset + this.pad4(bm.pos.byteLength);
      const normView = this.addBufferView(bm.norm.buffer as ArrayBuffer, 34962, bufferParts, bufferViews, () => byteOffset);
      byteOffset = bufferViews[bufferViews.length - 1].byteOffset + this.pad4(bm.norm.byteLength);
      const idxView = this.addBufferView(bm.idx.buffer as ArrayBuffer, 34963, bufferParts, bufferViews, () => byteOffset);
      byteOffset = bufferViews[bufferViews.length - 1].byteOffset + this.pad4(bm.idx.byteLength);
      const pMin = [Infinity, Infinity, Infinity], pMax = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < bm.pos.length; i += 3) for (let j = 0; j < 3; j++) {
        const v = bm.pos[i + j]; if (v < pMin[j]) pMin[j] = v; if (v > pMax[j]) pMax[j] = v;
      }
      const posA = accessors.length; accessors.push({ bufferView: posView, componentType: 5126, count: bm.pos.length / 3, type: 'VEC3', min: pMin, max: pMax });
      const normA = accessors.length; accessors.push({ bufferView: normView, componentType: 5126, count: bm.norm.length / 3, type: 'VEC3' });
      const idxA = accessors.length; accessors.push({ bufferView: idxView, componentType: 5123, count: bm.idx.length, type: 'SCALAR' });
      meshesOut.push({ primitives: [{ attributes: { POSITION: posA, NORMAL: normA }, indices: idxA, material: bm.material }] });
    }
    const bin = this.concat(bufferParts);
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: sceneChildren }],
      nodes,
      meshes: meshesOut,
      materials: this.materials,
      buffers: [{ byteLength: bin.length }],
      bufferViews,
      accessors,
      extensionsUsed: [...new Set(this.materials.flatMap(m => (m as { extensions?: Record<string, unknown> }).extensions ? Object.keys((m as { extensions: Record<string, unknown> }).extensions) : []))],
    };
    const jsonStr = JSON.stringify(json);
    const jsonBytes = new TextEncoder().encode(jsonStr);
    const jsonPad = this.pad4(jsonBytes.length) - jsonBytes.length;
    const binPad = this.pad4(bin.length) - bin.length;
    const jsonChunkLen = jsonBytes.length + jsonPad;
    const total = 12 + 8 + jsonChunkLen + 8 + bin.length + binPad;
    const out = new ArrayBuffer(total);
    const dv = new DataView(out);
    const bytes = new Uint8Array(out);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonChunkLen, true);
    dv.setUint32(16, 0x4e4f534a, true);
    bytes.set(jsonBytes, 20);
    bytes.fill(0x20, 20 + jsonBytes.length, 20 + jsonChunkLen);
    const binStart = 20 + jsonChunkLen;
    dv.setUint32(binStart, bin.length + binPad, true);
    dv.setUint32(binStart + 4, 0x004e4942, true);
    bytes.set(bin, binStart + 8);
    return { dataUri: 'data:model/gltf-binary;base64,' + this.b64(bytes), nodeMap, drawCount: meshesOut.length };
  }

  private addBufferView(arrayBuffer: ArrayBuffer, target: number, bufferParts: Uint8Array[], views: { buffer: number; byteOffset: number; byteLength: number; target: number }[], offsetFn: () => number): number {
    const bytes = new Uint8Array(arrayBuffer);
    const padded = new Uint8Array(this.pad4(bytes.length));
    padded.set(bytes);
    bufferParts.push(padded);
    const idx = views.length;
    views.push({ buffer: 0, byteOffset: offsetFn(), byteLength: bytes.length, target });
    return idx;
  }

  private pad4(n: number) { return n + ((4 - (n % 4)) % 4); }
  private concat(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }
  private b64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
}

/* ═══════════════ Primitive geometry builders (Three.js-parity shapes) ═══════════════ */

export function buildBoxMesh(sx: number, sy: number, sz: number): GltfMesh {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const pos = [
    -hx, -hy, -hz, hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz,
    -hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz,
  ];
  const idx = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  return { pos, idx };
}

export function buildCylinderMesh(radius: number, halfH: number, segments: number, radiusBottom = radius): GltfMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    pos.push(cosA * radius, halfH, sinA * radius);
    pos.push(cosA * radiusBottom, -halfH, sinA * radiusBottom);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  const topIdx = pos.length / 3; pos.push(0, halfH, 0);
  const botIdx = pos.length / 3; pos.push(0, -halfH, 0);
  for (let i = 0; i < segments; i++) {
    const a1 = i * 2, a2 = ((i + 1) % segments) * 2;
    idx.push(topIdx, a2, a1, botIdx, a1 + 1, a2 + 1);
  }
  return { pos, idx };
}

export function buildSphereMesh(radius: number, stacks = 10, slices = 12): GltfMesh {
  const pos: number[] = [];
  const normals: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * Math.PI;
    for (let j = 0; j <= slices; j++) {
      const theta = (j / slices) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      pos.push(x * radius, y * radius, z * radius);
      normals.push(x, y, z);
    }
  }
  const cols = slices + 1;
  for (let i = 0; i < stacks; i++) for (let j = 0; j < slices; j++) {
    const a = i * cols + j, b = a + 1, c = (i + 1) * cols + j, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return { pos, idx, normals };
}

export function buildHemisphereCapMesh(radius: number, height: number, stacks = 8, slices = 16): GltfMesh {
  const pos: number[] = [];
  const normals: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * (Math.PI / 2);
    for (let j = 0; j <= slices; j++) {
      const theta = (j / slices) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      const nx = x, ny = y * (radius / Math.max(0.01, height)), nz = z;
      const nlen = Math.hypot(nx, ny, nz) || 1;
      pos.push(x * radius, y * height, z * radius);
      normals.push(nx / nlen, ny / nlen, nz / nlen);
    }
  }
  const cols = slices + 1;
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * cols + j, b = a + 1, c = (i + 1) * cols + j, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const centerIdx = pos.length / 3;
  pos.push(0, 0, 0);
  normals.push(0, -1, 0);
  const bottomRingStart = stacks * cols;
  for (let j = 0; j < slices; j++) {
    idx.push(centerIdx, bottomRingStart + j, bottomRingStart + j + 1);
  }
  return { pos, idx, normals };
}

export function buildConeMesh(baseRadius: number, height: number, segments: number): GltfMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(Math.cos(a) * baseRadius, -height / 2, Math.sin(a) * baseRadius);
    pos.push(0, height / 2, 0);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 2, b + 1, (i + 1) * 2 + 1);
  }
  const capIdx = pos.length / 3; pos.push(0, -height / 2, 0);
  for (let i = 0; i < segments; i++) idx.push(capIdx, i * 2 + 2, i * 2);
  return { pos, idx };
}

export function buildTorusMesh(radius: number, tube: number, radial = 10, tubular = 22): GltfMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= radial; i++) {
    const u = (i / radial) * Math.PI * 2;
    for (let j = 0; j <= tubular; j++) {
      const v = (j / tubular) * Math.PI * 2;
      const cx = radius + tube * Math.cos(v);
      pos.push(cx * Math.cos(u), cx * Math.sin(u), tube * Math.sin(v));
    }
  }
  const cols = tubular + 1;
  for (let i = 0; i < radial; i++) for (let j = 0; j < tubular; j++) {
    const a = i * cols + j, b = a + 1, c = (i + 1) * cols + j, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return { pos, idx };
}

/** Triangle soup helper: build a mesh from explicit vertex/index arrays. */
export function rawMesh(pos: number[], idx: number[]): GltfMesh {
  return { pos, idx };
}

/** Builds a continuous seamless tubular sweep along a 3D polyline without individual segment caps. */
export function buildContinuousTubeMesh(pts: [number, number, number][], radius: number, radialSeg = 10): GltfMesh {
  if (pts.length < 2) return { pos: [], idx: [] };
  const pos: number[] = [];
  const idx: number[] = [];
  const normals: number[] = [];
  const n = pts.length;

  let prevNormal: [number, number, number] = [0, 1, 0];

  for (let i = 0; i < n; i++) {
    let tx = 0, ty = 0, tz = 0;
    if (i === 0) {
      tx = pts[1][0] - pts[0][0]; ty = pts[1][1] - pts[0][1]; tz = pts[1][2] - pts[0][2];
    } else if (i === n - 1) {
      tx = pts[n - 1][0] - pts[n - 2][0]; ty = pts[n - 1][1] - pts[n - 2][1]; tz = pts[n - 1][2] - pts[n - 2][2];
    } else {
      tx = pts[i + 1][0] - pts[i - 1][0]; ty = pts[i + 1][1] - pts[i - 1][1]; tz = pts[i + 1][2] - pts[i - 1][2];
    }
    const tlen = Math.hypot(tx, ty, tz) || 1;
    tx /= tlen; ty /= tlen; tz /= tlen;

    const dot = prevNormal[0] * tx + prevNormal[1] * ty + prevNormal[2] * tz;
    let nx = prevNormal[0] - dot * tx;
    let ny = prevNormal[1] - dot * ty;
    let nz = prevNormal[2] - dot * tz;
    let nlen = Math.hypot(nx, ny, nz);
    if (nlen < 1e-4) {
      const altX = Math.abs(tx) > 0.9 ? 0 : 1;
      const altY = Math.abs(tx) > 0.9 ? 1 : 0;
      const altZ = 0;
      const dotAlt = altX * tx + altY * ty + altZ * tz;
      nx = altX - dotAlt * tx;
      ny = altY - dotAlt * ty;
      nz = altZ - dotAlt * tz;
      nlen = Math.hypot(nx, ny, nz) || 1;
    }
    nx /= nlen; ny /= nlen; nz /= nlen;
    prevNormal = [nx, ny, nz];

    const bx = ty * nz - tz * ny;
    const by = tz * nx - tx * nz;
    const bz = tx * ny - ty * nx;

    for (let s = 0; s <= radialSeg; s++) {
      const angle = (s / radialSeg) * Math.PI * 2;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const vx = nx * cosA + bx * sinA;
      const vy = ny * cosA + by * sinA;
      const vz = nz * cosA + bz * sinA;
      pos.push(pts[i][0] + vx * radius, pts[i][1] + vy * radius, pts[i][2] + vz * radius);
      normals.push(vx, vy, vz);
    }
  }

  const cols = radialSeg + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < radialSeg; s++) {
      const a = i * cols + s;
      const b = a + 1;
      const c = (i + 1) * cols + s;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { pos, idx, normals };
}