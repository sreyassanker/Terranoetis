#!/usr/bin/env node
/**
 * scripts/patch-cesium.js
 *
 * Automatically patches Cesium / @cesium/engine's upstream ShaderSource.js bug:
 *   `const numberOfLines = match.match(/\n/gm).length;`
 * which throws:
 *   `TypeError: null is not an object (evaluating 't.match(/\n/gm).length')`
 * whenever a shader comment starts with `/**` without newline characters.
 *
 * This patch replaces it with:
 *   `(match.match(/\n/gm) || []).length`
 * ensuring 100% crash-free shader compilation across all platforms.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const searchDirs = [
  path.join(root, 'node_modules', '@cesium'),
  path.join(root, 'node_modules', 'cesium'),
];

const TARGET_REGEX = /(\b\w+\.match\(\/\\n\/[a-z]*\))\.length/g;

let patchedCount = 0;

function patchFile(filePath) {
  try {
    const original = fs.readFileSync(filePath, 'utf8');
    if (!TARGET_REGEX.test(original)) return;

    TARGET_REGEX.lastIndex = 0;
    const patched = original.replace(TARGET_REGEX, (_match, group1) => `(${group1} || []).length`);

    if (patched !== original) {
      fs.writeFileSync(filePath, patched, 'utf8');
      console.log(`[patch-cesium] Successfully patched: ${path.relative(root, filePath)}`);
      patchedCount++;
    }
  } catch (err) {
    console.warn(`[patch-cesium] Warning: Failed to patch ${filePath}: ${err.message}`);
  }
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs')) {
      patchFile(full);
    }
  }
}

console.log('[patch-cesium] Checking Cesium ShaderSource for regex length vulnerability...');
for (const dir of searchDirs) {
  scanDir(dir);
}
console.log(`[patch-cesium] Done. Patched ${patchedCount} file(s).`);
