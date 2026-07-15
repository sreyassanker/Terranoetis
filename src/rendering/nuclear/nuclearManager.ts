import * as Cesium from 'cesium';
import { BaseManager } from '../baseManager';
import type { NuclearEvent, FalloutPlume, ContaminationZone, NuclearStatus } from './nuclearTypes';

export class NuclearManager extends BaseManager<NuclearStatus> {
  private events = new Map<string, NuclearEvent>();
  private plumes = new Map<string, FalloutPlume>();
  private zones = new Map<string, ContaminationZone>();

  constructor(viewer: Cesium.Viewer) { super(viewer); }
  getEvents() { return Array.from(this.events.values()); }
  getPlumes() { return Array.from(this.plumes.values()); }
  getZones() { return Array.from(this.zones.values()); }
  addEvent(e: NuclearEvent) { this.events.set(e.id, e); this.notifyUpdate(); }
  addPlume(p: FalloutPlume) { this.plumes.set(p.id, p); if (this.enabled) this.renderPlume(p); this.notifyUpdate(); }
  addZone(z: ContaminationZone) { this.zones.set(z.id, z); if (this.enabled) this.renderZone(z); this.notifyUpdate(); }
  removeItem(id: string) { this.events.delete(id); this.plumes.delete(id); this.zones.delete(id); this.removeEntity(`plume_${id}`); this.removeEntity(`zone_${id}`); this.notifyUpdate(); }
  getStatus(): NuclearStatus { return { events: this.getEvents(), plumes: this.getPlumes(), zones: this.getZones(), activeCount: this.events.size }; }
  private renderPlume(p: FalloutPlume) { this.createEntity(`plume_${p.id}`, { id: `plume_${p.id}`, name: 'Fallout Plume', polyline: { positions: p.segments.map(s => Cesium.Cartesian3.fromDegrees(s.lon, s.lat)), width: 4, material: Cesium.Color.YELLOW.withAlpha(0.5) } }); }
  private renderZone(z: ContaminationZone) { if (z.coordinates.length < 3) return; const pos = z.coordinates.map(c => Cesium.Cartesian3.fromDegrees(c.lon, c.lat)); pos.push(pos[0]); const color = z.severity === 'immediate_danger' ? Cesium.Color.RED : z.severity === 'emergency_protective' ? Cesium.Color.ORANGE : Cesium.Color.YELLOW; this.createEntity(`zone_${z.id}`, { id: `zone_${z.id}`, name: z.severity, polygon: { hierarchy: new Cesium.PolygonHierarchy(pos), material: color.withAlpha(0.3) } }); }
  protected renderAll() { this.plumes.forEach(p => this.renderPlume(p)); this.zones.forEach(z => this.renderZone(z)); }
}
