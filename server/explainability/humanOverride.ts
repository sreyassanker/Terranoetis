import { getDb } from '../db/index';
import { logger } from '../observability/logger';

export interface HighStakesPrediction {
  id: string;
  type: string;
  severity: string;
  lat: number;
  lon: number;
  description: string;
  probability: number;
  predictedAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'overridden';
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNotes?: string;
  evidenceSummary?: string;
}

export interface OverrideAuditEntry {
  id: string;
  action: 'human_approval' | 'human_rejection' | 'auto_override' | 'system_override';
  predictionId: string;
  userId?: string;
  reason: string;
  timestamp: number;
  previousStatus: string;
  newStatus: string;
}

export class HumanOverride {
  private pendingApprovals: HighStakesPrediction[] = [];
  private auditLog: OverrideAuditEntry[] = [];
  private highStakesThresholds: Record<string, { minProbability: number; minSeverity: string }> = {
    earthquake: { minProbability: 0.6, minSeverity: 'warning' },
    storm_cell: { minProbability: 0.7, minSeverity: 'warning' },
    tornado: { minProbability: 0.6, minSeverity: 'critical' },
    tsunami: { minProbability: 0.4, minSeverity: 'critical' },
    wildfire: { minProbability: 0.6, minSeverity: 'warning' },
    volcanic_eruption: { minProbability: 0.5, minSeverity: 'critical' },
  };

  init(): void {
    this.ensureTables();
    this.loadPendingApprovals();
    logger.info('HumanOverride initialized');
  }

  /** Evaluate if a prediction needs human approval */
  evaluatePrediction(prediction: Omit<HighStakesPrediction, 'id' | 'status' | 'predictedAt'>): HighStakesPrediction | null {
    const threshold = this.highStakesThresholds[prediction.type];
    if (!threshold) return null;

    const severityLevel: Record<string, number> = { info: 0, advisory: 1, warning: 2, critical: 3 };
    const meetsProbability = prediction.probability >= threshold.minProbability;
    const meetsSeverity = severityLevel[prediction.severity] >= severityLevel[threshold.minSeverity];

    if (!meetsProbability || !meetsSeverity) return null;

    const highStakes: HighStakesPrediction = {
      ...prediction,
      id: `hs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      predictedAt: Date.now(),
      status: 'pending',
    };

    this.pendingApprovals.push(highStakes);
    this.persistPrediction(highStakes);

    logger.warn({ id: highStakes.id, type: highStakes.type, probability: highStakes.probability },
      'High-stakes prediction requires human approval');

    return highStakes;
  }

  /** Approve a pending prediction */
  approve(predictionId: string, userId: string, notes?: string): boolean {
    const pred = this.pendingApprovals.find(p => p.id === predictionId);
    if (!pred) return false;

    pred.status = 'approved';
    pred.reviewedBy = userId;
    pred.reviewedAt = Date.now();
    pred.reviewNotes = notes;
    this.updatePredictionStatus(pred);

    this.audit({
      action: 'human_approval',
      predictionId,
      userId,
      reason: notes || 'Approved by human operator',
      previousStatus: 'pending',
      newStatus: 'approved',
    });

    this.pendingApprovals = this.pendingApprovals.filter(p => p.id !== predictionId);
    logger.info({ id: predictionId, userId }, 'High-stakes prediction approved');
    return true;
  }

  /** Reject a pending prediction */
  reject(predictionId: string, userId: string, reason: string): boolean {
    const pred = this.pendingApprovals.find(p => p.id === predictionId);
    if (!pred) return false;

    pred.status = 'rejected';
    pred.reviewedBy = userId;
    pred.reviewedAt = Date.now();
    pred.reviewNotes = reason;
    this.updatePredictionStatus(pred);

    this.audit({
      action: 'human_rejection',
      predictionId,
      userId,
      reason,
      previousStatus: 'pending',
      newStatus: 'rejected',
    });

    this.pendingApprovals = this.pendingApprovals.filter(p => p.id !== predictionId);
    logger.info({ id: predictionId, userId, reason }, 'High-stakes prediction rejected');
    return true;
  }

  /** Override a prediction without approval (emergency use) */
  override(predictionId: string, userId: string, newStatus: 'approved' | 'rejected', reason: string): boolean {
    const pred = this.pendingApprovals.find(p => p.id === predictionId);
    if (!pred) return false;

    const oldStatus = pred.status;
    pred.status = newStatus;
    pred.reviewedBy = userId;
    pred.reviewedAt = Date.now();
    pred.reviewNotes = reason;
    this.updatePredictionStatus(pred);

    this.audit({
      action: 'auto_override',
      predictionId,
      userId,
      reason: `OVERRIDE: ${reason}`,
      previousStatus: oldStatus,
      newStatus,
    });

    this.pendingApprovals = this.pendingApprovals.filter(p => p.id !== predictionId);
    logger.warn({ id: predictionId, userId, newStatus }, 'High-stakes prediction overridden');
    return true;
  }

  /** Get all pending approvals */
  getPendingApprovals(): HighStakesPrediction[] {
    return [...this.pendingApprovals];
  }

  /** Get audit log entries */
  getAuditLog(limit = 100): OverrideAuditEntry[] {
    if (this.auditLog.length > 0) {
      return this.auditLog.slice(-limit);
    }
    try {
      const db = getDb();
      return db.prepare('SELECT * FROM override_audit_log ORDER BY timestamp DESC LIMIT ?').all(limit).map(r => this.parseAuditEntry(r as Record<string, unknown>)).filter(Boolean) as OverrideAuditEntry[];
    } catch { return []; }
  }

  /** Check if a prediction requires human approval */
  requiresApproval(type: string, probability: number, severity: string): boolean {
    const threshold = this.highStakesThresholds[type];
    if (!threshold) return false;
    const severityLevel: Record<string, number> = { info: 0, advisory: 1, warning: 2, critical: 3 };
    return probability >= threshold.minProbability && severityLevel[severity] >= severityLevel[threshold.minSeverity];
  }

  getStats() {
    try {
      const db = getDb();
      const totalPreds = (db.prepare('SELECT COUNT(*) as c FROM high_stakes_predictions').get() as { c: number }).c;
      const pendingCount = this.pendingApprovals.length;
      const approvedCount = (db.prepare("SELECT COUNT(*) as c FROM high_stakes_predictions WHERE status = 'approved'").get() as { c: number }).c;
      const rejectedCount = (db.prepare("SELECT COUNT(*) as c FROM high_stakes_predictions WHERE status = 'rejected'").get() as { c: number }).c;
      return { totalPredictions: totalPreds, pendingApprovals: pendingCount, approved: approvedCount, rejected: rejectedCount };
    } catch { return { totalPredictions: 0, pendingApprovals: 0, approved: 0, rejected: 0 }; }
  }

  private audit(entry: OverrideAuditEntry): void {
    this.auditLog.push(entry);
    try {
      const db = getDb();
      db.prepare(
        'INSERT INTO override_audit_log (id, action, prediction_id, user_id, reason, timestamp, previous_status, new_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(entry.id, entry.action, entry.predictionId, entry.userId || null, entry.reason, entry.timestamp, entry.previousStatus, entry.newStatus);
    } catch { /* ignore */ }
  }

  private persistPrediction(prediction: HighStakesPrediction): void {
    try {
      const db = getDb();
      db.prepare(
        'INSERT INTO high_stakes_predictions (id, type, severity, lat, lon, description, probability, predicted_at, status, evidence_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(prediction.id, prediction.type, prediction.severity, prediction.lat, prediction.lon, prediction.description, prediction.probability, prediction.predictedAt, prediction.status, prediction.evidenceSummary || null);
    } catch { /* ignore */ }
  }

  private updatePredictionStatus(prediction: HighStakesPrediction): void {
    try {
      const db = getDb();
      db.prepare(
        'UPDATE high_stakes_predictions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ? WHERE id = ?',
      ).run(prediction.status, prediction.reviewedBy, prediction.reviewedAt, prediction.reviewNotes, prediction.id);
    } catch { /* ignore */ }
  }

  private loadPendingApprovals(): void {
    try {
      const db = getDb();
      const rows = db.prepare(
        "SELECT * FROM high_stakes_predictions WHERE status = 'pending' ORDER BY predicted_at DESC",
      ).all() as Array<Record<string, unknown>>;
      this.pendingApprovals = rows.map(r => ({
        id: r.id as string,
        type: r.type as string,
        severity: r.severity as string,
        lat: r.lat as number,
        lon: r.lon as number,
        description: r.description as string,
        probability: r.probability as number,
        predictedAt: r.predicted_at as number,
        status: r.status as HighStakesPrediction['status'],
        evidenceSummary: r.evidence_summary as string | undefined,
      }));
    } catch { /* no pending */ }
  }

  private parseAuditEntry(row: Record<string, unknown>): OverrideAuditEntry | null {
    if (!row) return null;
    return {
      id: row.id as string,
      action: row.action as OverrideAuditEntry['action'],
      predictionId: row.prediction_id as string,
      userId: row.user_id as string | undefined,
      reason: row.reason as string,
      timestamp: row.timestamp as number,
      previousStatus: row.previous_status as string,
      newStatus: row.new_status as string,
    };
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS high_stakes_predictions (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          severity TEXT NOT NULL,
          lat REAL,
          lon REAL,
          description TEXT,
          probability REAL,
          predicted_at INTEGER NOT NULL,
          status TEXT DEFAULT 'pending',
          reviewed_by TEXT,
          reviewed_at INTEGER,
          review_notes TEXT,
          evidence_summary TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_hsp_status ON high_stakes_predictions(status);
        CREATE INDEX IF NOT EXISTS idx_hsp_type ON high_stakes_predictions(type);

        CREATE TABLE IF NOT EXISTS override_audit_log (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          prediction_id TEXT NOT NULL,
          user_id TEXT,
          reason TEXT,
          timestamp INTEGER NOT NULL,
          previous_status TEXT,
          new_status TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON override_audit_log(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON override_audit_log(action);
      `);
    } catch { /* tables exist */ }
  }
}

export const humanOverride = new HumanOverride();
