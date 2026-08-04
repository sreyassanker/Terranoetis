/**
 * KaggleTsunamOverlay — 3D sea-surface height CFD.
 *
 * Animated tsunami wave-height snapshot series are displaced vertically
 * (real CFD buoy-style elevation) with magnitude-driven coloring.
 * Velocity is not provided so the arrow field is omitted.
 */

import {
  KaggleScalarOverlay,
  type ScalarOverlayConfig,
} from './kaggle/KaggleScalarOverlay';
import type { ColorStop } from './kaggle/shared';

const WAVE_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 10, g: 60, b: 100 },
  { stop: 0.25, r: 30, g: 130, b: 180 },
  { stop: 0.5, r: 70, g: 200, b: 140 },
  { stop: 0.75, r: 160, g: 220, b: 140 },
  { stop: 1.0, r: 230, g: 250, b: 220 },
];

const SCHEMES = [
  { name: 'default', label: 'Wave height' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'coolwarm', label: 'Cool–Warm' },
];

// eslint-disable-next-line react-refresh/only-export-components
export const TSUNAMI_CONFIG: ScalarOverlayConfig = {
  title: 'Tsunami CFD',
  accent: 'rgba(34,211,238,0.95)',
  typeKey: 'tsunami_wave',
  fields: {
    finalName: 'water_height',
    seriesName: 'snapshots_height',
  },
  defaultColormap: WAVE_COLORMAP,
  surfaceColormap: 'coolwarm',
  arrowColormap: 'viridis',
  exaggeration: 200,
  alphaFloor: 0.005,
  sideTint: true,
  schemes: SCHEMES,
  auxFetchNames: ['bathymetry'],
  // Kernel snapshot_times are minutes (tsunami-sim/main.py writes time_minutes) —
  // format accordingly so the user isn't shown 60×-inflated hours.
  formatTime: (t) => `${t.toFixed(2)} min`,
  formatStats: ({ surface, times, domainKm }) => {
    const lastTime = times.length > 0 ? times[times.length - 1] : 0;
    return [
      ['Max height', `${surface.maxValue.toFixed(2)} m`],
      ['Duration', lastTime > 0 ? `${lastTime.toFixed(0)} min (${(lastTime / 60).toFixed(1)} h)` : '—'],
      ['Domain', `${domainKm.toFixed(1)} km`],
    ];
  },
};

export default function KaggleTsunamOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={TSUNAMI_CONFIG} />;
}

import * as React from 'react';
