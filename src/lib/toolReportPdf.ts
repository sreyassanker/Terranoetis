/**
 * Analytical Tool Result PDF Report Generator
 * ── Professional format for the in-browser PDF download
 *
 * Q1-journal-grade report: clean cover header, structured result table,
 * crisp chart, heatmap figure, field statistics, data provenance,
 * contextual analysis, recommendations, and methodology — with strict
 * typography, pagination and two-pass "Page X of N" footers.
 *
 * Charts are rendered via SVG→canvas in the browser (no puppeteer needed).
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatSciCompact } from './formatSci';

// ── Palette (light, print-friendly) ────────────────────────────────
const INK = [22, 27, 34] as const;
const INK_SOFT = [71, 85, 105] as const;
const INK_FAINT = [148, 163, 184] as const;
const BRAND = [79, 70, 229] as const;
const RULE = [203, 213, 225] as const;
const TABLE_HEAD = [238, 240, 255] as const;
const F_H = 8, F_B = 9, F_T = 16, F_R = 18;
const CHART_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#F0E442', '#000000'];

const MARGIN = 56, PW = 595.28, PH = 841.89, CW = PW - MARGIN * 2, FOOTER_Y = PH - 40;

/** Sanitize Unicode for WinAnsi (Helvetica): spell out Greek, map math symbols. */
function sanitize(t: unknown): string {
  if (t == null) return '';
  const m: Record<string, string> = {
    'μ': 'mu', 'β': 'beta', 'α': 'alpha', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
    'θ': 'theta', 'λ': 'lambda', 'σ': 'sigma', 'τ': 'tau', 'ξ': 'xi', 'φ': 'phi',
    'ψ': 'psi', 'ω': 'omega', 'κ': 'kappa', 'ρ': 'rho', 'η': 'eta', 'ν': 'nu',
    'π': 'pi', 'ζ': 'zeta', 'ι': 'iota', 'χ': 'chi', 'υ': 'upsilon',
    'Δ': 'Delta', 'Σ': 'Sigma', 'Ω': 'Omega', 'Φ': 'Phi', 'Θ': 'Theta', 'Λ': 'Lambda',
    '−': '-', '–': '-', '—': '—', '×': 'x', '·': '\u00B7', '÷': '/',
    '½': '1/2', '¼': '1/4', '¾': '3/4',
    '→': ' -> ', '←': ' <- ', '≥': '>=', '≤': '<=', '±': '+/-', '≈': ' ~ ', '∞': 'inf',
    '√': 'sqrt', '∂': 'd', '∫': 'int', '∑': 'sum', '∏': 'prod',
    '─': '—', '└': '-', '├': '|', '│': '|', '═': '=', '║': '|', '┌': '-', '┐': '-', '┘': '-', '┗': '-',
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    'ₙ': 'n', 'ᵢ': 'i', 'ₘ': 'm', 'ₒ': 'o', 'ₓ': 'x', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't', 'ᵣ': 'r', 'ⱼ': 'j',
    '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9',
    '⁻': '-', '°': '°', '′': "'", '″': '"',
    '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'",
    '⊂': 'subset', '∅': 'empty', '∈': 'in', '∇': 'del',
  };
  let r = '';
  for (const ch of String(t)) {
    if (m[ch] !== undefined) { r += m[ch]; continue; }
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 127 && cp < 256) r += ch;
    else if (cp <= 127) r += ch;
  }
  return r.replace(/\s+/g, ' ').replace(/ - /g, '\u00A0-\u00A0').trim();
}
const fmtNum = (v: unknown): string => { const n = Number(v); return Number.isFinite(n) ? n.toPrecision(6) : 'NaN'; };

/** Date/time in dd/MM/yyyy, HH:mm format (e.g. 27/08/2026, 14:30). */
function fmtDate(d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}, ${hh}:${mi}`;
}

/** Render an SVG chart to a PNG data URL in the browser. Accepts the same
 *  SVG format as the batch-script renderChartPNG (no puppeteer needed). */
async function renderChartDataURL(svg: string): Promise<string | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 720; canvas.height = 420;
    const ctx = canvas.getContext('2d');
    if (!ctx) { resolve(null); return; }
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, 720, 420);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 720, 420);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  });
}

/**
 * Monotone-cubic (PCHIP/Fritsch–Carlson) interpolation — the same smoothing
 * recharts' `type="monotone"` (d3 curveMonotoneX) applies, so the PDF chart
 * matches the on-screen chart exactly instead of using straight line segments.
 * Returns a smooth path "M x0,y0 C c1x,c1y c2x,c2y x1,y1 ..." per segment.
 */
function monotonePath(pts: Array<{ x: number; y: number }>): string {
  const n = pts.length;
  if (n < 2) return '';
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  // Secant slopes
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    m[i] = dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx;
  }
  // Tangents (Fritsch–Carlson)
  const t: number[] = new Array(n).fill(0);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else {
      const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
      const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
      t[i] = (w1 + w2) === 0 ? 0 : (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  let d = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    const c1x = xs[i] + dx / 3;
    const c1y = ys[i] + (t[i] * dx) / 3;
    const c2x = xs[i + 1] - dx / 3;
    const c2y = ys[i + 1] - (t[i + 1] * dx) / 3;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
  }
  return d;
}

/** Build an SVG chart string for the given series + vizType (matches the
 *  batch script's SVG generator exactly, so the visual is identical). */
function buildChartSVG(
  series: Array<{ label: string; points: Array<{ x: number; y: number }>; color?: string; xLabel?: string; logX?: boolean }>,
  vizType: string,
  unit?: string,
  colorStops?: Array<{ stop: number; r: number; g: number; b: number }>,
): string {
  if (!series.length || !series.some(s => s.points.length)) return '';
  const xLabelFor = (v: string): string => {
    switch (v) {
      case 'profile': return 'Depth / Height';
      case 'spectrum': return 'Frequency / Wavelength';
      case 'distribution': return 'Value';
      case 'bar': return 'Category';
      case 'histogram': return 'Bin';
      case 'scatter': return 'X variable';
      default: return 'Time / Index';
    }
  };
  const yLabelFor = (v: string): string => {
    if (v === 'distribution') return unit ? `Density (${unit})` : 'Density';
    if (v === 'histogram') return 'Frequency / Count';
    if (v === 'spectrum') return unit ? `Spectral Density (${unit})` : 'Spectral Density';
    return unit ? `Value (${unit})` : 'Value';
  };
  const xLabel = series[0]?.xLabel ?? xLabelFor(vizType);
  const yLabel = yLabelFor(vizType);

  const continuous = ['timeseries', 'profile', 'spectrum', 'distribution'].includes(vizType);
  const isBars = vizType === 'bar' || vizType === 'histogram';
  const isScatter = vizType === 'scatter';

  const W = 720, H = 420, mr = 24, mt = 24, mb = 54, ih = H - mt - mb;
  // Union of all points across all series for the scale
  const allPoints = series.flatMap(s => s.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  if (allPoints.length === 0) return '';
  const xs = allPoints.map(p => p.x), ys = allPoints.map(p => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);

  // Auto log-Y for continuous charts when the positive range spans >3 decades
  // and no negative values exist (log scale is undefined for negatives).
  const yFin = ys.filter(Number.isFinite);
  const yPos = yFin.filter(v => v > 0);
  const hasNeg = yFin.some(v => v < 0);
  const logY = continuous && !hasNeg && yPos.length > 0 && Math.log10(Math.max(...yPos)) - Math.log10(Math.min(...yPos)) > 3;
  const yMinL = logY ? Math.log10(Math.min(...yPos)) : 0;
  const yMaxL = logY ? Math.log10(Math.max(...yPos)) : 0;
  const ymin = logY ? 0 : Math.min(0, ...yFin);
  const ymax = logY ? yMaxL + 0.2 : Math.max(0, ...yFin) * 1.1;

  // Log10 X axis when a series opts in (log-spaced x, e.g. the Thiem
  // radial-distance sweep). Requires strictly positive x values.
  const xPos = xs.filter(v => v > 0);
  const logX = continuous && series.some(s => s.logX) && xPos.length === xs.length;
  const xLogMin = logX ? Math.log10(Math.min(...xPos)) : 0;
  const xLogMax = logX ? Math.log10(Math.max(...xPos)) : 0;

  // The frontend uses a recharts category X axis (evenly spaced by data index)
  // for continuous charts and bars, unless logX is set. Match that for parity.
  const xCategory = !logX && !isScatter;
  const xVals = xCategory ? [...new Set(xs)].sort((a, b) => a - b) : null;

  // ── Y-tick labels measure ──
  // Build the Y-tick labels first so we can measure the widest one and set the
  // left margin to guarantee a 0.3 cm gap between the label and the Y-axis title.
  const yTickVals = Array.from({ length: 5 }, (_, i) =>
    logY ? Math.pow(10, yMaxL - (yMaxL - yMinL) * i / 5) : ymax - (ymax - ymin) * i / 5);
  const yTickLabels = yTickVals.map(v => {
    if (logY && !(Number.isFinite(v) && v > 0)) return '0';
    return formatSciCompact(v);
  });
  const estTextW = (s: string, px: number): number => {
    let w = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp >= 0x2070 && cp <= 0x209F) w += px * 0.34;  // super/subscript
      else if (cp === 0x00D7 || cp === 0x00B7) w += px * 0.5; // ⋅ ×
      else w += px * 0.58;
    }
    return w;
  };
  const maxYLabelW = Math.max(...yTickLabels.map(l => estTextW(l, 12)), 20);
  // 0.3 cm ≈ 13 px in the SVG (720 px → 483 pt PDF, 0.3 cm = 8.5 pt → 12.7 px).
  // The rotated Y-title (font-size 13) occupies ~13 px horizontally. The Y tick
  // labels are at ml 8 with text anchor end, so they fill [ml 8 maxYLabelW, ml 8].
  // GAP = 13 px between title-right (≈ titleX + 7) and label-left (ml 8 maxYLabelW).
  const GAP_Y = 13;
  const HALF_TITLE = 7;
  const ml = Math.max(70, Math.ceil(8 + maxYLabelW + GAP_Y + HALF_TITLE + 8));
  const iw = W - ml - mr;
  const titleY = ml - 8 - maxYLabelW - GAP_Y - HALF_TITLE;

  const X = (x: number) => {
    if (logX) {
      const l = x > 0 ? Math.log10(x) : xLogMin - 1;
      return ml + ((l - xLogMin) / (xLogMax - xLogMin || 1)) * iw;
    }
    if (xCategory && xVals) {
      const idx = xVals.indexOf(x);
      if (idx < 0) return ml + iw / 2;
      return ml + (idx / Math.max(1, xVals.length - 1)) * iw;
    }
    return ml + ((x - xmin) / (xmax - xmin || 1)) * iw;
  };
  const Y = (y: number): number => {
    if (logY) {
      const l = y > 0 ? Math.log10(y) : yMinL - 1;
      return mt + ih - ((l - yMinL) / (ymax - yMinL || 1)) * ih;
    }
    return mt + ih - ((y - ymin) / ((ymax - ymin) || 1)) * ih;
  };
  const yZero = logY ? mt + ih : Y(0);

  const yTicks = yTickVals.map((v, i) => {
    const y = mt + ih * i / 5;
    const label = yTickLabels[i];
    return `<line x1="${ml}" y1="${y}" x2="${ml + iw}" y2="${y}" stroke="#e2e8f0" stroke-width="0.8"/><text x="${ml - 8}" y="${y + 3}" font-size="12" fill="#475569" text-anchor="end">${label}</text>`;
  }).join('');
  const xTicks = xCategory && xVals ? (() => {
    const n = xVals.length;
    const step = Math.max(1, Math.floor(n / 6));
    const indices = Array.from({ length: Math.min(7, n) }, (_, i) => Math.min(n - 1, i * step));
    return [...new Set(indices)].map(idx => {
      const v = xVals[idx];
      const x = ml + (idx / Math.max(1, n - 1)) * iw;
      return `<line x1="${x}" y1="${mt + ih}" x2="${x}" y2="${mt + ih + 4}" stroke="#64748b" stroke-width="1"/><text x="${x}" y="${mt + ih + 18}" font-size="12" fill="#475569" text-anchor="middle">${formatSciCompact(v)}</text>`;
    }).join('');
  })() : Array.from({ length: 7 }, (_, i) => {
    const x = ml + iw * i / 6;
    const v = logX ? Math.pow(10, xLogMax - (xLogMax - xLogMin) * i / 6) : xmin + (xmax - xmin) * i / 6;
    return `<line x1="${x}" y1="${mt + ih}" x2="${x}" y2="${mt + ih + 4}" stroke="#64748b" stroke-width="1"/><text x="${x}" y="${mt + ih + 18}" font-size="12" fill="#475569" text-anchor="middle">${formatSciCompact(v)}</text>`;
  }).join('');

  // Per-series rendering
  let body = '';
  if (isScatter) {
    for (const s of series) {
      const c = s.color || CHART_COLORS[series.indexOf(s) % CHART_COLORS.length];
      for (const p of s.points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        body += `<circle cx="${X(p.x).toFixed(2)}" cy="${Y(p.y).toFixed(2)}" r="4" fill="${c}" stroke="#fff" stroke-width="1"/>`;
      }
    }
  } else if (isBars) {
    const n = series.length;
    const isHist = vizType === 'histogram';
    const xVals = [...new Set(allPoints.map(p => p.x))].sort((a, b) => a - b);
    const histMin = xVals.length > 0 ? Math.min(...xVals) : 0;
    const histMax = xVals.length > 0 ? Math.max(...xVals) : 1;
    for (let si = 0; si < n; si++) {
      const s = series[si];
      const c = s.color || CHART_COLORS[si % CHART_COLORS.length];
      for (const p of s.points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const bandW = iw / (xVals.length || 1);
        const barW = bandW / n * 0.8;
        const xPos = X(p.x) - bandW / 2 + si * (bandW / n);
        const top = Y(p.y);
        const barTop = Math.min(yZero, top);
        const barH = Math.abs(yZero - top);
        let fillC = c;
        if (isHist && colorStops && colorStops.length > 0 && n === 1) {
          const t = p.x > histMin ? (p.x - histMin) / (histMax - histMin) : 0;
          for (let st = 0; st < colorStops.length - 1; st++) {
            if (t >= colorStops[st].stop && t <= colorStops[st + 1].stop) {
              const seg = (colorStops[st + 1].stop - colorStops[st].stop) === 0 ? 0 : (t - colorStops[st].stop) / (colorStops[st + 1].stop - colorStops[st].stop);
              const r = Math.round(colorStops[st].r + (colorStops[st + 1].r - colorStops[st].r) * seg);
              const g = Math.round(colorStops[st].g + (colorStops[st + 1].g - colorStops[st].g) * seg);
              const b = Math.round(colorStops[st].b + (colorStops[st + 1].b - colorStops[st].b) * seg);
              fillC = `rgb(${r},${g},${b})`;
              break;
            }
          }
        }
        body += `<rect x="${xPos.toFixed(2)}" y="${barTop.toFixed(2)}" width="${Math.max(1, barW).toFixed(2)}" height="${Math.max(0, barH).toFixed(2)}" fill="${fillC}" rx="2"/>`;
      }
    }
  } else if (continuous) {
    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      const c = s.color || CHART_COLORS[si % CHART_COLORS.length];
      const pts = s.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length < 2) continue;
      const mapped = pts.map(p => ({ x: X(p.x), y: Y(p.y) }));
      const path = monotonePath(mapped);
      const fillBase = logY ? (mt + ih) : yZero;
      const area = `${path} L${mapped[mapped.length - 1].x.toFixed(2)},${fillBase.toFixed(2)} L${mapped[0].x.toFixed(2)},${fillBase.toFixed(2)} Z`;
      body += `<path d="${area}" fill="${c}" fill-opacity="0.25"/><path d="${path}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
  } else {
    const lastY = series[0].points[series[0].points.length - 1]?.y ?? 0;
    const c = series[0].color || CHART_COLORS[0];
    const xC = ml + iw / 2;
    const barW = iw * 0.3;
    const top = Y(lastY);
    const barTop = Math.min(yZero, top);
    const barH = Math.abs(yZero - top);
    body += `<rect x="${(xC - barW / 2).toFixed(2)}" y="${barTop.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(0, barH).toFixed(2)}" fill="${c}" rx="2"/>`;
  }

  const title = series.map(s => s.label).join(' / ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font-family:Helvetica,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<line x1="${ml}" y1="${mt + ih}" x2="${ml + iw}" y2="${mt + ih}" stroke="#64748b" stroke-width="1.2"/>
<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ih}" stroke="#64748b" stroke-width="1.2"/>
${yTicks}
${xTicks}
<text x="${ml + iw / 2}" y="${H - 8}" font-size="13" fill="#334155" text-anchor="middle">${xLabel}</text>
<text x="${titleY}" y="${mt + ih / 2}" font-size="13" fill="#334155" text-anchor="middle" transform="rotate(-90 ${titleY} ${mt + ih / 2})">${yLabel}</text>
<text x="${ml + iw / 2}" y="18" font-size="14" fill="#334155" text-anchor="middle" font-weight="bold">${title}</text>
${body}
</svg>`;
}

/** Build a histogram SVG from grid values. */
function buildHistogramSVG(finite: number[], valueMin: number, valueMax: number, stops: Array<{ stop: number; r: number; g: number; b: number }>): string {
  if (finite.length === 0 || valueMax <= valueMin) return '';
  const bins = 20;
  const span = valueMax - valueMin;
  const counts = new Array(bins).fill(0);
  for (const v of finite) {
    let b = Math.floor(((v - valueMin) / span) * bins);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const W = 720, H = 420, ml = 70, mr = 24, mt = 24, mb = 54, iw = W - ml - mr, ih = H - mt - mb;
  const maxCount = Math.max(...counts, 1);
  const binW = iw / bins;
  const bars = counts.map((c, i) => {
    const x = ml + i * binW + 1;
    const barW = Math.max(1, binW - 2);
    const barH = (c / maxCount) * ih;
    const y = mt + ih - barH;
    // Color this bin by its value position in the ramp
    const t = (i + 0.5) / bins;
    let r = 100, g = 100, b = 200;
    if (stops && stops.length > 0) {
      for (let s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s].stop && t <= stops[s + 1].stop) {
          const seg = (stops[s + 1].stop - stops[s].stop) === 0 ? 0 : (t - stops[s].stop) / (stops[s + 1].stop - stops[s].stop);
          r = Math.round(stops[s].r + (stops[s + 1].r - stops[s].r) * seg);
          g = Math.round(stops[s].g + (stops[s + 1].g - stops[s].g) * seg);
          b = Math.round(stops[s].b + (stops[s + 1].b - stops[s].b) * seg);
          break;
        }
      }
    }
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="rgb(${r},${g},${b})" rx="1"/>`;
  }).join('');
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const y = mt + ih * i / 5; const v = maxCount - maxCount * i / 5;
    return `<line x1="${ml}" y1="${y}" x2="${ml + iw}" y2="${y}" stroke="#e2e8f0" stroke-width="0.8"/><text x="${ml - 8}" y="${y + 3}" font-size="12" fill="#475569" text-anchor="end">${Math.round(v)}</text>`;
  }).join('');
  const xTicks = Array.from({ length: 7 }, (_, i) => {
    const x = ml + iw * i / 6; const v = valueMin + span * i / 6;
    return `<line x1="${x}" y1="${mt + ih}" x2="${x}" y2="${mt + ih + 4}" stroke="#64748b" stroke-width="1"/><text x="${x}" y="${mt + ih + 18}" font-size="12" fill="#475569" text-anchor="middle">${v.toPrecision(4)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font-family:Helvetica,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<line x1="${ml}" y1="${mt + ih}" x2="${ml + iw}" y2="${mt + ih}" stroke="#64748b" stroke-width="1.2"/>
<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ih}" stroke="#64748b" stroke-width="1.2"/>
${yTicks}
${xTicks}
<text x="${ml + iw / 2}" y="${H - 8}" font-size="13" fill="#334155" text-anchor="middle">Value</text>
<text x="16" y="${mt + ih / 2}" font-size="13" fill="#334155" text-anchor="middle" transform="rotate(-90 16 ${mt + ih / 2})">Count</text>
<text x="${ml + iw / 2}" y="18" font-size="14" fill="#334155" text-anchor="middle" font-weight="bold">Value Distribution &#183; ${finite.length} cells</text>
${bars}
</svg>`;
}

export interface PdfReportInput {
  toolName: string;
  toolId: number;
  resultText: string;
  resultUnit?: string;
  secondary?: Array<{ label: string; value: string }>;
  dataSource?: string;
  contextualAnalysis?: string;
  recommendations?: string[];
  steps?: string[];
  /** Tool-series data for the series chart (timeseries, profile, etc.) */
  series?: Array<{ label: string; points: Array<{ x: number; y: number }>; color?: string }>;
  seriesVizType?: string;
  /** Grid field for heatmap figure + histogram + field statistics */
  grid?: {
    valueMin: number; valueMax: number;
    valueMean: number; valueStd: number; valueMedian: number;
    finiteCellCount: number; nLat: number; nLon: number;
  };
  /** Color stops for the heatmap gradient (matches the globe's active scheme). */
  colorStops?: Array<{ stop: number; r: number; g: number; b: number }>;
  /** Finite grid values (for histogram). */
  gridValues?: number[];
}

export async function exportToolResultAsPDF(report: PdfReportInput): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  // Load DejaVuSans (Unicode font) so the PDF body can render real math symbols
  // (×, μ, ², ³, Greek letters, superscripts, subscripts, etc.) instead of
  // stripping them to ASCII approximations. Falls back to Helvetica + sanitize
  // when the font fetch fails (offline / slow network).
  let hasUnicode = false;
  try {
    const [reg, bold] = await Promise.all([
      (await fetch('/fonts/DejaVuSans.ttf')).arrayBuffer(),
      (await fetch('/fonts/DejaVuSans-Bold.ttf')).arrayBuffer(),
    ]);
    const toB64 = (buf: ArrayBuffer) => {
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    };
    doc.addFileToVFS('DejaVu.ttf', toB64(reg));
    doc.addFileToVFS('DejaVu-Bold.ttf', toB64(bold));
    doc.addFont('DejaVu.ttf', 'DejaVu', 'normal');
    doc.addFont('DejaVu-Bold.ttf', 'DejaVu', 'bold');
    hasUnicode = true;
  } catch { /* font unavailable — fall through to Helvetica + sanitize */ }

  const getFont = (style: 'normal' | 'bold' | 'italic' | 'bolditalic' = 'normal'): [string, 'normal' | 'bold' | 'italic' | 'bolditalic'] => {
    if (hasUnicode) return ['DejaVu', style === 'bold' ? 'bold' : 'normal'];
    return ['helvetica', style];
  };
  const clean = (s: unknown): string => {
    const t = String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (hasUnicode) return t;
    return sanitize(t);
  };
  let y = MARGIN;
  const ensure = (h: number) => { if (y + h > PH - MARGIN - 20) { doc.addPage(); y = MARGIN; } };
  const sectionTitle = (t: string) => {
    ensure(28); y += 8;
    doc.setFont(...getFont('bold')); doc.setFontSize(F_B); doc.setTextColor(...BRAND);
    doc.text(t.toUpperCase(), MARGIN, y); y += 4;
    doc.setDrawColor(...BRAND); doc.setLineWidth(1.1); doc.line(MARGIN, y, MARGIN + 34, y); y += 14;
  };
  const textBlock = (str: string, opts: { size?: number; style?: 'normal' | 'bold' | 'italic'; color?: readonly [number, number, number]; lh?: number; gap?: number } = {}) => {
    const { size = F_B, style = 'normal', color = INK, lh = 1.5, gap = 0 } = opts;
    const cleanText = clean(str);
    doc.setFont(...getFont(style)); doc.setFontSize(size); doc.setTextColor(...color);
    for (const line of doc.splitTextToSize(cleanText, CW)) { ensure(size * lh); doc.text(line, MARGIN, y); y += size * lh; }
    y += gap;
  };
  const rule = () => { doc.setDrawColor(...RULE); doc.setLineWidth(0.5); doc.line(MARGIN, y, PW - MARGIN, y); y += 10; };

  const colorStops = report.colorStops ?? [
    { stop: 0, r: 20, g: 40, b: 180 },
    { stop: 0.5, r: 50, g: 200, b: 100 },
    { stop: 1, r: 200, g: 30, b: 30 },
  ];

  // Build chart images (SVG → canvas → dataURL) — we do this early so async
  // completion doesn't break the sequential PDF layout.
  const chartImg = report.series?.length ? await renderChartDataURL(buildChartSVG(report.series, report.seriesVizType ?? 'timeseries', report.resultUnit, colorStops)) : null;
  const histImg = report.grid && report.gridValues?.length
    ? await renderChartDataURL(buildHistogramSVG(report.gridValues, report.grid.valueMin, report.grid.valueMax, colorStops))
    : null;

  // ── Header ──
  doc.setFillColor(...BRAND); doc.rect(0, 0, PW, 4, 'F');
  y = MARGIN + 4;
  doc.setFont(...getFont('bold')); doc.setFontSize(F_H); doc.setTextColor(...INK_FAINT);
  doc.text('TERRANOETIS · ANALYTICAL MODEL REPORT', MARGIN, y);
  y += 18 + 14.17; // 0.5 cm gap
  doc.setFont(...getFont('bold')); doc.setFontSize(F_T); doc.setTextColor(...INK);
  const nameLines = doc.splitTextToSize(clean(report.toolName), CW);
  for (const l of nameLines) { ensure(20); doc.text(l, MARGIN, y); y += 20; }
  y -= 2;
  doc.setFont(...getFont()); doc.setFontSize(F_B); doc.setTextColor(...INK_SOFT);
  doc.text(`(Tool ${report.toolId})`, MARGIN, y); y += 10;
  doc.setFont(...getFont()); doc.setFontSize(F_H); doc.setTextColor(...INK_FAINT);
  doc.text(`Generated ${fmtDate()}`, MARGIN, y); y += 8;
  rule(); y += 6;

  // ── Result panel ──
  sectionTitle('Result');
  ensure(46);
  doc.setFillColor(245, 247, 255); doc.setDrawColor(...RULE); doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN, y, CW, 46, 4, 4, 'FD');
  doc.setFont(...getFont('bold')); doc.setFontSize(F_R); doc.setTextColor(...INK);
  const rv = clean(report.resultText);
  const rvLines = doc.splitTextToSize(rv, CW - 32);
  doc.text(rvLines[0], MARGIN + 16, y + 28);
  const rvW = doc.getTextWidth(rvLines[0]);
  doc.setFont(...getFont()); doc.setFontSize(F_B); doc.setTextColor(...INK_SOFT);
  const unitLabel = report.resultUnit && report.resultUnit !== '—' ? clean(report.resultUnit) : '(dimensionless)';
  doc.text(unitLabel, MARGIN + 16 + rvW + 12, y + 28);
  y += 56;

  // ── Outputs table ──
  if (report.secondary && report.secondary.length > 0) {
    sectionTitle('Outputs');
    autoTable(doc, {
      startY: y, margin: { left: MARGIN, right: MARGIN },
      head: [['OUTPUT', 'VALUE']],
      body: report.secondary.map(s => [clean(s.label), s.value]),
      theme: 'plain',
      headStyles: { fillColor: TABLE_HEAD as unknown as [number, number, number], textColor: INK_SOFT as unknown as [number, number, number], fontStyle: 'bold', fontSize: F_H, cellPadding: { top: 4, bottom: 4, left: 10, right: 10 } },
      bodyStyles: { textColor: INK as unknown as [number, number, number], fontSize: F_B, cellPadding: { top: 3, bottom: 3, left: 10, right: 10 } },
      columnStyles: { 0: { cellWidth: CW * 0.6 }, 1: { fontStyle: 'bold', cellWidth: CW * 0.4 } },
      didDrawPage: (data) => { y = data.cursor?.y != null ? data.cursor.y : y; },
    });
    y += 14;
  }

  // ── Series chart (timeseries, profile, spectrum, distribution, scatter, bar) ──
  if (chartImg) {
    sectionTitle('Figure 1');
    const finalW = CW, finalH = Math.min((finalW * 420) / 720, 340);
    ensure(finalH + 20);
    doc.addImage(chartImg, 'PNG', MARGIN, y, finalW, finalH);
    y += finalH + 6;
    doc.setFont(...getFont('italic')); doc.setFontSize(F_B); doc.setTextColor(...INK_FAINT);
    doc.text(clean(`Figure 1 — ${report.series?.map(s => s.label).join(' / ') ?? 'Series'}.`), MARGIN, y);
    y += 10;
  }

  // ── Field Statistics + Heatmap + Histogram (for spatial/heatmap tools) ──
  if (report.grid) {
    const g = report.grid;
    // Figure numbering across the whole report: series chart already used #1.
    let figNum = chartImg ? 2 : 1;

    sectionTitle('Field Statistics');
    autoTable(doc, {
      startY: y, margin: { left: MARGIN, right: MARGIN },
      head: [['STATISTIC', 'VALUE']],
      body: [
        ['Mean', fmtNum(g.valueMean)],
        ['Standard Deviation', fmtNum(g.valueStd)],
        ['Median', fmtNum(g.valueMedian)],
        ['Min', fmtNum(g.valueMin)],
        ['Max', fmtNum(g.valueMax)],
        ['Cells', `${g.finiteCellCount} / ${g.nLat * g.nLon}`],
      ],
      theme: 'plain',
      headStyles: { fillColor: TABLE_HEAD as unknown as [number, number, number], textColor: INK_SOFT as unknown as [number, number, number], fontStyle: 'bold', fontSize: F_H, cellPadding: { top: 4, bottom: 4, left: 10, right: 10 } },
      bodyStyles: { textColor: INK as unknown as [number, number, number], fontSize: F_B, cellPadding: { top: 3, bottom: 3, left: 10, right: 10 } },
      columnStyles: { 0: { cellWidth: CW * 0.6 }, 1: { fontStyle: 'bold', cellWidth: CW * 0.4 } },
      didDrawPage: (data) => { y = data.cursor?.y != null ? data.cursor.y : y; },
    });
    y += 14;

    // Histogram figure
    if (histImg) {
      sectionTitle(`Figure ${figNum}`);
      const finalW = CW, finalH = Math.min((finalW * 420) / 720, 320);
      ensure(finalH + 20);
      doc.addImage(histImg, 'PNG', MARGIN, y, finalW, finalH);
      y += finalH + 6;
      doc.setFont(...getFont('italic')); doc.setFontSize(F_B); doc.setTextColor(...INK_FAINT);
      doc.text(clean(`Figure ${figNum} — Value distribution across the study area (${g.finiteCellCount} valid cells).`), MARGIN, y);
      y += 10;
      figNum++;
    }
  }

  // ── Data sources ──
  if (report.dataSource) {
    sectionTitle('Data Sources');
    textBlock(report.dataSource, { size: F_B, color: INK_SOFT, lh: 1.45, gap: 2 });
  }

  // ── Interpretation ──
  if (report.contextualAnalysis) {
    sectionTitle('Interpretation');
    textBlock(report.contextualAnalysis, { size: F_B, color: INK, lh: 1.5, gap: 2 });
  }

  // ── Recommendations ──
  if (report.recommendations && report.recommendations.length > 0) {
    sectionTitle('Recommendations');
    report.recommendations.forEach((rec, i) => {
      ensure(18);
      doc.setFont(...getFont('bold')); doc.setFontSize(F_B); doc.setTextColor(...BRAND);
      doc.text(String(i + 1).padStart(2, '0'), MARGIN, y);
      doc.setFont(...getFont()); doc.setTextColor(...INK);
      for (const l of doc.splitTextToSize(clean(rec), CW - 30)) { ensure(13); doc.text(l, MARGIN + 28, y); y += 13; }
      y += 4;
    });
  }

  // ── Methodology ──
  if (report.steps && report.steps.length > 0) {
    sectionTitle('Methodology');
    for (const s of report.steps.slice(0, 24)) {
      const cleanText = clean(s);
      if (/^[—\-─═]{2,}/.test(cleanText) && !/^Step/i.test(cleanText)) continue;
      const isStepHeader = /^Step\s+\d+/i.test(cleanText);
      textBlock(cleanText, { size: F_B, style: isStepHeader ? 'bold' : 'normal', color: isStepHeader ? INK : INK_SOFT, lh: 1.35, gap: 1 });
    }
  }

  // ── Closing + two-pass page numbers ──
  y += 10; ensure(22);
  doc.setFont(...getFont('italic')); doc.setFontSize(F_H); doc.setTextColor(...INK_FAINT);
  doc.text('— End of report · Generated by Terranoetis —', MARGIN, y);
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...RULE); doc.setLineWidth(0.5); doc.line(MARGIN, FOOTER_Y, PW - MARGIN, FOOTER_Y);
    doc.setFont(...getFont()); doc.setFontSize(7); doc.setTextColor(...INK_FAINT);
    doc.text('Terranoetis — Analytical Model Report', MARGIN, FOOTER_Y + 12);
    doc.text(`Page ${p} of ${total}`, PW - MARGIN, FOOTER_Y + 12, { align: 'right' });
  }
  doc.save(`tool-${report.toolId}-${report.toolName.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.pdf`);
}