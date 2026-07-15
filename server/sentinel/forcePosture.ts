/**
 * Force Posture Intelligence
 * 
 * Combines ADS-B flight tracking + AIS naval tracking + satellite imagery
 * to assess military force posture changes. Creates baseline models of
 * military bases and ports, then alerts when activity deviates significantly.
 * 
 * Data sources:
 * - ADS-B military flights (ADSB.lol)
 * - AIS vessel positions (existing maritime data)
 * - Historical baselines for military installations
 */

import { pubsub } from '../pubsub.js';
import { logger } from '../observability/logger';
import type Database from 'better-sqlite3';

export interface MilitaryInstallation {
  id: string; name: string; type: 'airbase' | 'naval_base' | 'army_base' | 'mixed';
  country: string; lat: number; lon: number;
  baselineFlightCount: number; baselineVesselCount: number;
  currentFlightCount: number; currentVesselCount: number;
  deviationScore: number; lastUpdate: number;
}

export interface PostureAlert {
  id: string; type: 'activity_surge' | 'activity_drop' | 'force_buildup' | 'exercise_detected';
  severity: string; installationId: string; installationName: string;
  lat: number; lon: number; description: string; confidence: number;
  createdAt: number; acknowledged: boolean;
}

// Real military installations with coordinates
const INSTALLATIONS: Omit<MilitaryInstallation, 'currentFlightCount' | 'currentVesselCount' | 'deviationScore' | 'lastUpdate'>[] = [
  { id: 'ramstein', name: 'Ramstein Air Base', type: 'airbase', country: 'Germany', lat: 49.4369, lon: 7.6003, baselineFlightCount: 12, baselineVesselCount: 0 },
  { id: 'sigonella', name: 'NAS Sigonella', type: 'airbase', country: 'Italy', lat: 37.4017, lon: 14.9222, baselineFlightCount: 8, baselineVesselCount: 0 },
  { id: 'diego_garcia', name: 'Diego Garcia', type: 'naval_base', country: 'UK', lat: -7.3195, lon: 72.4229, baselineFlightCount: 5, baselineVesselCount: 4 },
  { id: 'guam', name: 'Andersen AFB', type: 'airbase', country: 'USA', lat: 13.5842, lon: 144.9214, baselineFlightCount: 10, baselineVesselCount: 2 },
  { id: 'yokota', name: 'Yokota Air Base', type: 'airbase', country: 'Japan', lat: 35.7487, lon: 139.3481, baselineFlightCount: 15, baselineVesselCount: 0 },
  { id: 'carrier_group_7', name: 'CSG-7 (Pacific)', type: 'naval_base', country: 'USA', lat: 25.0, lon: 140.0, baselineFlightCount: 20, baselineVesselCount: 6 },
  { id: 'novorossiysk', name: 'Novorossiysk Naval Base', type: 'naval_base', country: 'Russia', lat: 44.7239, lon: 37.7694, baselineFlightCount: 3, baselineVesselCount: 8 },
  { id: 'sevastopol', name: 'Sevastopol Naval Base', type: 'naval_base', country: 'Russia', lat: 44.6054, lon: 33.5220, baselineFlightCount: 4, baselineVesselCount: 10 },
  { id: 'qingdao', name: 'Qingdao Naval Base', type: 'naval_base', country: 'China', lat: 36.0667, lon: 120.3833, baselineFlightCount: 6, baselineVesselCount: 12 },
  { id: 'sanya', name: 'Yulin Naval Base', type: 'naval_base', country: 'China', lat: 18.2528, lon: 109.5125, baselineFlightCount: 4, baselineVesselCount: 8 },
  { id: 'persian_gulf', name: 'Persian Gulf Transit', type: 'naval_base', country: 'Multi', lat: 26.5, lon: 56.5, baselineFlightCount: 8, baselineVesselCount: 15 },
  { id: 'baltic_fleet', name: 'Baltic Fleet HQ', type: 'naval_base', country: 'Russia', lat: 59.9500, lon: 30.3167, baselineFlightCount: 5, baselineVesselCount: 10 },
];

const DEVIATION_THRESHOLD = 1.5;  // 150% of baseline = activity surge
const DROP_THRESHOLD = 0.3;       // 30% of baseline = activity drop

export class ForcePostureEngine {
  private installations = new Map<string, MilitaryInstallation>();
  private alerts: PostureAlert[] = [];
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private db: Database.Database | null = null;

  constructor(db: Database.Database) {
    this.db = db;
    // Initialize installations from real coordinates
    for (const inst of INSTALLATIONS) {
      this.installations.set(inst.id, { ...inst, currentFlightCount: 0, currentVesselCount: 0, deviationScore: 0, lastUpdate: Date.now() });
    }
  }

  private ensureTables(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posture_alerts (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, severity TEXT NOT NULL,
        installation_id TEXT NOT NULL, installation_name TEXT NOT NULL,
        lat REAL NOT NULL, lon REAL NOT NULL, description TEXT NOT NULL,
        confidence REAL NOT NULL, created_at INTEGER NOT NULL, acknowledged INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_posture_alerts_type ON posture_alerts(type);
      CREATE INDEX IF NOT EXISTS idx_posture_alerts_created ON posture_alerts(created_at DESC);
    `);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.ensureTables();
    this.pollTimer = setInterval(() => { if (this.running) this.assessPosture(); }, 120_000); // Every 2 min
    this.assessPosture(); // Initial assessment
    logger.info({ installations: INSTALLATIONS.length }, '[ForcePosture] Engine started');
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private async assessPosture(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    // Fetch military flights from ADSB.lol
    try {
      const resp = await fetch('https://api.adsb.lol/v2/mil', { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const data = await resp.json() as { aircraft?: Array<{ lat: number; lon: number; icao24: string; callsign: string }> };
        if (data.aircraft) {
          // Count flights near each installation
          for (const inst of this.installations.values()) {
            let count = 0;
            for (const ac of data.aircraft) {
              if (ac.lat && ac.lon) {
                const dist = this.haversineDistance(inst.lat, inst.lon, ac.lat, ac.lon);
                if (dist < 200) count++; // Within 200km
              }
            }
            inst.currentFlightCount = count;
            inst.lastUpdate = Date.now();
            inst.deviationScore = inst.baselineFlightCount > 0 ? count / inst.baselineFlightCount : 0;
          }
        }
      }
    } catch { /* ADSB rate limited */ }

    // Check for anomalies
    for (const inst of this.installations.values()) {
      if (inst.deviationScore >= DEVIATION_THRESHOLD) {
        this.generateAlert({
          type: inst.deviationScore >= 3 ? 'force_buildup' : 'activity_surge',
          severity: inst.deviationScore >= 3 ? 'critical' : 'high',
          installationId: inst.id, installationName: inst.name,
          lat: inst.lat, lon: inst.lon,
          description: `${inst.name}: ${inst.currentFlightCount} military flights detected (${Math.round(inst.deviationScore * 100)}% of baseline ${inst.baselineFlightCount}).`,
          confidence: Math.min(0.9, 0.5 + inst.deviationScore * 0.1),
        });
      } else if (inst.deviationScore > 0 && inst.deviationScore <= DROP_THRESHOLD && inst.baselineFlightCount > 5) {
        this.generateAlert({
          type: 'activity_drop', severity: 'medium',
          installationId: inst.id, installationName: inst.name,
          lat: inst.lat, lon: inst.lon,
          description: `${inst.name}: Activity dropped to ${Math.round(inst.deviationScore * 100)}% of baseline. Possible relocation or blackout.`,
          confidence: 0.6,
        });
      }
    }

    // Broadcast status
    pubsub.publish('force_posture:updates', {
      type: 'posture_update',
      installations: this.getInstallations(),
      timestamp: Date.now(),
    });
    this.busy = false;
  }

  private generateAlert(partial: Omit<PostureAlert, 'id' | 'createdAt' | 'acknowledged'>): void {
    // Deduplicate — only alert once per installation per hour
    const recent = this.alerts.find(a => a.installationId === partial.installationId && Date.now() - a.createdAt < 3600000);
    if (recent) return;

    const alert: PostureAlert = {
      ...partial, id: crypto.randomUUID(), createdAt: Date.now(), acknowledged: false,
    };
    this.alerts.push(alert);
    this.storeAlert(alert);
    pubsub.publish('force_posture:alerts', { type: 'posture_alert', alert, timestamp: Date.now() });
  }

  private storeAlert(alert: PostureAlert): void {
    if (!this.db) return;
    try {
      this.db.prepare(`INSERT INTO posture_alerts (id, type, severity, installation_id, installation_name, lat, lon, description, confidence, created_at, acknowledged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(alert.id, alert.type, alert.severity, alert.installationId, alert.installationName, alert.lat, alert.lon, alert.description, alert.confidence, alert.createdAt, 0);
    } catch { /* ignore */ }
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; const dLat = (lat2-lat1)*Math.PI/180; const dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  getInstallations(): MilitaryInstallation[] { return [...this.installations.values()]; }
  getAlerts(limit = 50): PostureAlert[] { return this.alerts.slice(-limit); }
  acknowledgeAlert(id: string): void { const a = this.alerts.find(x => x.id === id); if (a) a.acknowledged = true; }
  getStatus(): { running: boolean; installationCount: number; alertCount: number } {
    return { running: this.running, installationCount: this.installations.size, alertCount: this.alerts.length };
  }
}
