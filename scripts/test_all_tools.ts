import { computeWithContext } from '../server/analytical-models/contextEngine';
import { EQUATION_ENGINE } from '../server/analytical-models/engine';
import * as fs from 'fs';

const toolIds = Array.from({length: 150}, (_, i) => i + 1);
const SA = { studyArea: { mode: 'point' as const, point: [37.7749, -122.4194] } };

async function main() {
  const summaryRows: string[] = [];
  const detailLines: string[] = [];
  let passed = 0, failed = 0;
  
  for (const id of toolIds) {
    try {
      const result = await computeWithContext(id, {}, SA);
      const ok = result && result.result != null && isFinite(result.result);
      const status = ok ? '✅' : '❌';
      const val = ok ? String(Math.round(result!.result * 100) / 100) : 'NULL';
      const unit = result?.unit ?? '—';
      const name = 'Tool ' + id;
      
      if (ok) passed++; else failed++;
      summaryRows.push(`| ${id} | ${name} | ${status} | ${val} | ${unit} |`);
      
      detailLines.push(`\n---\n\n# Tool ${id}\n`);
      detailLines.push(`| Field | Value |`);
      detailLines.push(`|-------|-------|`);
      detailLines.push(`| Result | ${val} |`);
      detailLines.push(`| Unit | ${unit} |`);
      if (result?.warnings?.length) detailLines.push(`| Warnings | ${result.warnings.slice(0,2).join('; ')} |`);
      detailLines.push('');
      if (result?.steps?.length) {
        detailLines.push('**Steps:**');
        result.steps.slice(0, 8).forEach((s: string) => detailLines.push('> ' + s));
        detailLines.push('');
      }
      
      process.stderr.write(`Tool ${id}: ${status} ${val} ${unit}\n`);
    } catch (e: any) {
      failed++;
      summaryRows.push(`| ${id} | Tool ${id} | ❌ | ERROR | — |`);
      detailLines.push(`\n---\n\n# Tool ${id}\n`);
      detailLines.push(`**Status:** ❌ ERROR — ${(e.message ?? 'unknown').substring(0, 150)}`);
      detailLines.push('');
      process.stderr.write(`Tool ${id}: ERROR\n`);
    }
  }
  
  const header = `# Analytical Tools — Live End-to-End Test Report\n\n## All 150 Tools\n\n**Date:** July 23, 2026 | **Location:** San Francisco (37.77°N, -122.42°W)\n\n## Summary: ${passed}/${toolIds.length} passed, ${failed} failed\n\n| # | Name | Status | Result | Unit |\n|---|------|--------|--------|------|\n${summaryRows.join('\n')}\n\n---\n`;
  
  fs.writeFileSync('All150_Tools_Test_Report.md', header + detailLines.join('\n'));
  console.log(`DONE: ${passed}/${toolIds.length} passed, ${failed} failed`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
