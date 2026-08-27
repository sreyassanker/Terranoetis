// Generic analytical-tool PDF report generator — identical professional format
// for every one of the 150 tools. Layout/typography are fixed; only the content
// (result, series, secondary, steps) varies per tool.
//
// Usage: tsx scripts/generateToolReports.mjs [id]   (omit id → all 150)
//
// Format (consistent across all tools):
//   header band · "TERRANOETIS · ANALYTICAL MODEL REPORT" (8pt)
//   0.5 cm gap
//   Tool name (16pt bold) · (Tool N) (9pt) · Generated date+time (8pt)
//   RESULT panel (18pt value + 9pt unit)
//   OUTPUTS table (autoTable, 8pt head / 9pt body)
//   FIGURE 1 chart (rendered per vizType) · caption
//   DATA SOURCES (9pt) · INTERPRETATION (9pt) · RECOMMENDATIONS (9pt)
//   METHODOLOGY (Step lines bold, sub-lines normal, banner skipped)
//   closing · two-pass "Page X of N"
import { computeWithContext } from '../server/analytical-models/contextEngine.ts';
import { getToolConfig } from '../server/analytical-models/toolConfigs.ts';
import { PARTS } from '../src/data/analyticalModels.ts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { formatSciPdf, formatSciCompact } from '../src/lib/formatSci.ts';

const OUT_DIR = new URL('../reports/', import.meta.url).pathname;

// Build tool name lookup from the frontend model
const toolNames = {};
for (const part of PARTS) for (const d of part.domains) for (const t of d.tools) toolNames[t.id] = t.toolName || t.name;

// ── Palette / typography ladder ─────────────────────────────────────
const INK = [22, 27, 34], INK_SOFT = [71, 85, 105], INK_FAINT = [148, 163, 184];
const BRAND = [79, 70, 229], RULE = [203, 213, 225], TABLE_HEAD = [238, 240, 255];
const MARGIN = 56, PW = 595.28, PH = 841.89, CW = PW - MARGIN * 2, FOOTER_Y = PH - 40;
const F_H = 8, F_B = 9, F_T = 16, F_R = 18;
const CHART_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#F0E442', '#000000'];

/** Sanitize Unicode for WinAnsi (Helvetica): spell out Greek, map math symbols. */
function sanitize(t) {
  if (t == null) return '';
  const m = {
    'μ': 'mu', 'β': 'beta', 'α': 'alpha', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
    'θ': 'theta', 'λ': 'lambda', 'σ': 'sigma', 'τ': 'tau', 'ξ': 'xi', 'φ': 'phi',
    'ψ': 'psi', 'ω': 'omega', 'κ': 'kappa', 'ρ': 'rho', 'η': 'eta', 'ν': 'nu',
    'π': 'pi', 'ζ': 'zeta', 'ι': 'iota', 'χ': 'chi', 'υ': 'upsilon',
    'Δ': 'Delta', 'Σ': 'Sigma', 'Ω': 'Omega', 'Φ': 'Phi', 'Θ': 'Theta', 'Λ': 'Lambda',
    '−': '-', '–': '-', '—': '—', '×': 'x', '·': '\u00B7', '÷': '/',
    '½': '1/2', '¼': '1/4', '¾': '3/4', '²': '^2', '³': '^3',
    '→': ' -> ', '←': ' <- ', '≥': '>=', '≤': '<=', '±': '+/-', '≈': ' ~ ', '∞': 'inf',
    '√': 'sqrt', '∂': 'd', '∫': 'int', '∑': 'sum', '∏': 'prod',
    '─': '—', '└': '-', '├': '|', '│': '|', '═': '=', '║': '|', '┌': '-', '┐': '-', '┘': '-', '┗': '-',
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    'ₙ': 'n', 'ᵢ': 'i', 'ₘ': 'm', 'ₒ': 'o', 'ₓ': 'x', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't', 'ᵣ': 'r', 'ⱼ': 'j',
    '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9',
    '°': '°', '′': "'", '″': '"',
    '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'", '\u2013': '-', '\u00A0': ' ',
    '⊂': 'subset', '∅': 'empty', '∈': 'in', '∇': 'del',
  };
  let r = '';
  for (const ch of String(t)) {
    if (m[ch] !== undefined) { r += m[ch]; continue; }
    const cp = ch.codePointAt(0);
    if (cp > 127 && cp < 256) r += ch;
    else if (cp <= 127) r += ch;
  }
  return r.replace(/\s+/g, ' ').replace(/ - /g, '\u00A0-\u00A0').trim();
}
const stripHtml = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const fmtNum = (v) => { if (!Number.isFinite(v)) return 'NaN'; return formatSciPdf(v, 4); };
/** Date/time in dd/MM/yyyy, HH:mm format (e.g. 27/08/2026, 14:30). */
const fmtDate = (d = new Date()) => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}, ${hh}:${mi}`;
};

/** Build an SVG chart for the given series + vizType, render to PNG via headless Chrome. */
async function renderChartPNG(series, vizType) {
  if (!series || !series.length) return null;
  const pts = series[0].points;
  if (!pts || pts.length < 2) return null;
  const W = 720, H = 420, ml = 70, mr = 24, mt = 24, mb = 54, iw = W - ml - mr, ih = H - mt - mb;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  // Log10 Y axis for spectra whose positive range spans >3 decades (Planck
  // ~1e-198→1e+6 would otherwise flatten into a bottom line).
  const yPos = ys.filter(v => Number.isFinite(v) && v > 0);
  const logY = (vizType === 'spectrum' || vizType === 'distribution')
    && yPos.length > 0
    && Math.log10(Math.max(...yPos)) - Math.log10(Math.min(...yPos)) > 3;
  const yMinL = logY ? Math.log10(Math.min(...yPos)) : 0;
  const yMaxL = logY ? Math.log10(Math.max(...yPos)) : 0;
  const ymax = logY ? yMaxL + 0.2 : Math.max(...ys) * 1.1;
  const X = (x) => ml + ((x - xmin) / (xmax - xmin || 1)) * iw;
  const Y = (y) => {
    if (logY) { const l = y > 0 ? Math.log10(y) : yMinL - 1; return mt + ih - ((l - yMinL) / (ymax - yMinL || 1)) * ih; }
    return mt + ih - (y / (ymax || 1)) * ih;
  };
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(' ');
  const area = `M${X(pts[0].x).toFixed(2)},${(mt + ih).toFixed(2)} ` + pts.map(p => `L${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(' ') + ` Z`;
  const fill = vizType === 'spectrum' || vizType === 'distribution';
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const y = mt + ih * i / 5;
    const v = logY ? Math.pow(10, yMaxL - (yMaxL - yMinL) * i / 5) : ymax - ymax * i / 5;
    return `<line x1="${ml}" y1="${y}" x2="${ml+iw}" y2="${y}" stroke="#e2e8f0" stroke-width="0.8"/><text x="${ml-8}" y="${y+3}" font-size="12" fill="#475569" text-anchor="end">${Number.isFinite(v) && v > 0 ? v.toExponential(0) : '0'}</text>`;
  }).join('');
  const xTicks = Array.from({ length: 7 }, (_, i) => {
    const x = ml + iw * i / 6; const v = xmin + (xmax - xmin) * i / 6;
    return `<line x1="${x}" y1="${mt+ih}" x2="${x}" y2="${mt+ih+4}" stroke="#64748b" stroke-width="1"/><text x="${x}" y="${mt+ih+18}" font-size="12" fill="#475569" text-anchor="middle">${formatSciCompact(v)}</text>`;
  }).join('');
  const c0 = series[0].color || CHART_COLORS[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fff;font-family:Helvetica,Arial,sans-serif">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<line x1="${ml}" y1="${mt+ih}" x2="${ml+iw}" y2="${mt+ih}" stroke="#64748b" stroke-width="1.2"/>
<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt+ih}" stroke="#64748b" stroke-width="1.2"/>
${yTicks}
${xTicks}
<text x="${ml+iw/2}" y="${H-8}" font-size="13" fill="#334155" text-anchor="middle">${series[0].xLabel || 'x'}</text>
<text x="16" y="${mt+ih/2}" font-size="13" fill="#334155" text-anchor="middle" transform="rotate(-90 16 ${mt+ih/2})">${series[0].yLabel || 'f(x)'}</text>
<text x="${ml+iw/2}" y="18" font-size="14" fill="#334155" text-anchor="middle" font-weight="bold">${series[0].label || 'Series'}</text>
${fill ? `<path d="${area}" fill="${c0}" fill-opacity="0.18"/><path d="${path}" fill="none" stroke="${c0}" stroke-width="2.4" stroke-linecap="round"/>` : `<path d="${path}" fill="none" stroke="${c0}" stroke-width="2.4" stroke-linecap="round"/>`}
</svg>`;
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
    const el = await page.$('svg');
    if (!el) return null;
    return await el.screenshot({ type: 'png' });
  } finally { await browser.close(); }
}

/** Build the professional PDF for one tool result. */
export async function buildReportPdf(id, toolName, r) {
  const result = typeof r?.result === 'number' ? r.result : NaN;
  const unit = r?.unit ?? '';
  const series = r?.series ?? [];
  const secondary = r?.secondary ?? [];
  const dataSource = r?.dataSource ?? 'user-provided';
  const steps = r?.steps ?? [];
  const interp = r?.interpretation ?? {};
  const viz = getToolConfig(id).visualizationType;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = MARGIN;
  const ensure = (h) => { if (y + h > PH - MARGIN - 20) { doc.addPage(); y = MARGIN; } };
  const sectionTitle = (t) => {
    ensure(28); y += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(F_B); doc.setTextColor(...BRAND);
    doc.text(t.toUpperCase(), MARGIN, y); y += 4;
    doc.setDrawColor(...BRAND); doc.setLineWidth(1.1); doc.line(MARGIN, y, MARGIN + 34, y); y += 14;
  };
  const textBlock = (str, o = {}) => {
    const { size = F_B, style = 'normal', color = INK, lh = 1.5, gap = 0 } = o;
    const clean = sanitize(stripHtml(str));
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color);
    for (const line of doc.splitTextToSize(clean, CW)) { ensure(size * lh); doc.text(line, MARGIN, y); y += size * lh; }
    y += gap;
  };
  const rule = () => { doc.setDrawColor(...RULE); doc.setLineWidth(0.5); doc.line(MARGIN, y, PW - MARGIN, y); y += 10; };

  // ── Header ──
  doc.setFillColor(...BRAND); doc.rect(0, 0, PW, 4, 'F');
  y = MARGIN + 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(F_H); doc.setTextColor(...INK_FAINT);
  doc.text('TERRANOETIS · ANALYTICAL MODEL REPORT', MARGIN, y);
  y += 18 + 14.17; // 0.5 cm gap
  doc.setFont('helvetica', 'bold'); doc.setFontSize(F_T); doc.setTextColor(...INK);
  doc.text(sanitize(toolName), MARGIN, y); y += 18;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(F_B); doc.setTextColor(...INK_SOFT);
  doc.text(`(Tool ${id})`, MARGIN, y); y += 10;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(F_H); doc.setTextColor(...INK_FAINT);
  doc.text(`Generated ${fmtDate()}`, MARGIN, y); y += 8;
  rule(); y += 6;

  // ── Result panel ──
  sectionTitle('Result');
  ensure(46);
  doc.setFillColor(245, 247, 255); doc.setDrawColor(...RULE); doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN, y, CW, 46, 4, 4, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(F_R); doc.setTextColor(...INK);
  const rv = fmtNum(result);
  doc.text(rv, MARGIN + 16, y + 28);
  const rvW = doc.getTextWidth(rv);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(F_B); doc.setTextColor(...INK_SOFT);
  const unitLabel = unit && unit !== '—' ? sanitize(unit) : '(dimensionless)';
  doc.text(unitLabel, MARGIN + 16 + rvW + 12, y + 28);
  y += 56;

  // ── Outputs table ──
  if (secondary.length) {
    sectionTitle('Outputs');
    const fmtCell = (s) => {
      const num = fmtNum(s.value);
      const u = sanitize(s.unit ?? '');
      if (u && u !== '—') return `${num} ${u}`;
      if (/input units|in units/i.test(s.label)) return `${num} (input units)`;
      return `${num} (dimensionless)`;
    };
    autoTable(doc, {
      startY: y, margin: { left: MARGIN, right: MARGIN },
      head: [['OUTPUT', 'VALUE']],
      body: secondary.map(s => [sanitize(s.label), fmtCell(s)]),
      theme: 'plain',
      headStyles: { fillColor: TABLE_HEAD, textColor: INK_SOFT, fontStyle: 'bold', fontSize: F_H, cellPadding: { top: 4, bottom: 4, left: 10, right: 10 } },
      bodyStyles: { textColor: INK, fontSize: F_B, cellPadding: { top: 3, bottom: 3, left: 10, right: 10 } },
      columnStyles: { 0: { cellWidth: CW * 0.6 }, 1: { fontStyle: 'bold', cellWidth: CW * 0.4 } },
      didDrawPage: (d) => { y = d.cursor?.y != null ? d.cursor.y : y; },
    });
    y += 14;
  }

  // ── Chart (only for series-producing vizTypes; scalar/gauge → none) ──
  const chartViz = ['timeseries', 'profile', 'spectrum', 'distribution', 'scatter', 'bar', 'histogram'];
  if (chartViz.includes(viz) && series.length) {
    sectionTitle('Figure 1');
    const png = await renderChartPNG(series, viz);
    if (png) {
      const finalW = CW, finalH = Math.min((finalW * 420) / 720, 340);
      ensure(finalH + 20);
      doc.addImage(png, 'PNG', MARGIN, y, finalW, finalH);
      y += finalH + 6;
      doc.setFont('helvetica', 'italic'); doc.setFontSize(F_B); doc.setTextColor(...INK_FAINT);
      doc.text(sanitize(`Figure 1 — ${series[0].label}.`), MARGIN, y);
      y += 10;
    }
  }

  // ── Data sources ──
  if (dataSource) {
    sectionTitle('Data Sources');
    textBlock(stripHtml(dataSource), { size: F_B, color: INK_SOFT, lh: 1.45, gap: 2 });
  }

  // ── Interpretation ──
  const ctx = interp.contextualAnalysis;
  if (ctx) { sectionTitle('Interpretation'); textBlock(stripHtml(ctx), { size: F_B, color: INK, lh: 1.5, gap: 2 }); }

  // ── Recommendations ──
  const recs = interp.recommendations ?? [];
  if (recs.length) {
    sectionTitle('Recommendations');
    recs.forEach((rec, i) => {
      ensure(18);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(F_B); doc.setTextColor(...BRAND);
      doc.text(String(i + 1).padStart(2, '0'), MARGIN, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
      for (const l of doc.splitTextToSize(sanitize(stripHtml(rec)), CW - 30)) { ensure(13); doc.text(l, MARGIN + 28, y); y += 13; }
      y += 4;
    });
  }

  // ── Methodology ──
  if (steps.length) {
    sectionTitle('Methodology');
    for (const s of steps.slice(0, 24)) {
      const clean = sanitize(stripHtml(s));
      if (/^[—\-─═]{2,}/.test(clean) && !/^Step/i.test(clean)) continue; // skip banner
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
  return doc;
}

async function computeTool(id) {
  const ctx = {
    studyArea: { mode: 'point', point: [40.0, -95.0], bbox: [[39.5, -95.5], [40.5, -94.5]] },
    time: { granularity: 'instant', start: '2025-01-15', end: '2025-01-15' },
    filters: {},
  };
  try {
    const r = await Promise.race([
      computeWithContext(id, {}, ctx),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000)),
    ]);
    return r;
  } catch { return null; }
}

const idArg = process.argv[2] ? Number(process.argv[2]) : null;
const ids = idArg ? [idArg] : Array.from({ length: 150 }, (_, i) => i + 1);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log(`Generating reports for ${ids.length} tool(s) → ${OUT_DIR}`);
let ok = 0, fail = 0;
for (let bi = 0; bi < ids.length; bi += 3) {
  const batch = await Promise.all(ids.slice(bi, bi + 3).map(async (id) => {
    const r = await computeTool(id);
    return { id, r };
  }));
  for (const { id, r } of batch) {
    try {
      const doc = await buildReportPdf(id, toolNames[id] || `Tool ${id}`, r);
      const name = `tool-${id}-report.pdf`;
      doc.save(`${OUT_DIR}${name}`);
      const val = r && typeof r.result === 'number' ? (Number.isFinite(r.result) ? r.result.toFixed(4) : 'NaN') : 'none';
      console.log(`  ✓ tool ${String(id).padStart(3)} → ${name}  result=${val}`);
      ok++;
    } catch (e) {
      console.log(`  ✗ tool ${String(id).padStart(3)} → ERROR ${String(e).slice(0, 60)}`);
      fail++;
    }
  }
}
console.log(`\nDone: ${ok} OK, ${fail} FAIL → ${OUT_DIR}`);
