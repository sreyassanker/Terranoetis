/**
 * Photorealistic Globe — loads Google Photorealistic 3D Tiles (via Cesium Ion,
 * asset 2275207) as the base planet surface. This is the photorealistic
 * imagery + terrain stack the reference platform uses, but self-hosted through our Cesium Ion
 * token so it works with our existing infrastructure.
 *
 * Graceful degradation: if the tileset can't be reached (bad token / no access
 * / offline), we leave the existing World Terrain + imagery in place — the
 * app never breaks, it just falls back to the standard globe.
 */

import * as Cesium from 'cesium';

export const GOOGLE_PHOTOREALISTIC_ASSET_ID = 2275207;

export class PhotorealisticGlobe {
  private viewer: Cesium.Viewer;
  private tileset: Cesium.Cesium3DTileset | null = null;
  private active = false;
  private destroyed = false;
  /** True once a tileset was successfully added — the base is now photoreal. */
  private loaded = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  get isPhotoreal(): boolean {
    return this.loaded;
  }

  /** Attempt to load the Google Photorealistic 3D Tiles from Cesium Ion. */
  async enable(): Promise<boolean> {
    if (this.destroyed || this.active) return this.loaded;
    if (!Cesium.Ion.defaultAccessToken?.trim()) return false;
    this.active = true;
    try {
      this.tileset = await Cesium.Cesium3DTileset.fromIonAssetId(
        GOOGLE_PHOTOREALISTIC_ASSET_ID,
        {
          // Keep data-overlay rendering (our entities/primitives) crisp on top.
          maximumScreenSpaceError: 16,
          dynamicScreenSpaceError: true,
          dynamicScreenSpaceErrorDensity: 0.8,
        },
      );
      this.tileset.style = new Cesium.Cesium3DTileStyle({
        // Slightly darken the photoreal tiles so our colored data overlays
        // (heatmaps, traffic, sensors) pop on top.
        color: 'color() * vec4(0.9, 0.9, 0.92, 1.0)',
        show: true,
      });
      this.viewer.scene.primitives.add(this.tileset);
      // Photoreal tiles already include terrain height + imagery, so we can
      // drop the flat ellipsoid provider that the viewer was constructed with.
      // Keep the imagery layer below so atmosphere + fallback still render.
      this.loaded = true;
      this.viewer.scene.requestRender();
      return true;
    } catch (err) {
      console.warn('[Photorealistic] Google 3D Tiles unavailable — using standard globe.', (err as Error)?.message);
      this.tileset = null;
      this.loaded = false;
      this.active = false;
      return false;
    }
  }

  /** Remove the tileset and restore the standard globe. */
  disable(): void {
    if (this.tileset) {
      this.viewer.scene.primitives.remove(this.tileset);
      this.tileset = null;
    }
    this.loaded = false;
    this.active = false;
    this.viewer.scene.requestRender();
  }

  /** Toggle on/off. Returns the new photoreal state. */
  async toggle(): Promise<boolean> {
    if (this.active && this.loaded) {
      this.disable();
      return false;
    }
    return this.enable();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disable();
  }
}
