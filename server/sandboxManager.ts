import { spawn } from 'child_process';
import { mkdtemp, writeFile, mkdir, rm, readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  outputJson?: Record<string, unknown>;
  executionTimeMs: number;
  cloud?: boolean;
}

export interface SandboxWorkspace {
  id: string;
  path: string;
  createdAt: number;
  lastAccessed: number;
  cloud?: boolean;
}

export interface CodeExecutionRequest {
  language: 'python' | 'node' | 'bash' | 'r';
  code: string;
  workspaceId?: string;
  timeout?: number;
  env?: Record<string, string>;
  cloud?: boolean;
}

export interface FileUpload {
  fileName: string;
  content: string;
  workspaceId: string;
}

const WORKSPACE_TTL_MS = 30 * 60 * 1000;
const MAX_WORKSPACES = 50;

// E2B REST API helpers (zero external deps — uses built-in fetch)
const E2B_API_BASE = 'https://api.e2b.dev/api/v1';
const E2B_HEADERS = () => {
  const key = process.env.E2B_API_KEY || process.env.e2b_devkey || '';
  return { 'X-API-Key': key, 'Content-Type': 'application/json' };
};
const isE2BConfigured = () => !!(process.env.E2B_API_KEY || process.env.e2b_devkey);

async function e2bCreateSandbox(): Promise<{ sandboxId: string; url: string }> {
  const resp = await fetch(`${E2B_API_BASE}/sandboxes`, {
    method: 'POST',
    headers: E2B_HEADERS(),
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ template_id: 'base' }),
  });
  if (!resp.ok) throw new Error(`E2B create sandbox failed: ${resp.status} ${await resp.text().catch(() => '')}`);
  const data = await resp.json() as { sandbox_id: string; client_id?: string; url?: string };
  const sandboxId = data.sandbox_id;
  const runtimeUrl = data.url || `https://${sandboxId}.sandbox.e2b.dev`;
  return { sandboxId, url: runtimeUrl };
}

async function e2bExecute(sandboxId: string, url: string, language: string, code: string, timeout: number): Promise<ExecutionResult> {
  const start = Date.now();
  const langMap: Record<string, string> = { python: 'python3', node: 'nodejs', bash: 'bash', r: 'r' };
  const payload = { code, language: langMap[language] || language };
  const resp = await fetch(`${url}/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(Math.min(timeout, 60000)),
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`E2B execute failed: ${resp.status}`);
  const data = await resp.json() as { stdout?: string; stderr?: string; exit_code?: number; error?: string };
  let outputJson: Record<string, unknown> | undefined;
  const stdout = data.stdout || '';
  const jsonMatch = stdout.match(/##JSON_RESULT\n([\s\S]*?)(?:\n##|\n*$)/);
  if (jsonMatch) {
    try { outputJson = JSON.parse(jsonMatch[1].trim()); } catch { /* skip */ }
  }
  return {
    stdout,
    stderr: data.stderr || (data.error ? `Error: ${data.error}` : ''),
    exitCode: data.exit_code ?? null,
    outputJson,
    executionTimeMs: Date.now() - start,
    cloud: true,
  };
}

async function e2bWriteFile(sandboxId: string, url: string, filePath: string, content: string): Promise<void> {
  const resp = await fetch(`${url}/files/${filePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    signal: AbortSignal.timeout(15000),
    body: content,
  });
  if (!resp.ok) throw new Error(`E2B write file failed: ${resp.status}`);
}

async function e2bReadFile(sandboxId: string, url: string, filePath: string): Promise<string> {
  const resp = await fetch(`${url}/files/${filePath}`, {
    method: 'GET',
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`E2B read file failed: ${resp.status}`);
  return resp.text();
}

async function e2bListFiles(url: string): Promise<string[]> {
  const resp = await fetch(`${url}/files`, {
    method: 'GET',
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`E2B list files failed: ${resp.status}`);
  const data = await resp.json() as { files?: string[]; paths?: string[] };
  return data.files || data.paths || [];
}

async function e2bDeleteSandbox(sandboxId: string): Promise<void> {
  await fetch(`${E2B_API_BASE}/sandboxes/${sandboxId}`, {
    method: 'DELETE',
    headers: E2B_HEADERS(),
    signal: AbortSignal.timeout(15000),
  }).catch(() => {});
}

// ── SandboxManager ───────────────────────────────────────────────────

export class SandboxManager {
  private workspaces = new Map<string, SandboxWorkspace>();
  /** Maps workspaceId → E2B sandbox ID for cloud workspaces */
  private e2bSandboxes = new Map<string, { sandboxId: string; url: string }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  destroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const [wsId] of this.workspaces.entries()) {
      this.deleteWorkspace(wsId).catch(() => {});
    }
    this.workspaces.clear();
    this.e2bSandboxes.clear();
  }

  async createWorkspace(userId = 'default', cloud?: boolean): Promise<SandboxWorkspace> {
    if (this.workspaces.size >= MAX_WORKSPACES) {
      const oldest = [...this.workspaces.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) {
        await this.deleteWorkspace(oldest[0]).catch(() => {});
      }
    }

    const useCloud = cloud ?? isE2BConfigured();
    const id = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (useCloud) {
      const { sandboxId, url } = await e2bCreateSandbox();
      this.e2bSandboxes.set(id, { sandboxId, url });
      const ws: SandboxWorkspace = { id, path: `e2b://${sandboxId}`, createdAt: Date.now(), lastAccessed: Date.now(), cloud: true };
      this.workspaces.set(id, ws);
      return ws;
    }

    const baseDir = await mkdtemp(join(tmpdir(), `liveglobe-sandbox-`));
    await mkdir(join(baseDir, 'uploads'), { recursive: true });
    await mkdir(join(baseDir, 'outputs'), { recursive: true });
    await mkdir(join(baseDir, 'scripts'), { recursive: true });

    const ws: SandboxWorkspace = { id, path: baseDir, createdAt: Date.now(), lastAccessed: Date.now() };
    this.workspaces.set(id, ws);
    return ws;
  }

  getWorkspace(id: string): SandboxWorkspace | undefined {
    const ws = this.workspaces.get(id);
    if (ws) ws.lastAccessed = Date.now();
    return ws;
  }

  async deleteWorkspace(id: string): Promise<boolean> {
    const ws = this.workspaces.get(id);
    if (!ws) return false;

    if (ws.cloud) {
      const e2b = this.e2bSandboxes.get(id);
      if (e2b) {
        await e2bDeleteSandbox(e2b.sandboxId).catch(() => {});
        this.e2bSandboxes.delete(id);
      }
    } else {
      await rm(ws.path, { recursive: true, force: true }).catch(() => {});
    }

    this.workspaces.delete(id);
    return true;
  }

  async writeFile(workspaceId: string, fileName: string, content: string): Promise<string> {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    if (ws.cloud) {
      const e2b = this.e2bSandboxes.get(workspaceId);
      if (!e2b) throw new Error(`E2B sandbox not found for workspace ${workspaceId}`);
      await e2bWriteFile(e2b.sandboxId, e2b.url, fileName, content);
      return `e2b://${e2b.sandboxId}/${fileName}`;
    }

    const filePath = join(ws.path, 'uploads', fileName);
    await writeFile(filePath, content, 'utf-8');
    ws.lastAccessed = Date.now();
    return filePath;
  }

  async readFile(workspaceId: string, fileName: string): Promise<string> {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    if (ws.cloud) {
      const e2b = this.e2bSandboxes.get(workspaceId);
      if (!e2b) throw new Error(`E2B sandbox not found for workspace ${workspaceId}`);
      return e2bReadFile(e2b.sandboxId, e2b.url, fileName);
    }

    const filePath = join(ws.path, 'uploads', fileName);
    return readFile(filePath, 'utf-8');
  }

  async listFiles(workspaceId: string): Promise<string[]> {
    const ws = this.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    if (ws.cloud) {
      const e2b = this.e2bSandboxes.get(workspaceId);
      if (!e2b) throw new Error(`E2B sandbox not found for workspace ${workspaceId}`);
      return e2bListFiles(e2b.url);
    }

    const files: string[] = [];
    const entries = await readdir(join(ws.path, 'uploads'));
    for (const entry of entries) {
      const fullPath = join(ws.path, 'uploads', entry);
      const s = await stat(fullPath);
      if (s.isFile()) files.push(entry);
    }
    return files;
  }

  async execute(request: CodeExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeout = Math.min(request.timeout || 30_000, 120_000);

    // Check if we should use E2B cloud
    const useCloud = request.cloud || (request.workspaceId ? this.workspaces.get(request.workspaceId)?.cloud : false) || (isE2BConfigured() && !request.workspaceId);
    if (useCloud) {
      return this.cloudExecute(request, startTime, timeout);
    }

    // Security guard: local execution requires explicit opt-in via env var
    if (!isE2BConfigured() && process.env.SANDBOX_ALLOW_LOCAL !== 'true') {
      throw new Error(
        'Local code execution is disabled by default for security. ' +
        'Set SANDBOX_ALLOW_LOCAL=true in .env to enable, or configure E2B_API_KEY for cloud execution.',
      );
    }

    return this.localExecute(request, startTime, timeout);
  }

  private async cloudExecute(request: CodeExecutionRequest, startTime: number, timeout: number): Promise<ExecutionResult> {
    let sandboxId: string | null = null;
    let runtimeUrl: string | null = null;

    if (request.workspaceId) {
      const e2b = this.e2bSandboxes.get(request.workspaceId);
      if (!e2b) throw new Error(`E2B sandbox not found for workspace ${request.workspaceId}`);
      sandboxId = e2b.sandboxId;
      runtimeUrl = e2b.url;
    } else {
      // Ephemeral sandbox — create, execute, destroy
      const created = await e2bCreateSandbox();
      sandboxId = created.sandboxId;
      runtimeUrl = created.url;
    }

    try {
      return await e2bExecute(sandboxId, runtimeUrl!, request.language, request.code, timeout);
    } finally {
      // Clean up ephemeral sandbox (not if workspace-managed)
      if (!request.workspaceId && sandboxId) {
        e2bDeleteSandbox(sandboxId).catch(() => {});
      }
    }
  }

  private async localExecute(request: CodeExecutionRequest, startTime: number, timeout: number): Promise<ExecutionResult> {
    let workspacePath: string | null = null;

    if (request.workspaceId) {
      const ws = this.getWorkspace(request.workspaceId);
      if (!ws) throw new Error(`Workspace ${request.workspaceId} not found`);
      workspacePath = ws.path;
    }

    const scriptDir = workspacePath || join(tmpdir(), `liveglobe-exec-${Date.now()}`);
    if (!workspacePath) await mkdir(scriptDir, { recursive: true });

    try {
      let command: string;
      let args: string[];
      const extension = request.language === 'node' ? 'mjs' : request.language === 'python' ? 'py' : request.language === 'r' ? 'R' : 'sh';
      const scriptPath = join(scriptDir, `script.${extension}`);

      await writeFile(scriptPath, request.code, 'utf-8');

      switch (request.language) {
        case 'python': command = 'python3'; args = ['-u', scriptPath]; break;
        case 'node': command = 'node'; args = ['--experimental-json-modules', scriptPath]; break;
        case 'bash': command = '/bin/bash'; args = [scriptPath]; break;
        case 'r': command = 'Rscript'; args = [scriptPath]; break;
        default: throw new Error(`Unsupported language: ${request.language}`);
      }

      const result = await this.runProcess(command, args, {
        cwd: scriptDir,
        timeout,
        env: { ...process.env, ...request.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin' },
      });

      let outputJson: Record<string, unknown> | undefined;
      const jsonMatch = result.stdout.match(/##JSON_RESULT\n([\s\S]*?)(?:\n##|\n*$)/);
      if (jsonMatch) {
        try { outputJson = JSON.parse(jsonMatch[1].trim()); } catch { /* skip */ }
      }

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        outputJson,
        executionTimeMs: Date.now() - startTime,
      };
    } finally {
      if (!workspacePath) {
        rm(scriptDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private runProcess(
    command: string,
    args: string[],
    opts: { cwd: string; timeout: number; env: Record<string, string | undefined> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env as Record<string, string>,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, 2000);
      }, opts.timeout);

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ stdout, stderr: `${stderr}\n\n[ERROR] Execution timed out after ${opts.timeout}ms`, exitCode: null });
        } else {
          resolve({ stdout, stderr, exitCode });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async batchExecute(tasks: CodeExecutionRequest[]): Promise<ExecutionResult[]> {
    return Promise.all(tasks.map(task => this.execute(task).catch(err => ({
      stdout: '',
      stderr: `Execution failed: ${err.message}`,
      exitCode: -1,
      outputJson: undefined,
      executionTimeMs: 0,
    }))));
  }

  private async cleanup() {
    const now = Date.now();
    for (const [id, ws] of this.workspaces.entries()) {
      if (now - ws.lastAccessed > WORKSPACE_TTL_MS) {
        await this.deleteWorkspace(id).catch(() => {});
      }
    }
  }
}
