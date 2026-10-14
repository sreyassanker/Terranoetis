import fs from "fs"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const cesiumSourceDir = path.resolve(__dirname, './node_modules/cesium/Build/Cesium')
const cesiumPublicDir = path.resolve(__dirname, './public/cesium')
let cesiumAssetsSynced = false

function copyDirectory(source: string, target: string) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath)
    } else {
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}

function syncCesiumAssets() {
  if (cesiumAssetsSynced || !fs.existsSync(cesiumSourceDir)) return
  fs.rmSync(cesiumPublicDir, { recursive: true, force: true })
  copyDirectory(cesiumSourceDir, cesiumPublicDir)
  cesiumAssetsSynced = true
}

function cesiumAssetsPlugin(): Plugin {
  return {
    name: 'cesium-assets',
    buildStart() {
      cesiumAssetsSynced = false
      syncCesiumAssets()
    },
    configureServer() {
      syncCesiumAssets()
    },
  }
}

/**
 * Serve a true 404 for missing files under /models/ (the transformers.js local
 * weights dir). Without this, Vite's SPA fallback answers a missing model file
 * with index.html + HTTP 200, so transformers.js never falls back to
 * huggingface.co and instead tries to JSON.parse the HTML →
 * "Unrecognized token '<'".
 */
function models404Plugin(): Plugin {
  const modelsRoot = path.resolve(__dirname, 'public', 'models')
  return {
    name: 'models-404',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqPath = (req.url ?? '').split('?')[0]
        if (!reqPath.startsWith('/models/')) return next()
        const rel = reqPath.replace(/^\/+/, '').replace(/^models\//, '')
        const resolved = path.resolve(modelsRoot, rel)
        if (!resolved.startsWith(modelsRoot + path.sep) || !fs.existsSync(resolved)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain')
          res.end('Not Found')
          return
        }
        next()
      })
    },
  }
}

/**
 * Guards against Cesium's ShaderSource bug:
 * `match.match(/\n/gm).length` throws TypeError when a comment starts with `/**` without newlines.
 * This plugin guarantees any module bundled containing this pattern is patched safely.
 */
function cesiumShaderPatchPlugin(): Plugin {
  const REGEX = /(\b\w+\.match\(\/\\n\/[a-z]*\))\.length/g;
  return {
    name: 'cesium-shader-patch',
    enforce: 'pre',
    transform(code, id) {
      if ((id.includes('cesium') || id.includes('ShaderSource')) && REGEX.test(code)) {
        REGEX.lastIndex = 0;
        return {
          code: code.replace(REGEX, (_m, g1) => `(${g1} || []).length`),
          map: null,
        };
      }
      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [cesiumShaderPatchPlugin(), react(), cesiumAssetsPlugin(), models404Plugin()],
  assetsInclude: ['**/*.wasm', '**/*.worker.js'],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://127.0.0.1:3001',
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "cesium": path.resolve(__dirname, "./node_modules/cesium"),
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    sourcemap: 'hidden', // upload to error tracking, do not expose in browser
    rollupOptions: {
      external: [/satellite\.js\/wasm-build/],
      output: {
        manualChunks: {
          cesium: ['cesium'],
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      '@tweenjs/tween.js',
      '@zip.js/zip.js/lib/zip-core.js',
      'autolinker',
      'bitmap-sdf',
      'dompurify',
      'earcut',
      'grapheme-splitter',
      'jsep',
      'kdbush',
      'ktx-parse',
      'lerc',
      'mersenne-twister',
      'meshoptimizer',
      'nosleep.js',
      'pako/lib/inflate.js',
      'rbush',
      'topojson-client',
      'urijs',
    ],
    exclude: ['cesium', 'helmet', 'express', 'tsx', 'satellite.js', '@cesium/wasm-splats', '@spz-loader/core', 'draco3d', 'draco3d/draco_decoder_nodejs.js'],
  },
});
