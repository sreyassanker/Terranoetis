import { Rectangle, Cartographic, Ellipsoid } from "cesium";

export const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1] as const;

export class SimulationGrid {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly cellSizeM: number;
  readonly rectangle: Rectangle;
  private readonly lonStep: number;
  private readonly latStep: number;

  constructor(rectangle: Rectangle, targetCellSizeM: number, maxCells = 512 * 512) {
    this.rectangle = rectangle;
    const midLat = (rectangle.north + rectangle.south) / 2;
    const widthM = rectangle.width * Math.cos(midLat) * Ellipsoid.WGS84.maximumRadius;
    const heightM = rectangle.height * Ellipsoid.WGS84.maximumRadius;

    let cell = targetCellSizeM;
    while ((widthM / cell) * (heightM / cell) > maxCells) cell *= 1.5;

    this.cellSizeM = cell;
    this.width = Math.max(8, Math.round(widthM / cell));
    this.height = Math.max(8, Math.round(heightM / cell));
    this.size = this.width * this.height;
    this.lonStep = rectangle.width / this.width;
    this.latStep = rectangle.height / this.height;
  }

  index(x: number, y: number): number { return y * this.width + x; }
  inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.width && y < this.height; }

  cellToCarto(x: number, y: number, out = new Cartographic()): Cartographic {
    out.longitude = this.rectangle.west + (x + 0.5) * this.lonStep;
    out.latitude = this.rectangle.north - (y + 0.5) * this.latStep;
    out.height = 0;
    return out;
  }

  cartoToCell(c: Cartographic): { x: number; y: number } {
    return {
      x: Math.floor((c.longitude - this.rectangle.west) / this.lonStep),
      y: Math.floor((this.rectangle.north - c.latitude) / this.latStep),
    };
  }

  sampleBilinear(field: Float32Array, fx: number, fy: number): number {
    const x0 = Math.max(0, Math.min(this.width - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(this.height - 2, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - x0));
    const ty = Math.min(1, Math.max(0, fy - y0));
    const i = this.index(x0, y0);
    const a = field[i], b = field[i + 1], c = field[i + this.width], d = field[i + this.width + 1];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }

  rasterizePolygon(polygon: Cartographic[]): Uint8Array {
    const mask = new Uint8Array(this.size);
    const n = polygon.length;
    const carto = new Cartographic();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.cellToCarto(x, y, carto);
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const pi = polygon[i], pj = polygon[j];
          if ((pi.latitude > carto.latitude) !== (pj.latitude > carto.latitude) &&
              carto.longitude < ((pj.longitude - pi.longitude) * (carto.latitude - pi.latitude)) /
                (pj.latitude - pi.latitude) + pi.longitude) {
            inside = !inside;
          }
        }
        if (inside) mask[this.index(x, y)] = 1;
      }
    }
    return mask;
  }
}
