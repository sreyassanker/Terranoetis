import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { pubsub } from '../pubsub';
import { memoryManagerV2 } from '../memory-v2/memoryManager-v2';

export interface SocialReport {
  id: string;
  source: 'twitter' | 'reddit' | 'news' | 'other';
  text: string;
  lat: number;
  lon: number;
  timestamp: number;
  sentiment: number;
  urgency: number;
  keywords: string[];
  locations: string[];
  isRumor: boolean;
  rumorConfidence: number;
}

export interface DisasterSignal {
  id: string;
  type: string;
  lat: number;
  lon: number;
  timestamp: number;
  source: string;
  confidence: number;
  summary: string;
  officialVerified: boolean;
  leadTimeMinutes: number;
}

export class SentimentAnalyzer {
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private urgencyKeywords = new Map<string, number>([
    ['emergency', 1.0], ['evacuate', 1.0], ['collapsed', 0.9], ['explosion', 0.9],
    ['fire', 0.8], ['flooding', 0.8], ['earthquake', 0.8], ['tsunami', 0.9],
    ['landslide', 0.7], ['hurricane', 0.8], ['tornado', 0.9], ['warning', 0.6],
    ['help', 0.7], ['trapped', 0.9], ['injured', 0.8], ['casualty', 0.8],
    ['aftershock', 0.6], ['volcano', 0.8], ['eruption', 0.8], ['hail', 0.4],
    ['storm', 0.5], ['power outage', 0.5], ['blackout', 0.5],
  ]);

  init(): void {
    this.ensureTables();
    logger.info('SentimentAnalyzer initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollTimer = setInterval(() => this.pollSocial(), 120000);
    logger.info('SentimentAnalyzer started');
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    logger.info('SentimentAnalyzer stopped');
  }

  /** Analyze text: sentiment (-1 to 1), urgency (0-1), keyword extraction */
  analyzeText(text: string): { sentiment: number; urgency: number; keywords: string[] } {
    const lower = text.toLowerCase();

    // Simple keyword-based sentiment
    const positiveWords = ['safe', 'rescued', 'okay', 'fine', 'helping', 'donate', 'volunteer', 'shelter'];
    const negativeWords = ['destroyed', 'dead', 'death', 'injured', 'trapped', 'collapsed', 'burning', 'devastated'];

    let posCount = 0;
    let negCount = 0;
    for (const w of positiveWords) { if (lower.includes(w)) posCount++; }
    for (const w of negativeWords) { if (lower.includes(w)) negCount++; }

    const total = posCount + negCount;
    const sentiment = total === 0 ? 0 : (posCount - negCount) / total;

    // Urgency scoring from keyword weights
    let urgency = 0;
    const keywords: string[] = [];
    for (const [kw, weight] of this.urgencyKeywords) {
      if (lower.includes(kw)) {
        urgency = Math.max(urgency, weight);
        keywords.push(kw);
      }
    }

    return { sentiment, urgency, keywords };
  }

  /** Extract location mentions from text */
  extractLocations(text: string): string[] {
    const locations: string[] = [];
    const patterns = [
      /\b(?:in|near|at|around)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
      /\b([A-Z][a-z]+(?:\s+(?:City|County|Island|River|Valley|Beach|Bay|Mountain)))\b/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const loc = match[1].trim();
        if (loc.length > 2 && loc.length < 50) {
          locations.push(loc);
        }
      }
    }

    return [...new Set(locations)];
  }

  /** Detect potential rumors by cross-referencing with multiple signals */
  detectRumor(report: SocialReport, otherReports: SocialReport[]): boolean {
    if (otherReports.length < 2) return false;

    // If multiple independent sources mention similar info, less likely rumor
    const matchingText = otherReports.filter(r =>
      r.id !== report.id &&
      r.keywords.some(k => report.keywords.includes(k))
    ).length;

    // High urgency + low corroboration = likely rumor
    const rumorConfidence = report.urgency * (1 - Math.min(matchingText / 3, 1));
    return rumorConfidence > 0.6;
  }

  /** Create disaster signal from social report */
  createDisasterSignal(report: SocialReport): DisasterSignal | null {
    if (report.urgency < 0.4) return null;

    const signal: DisasterSignal = {
      id: `social_${report.id}`,
      type: this.classifyDisasterType(report.keywords),
      lat: report.lat,
      lon: report.lon,
      timestamp: report.timestamp,
      source: report.source,
      confidence: report.urgency * (report.isRumor ? 0.3 : 0.7),
      summary: report.text.slice(0, 200),
      officialVerified: false,
      leadTimeMinutes: 0,
    };

    if (signal.confidence > 0.5) {
      pubsub.publish('sentiment:disaster_signal', signal);
      memoryManagerV2.store('episodic', { userId: '', query: 'disaster_signal', response: JSON.stringify(signal), intentType: signal.type } as unknown as Record<string, unknown>).catch(() => {});
    }

    return signal;
  }

  /** Cross-validate social report against official data */
  crossValidate(signal: DisasterSignal, officialEvents: Array<{ type: string; lat: number; lon: number; time: number }>): {
    match: boolean;
    matchConfidence: number;
    leadTimeMinutes: number;
  } {
    let bestMatch = 0;
    let leadTime = 0;

    for (const official of officialEvents) {
      if (official.type !== signal.type) continue;
      const distKm = this.haversine(signal.lat, signal.lon, official.lat, official.lon);
      const timeDelta = Math.abs(signal.timestamp - official.time) / 60000;

      if (distKm < 100 && timeDelta < 120) {
        const score = (1 - distKm / 100) * (1 - timeDelta / 120);
        if (score > bestMatch) {
          bestMatch = score;
          leadTime = (official.time - signal.timestamp) / 60000;
        }
      }
    }

    return {
      match: bestMatch > 0.3,
      matchConfidence: bestMatch,
      leadTimeMinutes: Math.round(leadTime),
    };
  }

  /** Poll social sources for disaster-related posts */
  private async pollSocial(): Promise<void> {
    // In production: stream from Twitter API, Reddit API, RSS feeds
    // No real social media API configured — return empty
    return;
  }

  private classifyDisasterType(keywords: string[]): string {
    const typeMap: Array<{ type: string; words: string[] }> = [
      { type: 'earthquake', words: ['earthquake', 'tremor', 'aftershock', 'seismic'] },
      { type: 'flood', words: ['flood', 'flooding', 'flooded', 'inundation'] },
      { type: 'fire', words: ['fire', 'wildfire', 'burning', 'smoke'] },
      { type: 'hurricane', words: ['hurricane', 'cyclone', 'typhoon'] },
      { type: 'tornado', words: ['tornado', 'twister', 'funnel'] },
      { type: 'tsunami', words: ['tsunami', 'wave', 'tidal'] },
      { type: 'volcano', words: ['volcano', 'eruption', 'ash'] },
      { type: 'landslide', words: ['landslide', 'mudslide'] },
    ];

    for (const { type, words } of typeMap) {
      if (keywords.some(k => words.includes(k))) return type;
    }
    return 'general_disaster';
  }

  recordSocialReport(report: SocialReport): void {
    try {
      const db = getDb();
      db.prepare(
        'INSERT OR IGNORE INTO social_reports (id, source, text, lat, lon, timestamp, sentiment, urgency, keywords_json, locations_json, is_rumor, rumor_confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))',
      ).run(report.id, report.source, report.text.slice(0, 500), report.lat, report.lon, report.timestamp, report.sentiment, report.urgency,
        JSON.stringify(report.keywords), JSON.stringify(report.locations), report.isRumor ? 1 : 0, report.rumorConfidence);
    } catch { /* ignore */ }
  }

  getStats() {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM social_reports').get() as { c: number }).c;
      const rumored = (db.prepare('SELECT COUNT(*) as c FROM social_reports WHERE is_rumor = 1').get() as { c: number }).c;
      return { totalReports: count, flaggedRumors: rumored, running: this.running };
    } catch { return { totalReports: 0, flaggedRumors: 0, running: this.running }; }
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS social_reports (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          text TEXT NOT NULL,
          lat REAL NOT NULL DEFAULT 0,
          lon REAL NOT NULL DEFAULT 0,
          timestamp INTEGER NOT NULL,
          sentiment REAL,
          urgency REAL,
          keywords_json TEXT,
          locations_json TEXT,
          is_rumor INTEGER DEFAULT 0,
          rumor_confidence REAL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_social_timestamp ON social_reports(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_social_location ON social_reports(lat, lon);
        CREATE INDEX IF NOT EXISTS idx_social_source ON social_reports(source);

        CREATE TABLE IF NOT EXISTS disaster_signals (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          timestamp INTEGER NOT NULL,
          source TEXT NOT NULL,
          confidence REAL,
          summary TEXT,
          official_verified INTEGER DEFAULT 0,
          lead_time_minutes INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_signals_type ON disaster_signals(type);
        CREATE INDEX IF NOT EXISTS idx_signals_confidence ON disaster_signals(confidence DESC);
      `);
    } catch { /* tables exist */ }
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export const sentimentAnalyzer = new SentimentAnalyzer();
