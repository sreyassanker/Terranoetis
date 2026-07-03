/* @ts-self-types="./idw_wasm.d.ts" */

export class KdNode {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KdNodeFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kdnode_free(ptr, 0);
    }
}
if (Symbol.dispose) KdNode.prototype[Symbol.dispose] = KdNode.prototype.free;

export class KdTree {
    static __wrap(ptr) {
        const obj = Object.create(KdTree.prototype);
        obj.__wbg_ptr = ptr;
        KdTreeFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KdTreeFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kdtree_free(ptr, 0);
    }
    /**
     * @param {Float64Array} lats
     * @param {Float64Array} lons
     * @param {Float64Array} values
     * @returns {KdTree}
     */
    static build(lats, lons, values) {
        const ptr0 = passArrayF64ToWasm0(lats, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(lons, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(values, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.kdtree_build(ptr0, len0, ptr1, len1, ptr2, len2);
        return KdTree.__wrap(ret);
    }
    /**
     * @param {number} lat
     * @param {number} lon
     * @param {number} k
     * @returns {Neighbor[]}
     */
    nearest_k(lat, lon, k) {
        const ret = wasm.kdtree_nearest_k(this.__wbg_ptr, lat, lon, k);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {KdTree}
     */
    static new() {
        const ret = wasm.kdtree_new();
        return KdTree.__wrap(ret);
    }
}
if (Symbol.dispose) KdTree.prototype[Symbol.dispose] = KdTree.prototype.free;

export class Neighbor {
    static __wrap(ptr) {
        const obj = Object.create(Neighbor.prototype);
        obj.__wbg_ptr = ptr;
        NeighborFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NeighborFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_neighbor_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get dist_sq() {
        const ret = wasm.__wbg_get_neighbor_dist_sq(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get lat() {
        const ret = wasm.__wbg_get_neighbor_lat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get lon() {
        const ret = wasm.__wbg_get_neighbor_lon(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get value() {
        const ret = wasm.__wbg_get_neighbor_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set dist_sq(arg0) {
        wasm.__wbg_set_neighbor_dist_sq(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set lat(arg0) {
        wasm.__wbg_set_neighbor_lat(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set lon(arg0) {
        wasm.__wbg_set_neighbor_lon(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set value(arg0) {
        wasm.__wbg_set_neighbor_value(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Neighbor.prototype[Symbol.dispose] = Neighbor.prototype.free;

/**
 * @param {Float64Array} lats
 * @param {Float64Array} lons
 * @param {Float64Array} values
 * @param {number} grid_lat_min
 * @param {number} grid_lat_max
 * @param {number} grid_lon_min
 * @param {number} grid_lon_max
 * @param {number} grid_width
 * @param {number} grid_height
 * @param {number} power
 * @param {number} neighbors
 * @returns {Float64Array}
 */
export function interpolate_idw(lats, lons, values, grid_lat_min, grid_lat_max, grid_lon_min, grid_lon_max, grid_width, grid_height, power, neighbors) {
    const ptr0 = passArrayF64ToWasm0(lats, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(lons, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(values, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.interpolate_idw(ptr0, len0, ptr1, len1, ptr2, len2, grid_lat_min, grid_lat_max, grid_lon_min, grid_lon_max, grid_width, grid_height, power, neighbors);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_neighbor_new: function(arg0) {
            const ret = Neighbor.__wrap(arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./idw_wasm_bg.js": import0,
    };
}

const KdNodeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kdnode_free(ptr, 1));
const KdTreeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kdtree_free(ptr, 1));
const NeighborFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_neighbor_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('idw_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
