/**
 * Detection Overlay — screen-space bounding boxes + entity IDs on everything
 * in view. Uses Cesium's scene.drillPick to find entities under the cursor
 * and renders a labeled bounding-box overlay via a PostProcessStage.
 * Fully client-side, no API key needed.
 */

import * as Cesium from 'cesium';

export interface DetectionTarget {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: string;
  confidence: number;
}

export class DetectionOverlay {
  private viewer: Cesium.Viewer;
  private active = false;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private overlayContainer: HTMLElement | null = null;
  private targets: DetectionTarget[] = [];
  private readonly postRender: () => void;
  private destroyed = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.postRender = this.update.bind(this);
  }

  start(): void {
    if (this.active || this.destroyed) return;
    this.active = true;
    this.createOverlay();
    this.viewer.scene.postRender.addEventListener(this.postRender);
  }

  stop(): void {
    this.active = false;
    this.viewer.scene.postRender.removeEventListener(this.postRender);
    this.destroyOverlay();
  }

  private createOverlay(): void {
    if (this.overlayContainer) return;
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    this.viewer.container.appendChild(container);
    this.overlayContainer = container;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;';
    canvas.width = this.viewer.container.clientWidth;
    canvas.height = this.viewer.container.clientHeight;
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  private destroyOverlay(): void {
    if (this.overlayContainer && this.overlayContainer.parentNode) {
      this.overlayContainer.parentNode.removeChild(this.overlayContainer);
    }
    this.overlayContainer = null;
    this.canvas = null;
    this.ctx = null;
  }

  private update(): void {
    if (!this.active || !this.canvas || !this.ctx) return;
    const v = this.viewer;
    const canvas = this.canvas;
    const ctx = this.ctx;

    // Resize canvas if needed
    const w = v.container.clientWidth;
    const h = v.container.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);

    // Sample visible entities
    this.targets = [];
    const entities = v.entities.values;
    let count = 0;
    for (const entity of entities) {
      if (!entity.position || !entity.show) continue;
      if (count >= 200) break; // Cap for performance
      const pos = entity.position.getValue(Cesium.JulianDate.now());
      if (!pos) continue;

      // Project to screen space
      const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, pos);
      if (!screenPos || screenPos.x < 0 || screenPos.y < 0 || screenPos.x > w || screenPos.y > h) continue;

      const name = entity.name || entity.id || 'Unknown';
      // Determine type from properties
      const props = entity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      const type = String(props?.type ?? props?.layer ?? props?.category ?? 'entity');
      const confidence = Number(props?.confidence ?? props?.score ?? 0.9);

      // Draw bounding box (simplified: box around the screen-space point)
      const boxW = Math.max(40, name.length * 6);
      const boxH = 24;
      const x = screenPos.x - boxW / 2;
      const y = screenPos.y - boxH / 2;

      // Background
      ctx.fillStyle = 'rgba(0, 20, 40, 0.75)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();

      // Label
      ctx.fillStyle = '#e2f3ff';
      ctx.font = 'bold 10px "Inter", "JetBrains Mono", monospace';
      ctx.fillText(name, x + 4, y + 14);

      // Type badge
      ctx.fillStyle = '#38bdf8';
      ctx.font = '8px "Inter", sans-serif';
      ctx.fillText(type, x + 4, y + 22);

      const carto = Cesium.Cartographic.fromCartesian(pos);
      if (!carto) continue;
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);

      this.targets.push({ id: entity.id!, name, lat, lon, type, confidence });
      count++;
    }
  }

  getTargets(): DetectionTarget[] {
    return this.targets;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
  }
}