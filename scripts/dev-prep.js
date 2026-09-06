#!/usr/bin/env node
/**
 * Cross-platform dev bootstrap (macOS · Windows · Linux).
 *
 * Replaces the old POSIX-only npm-script internals:
 *   - dev:client used `lsof -ti:3000 | xargs kill -9`  (macOS/Linux only)
 *   - dev:redis used `bash -c 'redis-cli ...'`          (no bash on Windows)
 *
 * Responsibilities (all best-effort — this script must NEVER block `npm run dev`):
 *   1. Free port 3000 if a previous vite is still holding it.
 *   2. Ensure Redis on 127.0.0.1:6379; start a local one when possible;
 *      otherwise warn — the server falls back to SQLite by design.
 */
import { execSync, spawn } from 'node:child_process';
import net from 'node:net';

const IS_WIN = process.platform === 'win32';
const ONLY = process.argv.includes('--redis-only') ? 'redis'
  : process.argv.includes('--ports-only') ? 'ports' : 'all';

function log(msg) { console.log(`[dev] ${msg}`); }

function tryConnect(host, port, ms = 1200) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(ms, () => { s.destroy(); resolve(false); });
  });
}

function freePort(port) {
  return new Promise(async (resolve) => {
    // Vite may bind IPv4 or IPv6 (or both) — probe both stacks.
    const inUse = (await tryConnect('127.0.0.1', port)) || (await tryConnect('::1', port));
    if (!inUse) { resolve(); return; }
    let pid = null;
    try {
      if (IS_WIN) {
        // netstat -ano lists "TCP 127.0.0.1:3000 ... LISTENING <pid>"
        const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8', timeout: 5000 });
        for (const line of out.split('\n')) {
          if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
            pid = line.trim().split(/\s+/).pop();
            if (pid && pid !== '0') break;
            pid = null;
          }
        }
      } else {
        pid = execSync(`lsof -ti:${port}`, { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0] || null;
      }
    } catch { /* tool missing / nothing listening */ }
    if (!pid) { resolve(); return; }
    try {
      if (IS_WIN) execSync(`taskkill /PID ${pid} /F`, { timeout: 5000, stdio: 'ignore' });
      else process.kill(Number(pid), 'SIGKILL');
      log(`freed port ${port} (killed pid ${pid})`);
    } catch (e) {
      log(`port ${port} busy and could not be freed (${e.message}) — vite will pick another port`);
    }
    resolve();
  });
}

const portOpen = (port) => tryConnect('127.0.0.1', port);

async function ensureRedis() {
  if (await portOpen(6379)) { log('redis already running'); return; }
  if (IS_WIN) {
    log('warning: Redis has no native Windows build — continuing with the SQLite fallback (this is supported).');
    return;
  }
  try {
    const child = spawn('redis-server', ['--daemonize', 'yes'], { stdio: 'ignore' });
    child.on('error', () => log('warning: redis-server not found — server will fall back to SQLite'));
    await new Promise((r) => setTimeout(r, 800));
    log((await portOpen(6379)) ? 'redis started' : 'warning: redis did not come up — server will fall back to SQLite');
  } catch {
    log('warning: redis not available — server will fall back to SQLite');
  }
}

try {
  if (ONLY === 'all' || ONLY === 'ports') await freePort(3000);
  if (ONLY === 'all' || ONLY === 'redis') await ensureRedis();
} catch (e) {
  log(`dev-prep skipped: ${e.message}`);
}
process.exit(0);
