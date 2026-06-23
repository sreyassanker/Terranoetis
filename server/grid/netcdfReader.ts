interface H5WasmModule {
  ready: Promise<void>;
  File: new (path: string, mode: string) => { close: () => void; keys: () => Iterable<string>; get: (name: string) => { type: string; value: unknown } | null };
}

let h5wasmMod: H5WasmModule | null = null;
async function getH5(): Promise<H5WasmModule> {
  if (!h5wasmMod) h5wasmMod = await import('h5wasm/node') as unknown as H5WasmModule;
  await h5wasmMod.ready;
  return h5wasmMod;
}

export interface GridSubset {
  lats: number[];
  lons: number[];
  values: number[];
  valueMin: number;
  valueMax: number;
  variableName: string;
}

export interface BBox {
  latMin: number; latMax: number;
  lonMin: number; lonMax: number;
}

function readDataset(f: { get: (name: string) => { type: string; value: unknown } | null }, name: string): number[] | null {
  try {
    const item = f.get(name);
    if (!item || item.type !== 'Dataset') return null;
    const val = item.value;
    if (val == null) return null;
    if (typeof val === 'object' && 'length' in val) return Array.from(val as ArrayLike<number>);
    return [Number(val)];
  } catch { return null; }
}

function findBounds(arr: number[], min: number, max: number): [number, number] {
  let lo = 0, hi = arr.length - 1;
  while (lo < arr.length - 1 && arr[lo + 1] <= min) lo++;
  while (hi > 0 && arr[hi - 1] >= max) hi--;
  return [lo, hi];
}

export async function openFile(filePath: string): Promise<H5File> {
  const mod = await getH5();
  const f = new mod.File(filePath, 'r');
  const allKeys: string[] = [];
  for (const key of f.keys()) allKeys.push(String(key));
  return { file: f, keys: allKeys, mod };
}

export interface H5File {
  file: { close: () => void; keys: () => Iterable<string>; get: (name: string) => { type: string; value: unknown } | null };
  keys: string[];
  mod: unknown;
}

export function closeFile(h5: H5File): void {
  try { h5.file.close(); } catch { /* noop */ }
}

export async function queryVariableNames(filePath: string): Promise<string[]> {
  const mod = await getH5();
  const f = new mod.File(filePath, 'r');
  const keys: string[] = [];
  for (const key of f.keys()) keys.push(String(key));
  f.close();
  return keys;
}

export function readVariable(h5: H5File, name: string): number[] | null {
  return readDataset(h5.file, name);
}

export function subsetGrid(
  lats: number[],
  lons: number[],
  data: number[],
  variableName: string,
  bbox?: BBox,
  maxPoints = 8000,
): GridSubset {
  const nlats = lats.length;
  const nlons = lons.length;
  const isGrid = nlats > 1 && nlons > 1 && data.length === nlats * nlons;

  const points: { lat: number; lon: number; value: number }[] = [];

  if (isGrid) {
    const [iMin, iMax] = bbox ? findBounds(lats, bbox.latMin ?? -90, bbox.latMax ?? 90) : [0, nlats - 1];
    const [jMin, jMax] = bbox ? findBounds(lons, bbox.lonMin ?? -180, bbox.lonMax ?? 180) : [0, nlons - 1];
    const rangeLat = iMax - iMin + 1;
    const rangeLon = jMax - jMin + 1;
    const totalInRange = rangeLat * rangeLon;
    const step = Math.max(1, Math.floor(totalInRange / maxPoints));
    for (let idx = 0; idx < totalInRange; idx += step) {
      const i = iMin + Math.floor(idx / rangeLon);
      const j = jMin + (idx % rangeLon);
      const flatIdx = i * nlons + j;
      const val = data[flatIdx];
      if (val === -9999 || val === -9999.0 || isNaN(val)) continue;
      points.push({ lat: lats[i], lon: lons[j], value: val });
    }
  } else if (data.length === lats.length && data.length === lons.length) {
    const step = Math.max(1, Math.floor(data.length / maxPoints));
    for (let i = 0; i < data.length; i += step) {
      if (bbox && (lats[i] < (bbox.latMin ?? -90) || lats[i] > (bbox.latMax ?? 90) || lons[i] < (bbox.lonMin ?? -180) || lons[i] > (bbox.lonMax ?? 180))) continue;
      const val = data[i];
      if (val === -9999 || val === -9999.0 || isNaN(val)) continue;
      points.push({ lat: lats[i], lon: lons[i], value: val });
    }
  }

  const values = points.map(p => p.value);
  const valueMin = values.length > 0 ? Math.min(...values) : 0;
  const valueMax = values.length > 0 ? Math.max(...values) : 0;

  return {
    lats: points.map(p => p.lat),
    lons: points.map(p => p.lon),
    values,
    valueMin,
    valueMax,
    variableName,
  };
}

export function gridToPointCloud(grid: GridSubset): { x: number; y: number; z: number }[] {
  return grid.lats.map((lat, i) => {
    const latRad = lat * Math.PI / 180;
    const lonRad = grid.lons[i] * Math.PI / 180;
    return {
      x: Math.cos(latRad) * Math.cos(lonRad),
      y: Math.cos(latRad) * Math.sin(lonRad),
      z: Math.sin(latRad),
    };
  });
}
