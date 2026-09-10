import 'dotenv/config';
import fs from 'fs';
import { computeWithContext } from '../server/analytical-models/contextEngine';

// Live cross-verification sweep: every implemented analytical tool, 3
// contrasting points × 2 timestamps (Sep + Jan, same calendar dates —
// opposite-season contrast at the N-hemisphere sites, monsoon-vs-dry at BLR).
// Bengaluru: inland, semi-arid, elevation 910 m.
// Tokyo: coastal temperate megacity, seismic, rivers, bay.
// San Francisco: coastal oceanic, strong seismic, upwelling.
// Resumable: completed (id,point,date) triples in the JSONL are skipped.

const POINTS = [
  { name: 'blr', lat: 12.9716, lon: 77.5946 },
  { name: 'tok', lat: 35.6762, lon: 139.6503 },
  { name: 'sfo', lat: 37.7749, lon: -122.4194 },
] as const;
const DATES = ['2026-09-05', '2026-01-17'] as const;
const OUT = '/tmp/audit/verdicts.jsonl';
const TIMEOUT_MS = 240000;
const CONCURRENCY = 3;
const MAX_ATTEMPTS = 2;

fs.mkdirSync('/tmp/audit', { recursive: true });
const done = new Set<string>();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); done.add(`${j.id}|${j.point}|${j.date}`); } catch { /* ignore */ }
  }
}

type Job = { id: number; point: typeof POINTS[number]; date: string };
const jobs: Job[] = [];
for (let id = 1; id <= 150; id++)
  for (const p of POINTS)
    for (const date of DATES)
      if (!done.has(`${id}|${p.name}|${date}`)) jobs.push({ id, point: p, date });

console.log(`remaining: ${jobs.length} of ${150 * 6} total pairs`);

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('harness-timeout')), ms))]);

async function runOne(job: Job): Promise<void> {
  const { id, point, date } = job;
  const t0 = Date.now();
  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await withTimeout(computeWithContext(id, {}, {
        studyArea: { mode: 'point', point: [point.lat, point.lon] },
        time: { granularity: 'day', start: date, end: date },
      } as never), TIMEOUT_MS);
      if (!r) { fs.appendFileSync(OUT, JSON.stringify({ id, point: point.name, date, ok: true, null: true, warnings: ['not implemented'], ms: Date.now() - t0 }) + '\n'); return; }
      fs.appendFileSync(OUT, JSON.stringify({
        id, point: point.name, date, ok: true,
        result: typeof r.result === 'number' && Number.isFinite(r.result) ? +r.result.toFixed(4) : String(r.result),
        unit: r.unit,
        warnings: (r.warnings ?? []).map(w => String(w).slice(0, 220)),
        validation: r.validation ? { valid: (r.validation as { valid?: boolean }).valid } : null,
        dataSource: (r.dataSource ?? []).slice(0, 6),
        ms: Date.now() - t0,
      }) + '\n');
      return;
    } catch (e) {
      lastErr = String((e as Error)?.message ?? e).slice(0, 150);
    }
  }
  fs.appendFileSync(OUT, JSON.stringify({ id, point: point.name, date, ok: false, error: lastErr, ms: Date.now() - t0 }) + '\n');
}

let cursor = 0;
const started = Date.now();
async function worker(): Promise<void> {
  for (;;) {
    const i = cursor++;
    if (i >= jobs.length) return;
    await runOne(jobs[i]);
    const mins = Math.round((Date.now() - started) / 60000);
    if (cursor % 10 === 0 || cursor === jobs.length) console.log(`[${cursor}/${jobs.length}] ${Math.round(100 * cursor / jobs.length)}% elapsed ${mins}min`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log('SWEEP COMPLETE');
process.exit(0);
