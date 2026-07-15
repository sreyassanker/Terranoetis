import * as Cesium from 'cesium';
import { BaseManager } from '../baseManager';
import type { HadrEvent, HadrAsset, HadrRoute, HadrStatus } from './hadrTypes';

export class HadrManager extends BaseManager<HadrStatus> {
  private events = new Map<string, HadrEvent>();
  private assets = new Map<string, HadrAsset>();
  private routes = new Map<string, HadrRoute>();

  constructor(viewer: Cesium.Viewer) { super(viewer); }
  getEvents() { return Array.from(this.events.values()); }
  getAssets() { return Array.from(this.assets.values()); }
  getRoutes() { return Array.from(this.routes.values()); }
  addEvent(e: HadrEvent) { this.events.set(e.id, e); if (this.enabled) this.renderEvent(e); this.notifyUpdate(); }
  addAsset(a: HadrAsset) { this.assets.set(a.id, a); if (this.enabled) this.renderAsset(a); this.notifyUpdate(); }
  addRoute(r: HadrRoute) { this.routes.set(r.id, r); if (this.enabled) this.renderRoute(r); this.notifyUpdate(); }
  removeItem(id: string) { this.events.delete(id); this.assets.delete(id); this.routes.delete(id); this.removeEntity(`hadrevent_${id}`); this.removeEntity(`hadrasset_${id}`); this.removeEntity(`hadrroute_${id}`); this.notifyUpdate(); }
  getStatus(): HadrStatus { return { events: this.getEvents(), assets: this.getAssets(), routes: this.getRoutes(), totalAffected: this.getEvents().reduce((s, e) => s + e.affected, 0), activeOperations: this.getEvents().filter(e => e.status === 'active').length }; }
  private renderEvent(ev: HadrEvent) { const color = ev.severity === 'catastrophic' ? Cesium.Color.RED : ev.severity === 'severe' ? Cesium.Color.ORANGE : Cesium.Color.YELLOW; this.createEntity(`hadrevent_${ev.id}`, { id: `hadrevent_${ev.id}`, name: ev.name, position: Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat), point: { pixelSize: 12, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 }, label: { text: ev.name, font: '11px monospace', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -15) } }); }
  private renderAsset(a: HadrAsset) { this.createEntity(`hadrasset_${a.id}`, { id: `hadrasset_${a.id}`, name: a.name, position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat), point: { pixelSize: 8, color: Cesium.Color.BLUE } }); }
  private renderRoute(r: HadrRoute) { const positions = [Cesium.Cartesian3.fromDegrees(r.origin.lon, r.origin.lat), Cesium.Cartesian3.fromDegrees(r.destination.lon, r.destination.lat)]; const color = r.status === 'open' ? Cesium.Color.GREEN : r.status === 'blocked' ? Cesium.Color.RED : Cesium.Color.YELLOW; this.createEntity(`hadrroute_${r.id}`, { id: `hadrroute_${r.id}`, name: r.name, polyline: { positions, width: 3, material: color } }); }
  protected renderAll() { this.events.forEach(e => this.renderEvent(e)); this.assets.forEach(a => this.renderAsset(a)); this.routes.forEach(r => this.renderRoute(r)); }
}
