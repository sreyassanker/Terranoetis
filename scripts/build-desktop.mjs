#!/usr/bin/env node
/**
 * Cross-platform desktop packaging script (macOS · Windows · Linux)
 */
import { execSync } from 'node:child_process';

const platform = process.platform;
let targetBundle = 'app';

if (platform === 'win32') {
  targetBundle = 'nsis';
} else if (platform === 'linux') {
  targetBundle = 'deb';
} else {
  targetBundle = 'app';
}

console.log(`[build-desktop] 🖥️ Building desktop package for ${platform} (bundle: ${targetBundle})...`);

try {
  execSync('npm run build:all', { stdio: 'inherit' });
  execSync(`npx tauri build --bundles ${targetBundle} --no-sign`, { stdio: 'inherit' });
  execSync('node scripts/post-bundle.mjs', { stdio: 'inherit' });
  console.log(`[build-desktop] ✅ Desktop build complete for ${platform}.\n`);
} catch (err) {
  console.error('[build-desktop] ❌ Build failed:', err);
  process.exit(1);
}
