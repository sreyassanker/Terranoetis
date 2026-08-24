/**
 * Analytical Tool Result PDF Report Generator
 * ───────────────────────────────────────────
 * Q1-journal-grade report export: clean cover header, structured result
 * table, crisp embedded chart, data provenance, contextual analysis and
 * recommendations — with strict typography, pagination and spacing rules.
 */
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

// ── Palette (light, print-friendly) ────────────────────────────────
const INK = [22, 27, 34] as const;            // near-black body text
const INK_SOFT = [71, 85, 105] as const;      // secondary text
const INK_FAINT = [148, 163, 184] as const;   // hairline / captions
const BRAND = [79, 70, 229] as const;         // indigo accent
const RULE = [203, 213, 225] as const;        // light divider
const TABLE_HEAD = [238, 240, 255] as const;  // table header fill

const MARGIN = 56;
const PW = 595.28;                   // A4 width (pt)
const PH = 841.89;                   // A4 height (pt)
const CW = PW - MARGIN * 2;          // content width
const FOOTER_Y = PH - 40;

interface ResultReport {
  toolName: string;
  toolId: number;
  resultText: string;
  resultUnit?: string;
  secondary?: Array<{ label: string; value: string }>;
  dataSource?: string;
  contextualAnalysis?: string;
  recommendations?: string[];
  steps?: string[];
  chartEl?: HTMLElement | null;
}

function stripHtml(s: string): string {
  return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export async function exportToolResultAsPDF(report: ResultReport): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = MARGIN;
  let page = 1;

  // ── Page management ──────────────────────────────────────────────
  const ensure = (h: number) => { if (y + h > PH - MARGIN - 20) newPage(); };

  const newPage = () => {
    footer();
    doc.addPage();
    page++;
    y = MARGIN;
  };

  const footer = () => {
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, FOOTER_Y, PW - MARGIN, FOOTER_Y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...INK_FAINT);
    doc.text('Terranoetis — Analytical Model Report', MARGIN, FOOTER_Y + 12);
    doc.text(`Page ${page} of 1`, PW - MARGIN, FOOTER_Y + 12, { align: 'right' });
  };

  const textBlock = (str: string, opts: { size?: number; style?: 'normal' | 'bold' | 'italic'; color?: readonly [number, number, number]; lh?: number; gap?: number; align?: 'left' | 'center' | 'right'; indent?: number } = {}) => {
    const { size = 9.5, style = 'normal', color = INK, lh = 1.5, gap = 0, align = 'left', indent = 0 } = opts;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const w = CW - indent;
    const lines = doc.splitTextToSize(str, w);
    for (const line of lines) {
      ensure(size * lh);
      const x = align === 'center' ? PW / 2 : align === 'right' ? PW - MARGIN - indent : MARGIN + indent;
      doc.text(line, x, y, { align });
      y += size * lh;
    }
    y += gap;
  };

  const sectionTitle = (t: string) => {
    ensure(28);
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...BRAND);
    doc.text(t.toUpperCase(), MARGIN, y);
    y += 4;
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(1.1);
    doc.line(MARGIN, y, MARGIN + 34, y);
    y += 14;
  };

  const rule = () => {
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, PW - MARGIN, y);
    y += 10;
  };

  // ── Cover header ─────────────────────────────────────────────────
  // Brand band across the very top
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, PW, 4, 'F');

  y = MARGIN + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...INK_FAINT);
  doc.text('TERRANOETIS · ANALYTICAL MODEL REPORT', MARGIN, y);
  y += 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(`Tool #${report.toolId}`, MARGIN, y);
  y += 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  const titleLines = doc.splitTextToSize(report.toolName, CW);
  for (const l of titleLines) { ensure(18); doc.text(l, MARGIN, y); y += 18; }
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...INK_FAINT);
  doc.text(`Generated ${new Date().toLocaleString()} · A4 · Prepared by Terranoetis`, MARGIN, y);
  y += 8;
  rule();
  y += 6;

  // ── Result panel ─────────────────────────────────────────────────
  sectionTitle('Result');
  // Result value + unit in a light panel
  const panelH = 46;
  ensure(panelH);
  doc.setFillColor(245, 247, 255);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN, y, CW, panelH, 4, 4, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  const rv = report.resultText;
  doc.text(rv, MARGIN + 16, y + 28);
  if (report.resultUnit) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK_SOFT);
    doc.text(report.resultUnit, MARGIN + 16 + doc.getTextWidth(rv) + 10, y + 28);
  }
  y += panelH + 10;

  // ── Secondary outputs as a table ─────────────────────────────────
  if (report.secondary && report.secondary.length > 0) {
    sectionTitle('Outputs');
    const rowH = 18;
    const col1 = CW * 0.55;
    ensure(report.secondary.length * rowH + 12);
    // header
    doc.setFillColor(...TABLE_HEAD);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.rect(MARGIN, y, CW, rowH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK_SOFT);
    doc.text('OUTPUT', MARGIN + 10, y + 12);
    doc.text('VALUE', MARGIN + col1 + 10, y + 12);
    y += rowH;
    for (const s of report.secondary) {
      ensure(rowH);
      doc.setFillColor(255, 255, 255);
      doc.rect(MARGIN, y, CW, rowH, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.text(s.label, MARGIN + 10, y + 12);
      doc.setFont('helvetica', 'bold');
      doc.text(s.value, MARGIN + col1 + 10, y + 12);
      y += rowH;
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.4);
      doc.line(MARGIN, y, PW - MARGIN, y);
    }
    y += 6;
  }

  // ── Chart image ──────────────────────────────────────────────────
  if (report.chartEl) {
    try {
      const canvas = await html2canvas(report.chartEl, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      });
      const imgW = CW;
      const imgH = canvas.height * (imgW / canvas.width);
      const maxH = 360;
      const finalH = imgH > maxH ? maxH : imgH;
      const finalW = imgW * (finalH / imgH);
      sectionTitle('Figure 1 · Time Series');
      const fx = MARGIN + (CW - finalW) / 2;
      ensure(finalH + 24);
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', fx, y, finalW, finalH);
      y += finalH + 6;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...INK_FAINT);
      doc.text('Figure 1 — Computed time series for the selected study area and time window.', MARGIN, y);
      y += 10;
    } catch {
      // chart capture failed — text-only export continues
    }
  }

  // ── Data sources ─────────────────────────────────────────────────
  if (report.dataSource) {
    sectionTitle('Data Sources');
    textBlock(stripHtml(report.dataSource), { size: 8.5, color: INK_SOFT, lh: 1.45, gap: 2 });
  }

  // ── Contextual analysis ──────────────────────────────────────────
  if (report.contextualAnalysis) {
    sectionTitle('Interpretation');
    textBlock(stripHtml(report.contextualAnalysis), { size: 9.5, color: INK, lh: 1.55, gap: 2 });
  }

  // ── Recommendations ──────────────────────────────────────────────
  if (report.recommendations && report.recommendations.length > 0) {
    sectionTitle('Recommendations');
    report.recommendations.forEach((rec, i) => {
      ensure(18);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...BRAND);
      doc.text(String(i + 1).padStart(2, '0'), MARGIN, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(stripHtml(rec), CW - 30);
      for (const l of lines) { ensure(13); doc.text(l, MARGIN + 28, y); y += 13; }
      y += 4;
    });
  }

  // ── Methodology / computation steps ──────────────────────────────
  if (report.steps && report.steps.length > 0) {
    sectionTitle('Methodology');
    for (const s of report.steps) {
      textBlock(stripHtml(s), { size: 8, color: INK_SOFT, lh: 1.35, gap: 1 });
    }
  }

  // ── Closing ──────────────────────────────────────────────────────
  y += 10;
  ensure(22);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...INK_FAINT);
  doc.text(`— End of report · ${report.toolName} · ${new Date().toLocaleDateString()} —`, MARGIN, y);

  footer();
  doc.save(`tool-${report.toolId}-${report.toolName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
