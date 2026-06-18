import NodeCache from 'node-cache';
import { getDb } from '../db/index';
import { omninet } from '../ai-router/omninet';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export interface WorkingMemoryItem {
  id: string;
  type: 'goal' | 'message' | 'task' | 'observation' | 'result';
  content: string;
  timestamp: number;
  relevanceToCurrent: number;
  parentId?: string;
}

export interface WorkingMemoryContext {
  activeGoal: WorkingMemoryItem | null;
  recentMessages: WorkingMemoryItem[];
  pendingTasks: WorkingMemoryItem[];
  observations: WorkingMemoryItem[];
  summary: string;
  itemCount: number;
}

const CAPACITY = 10;

// ── WorkingMemory ───────────────────────────────────────────────

export class WorkingMemory {
  private items: WorkingMemoryItem[] = [];
  private summary = '';
  private activeGoalId: string | null = null;
  private cache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

  init(): void {
    this.ensureTable();
    logger.info('WorkingMemory initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS working_memory (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        relevance REAL NOT NULL DEFAULT 0.5,
        parent_id TEXT,
        active_goal INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_working_timestamp ON working_memory(timestamp DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_working_type ON working_memory(type)`);
    } catch { /* tables exist */ }
  }

  async add(item: { type: WorkingMemoryItem['type']; content: string; parentId?: string }): Promise<string> {
    const id = `wm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newItem: WorkingMemoryItem = {
      id,
      type: item.type,
      content: item.content,
      timestamp: Date.now(),
      relevanceToCurrent: 0.5,
      parentId: item.parentId,
    };

    if (item.type === 'goal') {
      this.activeGoalId = id;
      newItem.relevanceToCurrent = 1.0;
    }

    this.items.push(newItem);

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO working_memory (id, type, content, timestamp, relevance, parent_id, active_goal)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, item.type, item.content.slice(0, 2000), newItem.timestamp, newItem.relevanceToCurrent,
        item.parentId ?? null, item.type === 'goal' ? 1 : 0);
    } catch { /* silent */ }

    if (this.items.length > CAPACITY) {
      await this.summarizeAndCompact();
    }

    return id;
  }

  setGoal(goal: string): Promise<string> {
    return this.add({ type: 'goal', content: goal });
  }

  addMessage(role: 'user' | 'assistant', content: string): Promise<string> {
    return this.add({ type: 'message', content: `[${role}] ${content}` });
  }

  addTask(description: string, parentId?: string): Promise<string> {
    return this.add({ type: 'task', content: description, parentId });
  }

  addObservation(observation: string): Promise<string> {
    return this.add({ type: 'observation', content: observation });
  }

  addResult(result: string, parentId?: string): Promise<string> {
    return this.add({ type: 'result', content: result, parentId });
  }

  async computeAttention(query: string): Promise<WorkingMemoryContext> {
    const txt = query.toLowerCase();
    const words = txt.split(/\s+/).filter(w => w.length > 2);

    for (const item of this.items) {
      const content = item.content.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (content.includes(word)) score += word.length / 10;
      }
      const recency = Math.exp((item.timestamp - Date.now()) / 60000);
      item.relevanceToCurrent = Math.min(1, score * 0.3 + recency * 0.1 + 0.2);
    }

    this.items.sort((a, b) => b.relevanceToCurrent - a.relevanceToCurrent);

    const recentMessages = this.items.filter(i => i.type === 'message').slice(0, 6);
    const pendingTasks = this.items.filter(i => i.type === 'task' || i.type === 'goal');
    const observations = this.items.filter(i => i.type === 'observation');
    const activeGoal = this.items.find(i => i.id === this.activeGoalId) || pendingTasks[0] || null;

    return {
      activeGoal,
      recentMessages,
      pendingTasks,
      observations,
      summary: this.summary,
      itemCount: this.items.length,
    };
  }

  async summarize(): Promise<string> {
    if (this.items.length === 0) return '';

    const cacheKey = `summary:${this.items.length}:${this.items[this.items.length - 1]?.id || ''}`;
    const cached = this.cache.get<string>(cacheKey);
    if (cached) return cached;

    const itemsText = this.items.slice(0, this.items.length).map(i =>
      `[${i.type}] ${i.content.slice(0, 100)}`
    ).join('\n');

    const prompt = `Summarize the following working memory contents into 1-2 concise sentences capturing the current context, goal, and key observations:

${itemsText}

Summary:`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.1, maxTokens: 256 });
      const cleaned = raw.replace(/^Summary:\s*/i, '').trim();
      if (cleaned) {
        this.summary = cleaned;
        this.cache.set(cacheKey, cleaned, 120);
      }
    } catch { /* keep previous summary */ }

    return this.summary;
  }

  async summarizeAndCompact(): Promise<void> {
    const goal = this.items.find(i => i.type === 'goal');
    const nonGoalItems = this.items.filter(i => i.id !== goal?.id);

    const oldest = nonGoalItems.slice(0, Math.ceil(nonGoalItems.length * 0.5));
    const newest = nonGoalItems.slice(Math.ceil(nonGoalItems.length * 0.5));

    const summaryText = await this.summarize();
    if (summaryText) {
      const summaryItem: WorkingMemoryItem = {
        id: `wm_summary_${Date.now()}`,
        type: 'observation',
        content: `Summary of older items: ${summaryText}`,
        timestamp: Date.now(),
        relevanceToCurrent: 0.4,
      };
      this.items = [goal!, ...newest, summaryItem].filter(Boolean);
    }

    try {
      const db = getDb();
      db.prepare('DELETE FROM working_memory WHERE active_goal = 0 ORDER BY timestamp ASC LIMIT ?')
        .run(Math.ceil(nonGoalItems.length * 0.5));
    } catch { /* silent */ }
  }

  clear(): void {
    this.items = [];
    this.summary = '';
    this.activeGoalId = null;
    this.cache.flushAll();
    try {
      const db = getDb();
      db.prepare('DELETE FROM working_memory').run();
    } catch { /* silent */ }
  }

  getContext(): WorkingMemoryContext {
    return {
      activeGoal: this.items.find(i => i.id === this.activeGoalId) || null,
      recentMessages: this.items.filter(i => i.type === 'message').slice(-6),
      pendingTasks: this.items.filter(i => i.type === 'task' || i.type === 'goal'),
      observations: this.items.filter(i => i.type === 'observation'),
      summary: this.summary,
      itemCount: this.items.length,
    };
  }
}

export const workingMemory = new WorkingMemory();
