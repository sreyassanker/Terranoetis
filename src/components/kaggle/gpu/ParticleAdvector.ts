/**
 * ParticleAdvector.ts — CPU-advected particles through a time-varying velocity
 * field, rendered as Cesium PointPrimitives (perspective-correct 3D points).
 *
 * This is the classic CFD "stream tracer" seeding approach: particles seeded on
 * active flow cells, integrated with a fixed time-step, recycled when they die.
 *
 * All heavy data (vx/vy grids) stays on the CPU as plain arrays — only position
 * writes touch Cesium's PointPrimitiveCollection, which is fast for ~2–5k points.
 */

import * as Cesium from 'cesium';
import { cellToWorld } from './fieldData';
import type { GeoFrame } from './fieldData';
import type { GridData } from '../shared';
import { colormapEvaluate, type CfaColormapName } from './cfdColormaps';

export interface ParticleAdvectorOptions {
  viewer: Cesium.Viewer;
  frame: GeoFrame;
  gs: number;
  cellSizeM: number;
  /** All-frames vx series [F,R,C]. */
  vxSeries: GridData;
  /** All-frames vy series [F,R,C]. */
  vySeries: GridData;
  /** Only advect particles where depth > this (0 = everywhere). */
  depthThreshold?: number;
  /** Matching depth series [F,R,C], used for seeding + lifetime logic. */
  depthSeries?: GridData | null;
  /** Number of particles to maintain. Default 1500. */
  count?: number;
  /** Seconds of wall-clock time between advection steps. Default 0.05 (~20 fps CPU). */
  advectDt?: number;
  /**
   * Physical integration dt per advect step (seconds of sim time). Default 4.
   * Callers should clamp this to a CFL-safe value:
   *   simDtPerStep ≤ courantSafety × cellSizeM / maxSpeed
   * (the flood overlay sets it ≤ 0.4 × cellSizeM at 1 m/s peak surface flow).
   */
  simDtPerStep?: number;
  /** Particle lifetime range in seconds of wall time. Default [4, 14]. */
  lifeRangeSec?: [number, number];
  /** Particle pixel size range at speed 0/max. Default [2, 7]. */
  sizeRangePx?: [number, number];
  /** Colormap for speed-based coloring. */
  colormap?: CfaColormapName;
  /** Optional global alpha multiplier. Mutable post-construction via setOpacity. */
  alpha?: number;
  /**
   * Terrain elevation in meters [gs*gs]. When provided, particles ride on the
   * displaced water surface instead of the ellipsoid — required for any overlay
   * whose ScalarSurfacePrimitive pushes the sheet up by `exaggeration` meters.
   */
  surfaceTerrain?: ArrayLike<number> | null;
  /**
   * Vertical scale applied to `depth/maxValue` for particles when
   * `surfaceTerrain` + `surfaceMaxValue` are both set. Matches the surface
   * primitive's exaggeration, so tracers ride on the crest.
   */
  surfaceExaggerationM?: number;
  /** Normalization cap from the paired ScalarSurfacePrimitive (meters). */
  surfaceMaxValue?: number;
}

interface Particle {
  row: number; // fractional position in grid-space rows
  col: number; // fractional position in grid-space cols
  life: number; // remaining wall-clock seconds
  /** preallocated world-space position */
  cart: Cesium.Cartesian3;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prim: any; // PointPrimitive handle (typed loosely to avoid codegen drift)
}

export class ParticleAdvector {
  private readonly viewer: Cesium.Viewer;
  private readonly frame: GeoFrame;
  private readonly gs: number;
  private readonly cellSizeM: number;
  private readonly vx: GridData;
  private readonly vy: GridData;
  private readonly depth: GridData | null;
  private readonly depthThreshold: number;
  private readonly count: number;
  private readonly advectDt: number;
  private readonly simDtPerStep: number;
  private readonly lifeRange: [number, number];
  private readonly sizeRange: [number, number];
  private colormap: CfaColormapName;
  private alpha: number;
  private readonly surfaceTerrain: ArrayLike<number> | null;
  private readonly surfaceExaggerationM: number;
  private readonly surfaceMaxValue: number;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private collection: any = null; // PointPrimitiveCollection handle
  private readonly particles: Particle[] = [];
  private readonly scratch = new Cesium.Cartesian3();

  private currentFrame = 0;
  /** Per-frame start offsets into the flat [F,R,C] arrays — avoid per-frame copies. */
  private vxOff = 0;
  private vyOff = 0;
  private depthOff = 0;
  private resetCursor = 0;
  private running = false;
  private destroyed = false;
  private removeTick: (() => void) | null = null;
  private lastTime = 0;
  private acc = 0;

  constructor(opts: ParticleAdvectorOptions) {
    this.viewer = opts.viewer;
    this.frame = opts.frame;
    this.gs = opts.gs;
    this.cellSizeM = opts.cellSizeM;
    this.vx = opts.vxSeries;
    this.vy = opts.vySeries;
    this.depth = opts.depthSeries ?? null;
    this.depthThreshold = opts.depthThreshold ?? 0.02;
    this.count = opts.count ?? 1500;
    this.advectDt = opts.advectDt ?? 0.05;
    this.simDtPerStep = opts.simDtPerStep ?? 4;
    this.lifeRange = opts.lifeRangeSec ?? [4, 14];
    this.sizeRange = opts.sizeRangePx ?? [2, 7];
    this.colormap = opts.colormap ?? 'turbo';
    this.alpha = opts.alpha ?? 1.0;
    this.surfaceTerrain = opts.surfaceTerrain ?? null;
    this.surfaceExaggerationM = opts.surfaceExaggerationM ?? 0;
    this.surfaceMaxValue = opts.surfaceMaxValue ?? 1;

    this.setFrame(0);
  }

  /** Currently active animation frame (used when seeding/advecting). */
  setFrame(idx: number): void {
    const F = this.vx.shape[0];
    this.currentFrame = Math.max(0, Math.min(F - 1, idx));
    const N = this.gs * this.gs;
    const off = this.currentFrame * N;
    this.vxOff = off;
    this.vyOff = off;
    this.depthOff = off;
  }

  /** Begin advection hooks into Cesium's clock tick. */
  start(): void {
    if (this.destroyed || this.running) return;
    this.running = true;
    this.ensureParticles();
    this.seedAll();
    this.lastTime = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.acc += dt;
      const step = this.advectDt;
      while (this.acc >= step) {
        this.advect(step);
        this.acc -= step;
      }
    };
    this.viewer.clock.onTick.addEventListener(tick);
    this.removeTick = () => {
      this.viewer.clock.onTick.removeEventListener(tick);
    };
  }

  stop(): void {
    this.running = false;
    if (this.removeTick) {
      this.removeTick();
      this.removeTick = null;
    }
  }

  /** Swap the CPU-side colormap; applied on the next advection tick. */
  setColormap(name: CfaColormapName): void {
    this.colormap = name;
  }

  /** Global alpha multiplier applied on the next advection tick. */
  setOpacity(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }

  private createCollectionIfNeeded(): void {
    if (!this.collection && !this.destroyed) {
      this.collection = new Cesium.PointPrimitiveCollection();
      this.viewer.scene.primitives.add(this.collection as Cesium.PointPrimitiveCollection);
    }
  }

  private randomActiveCell(): { row: number; col: number } {
    const gs = this.gs;
    for (let tries = 0; tries < 24; tries++) {
      const row = Math.random() * (gs - 1);
      const col = Math.random() * (gs - 1);
      if (this.cellIsActive(row, col)) return { row, col };
    }
    this.resetCursor = (this.resetCursor + 1) % (gs * gs);
    return {
      row: Math.floor(this.resetCursor / gs),
      col: this.resetCursor % gs,
    };
  }

  private cellIsActive(row: number, col: number): boolean {
    const gs = this.gs;
    const r = Math.max(0, Math.min(gs - 1, Math.floor(row)));
    const c = Math.max(0, Math.min(gs - 1, Math.floor(col)));
    const i = r * gs + c;
    if (this.depth) {
      const depth = this.depth.values[this.depthOff + i];
      if (!Number.isFinite(depth) || depth < this.depthThreshold) return false;
    }
    const vx = this.vx.values[this.vxOff + i];
    const vy = this.vy.values[this.vyOff + i];
    return Number.isFinite(vx) && Number.isFinite(vy) && Math.hypot(vx, vy) > 0.005;
  }

  /**
   * Bilinear sample of the flat [R,C] field at fractional (row,col).
   * Wraps an offset-aware read so we never slice the flat series per frame.
   */
  private sampleAt(values: number[] | Float32Array, off: number, row: number, col: number): number {
    return sampleBilinearOffset(values, this.gs, this.gs, off, row, col);
  }

  /** Surface height in meters at fractional (row,col): terrain + displaced sheet. */
  private surfaceHeight(row: number, col: number): number {
    let h = 0;
    if (this.surfaceTerrain) {
      h = sampleBilinearOffset(this.surfaceTerrain as ArrayLike<number>, this.gs, this.gs, 0, row, col);
    }
    if (this.depth && this.surfaceExaggerationM > 0 && this.surfaceMaxValue > 0) {
      const d = sampleBilinearOffset(this.depth.values as ArrayLike<number>, this.gs, this.gs, this.depthOff, row, col);
      if (Number.isFinite(d)) {
        const norm = Math.max(0, Math.min(1, d / this.surfaceMaxValue));
        h += norm * this.surfaceExaggerationM;
      }
    }
    return h;
  }

  private seedAll(): void {
    for (const p of this.particles) {
      this.respawn(p);
    }
  }

  private respawn(p: Particle): void {
    const cell = this.randomActiveCell();
    p.row = cell.row;
    p.col = cell.col;
    p.life = randRange(this.lifeRange[0], this.lifeRange[1]);
  }

  private advect(dtWall: number): void {
    const rows = this.gs;
    const cols = this.gs;
    const cellM = this.cellSizeM;
    const simDt = this.simDtPerStep;

    for (const p of this.particles) {
      p.life -= dtWall;
      if (p.life <= 0 || p.row < 0 || p.col < 0 || p.row >= rows - 1 || p.col >= cols - 1) {
        this.respawn(p);
        continue;
      }
      const vx = this.sampleAt(this.vx.values, this.vxOff, p.row, p.col);
      const vy = this.sampleAt(this.vy.values, this.vyOff, p.row, p.col);
      // y component maps to row (south-positive = row+)
      p.row += (vy * simDt) / cellM;
      p.col += (vx * simDt) / cellM;
    }

    // Push latest positions to GPU point sprites in one batch update.
    for (const p of this.particles) {
      // Particles ride on the displaced surface sheet when configured;
      // otherwise they sit on bare terrain.
      const h = this.surfaceHeight(p.row, p.col);
      const w = cellToWorld(this.frame, p.col, p.row, h);
      Cesium.Cartesian3.fromElements(w.x, w.y, w.z, p.cart);

      const prim = p.prim;
      prim.position = p.cart;
      const idx = floorIdx(this.gs, p.row, p.col);
      const speed = Math.hypot(
        this.vx.values[this.vxOff + idx] || 0,
        this.vy.values[this.vyOff + idx] || 0,
      );
      const t = Math.min(1, speed / Math.max(1e-3, this.maxSpeedOfFrame()));
      const [r, g, b] = colormapEvaluate(this.colormap, t);
      const size = this.sizeRange[0] + (this.sizeRange[1] - this.sizeRange[0]) * t;
      prim.color = Cesium.Color.fromBytes(r, g, b, Math.round(this.alpha * 230));
      prim.pixelSize = size;
    }
  }

  private maxSpeedOfFrame(): number {
    let m = 1e-3;
    const N = this.gs * this.gs;
    const vx = this.vx.values;
    const vy = this.vy.values;
    const off = this.vxOff;
    for (let i = 0; i < N; i += 17) {
      const s = Math.hypot(vx[off + i] || 0, vy[off + i] || 0);
      if (s > m) m = s;
    }
    return m;
  }

  private ensureParticles(): void {
    this.createCollectionIfNeeded();
    while (this.particles.length < this.count) {
      const p: Particle = {
        row: 0,
        col: 0,
        life: 0,
        cart: new Cesium.Cartesian3(),
        prim: this.collection!.add({
          position: new Cesium.Cartesian3(),
          pixelSize: this.sizeRange[0],
          color: Cesium.Color.WHITE.withAlpha(0.0),
        }),
      };
      this.respawn(p);
      this.particles.push(p);
    }
  }

  startIfNew(): void {
    if (this.particles.length === 0) {
      this.ensureParticles();
    }
    this.start();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    if (this.collection) {
      this.viewer.scene.primitives.remove(this.collection as Cesium.PointPrimitiveCollection);
      this.collection = null;
    }
    this.particles.length = 0;
  }
}

function randRange(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function floorIdx(gs: number, row: number, col: number): number {
  const r = Math.max(0, Math.min(gs - 1, Math.floor(row)));
  const c = Math.max(0, Math.min(gs - 1, Math.floor(col)));
  return r * gs + c;
}

/**
 * Offset-aware bilinear sample of a flat [R,C] grid. Instead of slicing a
 * frame each tick, keep the whole [F,R,C] field and index into it with a
 * per-frame offset — zero allocation per frame change.
 */
function sampleBilinearOffset(
  grid: ArrayLike<number>,
  rows: number,
  cols: number,
  off: number,
  row: number,
  col: number,
): number {
  if (row < 0 || col < 0 || row > rows - 1 || col > cols - 1) return 0;
  const r0 = Math.floor(row);
  const c0 = Math.floor(col);
  const r1 = Math.min(rows - 1, r0 + 1);
  const c1 = Math.min(cols - 1, c0 + 1);
  const fr = row - r0;
  const fc = col - c0;
  const g00 = numOr(grid[off + r0 * cols + c0], 0);
  const g01 = numOr(grid[off + r0 * cols + c1], 0);
  const g10 = numOr(grid[off + r1 * cols + c0], 0);
  const g11 = numOr(grid[off + r1 * cols + c1], 0);
  return (
    g00 * (1 - fr) * (1 - fc) +
    g01 * (1 - fr) * fc +
    g10 * fr * (1 - fc) +
    g11 * fr * fc
  );
}

function numOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}
