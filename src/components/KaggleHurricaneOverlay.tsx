/**
 * KaggleHurricaneOverlay — 3D wind/pressure CFD.
 *
 * wind_speed is displaced vertically like a weather radar volume; the
 * wind_direction/azimuth field could be added as arrows after normalization.
 */

import {
  KaggleScalarOverlay,
  type ScalarOverlayConfig,
} from './kaggle/KaggleScalarOverlay';
import type { ColorStop } from './kaggle/shared';

const WIND_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 40, g: 60, b: 130 },
  { stop: 0.25, r: 60, g: 130, b: 220 },
  { stop: 0.5, r: 60, g: 200, b: 220 },
  { stop: 0.75, r: 200, g: 220, b: 100 },
  { stop: 1.0, r: 230, g: 80, b: 50 },
];

const SCHEMES = [
  { name: 'default', label: 'Wind speed' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'coolwarm', label: 'Cool–Warm' },
];

// eslint-disable-next-line react-refresh/only-export-components
export const HURRICANE_CONFIG: ScalarOverlayConfig = {
  title: 'Hurricane CFD',
  accent: 'rgba(56,189,248,0.95)',
  typeKey: 'hurricane_landfall',
  fields: {
    finalName: 'wind_speed',
  },
  defaultColormap: WIND_COLORMAP,
  surfaceColormap: 'viridis',
  arrowColormap: 'viridis',
  exaggeration: 160,
  alphaFloor: 0.005,
  sideTint: true,
  schemes: SCHEMES,
  legendUnit: 'm/s',
  auxFetchNames: ['rainfall', 'surge_height'],
  formatTime: (t) => `${t.toFixed(2)} h`,
  formatStats: ({ surface }) => [
    ['Max wind', `${surface.maxValue.toFixed(1)} m/s`],
    ['Domain', '→'],
  ],
};

export default function KaggleHurricaneOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={HURRICANE_CONFIG} />;
}

import * as React from 'react';
