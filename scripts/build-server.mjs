import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'dist-server');

console.log('═══════════════════════════════════════════════════════════');
console.log(' TERRANOETIS PRODUCTION SERVER COMPILER');
console.log('═══════════════════════════════════════════════════════════\n');

async function compile() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  console.log('📦 Bundling server/index.ts with esbuild (ESM Node20)...');
  const t0 = Date.now();

  await build({
    entryPoints: [path.join(ROOT, 'server/index.ts')],
    outfile: path.join(OUT_DIR, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; import { fileURLToPath as __fileURLToPath } from 'node:url'; import __path from 'node:path'; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __path.dirname(__filename);",
    },
    external: [
      'better-sqlite3',
      'bindings',
      'h5wasm',
      'fsevents',
      'esbuild',
    ],
    sourcemap: false,
    logLevel: 'info',
  });

  const oldMap = path.join(OUT_DIR, 'server.mjs.map');
  if (fs.existsSync(oldMap)) fs.rmSync(oldMap, { force: true });

  const duration = Date.now() - t0;
  console.log(`✅ Server bundled in ${duration}ms -> dist-server/server.mjs`);

  // Copy schema.sql
  const schemaSrc = path.join(ROOT, 'server/db/schema.sql');
  const schemaDest = path.join(OUT_DIR, 'schema.sql');
  if (fs.existsSync(schemaSrc)) {
    fs.copyFileSync(schemaSrc, schemaDest);
    console.log('📋 Copied schema.sql -> dist-server/schema.sql');
  }

  // Copy combined_airspaces.geojson static data asset
  const airspaceSrc = path.join(ROOT, 'public/data/combined_airspaces.geojson');
  const airspaceDestDir = path.join(OUT_DIR, 'public/data');
  const airspaceAltDir = path.join(OUT_DIR, 'data');
  fs.mkdirSync(airspaceDestDir, { recursive: true });
  fs.mkdirSync(airspaceAltDir, { recursive: true });
  if (fs.existsSync(airspaceSrc)) {
    fs.copyFileSync(airspaceSrc, path.join(airspaceDestDir, 'combined_airspaces.geojson'));
    fs.copyFileSync(airspaceSrc, path.join(airspaceAltDir, 'combined_airspaces.geojson'));
    console.log('📋 Copied combined_airspaces.geojson -> dist-server/public/data and dist-server/data');
  }

  // Generate package.json
  const pkgJson = {
    name: 'terranoetis-server-bundle',
    version: '3.0.0',
    type: 'module',
    main: 'server.mjs',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify(pkgJson, null, 2));
  console.log('📄 Generated dist-server/package.json');

  // Copy ONLY native/runtime packages needed by external imports
  console.log('📦 Packaging required native modules into dist-server/node_modules...');
  const tNm = Date.now();
  const rootNm = path.join(ROOT, 'node_modules');
  const distNm = path.join(OUT_DIR, 'node_modules');
  fs.rmSync(distNm, { recursive: true, force: true });
  fs.mkdirSync(distNm, { recursive: true });

  const requiredNativePkgs = [
    'better-sqlite3',
    'bindings',
    'file-uri-to-path',
    'h5wasm',
  ];

  let copied = 0;
  for (const pkg of requiredNativePkgs) {
    const src = path.join(rootNm, pkg);
    const dest = path.join(distNm, pkg);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true, dereference: false });
      copied++;
    } else {
      console.warn(`⚠️ Warning: native package "${pkg}" not found in root node_modules`);
    }
  }
  const nmDuration = Date.now() - tNm;
  console.log(`✅ Packaged ${copied} essential native modules in ${nmDuration}ms -> dist-server/node_modules`);

  const stats = fs.statSync(path.join(OUT_DIR, 'server.mjs'));
  console.log(`📊 Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log('\n✨ Production server build complete!\n');
}

compile().catch((err) => {
  console.error('❌ Server build failed:', err);
  process.exit(1);
});
