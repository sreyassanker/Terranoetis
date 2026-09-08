/**
 * KaggleHurricaneOverlay — 2D Holland wind + storm-surge field.
 *
 * The Holland (1980) wind speed (m/s) is draped as a FLAT georeferenced
 * raster on the globe's real terrain and animated over the snapshot series
 * (the storm translating across the study box). No vertical extrusion: wind
 * speed is an intensity, not an elevation — a displaced surface would be
 * decoration. Surge / inundation / rainfall are exposed as auxiliary stats.
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
  title: 'Hurricane Wind & Surge',
  accent: 'rgba(56,189,248,0.95)',
  typeKey: 'hurricane_landfall',
  fields: {
    // Sustained 10 m wind speed (m/s) — same scale in final + series so the
    // flat legend is honest. snapshots_wind.npy is the [F,R,C] animation.
    finalName: 'wind_speed',
    seriesName: 'snapshots_wind',
  },
  // Honest 2D: flat raster drape — wind speed is an intensity, not a height.
  flat: true,
  defaultColormap: WIND_COLORMAP,
  surfaceColormap: 'viridis',
  arrowColormap: 'viridis',
  exaggeration: 0,
  alphaFloor: 0.005,
  sideTint: false,
  schemes: SCHEMES,
  legendUnit: 'm/s',
  auxFetchNames: ['surge_height', 'rainfall', 'inundation'],
  formatTime: (t) => `${t.toFixed(2)} h`,
  formatStats: ({ surface, aux, times }) => {
    const fieldMax = (name: string) => {
      const g = aux[name];
      if (!g || g.shape.length < 2) return 0;
      let m = 0;
      for (const v of g.values) if (Number.isFinite(v) && v > m) m = v;
      return m;
    };
    const totalH = times.length > 0 ? times[times.length - 1] : 0;
    return [
      ['Peak wind', `${surface.maxValue.toFixed(1)} m/s`],
      ['Peak surge', `${fieldMax('surge_height').toFixed(2)} m`],
      ['Peak rain', `${fieldMax('rainfall').toFixed(0)} mm`],
      ['Max inundation', `${fieldMax('inundation').toFixed(2)} m`],
      ['Duration', `${totalH.toFixed(1)} h`],
      ['Model', 'Holland 1980 + SWE'],
    ];
  },
};

export default function KaggleHurricaneOverlay(
  props: Omit<React.ComponentProps<typeof KaggleScalarOverlay>, 'config'>,
) {
  return <KaggleScalarOverlay {...props} config={HURRICANE_CONFIG} />;
}

import * as React from 'react';
