#!/usr/bin/env node
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function waitForPort(port, host = '127.0.0.1', timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryOnce() {
      const socket = net.connect({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for port ${port}`));
        setTimeout(tryOnce, 300);
      });
    }
    tryOnce();
  });
}

console.log('[desktop-launcher] 🚀 Preparing environment...');
const prep = spawn('node', ['scripts/dev-prep.js'], { cwd: ROOT, stdio: 'inherit' });

prep.on('close', async (code) => {
  if (code !== 0) {
    console.warn(`[desktop-launcher] dev-prep exited with code ${code}, continuing anyway...`);
  }

  console.log('[desktop-launcher] 🛰️ Starting backend intelligence server (port 3001)...');
  const server = spawn('npm', ['run', 'dev:server'], { cwd: ROOT, stdio: 'inherit' });

  function cleanup() {
    console.log('\n[desktop-launcher] 🛑 Shutting down backend server...');
    server.kill('SIGINT');
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await waitForPort(3001);
    console.log('[desktop-launcher] ✅ Backend is ready on http://127.0.0.1:3001');
    console.log('[desktop-launcher] 🌍 Launching Terranoetis Desktop App...');

    const appPath = path.join(ROOT, 'src-tauri/target/release/bundle/macos/Terranoetis.app');
    const app = spawn('open', ['-W', appPath]);

    app.on('close', (appCode) => {
      console.log(`[desktop-launcher] Terranoetis.app closed (code ${appCode}).`);
      cleanup();
    });

    app.on('error', (err) => {
      console.error('[desktop-launcher] Failed to open Terranoetis.app:', err);
      cleanup();
    });
  } catch (err) {
    console.error('[desktop-launcher] Error:', err.message);
    cleanup();
  }
});
