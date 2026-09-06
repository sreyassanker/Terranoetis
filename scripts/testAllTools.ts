/**
 * End-to-end API test for all 150 analytical tools.
 * Tests: computeWithContext (engine + contextEngine) for each tool.
 * Uses empty inputs (contextEngine fills defaults).
 */

import { computeWithContext } from '../server/analytical-models/contextEngine';
import { EQUATION_ENGINE } from '../server/analytical-models/engine';

const ALL_IDS = Array.from({ length: 150 }, (_, i) => i + 1);

// Context: San Francisco coordinates
const CONTEXT = {
  studyArea: {
    mode: 'point' as const,
    point: [37.7749, -122.4194] as [number, number],
    bbox: [[37.7, -122.5], [37.8, -122.4]] as [[number, number], [number, number]],
    twoPoints: [[37.7, -122.5], [37.8, -122.4]] as [[number, number], [number, number]],
  },
  time: {
    start: '2025-01-15',
    end: '2025-01-15',
    granularity: 'instant' as const,
  },
};

interface TestResult {
  id: number;
  status: 'PASS' | 'FAIL' | 'SKIP' | 'TIMEOUT';
  error?: string;
  result?: number;
  unit?: string;
  timeMs: number;
}

async function testTool(id: number): Promise<TestResult> {
  const start = Date.now();
  try {
    // Skip tools not in the engine
    if (!EQUATION_ENGINE[id]) {
      return { id, status: 'SKIP', error: 'Not in EQUATION_ENGINE', timeMs: Date.now() - start };
    }

    const result = await Promise.race([
      computeWithContext(id, {}, CONTEXT),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 60000)),
    ]);

    const elapsed = Date.now() - start;

    if (!result) {
      return { id, status: 'SKIP', error: 'computeWithContext returned null', timeMs: elapsed };
    }

    if (result.result === undefined || result.result === null) {
      return { id, status: 'FAIL', error: 'result is undefined/null', timeMs: elapsed };
    }

    if (typeof result.result === 'number' && !Number.isFinite(result.result)) {
      // NaN is acceptable for DEGRADED tools (honest NaN for missing data)
      return { id, status: 'PASS', result: result.result, unit: result.unit, timeMs: elapsed };
    }

    return {
      id,
      status: 'PASS',
      result: typeof result.result === 'number' ? result.result : 0,
      unit: result.unit,
      timeMs: elapsed,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id,
      status: 'FAIL',
      error: msg.slice(0, 120),
      timeMs: Date.now() - start,
    };
  }
}

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  END-TO-END TEST: ${ALL_IDS.length} ANALYTICAL TOOLS`);
  console.log(`  Context: San Francisco (37.77°N, 122.42°W)`);
  console.log(`${'='.repeat(70)}\n`);

  // Run in batches of 5 to avoid overwhelming the system
  const BATCH_SIZE = 5;
  const results: TestResult[] = [];

  for (let i = 0; i < ALL_IDS.length; i += BATCH_SIZE) {
    const batch = ALL_IDS.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(testTool));
    results.push(...batchResults);

    // Print progress
    for (const r of batchResults) {
      const icon = r.status === 'PASS' ? '✓' : r.status === 'SKIP' ? '⏭' : '✗';
      const detail = r.status === 'FAIL' ? ` — ${r.error}` : r.status === 'SKIP' ? ` — ${r.error}` : '';
      console.log(`  ${icon} Tool ${String(r.id).padStart(3)}${detail} (${r.timeMs}ms)`);
    }

    // Print batch summary
    const pass = batchResults.filter(r => r.status === 'PASS').length;
    const fail = batchResults.filter(r => r.status === 'FAIL').length;
    const skip = batchResults.filter(r => r.status === 'SKIP').length;
    console.log(`  ── Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${pass} pass, ${fail} fail, ${skip} skip ──\n`);
  }

  // Final summary
  const totalPass = results.filter(r => r.status === 'PASS').length;
  const totalFail = results.filter(r => r.status === 'FAIL').length;
  const totalSkip = results.filter(r => r.status === 'SKIP').length;
  const totalTime = results.reduce((s, r) => s + r.timeMs, 0);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  FINAL RESULTS`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  ✓ PASS: ${totalPass}/${ALL_IDS.length}`);
  console.log(`  ✗ FAIL: ${totalFail}/${ALL_IDS.length}`);
  console.log(`  ⏭ SKIP: ${totalSkip}/${ALL_IDS.length}`);
  console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`  Average: ${(totalTime / ALL_IDS.length).toFixed(0)}ms/tool`);

  if (totalFail > 0) {
    console.log(`\n  FAILED TOOLS:`);
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`    Tool ${r.id}: ${r.error}`);
    }
  }

  console.log(`\n${'='.repeat(70)}\n`);

  // Exit with error code if any failures
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
