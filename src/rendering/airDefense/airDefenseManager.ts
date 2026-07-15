import * as Cesium from 'cesium';
import { BaseManager } from '../baseManager';
import type { MissileTrack, Interceptor, InterceptAttempt, AirDefenseZone, IamdStatus } from './airDefenseTypes';

export class AirDefenseManager extends BaseManager<IamdStatus> {
  private missileTracks = new Map<string, MissileTrack>();
  private interceptors = new Map<string, Interceptor>();
  private interceptAttempts = new Map<string, InterceptAttempt>();
  private zones = new Map<string, AirDefenseZone>();

  constructor(viewer: Cesium.Viewer) { super(viewer); }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.clearAll();
    this.notifyUpdate();
  }

  /* ── Missile Tracking ────────────────────────────────── */
  addMissileTrack(track: MissileTrack) {
    this.missileTracks.set(track.id, track);
    if (this.enabled) this.renderMissileTrack(track);
    this.notifyUpdate();
  }

  updateMissileTrack(id: string, updates: Partial<MissileTrack>) {
    const t = this.missileTracks.get(id);
    if (!t) return;
    Object.assign(t, updates, { lastUpdate: Date.now() });
    if (this.enabled) this.renderMissileTrack(t);
    this.notifyUpdate();
  }

  removeMissileTrack(id: string) {
    this.removeEntity(`ad_track_${id}`);
    this.removeEntity(`ad_trail_${id}`);
    this.removeEntity(`ad_impact_${id}`);
    this.missileTracks.delete(id);
    this.notifyUpdate();
  }

  getMissileTracks(): MissileTrack[] { return Array.from(this.missileTracks.values()); }

  /* ── Interceptors ────────────────────────────────────── */
  addInterceptor(interceptor: Interceptor) {
    this.interceptors.set(interceptor.id, interceptor);
    if (this.enabled && interceptor.lat != null && interceptor.lon != null) this.renderInterceptor(interceptor);
    this.notifyUpdate();
  }

  getInterceptors(): Interceptor[] { return Array.from(this.interceptors.values()); }

  /* ── Intercept Attempts ──────────────────────────────── */
  launchIntercept(attempt: InterceptAttempt) {
    this.interceptAttempts.set(attempt.id, attempt);
    const interceptor = this.interceptors.get(attempt.interceptorId);
    if (interceptor) {
      interceptor.quantity--;
      if (interceptor.quantity <= 0) interceptor.status = 'depleted';
    }
    if (this.enabled) this.renderIntercept(attempt);
    this.notifyUpdate();
  }

  updateInterceptStatus(id: string, status: InterceptAttempt['status']) {
    const a = this.interceptAttempts.get(id);
    if (!a) return;
    a.status = status;
    this.notifyUpdate();
  }

  getInterceptAttempts(): InterceptAttempt[] { return Array.from(this.interceptAttempts.values()); }

  /* ── IAMD Status ─────────────────────────────────────── */
  getStatus(): IamdStatus {
    const interceptorList = this.getInterceptors();
    return {
      trackingCount: this.missileTracks.size,
      activeIntercepts: Array.from(this.interceptAttempts.values()).filter(a => a.status === 'launched' || a.status === 'tracking').length,
      readyInterceptors: interceptorList.filter(i => i.status === 'ready').length,
      depletedInterceptors: interceptorList.filter(i => i.status === 'depleted').length,
      outerTierCoverage: interceptorList.some(i => i.tier === 'outer' && i.status === 'ready'),
      midTierCoverage: interceptorList.some(i => i.tier === 'mid' && i.status === 'ready'),
      innerTierCoverage: interceptorList.some(i => i.tier === 'inner' && i.status === 'ready'),
      lastScanTime: Date.now(),
    };
  }

  /* ── Cesium Rendering ────────────────────────────────── */
  private renderMissileTrack(track: MissileTrack) {
    const pos = Cesium.Cartesian3.fromDegrees(Number(track.lon), Number(track.lat), Number(track.alt));
    this.createEntity(`ad_track_${track.id}`, {
      id: `ad_track_${track.id}`,
      position: pos,
      name: `[${track.type.toUpperCase()}] ${track.name}`,
      point: { pixelSize: 10, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
      label: { text: `${track.name} TTI:${Math.round(track.timeToImpact ?? 0)}s`, font: '9px monospace', fillColor: Cesium.Color.RED, outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, 14), verticalOrigin: Cesium.VerticalOrigin.TOP },
      properties: { layer: 'air_defense', missileId: track.id },
    });

    if (track.trajectory.length > 1) {
      const positions = track.trajectory.map(p => Cesium.Cartesian3.fromDegrees(Number(p.lon), Number(p.lat), Number(p.alt)));
      this.createEntity(`ad_trail_${track.id}`, {
        id: `ad_trail_${track.id}`,
        polyline: { positions, width: 2, material: Cesium.Color.RED.withAlpha(0.6), clampToGround: false },
        properties: { layer: 'ad_trail' },
      });
    } else {
      this.removeEntity(`ad_trail_${track.id}`);
    }

    this.removeEntity(`ad_impact_${track.id}`);
    if (track.impactLat != null && track.impactLon != null) {
      this.createEntity(`ad_impact_${track.id}`, {
        id: `ad_impact_${track.id}`,
        position: Cesium.Cartesian3.fromDegrees(Number(track.impactLon), Number(track.impactLat), 0),
        point: { pixelSize: 8, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.RED, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        label: { text: 'IMPACT', font: 'bold 8px monospace', fillColor: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, 10) },
        properties: { layer: 'ad_impact' },
      });
    }
  }

  private renderInterceptor(interceptor: Interceptor) {
    if (interceptor.lat == null || interceptor.lon == null) return;
    const pos = Cesium.Cartesian3.fromDegrees(Number(interceptor.lon), Number(interceptor.lat), 20);
    const statusColor = interceptor.status === 'ready' ? '#22c55e' : interceptor.status === 'engaged' ? '#f59e0b' : '#64748b';
    this.createEntity(`ad_interceptor_${interceptor.id}`, {
      id: `ad_interceptor_${interceptor.id}`,
      position: pos,
      name: interceptor.name,
      point: { pixelSize: 8, color: Cesium.Color.fromCssColorString(statusColor), outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
      label: { text: `${interceptor.name} x${interceptor.quantity}`, font: '8px monospace', fillColor: Cesium.Color.fromCssColorString(statusColor), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, 12) },
      properties: { layer: 'interceptor', interceptorId: interceptor.id, tier: interceptor.tier },
    });
  }

  private renderIntercept(attempt: InterceptAttempt) {
    const interceptor = this.interceptors.get(attempt.interceptorId);
    if (interceptor?.lat == null || interceptor?.lon == null) return;
    const positions = [
      Cesium.Cartesian3.fromDegrees(Number(interceptor.lon), Number(interceptor.lat), 0),
      Cesium.Cartesian3.fromDegrees(Number(attempt.pipLon), Number(attempt.pipLat), Number(attempt.pipAlt)),
    ];
    const color = attempt.status === 'launched' ? Cesium.Color.CYAN : attempt.status === 'kill' ? Cesium.Color.GREEN : Cesium.Color.RED;
    this.createEntity(`ad_intercept_${attempt.id}`, {
      id: `ad_intercept_${attempt.id}`,
      polyline: { positions, width: 2, material: color.withAlpha(0.7), clampToGround: false },
      properties: { layer: 'intercept', attemptId: attempt.id },
    });
  }
}
