/**
 * KaggleEarthquakeOverlay — 3D shaking-field visualization.
 *
 * The earthquake dataset's peak ground acceleration becomes a displaced
 * 3D surface (wave-liked terrain deformity). Arrows map local ADCP-style
 * rigid-body deformation at all grid cells — non-existent for earthquake
 * sims — so vectors are disabled.
 */

import {
  KaggleScalarOverlay,
  type ScalarOverlayConfig,
} from './kaggle/KaggleScalarOverlay';
import type { ColorStop } from './kaggle/shared';

const PGA_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 35, g: 35, b: 35 },
  { stop: 0.25, r: 90, g: 45, b: 60 },
  { stop: 0.5, r: 200, g: 80, b: 60 },
  { stop: 0.75, r: 245, g: 200, b: 100 },
  { stop: 1.0, r: 255, g: 245, b: 220 },
];

const SCHEMES = [
  { name: 'default', label: 'Shaking intensity' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'coolwarm', label: 'Cool–Warm' },
];

export const EARTHQUAKE_CONFIG: ScalarOverlayConfig = {
  title: 'Earthquake CFD',
  accent: 'rgba(250,204,21,0.95)',
  typeKey: 'earthquake_swarm',
  fields: {
    // Kernel writes `pga_cm_s2.npy` (peak ground acceleration, cm/s²).
    // Was 'pga_cm_s' — a 404 on every run, so the overlay never rendered.
    finalName: 'pga_cm_s2',
  },
  defaultColormap: PGA_COLORMAP,
  surfaceColormap: 'inferno',
  arrowColormap: 'plasma',
  exaggeration: 600,
  alphaFloor: 0.005,
  sideTint: true,
  schemes: SCHEMES,
  legendUnit: 'cm/s²',
  auxFetchNames: ['mmi', 'pgv_cm_s'],
  formatTime: (t) => t.toFixed(0),
  formatStats: ({ surface, aux, domainKm }) => {
    const mmi = aux['mmi'] ? Math.max(...aux['mmi'].values.filter(Number.isFinite)) : null;
    return [
      ['Max PGA', `${surface.maxValue.toFixed(2)} cm/s²`],
      ['Max MMI', mmi != null && isFinite(mmi) ? mmi.toFixed(1) : '—'],
      ['Domain', `${domainKm.toFixed(1)} km`],
    ];
  },
};

export default function KaggleEarthquakeOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={EARTHQUAKE_CONFIG} />;
}

import * as React from 'react';
