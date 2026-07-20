import { Math as CMath } from "cesium";
import { SimulationGrid } from "../core/SimulationGrid";
import { LandCoverClass } from "../core/types";

const WORLDCOVER_TO_CLASS: Record<number, LandCoverClass> = {
  10: LandCoverClass.TreeCover, 20: LandCoverClass.Shrubland, 30: LandCoverClass.Grassland,
  40: LandCoverClass.Cropland, 50: LandCoverClass.BuiltUp, 60: LandCoverClass.Bare,
  70: LandCoverClass.SnowIce, 80: LandCoverClass.Water, 90: LandCoverClass.Wetland,
  95: LandCoverClass.Mangrove, 100: LandCoverClass.Grassland,
};
const PALETTE: [number, number, number, number][] = [
  [0, 100, 0, 10], [255, 187, 34, 20], [255, 255, 76, 30], [240, 150, 255, 40],
  [250, 0, 0, 50], [180, 180, 180, 60], [240, 240, 240, 70], [0, 100, 200, 80],
  [0, 150, 160, 90], [0, 207, 117, 95], [250, 230, 160, 100],
];

export class LandCoverProvider {
  async sample(grid: SimulationGrid): Promise<Uint8Array> {
    const r = grid.rectangle;
    const bbox = [CMath.toDegrees(r.west), CMath.toDegrees(r.south),
                  CMath.toDegrees(r.east), CMath.toDegrees(r.north)].join(",");
    const url = `https://services.terrascope.be/wms/v2?service=WMS&version=1.3.0&request=GetMap` +
      `&layers=WORLDCOVER_2021_MAP&styles=&format=image/png&transparent=false&crs=CRS:84` +
      `&bbox=${bbox}&width=${grid.width}&height=${grid.height}`;
    try {
      const img = await this.loadImage(url);
      return this.decode(img, grid);
    } catch {
      return new Uint8Array(grid.size).fill(LandCoverClass.Unknown);
    }
  }

  private loadImage(url: string): Promise<ImageBitmap> {
    return fetch(url).then((r) => { if (!r.ok) throw new Error(`WMS ${r.status}`); return r.blob(); })
      .then((b) => createImageBitmap(b));
  }

  private decode(img: ImageBitmap, grid: SimulationGrid): Uint8Array {
    const canvas = new OffscreenCanvas(grid.width, grid.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, grid.width, grid.height);
    const data = ctx.getImageData(0, 0, grid.width, grid.height).data;
    const out = new Uint8Array(grid.size);
    for (let i = 0; i < grid.size; i++) {
      const rr = data[i * 4], gg = data[i * 4 + 1], bb = data[i * 4 + 2];
      let bestCode = 60, bestDist = Infinity;
      for (const [pr, pg, pb, code] of PALETTE) {
        const d = (rr - pr) ** 2 + (gg - pg) ** 2 + (bb - pb) ** 2;
        if (d < bestDist) { bestDist = d; bestCode = code; }
      }
      out[i] = WORLDCOVER_TO_CLASS[bestCode] ?? LandCoverClass.Unknown;
    }
    return out;
  }
}
