import * as Cesium from 'cesium';

/**
 * Cesium runtime GPU APIs that the published TypeScript defs omit but that
 * exist at runtime (Texture, Sampler, TextureWrap construction, per-context
 * context access, and the appearance uniform / lifecycle members). These loose
 * structural types let the GPU primitives use the real runtime surface without
 * `any`, while the Cesium-typed members keep full type checking.
 */

export interface LooseTexture {
  isDestroyed(): boolean;
  destroy(): void;
  type?: string;
}

export interface LooseMaterialAppearance extends Cesium.MaterialAppearance {
  isDestroyed(): boolean;
  destroy(): void;
  uniforms?: Record<string, unknown>;
}

export type RuntimeCesium = typeof Cesium & {
  Sampler: new (opts: {
    wrapS: number;
    wrapT: number;
    minificationFilter: number;
    magnificationFilter: number;
  }) => unknown;
  Texture: new (opts: {
    context: unknown;
    source: { arrayBufferView: ArrayBufferView; width: number; height: number };
    pixelFormat: number;
    pixelDatatype: number;
    sampler: unknown;
    flipY: boolean;
  }) => LooseTexture;
  TextureWrap: { CLAMP_TO_EDGE: number };
};

export function runtimeCesium(): RuntimeCesium {
  return Cesium as unknown as RuntimeCesium;
}

export function sceneContext(viewer: Cesium.Viewer): unknown {
  return (viewer.scene as unknown as { context?: unknown }).context;
}
