import 'dotenv/config';
import { computeWithContext } from '../server/analytical-models/contextEngine';
import * as fs from 'fs';

const toolIds = Array.from({length: 150}, (_, i) => i + 1);
const SA = { studyArea: { mode: 'point' as const, point: [37.7749, -122.4194] as [number, number] } };
const SA_DELHI = { studyArea: { mode: 'point' as const, point: [28.6139, 77.209] as [number, number] } };

async function main() {
  const summaryRows: string[] = [];
  const detailLines: string[] = [];
  let passed = 0, failed = 0;
  
  // Known input overrides to test filter mechanism (key tools across all domains)
  const FILTER_TESTS: Record<number, { inputs: Record<string, number>; label: string }[]> = {
    1: [{ inputs: { T10: 300, T11: 298, eps10: 0.98, eps11: 0.97, w: 1.5 }, label: 'LST params' }],
    2: [{ inputs: { lambda: 11, T: 300 }, label: 'Planck params' }],
    5: [{ inputs: { u: 5, v: 3 }, label: 'wind override' }],
    8: [{ inputs: { u_star: 0.3, z: 10, z0: 0.1 }, label: 'turbulence' }],
    15: [{ inputs: { n: 0.03, R: 2, S: 0.001 }, label: 'Manning' }],
    19: [{ inputs: { lambda: 0.5, mu: 1.5 }, label: 'G-R params' }],
    27: [{ inputs: { NIR: 0.4, Red: 0.1 }, label: 'NDVI params' }],
    36: [{ inputs: { lat1: 37, lon1: -122, lat2: 38, lon2: -121 }, label: 'Haversine' }],
    45: [{ inputs: { R: 1000, K: 0.5, LS: 5, C: 0.3, P: 0.8 }, label: 'USLE' }],
    59: [{ inputs: { alpha: 1.5, delta: 0.5, gamma: 0.06, Rn: 300, G: 50 }, label: 'PET' }],
    67: [{ inputs: { N: 100, K: 50, r: 0.5 }, label: 'logistic' }],
    71: [{ inputs: { S: 100, I: 10, R: 0, beta: 0.3, gamma: 0.1 }, label: 'SIR' }],
    89: [{ inputs: { k: 0.1, C: 100 }, label: 'Henry' }],
    92: [{ inputs: { D: 10, u: 0.1, L: 1000, C0: 100 }, label: 'advection' }],
    98: [{ inputs: { X: 100, Y: 50, Z: 20 }, label: 'ternary' }],
    102: [{ inputs: { n: 100, p: 0.3 }, label: 'binomial' }],
    117: [{ inputs: { Ne: 1e12 }, label: 'plasma' }],
    131: [{ inputs: { T: 1000, h1: 10, h2: 15 }, label: 'groundwater' }],
    145: [{ inputs: { f: 2.4e9, d: 20200e3, Gt: 20, Gr: 0 }, label: 'link budget' }],
  };

  for (const id of toolIds) {
    try {
      // Default test (auto-fetched data)
      const defaultResult = await computeWithContext(id, {}, SA);
      const defaultOk = defaultResult && defaultResult.result != null && isFinite(defaultResult.result);
      
      // Area filter test (different location — Delhi)
      let areaOk = false;
      try {
        const areaResult = await computeWithContext(id, {}, SA_DELHI);
        areaOk = !!(areaResult && areaResult.result != null && isFinite(areaResult.result));
      } catch { /* non-critical */ }

      // Input override (filter) tests
      const filterTests = FILTER_TESTS[id] ?? [];
      let filterPassed = 0;
      for (const ft of filterTests) {
        try {
          const fr = await computeWithContext(id, ft.inputs, SA);
          if (fr && fr.result != null && isFinite(fr.result)) filterPassed++;
        } catch { /* non-critical */ }
      }

      const ok = defaultOk;
      const status = ok ? '✅' : '❌';
      const val = ok ? String(Math.round(defaultResult!.result * 100) / 100) : 'NULL';
      const unit = defaultResult?.unit ?? '—';
      const name = 'Tool ' + id;
      const filterStatus = filterTests.length === 0 ? '—' : `${filterPassed}/${filterTests.length}`;
      const areaStatus = areaOk ? '✓' : '✗';
      
      if (ok) passed++; else failed++;
      summaryRows.push(`| ${id} | ${name} | ${status} | ${val} | ${unit} | filter=${filterStatus} | area=${areaStatus} |`);
      
      detailLines.push(`\n---\n\n# Tool ${id}\n`);
      detailLines.push(`| Field | Value |`);
      detailLines.push(`|-------|-------|`);
      detailLines.push(`| Result | ${val} |`);
      detailLines.push(`| Unit | ${unit} |`);
      detailLines.push(`| Filters | ${filterStatus} |`);
      detailLines.push(`| Area | ${areaStatus} |`);
      if (defaultResult?.warnings?.length) detailLines.push(`| Warnings | ${defaultResult.warnings.slice(0,2).join('; ')} |`);
      detailLines.push('');
      if (defaultResult?.steps?.length) {
        detailLines.push('**Steps:**');
        defaultResult.steps.slice(0, 8).forEach((s: string) => detailLines.push('> ' + s));
        detailLines.push('');
      }
      
      process.stderr.write(`Tool ${id}: ${status} val=${val} ${unit} filters=${filterStatus} area=${areaStatus}\n`);
    } catch (e: unknown) {
      failed++;
      summaryRows.push(`| ${id} | Tool ${id} | ❌ | ERROR | — | filter=— | area=— |`);
      detailLines.push(`\n---\n\n# Tool ${id}\n`);
      detailLines.push(`**Status:** ❌ ERROR — ${(e instanceof Error ? e.message : String(e)).substring(0, 150)}`);
      detailLines.push('');
      process.stderr.write(`Tool ${id}: ERROR\n`);
    }
  }
  
  const header = `# Analytical Tools — Live End-to-End Test Report\n\n## All 150 Tools\n\n**Date:** July 23, 2026 | **Location:** San Francisco (37.77°N, -122.42°W)\n\n## Summary: ${passed}/${toolIds.length} passed, ${failed} failed\n\n| # | Name | Status | Result | Unit | Filter | Area |\n|---|------|--------|--------|------|--------|------|\n${summaryRows.join('\n')}\n\n---\n`;
  
  fs.writeFileSync('All150_Tools_Test_Report.md', header + detailLines.join('\n'));
  console.log(`DONE: ${passed}/${toolIds.length} passed, ${failed} failed`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
