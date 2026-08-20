/**
 * KaggleWildfireOverlay — 3D fire front CFD.
 *
 * Overlaid fire_intensity becomes the elevated surface; hotspots burn
 * with dynamic lighting; particles trace smoke embers.
 */

import {
  KaggleScalarOverlay,
  type ScalarOverlayConfig,
} from './kaggle/KaggleScalarOverlay';
import type { ColorStop } from './kaggle/shared';

const FIRE_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 74, g: 4, b: 4 },
  { stop: 0.25, r: 200, g: 40, b: 0 },
  { stop: 0.5, r: 255, g: 80, b: 0 },
  { stop: 0.75, r: 255, g: 180, b: 40 },
  { stop: 1.0, r: 255, g: 255, b: 220 },
];

const SCHEMES = [
  { name: 'default', label: 'Fire intensity' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'coolwarm', label: 'Cool–Warm' },
];

// eslint-disable-next-line react-refresh/only-export-components
export const WILDFIRE_CONFIG: ScalarOverlayConfig = {
  title: 'Wildfire',
  accent: 'rgba(248,113,113,0.95)',
  typeKey: 'wildfire_spread',
  fields: {
    finalName: 'fire_intensity',
    seriesName: 'snapshots_state',
  },
  defaultColormap: FIRE_COLORMAP,
  surfaceColormap: 'inferno',
  arrowColormap: 'plasma',
  exaggeration: 280,
  alphaFloor: 0.005,
  sideTint: true,
  schemes: SCHEMES,
  legendUnit: 'kW/m',
  formatTime: (t) => `${t.toFixed(1)} h`,
  formatStats: ({ surface }) => [
    ['Max intensity', `${surface.maxValue.toFixed(2)} kW/m`],
    ['Domain', '→'],
  ],
};

export default function KaggleWildfireOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={WILDFIRE_CONFIG} />;
}

import * as React from 'react';
