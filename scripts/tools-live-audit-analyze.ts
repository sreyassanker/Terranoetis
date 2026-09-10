import fs from 'fs';

const rows = fs.readFileSync('/tmp/audit/verdicts.jsonl', 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l) as {
    id: number; point: string; date: string; ok: boolean; null?: boolean; result?: unknown;
    unit?: string; warnings?: string[]; error?: string; validation?: { valid?: boolean } | null; ms: number;
  });
const gt = JSON.parse(fs.readFileSync('/tmp/audit/ground_truth.json', 'utf8')) as Record<string, Record<string, { tmax: number; tmean: number; air_1000local_C: number }>>;
const names = new Map<number, { name: string; unit: string }>();
for (const line of fs.readFileSync('/tmp/audit/tool_list.txt', 'utf8').split('\n')) {
  const p = line.split('|').map(s => s.trim());
  if (p.length < 5 || !Number.isFinite(+p[0])) continue;
  names.set(+p[0], { name: p[3], unit: p[4] });
}

type Cell = { result?: unknown; warnings: string[]; ok: boolean; null?: boolean };
const byTool = new Map<number, Map<string, Cell>>();
for (const r of rows) {
  if (!byTool.has(r.id)) byTool.set(r.id, new Map());
  byTool.get(r.id)!.set(`${r.point}|${r.date.slice(5)}`, { result: r.result, warnings: r.warnings ?? [], ok: r.ok, null: r.null });
}

// unit → [min,max] plausibility bounds (hard physics/catalog limits)
const BOUNDS: [RegExp, [number, number]][] = [
  [/°C/, [-92, 62]],
  [/^K$/, [172, 345]],
  [/%/, [0, 100]],
  [/m\/s/, [0, 135]],
  [/hPa/, [450, 1085]],
  [/µg\/m³|ug\/m3/, [0, 5000]],
  [/mm\/day/, [0, 45]],
  [/^mm$/, [0, 1500]],
  [/W\/m²/, [0, 1700]],
  [/m³\/s/, [0, 4.5e5]],
  [/Mw|ML|Mw\/|magnitude/i, [0, 10.5]],
  [/\bkm\b/, [0, 800]],
  [/\bdays?\b/, [0, 4000]],
  [/g\/m²\/d|kg\/CO2|mEq/, [0, 20000]],
  [/\bS\/m\b|dS\/m/, [0, 200]],
  [/V\/m|µS/, [0, 1e6]],
  [/\bJ\/kg\b/, [0, 5e6]],
];

const fmt = (v: unknown) => typeof v === 'number'
  ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(2) : String(+v.toFixed(3)))
  : String(v).slice(0, 8);

const report: string[] = [];
let flagged = 0;
for (let id = 1; id <= 150; id++) {
  const cells = byTool.get(id);
  if (!cells) { report.push(`#${id} ${names.get(id)?.name ?? '?'}: NO DATA`); flagged++; continue; }
  const unit = names.get(id)?.unit ?? '';
  const flags: string[] = [];
  const vals: Record<string, number | undefined> = {};
  for (const [key, c] of cells) {
    const [pt, d] = key.split('|');
    if (!c.ok) { flags.push(`${key}:ERROR`); continue; }
    if (c.null) { if (!c.warnings.length) flags.push(`${key}:null-no-warning`); continue; }
    const v = c.result;
    if (typeof v !== 'number') { if (!c.warnings.length) flags.push(`${key}:'${fmt(v)}'-no-warning`); continue; }
    vals[key] = v;
    for (const [re, [lo, hi]] of BOUNDS) {
      if (re.test(unit) && (v < lo || v > hi)) { flags.push(`${key}=${fmt(v)} outside ${lo}..${hi} ${unit}`); break; }
    }
    // LST-class: surface temp vs 10:00 local air (must be within air−15..air+30)
    if (/°C/.test(unit)) {
      const air = gt[pt]?.[d === '09-05' ? '2026-09-05' : '2026-01-17']?.air_1000local_C;
      if (air != null && (v < air - 15 || v > air + 30)) flags.push(`${key}=${fmt(v)}C vs air ${air}C`);
    }
  }
  // date-invariance per point (same value Sep & Jan = possible frozen input)
  for (const pt of ['blr', 'tok', 'sfo']) {
    const a = vals[`${pt}|09-05`], b = vals[`${pt}|01-17`];
    if (a != null && b != null && a === b) flags.push(`${pt}:date-invariant(${fmt(a)})`);
  }
  if (flags.length) flagged++;
  const line = `#${String(id).padStart(3)} ${(names.get(id)?.name ?? '?').padEnd(44)} [${unit.padEnd(10)}] ` +
    ['blr', 'tok', 'sfo'].map(p => `${p}:${fmt(vals[`${p}|09-05`] ?? cells.get(`${p}|09-05`)?.result ?? '∅')}/${fmt(vals[`${p}|01-17`] ?? cells.get(`${p}|01-17`)?.result ?? '∅')}`).join(' ') +
    (flags.length ? `\n     ⚑ ${flags.join(' · ')}` : '');
  report.push(line);
}
fs.writeFileSync('/tmp/audit/report.txt', report.join('\n') + `\n\nflagged tools: ${flagged}\n`);
console.log(report.join('\n'));
console.log(`\nflagged: ${flagged}/150`);
