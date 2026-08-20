/**
 * KaggleEarthquakeOverlay — Professional 3D Shaking Field Visualization.
 *
 * Renders peak ground acceleration (PGA), velocity (PGV), and macroseismic 
 * intensity (MMI) datasets computed by the 3D elastic wave simulation.
 */

import React from 'react';
import {
  KaggleScalarOverlay,
  type ScalarOverlayConfig,
} from './kaggle/KaggleScalarOverlay';
import type { ColorStop } from './kaggle/shared';

const PGA_COLORMAP: ColorStop[] = [
  { stop: 0.00, r: 25,  g: 25,  b: 30  },
  { stop: 0.20, r: 45,  g: 85,  b: 155 },
  { stop: 0.40, r: 50,  g: 170, b: 120 },
  { stop: 0.60, r: 230, g: 190, b: 60  },
  { stop: 0.80, r: 235, g: 90,  b: 45  },
  { stop: 1.00, r: 255, g: 245, b: 230 },
];

const SCHEMES = [
  { name: 'default', label: 'Shaking Intensity' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'coolwarm', label: 'Cool–Warm' },
];

const EARTHQUAKE_CONFIG: ScalarOverlayConfig = {
  title: 'Earthquake 3D Wavefield',
  accent: 'rgba(250, 204, 21, 0.95)',
  typeKey: 'earthquake_swarm',
  fields: {
    // Primary scalar array exported by main.py
    finalName: 'pga_cm_s2',
  },
  defaultColormap: PGA_COLORMAP,
  surfaceColormap: 'inferno',
  arrowColormap: 'plasma',
  exaggeration: 650,
  alphaFloor: 0.005,
  sideTint: true,
  schemes: SCHEMES,
  legendUnit: 'cm/s²',
  auxFetchNames: ['mmi', 'pgv_cm_s', 'sa_1s_cm_s2'],
  formatTime: (t) => `${t.toFixed(1)}s`,
  formatStats: ({ surface, aux, domainKm }) => {
    // Extract max MMI from aux dataset if present
    const mmiArray = aux['mmi']?.values?.filter(Number.isFinite);
    const maxMMI = mmiArray && mmiArray.length > 0 ? Math.max(...mmiArray) : null;

    // Extract max PGV from aux dataset if present
    const pgvArray = aux['pgv_cm_s']?.values?.filter(Number.isFinite);
    const maxPGV = pgvArray && pgvArray.length > 0 ? Math.max(...pgvArray) : null;

    return [
      ['Max PGA', `${surface.maxValue.toFixed(1)} cm/s²`],
      ['Max PGV', maxPGV != null ? `${maxPGV.toFixed(1)} cm/s` : '—'],
      ['Max MMI', maxMMI != null ? `Intensity ${maxMMI.toFixed(0)}` : '—'],
      ['Domain Extent', `${domainKm.toFixed(1)} km`],
    ];
  },
};

export default function KaggleEarthquakeOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={EARTHQUAKE_CONFIG} />;
}