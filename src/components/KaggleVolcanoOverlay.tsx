/**
 * KaggleVolcanoOverlay — 3D lava flow CFD.
 *
 * Lava thickness is the primary scalar field, displaced vertically (3D mound)
 * and animated over the snapshot series — the lava fills the vent area then
 * overflows and spreads outward, exactly like the flood water-depth surface.
 * Ash deposit is shown as an auxiliary stat.
 */

import {
  KaggleScalarOverlay,
  type ScalarOverlayConfig,
} from './kaggle/KaggleScalarOverlay';
import type { ColorStop } from './kaggle/shared';
import { formatSci } from '../lib/formatSci';

// ─── Lava Colormap: cooled dark crust → incandescent molten core ─────────
const LAVA_COLORMAP: ColorStop[] = [
  { stop: 0.0,  r: 25,  g: 15,  b: 10 },   // cooled dark crust
  { stop: 0.25, r: 100, g: 25,  b: 10 },   // dark red
  { stop: 0.5,  r: 200, g: 45,  b: 10 },   // red-orange
  { stop: 0.75, r: 250, g: 130, b: 25 },   // orange
  { stop: 1.0,  r: 255, g: 230, b: 120 },  // incandescent yellow-white
];

const SCHEMES = [
  { name: 'default', label: 'Lava flow' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'coolwarm', label: 'Cool–Warm' },
];

// eslint-disable-next-line react-refresh/only-export-components
export const VOLCANO_CONFIG: ScalarOverlayConfig = {
  title: 'Volcano',
  accent: 'rgba(234,88,12,0.95)',
  typeKey: 'volcanic_eruption',
  fields: {
    finalName: 'lava_thickness',
    seriesName: 'snapshots_lava',
    timeName: 'snapshot_times',
  },
  defaultColormap: LAVA_COLORMAP,
  surfaceColormap: 'turbo',
  arrowColormap: 'inferno',
  // 3D VOLUMETRIC LAVA: lava thickness is extruded into a rising mound so the
  // "fill the vent → overflow → spread outward" behaviour is visually obvious,
  // matching the flood overlay's water-depth mound.
  exaggeration: 20,
  alphaFloor: 0.01,
  sideTint: true,
  schemes: SCHEMES,
  legendUnit: 'm',
  auxFetchNames: ['ash_deposit'],
  formatTime: (t) => `${t.toFixed(1)} h`,
  formatStats: ({ surface, series, aux, domainKm, times }) => {
    const maxLava = surface.maxValue;
    const totalHours = times.length > 0 ? times[times.length - 1] : 0;

    // Lava-extent percentage in the final frame (cells above a thin crust).
    let lavaPct = 0;
    if (series) {
      const n = series.shape[1] * series.shape[2];
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        const idx = (series.shape[0] - 1) * n + i;
        if (idx < series.values.length && series.values[idx] > 0.05) cnt++;
      }
      lavaPct = (cnt / n) * 100;
    }

    const ash = aux['ash_deposit']
      ? Math.max(...aux['ash_deposit'].values.filter(Number.isFinite))
      : null;

    return [
      ['Max lava', `${maxLava.toFixed(1)} m`],
      ['Lava extent', `${lavaPct.toFixed(1)}%`],
      ['Max ash', ash != null && isFinite(ash) ? `${formatSci(ash)} kg/m²` : '—'],
      ['Duration', `${totalHours.toFixed(1)} h`],
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
