import * as Cesium from 'cesium';

/**
 * Registry for layers whose geometry is drawn by a batched primitive collection
 * rather than by `viewer.entities`.
 *
 * Cesium evaluates point/label entities through its dynamic visualizers, which
 * re-read roughly ten `Property` values per entity on every visualizer update.
 * For a layer of ~1,500 points that never move or change colour that is pure
 * overhead, so those layers render from a `PointPrimitiveCollection` instead.
 *
 * The `Cesium.Entity` objects still exist as detached carriers, so picking, the
 * info panel, the entity cap and nearby-search keep working unchanged. What
 * does NOT work unchanged is visibility: a `show` flag written to a detached
 * entity drives nothing, so every writer has to route through here.
 */
export interface PrimitiveLayerHandle {
  /** Whole-layer visibility — the sidebar toggle. */
  setShown(shown: boolean): void;
  /** Per-entity visibility, composed with the layer flag (fork cropping). */
  setEntityShown(entity: Cesium.Entity, shown: boolean): void;
  /** Number of primitives currently in the collection. */
  readonly size: number;
  destroy(): void;
}

const layers = new Map<string, PrimitiveLayerHandle>();

export function registerPrimitiveLayer(id: string, handle: PrimitiveLayerHandle): void {
  layers.set(id, handle);
}

export function getPrimitiveLayer(id: string): PrimitiveLayerHandle | undefined {
  return layers.get(id);
}

export function unregisterPrimitiveLayer(id: string): void {
  layers.delete(id);
}

/**
 * Apply per-entity visibility to a layer that may be entity- or
 * primitive-backed. Use this anywhere code writes `entity.show` directly.
 */
export function applyEntityShow(layerId: string, entity: Cesium.Entity, shown: boolean): void {
  const primitive = layers.get(layerId);
  if (primitive) primitive.setEntityShown(entity, shown);
  else entity.show = shown;
}
