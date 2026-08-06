/**
 * KaggleFloodOverlay — 3D flood inundation CFD rendering.
 *
 * Uses the shared KaggleScalarOverlay with flood-specific configuration,
 * identical to how landslide/wildfire/hurricane/etc. render their CFD.
 * The displaced surface encodes water depth; 3D arrows encode flow
 * velocity; the colormap goes blue→red for depth magnitude.
 */

import {
  KaggleScalarOverlay,
  type ScalarOverlayConfig,
} from './kaggle/KaggleScalarOverlay';
import type { ColorStop } from './kaggle/shared';

const DEPTH_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 10, g: 60, b: 180 },
  { stop: 0.15, r: 30, g: 120, b: 220 },
  { stop: 0.3, r: 50, g: 180, b: 220 },
  { stop: 0.5, r: 60, g: 210, b: 140 },
  { stop: 0.7, r: 220, g: 200, b: 50 },
  { stop: 0.85, r: 240, g: 120, b: 30 },
  { stop: 1.0, r: 220, g: 30, b: 30 },
];

const SCHEMES = [
  { name: 'default', label: 'Depth (blue→red)' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'coolwarm', label: 'Cool–Warm' },
  { name: 'grayscale', label: 'Grayscale' },
];

// eslint-disable-next-line react-refresh/only-export-components
export const FLOOD_CONFIG: ScalarOverlayConfig = {
  title: 'Flood CFD',
  accent: 'rgba(59,130,246,0.95)',
  typeKey: 'flood_inundation',
  fields: {
    finalName: 'water_depth_final',
    seriesName: 'snapshots_depth',
    vxName: 'snapshots_vx',
    vyName: 'snapshots_vy',
    timeName: 'snapshot_times',
  },
  defaultColormap: DEPTH_COLORMAP,
  surfaceColormap: 'turbo',
  arrowColormap: 'inferno',
  // Flood is a 2D inundation map — no vertical displacement. The surface
  // stays clamped to the terrain and uses only color (RGBA) to encode
  // water depth. Landslide uses 240m because debris thickness varies;
  // flood depth is typically < 1m so geometry extrusion is wrong.
  exaggeration: 0,
  alphaFloor: 0.02,
  sideTint: true,
  schemes: SCHEMES,
  formatTime: (t) => `${t.toFixed(1)}h`,
  formatStats: ({ series, surface, arrows, domainKm }) => {
    const maxDepth = surface.maxValue;
    const maxVel = arrows ? arrows.maxSpeed : 0;
    let flooded = 0;
    if (series) {
      const n = series.shape[1] * series.shape[2];
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        // count only in the final frame
        const idx = (series.shape[0] - 1) * n + i;
        if (idx < series.values.length && series.values[idx] > 0.01) cnt++;
      }
      flooded = (cnt / n) * 100;
    }
    return [
      ['Max depth', `${maxDepth.toFixed(2)} m`],
      ['Max speed', `${maxVel.toFixed(2)} m/s`],
      ['Flooded', `${flooded.toFixed(1)}%`],
      ['Domain', `${domainKm.toFixed(1)} km`],
    ];
  },
};

export default function KaggleFloodOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={FLOOD_CONFIG} />;
}

// React import locally for JSX
import * as React from 'react';