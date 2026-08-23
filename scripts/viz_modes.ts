import fs from 'fs';
import { getToolConfig } from '../server/analytical-models/toolConfigs';
const src = fs.readFileSync('src/data/analyticalModels.ts', 'utf8');
const byViz: Record<string, Map<string, number[]>> = {};
for (let id = 1; id <= 150; id++) {
  const viz = getToolConfig(id).visualizationType;
  const pm = src.match(new RegExp('\\b' + id + ': \\[([^\\]]*)\\]'));
  const mode = pm ? pm[1].replace(/'/g, '').trim() : 'point';
  if (!byViz[viz]) byViz[viz] = new Map();
  const list = byViz[viz].get(mode) || [];
  list.push(id);
  byViz[viz].set(mode, list);
}
for (const [viz, modes] of Object.entries(byViz).sort((a,b)=>b[1].size - a[1].size)) {
  const total = [...modes.values()].reduce((s,a)=>s+a.length,0);
  console.log(`\n${viz} (${total}):`);
  for (const [mode, ids] of modes) {
    console.log(`  ${mode.padEnd(12)} ${ids.length} tools → ${ids.join(',')}`);
  }
}
