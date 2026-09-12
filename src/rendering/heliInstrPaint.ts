/**
 * Canvas-2D instrument painting for the in-scene cockpit screens (Pillar B,
 * Phase 5 — B-Full, spike-verified path).
 *
 * Pure functions (ctx, data) → pixels: no Cesium, no React, no clock. The
 * `CockpitScreenMgr` redraws each canvas at 30 Hz and Cesium re-uploads the
 * texture automatically because the fabric sampler binds the live canvas.
 *
 * Layout discipline: MIL-STD-1780-ish — primary flight (ADI) left DIU,
 * navigation (HSI) right DIU, engine/air-data summary on the centre DDU,
 * round standby ADI on the frame; amber-on-charcoal for the DDU.
 */

export interface InstrData {
  iasKts: number; tasKts: number; gsKts: number; vsFpm: number;
  altFt: number; raFt: number;
  pitchDeg: number; rollDeg: number; headingDeg: number;
  yawRateDps: number;
  rpm: number; ng: number; torquePct: number; ctPermille: number; shp: number;
  collPct: number; thrPct: number; fuelPct: number;
  windKt: number; windFromDeg: number; etlPct: number;
  sideslipDeg: number;
  engineOn: boolean; onGround: boolean; vrs: boolean;
  avnDark: boolean;
  clock: string;
}

export const INSTR_BG = '#04080c';
export const INSTR_GREEN = '#2fe67a';
export const INSTR_CYAN = '#5ec8ff';
export const INSTR_AMBER = '#ffb347';
export const INSTR_RED = '#ff4d4d';
export const INSTR_WHT = '#dbe9f4';

const fmt = (n: number) => String(Math.round(n));

export function paintDiuAdi(ctx: CanvasRenderingContext2D, d: InstrData): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  bezel(ctx, 'DIU 1 · ATT', INSTR_GREEN);
  if (d.avnDark) return darkScreen(ctx);
  const cx = W / 2, cy = H * 0.52, r = Math.min(W, H) * 0.42;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate((-d.rollDeg * Math.PI) / 180);
  const ppd = r / 30;
  ctx.fillStyle = '#0d3b63'; ctx.fillRect(-2 * r, -4 * r, 4 * r, 4 * r - d.pitchDeg * ppd);
  ctx.fillStyle = '#5c4416'; ctx.fillRect(-2 * r, -d.pitchDeg * ppd, 4 * r, 4 * r);
  ctx.strokeStyle = INSTR_WHT; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-2 * r, -d.pitchDeg * ppd); ctx.lineTo(2 * r, -d.pitchDeg * ppd); ctx.stroke();
  ctx.font = `${Math.round(r * 0.16)}px monospace`; ctx.fillStyle = 'rgba(220,235,245,.85)'; ctx.textAlign = 'center';
  for (let p = -60; p <= 60; p += 10) {
    if (p === 0) continue;
    const y = -(p - d.pitchDeg) * ppd;
    if (Math.abs(y) > r * 0.9) continue;
    ctx.fillRect(-r * 0.45, y - 0.5, r * 0.9, 1.5);
    ctx.fillText(String(Math.abs(p)), -r * 0.62, y + 4); ctx.fillText(String(Math.abs(p)), r * 0.62, y + 4);
  }
  ctx.restore();
  ctx.strokeStyle = INSTR_GREEN; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy); ctx.lineTo(cx - r * 0.18, cy);
  ctx.moveTo(cx + r * 0.18, cy); ctx.lineTo(cx + r * 0.5, cy);
  ctx.arc(cx, cy, r * 0.05, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = INSTR_CYAN; ctx.fillRect(cx - 1, cy - r * 0.42, 2, 8);
  ctx.font = `${Math.round(r * 0.17)}px monospace`; ctx.textAlign = 'center';
  ctx.fillStyle = INSTR_WHT; ctx.fillText(`P ${d.pitchDeg >= 0 ? '+' : ''}${fmt(d.pitchDeg)}  R ${d.rollDeg >= 0 ? '+' : ''}${fmt(d.rollDeg)}`, cx, H - 22);
  ctx.fillStyle = 'rgba(140,160,180,.8)'; ctx.font = '13px monospace';
  ctx.fillText(`ω ${d.yawRateDps >= 0 ? '+' : ''}${fmt(d.yawRateDps)}°/s · β ${d.sideslipDeg >= 0 ? '+' : ''}${fmt(d.sideslipDeg)}°`, cx, H - 8);
}

export function paintDiuHsi(ctx: CanvasRenderingContext2D, d: InstrData): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  bezel(ctx, 'DIU 2 · HSI', INSTR_GREEN);
  if (d.avnDark) return darkScreen(ctx);
  const cx = W / 2, cy = H * 0.5, r = Math.min(W, H) * 0.40;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate((-d.headingDeg * Math.PI) / 180);
  ctx.strokeStyle = 'rgba(120,160,190,.9)'; ctx.fillStyle = 'rgba(190,220,240,.95)';
  ctx.font = `${Math.round(r * 0.15)}px monospace`; ctx.textAlign = 'center';
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180;
    ctx.save(); ctx.rotate(rad);
    ctx.fillRect(-0.75, -r, 1.5, a % 90 === 0 ? r * 0.16 : r * 0.09);
    if (a % 90 === 0) { ctx.rotate(-rad); ctx.fillText(a === 0 ? 'N' : a === 90 ? 'E' : a === 180 ? 'S' : 'W', 0, -r * 0.72); }
    ctx.restore();
  }
  ctx.restore();
  ctx.strokeStyle = INSTR_GREEN; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.34); ctx.lineTo(cx - r * 0.2, cy + r * 0.22); ctx.lineTo(cx, cy + r * 0.1);
  ctx.lineTo(cx + r * 0.2, cy + r * 0.22); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = INSTR_CYAN; ctx.font = `${Math.round(r * 0.26)}px monospace`; ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(d.headingDeg)).padStart(3, '0'), cx, H - 10);
  ctx.fillStyle = 'rgba(140,160,180,.9)'; ctx.font = '13px monospace';
  ctx.fillText(`TRK ${fmt(trackOf(d))} · GS ${fmt(d.gsKts)}kt`, cx, cy + r + 24 > H - 26 ? H - 26 : cy - r - 6);
}
function trackOf(d: InstrData): number {
  const trk = d.headingDeg + d.sideslipDeg;
  return ((trk % 360) + 360) % 360;
}

export function paintDdu(ctx: CanvasRenderingContext2D, d: InstrData): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  bezel(ctx, 'DDU · ENGINE / AIR DATA', INSTR_AMBER, true);
  if (d.avnDark) return darkScreen(ctx);
  ctx.font = '15px monospace'; ctx.textAlign = 'left';
  const rows = [
    [
      { l: 'IAS', v: `${fmt(d.iasKts)}`, u: 'kt', c: d.iasKts > 145 ? INSTR_RED : INSTR_AMBER },
      { l: 'TAS', v: `${fmt(d.tasKts)}`, u: 'kt', c: INSTR_AMBER },
      { l: 'GS', v: `${fmt(d.gsKts)}`, u: 'kt', c: INSTR_AMBER },
      { l: 'W/V', v: `${d.vsFpm > 0 ? '+' : ''}${fmt(d.vsFpm)}`, u: 'fpm', c: d.vsFpm < -1500 ? INSTR_RED : INSTR_AMBER },
    ],
    [
      { l: 'ALT', v: fmt(d.altFt), u: 'ft', c: INSTR_AMBER },
      { l: 'RA', v: fmt(d.raFt), u: '', c: d.raFt < 100 && !d.onGround ? INSTR_RED : INSTR_AMBER },
      { l: 'WIND', v: `${fmt(d.windKt)}/${String(Math.round(d.windFromDeg)).padStart(3, '0')}`, u: '', c: INSTR_AMBER },
      { l: 'ETL', v: `${fmt(d.etlPct)}%`, u: '', c: d.etlPct > 85 ? INSTR_GREEN : INSTR_AMBER },
    ],
    [
      { l: 'Nf', v: `${fmt(d.rpm)}%`, u: '', c: d.rpm < 90 ? INSTR_RED : INSTR_AMBER },
      { l: 'Ng', v: `${fmt(d.ng)}%`, u: '', c: INSTR_AMBER },
      { l: 'TRQ', v: `${fmt(d.torquePct)}%`, u: '', c: d.torquePct > 95 ? INSTR_RED : INSTR_AMBER },
      { l: 'CT', v: `${d.ctPermille.toFixed(1)}‰`, u: '', c: INSTR_AMBER },
      { l: 'SHP', v: d.shp.toLocaleString(), u: '', c: INSTR_AMBER },
      { l: 'FUEL', v: `${fmt(d.fuelPct)}%`, u: '', c: d.fuelPct < 15 ? INSTR_RED : INSTR_AMBER },
    ],
  ];
  rows.forEach((row, ri) => {
    const y = 34 + ri * ((H - 40) / 3);
    let x = 12;
    const cell = (W - 24) / (row.length > 4 ? 3 : 4);
    for (const it of row) {
      ctx.fillStyle = 'rgba(150,120,70,.85)'; ctx.font = '10px monospace'; ctx.fillText(it.l, x, y);
      ctx.fillStyle = it.c; ctx.font = 'bold 17px monospace'; ctx.fillText(it.v, x + 26, y + 3);
      const vw = ctx.measureText(it.v).width;
      ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(150,120,70,.85)';
      if (it.u) ctx.fillText(it.u, x + 30 + vw, y + 3);
      x += cell;
    }
  });
  if (!d.engineOn) { ctx.fillStyle = INSTR_RED; ctx.font = 'bold 12px monospace'; ctx.fillText('ENGINE OFF', 12, H - 6); }
  if (d.vrs) { ctx.fillStyle = INSTR_RED; ctx.font = 'bold 12px monospace'; ctx.fillText('VRS  —  LOWER NOSE / ADD SPEED', 110, H - 6); }
}

export function paintStby(ctx: CanvasRenderingContext2D, d: InstrData): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const cx = W / 2, cy = H / 2, r = W * 0.46;
  ctx.fillStyle = '#0a0f14'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate((-d.rollDeg * Math.PI) / 180);
  const ppd = r / 40;
  ctx.fillStyle = '#2a6aa0'; ctx.fillRect(-2 * r, -3 * r, 4 * r, 3 * r - d.pitchDeg * ppd);
  ctx.fillStyle = '#8a6a2a'; ctx.fillRect(-2 * r, -d.pitchDeg * ppd, 4 * r, 3 * r);
  ctx.strokeStyle = '#f4f8fb'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-r * 0.8, -d.pitchDeg * ppd); ctx.lineTo(r * 0.8, -d.pitchDeg * ppd); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = INSTR_AMBER; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy); ctx.lineTo(cx - r * 0.2, cy);
  ctx.moveTo(cx + r * 0.2, cy); ctx.lineTo(cx + r * 0.55, cy);
  ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
  ctx.stroke();
  ctx.strokeStyle = '#3a4856'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.stroke();
}

function bezel(ctx: CanvasRenderingContext2D, caption: string, color: string, amber = false): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.fillStyle = amber ? '#0b0703' : INSTR_BG;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = amber ? 'rgba(120,90,40,.9)' : 'rgba(80,100,120,.9)';
  ctx.lineWidth = 4; ctx.strokeRect(2, 2, W - 4, H - 4);
  ctx.fillStyle = color; ctx.font = '11px monospace'; ctx.textAlign = 'left';
  ctx.fillText(caption, 10, 16);
}

function darkScreen(ctx: CanvasRenderingContext2D): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.fillStyle = 'rgba(20,28,36,.25)';
  for (let y = 24; y < H; y += 6) ctx.fillRect(6, y, W - 12, 2);
  ctx.fillStyle = '#5a6a7a'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
  ctx.fillText('AVIONICS OFF', W / 2, H / 2);
}
