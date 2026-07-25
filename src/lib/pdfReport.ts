/**
 * Conversation PDF Report Generator
 * ───────────────────────────────────
 * Professional, clean PDF export of the AI chat conversation.
 * Minimalist design: cover header, conversation log, clean typography.
 */
import { jsPDF } from 'jspdf';
import type { ChatMessage } from '@/lib/chatStore';

interface ReportMeta {
  title: string;
  subtitle?: string;
  author?: string;
  sessionId?: string;
  modelTier?: string;
}

const INK = [26, 32, 44] as [number, number, number];
const INK_LIGHT = [100, 116, 139] as [number, number, number];
const INK_FAINT = [203, 213, 225] as [number, number, number];
const BRAND = [79, 70, 229] as [number, number, number];
const USER_TAG = [37, 99, 235] as [number, number, number];
const AI_TAG = [5, 150, 105] as [number, number, number];

const MARGIN = 48;
const PW = 595.28;
const PH = 841.89;
const CW = PW - MARGIN * 2;

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => `\n${code.trim()}\n`)
    .replace(/## COMMANDS[\s\S]*$/g, '')
    .replace(/## TOOL_CALLS[\s\S]*?(?=\n##|\n*$)/g, '')
    .replace(/```chart\n[\s\S]*?```/g, '[chart]')
    .replace(/\[ARTIFACT:\w+:\d+\]/g, '[artifact]')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '  • ')
    .replace(/^(\d+)\.\s+/gm, '  $1. ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s+/gm, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function exportConversationAsPDF(messages: ChatMessage[], meta: ReportMeta): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 0;
  let page = 1;

  const footer = () => {
    const fy = PH - 28;
    doc.setDrawColor(...INK_FAINT);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, fy, PW - MARGIN, fy);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...INK_LIGHT);
    doc.text('Earth Intelligence AI', MARGIN, fy + 12);
    doc.text(`Page ${page}`, PW - MARGIN, fy + 12, { align: 'right' });
  };

  const newPage = () => {
    footer();
    doc.addPage();
    page++;
    y = MARGIN;
  };

  const ensure = (h: number) => {
    if (y + h > PH - MARGIN - 32) newPage();
  };

  const text = (str: string, opts: { size?: number; style?: 'normal' | 'bold' | 'italic'; color?: [number, number, number]; lh?: number; indent?: number; gap?: number } = {}) => {
    const { size = 9.5, style = 'normal', color = INK, lh = 1.42, indent = 0, gap = 0 } = opts;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const maxWidth = CW - indent;
    const lines = doc.splitTextToSize(str, maxWidth);
    for (let i = 0; i < lines.length; i++) {
      ensure(size * lh);
      doc.text(lines[i], MARGIN + indent, y);
      y += size * lh;
    }
    y += gap;
  };

  const hr = (color: [number, number, number] = INK_FAINT, w: number = 0.3) => {
    ensure(12);
    doc.setDrawColor(...color);
    doc.setLineWidth(w);
    doc.line(MARGIN, y, PW - MARGIN, y);
    y += 10;
  };

  const gap = (h: number) => { y += h; };

  // ═════════════════════════════════════════════════════════════════
  // HEADER (top of first page)
  // ═════════════════════════════════════════════════════════════════

  // Thin brand accent line at very top
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, PW, 3, 'F');

  y = MARGIN;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text(meta.title || 'Earth Intelligence Report', MARGIN, y);
  y += 20;

  if (meta.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK_LIGHT);
    doc.text(meta.subtitle, MARGIN, y);
    y += 14;
  }

  // Meta line: date | messages | session
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...INK_LIGHT);
  const metaParts: string[] = [new Date().toLocaleString()];
  metaParts.push(`${messages.length} messages`);
  if (meta.sessionId) metaParts.push(`Session ${meta.sessionId.slice(-8)}`);
  doc.text(metaParts.join('  •  '), MARGIN, y);
  y += 8;

  hr(BRAND, 0.8);
  gap(6);

  // ═════════════════════════════════════════════════════════════════
  // CONVERSATION
  // ═════════════════════════════════════════════════════════════════

  let n = 0;
  for (const msg of messages) {
    n++;
    const isUser = msg.role === 'user';
    const tagColor = isUser ? USER_TAG : AI_TAG;
    const content = stripMarkdown(msg.content || '');

    // Role label
    ensure(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...tagColor);
    doc.text(isUser ? 'USER' : 'ASSISTANT', MARGIN, y);

    // Message number on the right
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK_LIGHT);
    doc.text(String(n), PW - MARGIN, y, { align: 'right' });
    y += 12;

    // Content
    if (content) {
      text(content, { size: 9.5, color: INK, lh: 1.45, gap: 2 });
    }

    // Model tier (subtle)
    if (msg.modelTier) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(...INK_LIGHT);
      ensure(10);
      doc.text(`model: ${msg.modelTier}`, MARGIN, y);
      y += 8;
    }

    // Tool calls
    if (msg.toolEvents && msg.toolEvents.length > 0) {
      gap(2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...INK_LIGHT);
      ensure(12);
      doc.text(`TOOLS (${msg.toolEvents.length})`, MARGIN, y);
      y += 10;
      for (const ev of msg.toolEvents) {
        const st = ev.status === 'success' ? '✓' : ev.status === 'error' ? '✗' : ev.status === 'blocked' ? '⊘' : '•';
        text(`  ${st} ${ev.name}${ev.args ? ' — ' + JSON.stringify(ev.args).slice(0, 80) : ''}`, { size: 7.5, color: INK_LIGHT, lh: 1.35, indent: 10 });
      }
    }

    // Artifacts
    if (msg.artifacts && msg.artifacts.length > 0) {
      gap(2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...INK_LIGHT);
      ensure(12);
      doc.text(`ARTIFACTS (${msg.artifacts.length})`, MARGIN, y);
      y += 10;
      for (const art of msg.artifacts) {
        const d = art.kind === 'table' ? `Table — ${art.rows?.length || 0} rows`
          : art.kind === 'chart' ? `Chart (${art.chartType || 'bar'})`
          : `Artifact (${art.kind})`;
        text(`  • ${d}`, { size: 7.5, color: INK_LIGHT, lh: 1.35, indent: 10 });
      }
    }

    // Commands
    if (msg.commands && msg.commands.length > 0) {
      const cs = msg.commands.map(c => `${c.action}(${c.label || c.layerId || ''})`).join(', ');
      text(`actions: ${cs}`, { size: 7.5, color: INK_LIGHT, style: 'italic', lh: 1.3, indent: 0, gap: 0 });
    }

    gap(6);
    hr();
    gap(4);
  }

  // End
  gap(8);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...INK_LIGHT);
  ensure(20);
  doc.text(`— End of report — ${new Date().toLocaleString()}`, MARGIN, y);

  footer();
  doc.save(`${(meta.title || 'earth-intelligence-report').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
