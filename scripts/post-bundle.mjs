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

  // Ensure bundled node_modules inside .app
  const bundleNm = resolve(BUNDLE_DIST_SERVER, 'node_modules');
  if (existsSync(localNm)) {
    if (!existsSync(bundleNm)) {
      console.log('[post-bundle] Copying production node_modules into .app bundle...');
      mkdirSync(BUNDLE_DIST_SERVER, { recursive: true });
      cpSync(localNm, bundleNm, { recursive: true });
      console.log('✅ [post-bundle] Embedded production node_modules into bundle.');
    } else {
      console.log('✅ [post-bundle] Bundle node_modules already present.');
    }
  }

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
  if (!existsSync(winNm)) {
    try {
      mkdirSync(winResources, { recursive: true });
      cpSync(localNm, winNm, { recursive: true });
      console.log('✅ [post-bundle] Embedded production node_modules into standalone release resources.');
    } catch { /* ignore */ }
  }

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

console.log('[post-bundle] ✅ Bundle hygiene complete.\n');
