/* tslint:disable */
/* eslint-disable */

export class KdNode {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

export class KdTree {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static build(lats: Float64Array, lons: Float64Array, values: Float64Array): KdTree;
    nearest_k(lat: number, lon: number, k: number): Neighbor[];
    static new(): KdTree;
}

export class Neighbor {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    dist_sq: number;
    lat: number;
    lon: number;
    value: number;
}

export function interpolate_idw(lats: Float64Array, lons: Float64Array, values: Float64Array, grid_lat_min: number, grid_lat_max: number, grid_lon_min: number, grid_lon_max: number, grid_width: number, grid_height: number, power: number, neighbors: number): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_neighbor_dist_sq: (a: number) => number;
    readonly __wbg_get_neighbor_lat: (a: number) => number;
    readonly __wbg_get_neighbor_lon: (a: number) => number;
    readonly __wbg_get_neighbor_value: (a: number) => number;
    readonly __wbg_kdnode_free: (a: number, b: number) => void;
    readonly __wbg_kdtree_free: (a: number, b: number) => void;
    readonly __wbg_neighbor_free: (a: number, b: number) => void;
    readonly __wbg_set_neighbor_dist_sq: (a: number, b: number) => void;
    readonly __wbg_set_neighbor_lat: (a: number, b: number) => void;
    readonly __wbg_set_neighbor_lon: (a: number, b: number) => void;
    readonly __wbg_set_neighbor_value: (a: number, b: number) => void;
    readonly interpolate_idw: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
    readonly kdtree_build: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly kdtree_nearest_k: (a: number, b: number, c: number, d: number) => [number, number];
    readonly kdtree_new: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
