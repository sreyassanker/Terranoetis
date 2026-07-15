import * as Cesium from 'cesium';
import { BaseManager } from '../baseManager';
import type { CyberThreat, CyberAsset_, CyberKillChain, CyberStatus } from './cyberTypes';

export class CyberManager extends BaseManager<CyberStatus> {
  private threats = new Map<string, CyberThreat>();
  private assets = new Map<string, CyberAsset_>();
  private killChains = new Map<string, CyberKillChain>();

  constructor(viewer: Cesium.Viewer) { super(viewer); }
  getThreats() { return Array.from(this.threats.values()); }
  getAssets() { return Array.from(this.assets.values()); }
  getKillChains() { return Array.from(this.killChains.values()); }
  addThreat(t: CyberThreat) { this.threats.set(t.id, t); if (this.enabled) this.renderThreat(t); this.notifyUpdate(); }
  addAsset(a: CyberAsset_) { this.assets.set(a.id, a); if (this.enabled) this.renderAsset(a); this.notifyUpdate(); }
  addKillChain(k: CyberKillChain) { this.killChains.set(k.id, k); this.notifyUpdate(); }
  removeItem(id: string) { this.threats.delete(id); this.assets.delete(id); this.killChains.delete(id); this.removeEntity(`cyber_${id}`); this.removeEntity(`asset_${id}`); this.notifyUpdate(); }
  getStatus(): CyberStatus { return { threats: this.getThreats(), assets: this.getAssets(), killChains: this.getKillChains(), activeThreats: this.getThreats().length, compromisedAssets: this.getAssets().filter(a => a.status === 'compromised').length }; }
  private renderThreat(t: CyberThreat) { this.createEntity(`cyber_${t.id}`, { id: `cyber_${t.id}`, name: t.name, position: Cesium.Cartesian3.fromDegrees(0, 0), label: { text: t.name, font: '10px monospace', fillColor: Cesium.Color.RED } }); }
  private renderAsset(a: CyberAsset_) { const color = a.status === 'compromised' ? Cesium.Color.RED : a.status === 'operational' ? Cesium.Color.GREEN : Cesium.Color.YELLOW; this.createEntity(`asset_${a.id}`, { id: `asset_${a.id}`, name: a.name, position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat), point: { pixelSize: 8, color } }); }
  protected renderAll() { this.assets.forEach(a => this.renderAsset(a)); this.threats.forEach(t => this.renderThreat(t)); }
}
