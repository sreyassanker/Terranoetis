/**
 * Analytical Tool Result PDF Report Generator
 * ── Professional format matching the batch script (generateToolReports.mjs)
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
    '°': '°', '′': "'", '″': '"',
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
const stripHtml = (s: unknown): string => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
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

/** Build an SVG chart string for the given series + vizType (matches the
 *  batch script's SVG generator exactly, so the visual is identical). */
function buildChartSVG(
  series: Array<{ label: string; points: Array<{ x: number; y: number }>; color?: string }>,
  vizType: string,
): string {
  if (!series.length || !series[0].points.length) return '';
  const pts = series[0].points;
  const W = 720, H = 420, ml = 70, mr = 24, mt = 24, mb = 54, iw = W - ml - mr, ih = H - mt - mb;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymax = Math.max(...ys) * 1.1;
  const X = (x: number) => ml + ((x - xmin) / (xmax - xmin || 1)) * iw;
  const Y = (y: number) => mt + ih - (y / (ymax || 1)) * ih;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(' ');
  const area = `M${X(pts[0].x).toFixed(2)},${(mt + ih).toFixed(2)} ` + pts.map(p => `L${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(' ') + ` Z`;
  const isFill = vizType === 'spectrum' || vizType === 'distribution';
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const y = mt + ih * i / 5; const v = ymax - ymax * i / 5;
    return `<line x1="${ml}" y1="${y}" x2="${ml + iw}" y2="${y}" stroke="#e2e8f0" stroke-width="0.8"/><text x="${ml - 8}" y="${y + 3}" font-size="12" fill="#475569" text-anchor="end">${Number.isFinite(v) ? v.toFixed(3) : '0'}</text>`;
  }).join('');
  const xTicks = Array.from({ length: 7 }, (_, i) => {
    const x = ml + iw * i / 6; const v = xmin + (xmax - xmin) * i / 6;
    return `<line x1="${x}" y1="${mt + ih}" x2="${x}" y2="${mt + ih + 4}" stroke="#64748b" stroke-width="1"/><text x="${x}" y="${mt + ih + 18}" font-size="12" fill="#475569" text-anchor="middle">${v.toPrecision(4)}</text>`;
  }).join('');
  const c0 = series[0].color || CHART_COLORS[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font-family:Helvetica,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<line x1="${ml}" y1="${mt + ih}" x2="${ml + iw}" y2="${mt + ih}" stroke="#64748b" stroke-width="1.2"/>
<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ih}" stroke="#64748b" stroke-width="1.2"/>
${yTicks}
${xTicks}
<text x="${ml + iw / 2}" y="${H - 8}" font-size="13" fill="#334155" text-anchor="middle">${sanitize(series[0].label)}</text>
<text x="16" y="${mt + ih / 2}" font-size="13" fill="#334155" text-anchor="middle" transform="rotate(-90 16 ${mt + ih / 2})">Value</text>
<text x="${ml + iw / 2}" y="18" font-size="14" fill="#334155" text-anchor="middle" font-weight="bold">${sanitize(series[0].label)}</text>
${isFill ? `<path d="${area}" fill="${c0}" fill-opacity="0.18"/><path d="${path}" fill="none" stroke="${c0}" stroke-width="2.4" stroke-linecap="round"/>` : `<path d="${path}" fill="none" stroke="${c0}" stroke-width="2.4" stroke-linecap="round"/>`}
</svg>`;
}

/** Build a heatmap legend bar as a small SVG (vertical gradient, max/mid/min). */
function buildHeatmapLegendSVG(valueMin: number, valueMax: number, stops: Array<{ stop: number; r: number; g: number; b: number }>): string {
  if (!stops || stops.length === 0) stops = [{ stop: 0, r: 20, g: 40, b: 180 }, { stop: 0.5, r: 50, g: 200, b: 100 }, { stop: 1, r: 200, g: 30, b: 30 }];
  const barW = 20, barH = 120, gap = 8;
  const gradId = 'hgrad';
  const gradStops = stops.map(s => `<stop offset="${Math.round(s.stop * 100)}%" stop-color="rgb(${s.r},${s.g},${s.b})"/>`).join('');
  const mid = (valueMin + valueMax) / 2;
  const fmt = (v: number) => Number.isFinite(v) ? v.toPrecision(4) : '—';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="${barH + 20}" viewBox="0 0 120 ${barH + 20}" style="background:#fff;font-family:Helvetica,Arial,sans-serif">
<defs><linearGradient id="${gradId}" x1="0" y1="1" x2="0" y2="0"><${gradStops}></linearGradient></defs>
<rect x="0" y="0" width="${barW}" height="${barH}" rx="3" fill="url(#${gradId})" stroke="#cbd5e1" stroke-width="0.8"/>
<text x="${barW + gap}" y="8" font-size="10" fill="#475569" text-anchor="start">${fmt(valueMax)}</text>
<text x="${barW + gap}" y="${barH / 2 + 3}" font-size="10" fill="#475569" text-anchor="start">${fmt(mid)}</text>
<text x="${barW + gap}" y="${barH}" font-size="10" fill="#475569" text-anchor="start">${fmt(valueMin)}</text>
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
<text x="${ml + iw / 2}" y="18" font-size="14" fill="#334155" text-anchor="middle" font-weight="bold">Value Distribution &middot; ${finite.length} cells</text>
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
  let y = MARGIN;
  const ensure = (h: number) => { if (y + h > PH - MARGIN - 20) { doc.addPage(); y = MARGIN; } };
  const sectionTitle = (t: string) => {
    ensure(28); y += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F_B); doc.setTextColor(...BRAND);
    doc.text(t.toUpperCase(), MARGIN, y); y += 4;
    doc.setDrawColor(...BRAND); doc.setLineWidth(1.1); doc.line(MARGIN, y, MARGIN + 34, y); y += 14;
  };
  const textBlock = (str: string, opts: { size?: number; style?: 'normal' | 'bold' | 'italic'; color?: readonly [number, number, number]; lh?: number; gap?: number } = {}) => {
    const { size = F_B, style = 'normal', color = INK, lh = 1.5, gap = 0 } = opts;
    const clean = sanitize(stripHtml(str));
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color);
    for (const line of doc.splitTextToSize(clean, CW)) { ensure(size * lh); doc.text(line, MARGIN, y); y += size * lh; }
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
  const chartImg = report.series?.length ? await renderChartDataURL(buildChartSVG(report.series, report.seriesVizType ?? 'timeseries')) : null;
  const histImg = report.grid && report.gridValues?.length
    ? await renderChartDataURL(buildHistogramSVG(report.gridValues, report.grid.valueMin, report.grid.valueMax, colorStops))
    : null;
  const legendImg = report.grid
    ? await renderChartDataURL(buildHeatmapLegendSVG(report.grid.valueMin, report.grid.valueMax, colorStops))
    : null;

  // ── Header ──
  doc.setFillColor(...BRAND); doc.rect(0, 0, PW, 4, 'F');
  y = MARGIN + 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(F_H); doc.setTextColor(...INK_FAINT);
  doc.text('TERRANOETIS · ANALYTICAL MODEL REPORT', MARGIN, y);
  y += 18 + 14.17; // 0.5 cm gap
  doc.setFont('helvetica', 'bold'); doc.setFontSize(F_T); doc.setTextColor(...INK);
  doc.text(sanitize(report.toolName), MARGIN, y); y += 18;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(F_B); doc.setTextColor(...INK_SOFT);
  doc.text(`(Tool ${report.toolId})`, MARGIN, y); y += 10;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(F_H); doc.setTextColor(...INK_FAINT);
  doc.text(`Generated ${fmtDate()}`, MARGIN, y); y += 8;
  rule(); y += 6;

  // ── Result panel ──
  sectionTitle('Result');
  ensure(46);
  doc.setFillColor(245, 247, 255); doc.setDrawColor(...RULE); doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN, y, CW, 46, 4, 4, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(F_R); doc.setTextColor(...INK);
  const rv = report.resultText;
  doc.text(rv, MARGIN + 16, y + 28);
  const rvW = doc.getTextWidth(rv);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(F_B); doc.setTextColor(...INK_SOFT);
  const unitLabel = report.resultUnit && report.resultUnit !== '—' ? sanitize(report.resultUnit) : '(dimensionless)';
  doc.text(unitLabel, MARGIN + 16 + rvW + 12, y + 28);
  y += 56;

  // ── Outputs table ──
  if (report.secondary && report.secondary.length > 0) {
    sectionTitle('Outputs');
    autoTable(doc, {
      startY: y, margin: { left: MARGIN, right: MARGIN },
      head: [['OUTPUT', 'VALUE']],
      body: report.secondary.map(s => [sanitize(s.label), s.value]),
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
    doc.setFont('helvetica', 'italic'); doc.setFontSize(F_B); doc.setTextColor(...INK_FAINT);
    doc.text(sanitize(`Figure 1 — ${report.series?.[0]?.label ?? 'Series'}.`), MARGIN, y);
    y += 10;
  }

  // ── Field Statistics + Histogram (for spatial/heatmap tools) ──
  if (report.grid) {
    sectionTitle('Field Statistics');
    const g = report.grid;
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
      sectionTitle('Figure 2');
      const finalW = CW, finalH = Math.min((finalW * 420) / 720, 320);
      ensure(finalH + 20);
      doc.addImage(histImg, 'PNG', MARGIN, y, finalW, finalH);
      y += finalH + 6;
      doc.setFont('helvetica', 'italic'); doc.setFontSize(F_B); doc.setTextColor(...INK_FAINT);
      doc.text(`Figure 2 — Value distribution across the study area (${g.finiteCellCount} valid cells).`, MARGIN, y);
      y += 10;
    }

    // Heatmap legend bar
    if (legendImg) {
      const lw = 120, lh = 140;
      ensure(lh + 20);
      doc.addImage(legendImg, 'PNG', MARGIN, y, lw, lh);
      y += lh + 6;
      doc.setFont('helvetica', 'italic'); doc.setFontSize(F_B); doc.setTextColor(...INK_FAINT);
      doc.text('Field colour scale — low to high (legend).', MARGIN, y);
      y += 10;
    }
  }

  // ── Data sources ──
  if (report.dataSource) {
    sectionTitle('Data Sources');
    textBlock(stripHtml(report.dataSource), { size: F_B, color: INK_SOFT, lh: 1.45, gap: 2 });
  }

  // ── Interpretation ──
  if (report.contextualAnalysis) {
    sectionTitle('Interpretation');
    textBlock(stripHtml(report.contextualAnalysis), { size: F_B, color: INK, lh: 1.5, gap: 2 });
  }

  // ── Recommendations ──
  if (report.recommendations && report.recommendations.length > 0) {
    sectionTitle('Recommendations');
    report.recommendations.forEach((rec, i) => {
      ensure(18);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(F_B); doc.setTextColor(...BRAND);
      doc.text(String(i + 1).padStart(2, '0'), MARGIN, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
      for (const l of doc.splitTextToSize(sanitize(stripHtml(rec)), CW - 30)) { ensure(13); doc.text(l, MARGIN + 28, y); y += 13; }
      y += 4;
    });
  }

  // ── Methodology ──
  if (report.steps && report.steps.length > 0) {
    sectionTitle('Methodology');
    for (const s of report.steps.slice(0, 24)) {
      const clean = sanitize(stripHtml(s));
      if (/^[—\-─═]{2,}/.test(clean) && !/^Step/i.test(clean)) continue;
      const isStepHeader = /^Step\s+\d+/i.test(clean);
      textBlock(clean, { size: F_B, style: isStepHeader ? 'bold' : 'normal', color: isStepHeader ? INK : INK_SOFT, lh: 1.35, gap: 1 });
    }
  }

  // ── Closing + two-pass page numbers ──
  y += 10; ensure(22);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(F_H); doc.setTextColor(...INK_FAINT);
  doc.text('— End of report · Generated by Terranoetis —', MARGIN, y);
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...RULE); doc.setLineWidth(0.5); doc.line(MARGIN, FOOTER_Y, PW - MARGIN, FOOTER_Y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...INK_FAINT);
    doc.text('Terranoetis — Analytical Model Report', MARGIN, FOOTER_Y + 12);
    doc.text(`Page ${p} of ${total}`, PW - MARGIN, FOOTER_Y + 12, { align: 'right' });
  }
  doc.save(`tool-${report.toolId}-${report.toolName.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.pdf`);
}