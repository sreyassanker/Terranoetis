/**
 * 3D Aircraft Hangar — upgrades the flat glyph billboards used by the aviation
 * layers into real Cesium 3D models on close approach (LOD swap).
 *
 * the reference platform swaps glyph → per-class 3D model as you close in (787, ATR-72, Citation,
 * Bell 206, MQ-9). We do the same, with self-contained glTF models built at
 * runtime — one per aircraft class (airliner, regional/prop, helicopter,
 * military jet) — so it works offline with zero downloads and no extra API
 * keys. The models are real Cesium.Model geometry, picked by heuristics from
 * the live aircraft metadata (callsign / category), not a single generic shape.
 */

import * as Cesium from 'cesium';

export const AIRCRAFT_HANGAR_LOD_KM = 120; // swap to 3D model below this camera distance

export type AircraftClass = 'airliner' | 'regional' | 'helicopter' | 'military';

/** Map a live aircraft entity's metadata (callsign / category / props) to a
 *  3D model class. Deterministic heuristics — no fabrications, just selects
 *  the best-fitting real geometry. */
export function classifyAircraft(
  name: string,
  callsign: string,
  props: Record<string, unknown>,
): AircraftClass {
  const all = `${name} ${callsign} ${props.type ?? ''} ${props.category ?? ''} ${props.callsign ?? ''}`.toUpperCase();
  const heli = /HELI|ROTOR|H60|UH-|AH-|BELL|R22|EC1|AS3|AW1|SA3|R44|H145|H135/i;
  // Military aircraft callsign prefixes (RCH=Reach, CMB=Camber, HKY=Husky,
  // BURT, GUCCI, COBRA, etc.) plus airframe designators.
  const mil = /MIL|MILITARY|RCH|CMB|HKY|COBRA|VIPER|BURT|GUCCI|JEEP|F-1[5-9]|F1[6-9]|F-2[2-3]|F22|F35|SU-|MIG|RAFALE|TYPHOON|MQ-|RQ-|T-1|T-3|T-6|T-38|E-3|E-7|KC-|C-130|C-17|C-5|P-3|P-8|B-1|B-2|B-52|TU-|JAS/i;
  if (heli.test(all)) return 'helicopter';
  if (mil.test(all)) return 'military';
  const regional = /ATR|CRJ|E17|E19|E12|E13|E22|E24|EMB|Q400|DH8|B190|C208|PC-1|PC-2|PIPER|CESSNA|BEECH|KING|KODIAK|TBM|DASH/i;
  if (regional.test(all)) return 'regional';
  return 'airliner';
}

/* ── glTF builders (shared) ── */

interface Mesh { pos: number[]; idx: number[]; }

function mergeMeshes(meshes: Mesh[]): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (const m of meshes) {
    positions.push(...m.pos);
    for (const i of m.idx) indices.push(i + base);
    base += m.pos.length / 3;
  }
  return { positions, indices };
}

function buildCylinder(radius: number, halfH: number, segments: number): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    pos.push(x, halfH, z);
    pos.push(x, -halfH, z);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2);
    idx.push(b + 2, b + 1, b + 3);
  }
  const topIdx = pos.length / 3; pos.push(0, halfH, 0);
  const botIdx = pos.length / 3; pos.push(0, -halfH, 0);
  for (let i = 0; i < segments; i++) {
    const a1 = i * 2;
    const a2 = ((i + 1) % segments) * 2;
    idx.push(topIdx, a2, a1);
    idx.push(botIdx, a1 + 1, a2 + 1);
  }
  return { pos, idx };
}

function buildBox(sx: number, sy: number, sz: number): Mesh {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const pos = [
    -hx, -hy, -hz,  hx, -hy, -hz,  hx,  hy, -hz, -hx,  hy, -hz,
    -hx, -hy,  hz,  hx, -hy,  hz,  hx,  hy,  hz, -hx,  hy,  hz,
  ];
  const idx = [0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1, 1,5,6, 1,6,2, 2,6,7, 2,7,3, 3,7,4, 3,4,0];
  return { pos, idx };
}

function translateBox(pos: number[], tx: number, ty: number, tz: number): number[] {
  const out = [...pos];
  for (let i = 0; i < out.length; i += 3) { out[i] += tx; out[i + 1] += ty; out[i + 2] += tz; }
  return out;
}

/** Assemble a glTF binary data-URI from merged meshes. */
function toGltfDataUri(merged: { positions: number[]; indices: number[] }): string {
  const posArray = new Float32Array(merged.positions);
  const idxArray = new Uint16Array(merged.indices);
  const posBytes = new Uint8Array(posArray.buffer);
  const idxBytes = new Uint8Array(idxArray.buffer);

  const normals = new Float32Array(merged.positions.length);
  for (let i = 0; i < merged.indices.length; i += 3) {
    const a = merged.indices[i], b = merged.indices[i + 1], c = merged.indices[i + 2];
    const ax = merged.positions[a * 3], ay = merged.positions[a * 3 + 1], az = merged.positions[a * 3 + 2];
    const bx = merged.positions[b * 3], by = merged.positions[b * 3 + 1], bz = merged.positions[b * 3 + 2];
    const cx = merged.positions[c * 3], cy = merged.positions[c * 3 + 1], cz = merged.positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    for (const k of [a, b, c]) {
      normals[k * 3] += nx / len; normals[k * 3 + 1] += ny / len; normals[k * 3 + 2] += nz / len;
    }
  }
  const normalBytes = new Uint8Array(normals.buffer);

  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.88, 0.92, 1.0], metallicFactor: 0.1, roughnessFactor: 0.6 } }],
    buffers: [{ byteLength: posBytes.length + normalBytes.length + idxBytes.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length, byteLength: normalBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length + normalBytes.length, byteLength: idxBytes.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: merged.positions.length / 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: merged.positions.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: merged.indices.length, type: 'SCALAR' },
    ],
  };
  const jsonStr = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const bin = concatBuffers(posBytes, normalBytes, idxBytes);
  const pad4 = (n: number) => (4 - (n % 4)) % 4;
  const jsonPad = pad4(jsonBytes.length);
  const binPad = pad4(bin.length);
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true);
  dv.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(binStart, bin.length + binPad, true);
  dv.setUint32(binStart + 4, 0x004e4942, true);
  bytes.set(bin, binStart + 8);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:model/gltf-binary;base64,' + btoa(binary);
}

function concatBuffers(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/* ── Per-class airframes ── */

/** Twin-engine narrow-body airliner (787/737-class silhouette). */
function buildAirliner(): Mesh[] {
  const fuselage = buildCylinder(0.6, 5, 12);
  const wings = buildBox(3.4, 0.12, 0.9);
  const tail = buildBox(1.2, 0.1, 0.5);
  const fin = buildBox(0.1, 1.4, 0.7);
  const engine = buildCylinder(0.3, 0.9, 8);
  const nose = buildCylinder(0.45, 1.2, 10);
  return [
    fuselage,
    { pos: wings.pos, idx: wings.idx },
    { pos: translateBox(tail.pos, 0, 1.1, -1.6), idx: tail.idx },
    { pos: translateBox(fin.pos, 0, 0.6, -1.2), idx: fin.idx },
    { pos: translateBox(nose.pos, 0, 0, 0.55), idx: nose.idx },
    { pos: translateBox(engine.pos, -1.2, -0.5, 0.4), idx: engine.idx },
    { pos: translateBox(engine.pos, 1.2, -0.5, 0.4), idx: engine.idx },
  ];
}

/** Regional turboprop (ATR / Dash-8 silhouette) — high straight wing, T-tail. */
function buildRegional(): Mesh[] {
  const fuselage = buildCylinder(0.45, 3.8, 10);
  const wings = buildBox(3.6, 0.1, 0.8);
  const tail = buildBox(0.9, 0.08, 0.4);
  const fin = buildBox(0.08, 1.2, 0.6);
  const propHub = buildCylinder(0.1, 0.3, 8);
  const blade = buildBox(0.02, 1.4, 0.08);
  return [
    fuselage,
    { pos: wings.pos, idx: wings.idx },
    { pos: translateBox(tail.pos, 0, 1.0, -1.2), idx: tail.idx },
    { pos: translateBox(fin.pos, 0, 0.55, -1.0), idx: fin.idx },
    // engines + props at wing tips
    { pos: translateBox(propHub.pos, -1.8, 0.1, 0.1), idx: propHub.idx },
    { pos: translateBox(blade.pos, -1.8, 0.1, 0.1), idx: blade.idx },
    { pos: translateBox(propHub.pos, 1.8, 0.1, 0.1), idx: propHub.idx },
    { pos: translateBox(blade.pos, 1.8, 0.1, 0.1), idx: blade.idx },
  ];
}

/** Helicopter — fuselage pod + tail boom + main/tail rotors (Bell 206-style). */
function buildHelicopter(): Mesh[] {
  const pod = buildCylinder(0.5, 1.0, 10);
  const boom = buildCylinder(0.12, 1.6, 8);
  const mast = buildCylinder(0.06, 0.5, 6);
  const rotorHub = buildCylinder(0.12, 0.08, 6);
  const mainBlade = buildBox(0.05, 2.6, 0.12);
  const tailRotor = buildBox(0.03, 0.9, 0.1);
  const skid = buildBox(0.9, 0.05, 0.05);
  return [
    { pos: pod.pos, idx: pod.idx },
    { pos: translateBox(boom.pos, 0, 0.2, 2.0), idx: boom.idx },
    { pos: translateBox(mast.pos, 0, 1.0, -0.2), idx: mast.idx },
    { pos: translateBox(rotorHub.pos, 0, 1.3, -0.2), idx: rotorHub.idx },
    { pos: translateBox(mainBlade.pos, 0, 1.3, -0.2), idx: mainBlade.idx },
    { pos: translateBox(tailRotor.pos, 0, 0.7, 3.4), idx: tailRotor.idx },
    { pos: translateBox(skid.pos, 0, -0.5, 0.2), idx: skid.idx },
  ];
}

/** Military jet — swept delta wing, twin tails (F-16 / F-35 silhouette). */
function buildMilitary(): Mesh[] {
  const fuselage = buildCylinder(0.4, 3.6, 10);
  const wings = buildBox(3.0, 0.08, 0.7);
  const tail = buildBox(0.8, 0.06, 0.35);
  const fin = buildBox(0.06, 1.1, 0.5);
  const engine = buildCylinder(0.2, 0.8, 8);
  const canopy = buildCylinder(0.22, 0.9, 8);
  return [
    fuselage,
    { pos: wings.pos, idx: wings.idx },
    { pos: translateBox(tail.pos, 0, 0.8, -1.2), idx: tail.idx },
    { pos: translateBox(fin.pos, 0, 0.5, -1.0), idx: fin.idx },
    { pos: translateBox(engine.pos, 0, -0.35, -1.4), idx: engine.idx },
    { pos: translateBox(canopy.pos, 0, 0.3, 0.4), idx: canopy.idx },
  ];
}

const GLTF_CACHE = new Map<AircraftClass, string>();
export function getAircraftGltf(cls: AircraftClass): string {
  let uri = GLTF_CACHE.get(cls);
  if (uri) return uri;
  const mesh =
    cls === 'helicopter' ? buildHelicopter() :
    cls === 'military' ? buildMilitary() :
    cls === 'regional' ? buildRegional() :
    buildAirliner();
  uri = toGltfDataUri(mergeMeshes(mesh));
  GLTF_CACHE.set(cls, uri);
  return uri;
}

/** Back-compat aliases. */
export function getAirlinerGltf(): string {
  return getAircraftGltf('airliner');
}
export function buildAirlinerGltf(): string {
  return getAirlinerGltf();
}

/**
 * LOD manager: watches camera distance and swaps aircraft glyphs → models
 * (and back). Cheap — only scans entities near the camera.
 */
export class AircraftHangar {
  private viewer: Cesium.Viewer;
  private enabled = false;
  private modelCache = new Map<string, Cesium.Entity>();
  private readonly removeListener: () => void;
  private destroyed = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.removeListener = this.update.bind(this);
  }

  start(): void {
    if (this.enabled || this.destroyed) return;
    this.enabled = true;
    this.viewer.scene.postRender.addEventListener(this.removeListener);
  }

  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.viewer.scene.postRender.removeEventListener(this.removeListener);
    // Revert any active models back to their source glyph entities.
    for (const model of this.modelCache.values()) {
      if (model) this.viewer.entities.remove(model);
    }
    this.modelCache.clear();
  }

  private update(): void {
    if (!this.enabled || this.destroyed) return;
    const cam = this.viewer.camera.positionCartographic;
    const camLat = Cesium.Math.toDegrees(cam.latitude);
    const camLon = Cesium.Math.toDegrees(cam.longitude);

    // Scan the viewer's own entities with aviation-layer properties.
    const candidates: Cesium.Entity[] = [];
    for (const e of this.viewer.entities.values) {
      const layer = (e.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined)?.layer;
      if (typeof layer === 'string' && (layer.includes('flight') || layer.includes('adsb') || layer.includes('military')) && !e.model) {
        candidates.push(e);
      }
    }

    for (const e of candidates) {
      if (!e.position) continue;
      const pos = e.position.getValue(Cesium.JulianDate.now());
      if (!pos) continue;
      const carto = Cesium.Cartographic.fromCartesian(pos as Cesium.Cartesian3);
      if (!carto) continue;
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const distKm = haversineKm(camLat, camLon, lat, lon);
      const key = e.id ?? '';
      const hasModel = this.modelCache.has(key);

      if (distKm < AIRCRAFT_HANGAR_LOD_KM && !hasModel) {
        // Swap in a 3D model (keep heading from the glyph rotation if available).
        let heading = 0;
        const rot = e.billboard?.rotation?.getValue(Cesium.JulianDate.now());
        if (typeof rot === 'number') heading = 90 - Cesium.Math.toDegrees(rot);
        const props = e.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
        if (props && Number.isFinite(Number(props.heading))) heading = Number(props.heading);
        const model = this.createModel(e, pos as Cesium.Cartesian3, heading);
        this.modelCache.set(key, model);
        // Hide the glyph so only the model shows.
        if (e.billboard) e.billboard.show = new Cesium.ConstantProperty(false);
        if (e.label) e.label.show = new Cesium.ConstantProperty(false);
      } else if (distKm >= AIRCRAFT_HANGAR_LOD_KM && hasModel) {
        const model = this.modelCache.get(key);
        if (model) this.viewer.entities.remove(model);
        this.modelCache.delete(key);
        if (e.billboard) e.billboard.show = new Cesium.ConstantProperty(true);
        if (e.label) e.label.show = new Cesium.ConstantProperty(true);
      }
    }
  }

  private createModel(e: Cesium.Entity, pos: Cesium.Cartesian3, headingDeg: number): Cesium.Entity {
    // Pick the 3D model class from the live aircraft metadata (callsign etc.).
    const props = (e.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined) ?? {};
    const callsign = String(props.callsign ?? props.flight ?? props.icao24 ?? '');
    const name = e.name || '';
    const cls = classifyAircraft(name, callsign, props);
    return this.viewer.entities.add({
      position: pos as unknown as Cesium.PositionProperty,
      orientation: Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0)),
      model: {
        uri: getAircraftGltf(cls),
        scale: cls === 'helicopter' ? 0.9 : cls === 'military' ? 0.7 : 0.5,
        silhouetteColor: Cesium.Color.WHITE,
        silhouetteSize: 0.5,
      },
      properties: { layer: 'aircraft_hangar', sourceEntityId: e.id, model: true, aircraftClass: cls },
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = Cesium.Math.toRadians(lat2 - lat1);
  const dLon = Cesium.Math.toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(Cesium.Math.toRadians(lat1)) * Math.cos(Cesium.Math.toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
