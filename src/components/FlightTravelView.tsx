import { useEffect, useState } from 'react';
import { Plane, Crosshair, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCcw, Locate, Scan, X } from 'lucide-react';

export interface FlightTravelHud {
  callsign: string;
  lat: number;
  lon: number;
  altFt: number;
  speedKts: number;
  speedKmh: number;
  heading: number;
  vs: number;
  pitch?: number;
}

export type FlightLookAction = 'left' | 'right' | 'up' | 'down' | 'back' | 'default' | 'zoomin' | 'zoomout' | 'chase' | 'cockpit' | 'topdown';

interface FlightTravelViewProps {
  hud: FlightTravelHud | null;
  onLook: (action: FlightLookAction) => void;
  onCapture: () => void;
  onExit: () => void;
}

/* ─── helpers ─── */
function compass(az: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(az / 45) % 8];
}
function utcClock(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}
function vsToFpm(vs: number): number { return Math.round(vs * 196.8504); }
function calcMach(kts: number, altFt: number): string {
  if (kts <= 0) return '.00';
  const sosSea = 661.47;
  let sos: number;
  if (altFt < 36089) {
    sos = sosSea * Math.sqrt(1 - 0.000006875 * Math.max(0, altFt));
  } else {
    sos = 573.6; // constant above tropopause
  }
  return (kts / sos).toFixed(2);
}

/* ─── constants ─── */
const H = { amber: '#fbbf24', cyan: '#7dd3fc', green: '#4ade80', red: '#ef4444', white: '#e2f3ff', dim: '#94a3b8' };
const PX_DEG_PITCH = 3.2;
const PX_DEG_HEADING = 2.4;

export function FlightTravelView({ hud, onLook, onCapture, onExit }: FlightTravelViewProps) {
  const [clock, setClock] = useState(utcClock());
  useEffect(() => { const id = setInterval(() => setClock(utcClock()), 1000); return () => clearInterval(id); }, []);

  /* ── derived data ── */
  const c = hud?.callsign ?? '—';
  const heading = hud?.heading ?? 0;
  const pitch = hud?.pitch ?? 0;
  const speed = hud?.speedKts ?? 0;
  const alt = hud?.altFt ?? 0;
  const vs = hud?.vs ?? 0;
  const vsFpm = vsToFpm(vs);
  const mach = calcMach(speed, alt);

  const azLabel = `${heading}° ${compass(heading)}`;
  const vsColor = vs > 3 ? H.red : vs < -3 ? H.cyan : H.dim;
  const vsStr = vsFpm > 0 ? `+${vsFpm}` : `${vsFpm}`;

  /* ── pitch ladder ── */
  const pitchLines: { deg: number; half: boolean }[] = [];
  const pStart = Math.floor((pitch - 30) / 5) * 5;
  for (let d = pStart; d <= pitch + 30; d += 5) {
    if (Math.abs(d) <= 90) pitchLines.push({ deg: d, half: Math.abs(d) > 0 && Math.abs(d) % 10 !== 0 });
  }
  const pitchLabel = `${(pitch >= 0 ? '+' : '')}${pitch}°`;

  /* ── heading tape ── */
  const ticks: { d: number; label: string | null }[] = [];
  const hStart = Math.floor((heading - 90) / 10) * 10;
  for (let d = hStart; d <= heading + 90; d += 10) {
    const norm = ((d % 360) + 360) % 360;
    const label = norm === 0 ? 'N' : norm === 90 ? 'E' : norm === 180 ? 'S' : norm === 270 ? 'W' : null;
    ticks.push({ d, label });
  }

  /* ── speed tape ── */
  const speedSnap = Math.round(speed / 5) * 5;
  const speedTicks: { v: number }[] = [];
  for (let v = speedSnap - 60; v <= speedSnap + 60; v += 5) { if (v >= 0) speedTicks.push({ v }); }

  /* ── altitude tape ── */
  const altSnap = Math.round(alt / 100) * 100;
  const altTicks: { v: number }[] = [];
  for (let v = altSnap - 1200; v <= altSnap + 1200; v += 100) { if (v >= 0) altTicks.push({ v }); }

  /* ── V/S tape ── */
  const vsTicks: { v: number }[] = [];
  for (let v = -6000; v <= 6000; v += 500) vsTicks.push({ v });

  return (
    <div className="flt-hud">

      {/* ── top bar: autopilot / flight director / status ── */}
      <div className="flt-hud-topbar">
        <span className="flt-hud-fd">FD</span>
        <span className="flt-hud-ap">LNAV · VNAV</span>
        <span className="flt-hud-spd">SPD {speed}kt</span>
        <span className="flt-hud-hdg">HDG {heading}°</span>
        <span className="flt-hud-alt-sel">ALT {alt.toLocaleString()}ft</span>
        <span className="flt-hud-clock">{clock}</span>
      </div>

      {/* ── heading tape (top) ── */}
      <div className="flt-hud-heading-wrap">
        <div className="flt-hud-heading-track">
          {ticks.map(t => (
            <div
              key={t.d}
              className={`flt-hud-h-tick ${t.label ? 'major' : ''}`}
              style={{ left: `calc(50% + ${(t.d - heading) * PX_DEG_HEADING}px)` }}
            >
              <span className="flt-hud-h-tick-mark" />
              <span className="flt-hud-h-tick-label">{t.label ?? ''}</span>
            </div>
          ))}
        </div>
        <div className="flt-hud-h-pointer" />
        <div className="flt-hud-h-bug" style={{ left: `calc(50% + ${(0 - heading) * PX_DEG_HEADING}px)` }} />
        <div className="flt-hud-h-track-label">{azLabel}</div>
      </div>

      {/* ── speed tape (left) ── */}
      <div className="flt-hud-speed-wrap">
        <div className="flt-hud-speed-tape">
          {speedTicks.map(({ v }) => (
            <div
              key={v}
              className={`flt-hud-s-tick ${v % 20 === 0 ? 'major' : v % 10 === 0 ? 'mid' : ''}`}
              style={{ bottom: `calc(50% + ${(v - speed) * 4}px)` }}
            >
              {(v % 20 === 0 || v % 10 === 0) && <span className="flt-hud-s-label">{v}</span>}
              <span className="flt-hud-s-mark" />
            </div>
          ))}
        </div>
        <div className="flt-hud-speed-digital">
          <span className="flt-hud-speed-num">{speed}</span>
          <span className="flt-hud-speed-unit">kn</span>
        </div>
        <div className="flt-hud-mach">M {mach}</div>
      </div>

      {/* ── altitude tape (right) ── */}
      <div className="flt-hud-alt-wrap">
        <div className="flt-hud-alt-tape">
          {altTicks.map(({ v }) => (
            <div
              key={v}
              className={`flt-hud-a-tick ${v % 500 === 0 ? 'major' : ''}`}
              style={{ bottom: `calc(50% + ${(v - alt) * 0.2}px)` }}
            >
              <span className="flt-hud-a-mark" />
              {v % 500 === 0 && <span className="flt-hud-a-label">{v.toLocaleString()}</span>}
            </div>
          ))}
        </div>
        <div className="flt-hud-alt-digital">
          <span className="flt-hud-alt-num">{alt.toLocaleString()}</span>
          <span className="flt-hud-alt-unit">ft</span>
        </div>
        <div className="flt-hud-baro">2992 inHg</div>
      </div>

      {/* ── V/S indicator (right-adjacent) ── */}
      <div className="flt-hud-vs-wrap">
        <div className="flt-hud-vs-tape">
          {vsTicks.map(({ v }) => (
            <div
              key={v}
              className={`flt-hud-v-tick ${v === 0 ? 'zero' : ''}`}
              style={{ bottom: `calc(50% + ${(v - Math.max(-6000, Math.min(6000, vsFpm))) / 60}px)` }}
            >
              <span className="flt-hud-v-mark" />
              {Math.abs(v) % 2000 === 0 && <span className="flt-hud-v-label">{v > 0 ? `+${v}` : v}</span>}
            </div>
          ))}
        </div>
        <div className="flt-hud-v-bug" style={{ bottom: `calc(50% + ${(vsFpm - Math.max(-6000, Math.min(6000, vsFpm))) / 60}px)` }} />
      </div>

      {/* ── center pitch ladder (minimal) ── */}
      <div className="flt-hud-pitch-ladder">
        {pitchLines
          .filter(l => !l.half && l.deg % 10 === 0)
          .map(({ deg }) => {
            const offset = (deg - pitch) * PX_DEG_PITCH;
            return (
              <div
                key={deg}
                className="flt-hud-pitch-line"
                style={{ bottom: `calc(50% + ${offset}px)` }}
              >
                <span className="flt-hud-pitch-label">{deg === 0 ? '' : `${Math.abs(deg)}`}</span>
                <span className={`flt-hud-pitch-bar ${deg === 0 ? 'horizon' : ''}`} />
              </div>
            );
          })}
        {/* pitch tag */}
        <div className="flt-hud-pitch-tag">{pitchLabel}</div>
      </div>

      {/* ── bottom data strip ── */}
      <div className="flt-hud-botstrip">
        <span><span className="flt-hud-bot-label">GS</span> {speed}<span className="flt-hud-bot-unit">kt</span></span>
        <span><span className="flt-hud-bot-label">G</span> 1.0</span>
        <span><span className="flt-hud-bot-label">OAT</span> ISA+6</span>
        <span><span className="flt-hud-bot-label">TAT</span> 18°C</span>
        <span className="flt-hud-bot-callsign">{c}</span>
      </div>

      {/* ── V/S readout (bottom-left, compact) ── */}
      <div className="flt-hud-vsreadout">
        <span className="flt-hud-vsreadout-label">V/S</span>
        <span className="flt-hud-vsreadout-val" style={{ color: vsColor }}>{vsStr}</span>
        <span className="flt-hud-vsreadout-unit">ft/m</span>
      </div>

      {/* ── CAS messages ── */}
      <div className="flt-hud-cas">
        <div className="flt-hud-cas-item info">LIVE TRACKING ACTIVE</div>
        <div className="flt-hud-cas-item warn">CHASE CAM MODE</div>
      </div>

      {/* ── control deck (bottom-right) ── */}
      <div className="flt-hud-deck">
        <div className="flt-hud-dpad">
          <div />
          <button className="flt-hud-dbtn" onClick={() => onLook('up')}><ArrowUp size={14} /></button>
          <div />
          <button className="flt-hud-dbtn" onClick={() => onLook('left')}><ArrowLeft size={14} /></button>
          <button className="flt-hud-dbtn flt-hud-dcenter" onClick={() => onLook('chase')}><Crosshair size={14} /></button>
          <button className="flt-hud-dbtn" onClick={() => onLook('right')}><ArrowRight size={14} /></button>
          <div />
          <button className="flt-hud-dbtn" onClick={() => onLook('down')}><ArrowDown size={14} /></button>
          <div />
        </div>
        <div className="flt-hud-actions">
          <button className="flt-hud-pill" onClick={() => onLook('back')}><RotateCcw size={11} /> BACK</button>
          <button className="flt-hud-pill" onClick={() => onLook('cockpit')}><Plane size={11} /> COCKPIT</button>
          <button className="flt-hud-pill" onClick={() => onLook('default')}><Locate size={11} /> RESET</button>
          <button className="flt-hud-pill" onClick={() => onLook('zoomin')}>＋</button>
          <button className="flt-hud-pill" onClick={() => onLook('zoomout')}>－</button>
          <button className="flt-hud-pill" onClick={onCapture}><Scan size={11} /> CAP</button>
          <button className="flt-hud-pill flt-hud-exit" onClick={onExit}><X size={11} /> EXIT</button>
        </div>
      </div>

      <style>{css}</style>
    </div>
  );
}

const css = `
/* ─── base ─── */
.flt-hud {
  position: absolute; top: 64px; bottom: 36px; left: 0; right: 0; z-index: 235; pointer-events: none;
  font-family: 'JetBrains Mono', monospace;
  --a: #fbbf24; --c: #7dd3fc; --w: #e2f3ff; --d: #94a3b8;
  color: var(--c);
  overflow: hidden;
}
.flt-hud button { pointer-events: auto; }

/* ─── scanline + vignette ─── */
.flt-hud::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(to bottom, rgba(125,211,252,0.04) 0, rgba(125,211,252,0.04) 1px, transparent 2px, transparent 4px);
  mix-blend-mode: screen; opacity: 0.4; z-index: 1;
}
.flt-hud::after {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse at 50% 45%, transparent 50%, rgba(0,0,0,0.55) 100%);
  z-index: 1;
}
.flt-hud > * { position: relative; z-index: 2; }

/* ─── top status bar ─── */
.flt-hud-topbar {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px;
  font-size: 10px; color: var(--c); letter-spacing: 0.06em;
  background: rgba(8,20,30,0.5); padding: 3px 14px; border-radius: 4px;
  border: 1px solid rgba(125,211,252,0.2);
}
.flt-hud-fd { color: var(--a); font-weight: 700; }
.flt-hud-ap, .flt-hud-spd, .flt-hud-hdg, .flt-hud-alt-sel { color: #4ade80; }
.flt-hud-clock { color: var(--a); margin-left: 4px; }

/* ─── heading tape ─── */
.flt-hud-heading-wrap {
  position: absolute; top: 46px; left: 50%; transform: translateX(-50%);
  width: min(640px, 85vw); height: 28px;
  border-top: 1px solid rgba(125,211,252,0.4);
  border-bottom: 1px solid rgba(125,211,252,0.4);
  overflow: hidden; background: rgba(8,20,30,0.3);
}
.flt-hud-heading-track { position: absolute; inset: 0; }
.flt-hud-h-tick { position: absolute; top: 0; height: 100%; transform: translateX(-50%); }
.flt-hud-h-tick-mark { display: block; width: 1px; height: 6px; background: rgba(125,211,252,0.5); margin: 0 auto; margin-top: 2px; }
.flt-hud-h-tick.major .flt-hud-h-tick-mark { height: 12px; background: var(--a); }
.flt-hud-h-tick-label {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  font-size: 9px; color: var(--a); letter-spacing: 0.04em;
}
.flt-hud-h-pointer {
  position: absolute; top: -4px; left: 50%; transform: translateX(-50%);
  width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent;
  border-top: 8px solid var(--c);
}
.flt-hud-h-bug {
  position: absolute; bottom: 0; width: 2px; height: 100%; transform: translateX(-50%);
  background: #4ade80; opacity: 0.7;
}
.flt-hud-h-track-label {
  position: absolute; bottom: -14px; left: 50%; transform: translateX(-50%);
  font-size: 10px; color: var(--c); letter-spacing: 0.08em; white-space: nowrap;
}

/* ─── speed tape (left) ─── */
.flt-hud-speed-wrap {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  width: 80px; height: 220px; pointer-events: none;
}
.flt-hud-speed-tape {
  position: absolute; inset: 32px 0 14px 0; overflow: hidden;
  border-left: 1px solid rgba(125,211,252,0.25);
  background: rgba(8,20,30,0.2);
}
.flt-hud-s-tick { position: absolute; left: 0; width: 100%; height: 1px; }
.flt-hud-s-mark { display: block; width: 6px; height: 1px; background: rgba(125,211,252,0.4); }
.flt-hud-s-tick.mid .flt-hud-s-mark { width: 10px; }
.flt-hud-s-tick.major .flt-hud-s-mark { width: 18px; background: var(--a); }
.flt-hud-s-label { position: absolute; left: 36px; font-size: 9px; color: var(--a); transform: translateY(-50%); }
.flt-hud-speed-digital {
  position: absolute; left: 0; top: 2px; display: flex; align-items: baseline; gap: 1px;
}
.flt-hud-speed-num { font-size: 24px; font-weight: 800; color: var(--w); letter-spacing: -0.02em; text-shadow: 0 0 6px rgba(125,211,252,0.4); }
.flt-hud-speed-unit { font-size: 9px; color: var(--c); }
.flt-hud-mach { position: absolute; left: 2px; top: 28px; font-size: 9px; color: var(--d); }

/* ─── altitude tape (right) ─── */
.flt-hud-alt-wrap {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  width: 100px; height: 220px; pointer-events: none;
}
.flt-hud-alt-tape {
  position: absolute; inset: 32px 0 14px 0; overflow: hidden;
  border-right: 1px solid rgba(125,211,252,0.25);
  background: rgba(8,20,30,0.2);
}
.flt-hud-a-tick { position: absolute; right: 0; width: 100%; height: 1px; display: flex; align-items: center; justify-content: flex-end; }
.flt-hud-a-mark { display: block; width: 6px; height: 1px; background: rgba(125,211,252,0.4); }
.flt-hud-a-tick.major .flt-hud-a-mark { width: 18px; background: var(--a); }
.flt-hud-a-label { position: absolute; right: 22px; font-size: 9px; color: var(--a); transform: translateY(-50%); }
.flt-hud-alt-digital {
  position: absolute; right: 0; top: 2px; display: flex; align-items: baseline; gap: 1px;
}
.flt-hud-alt-num { font-size: 22px; font-weight: 800; color: var(--w); letter-spacing: -0.02em; text-shadow: 0 0 6px rgba(125,211,252,0.4); }
.flt-hud-alt-unit { font-size: 9px; color: var(--c); }
.flt-hud-baro { position: absolute; right: 2px; top: 28px; font-size: 9px; color: var(--d); }

/* ─── V/S indicator ─── */
.flt-hud-vs-wrap {
  position: absolute; right: 115px; top: 50%; transform: translateY(-50%);
  width: 28px; height: 200px; pointer-events: none;
  border-left: 1px solid rgba(125,211,252,0.2);
  border-right: 1px solid rgba(125,211,252,0.2);
  background: rgba(8,20,30,0.15);
}
.flt-hud-vs-tape { position: absolute; inset: 0; overflow: hidden; }
.flt-hud-v-tick { position: absolute; left: 0; width: 100%; height: 1px; }
.flt-hud-v-mark { display: block; width: 100%; height: 1px; background: rgba(125,211,252,0.2); }
.flt-hud-v-tick.zero .flt-hud-v-mark { background: var(--a); height: 2px; }
.flt-hud-v-label { position: absolute; left: 4px; font-size: 7px; color: var(--d); transform: translateY(-50%); }
.flt-hud-v-bug {
  position: absolute; right: -4px; width: 10px; height: 2px;
  background: var(--a); transform: translateY(50%);
}

/* ─── pitch ladder ─── */
.flt-hud-pitch-ladder {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 300px; height: 200px; pointer-events: none;
}
.flt-hud-pitch-line {
  position: absolute; left: 0; width: 100%; height: 1px;
  display: flex; align-items: center;
}
.flt-hud-pitch-label {
  font-size: 9px; color: var(--a); width: 28px; text-align: right;
  transform: translateY(-50%); flex-shrink: 0;
}
.flt-hud-pitch-bar {
  flex: 1; height: 1px; background: rgba(125,211,252,0.25);
  margin-left: 4px;
}
.flt-hud-pitch-bar.horizon {
  height: 2px; background: var(--a);
  box-shadow: 0 0 6px rgba(251,191,36,0.3);
}
.flt-hud-pitch-tag {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 9px; color: var(--a); letter-spacing: 0.04em;
  margin-top: 28px; white-space: nowrap;
}

/* ─── bottom data strip ─── */
.flt-hud-botstrip {
  position: absolute; bottom: 200px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 16px;
  font-size: 10px; color: var(--c); letter-spacing: 0.05em;
  background: rgba(8,20,30,0.35); padding: 2px 12px; border-radius: 3px;
  border: 1px solid rgba(125,211,252,0.15);
}
.flt-hud-bot-label { color: var(--d); margin-right: 3px; }
.flt-hud-bot-unit { font-size: 8px; color: var(--d); margin-left: 1px; }
.flt-hud-bot-callsign { color: var(--a); font-weight: 700; }

/* ─── V/S readout (bottom-left) ─── */
.flt-hud-vsreadout {
  position: absolute; bottom: 170px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: baseline; gap: 3px;
  font-size: 10px;
}
.flt-hud-vsreadout-label { color: var(--d); font-size: 9px; margin-right: 2px; }
.flt-hud-vsreadout-val { color: var(--a); font-weight: 700; font-size: 12px; }
.flt-hud-vsreadout-unit { color: var(--d); font-size: 8px; }

/* ─── CAS messages ─── */
.flt-hud-cas {
  position: absolute; top: 82px; right: 16px;
  display: flex; flex-direction: column; gap: 3px; max-width: 180px;
}
.flt-hud-cas-item {
  font-size: 9px; letter-spacing: 0.04em; padding: 2px 6px;
  border-radius: 2px; border-left: 2px solid;
}
.flt-hud-cas-item.info { color: #4ade80; border-color: #4ade80; background: rgba(74,222,128,0.08); }
.flt-hud-cas-item.warn { color: var(--a); border-color: var(--a); background: rgba(251,191,36,0.08); }
.flt-hud-cas-item.crit { color: var(--red); border-color: var(--red); background: rgba(239,68,68,0.08); }

/* ─── control deck ─── */
.flt-hud-deck {
  position: absolute; right: 14px; bottom: 14px; pointer-events: auto;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 10px; border-radius: 10px;
  background: rgba(8,20,30,0.5); border: 1px solid rgba(125,211,252,0.2);
  backdrop-filter: blur(4px);
}
.flt-hud-dpad {
  display: grid; grid-template-columns: repeat(3, 32px); grid-template-rows: repeat(3, 32px); gap: 3px;
}
.flt-hud-dbtn {
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(125,211,252,0.25); background: rgba(125,211,252,0.06);
  color: var(--c); border-radius: 6px; cursor: pointer;
  transition: background 0.1s ease, transform 0.04s ease;
  font-size: 12px;
}
.flt-hud-dbtn:hover { background: rgba(125,211,252,0.18); }
.flt-hud-dbtn:active { transform: scale(0.9); }
.flt-hud-dcenter { background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.35); }
.flt-hud-actions { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; max-width: 130px; }
.flt-hud-pill {
  display: inline-flex; align-items: center; gap: 3px; padding: 3px 6px;
  font-size: 9px; font-family: 'JetBrains Mono', monospace;
  border: 1px solid rgba(125,211,252,0.25); background: rgba(125,211,252,0.06);
  color: var(--c); border-radius: 4px; cursor: pointer; transition: background 0.1s ease;
}
.flt-hud-pill:hover { background: rgba(125,211,252,0.18); }
.flt-hud-exit { border-color: rgba(239,68,68,0.45); color: #fca5a5; }
.flt-hud-exit:hover { background: rgba(239,68,68,0.18); }
`;
