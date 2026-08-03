/**
 * KaggleLegend — GIS-style legend for simulation overlays.
 *
 * Shows a color ramp (min → max), lets the user switch color schemes,
 * and adjust layer opacity. The "default" scheme is the overlay's native
 * hazard colormap (e.g. blue→red flood, brown→red debris flow).
 */

import { useMemo } from 'react';
import type { ColorStop } from './shared';

export interface SchemeOption {
  name: string;
  label: string;
}

interface KaggleLegendProps {
  title: string;
  unit: string;
  min: number;
  max: number;
  colormap: ColorStop[];
  scheme: string;
  schemes: SchemeOption[];
  onSchemeChange: (scheme: string) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  decimals?: number;
}

export default function KaggleLegend({
  title,
  unit,
  min,
  max,
  colormap,
  scheme,
  schemes,
  onSchemeChange,
  opacity,
  onOpacityChange,
  decimals = 1,
}: KaggleLegendProps) {
  const gradientCss = useMemo(() => {
    const stops = colormap.map(c => `rgb(${c.r},${c.g},${c.b}) ${Math.round(c.stop * 100)}%`);
    return `linear-gradient(to top, ${stops.join(', ')})`;
  }, [colormap]);

  const fmt = (v: number) => v.toFixed(decimals);

  return (
    <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 10, color: '#e5e7eb', marginBottom: 4 }}>
        {title} <span style={{ opacity: 0.6 }}>({unit})</span>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 9, opacity: 0.8, minWidth: 34 }}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(max)}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(min + (max - min) / 2)}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(min)}</span>
        </div>
        <div
          style={{
            width: 14,
            borderRadius: 3,
            background: gradientCss,
            border: '1px solid rgba(255,255,255,0.25)',
            minHeight: 54,
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 9, opacity: 0.7, whiteSpace: 'nowrap' }}>Colors</span>
        <select
          value={scheme}
          onChange={e => onSchemeChange(e.target.value)}
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 4,
            fontSize: 10,
            padding: '2px 4px',
          }}
        >
          {schemes.map(s => (
            <option key={s.name} value={s.name} style={{ background: '#1f2937', color: '#fff' }}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 9, opacity: 0.7, whiteSpace: 'nowrap' }}>Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={e => onOpacityChange(Number(e.target.value) / 100)}
          style={{ flex: 1, accentColor: '#60a5fa' }}
        />
        <span style={{ fontSize: 9, opacity: 0.8, width: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(opacity * 100)}%
        </span>
      </div>
    </div>
  );
}
