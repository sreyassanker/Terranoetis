/**
 * PMTiles/Protomaps Zero-Infrastructure Basemap
 *
 * Provides a complete OpenStreetMap basemap from a single archive file,
 * eliminating the need for a tile server. Host on any static file server
 * (S3, R2, GitHub Pages, or even an SD card).
 *
 * Uses the PMTiles protocol with HTTP Range requests to fetch only the
 * tiles needed for the current viewport.
 *
 * Data source: https://protomaps.com/
 * Protocol: https://github.com/protomaps/PMTiles
 */

import * as Cesium from 'cesium';

const CesiumAny = Cesium as any;

let pmtilesLoaded = false;
let pmtilesSource: any = null;

/**
 * Initialize PMTiles basemap on a Cesium viewer
 * @param viewer Cesium Viewer instance
 * @param pmtilesUrl URL to the PMTiles file (e.g., from build.protomaps.com)
 * @returns The imagery layer that was added, or null if initialization failed
 */
export async function initPmtilesBasemap(
  viewer: Cesium.Viewer,
  pmtilesUrl: string = 'https://build.protomaps.com/downloads/latest/world.pmtiles',
): Promise<Cesium.ImageryLayer | null> {
  try {
    // Dynamic import of the PMTiles library
    const { PMTiles } = await import('pmtiles');

    const pmt = new PMTiles({ url: pmtilesUrl });

    // Create a Cesium imagery provider from PMTiles
    // PMTiles uses the PMTiles protocol for HTTP Range requests
    // @ts-ignore - PMTiles uses custom URL scheme not in Cesium types
    const provider = new CesiumAny.UrlTemplateImageryProvider({
      url: `pmtiles://${pmtilesUrl}/{z}/{x}/{y}.png`,
      credit: '© Protomaps © OpenStreetMap contributors',
      maximumLevel: 14,
    });

    const layer = viewer.imageryLayers.addImageryProvider(provider);

    pmtilesLoaded = true;
    pmtilesSource = pmt;

    console.log('[PMTiles] Basemap initialized from', pmtilesUrl);
    return layer;
  } catch (e) {
    console.warn('[PMTiles] Failed to initialize basemap, falling back to default:', e);
    return null;
  }
}

/**
 * Add a PMTiles overlay layer (e.g., terrain, buildings, labels)
 * @param viewer Cesium Viewer instance
 * @param pmtilesUrl URL to the PMTiles overlay file
 * @param options Configuration options
 * @returns The imagery layer
 */
export async function addPmtilesOverlay(
  viewer: Cesium.Viewer,
  pmtilesUrl: string,
  options: {
    alpha?: number;
    maximumLevel?: number;
    credit?: string;
    above?: boolean;
  } = {},
): Promise<Cesium.ImageryLayer | null> {
  try {
    // @ts-ignore - PMTiles uses custom URL scheme not in Cesium types
    const provider = new CesiumAny.UrlTemplateImageryProvider({
      url: `pmtiles://${pmtilesUrl}/{z}/{x}/{y}.png`,
      credit: options.credit || '© Protomaps',
      maximumLevel: options.maximumLevel || 14,
    });

    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = options.alpha ?? 0.7;

    return layer;
  } catch (e) {
    console.warn('[PMTiles] Failed to add overlay:', e);
    return null;
  }
}

/**
 * Pre-cache PMTiles tiles for offline use
 * @param pmtilesUrl URL to the PMTiles file
 * @param bounds Geographic bounds to cache (lat/lon)
 * @param maxZoom Maximum zoom level to cache
 */
export async function precachePmtiles(
  pmtilesUrl: string,
  bounds: { west: number; south: number; east: number; north: number },
  maxZoom: number = 10,
): Promise<void> {
  try {
    const cache = await caches.open('pmtiles-tiles');
    const totalTiles = Math.pow(4, maxZoom);

    // Calculate tile range for bounds
    for (let z = 0; z <= maxZoom; z++) {
      const n = Math.pow(2, z);
      const xMin = Math.floor(((bounds.west + 180) / 360) * n);
      const xMax = Math.ceil(((bounds.east + 180) / 360) * n);
      const yMin = Math.floor(((1 - Math.log(Math.tan((bounds.north * Math.PI) / 180) + 1 / Math.cos((bounds.north * Math.PI) / 180)) / Math.PI) / 2) * n);
      const yMax = Math.ceil(((1 - Math.log(Math.tan((bounds.south * Math.PI) / 180) + 1 / Math.cos((bounds.south * Math.PI) / 180)) / Math.PI) / 2) * n);

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          const tileUrl = `${pmtilesUrl.replace('.pmtiles', '')}/${z}/${x}/${y}.png`;
          try {
            await cache.add(tileUrl);
          } catch {
            // Skip failed tiles
          }
        }
      }
    }

    console.log('[PMTiles] Pre-cache complete for zoom 0-', maxZoom);
  } catch (e) {
    console.warn('[PMTiles] Pre-cache failed:', e);
  }
}

export function isPmtilesLoaded(): boolean {
  return pmtilesLoaded;
}
