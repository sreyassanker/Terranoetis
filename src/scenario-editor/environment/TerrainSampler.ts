import { sampleTerrainMostDetailed, Cartographic, type TerrainProvider } from "cesium";
import { SimulationGrid, D8_DX, D8_DY } from "../core/SimulationGrid";

export interface TerrainFields {
  elevation: Float32Array;
  slopeDeg: Float32Array;
  aspectDeg: Float32Array;
  flowDirection: Int8Array;
  flowAccumulation: Float32Array;
}

export class TerrainSampler {
  private terrainProvider: TerrainProvider;
  constructor(terrainProvider: TerrainProvider) {
    this.terrainProvider = terrainProvider;
  }

  async sample(grid: SimulationGrid, onProgress?: (f: number) => void): Promise<TerrainFields> {
    const elevation = new Float32Array(grid.size);
    const BATCH = 2048;
    const positions: Cartographic[] = new Array(Math.min(BATCH, grid.size));

    for (let start = 0; start < grid.size; start += BATCH) {
      const count = Math.min(BATCH, grid.size - start);
      for (let k = 0; k < count; k++) {
        const i = start + k;
        positions[k] = grid.cellToCarto(i % grid.width, Math.floor(i / grid.width), positions[k]);
      }
      const batch = positions.slice(0, count);
      await sampleTerrainMostDetailed(this.terrainProvider, batch);
      for (let k = 0; k < count; k++) elevation[start + k] = batch[k].height ?? 0;
      onProgress?.((start + count) / grid.size);
    }

    const { slopeDeg, aspectDeg } = this.computeSlopeAspect(grid, elevation);
    const flowDirection = this.computeD8(grid, elevation);
    const flowAccumulation = this.computeFlowAccumulation(grid, elevation, flowDirection);
    return { elevation, slopeDeg, aspectDeg, flowDirection, flowAccumulation };
  }

  private computeSlopeAspect(grid: SimulationGrid, z: Float32Array) {
    const slopeDeg = new Float32Array(grid.size);
    const aspectDeg = new Float32Array(grid.size);
    const c = grid.cellSizeM, W = grid.width, H = grid.height;
    const at = (x: number, y: number) =>
      z[grid.index(Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(H - 1, y)))];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dzdx = ((at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
                      (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))) / (8 * c);
        const dzdy = ((at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
                      (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))) / (8 * c);
        const i = grid.index(x, y);
        slopeDeg[i] = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
        aspectDeg[i] = ((Math.atan2(dzdy, -dzdx) * 180 / Math.PI) + 360) % 360;
      }
    }
    return { slopeDeg, aspectDeg };
  }

  private computeD8(grid: SimulationGrid, z: Float32Array): Int8Array {
    const dir = new Int8Array(grid.size).fill(-1);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const i = grid.index(x, y);
        let best = -1, bestDrop = 0;
        for (let d = 0; d < 8; d++) {
          const nx = x + D8_DX[d], ny = y + D8_DY[d];
          if (!grid.inBounds(nx, ny)) continue;
          const dist = (d % 2 === 0 ? 1 : Math.SQRT2) * grid.cellSizeM;
          const drop = (z[i] - z[grid.index(nx, ny)]) / dist;
          if (drop > bestDrop) { bestDrop = drop; best = d; }
        }
        dir[i] = best;
      }
    }
    return dir;
  }

  private computeFlowAccumulation(grid: SimulationGrid, z: Float32Array, dir: Int8Array): Float32Array {
    const acc = new Float32Array(grid.size).fill(1);
    const order = Array.from({ length: grid.size }, (_, i) => i)
      .sort((a, b) => z[b] - z[a]);
    for (const i of order) {
      const d = dir[i];
      if (d < 0) continue;
      const x = i % grid.width, y = Math.floor(i / grid.width);
      const nx = x + D8_DX[d], ny = y + D8_DY[d];
      if (grid.inBounds(nx, ny)) acc[grid.index(nx, ny)] += acc[i];
    }
    return acc;
  }
}
