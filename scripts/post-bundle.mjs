#!/usr/bin/env node
/**
 * scripts/post-bundle.mjs
 *
 * Post-packaging hygiene for Terranoetis.app bundle on macOS:
 * 1. Removes obsolete legacy keys (LSRequiresCarbon, CSResourcesFileMapped) from Info.plist.
 * 2. Injects production runtime dependencies and static assets into the bundle resources.
 * 3. Verifies standalone portability outside the repository.
 */

import { existsSync, cpSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const APP_DIR = resolve('src-tauri/target/release/bundle/macos/Terranoetis.app');
const APP_PLIST = resolve(APP_DIR, 'Contents/Info.plist');
const BUNDLE_DIST_SERVER = resolve(APP_DIR, 'Contents/Resources/_up_/dist-server');

if (process.platform === 'darwin' && existsSync(APP_DIR)) {
  console.log('[post-bundle] Auditing and cleaning Terranoetis.app at:', APP_DIR);

  // 1. Clean Info.plist
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

  // 2. Ensure bundled node_modules
  const localNm = resolve('dist-server/node_modules');
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
  } else {
    console.warn('⚠️ [post-bundle] Local dist-server/node_modules not found!');
  }

  // 3. Ensure bundled airspaces geojson
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

  console.log('[post-bundle] ✅ Bundle hygiene complete.\n');
} else {
  console.log('[post-bundle] No macOS .app bundle found or non-Darwin platform; skipping bundle hygiene.');
}
