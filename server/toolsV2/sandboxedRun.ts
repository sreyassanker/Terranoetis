import { spawn } from 'child_process';
import { logger } from '../observability/logger';

/**
 * Sandboxed execution for LLM-generated / discovered tool code (audit S1 — RCE).
 *
 * Previously generated code ran via `new Function()` IN the server process:
 * full access to process.env (every API key), the filesystem, and child_process.
 * Any authenticated user could POST /api/tools/generate with a description that
 * coaxes the LLM into emitting malicious code — proven live in the audit.
 *
 * Now: code runs in a SHORT-LIVED CHILD NODE PROCESS with
 *   --permission   → fs read/write, child_process, worker_threads, native
 *                    addons are ERR_ACCESS_DENIED (verified on node 26);
 *                    only network fetch remains (by design — that is what
 *                    these tools legitimately do, same as api-type tools).
 *   env: {}        → the child sees ZERO environment variables, so even the
 *                    Function-constructor realm escape (which reaches
 *                    `process` INSIDE the child) leaks no secrets.
 *   --frozen-intrinsics → defense-in-depth (experimental).
 * Hard wall-clock kill + abort-signal support. stdin/stdout JSON protocol.
 */

const RUNNER_SOURCE = `
function out(o) { try { process.stdout.write(JSON.stringify(o)); } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: 'sandbox: unserializable result' })); } }
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  let job;
  try { job = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (e) { return out({ ok: false, error: 'sandbox: bad job payload' }); }
  let fn;
  try {
    const code = String(job.code || '');
    const decl = /^\\s*(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)/.exec(code);
    if (decl) {
      fn = eval(code + '\\n; ' + decl[1] + ';');
    } else {
      const expr = eval('(' + code + ')');
      if (typeof expr !== 'function') return out({ ok: false, error: 'sandbox: code did not produce a function' });
      fn = async (input, signal) => await expr(input, signal);
    }
  } catch (e) { return out({ ok: false, error: 'sandbox: compile failed: ' + (e && e.message) }); }
  if (typeof fn !== 'function') return out({ ok: false, error: 'sandbox: code did not produce a function' });
  const timeoutMs = Math.min(Math.max(Number(job.timeoutMs) || 15000, 1000), 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await fn(job.input, controller.signal);
    clearTimeout(timer);
    out({ ok: true, result: result === undefined ? null : result });
  } catch (e) {
    clearTimeout(timer);
    out({ ok: false, error: String((e && e.message) || e) });
  }
});
`;

export interface SandboxResult { ok: boolean; result?: unknown; error?: string }

export function runGeneratedCode(
  code: string,
  input: Record<string, unknown>,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 15000, 1000), 30000);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        process.execPath,
        ['--permission', '--frozen-intrinsics', '--no-warnings', '-e', RUNNER_SOURCE],
        { env: {}, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch (e) {
      resolve({ ok: false, error: `sandbox spawn failed: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    let stdout = '';
    let settled = false;
    const finish = (r: SandboxResult) => {
      if (!settled) { settled = true; try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(r); }
    };

    const killer = setTimeout(
      () => finish({ ok: false, error: `sandbox: execution exceeded ${timeoutMs + 2000}ms` }),
      timeoutMs + 2000,
    );
    const onAbort = () => { clearTimeout(killer); finish({ ok: false, error: 'sandbox: aborted' }); };
    opts.signal?.addEventListener('abort', onAbort);
    const cleanup = () => { clearTimeout(killer); opts.signal?.removeEventListener('abort', onAbort); };

    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { logger.debug({ err: c.toString().slice(0, 300) }, 'generated-tool stderr'); });
    child.on('error', (e) => { cleanup(); finish({ ok: false, error: `sandbox: ${e.message}` }); });
    child.on('close', () => {
      cleanup();
      try {
        const parsed = JSON.parse(stdout || '') as SandboxResult;
        finish({ ok: parsed.ok === true, result: parsed.result, error: parsed.error });
      } catch {
        finish({ ok: false, error: stdout ? `sandbox: bad output (${stdout.slice(0, 120)})` : 'sandbox: process exited without result' });
      }
    });

    child.stdin?.write(JSON.stringify({ code, input, timeoutMs }));
    child.stdin?.end();
  });
}
