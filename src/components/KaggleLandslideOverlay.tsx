/**
 * KaggleLandslideOverlay — 3D debris-flow CFD rendering.
 *
 * GPU-animated via KaggleScalarOverlay with landslide configuration.
 * Displaced surface encodes debris thickness; real 3D arrows encode
 * downslope velocity; particles trace the flow.
 */

import {
  KaggleScalarOverlay,
  type ScalarOverlayConfig,
} from './kaggle/KaggleScalarOverlay';
import type { ColorStop } from './kaggle/shared';

const DEBRIS_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 139, g: 69, b: 19 },
  { stop: 0.15, r: 160, g: 82, b: 45 },
  { stop: 0.3, r: 180, g: 100, b: 60 },
  { stop: 0.5, r: 205, g: 120, b: 50 },
  { stop: 0.7, r: 220, g: 140, b: 40 },
  { stop: 0.85, r: 240, g: 100, b: 30 },
  { stop: 1.0, r: 220, g: 30, b: 30 },
];

const SCHEMES = [
  { name: 'default', label: 'Debris depth' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'coolwarm', label: 'Cool–Warm' },
];

// eslint-disable-next-line react-refresh/only-export-components
export const LANDSLIDE_CONFIG: ScalarOverlayConfig = {
  title: 'Landslide CFD',
  accent: 'rgba(180,83,9,0.95)',
  typeKey: 'landslide',
  fields: {
    finalName: 'landslide_depth',
    seriesName: 'snapshots_depth',
    vxName: 'snapshots_vx',
    vyName: 'snapshots_vy',
    timeName: 'snapshot_times',
  },
  defaultColormap: DEBRIS_COLORMAP,
  surfaceColormap: 'inferno',
  arrowColormap: 'plasma',
  exaggeration: 240,
  alphaFloor: 0.005,
  sideTint: true,
  schemes: SCHEMES,
  auxFetchNames: ['runout_distance', 'slope', 'terrain'],
  formatTime: (t) => `${t.toFixed(1)}s`,
  formatStats: ({ series, surface, arrows, aux, domainKm }) => {
    const maxDepth = surface.maxValue;
    const maxVel = arrows ? arrows.maxSpeed : 0;
    const runoutMax = aux['runout_distance']
      ? Math.max(...aux['runout_distance'].values.filter(Number.isFinite))
      : null;
    let affected = 0;
    if (series) {
      const n = series.shape[1] * series.shape[2];
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        // count only in the final frame
        const idx = (series.shape[0] - 1) * n + i;
        if (idx < series.values.length && series.values[idx] > 0.01) cnt++;
      }
      affected = (cnt / n) * 100;
    }
    return [
      ['Max depth', `${maxDepth.toFixed(2)} m`],
      ['Max speed', `${maxVel.toFixed(2)} m/s`],
      ['Affected', `${affected.toFixed(1)}%`],
      ['Runout', runoutMax ? `${runoutMax.toFixed(1)} km` : '—'],
      ['Domain', `${domainKm.toFixed(1)} km`],
    ];
  },
};

export default function KaggleLandslideOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={LANDSLIDE_CONFIG} />;
}

// React import locally for JSX
import * as React from 'react';
