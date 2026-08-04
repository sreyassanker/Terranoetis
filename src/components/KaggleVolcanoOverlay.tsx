/**
 * KaggleVolcanoOverlay — 3D ash plume + blanketing CFD.
 *
 * Ash_deposit snapshot series is displaced vertically with
 * magnitude-driven coloring; Lava thickness is auxiliary.
 */

import {
  KaggleScalarOverlay,
  type ScalarOverlayConfig,
} from './kaggle/KaggleScalarOverlay';
import type { ColorStop } from './kaggle/shared';

const ASH_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 60, g: 60, b: 60 },
  { stop: 0.25, r: 120, g: 110, b: 100 },
  { stop: 0.5, r: 180, g: 170, b: 160 },
  { stop: 0.75, r: 220, g: 210, b: 200 },
  { stop: 1.0, r: 250, g: 245, b: 240 },
];

const SCHEMES = [
  { name: 'default', label: 'Ash load' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'coolwarm', label: 'Cool–Warm' },
];

// eslint-disable-next-line react-refresh/only-export-components
export const VOLCANO_CONFIG: ScalarOverlayConfig = {
  title: 'Volcano CFD',
  accent: 'rgba(156,163,175,0.95)',
  typeKey: 'volcanic_eruption',
  fields: {
    finalName: 'ash_deposit',
    seriesName: 'snapshots_column',
  },
  defaultColormap: ASH_COLORMAP,
  surfaceColormap: 'plasma',
  arrowColormap: 'viridis',
  exaggeration: 240,
  alphaFloor: 0.005,
  sideTint: true,
  schemes: SCHEMES,
  legendUnit: 'kg/m²',
  auxFetchNames: ['lava_thickness'],
  formatTime: (t) => `${t.toFixed(1)} h`,
  formatStats: ({ surface, aux, domainKm }) => {
    const lava = aux['lava_thickness'] ? Math.max(...aux['lava_thickness'].values.filter(Number.isFinite)) : null;
    return [
      ['Max ash (kg/m²)', `${surface.maxValue.toExponential(2)}`],
      ['Max lava (m)', lava != null && isFinite(lava) ? lava.toFixed(1) : '—'],
      ['Domain', `${domainKm.toFixed(1)} km`],
    ];
  },
};

export default function KaggleVolcanoOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={VOLCANO_CONFIG} />;
}

import * as React from 'react';
