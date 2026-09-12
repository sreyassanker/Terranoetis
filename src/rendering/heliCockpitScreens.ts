/**
 * In-scene cockpit instrument screens (Pillar B — B-Full, Phase 5).
 *
 * Each glass instrument is a small `Cesium.Primitive` quad parked on the
 * console geometry (fixed in the aircraft frame → real parallax + correct
 * occlusion by the canopy), textured with the Phase-0-proven path: a
 * `MaterialAppearance` fabric whose sampler2D uniform binds a LIVE
 * `HTMLCanvasElement` that Cesium re-uploads on change. The 2-D content is
 * painted by heliInstrPaint.ts at 30 Hz.
 *
 * Falls back cleanly: if anything throws during construction the DOM deck
 * (cockpitAnchors.projectDeck path) stays authoritative.
 */

import * as Cesium from 'cesium';
import { paintDiuAdi, paintDiuHsi, paintDdu, paintStby, type InstrData } from './heliInstrPaint';

interface ScreenSpec {
  id: string;
  /** HPR-frame anchor [right, nose, up] metres */
  p: [number, number, number];
  /** half-extents in metres (right, up) */
  hw: number; hh: number;
  /** canvas px */
  cw: number; ch: number;
  paint: (ctx: CanvasRenderingContext2D, d: InstrData) => void;
}

const SPECS: ScreenSpec[] = [
  { id: 'diuLeft',  p: [-0.32, 2.005, 0.95], hw: 0.162, hh: 0.136, cw: 256, ch: 214, paint: paintDiuAdi },
  { id: 'diuRight', p: [ 0.32, 2.005, 0.95], hw: 0.162, hh: 0.136, cw: 256, ch: 214, paint: paintDiuHsi },
  { id: 'ddu',      p: [ 0.00, 1.998, 0.63], hw: 0.176, hh: 0.096, cw: 256, ch: 140, paint: paintDdu },
  { id: 'stbyAdi',  p: [ 0.00, 1.720, 1.22], hw: 0.055, hh: 0.055, cw: 128, ch: 128, paint: paintStby },
];

interface Screen {
  spec: ScreenSpec;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  material: Cesium.Material;
  primitive: Cesium.Primitive;
}

export class CockpitScreenMgr {
  private screens: Screen[] = [];
  private acc = 0;
  private t = 0;
  live = false;
  frames = 0;
  lastData: InstrData | null = null;
  visible = false;
  flipV = true;

  private scene: Cesium.Scene;
  constructor(scene: Cesium.Scene) {
    this.scene = scene;
    try {
      for (const spec of SPECS) {
        const canvas = document.createElement('canvas');
        canvas.width = spec.cw; canvas.height = spec.ch;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#04080c'; ctx.fillRect(0, 0, spec.cw, spec.ch);
        const material = new Cesium.Material({
          fabric: {
            type: `HeliScreen_${spec.id}`,
            uniforms: { live: canvas },
            components: {
              diffuse: 'texture(live, materialInput.st).rgb',
              alpha: '1.0',
            },
          },
        });
        const { hw, hh, p } = spec;
        const v0 = this.flipV ? 1 : 0;
        const v1 = this.flipV ? 0 : 1;
        const pos = new Float64Array([
          -hw, p[1], p[2] - hh,   hw, p[1], p[2] - hh,   hw, p[1], p[2] + hh,   -hw, p[1], p[2] + hh,
        ]);
        const geom = new Cesium.Geometry({
          attributes: {
            position: new Cesium.GeometryAttribute({
              componentDatatype: Cesium.ComponentDatatype.DOUBLE,
              componentsPerAttribute: 3, values: pos,
            }),
            st: new Cesium.GeometryAttribute({
              componentDatatype: Cesium.ComponentDatatype.FLOAT,
              componentsPerAttribute: 2,
              values: new Float32Array([0, v0, 1, v0, 1, v1, 0, v1]),
            }),
          } as unknown as Cesium.GeometryAttributes,
          indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
          primitiveType: Cesium.PrimitiveType.TRIANGLES,
          boundingSphere: Cesium.BoundingSphere.fromVertices(pos, new Cesium.Cartesian3(p[0], 0, 0), 3),
        });
        const primitive = new Cesium.Primitive({
          geometryInstances: new Cesium.GeometryInstance({ geometry: geom }),
          appearance: new Cesium.MaterialAppearance({ material, flat: true, faceForward: true }),
          asynchronous: false,
        });
        primitive.show = false;
        this.scene.primitives.add(primitive);
        this.screens.push({ spec, canvas, ctx, material, primitive });
      }
      this.live = true;
    } catch (e) {
      this.destroy();
      this.live = false;
      console.warn('[HeliScreens] falling back to DOM deck:', e);
    }
  }

  setVisible(on: boolean) {
    this.visible = on;
    for (const sc of this.screens) sc.primitive.show = on;
  }

  update(dt: number, aircraftMatrix: Cesium.Matrix4, data: InstrData): void {
    if (!this.live) return;
    this.lastData = data;
    for (const sc of this.screens) {
      sc.primitive.modelMatrix = aircraftMatrix;   // quads are authored in the HPR-local frame
    }
    this.acc += dt; this.t += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    for (const sc of this.screens) {
      try { sc.spec.paint(sc.ctx, { ...data, clock: new Date().toISOString().slice(11, 19) }); }
      catch { /* paint failure must not kill the frame */ }
    }
    this.frames++;
  }

  get stats() {
    return { live: this.live, screens: this.screens.length, frames: this.frames, visible: this.visible };
  }

  destroy(): void {
    for (const sc of this.screens) {
      try { this.scene.primitives.remove(sc.primitive); } catch { /* already gone */ }
    }
    this.screens = [];
    this.live = false;
  }
}

export function buildInstrData(s: {
  iasKts: number; tasKts: number; gsKts: number; vsFpm: number; altM: number; aglM: number;
  pitchDeg: number; rollDeg: number; headingDeg: number; yawRateDps: number; sideslipDeg: number;
  rotorRpm: number; ngPct: number; torquePct: number; torqueCoeff: number; powerShp: number;
  collective: number; throttle: number; fuelKg: number; fuelMaxKg: number;
  windE: number; windN: number; windFromDeg: number; etlPct: number;
  engine: boolean; onGround: boolean; vrs: boolean;
}, avnDark: boolean): InstrData {
  return {
    iasKts: s.iasKts, tasKts: s.tasKts, gsKts: s.gsKts, vsFpm: s.vsFpm,
    altFt: s.altM * 3.28084, raFt: s.aglM * 3.28084,
    pitchDeg: s.pitchDeg, rollDeg: s.rollDeg, headingDeg: s.headingDeg, yawRateDps: s.yawRateDps,
    rpm: s.rotorRpm, ng: s.ngPct, torquePct: s.torquePct, ctPermille: s.torqueCoeff * 1000, shp: s.powerShp,
    collPct: s.collective * 100, thrPct: s.throttle * 100,
    fuelPct: (s.fuelKg / Math.max(1, s.fuelMaxKg)) * 100,
    windKt: Math.hypot(s.windE, s.windN) * 1.94384, windFromDeg: s.windFromDeg, etlPct: s.etlPct,
    sideslipDeg: s.sideslipDeg,
    engineOn: s.engine, onGround: s.onGround, vrs: s.vrs,
    avnDark,
    clock: '',
  };
}
