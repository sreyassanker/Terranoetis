import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { broadcastToUser } from '../websocket';
import { getDb } from '../db/index';
import { memoryManagerV2 } from '../memory-v2/memoryManager-v2';
import type { Anomaly } from './anomalyDetector';

// ── Types ───────────────────────────────────────────────────────

export interface UserModel {
  userId: string;
  locations: Array<{ lat: number; lon: number; label: string; radiusKm: number }>;
  hazardTypes: string[];
  thresholds: Record<string, number>;
  online: boolean;
  lastSeen: number;
}

export interface Alert {
  id: string;
  anomalyId: string;
  userIds: string[];
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  lat: number;
  lon: number;
  type: string;
  timestamp: number;
  delivered: boolean;
  suppressed: boolean;
}

// ── AlertIntelligence ───────────────────────────────────────────

export class AlertIntelligence {
  private userModels: Map<string, UserModel> = new Map();
  private recentAlerts: Map<string, number> = new Map();
  private issuedCount = 0;

  init(): void {
    this.loadUserModels();
    logger.info('AlertIntelligence initialized');
  }

  start(): void {
    pubsub.subscribe('sentinel:anomaly', (anomaly: Anomaly) => {
      this.processAnomaly(anomaly);
    });
    logger.info('AlertIntelligence started');
  }

  private processAnomaly(anomaly: Anomaly): void {
    // Find affected users based on their saved locations
    const affectedUsers = this.findAffectedUsers(anomaly);
    if (affectedUsers.length === 0) return;

    for (const userId of affectedUsers) {
      // Suppression: don't repeat same alert within 1 hour
      const suppressKey = `${userId}_${anomaly.type}_${anomaly.lat.toFixed(1)},${anomaly.lon.toFixed(1)}`;
      const lastAlert = this.recentAlerts.get(suppressKey);
      if (lastAlert && Date.now() - lastAlert < 3600000) continue;

      const userModel = this.userModels.get(userId);
      const severity = this.determineSeverityForUser(anomaly, userModel);

      const alert: Alert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        anomalyId: anomaly.id,
        userIds: [userId],
        title: this.formatTitle(anomaly),
        body: anomaly.description,
        severity,
        lat: anomaly.lat,
        lon: anomaly.lon,
        type: anomaly.type,
        timestamp: Date.now(),
        delivered: false,
        suppressed: false,
      };

      this.recentAlerts.set(suppressKey, Date.now());

      // Deliver: WebSocket push if user is online
      const isOnline = userModel?.online || false;
      if (isOnline) {
        broadcastToUser(userId, 'sentinel_alert', alert);
        alert.delivered = true;
      }

      // Store alert
      this.storeAlert(alert);
      this.issuedCount++;

      // Publish alert for proactive insights
      pubsub.publish('sentinel:alert', alert);

      // Store in memory
      try {
        memoryManagerV2.store('sensory', {
          type: 'sentinel_alert',
          source: 'alertIntelligence',
          data: alert,
          importanceScore: severity === 'critical' ? 0.95 : severity === 'warning' ? 0.7 : 0.4,
        });
      } catch { /* non-critical */ }
    }
  }

  private findAffectedUsers(anomaly: Anomaly): string[] {
    const affected: string[] = [];
    for (const [userId, model] of this.userModels) {
      for (const loc of model.locations) {
        const distance = this.haversineKm(loc.lat, loc.lon, anomaly.lat, anomaly.lon);
        if (distance <= loc.radiusKm + 100) {
          if (model.hazardTypes.length === 0 || model.hazardTypes.includes(anomaly.type)) {
            affected.push(userId);
          }
        }
      }
    }
    return affected;
  }

  private determineSeverityForUser(anomaly: Anomaly, userModel?: UserModel): 'info' | 'warning' | 'critical' {
    const eventSeverity = anomaly.event?.severity || 'info';

    if (!userModel) return eventSeverity as 'info' | 'warning' | 'critical';

    // Boost severity if user has a threshold for this hazard type
    const threshold = userModel.thresholds[anomaly.type];
    if (threshold !== undefined && anomaly.score >= threshold) {
      return 'critical';
    }

    return eventSeverity as 'info' | 'warning' | 'critical';
  }

  private formatTitle(anomaly: Anomaly): string {
    const sev = anomaly.event?.severity || 'info';
    const prefix = sev === 'critical' ? '🚨' : sev === 'warning' ? '⚠️' : 'ℹ️';
    const type = anomaly.type.replace(/_/g, ' ');
    return `${prefix} ${type.charAt(0).toUpperCase() + type.slice(1)} ${anomaly.event?.derivedFeatures?.magnitude ? `M${anomaly.event.derivedFeatures.magnitude}` : ''}`.trim();
  }

  // ── User Model Management ─────────────────────────────────────

  registerUserProfile(userId: string, profile: Partial<UserModel>): void {
    const existing = this.userModels.get(userId) || {
      userId,
      locations: [],
      hazardTypes: [],
      thresholds: {},
      online: false,
      lastSeen: 0,
    };
    Object.assign(existing, profile);
    this.userModels.set(userId, existing);
  }

  updateUserOnlineStatus(userId: string, online: boolean): void {
    const model = this.userModels.get(userId);
    if (model) {
      model.online = online;
      model.lastSeen = online ? Date.now() : model.lastSeen;
    }
  }

  private loadUserModels(): void {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM profiles').all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const userId = row.user_id as string;
        const locations: Array<{ lat: number; lon: number; label: string; count: number }> =
          JSON.parse(row.frequent_locations as string || '[]');
        const thresholds: Record<string, number> =
          JSON.parse(row.alert_thresholds as string || '{}');
        this.registerUserProfile(userId, {
          locations: locations.map(l => ({ lat: l.lat, lon: l.lon, label: l.label, radiusKm: 200 })),
          hazardTypes: Object.keys(thresholds),
          thresholds,
          online: false,
          lastSeen: 0,
        });
      }
    } catch { /* start empty */ }
  }

  private storeAlert(alert: Alert): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO sentinel_alerts (alert_id, anomaly_id, user_id, title, body, severity, lat, lon, type, delivered)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(alert.id, alert.anomalyId, alert.userIds[0], alert.title, alert.body,
        alert.severity, alert.lat, alert.lon, alert.type, alert.delivered ? 1 : 0);
    } catch { /* non-critical */ }
  }

  // ── Suppression management ────────────────────────────────────

  clearSuppression(userId: string, type: string): void {
    for (const [key] of this.recentAlerts) {
      if (key.startsWith(`${userId}_${type}`)) {
        this.recentAlerts.delete(key);
      }
    }
  }

  getStats() {
    return { issuedCount: this.issuedCount, activeUsers: this.userModels.size };
  }

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export const alertIntelligence = new AlertIntelligence();
