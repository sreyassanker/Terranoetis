 
import { getDb } from './db/index';
import type { SimpleQueue } from './queue/simple-queue';

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface MonitorRule {
  id: string;
  layerId: string;
  condition: {
    field: string;
    operator: '>' | '<' | '>=' | '<=' | '==' | 'changed';
    value: number;
  };
  location?: { lat: number; lon: number; radiusKm: number };
  label: string;
  userId: string;
  intervalMs: number;
  lastTriggered: number | null;
  count: number;
  createdAt: number;
}

export interface ScheduledTask {
  id: string;
  label: string;
  goal: string;
  userId: string;
  intervalMs: number;
  lastRun: number | null;
  nextRun: number;
  result?: string;
  createdAt: number;
}

export interface AmbientEvent {
  id: string;
  type: 'major_earthquake' | 'storm_formation' | 'volcanic_eruption' | 'tsunami_warning' | 'fire_outbreak' | 'weather_extreme';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  lat: number;
  lon: number;
  timestamp: number;
}

export interface ContextResult {
  location: { lat: number; lon: number; label: string };
  earthquakeRisk: string;
  nearbyEvents: Array<{ title: string; category: string; distance: string }>;
  weather: string;
  population: string;
  timestamp: number;
}

type TriggerCallback = (rule: MonitorRule, data: Record<string, unknown>) => void;
type ReportCallback = (task: ScheduledTask) => void;
type AmbientCallback = (event: AmbientEvent) => void;

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3.1: MonitorManager — job-based
// ═══════════════════════════════════════════════════════════════════════

export class MonitorManager {
  private rules = new Map<string, MonitorRule>();
  private triggerCallbacks: TriggerCallback[] = [];
  private apiOrigin = '';
  private queue: SimpleQueue | null = null;

  constructor() {
    this.loadFromDb();
  }

  onTrigger(callback: TriggerCallback): void {
    this.triggerCallbacks.push(callback);
  }

  bindQueue(queue: SimpleQueue): void {
    this.queue = queue;
    queue.process('monitor:check', async () => {
      await this.checkAll();
    });
  }

  startJobs(): void {
    if (this.queue) {
      this.queue.recurring('monitor:check', 30000);
      this.queue.add('monitor:check', {}, 5000);
    }
  }

  private loadFromDb(): void {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM monitor_rules').all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const rule: MonitorRule = {
          id: row.rule_id as string,
          layerId: row.layer_id as string,
          condition: JSON.parse(row.condition_json as string),
          location: row.location_json ? JSON.parse(row.location_json as string) : undefined,
          label: row.label as string,
          userId: row.user_id as string,
          intervalMs: row.interval_ms as number,
          lastTriggered: row.last_triggered_at ? new Date(row.last_triggered_at as string).getTime() : null,
          count: row.trigger_count as number,
          createdAt: new Date(row.created_at as string).getTime(),
        };
        this.rules.set(rule.id, rule);
      }
    } catch {
      /* start with empty rules */
    }
  }

  create(partial: Omit<MonitorRule, 'id' | 'createdAt' | 'lastTriggered' | 'count'>): MonitorRule {
    const rule: MonitorRule = {
      ...partial,
      id: `mon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      lastTriggered: null,
      count: 0,
      createdAt: Date.now(),
    };
    this.rules.set(rule.id, rule);

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO monitor_rules (rule_id, user_id, layer_id, condition_json, location_json, label, interval_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        rule.id,
        rule.userId,
        rule.layerId,
        JSON.stringify(rule.condition),
        rule.location ? JSON.stringify(rule.location) : null,
        rule.label,
        rule.intervalMs,
      );
    } catch {
      /* persist failed — rule still works in memory */
    }

    return rule;
  }

  remove(id: string): boolean {
    const existed = this.rules.delete(id);
    if (existed) {
      try {
        const db = getDb();
        db.prepare('DELETE FROM monitor_rules WHERE rule_id = ?').run(id);
      } catch {
        /* ignore */
      }
    }
    return existed;
  }

  list(userId?: string): MonitorRule[] {
    const all = Array.from(this.rules.values());
    return userId ? all.filter(r => r.userId === userId) : all;
  }

  get(id: string): MonitorRule | undefined {
    return this.rules.get(id);
  }

  private async checkAll(): Promise<void> {
    for (const rule of this.rules.values()) {
      if (rule.lastTriggered && Date.now() - rule.lastTriggered < rule.intervalMs) continue;
      try {
        const triggered = await this.evaluateRule(rule);
        if (triggered) {
          rule.lastTriggered = Date.now();
          rule.count++;
          try {
            const db = getDb();
            db.prepare('UPDATE monitor_rules SET last_triggered_at = ?, trigger_count = ? WHERE rule_id = ?')
              .run(new Date(rule.lastTriggered).toISOString(), rule.count, rule.id);
          } catch {
            /* ignore */
          }
          for (const cb of this.triggerCallbacks) {
            cb(rule, { timestamp: Date.now(), triggerCount: rule.count });
          }
        }
      } catch {
        // skip failed checks silently
      }
    }
  }

  private async evaluateRule(rule: MonitorRule): Promise<boolean> {
    const endpoint = this.getEndpointForLayer(rule.layerId);
    if (!endpoint) return false;
    const resp = await fetch(`${this.apiOrigin}${endpoint}`, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return false;
    const data = await resp.json();

    let features = data.features || data.events || [];
    if (rule.location) {
      features = features.filter((f: Record<string, unknown>) => {
        const coords = f.geometry?.coordinates || f.geometry?.[0]?.coordinates || [];
        const lat = coords[1];
        const lon = coords[0];
        if (!isFinite(lat) || !isFinite(lon)) return false;
        const d = this.haversineKm(rule.location!.lat, rule.location!.lon, lat, lon);
        return d <= rule.location!.radiusKm;
      });
    }

    for (const f of features) {
      const val = this.resolveField(f, rule.condition.field);
      if (val === undefined || val === null) continue;
      const numVal = typeof val === 'number' ? val : parseFloat(val);
      if (!isFinite(numVal)) continue;
      if (this.matches(numVal, rule.condition.operator, rule.condition.value)) return true;
    }
    return false;
  }

  private resolveField(feature: Record<string, unknown>, field: string): unknown {
    if (field.startsWith('properties.')) {
      const props = feature.properties as Record<string, unknown> || {};
      return props[field.slice(11)];
    }
    if (field.startsWith('geometry.')) {
      const geo = feature.geometry as Record<string, unknown> || {};
      return geo[field.slice(9)];
    }
    return (feature.properties as Record<string, unknown>)?.[field] ?? feature[field];
  }

  private matches(val: number, op: string, threshold: number): boolean {
    switch (op) { case '>': return val > threshold; case '<': return val < threshold; case '>=': return val >= threshold; case '<=': return val <= threshold; case '==': return val === threshold; default: return false; }
  }

  private getEndpointForLayer(layerId: string): string | null {
    const map: Record<string, string> = {
      earthquakes: '/api/earthquakes',
      severe_storms: '/api/weather/nhc',
      wildfires: '/api/firms',
      volcanoes: '/api/eonet',
      floods: '/api/eonet',
      lightning: '/api/lightning',
      space_debris: '/api/space-debris',
      gdacs: '/api/gdacs/alerts',
    };
    return map[layerId] || null;
  }

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3.2: SchedulerManager — job-based
// ═══════════════════════════════════════════════════════════════════════

export class SchedulerManager {
  private tasks = new Map<string, ScheduledTask>();
  private reportCallbacks: ReportCallback[] = [];
  private executor: ((task: ScheduledTask) => Promise<string>) | null = null;
  private queue: SimpleQueue | null = null;

  constructor() {
    this.loadFromDb();
  }

  onReport(callback: ReportCallback): void {
    this.reportCallbacks.push(callback);
  }

  bindQueue(queue: SimpleQueue): void {
    this.queue = queue;
    queue.process('scheduler:check', async () => {
      await this.checkDue();
    });
  }

  startJobs(): void {
    if (this.queue) {
      this.queue.recurring('scheduler:check', 60000);
      this.queue.add('scheduler:check', {}, 10000);
    }
  }

  private loadFromDb(): void {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM scheduled_tasks').all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const task: ScheduledTask = {
          id: row.task_id as string,
          label: row.label as string,
          goal: row.goal as string,
          userId: row.user_id as string,
          intervalMs: row.interval_ms as number,
          lastRun: row.last_run_at ? new Date(row.last_run_at as string).getTime() : null,
          nextRun: new Date(row.next_run_at as string).getTime(),
          result: row.result as string | undefined,
          createdAt: new Date(row.created_at as string).getTime(),
        };
        this.tasks.set(task.id, task);
      }
    } catch {
      /* start with empty tasks */
    }
  }

  create(partial: Omit<ScheduledTask, 'id' | 'createdAt' | 'lastRun' | 'nextRun'>): ScheduledTask {
    const task: ScheduledTask = {
      ...partial,
      id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      lastRun: null,
      nextRun: Date.now() + partial.intervalMs,
      createdAt: Date.now(),
    };
    this.tasks.set(task.id, task);

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO scheduled_tasks (task_id, user_id, label, goal, interval_ms, next_run_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(task.id, task.userId, task.label, task.goal, task.intervalMs, new Date(task.nextRun).toISOString());
    } catch {
      /* persist failed */
    }

    return task;
  }

  remove(id: string): boolean {
    const existed = this.tasks.delete(id);
    if (existed) {
      try {
        const db = getDb();
        db.prepare('DELETE FROM scheduled_tasks WHERE task_id = ?').run(id);
      } catch {
        /* ignore */
      }
    }
    return existed;
  }

  list(userId?: string): ScheduledTask[] {
    const all = Array.from(this.tasks.values());
    return userId ? all.filter(t => t.userId === userId) : all;
  }

  setExecutor(fn: (task: ScheduledTask) => Promise<string>): void {
    this.executor = fn;
  }

  private async checkDue(): Promise<void> {
    if (!this.executor) return;
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (task.nextRun > now) continue;
      task.lastRun = now;
      task.nextRun = now + task.intervalMs;
      try {
        const result = await this.executor(task);
        task.result = result;
        try {
          const db = getDb();
          db.prepare('UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ?, result = ? WHERE task_id = ?')
            .run(new Date(task.lastRun).toISOString(), new Date(task.nextRun).toISOString(), result, task.id);
        } catch {
          /* ignore */
        }
        for (const cb of this.reportCallbacks) {
          cb(task);
        }
      } catch {
        task.nextRun = now + 300000;
        try {
          const db = getDb();
          db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE task_id = ?')
            .run(new Date(task.nextRun).toISOString(), task.id);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3.3: AmbientEventDetector — job-based
// ═══════════════════════════════════════════════════════════════════════

export class AmbientEventDetector {
  private lastEventTimes: Record<string, number> = {};
  private ambientCallbacks: AmbientCallback[] = [];
  private apiOrigin = '';
  private queue: SimpleQueue | null = null;

  onEvent(callback: AmbientCallback): void {
    this.ambientCallbacks.push(callback);
  }

  bindQueue(queue: SimpleQueue): void {
    this.queue = queue;
    queue.process('ambient:detect', async () => {
      await this.detect();
    });
  }

  startJobs(): void {
    if (this.queue) {
      this.queue.recurring('ambient:detect', 120000);
      this.queue.add('ambient:detect', {}, 0);
    }
  }

  private async detect(): Promise<void> {
    await Promise.all([
      this.checkMajorQuakes(),
      this.checkNewStorms(),
      this.checkFireOutbreaks(),
    ]);
  }

  private async checkMajorQuakes(): Promise<void> {
    try {
      const resp = await fetch(`${this.apiOrigin}/api/earthquakes`, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return;
      const data = await resp.json();
      for (const f of (data.features || [])) {
        const mag = f.properties?.mag;
        const time = f.properties?.time;
        if (mag >= 7 && time > (this.lastEventTimes.majorQuake || 0)) {
          this.lastEventTimes.majorQuake = time;
          const coords = f.geometry?.coordinates || [];
          this.emit({
            type: 'major_earthquake',
            severity: 'critical',
            title: `M${mag} Earthquake`,
            description: f.properties?.place || `Magnitude ${mag} earthquake detected`,
            lat: coords[1], lon: coords[0],
          });
        }
      }
    } catch { /* silent */ }
  }

  private async checkNewStorms(): Promise<void> {
    try {
      const resp = await fetch(`${this.apiOrigin}/api/weather/nhc`, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return;
      const data = await resp.json();
      const storms = Array.isArray(data) ? data : data.storms || [];
      for (const s of storms) {
        const name = s.name || s.id || 'Unknown';
        const key = `storm_${name}`;
        const wind = s.maxWind || s.wind || 0;
        if (wind > 60 && (!this.lastEventTimes[key] || s.timestamp > this.lastEventTimes[key])) {
          this.lastEventTimes[key] = s.timestamp || Date.now();
          this.emit({
            type: 'storm_formation',
            severity: wind > 100 ? 'critical' : 'warning',
            title: `${name} (${wind}kt)`,
            description: `${name} is active with ${wind}kt winds. Track available on globe.`,
            lat: s.lat, lon: s.lon,
          });
        }
      }
    } catch { /* silent */ }
  }

  private async checkFireOutbreaks(): Promise<void> {
    try {
      const resp = await fetch(`${this.apiOrigin}/api/firms`, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return;
      const data = await resp.json();
      const fires = Array.isArray(data) ? data : data.fires || [];
      for (const f of (fires.slice(0, 5) as Array<Record<string, unknown>>)) {
        const frp = typeof f.frp === 'number' ? f.frp : parseFloat(String(f.frp)) || 0;
        const key = `fire_${f.latitude}_${f.longitude}`;
        if (frp > 100 && !this.lastEventTimes[key]) {
          this.lastEventTimes[key] = Date.now();
          this.emit({
            type: 'fire_outbreak',
            severity: frp > 500 ? 'critical' : 'warning',
            title: `High-Intensity Fire (FRP: ${frp.toFixed(0)})`,
            description: `Satellite detected high-intensity fire. FRP: ${frp.toFixed(0)} MW.`,
            lat: Number(f.latitude), lon: Number(f.longitude),
          });
        }
      }
    } catch { /* silent */ }
  }

  private emit(event: Omit<AmbientEvent, 'id' | 'timestamp'>): void {
    const full: AmbientEvent = { ...event, id: `ambient_${Date.now()}`, timestamp: Date.now() };
    for (const cb of this.ambientCallbacks) {
      cb(full);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Context provider (unchanged)
// ═══════════════════════════════════════════════════════════════════════

export async function getLocationContext(
  lat: number, lon: number, apiOrigin: string
): Promise<ContextResult> {
  const [quakesResp, weatherResp, alertsResp] = await Promise.all([
    fetch(`${apiOrigin}/api/earthquakes`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
    fetch(`${apiOrigin}/api/weather/open-meteo?lat=${lat}&lon=${lon}`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
    fetch(`${apiOrigin}/api/weather/alerts`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
  ]);

  const quakes = quakesResp?.ok ? await quakesResp.json().catch(() => ({ features: [] })) : { features: [] };
  const weather = weatherResp?.ok ? await weatherResp.json().catch(() => null) : null;
  const alerts = alertsResp?.ok ? await alertsResp.json().catch(() => ({ features: [] })) : { features: [] };

  const nearbyQuakes = (quakes.features || []).filter((f: Record<string, unknown>) => {
    const coords = f.geometry?.coordinates || [];
    return haversineKm(lat, lon, coords[1], coords[0]) < 500;
  });

  const maxMag = nearbyQuakes.length > 0
    ? Math.max(...nearbyQuakes.map((f: Record<string, unknown>) => f.properties?.mag || 0))
    : 0;

  const nearbyAlerts = (alerts.features || []).filter((f: Record<string, unknown>) => {
    const coords = f.geometry?.coordinates || f.geometry?.coordinates?.[0];
    if (!coords) return false;
    const [alLon, alLat] = Array.isArray(coords[0]) ? coords[0] : coords;
    return haversineKm(lat, lon, alLat, alLon) < 300;
  });

  const label = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

  return {
    location: { lat, lon, label },
    earthquakeRisk: maxMag > 0 ? `M${maxMag.toFixed(1)} within 500km` : 'No recent seismic activity nearby',
    nearbyEvents: [
      ...nearbyQuakes.slice(0, 3).map((f: Record<string, unknown>) => ({
        title: `M${f.properties?.mag} — ${f.properties?.place || 'Unknown'}`,
        category: 'Earthquake',
        distance: 'Within 500km',
      })),
      ...nearbyAlerts.slice(0, 3).map((f: Record<string, unknown>) => ({
        title: f.properties?.event || f.properties?.headline || 'Weather alert',
        category: 'Weather',
        distance: 'Within 300km',
      })),
    ],
    weather: weather?.current?.temperature !== undefined
      ? `${weather.current.temperature}°C, ${weather.current.windspeed || '?'} km/h wind`
      : 'Weather data unavailable',
    population: 'Population data available via globe interaction',
    timestamp: Date.now(),
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!isFinite(lat1) || !isFinite(lon1) || !isFinite(lat2) || !isFinite(lon2)) return Infinity;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
