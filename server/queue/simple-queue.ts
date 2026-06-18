/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { safeJsonParse } from '../utils/jsonParse';

interface Job {
  id: number;
  type: string;
  payload: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  scheduledAt: string;
  processedAt: string | null;
  error: string | null;
}

type JobHandler = (payload: any, job: Job) => Promise<void>;

export class SimpleQueue {
  private handlers = new Map<string, JobHandler>();
  private _recurringTimers: Array<{ type: string; intervalMs: number; timer: ReturnType<typeof setInterval> | null }> = [];
  private processing = false;
  private activeJobs = 0;
  private maxConcurrent: number;
  private shuttingDown = false;

  constructor(maxConcurrent = 10) {
    this.maxConcurrent = maxConcurrent;
    this.ensureTable();
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          priority INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
          processed_at TEXT,
          error TEXT
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_job_queue_type_status ON job_queue(type, status)');
    } catch (e) {
      logger.error({ err: e }, 'failed to create job_queue table');
    }
  }

  add(type: string, payload: any, delayMs = 0, priority = 0, maxAttempts = 3): number {
    try {
      const db = getDb();
      const scheduledAt = new Date(Date.now() + delayMs).toISOString().replace('T', ' ').replace(/\.\d{3}Z/, '');
      const result = db.prepare(`
        INSERT INTO job_queue (type, payload, priority, max_attempts, scheduled_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(type, JSON.stringify(payload), priority, maxAttempts, scheduledAt);
      const jobId = result.lastInsertRowid as number;
      if (delayMs === 0 && !this.shuttingDown) {
        setImmediate(() => this.processNext());
      }
      return jobId;
    } catch (e) {
      logger.error({ err: e, type }, 'failed to add job');
      return -1;
    }
  }

  process(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  recurring(type: string, intervalMs: number): void {
    const timer = setInterval(() => {
      if (!this.shuttingDown) {
        this.add(type, {}, 0, -1);
      }
    }, intervalMs);
    this._recurringTimers.push({ type, intervalMs, timer });
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.shuttingDown) return;
    this.processing = true;

    while (!this.shuttingDown) {
      if (this.activeJobs >= this.maxConcurrent) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      let job: Job | undefined;
      try {
        const db = getDb();
        const row = db.prepare(`
          SELECT * FROM job_queue
          WHERE status = 'pending' AND scheduled_at <= datetime('now')
          ORDER BY priority DESC, id ASC
          LIMIT 1
        `).get() as Job | undefined;
        job = row;
      } catch {
        /* silent */
      }

      if (!job) break;

      const handler = this.handlers.get(job.type);
      if (!handler) {
        try {
          const db = getDb();
          db.prepare("UPDATE job_queue SET status = 'failed', error = ? WHERE id = ?")
            .run(`No handler for type: ${job.type}`, job.id);
        } catch { /* silent */ }
        continue;
      }

      this.activeJobs++;
      try {
        const db = getDb();
        db.prepare("UPDATE job_queue SET status = 'running', attempts = attempts + 1 WHERE id = ?")
          .run(job.id);
      } catch { /* silent */ }

      this.executeJob(job, handler).finally(() => {
        this.activeJobs--;
        setImmediate(() => this.processNext());
      });
    }

    this.processing = false;
  }

  private async executeJob(job: Job, handler: JobHandler): Promise<void> {
    try {
      const payload = safeJsonParse<Record<string, unknown>>(job.payload, {});
      await handler(payload, job);
      try {
        const db = getDb();
        db.prepare("UPDATE job_queue SET status = 'completed', processed_at = datetime('now') WHERE id = ?")
          .run(job.id);
      } catch { /* silent */ }
    } catch (e) {
      const errMsg = (e as Error).message;
      logger.warn({ jobId: job.id, type: job.type, error: errMsg, attempt: job.attempts }, 'job failed');
      try {
        const db = getDb();
        if (job.attempts >= job.maxAttempts) {
          db.prepare("UPDATE job_queue SET status = 'failed', processed_at = datetime('now'), error = ? WHERE id = ?")
            .run(errMsg, job.id);
        } else {
          const backoff = Math.min(30000, Math.pow(2, job.attempts) * 1000);
          const retryAt = new Date(Date.now() + backoff).toISOString().replace('T', ' ').replace(/\.\d{3}Z/, '');
          db.prepare("UPDATE job_queue SET status = 'pending', scheduled_at = ?, error = ? WHERE id = ?")
            .run(retryAt, errMsg, job.id);
          setImmediate(() => this.processNext());
        }
      } catch { /* silent */ }
    }
  }

  getPendingCount(type?: string): number {
    try {
      const db = getDb();
      if (type) {
        const row = db.prepare("SELECT COUNT(*) as cnt FROM job_queue WHERE type = ? AND status = 'pending'").get(type) as { cnt: number };
        return row.cnt;
      }
      const row = db.prepare("SELECT COUNT(*) as cnt FROM job_queue WHERE status = 'pending'").get() as { cnt: number };
      return row.cnt;
    } catch {
      return 0;
    }
  }

  async shutdown(timeoutMs = 10000): Promise<void> {
    this.shuttingDown = true;
    for (const rec of this._recurringTimers) {
      if (rec.timer) clearInterval(rec.timer);
    }
    const start = Date.now();
    while (this.activeJobs > 0 && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (this.activeJobs > 0) {
      logger.warn({ activeJobs: this.activeJobs }, 'jobs still active after shutdown timeout');
    }
    logger.info('queue shutdown complete');
  }
}
