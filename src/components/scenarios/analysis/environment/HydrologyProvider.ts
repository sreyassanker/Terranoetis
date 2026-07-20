import { Math as CMath, Cartographic } from "cesium";
import { SimulationGrid } from "../core/SimulationGrid";

export class HydrologyProvider {
  async riverMask(grid: SimulationGrid, flowAccumulation: Float32Array): Promise<Uint8Array> {
    const mask = new Uint8Array(grid.size);
    const r = grid.rectangle;
    const bbox = [CMath.toDegrees(r.south), CMath.toDegrees(r.west),
                  CMath.toDegrees(r.north), CMath.toDegrees(r.east)].join(",");
    const query = `[out:json][timeout:20];way["waterway"~"river|stream|canal"](${bbox});out geom;`;
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter",
        { method: "POST", body: query });
      const json = await res.json();
      for (const el of json.elements ?? []) {
        for (const pt of el.geometry ?? []) {
          const cell = grid.cartoToCell(new Cartographic(
            CMath.toRadians(pt.lon), CMath.toRadians(pt.lat), 0));
          if (grid.inBounds(cell.x, cell.y)) mask[grid.index(cell.x, cell.y)] = 1;
        }
      }
    } catch { /* fall through to DEM-derived channels */ }

    const threshold = grid.size * 0.02;
    for (let i = 0; i < grid.size; i++) if (flowAccumulation[i] > threshold) mask[i] = 1;
    return mask;
  }
}
