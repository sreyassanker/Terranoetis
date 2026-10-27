#!/usr/bin/env node
/**
 * scripts/post-bundle.mjs
 *
 * Cross-platform post-packaging hygiene (macOS · Windows · Linux):
 * 1. macOS: Cleans Info.plist legacy keys, embeds production node_modules & assets into .app bundle.
 * 2. Windows / Linux: Embeds production node_modules & assets into release resources.
 * 3. Synchronizes local GGUF models into OS Application Support / AppData.
 */

import { existsSync, cpSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const isDarwin = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const APP_DIR = resolve('src-tauri/target/release/bundle/macos/Terranoetis.app');
const APP_PLIST = resolve(APP_DIR, 'Contents/Info.plist');
const BUNDLE_DIST_SERVER = resolve(APP_DIR, 'Contents/Resources/_up_/dist-server');
const localNm = resolve('dist-server/node_modules');

// ── 1. macOS .app Bundle Hygiene ──
if (isDarwin && existsSync(APP_DIR)) {
  console.log('[post-bundle] 🍏 Auditing and cleaning Terranoetis.app at:', APP_DIR);

  // Clean Info.plist
  if (existsSync(APP_PLIST)) {
    const keysToDelete = ['LSRequiresCarbon', 'CSResourcesFileMapped'];
    for (const key of keysToDelete) {
      try {
        execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, APP_PLIST], { stdio: 'ignore' });
        console.log(`[post-bundle] Removed legacy plist key: ${key}`);
      } catch {
        // Ignored if key doesn't exist
      }
    }
    try {
      const bid = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', APP_PLIST], { encoding: 'utf8' }).trim();
      console.log(`[post-bundle] Verified bundle identifier: ${bid}`);
    } catch (err) {
      console.warn('[post-bundle] Plist read check failed:', err);
    }
  }

  // Ensure bundled server files inside .app
  for (const f of ['server.mjs', 'package.json', 'schema.sql']) {
    const src = resolve('dist-server', f);
    const dest = resolve(BUNDLE_DIST_SERVER, f);
    if (existsSync(src)) {
      cpSync(src, dest);
      console.log(`✅ [post-bundle] Embedded ${f} into bundle.`);
    }
  }

  // Ensure bundled node_modules inside .app
  const bundleNm = resolve(BUNDLE_DIST_SERVER, 'node_modules');
  if (existsSync(localNm)) {
    console.log('[post-bundle] Syncing minimal production node_modules into .app bundle...');
    mkdirSync(BUNDLE_DIST_SERVER, { recursive: true });
    try {
      const { rmSync } = await import('node:fs');
      rmSync(bundleNm, { recursive: true, force: true });
    } catch { /* ignore */ }
    cpSync(localNm, bundleNm, { recursive: true });
    console.log('✅ [post-bundle] Embedded minimal production node_modules into bundle.');
  }

  // Clean up any lingering debug maps in bundle
  try {
    const bundleMap = resolve(BUNDLE_DIST_SERVER, 'server.mjs.map');
    if (existsSync(bundleMap)) {
      const { rmSync } = await import('node:fs');
      rmSync(bundleMap, { force: true });
    }
  } catch { /* ignore */ }

  // Ensure bundled airspaces geojson inside .app
  const localAirspacesData = resolve('dist-server/data/combined_airspaces.geojson');
  const bundleAirspacesData = resolve(BUNDLE_DIST_SERVER, 'data/combined_airspaces.geojson');
  const localAirspaces = resolve('dist-server/combined_airspaces.geojson');
  const bundleAirspaces = resolve(BUNDLE_DIST_SERVER, 'combined_airspaces.geojson');

  if (existsSync(localAirspacesData) && !existsSync(bundleAirspacesData)) {
    mkdirSync(resolve(BUNDLE_DIST_SERVER, 'data'), { recursive: true });
    cpSync(localAirspacesData, bundleAirspacesData);
    console.log('✅ [post-bundle] Embedded data/combined_airspaces.geojson into bundle.');
  }
  if (existsSync(localAirspaces) && !existsSync(bundleAirspaces)) {
    cpSync(localAirspaces, bundleAirspaces);
    console.log('✅ [post-bundle] Embedded combined_airspaces.geojson into bundle.');
  }
}

// ── 2. Windows / Linux Standalone Release Hygiene ──
const releaseDir = resolve('src-tauri/target/release');
if (existsSync(releaseDir) && existsSync(localNm)) {
  const winResources = resolve(releaseDir, 'resources/dist-server');
  const winNm = resolve(winResources, 'node_modules');
  try {
    mkdirSync(winResources, { recursive: true });
    const { rmSync } = await import('node:fs');
    rmSync(winNm, { recursive: true, force: true });
    cpSync(localNm, winNm, { recursive: true });
    console.log('✅ [post-bundle] Embedded minimal production node_modules into standalone release resources.');
  } catch { /* ignore */ }

  const winAirspaces = resolve(winResources, 'data/combined_airspaces.geojson');
  const localAirspacesData = resolve('dist-server/data/combined_airspaces.geojson');
  if (existsSync(localAirspacesData) && !existsSync(winAirspaces)) {
    try {
      mkdirSync(resolve(winResources, 'data'), { recursive: true });
      cpSync(localAirspacesData, winAirspaces);
      console.log('✅ [post-bundle] Embedded data/combined_airspaces.geojson into standalone release resources.');
    } catch { /* ignore */ }
  }
}

// ── 3. Synchronize any local models into Application Data models ──
const localModelsDir = resolve('models');
const homedir = process.env.HOME || process.env.USERPROFILE || '';
if (homedir && existsSync(localModelsDir)) {
  const isLinux = process.platform === 'linux';
  let appModelsDir;
  if (isWin) {
    appModelsDir = resolve(process.env.APPDATA || resolve(homedir, 'AppData/Roaming'), 'Terranoetis/models');
  } else if (isLinux) {
    appModelsDir = resolve(process.env.XDG_DATA_HOME || resolve(homedir, '.local/share'), 'Terranoetis/models');
  } else {
    appModelsDir = resolve(homedir, 'Library/Application Support/Terranoetis/models');
  }
  mkdirSync(appModelsDir, { recursive: true });
  try {
    const files = readdirSync(localModelsDir);
    for (const f of files) {
      if (f.endsWith('.gguf') && !f.endsWith('.partial')) {
        const dest = resolve(appModelsDir, f);
        if (!existsSync(dest)) {
          try {
            symlinkSync(resolve(localModelsDir, f), dest);
            console.log(`✅ [post-bundle] Linked local model ${f} into Application Support.`);
          } catch {
            try {
              cpSync(resolve(localModelsDir, f), dest);
              console.log(`✅ [post-bundle] Copied local model ${f} into Application Data.`);
            } catch { /* ignore */ }
          }
        }
      }
    }
  } catch { /* ignore */ }
}

// ── 4. Security Verification: Ensure NO .env files are shipped in release bundles ──
const forbiddenEnvLocations = [
  resolve(BUNDLE_DIST_SERVER, '.env'),
  resolve('dist-server/.env'),
  resolve('src-tauri/target/release/bundle/macos/Terranoetis.app/Contents/Resources/_up_/dist-server/.env'),
  resolve('src-tauri/target/release/_up_/dist-server/.env'),
  resolve('src-tauri/target/release/resources/dist-server/.env'),
];

for (const envLoc of forbiddenEnvLocations) {
  if (existsSync(envLoc)) {
    try {
      rmSync(envLoc, { force: true });
      console.log(`🛡️ [post-bundle] Stripped forbidden sensitive file: ${envLoc}`);
    } catch {
      throw new Error(`SECURITY AUDIT FAILURE: Plaintext .env detected at ${envLoc}`);
    }
  }
}

console.log('[post-bundle] ✅ Bundle hygiene complete.\n');
