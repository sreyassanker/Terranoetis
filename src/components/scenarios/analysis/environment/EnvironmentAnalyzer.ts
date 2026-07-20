import { Cartographic, Rectangle, Math as CMath, type TerrainProvider } from "cesium";
import { SimulationGrid } from "../core/SimulationGrid";
import type { EnvironmentSnapshot } from "../core/types";
import { LandCoverClass } from "../core/types";
import { TerrainSampler } from "./TerrainSampler";
import { LandCoverProvider } from "./LandCoverProvider";
import { WeatherProvider } from "./WeatherProvider";
import { HydrologyProvider } from "./HydrologyProvider";
import { HazardHistoryProvider } from "./HazardHistoryProvider";

export class EnvironmentAnalyzer {
  private terrainProvider: TerrainProvider;
  constructor(terrainProvider: TerrainProvider) {
    this.terrainProvider = terrainProvider;
  }

  async analyze(
    polygon: Cartographic[],
    onProgress: (step: string, fraction: number) => void,
  ): Promise<{ grid: SimulationGrid; env: EnvironmentSnapshot }> {
    const rectangle = this.boundingRectangle(polygon);
    const grid = new SimulationGrid(rectangle, 30);

    onProgress("Sampling digital elevation model", 0.05);
    const terrain = await new TerrainSampler(this.terrainProvider)
      .sample(grid, (f) => onProgress("Sampling digital elevation model", 0.05 + f * 0.45));

    onProgress("Retrieving land cover, weather, hydrology, hazard history", 0.55);
    const [landCover, weather, hazards] = await Promise.all([
      new LandCoverProvider().sample(grid),
      new WeatherProvider().current(rectangle),
      new HazardHistoryProvider().query(rectangle),
    ]);
    const riverMask = await new HydrologyProvider().riverMask(grid, terrain.flowAccumulation);

    onProgress("Deriving environmental statistics", 0.9);
    const insideMask = grid.rasterizePolygon(polygon);
    const stats = this.computeStats(grid, terrain.elevation, terrain.slopeDeg, landCover, riverMask, insideMask);

    onProgress("Analysis complete", 1);
    return {
      grid,
      env: {
        rectangle, polygon, gridWidth: grid.width, gridHeight: grid.height,
        cellSizeM: grid.cellSizeM, insideMask, riverMask, weather, hazards, stats,
        elevation: terrain.elevation, slopeDeg: terrain.slopeDeg, aspectDeg: terrain.aspectDeg,
        flowDirection: terrain.flowDirection, flowAccumulation: terrain.flowAccumulation,
        landCover,
      },
    };
  }

  private boundingRectangle(polygon: Cartographic[], paddingFraction = 0.05): Rectangle {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const p of polygon) {
      w = Math.min(w, p.longitude); e = Math.max(e, p.longitude);
      s = Math.min(s, p.latitude); n = Math.max(n, p.latitude);
    }
    const padLon = (e - w) * paddingFraction, padLat = (n - s) * paddingFraction;
    return Rectangle.fromDegrees(
      CMath.toDegrees(w - padLon),
      CMath.toDegrees(s - padLat),
      CMath.toDegrees(e + padLon),
      CMath.toDegrees(n + padLat),
    );
  }

  private computeStats(
    grid: SimulationGrid, z: Float32Array, slope: Float32Array,
    lc: Uint8Array, rivers: Uint8Array, inside: Uint8Array,
  ) {
    let min = Infinity, max = -Infinity, sumZ = 0, sumSlope = 0, n = 0;
    let ocean = 0, veg = 0, urban = 0, river = 0;
    const isWater = (i: number) => z[i] < 0 || lc[i] === LandCoverClass.Water;

    for (let i = 0; i < grid.size; i++) {
      if (!inside[i]) continue;
      n++;
      min = Math.min(min, z[i]); max = Math.max(max, z[i]);
      sumZ += z[i]; sumSlope += slope[i];
      if (isWater(i)) ocean++;
      if (lc[i] === LandCoverClass.TreeCover || lc[i] === LandCoverClass.Shrubland ||
          lc[i] === LandCoverClass.Grassland || lc[i] === LandCoverClass.Mangrove) veg++;
      if (lc[i] === LandCoverClass.BuiltUp) urban++;
      if (rivers[i]) river++;
    }

    const oceanConnected = this.oceanTouchesEdge(grid, z, lc);
    let coastEdges = 0;
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width - 1; x++) {
      const a = grid.index(x, y), b = a + 1;
      if (isWater(a) !== isWater(b)) coastEdges++;
    }

    return {
      minElevationM: n ? min : 0, maxElevationM: n ? max : 0,
      meanElevationM: n ? sumZ / n : 0, meanSlopeDeg: n ? sumSlope / n : 0,
      oceanFraction: n ? ocean / n : 0, vegetationFraction: n ? veg / n : 0,
      urbanFraction: n ? urban / n : 0, riverFraction: n ? river / n : 0,
      oceanConnected, coastlineLengthM: coastEdges * grid.cellSizeM,
    };
  }

  private oceanTouchesEdge(grid: SimulationGrid, z: Float32Array, lc: Uint8Array): boolean {
    const isWater = (i: number) => z[i] < 0 || lc[i] === LandCoverClass.Water;
    for (let x = 0; x < grid.width; x++) {
      if (isWater(grid.index(x, 0)) || isWater(grid.index(x, grid.height - 1))) return true;
    }
    for (let y = 0; y < grid.height; y++) {
      if (isWater(grid.index(0, y)) || isWater(grid.index(grid.width - 1, y))) return true;
    }
    return false;
  }
}
