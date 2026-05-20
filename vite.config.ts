import fs from "fs"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

const cesiumSourceDir = path.resolve(__dirname, './node_modules/cesium/Build/Cesium')
const cesiumPublicDir = path.resolve(__dirname, './public/cesium')

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
  if (!fs.existsSync(cesiumSourceDir)) return
  fs.rmSync(cesiumPublicDir, { recursive: true, force: true })
  copyDirectory(cesiumSourceDir, cesiumPublicDir)
}

function cesiumAssetsPlugin(): Plugin {
  return {
    name: 'cesium-assets',
    buildStart() {
      syncCesiumAssets()
    },
    configureServer() {
      syncCesiumAssets()
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), cesiumAssetsPlugin()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
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
    rollupOptions: {
      output: {
        manualChunks: {
          cesium: ['cesium'],
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      '@cesium/wasm-splats',
      '@spz-loader/core',
      '@tweenjs/tween.js',
      '@zip.js/zip.js/lib/zip-core.js',
      'autolinker',
      'bitmap-sdf',
      'dompurify',
      'draco3d/draco_decoder_nodejs.js',
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
      'protobufjs/dist/minimal/protobuf.js',
      'rbush',
      'topojson-client',
      'urijs',
    ],
    exclude: ['cesium'],
  },
});
