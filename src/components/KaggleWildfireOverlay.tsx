/**
 * KaggleWildfireOverlay — 2D Rothermel fire-front spread.
 *
 * The burning-fraction field (0..1) is draped as a FLAT georeferenced raster
 * on the globe's real terrain and animated over the snapshot series. No
 * vertical extrusion: fire intensity is not an elevation.
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
  { name: 'default', label: 'Burning fraction' },
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
    // Continuous burning fraction (0..1) — same scale in final + series so
    // the flat legend is honest. (fire_intensity.npy holds the final frame.)
    finalName: 'fire_intensity',
    seriesName: 'snapshots_intensity',
  },
  flat: true,
  defaultColormap: FIRE_COLORMAP,
  surfaceColormap: 'inferno',
  arrowColormap: 'plasma',
  exaggeration: 0,
  alphaFloor: 0.005,
  sideTint: false,
  schemes: SCHEMES,
  legendUnit: '',
  auxFetchNames: ['fire_state'],
  formatTime: (t) => `${t.toFixed(1)} h`,
  formatStats: ({ surface, aux, times }) => {
    // Burned fraction from the final state frame (0 unburned, 1 burning, 2 burned)
    let burnedPct = 0;
    const state = aux['fire_state'];
    if (state && state.shape.length === 2) {
      let burned = 0;
      for (const v of state.values) if (v >= 1.5) burned++;
      burnedPct = (burned / (state.shape[0] * state.shape[1])) * 100;
    }
    const totalH = times.length > 0 ? times[times.length - 1] : 0;
    return [
      ['Peak burning', surface.maxValue.toFixed(2)],
      ['Burned area', `${burnedPct.toFixed(1)}%`],
      ['Duration', `${totalH.toFixed(1)} h`],
      ['Model', 'Rothermel 2D'],
    ];
  },
};

export default function KaggleWildfireOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={WILDFIRE_CONFIG} />;
}

import * as React from 'react';
