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
    packages: 'external',
    sourcemap: true,
    logLevel: 'info',
  });

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

  // Copy production node_modules into dist-server/node_modules for full standalone execution
  console.log('📦 Packaging production runtime dependencies into dist-server/node_modules...');
  const tNm = Date.now();
  const rootNm = path.join(ROOT, 'node_modules');
  const distNm = path.join(OUT_DIR, 'node_modules');
  fs.mkdirSync(distNm, { recursive: true });

  const excludePkgs = new Set([
    '@anthropic-ai', '@playwright', 'playwright-core', 'typescript', 'vite', 'vitest',
    '@eslint', 'eslint', 'prettier', 'cesium', '@cesium', '@cesium-extends',
    'lucide-react', 'jspdf', 'jspdf-autotable', 'recharts', 'react-markdown',
    'cmdk', 'embla-carousel-react', 'vaul', 'sonner', 'react-resizable-panels',
    'react-hook-form', 'react-day-picker', 'input-otp', 'next-themes', 'dompurify',
    '.vite', '.cache', '@img',
    'onnxruntime-web'
  ]);

  if (fs.existsSync(rootNm)) {
    let copied = 0;
    for (const p of fs.readdirSync(rootNm)) {
      if (excludePkgs.has(p) || p.startsWith('.')) continue;
      const src = path.join(rootNm, p);
      const dest = path.join(distNm, p);
      try {
        if (!fs.existsSync(dest)) {
          fs.cpSync(src, dest, { recursive: true, dereference: false });
          copied++;
        }
      } catch (e) {
        // continue on non-critical file copy error
      }
    }
    const nmDuration = Date.now() - tNm;
    console.log(`✅ Packaged ${copied} production runtime modules in ${nmDuration}ms -> dist-server/node_modules`);
  }

  const stats = fs.statSync(path.join(OUT_DIR, 'server.mjs'));
  console.log(`📊 Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log('\n✨ Production server build complete!\n');
}

compile().catch((err) => {
  console.error('❌ Server build failed:', err);
  process.exit(1);
});
