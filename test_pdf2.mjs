import { jsPDF } from 'jspdf';

const INK = [26, 32, 44];
const INK_LIGHT = [100, 116, 139];
const INK_FAINT = [203, 213, 225];
const BRAND = [79, 70, 229];
const USER_TAG = [37, 99, 235];
const AI_TAG = [5, 150, 105];

const MARGIN = 48;
const PW = 595.28;
const PH = 841.89;
const CW = PW - MARGIN * 2;

function stripMarkdown(text) {
  return text.replace(/```[\w]*\n([\s\S]*?)```/g, (_, c) => `\n${c.trim()}\n`).replace(/## COMMANDS[\s\S]*$/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '  • ').replace(/^(\d+)\.\s+/gm, '  $1. ').replace(/\n{3,}/g, '\n\n').trim();
}

const messages = [
  { id: 1, role: 'user', content: 'What is the seismic risk near Tokyo?' },
  { id: 2, role: 'assistant', content: '**Tokyo Seismic Risk Assessment**\n\nTokyo is near four tectonic plates. USGS reports a 70% probability of a M7+ earthquake within 30km in the next 30 years.\n\n- PGA at 10km: 0.23g\n- Estimated losses: 123.4 billion JPY', modelTier: 'flash' },
  { id: 3, role: 'user', content: 'Show active wildfires nearby' },
  { id: 4, role: 'assistant', content: 'Found 3 active wildfire clusters within 500km:\n\n| Region | Area (ha) | Confidence |\n|--------|-----------|------------|\n| Chiba | 45.2 | 0.89 |\n| Ibaraki | 12.8 | 0.75 |', modelTier: 'flash', toolEvents: [{ name: 'wildfires', status: 'success', args: { radius: 500 } }] },
  { id: 5, role: 'user', content: 'Plot earthquake magnitudes' },
  { id: 6, role: 'assistant', content: 'Magnitude distribution: 12 M5+ events, 3 M6+ events, 1 M7+ in past 30 days.', modelTier: 'pro', commands: [{ action: 'flyTo', lat: 35.68, lon: 139.69, label: 'Tokyo' }] },
];

const doc = new jsPDF({ unit: 'pt', format: 'a4' });
let y = 0, page = 1;

const footer = () => {
  const fy = PH - 28;
  doc.setDrawColor(...INK_FAINT); doc.setLineWidth(0.4);
  doc.line(MARGIN, fy, PW - MARGIN, fy);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.setTextColor(...INK_LIGHT);
  doc.text('Earth Intelligence AI', MARGIN, fy + 12);
  doc.text(`Page ${page}`, PW - MARGIN, fy + 12, { align: 'right' });
};
const newPage = () => { footer(); doc.addPage(); page++; y = MARGIN; };
const ensure = (h) => { if (y + h > PH - MARGIN - 32) newPage(); };
const text = (str, opts = {}) => {
  const { size = 9.5, style = 'normal', color = INK, lh = 1.42, indent = 0, gap = 0 } = opts;
  doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color);
  const lines = doc.splitTextToSize(str, CW - indent);
  for (const line of lines) { ensure(size * lh); doc.text(line, MARGIN + indent, y); y += size * lh; }
  y += gap;
};
const hr = (color = INK_FAINT, w = 0.3) => { ensure(12); doc.setDrawColor(...color); doc.setLineWidth(w); doc.line(MARGIN, y, PW - MARGIN, y); y += 10; };
const gap = (h) => { y += h; };

// Header
doc.setFillColor(...BRAND); doc.rect(0, 0, PW, 3, 'F');
y = MARGIN;
doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...INK);
doc.text('Earth Intelligence Report', MARGIN, y); y += 20;
doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK_LIGHT);
doc.text('AI Conversation Transcript', MARGIN, y); y += 14;
doc.setFontSize(8);
doc.text(`${new Date().toLocaleString()}  •  6 messages  •  Session test-001`, MARGIN, y); y += 8;
hr(BRAND, 0.8); gap(6);

// Conversation
let n = 0;
for (const msg of messages) {
  n++;
  const isUser = msg.role === 'user';
  const tagColor = isUser ? USER_TAG : AI_TAG;
  const content = stripMarkdown(msg.content || '');
  ensure(30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...tagColor);
  doc.text(isUser ? 'USER' : 'ASSISTANT', MARGIN, y);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK_LIGHT);
  doc.text(String(n), PW - MARGIN, y, { align: 'right' });
  y += 12;
  if (content) text(content, { size: 9.5, color: INK, lh: 1.45, gap: 2 });
  if (msg.modelTier) { doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...INK_LIGHT); ensure(10); doc.text(`model: ${msg.modelTier}`, MARGIN, y); y += 8; }
  if (msg.toolEvents?.length) {
    gap(2); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK_LIGHT); ensure(12);
    doc.text(`TOOLS (${msg.toolEvents.length})`, MARGIN, y); y += 10;
    for (const ev of msg.toolEvents) {
      const st = ev.status === 'success' ? '✓' : '✗';
      text(`  ${st} ${ev.name} — ${JSON.stringify(ev.args).slice(0, 80)}`, { size: 7.5, color: INK_LIGHT, lh: 1.35, indent: 10 });
    }
  }
  if (msg.commands?.length) {
    text(`actions: ${msg.commands.map(c => c.action+'('+(c.label||'')+')').join(', ')}`, { size: 7.5, color: INK_LIGHT, style: 'italic', lh: 1.3 });
  }
  gap(6); hr(); gap(4);
}

gap(8);
doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...INK_LIGHT);
ensure(20); doc.text(`— End of report — ${new Date().toLocaleString()}`, MARGIN, y);
footer();

const fn = `test-report-${Date.now()}.pdf`;
doc.save(fn);
console.log('PDF saved:', fn);
console.log('Pages:', page);

// Verify
import { readFileSync, statSync } from 'fs';
const data = readFileSync(fn);
console.log('Size:', data.length, 'bytes');
console.log('Valid PDF:', data.slice(0,5).toString() === '%PDF-');
console.log('Page count:', (data.toString().match(/\/Type\s*\/Page[^s]/g) || []).length);
console.log('Has header:', data.includes('Earth Intelligence Report'));
console.log('Has USER/ASSISTANT tags:', data.includes('USER') && data.includes('ASSISTANT'));
console.log('Has footer:', data.includes('Page'));
