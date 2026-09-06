import { describe, it, expect } from 'vitest';
import { runGeneratedCode } from '../../toolsV2/sandboxedRun';

/**
 * Audit S1 guard: LLM-generated tool code must never touch the host.
 * These tests spawn real child node processes with the permission model —
 * they prove containment, they don't assert on source text.
 */
describe('sandboxedRun — generated-code containment (audit S1)', () => {
  it('runs legitimate generated code (declaration form)', async () => {
    const res = await runGeneratedCode(
      'async function add({ a, b }) { return { sum: a + b }; }',
      { a: 2, b: 3 },
    );
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ sum: 5 });
  }, 20000);

  it('runs expression/arrow form code', async () => {
    const res = await runGeneratedCode(
      'async ({ x }) => ({ doubled: x * 2 })',
      { x: 21 },
    );
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ doubled: 42 });
  }, 20000);

  it('BLOCKS filesystem access', async () => {
    const res = await runGeneratedCode(
      'async function evil() { const fs = require("fs"); return fs.readFileSync("/etc/passwd", "utf8").slice(0, 20); }',
      {},
    );
    expect(res.ok).toBe(false);
    expect(res.error || '').toMatch(/ACCESS_DENIED|not allowed|Permission|blocked/i);
  }, 20000);

  it('BLOCKS child_process execution', async () => {
    const res = await runGeneratedCode(
      'async function evil() { require("child_process").execSync("id"); return "ran"; }',
      {},
    );
    expect(res.ok).toBe(false);
    expect(res.error || '').toMatch(/ACCESS_DENIED|Permission|blocked/i);
  }, 20000);

  it('LEAKS NO SECRETS (even via the Function-constructor realm escape)', async () => {
    const res = await runGeneratedCode(
      'async function evil() { const p = (function(){return this}).constructor("return process")(); return Object.keys(p.env); }',
      {},
    );
    // Either blocked outright, or the env is effectively empty: spawn uses
    // env:{}; macOS injects one harmless locale var (__CF_USER_TEXT_ENCODING).
    // The containment claim is: NO secret-shaped variable is reachable.
    if (res.ok) {
      const keys = res.result as string[];
      const secretish = keys.filter(k => /(^|_)(KEY|TOKEN|SECRET|PASS|PWD|AUTH|JWT|CRED|CERT)(_|$)/i.test(k) || /API|GEMINI|OPENAI|ANTHROPIC|E2B|REDIS|DATABASE/i.test(k));
      expect(secretish).toEqual([]);
    } else {
      expect(res.error).toBeTruthy();
    }
  }, 20000);

  it('enforces the timeout', async () => {
    const res = await runGeneratedCode(
      'async function slow() { await new Promise(r => setTimeout(r, 30000)); return "done"; }',
      {},
      { timeoutMs: 1000 },
    );
    expect(res.ok).toBe(false);
    expect(res.error || '').toMatch(/abort|exceeded/i);
  }, 20000);
});
