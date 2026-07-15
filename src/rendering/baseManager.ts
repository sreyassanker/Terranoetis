/**
 * BaseManager
 * Abstract base class for all military module managers.
 * Extracts common patterns to eliminate boilerplate across 19 managers:
 *   - Cesium Viewer reference
 *   - Enable/disable lifecycle with clearAll
 *   - Typed onUpdate callbacks
 *   - Cesium entity tracking and cleanup
 */

import * as Cesium from 'cesium';

export abstract class BaseManager<TStatus = void> {
  protected viewer: Cesium.Viewer;
  protected enabled = false;
  protected cesiumEntities = new Map<string, Cesium.Entity>();
  protected updateCallbacks: Array<(status: TStatus) => void> = [];

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  /* ── Lifecycle ─────────────────────────────────────────── */

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.clearAll();
    } else {
      this.renderAll();
    }
    this.notifyUpdate();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /* ── Entity Helpers ────────────────────────────────────── */

  /** Add a single Cesium entity tracked by id. Replaces existing. */
  protected createEntity(id: string, options: Record<string, unknown>): Cesium.Entity {
    this.removeEntity(id);
    const entity = this.viewer.entities.add(options);
    this.cesiumEntities.set(id, entity);
    return entity;
  }

  /** Remove a tracked Cesium entity */
  protected removeEntity(id: string): void {
    const ent = this.cesiumEntities.get(id);
    if (ent) {
      this.viewer.entities.remove(ent);
      this.cesiumEntities.delete(id);
    }
  }

  /* ── Update Callbacks ──────────────────────────────────── */

  onUpdate(cb: (status: TStatus) => void): void {
    this.updateCallbacks.push(cb);
  }

  protected notifyUpdate(): void {
    const status = this.getStatus();
    for (const cb of this.updateCallbacks) cb(status);
  }

  /* ── Subclass hooks ────────────────────────────────────── */

  /** Override to provide typed status for update callbacks */
  protected getStatus(): TStatus {
    return undefined as TStatus;
  }

  /** Called when the manager is enabled to re-render all data */
  protected renderAll(): void {
    // Subclasses override to re-render persisted data on enable
  }

  /* ── Cleanup ───────────────────────────────────────────── */

  clearAll(): void {
    for (const ent of this.cesiumEntities.values()) {
      this.viewer.entities.remove(ent);
    }
    this.cesiumEntities.clear();
  }

  /** Full cleanup - call on component unmount */
  destroy(): void {
    this.clearAll();
    this.updateCallbacks = [];
  }
}
