/**
 * cfdColormaps.ts — single source of truth for colormap GLSL shared by
 * ScalarSurfacePrimitive and ArrowFieldPrimitive.
 *
 * Colors numerically match the CPU COLORMAPS in `shared.ts` so legends
 * and ramps stay 1:1 with the legend component.
 */

export type CfaColormapName =
  | 'viridis' | 'turbo' | 'inferno' | 'plasma' | 'spectral' | 'coolwarm';

const TABLES: Record<CfaColormapName, number[][]> = {
  viridis: [
    [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
  ],
  turbo: [
    [48, 18, 59], [66, 100, 203], [53, 176, 137], [128, 216, 62], [240, 178, 24], [122, 4, 3],
  ],
  inferno: [
    [0, 0, 4], [87, 16, 110], [178, 24, 43], [249, 127, 10], [252, 255, 164],
  ],
  plasma: [
    [13, 8, 135], [75, 3, 161], [175, 19, 102], [242, 104, 34], [240, 249, 33],
  ],
  spectral: [
    [94, 79, 162], [50, 136, 189], [96, 200, 181], [218, 224, 102], [246, 160, 42], [158, 1, 66],
  ],
  coolwarm: [[59, 76, 192], [220, 220, 220], [180, 4, 38]],
};

/** Evaluate a colormap CPU-side; returns [r,g,b] 0-255. */
export function colormapEvaluate(
  name: CfaColormapName,
  t: number,
): [number, number, number] {
  const tbl = TABLES[name] ?? TABLES.viridis;
  const ct = Math.max(0, Math.min(1, t));
  const step = 1 / (tbl.length - 1);
  const seg = Math.min(tbl.length - 2, Math.floor(ct / step));
  const lt = (ct - seg * step) / step;
  const a = tbl[seg];
  const b = tbl[seg + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * lt),
    Math.round(a[1] + (b[1] - a[1]) * lt),
    Math.round(a[2] + (b[2] - a[2]) * lt),
  ];
}

/**
 * Emit a GLSL function `vec3 kaggleCmap(float t)` where the named colormap
 * is inlined as a compile-time constant. Only one function — no forks.
 */
export function colormapGLSL(name: CfaColormapName): string {
  const tbl = TABLES[name] ?? TABLES.viridis;
  const f = (c: number) => (c / 255).toFixed(4);
  let body = '';
  for (let i = 0; i < tbl.length - 1; i++) {
    const [r0, g0, b0] = tbl[i];
    const [r1, g1, b1] = tbl[i + 1];
    const s0 = i / (tbl.length - 1);
    const s1 = (i + 1) / (tbl.length - 1);
    body += `  if (t < ${s1.toFixed(4)}) return mix(vec3(${f(r0)},${f(g0)},${f(b0)}),vec3(${f(r1)},${f(g1)},${f(b1)}),clamp((t-${s0.toFixed(4)})/${(s1 - s0).toFixed(4)},0.0,1.0));\n`;
  }
  const last = tbl[tbl.length - 1];
  body += `  return vec3(${f(last[0])},${f(last[1])},${f(last[2])});`;
  return `
vec3 kaggleCmap(float t) {
  t = clamp(t, 0.0, 1.0);
${body}}
`;
}
