import { execFileSync } from 'child_process';
import { logger } from '../observability/logger';

/** Characters that could be used for shell injection - only reject truly dangerous shell metacharacters */
const DANGEROUS_CHARS = /[;&|`$\n\r!<>]/;

/** Sanitize a single argument for safe use in execFileSync */
function sanitizeArg(arg: string): string {
  if (DANGEROUS_CHARS.test(arg)) {
    logger.warn({ arg: arg.slice(0, 100) }, 'GitIntegration: dangerous characters in arg, rejecting');
    throw new Error(`Invalid argument contains shell metacharacters: ${arg.slice(0, 50)}`);
  }
  return arg;
}

export class GitIntegration {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /** Safe git execution using execFileSync with argument array (no shell interpolation) */
  private git(...args: string[]): string {
    const safeArgs = args.map(sanitizeArg);
    return execFileSync('git', safeArgs, { cwd: this.repoPath, encoding: 'utf-8' });
  }

  async createBranch(name: string): Promise<void> {
    this.git('checkout', '-b', name);
  }

  async commit(message: string, files: string[]): Promise<void> {
    this.git('add', ...files);
    // Files are already staged; just pass the message safely
    this.git('commit', '-m', message);
  }

  async push(branch: string): Promise<void> {
    this.git('push', 'origin', branch, '--no-verify');
  }

  async createPR(
    title: string,
    body: string,
    branch: string,
  ): Promise<{ url: string }> {
    const safeTitle = sanitizeArg(title);
    const safeBody = sanitizeArg(body);
    const safeBranch = sanitizeArg(branch);
    const output = execFileSync(
      'gh', ['pr', 'create', '--title', safeTitle, '--body', safeBody, '--head', safeBranch],
      { cwd: this.repoPath, encoding: 'utf-8', timeout: 30000 },
    );
    const url = output.trim();
    return { url };
  }

  async rollback(branch: string): Promise<void> {
    this.git('checkout', branch);
    this.git('reset', '--hard', `origin/${branch}`);
  }

  async getCurrentBranch(): Promise<string> {
    return this.git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  }

  async hasUncommittedChanges(): Promise<boolean> {
    const status = this.git('status', '--porcelain').trim();
    return status.length > 0;
  }

  async stash(): Promise<void> {
    this.git('stash');
  }

  async stashPop(): Promise<void> {
    this.git('stash', 'pop');
  }

  async getDiff(): Promise<string> {
    return this.git('diff', '--stat');
  }

  async getFileDiff(filePath: string): Promise<string> {
    return this.git('diff', '--', filePath);
  }

  async revertFile(filePath: string): Promise<void> {
    this.git('checkout', '--', filePath);
  }

  async createTag(tag: string, message: string): Promise<void> {
    this.git('tag', '-a', tag, '-m', message);
  }

  async merge(branch: string): Promise<void> {
    this.git('merge', branch, '--no-ff');
  }

  async listBranches(): Promise<string[]> {
    return this.git('branch', '--format=%(refname:short)').trim().split('\n').filter(Boolean);
  }

  async deleteBranch(branch: string): Promise<void> {
    try {
      this.git('branch', '-d', branch);
    } catch {
      this.git('branch', '-D', branch);
    }
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    try {
      this.git('merge-base', '--is-ancestor', ancestor, descendant);
      return true;
    } catch {
      return false;
    }
  }

  async getCommitLog(limit: number = 10): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
    const output = this.git('log', `--max-count=${limit}`, '--format=%H|%s|%an|%aI').trim();
    return output.split('\n').filter(Boolean).map(line => {
      const [hash, message, author, date] = line.split('|');
      return { hash, message, author, date };
    });
  }

  async getFileContentAtRef(filePath: string, ref: string = 'HEAD'): Promise<string> {
    return this.git('show', `${ref}:${filePath}`);
  }

  async getChangedFilesBetweenRefs(from: string, to: string): Promise<string[]> {
    const output = this.git('diff', '--name-only', from, to).trim();
    return output.split('\n').filter(Boolean);
  }

  async getStagedFiles(): Promise<string[]> {
    const output = this.git('diff', '--cached', '--name-only').trim();
    return output.split('\n').filter(Boolean);
  }

  async stageAll(): Promise<void> {
    this.git('add', '-A');
  }

  async amendCommit(): Promise<void> {
    this.git('commit', '--amend', '--no-edit');
  }

  async getBranchesContaining(commit: string): Promise<string[]> {
    const output = this.git('branch', '--contains', commit, '--format=%(refname:short)').trim();
    return output.split('\n').filter(Boolean);
  }

  async getCommitCount(): Promise<number> {
    const output = this.git('rev-list', '--count', 'HEAD').trim();
    return parseInt(output, 10);
  }

  async getRemoteUrl(): Promise<string> {
    return this.git('remote', 'get-url', 'origin').trim();
  }

  async getRepositoryName(): Promise<string> {
    const url = await this.getRemoteUrl();
    const match = url.match(/\/([^/]+?)(?:\.git)?$/);
    return match ? match[1] : 'local-repo';
  }

  async rebase(branch: string): Promise<void> {
    this.git('rebase', branch);
  }

  async getConfig(key: string): Promise<string> {
    return this.git('config', '--get', key).trim();
  }

  async setConfig(key: string, value: string): Promise<void> {
    this.git('config', key, value);
  }

  async getStatusSummary(): Promise<{ branch: string; ahead: number; behind: number; dirty: boolean }> {
    const branch = await this.getCurrentBranch();
    const dirty = await this.hasUncommittedChanges();
    let ahead = 0, behind = 0;
    try {
      const status = this.git('status', '--short', '-b').trim();
      const match = status.match(/ahead (\d+)/);
      if (match) ahead = parseInt(match[1], 10);
      const match2 = status.match(/behind (\d+)/);
      if (match2) behind = parseInt(match2[1], 10);
    } catch { /* no upstream */ }
    return { branch, ahead, behind, dirty };
  }
}
