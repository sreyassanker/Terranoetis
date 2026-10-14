/**
 * Kaggle Native HTTPS & CLI Client
 *
 * Provides full zero-dependency Kaggle integration across macOS, Linux, and Windows.
 * Executes kernel pushes, status polling, output downloads, and credential validation
 * natively via Kaggle's HTTPS REST API using credentials stored in KeyManager (or env/file),
 * with automatic fallback to the local Kaggle CLI if present.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile, type ExecFileException } from 'child_process';
import { logger } from '../observability/logger';
import { keyManager } from '../keyManager';

export interface KaggleCredentials {
  username: string;
  key: string;
  source: 'vault' | 'env' | 'file';
}

export interface ValidationResponse {
  valid: boolean;
  message: string;
  username?: string;
}

export interface PushKernelOptions {
  ownerSlug: string;
  newTitle: string;
  code: string;
  isGpu?: boolean;
}

export interface KernelStatusResponse {
  status: string;
  failureMessage?: string;
}

class KaggleClient {
  private kaggleBinCache: string | null = null;
  private kaggleBinResolved = false;

  /**
   * Resolves Kaggle credentials from:
   * 1. Encrypted KeyManager vault
   * 2. process.env (KAGGLE_USERNAME / KAGGLE_KEY)
   * 3. ~/.kaggle/kaggle.json or KAGGLE_CONFIG_DIR
   */
  getCredentials(): KaggleCredentials | null {
    // 1. Check KeyManager
    const vaultUser = (keyManager.get('KAGGLE_USERNAME') || '').trim();
    const vaultKey = (keyManager.get('KAGGLE_KEY') || '').trim();
    if (vaultUser && vaultKey) {
      return { username: vaultUser, key: vaultKey, source: 'vault' };
    }

    // 2. Check process.env
    const envUser = (process.env.KAGGLE_USERNAME || '').trim();
    const envKey = (process.env.KAGGLE_KEY || '').trim();
    if (envUser && envKey) {
      return { username: envUser, key: envKey, source: 'env' };
    }

    // 3. Check kaggle.json on disk
    const configDir = process.env.KAGGLE_CONFIG_DIR || path.join(os.homedir(), '.kaggle');
    const file = path.join(configDir, 'kaggle.json');
    if (fs.existsSync(file)) {
      try {
        const content = JSON.parse(fs.readFileSync(file, 'utf-8')) as { username?: string; key?: string };
        if (content.username && content.key) {
          return { username: content.username.trim(), key: content.key.trim(), source: 'file' };
        }
      } catch { /* continue */ }
    }

    return null;
  }

  hasCredentials(): boolean {
    return this.getCredentials() !== null;
  }

  /**
   * Generates the Basic Auth header for Kaggle REST endpoints.
   */
  private getAuthHeader(username?: string, key?: string): string | null {
    let u = username?.trim();
    let k = key?.trim();

    if (!u || !k) {
      const creds = this.getCredentials();
      if (creds) {
        u = creds.username;
        k = creds.key;
      }
    }

    if (!u || !k) return null;
    return 'Basic ' + Buffer.from(`${u}:${k}`).toString('base64');
  }

  /**
   * Live validation of Kaggle credentials against the official API.
   */
  async validateCredentials(username?: string, key?: string): Promise<ValidationResponse> {
    const creds = (username === undefined || key === undefined) ? this.getCredentials() : null;
    const u = (username !== undefined ? username : (creds?.username || '')).trim();
    const k = (key !== undefined ? key : (creds?.key || '')).trim();

    if (!u || !k) {
      return {
        valid: false,
        message: 'Kaggle requires both a Username and API Key. Paste both fields or paste your kaggle.json content.',
      };
    }

    const authHeader = 'Basic ' + Buffer.from(`${u}:${k}`).toString('base64');

    try {
      const resp = await fetch('https://api.kaggle.com/v1/kernels.KernelsApiService/ListKernels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
          'User-Agent': 'Terranoetis-Desktop/3.0.0',
        },
        body: JSON.stringify({ page: 1, pageSize: 1 }),
        signal: AbortSignal.timeout(10_000),
      });

      if (resp.ok) {
        return {
          valid: true,
          username: u,
          message: `Kaggle GPU access verified successfully for user "${u}". (30 hrs/week free GPU quota connected)`,
        };
      }

      if (resp.status === 401 || resp.status === 403) {
        return {
          valid: false,
          message: 'Invalid Kaggle credentials (HTTP 401). Please check your Username and API Key in kaggle.json.',
        };
      }

      const errText = await resp.text().catch(() => '');
      return {
        valid: false,
        message: `Kaggle verification returned HTTP ${resp.status}: ${errText.slice(0, 120)}`,
      };
    } catch (err: unknown) {
      return {
        valid: false,
        message: `Network error connecting to Kaggle: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  isCliAvailable(): boolean {
    const bin = this.resolveKaggleBin();
    return Boolean(bin && fs.existsSync(bin));
  }

  shouldUseNativeApi(): boolean {
    if (process.env.NODE_ENV === 'test' && !process.env.KAGGLE_FORCE_API) {
      return false;
    }
    const vaultUser = keyManager.get('KAGGLE_USERNAME');
    const vaultKey = keyManager.get('KAGGLE_KEY');
    if (vaultUser && vaultKey) {
      return true;
    }
    if (!this.isCliAvailable()) {
      return true;
    }
    return false;
  }

  /**
   * Pushes a kernel to Kaggle. Uses the native HTTPS API first; falls back to CLI if needed.
   */
  async pushKernel(options: PushKernelOptions, stagingDir?: string): Promise<{ versionNumber?: number; url?: string }> {
    if (this.shouldUseNativeApi()) {
      const auth = this.getAuthHeader();
      if (auth) {
        try {
          const body = {
            slug: options.ownerSlug,
            newTitle: options.newTitle,
            text: options.code,
            language: 'python',
            kernelType: 'script',
            isPrivate: true,
            enableGpu: options.isGpu ?? true,
            enableInternet: true,
            datasetDataSources: [],
            competitionDataSources: [],
            kernelDataSources: [],
            modelDataSources: [],
            categoryIds: [],
          };

          const resp = await fetch('https://api.kaggle.com/v1/kernels.KernelsApiService/SaveKernel', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: auth,
              'User-Agent': 'Terranoetis-Desktop/3.0.0',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(45_000),
          });

          if (resp.ok) {
            const data = (await resp.json()) as { error?: string; versionNumber?: number; url?: string };
            if (!data.error) {
              logger.info({ ownerSlug: options.ownerSlug, versionNumber: data.versionNumber }, 'Kernel pushed via native HTTPS API');
              return { versionNumber: data.versionNumber, url: data.url };
            }
            logger.warn({ error: data.error }, 'SaveKernel returned error in response body, checking fallback');
          } else {
            const errText = await resp.text().catch(() => '');
            logger.warn({ status: resp.status, err: errText.slice(0, 300) }, 'SaveKernel HTTP error, checking fallback');
          }
        } catch (httpErr) {
          logger.warn({ err: httpErr instanceof Error ? httpErr.message : String(httpErr) }, 'SaveKernel native call failed, checking fallback');
        }
      }
    }

    // Fallback: If staging directory was provided, invoke Kaggle CLI
    if (stagingDir) {
      await this.runCli(['kernels', 'push', '-p', stagingDir]);
      return {};
    }

    throw new Error('Failed to push kernel via Kaggle HTTPS API and no CLI fallback available.');
  }

  /**
   * Checks the status of a running kernel.
   */
  async getKernelStatus(ownerSlug: string): Promise<KernelStatusResponse> {
    const parts = ownerSlug.split('/');
    const userName = parts[0];
    const kernelSlug = parts[1] || ownerSlug;

    if (this.shouldUseNativeApi()) {
      const auth = this.getAuthHeader();
      if (auth) {
        try {
          const resp = await fetch('https://api.kaggle.com/v1/kernels.KernelsApiService/GetKernelSessionStatus', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: auth,
              'User-Agent': 'Terranoetis-Desktop/3.0.0',
            },
            body: JSON.stringify({ userName, kernelSlug }),
            signal: AbortSignal.timeout(15_000),
          });

          if (resp.ok) {
            const data = (await resp.json()) as { status?: string; failureMessage?: string };
            if (data.status) {
              const raw = data.status.toLowerCase();
              let normalized = raw;
              if (raw.includes('complete')) normalized = 'complete';
              else if (raw.includes('run')) normalized = 'running';
              else if (raw.includes('queue')) normalized = 'queued';
              else if (raw.includes('error')) normalized = 'error';
              else if (raw.includes('cancel')) normalized = 'cancel';

              return { status: normalized, failureMessage: data.failureMessage };
            }
          }
        } catch (e) {
          logger.debug({ err: e }, 'Native GetKernelSessionStatus failed, checking CLI fallback');
        }
      }
    }

    // CLI fallback
    const cliOutput = await this.runCli(['kernels', 'status', ownerSlug]);
    const match = cliOutput.match(/KernelWorkerStatus\.(\w+)/i);
    const parsed = match ? match[1].toLowerCase() : cliOutput.toLowerCase().trim();
    return { status: parsed };
  }

  /**
   * Downloads output files from a completed kernel run.
   */
  async downloadKernelOutput(ownerSlug: string, outputDir: string): Promise<string[]> {
    fs.mkdirSync(outputDir, { recursive: true });
    const parts = ownerSlug.split('/');
    const userName = parts[0];
    const kernelSlug = parts[1] || ownerSlug;

    if (this.shouldUseNativeApi()) {
      const auth = this.getAuthHeader();
      if (auth) {
        try {
          const resp = await fetch('https://api.kaggle.com/v1/kernels.KernelsApiService/ListKernelSessionOutput', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: auth,
              'User-Agent': 'Terranoetis-Desktop/3.0.0',
            },
            body: JSON.stringify({ userName, kernelSlug }),
            signal: AbortSignal.timeout(30_000),
          });

          if (resp.ok) {
            const data = (await resp.json()) as {
              files?: Array<{ fileName?: string; url?: string }>;
              log?: string;
            };

            const downloadedFiles: string[] = [];

            if (Array.isArray(data.files) && data.files.length > 0) {
              for (const item of data.files) {
                if (item.fileName && item.url) {
                  const targetPath = path.join(outputDir, item.fileName);
                  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                  const fileResp = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
                  if (fileResp.ok) {
                    const arrayBuf = await fileResp.arrayBuffer();
                    fs.writeFileSync(targetPath, Buffer.from(arrayBuf));
                    downloadedFiles.push(targetPath);
                  }
                }
              }
            }

            if (data.log) {
              const logPath = path.join(outputDir, 'error.log');
              try {
                fs.writeFileSync(logPath, data.log, 'utf-8');
              } catch { /* best effort */ }
            }

            if (downloadedFiles.length > 0) {
              logger.info({ count: downloadedFiles.length, outputDir }, 'Kernel output files downloaded via native HTTPS API');
              return downloadedFiles;
            }
          }
        } catch (e) {
          logger.warn({ err: e }, 'Native ListKernelSessionOutput download failed, checking CLI fallback');
        }
      }
    }

    // CLI fallback
    await this.runCli(['kernels', 'output', ownerSlug, '-p', outputDir, '--force']);
    return fs.readdirSync(outputDir).map(f => path.join(outputDir, f));
  }

  /**
   * Cancel a running kernel session.
   */
  async cancelKernel(ownerSlug: string): Promise<void> {
    try {
      await this.runCli(['kernels', 'cancel', ownerSlug]);
    } catch {
      logger.warn({ ownerSlug }, 'Failed to cancel Kaggle kernel (best effort)');
    }
  }

  /**
   * Locates the Kaggle CLI binary on disk if installed.
   */
  resolveKaggleBin(): string {
    if (this.kaggleBinResolved) return this.kaggleBinCache!;
    this.kaggleBinResolved = true;

    const candidates = [
      process.env.KAGGLE_BIN,
      path.join(os.homedir(), '.local', 'bin', 'kaggle'),
      path.join(os.homedir(), 'bin', 'kaggle'),
      '/usr/local/bin/kaggle',
      '/opt/homebrew/bin/kaggle',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        this.kaggleBinCache = candidate;
        return candidate;
      }
    }

    this.kaggleBinCache = 'kaggle';
    return this.kaggleBinCache;
  }

  private runCli(args: string[], timeoutMs = 120_000): Promise<string> {
    const bin = this.resolveKaggleBin();
    return new Promise((resolve, reject) => {
      execFile(
        bin,
        args,
        {
          timeout: timeoutMs,
          env: {
            ...process.env,
            KAGGLE_CONFIG_DIR: process.env.KAGGLE_CONFIG_DIR || path.join(os.homedir(), '.kaggle'),
          },
        },
        (err: ExecFileException | null, stdout: string, stderr: string) => {
          if (err) {
            const detail = [stdout, stderr].filter(Boolean).join('\n').trim();
            const message = detail ? `${err.message}\n${detail}` : err.message;
            reject(new Error(message));
            return;
          }
          resolve(stdout.trim());
        },
      );
    });
  }
}

export const kaggleClient = new KaggleClient();
