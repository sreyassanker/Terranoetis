import { getDb } from '../db/index';
import { logger } from '../observability/logger';

export interface GeographicBias {
  region: string;
  totalReports: number;
  normalizedRate: number;
  populationWeighted: number;
  biasScore: number;
  overRepresented: boolean;
}

export interface TemporalBias {
  dayOfWeek: string;
  reportCount: number;
  expectedCount: number;
  biasFactor: number;
}

export interface DemographicBias {
  dimension: string;
  group: string;
  representation: number;
  expectedRepresentation: number;
  biasScore: number;
}

export interface BiasReport {
  id: string;
  generatedAt: number;
  geographic: GeographicBias[];
  temporal: TemporalBias[];
  demographic: DemographicBias[];
  overallBiasScore: number;
  mitigations: string[];
}

export class BiasAuditor {
  private reportHistory: BiasReport[] = [];

  init(): void {
    this.ensureTables();
    logger.info('BiasAuditor initialized');
  }

  /** Audit geographic bias in recent reports */
  auditGeographic(daysBack = 30): GeographicBias[] {
    try {
      const db = getDb();
      const regions = db.prepare(`
        SELECT
          CASE
            WHEN lat BETWEEN 24 AND 50 AND lon BETWEEN -125 AND -66 THEN 'North America'
            WHEN lat BETWEEN 35 AND 70 AND lon BETWEEN -10 AND 40 THEN 'Europe'
            WHEN lat BETWEEN -35 AND 35 AND lon BETWEEN 18 AND 52 THEN 'Africa'
            WHEN lat BETWEEN 10 AND 55 AND lon BETWEEN 60 AND 145 THEN 'Asia'
            WHEN lat BETWEEN -50 AND -10 AND lon BETWEEN 110 AND 160 THEN 'Oceania'
            WHEN lat BETWEEN -35 AND 15 AND lon BETWEEN -85 AND -30 THEN 'South America'
            ELSE 'Other'
          END as region,
          COUNT(*) as total_reports
        FROM sentinel_anomalies
        WHERE created_at > datetime('now', ?)
        GROUP BY region
      `).all(`-${daysBack} days`) as Array<{ region: string; total_reports: number }>;

      const total = regions.reduce((s, r) => s + r.total_reports, 0);
      if (total === 0) return [];

      // Population weights (approximate, as fraction of world population)
      const popWeights: Record<string, number> = {
        'Asia': 0.60, 'Africa': 0.17, 'Europe': 0.10,
        'North America': 0.08, 'South America': 0.05, 'Oceania': 0.005, 'Other': 0.005,
      };

      return regions.map(r => {
        const observedRate = r.total_reports / total;
        const expectedRate = popWeights[r.region] || 0.01;
        const biasScore = Math.log2((observedRate + 0.01) / (expectedRate + 0.01));
        return {
          region: r.region,
          totalReports: r.total_reports,
          normalizedRate: observedRate,
          populationWeighted: expectedRate,
          biasScore,
          overRepresented: biasScore > 0.5,
        };
      }).sort((a, b) => b.biasScore - a.biasScore);
    } catch { return []; }
  }

  /** Audit temporal bias: day-of-week patterns */
  auditTemporal(daysBack = 30): TemporalBias[] {
    try {
      const db = getDb();
      const days = db.prepare(`
        SELECT CAST(strftime('%w', created_at) AS INTEGER) as dow, COUNT(*) as count
        FROM sentinel_anomalies
        WHERE created_at > datetime('now', ?)
        GROUP BY dow
      `).all(`-${daysBack} days`) as Array<{ dow: number; count: number }>;

      const total = days.reduce((s, d) => s + d.count, 0);
      const expectedPerDay = total / 7;
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      return dayNames.map((name, i) => {
        const day = days.find(d => d.dow === i);
        const count = day?.count || 0;
        return {
          dayOfWeek: name,
          reportCount: count,
          expectedCount: Math.round(expectedPerDay),
          biasFactor: expectedPerDay > 0 ? count / expectedPerDay : 1,
        };
      });
    } catch { return []; }
  }

  /** Audit demographic bias from user profiles */
  auditDemographic(): DemographicBias[] {
    try {
      const db = getDb();
      const profiles = db.prepare(`
        SELECT json_extract(profile_json, '$.region') as region, COUNT(*) as count
        FROM user_profiles
        GROUP BY region
      `).all() as Array<{ region: string; count: number }>;

      const total = profiles.reduce((s, p) => s + p.count, 0);
      if (total === 0) return [];

      const expected = 1 / profiles.length;

      return profiles.map(p => ({
        dimension: 'region',
        group: p.region || 'unknown',
        representation: p.count / total,
        expectedRepresentation: expected,
        biasScore: Math.abs(p.count / total - expected),
      })).sort((a, b) => b.biasScore - a.biasScore);
    } catch { return []; }
  }

  /** Generate a full bias audit report */
  generateReport(): BiasReport {
    const geo = this.auditGeographic();
    const temp = this.auditTemporal();
    const demo = this.auditDemographic();

    const allScores = [
      ...geo.map(g => Math.abs(g.biasScore)),
      ...temp.map(t => Math.abs(1 - t.biasFactor)),
      ...demo.map(d => d.biasScore),
    ];

    const overallBiasScore = allScores.length > 0
      ? allScores.reduce((s, x) => s + x, 0) / allScores.length
      : 0;

    const mitigations = this.generateMitigations(geo, temp, overallBiasScore);

    const report: BiasReport = {
      id: `bias_${Date.now()}`,
      generatedAt: Date.now(),
      geographic: geo,
      temporal: temp,
      demographic: demo,
      overallBiasScore,
      mitigations,
    };

    this.reportHistory.push(report);
    this.persistReport(report);

    logger.info({ overallBiasScore: overallBiasScore.toFixed(3) }, 'Bias audit report generated');
    return report;
  }

  /** Get recent bias reports */
  getRecentReports(limit = 10): BiasReport[] {
    if (this.reportHistory.length > 0) {
      return this.reportHistory.slice(-limit);
    }
    try {
      const db = getDb();
      return db.prepare('SELECT * FROM bias_reports ORDER BY generated_at DESC LIMIT ?').all(limit).map(r => this.parseReport(r as Record<string, unknown>)).filter(Boolean) as BiasReport[];
    } catch { return []; }
  }

  /** Get bias mitigation suggestions as actionable text */
  getMitigationSuggestions(): string[] {
    const geo = this.auditGeographic();
    const temp = this.auditTemporal();
    return this.generateMitigations(geo, temp, 0);
  }

  private generateMitigations(geo: GeographicBias[], temp: TemporalBias[], _overallScore: number): string[] {
    const mitigations: string[] = [];

    const overRepresented = geo.filter(g => g.overRepresented);
    const underRepresented = geo.filter(g => !g.overRepresented && g.normalizedRate < 0.05);

    if (overRepresented.length > 0) {
      mitigations.push(`Reduce monitoring frequency in: ${overRepresented.map(g => g.region).join(', ')} (over-represented by ${overRepresented.map(g => `${(g.biasScore * 100).toFixed(0)}%`).join(', ')})`);
    }

    if (underRepresented.length > 0) {
      mitigations.push(`Increase data source coverage in: ${underRepresented.map(g => g.region).join(', ')} (under-represented)`);
    }

    const weekendBias = temp.filter(t => (t.dayOfWeek === 'Saturday' || t.dayOfWeek === 'Sunday') && t.biasFactor < 0.7);
    if (weekendBias.length > 0) {
      mitigations.push('Weekend reporting gap detected — consider scheduling additional polling on weekends');
    }

    const weekdaySurge = temp.filter(t => t.dayOfWeek !== 'Saturday' && t.dayOfWeek !== 'Sunday' && t.biasFactor > 1.3);
    if (weekdaySurge.length > 0) {
      mitigations.push(`Weekday reporting bias on: ${weekdaySurge.map(d => d.dayOfWeek).join(', ')} — consider damping factor`);
    }

    mitigations.push('Regular bias audit recommended: schedule weekly automated bias reports');
    mitigations.push('Add data source diversity: integrate additional regional data providers');

    return mitigations;
  }

  private persistReport(report: BiasReport): void {
    try {
      const db = getDb();
      db.prepare(
        'INSERT INTO bias_reports (id, generated_at, report_json) VALUES (?, ?, ?)',
      ).run(report.id, report.generatedAt, JSON.stringify(report));
    } catch { /* ignore */ }
  }

  private parseReport(row: Record<string, unknown>): BiasReport | null {
    try {
      return JSON.parse(row.report_json as string);
    } catch { return null; }
  }

  getStats() {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM bias_reports').get() as { c: number }).c;
      const lastScore = db.prepare('SELECT report_json FROM bias_reports ORDER BY generated_at DESC LIMIT 1').get() as { report_json: string } | undefined;
      const score = lastScore ? (JSON.parse(lastScore.report_json) as BiasReport).overallBiasScore : 0;
      return { totalReports: count, lastBiasScore: score };
    } catch { return { totalReports: 0, lastBiasScore: 0 }; }
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS bias_reports (
          id TEXT PRIMARY KEY,
          generated_at INTEGER NOT NULL,
          report_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_bias_generated ON bias_reports(generated_at DESC);
      `);
    } catch { /* tables exist */ }
  }
}

export const biasAuditor = new BiasAuditor();
