import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp, ArrowDown, RotateCcw, Scan, X, Rocket, Video, MapPin,
  Zap, Wind, Crosshair, Flame,
} from 'lucide-react';
import type { HeliState, HelicopterInput } from '@/rendering/helicopterSim';
import type { ControlSnapshot } from '@/rendering/heliControls';
import type { DeckPanel } from '@/rendering/cockpitAnchors';

export type HeliLookAction = 'up' | 'down' | 'left' | 'right' | 'reset' | 'cockpit' | 'external'
  | 'topdown' | 'zoomin' | 'zoomout' | 'chase' | 'orbit' | 'collup' | 'colldown' | 'thrup' | 'thrdown'
  | 'chase-close' | 'chase-wide';

export type HeliSwitch = 'engine' | 'hover' | 'turb' | 'trim' | 'friction' | 'battery' | 'master' | 'ecl';

interface HelicopterHudProps {
  hud: HeliState;
  input: HelicopterInput;
  mode: string;                    // 'external' | 'cockpit' | 'topdown'
  orbitMode?: boolean;             // external rig in classic free-orbit vs dynamic chase
  ctl?: ControlSnapshot | null;    // cockpit controls state machine snapshot
  onStarter?: (on: boolean) => void; // momentary starter switch (hold)
  deck?: React.MutableRefObject<Record<string, DeckPanel>> | null; // projected console anchors (cockpit)
  deckMode?: 'dom' | 'scene';       // 'scene' = live canvas instruments in-world (Phase 5)
  fps?: number;                     // smoothed render fps (perf readout)
  airframe?: string;                // active profile label (AH-64E APACHE / HELIDRIVE-X COMPOUND)
  fadeKey?: number;                 // bump on camera-mode change → crossfade flash
  hoverAssist?: boolean;
  turbulence?: boolean;
  latLabel?: string;
  lonLabel?: string;
  onLook: (a: HeliLookAction) => void;
  onCapture: () => void;
  onExit: () => void;
  onSwitch: (s: HeliSwitch) => void;
  /** absolute control input (collective / throttle lever positions) */
  onControl: (p: Partial<HelicopterInput>) => void;
  /** spring-loaded inputs (cyclic stick, pedals) — caller zeroes on release */
  onStick: (p: { pitch?: number; roll?: number; pedal?: number }) => void;
}

const VNE_DEFAULT = 150;

function compass(az: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

function utcClock(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

const C = { amber: '#fbbf24', green: '#4ade80', cyan: '#7dd3fc', red: '#ef4444', white: '#eef7f0', dim: '#94a3b8' };

/* ───────────────────────── interactive control widgets ───────────────────────── */

/** Vertical lever (collective / throttle) — drag anywhere on the track. */
function LeverBar({ value, onChange, label, color, accent, detents, locked }: {
  value: number; onChange: (v: number) => void; label: string; color: string; accent: string;
  detents?: { v: number; t: string }[]; locked?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (clientY: number) => {
    const el = ref.current; if (!el) return;
    if (locked) return;
    const r = el.getBoundingClientRect();
    onChange(Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height)));
  };
  return (
    <div className={`hxf-lever${locked ? ' locked' : ''}`} data-testid={`hxf-lever-${label}`}>
      <div
        className="hxf-lever-track" ref={ref}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); set(e.clientY); }}
        onPointerMove={(e) => { if (e.buttons) set(e.clientY); }}
      >
        <div className="hxf-lever-fill" style={{ height: `${value * 100}%`, background: color }} />
        {(detents ?? []).map((d) => (
          <span key={d.t} className="hxf-detent" style={{ bottom: `calc(${d.v * 100}% - 1px)` }} />
        ))}
        <div className="hxf-lever-knob" style={{ bottom: `calc(${value * 100}% - 6px)`, borderColor: locked ? '#64748b' : accent }} />
        {locked && <div className="hxf-lock" style={{ bottom: `calc(${value * 100}% - 13px)` }} />}
      </div>
      <div className="hxf-lever-label">{label}{locked ? '·LK' : ''}</div>
      <div className="hxf-lever-val" style={{ color: accent }}>{Math.round(value * 100)}%</div>
    </div>
  );
}

/** Horizontal spring-loaded pedal bar (-1..1). */
function PedalBar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (clientX: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    onChange(Math.min(1, Math.max(-1, ((clientX - r.left) / r.width) * 2 - 1)));
  };
  return (
    <div className="hxf-pedals">
      <div
        className="hxf-pedal-track" ref={ref} data-testid="hxf-pedals"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); set(e.clientX); }}
        onPointerMove={(e) => { if (e.buttons) set(e.clientX); }}
        onPointerUp={() => onChange(0)}
        onLostPointerCapture={() => onChange(0)}
      >
        <div className="hxf-pedal-center" />
        <div className="hxf-pedal-knob" style={{ left: `calc(${((value + 1) / 2) * 100}% - 7px)` }} />
      </div>
      <div className="hxf-lever-label">PEDALS</div>
    </div>
  );
}

/** Centre-springing cyclic stick pad. */
function CyclicPad({ pitch, roll, onMove }: { pitch: number; roll: number; onMove: (p: number, r: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (cx: number, cy: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((cx - r.left) / r.width) * 2 - 1;
    const y = ((cy - r.top) / r.height) * 2 - 1;
    const m = Math.hypot(x, y);
    const s = m > 1 ? 1 / m : 1;
    onMove(-y * s, x * s);          // stick forward (up) = +pitch input = nose down
  };
  return (
    <div className="hxf-cyclic">
      <div
        className="hxf-cyclic-pad" ref={ref} data-testid="hxf-cyclic"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); set(e.clientX, e.clientY); }}
        onPointerMove={(e) => { if (e.buttons) set(e.clientX, e.clientY); }}
        onPointerUp={() => onMove(0, 0)}
        onLostPointerCapture={() => onMove(0, 0)}
      >
        <div className="hxf-cyclic-h" /><div className="hxf-cyclic-v" />
        <div className="hxf-cyclic-knob"
          style={{ left: `calc(50% + ${roll * 34}px)`, top: `calc(50% - ${pitch * 34}px)` }} />
      </div>
      <div className="hxf-lever-label">CYCLIC</div>
    </div>
  );
}

/** Dual-bar flight pod: Pull Up/Down (collective), Acceleration (throttle), and 4-way Directional D-Pad */
export function DualLeverFlightPod({
  collective, throttle, locked, hoverDetent, onControl, onStick, onSwitch, hoverActive,
}: {
  collective: number;
  throttle: number;
  locked?: boolean;
  hoverDetent?: number;
  onControl: (p: Partial<HelicopterInput>) => void;
  onStick: (p: { pitch?: number; roll?: number; pedal?: number }) => void;
  onSwitch?: (s: HeliSwitch) => void;
  hoverActive?: boolean;
}) {
  const collTrackRef = useRef<HTMLDivElement>(null);
  const thrTrackRef = useRef<HTMLDivElement>(null);
  const activeStickRef = useRef<{ pitch: number; roll: number; pedal: number }>({ pitch: 0, roll: 0, pedal: 0 });

  const setCollectiveFromY = (clientY: number) => {
    const el = collTrackRef.current;
    if (!el || locked) return;
    const r = el.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height));
    onControl({ collective: v });
  };

  const setThrottleFromY = (clientY: number) => {
    const el = thrTrackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height));
    onControl({ throttle: v });
  };

  const pressDir = (dir: 'front' | 'back' | 'left' | 'right') => {
    if (dir === 'front') {
      activeStickRef.current.pitch = 1.0;
    } else if (dir === 'back') {
      activeStickRef.current.pitch = -1.0;
    } else if (dir === 'left') {
      activeStickRef.current.roll = -1.0;
    } else if (dir === 'right') {
      activeStickRef.current.roll = 1.0;
    }
    activeStickRef.current.pedal = 0;
    onStick({ ...activeStickRef.current });
  };

  const releaseDir = (dir: 'front' | 'back' | 'left' | 'right') => {
    if (dir === 'front' && activeStickRef.current.pitch > 0) {
      activeStickRef.current.pitch = 0;
    } else if (dir === 'back' && activeStickRef.current.pitch < 0) {
      activeStickRef.current.pitch = 0;
    } else if (dir === 'left' && activeStickRef.current.roll < 0) {
      activeStickRef.current.roll = 0;
    } else if (dir === 'right' && activeStickRef.current.roll > 0) {
      activeStickRef.current.roll = 0;
    }
    activeStickRef.current.pedal = 0;
    onStick({ ...activeStickRef.current });
  };

  return (
    <div className="hxf-dual-pod" data-testid="hxf-dual-pod">
      {/* ── BAR 1: PULL UP / DOWN (COLLECTIVE LIFT) ── */}
      <div className={`hxf-lever-col${locked ? ' locked' : ''}`} data-testid="hxf-lever-COL">
        <div className="hxf-lever-title">PULL UP/DN</div>
        <button
          type="button"
          className="hxf-btn-step"
          data-testid="btn-pull-up"
          title="Pull Up (Climb / Lift)"
          onClick={() => onControl({ collective: Math.min(1, collective + 0.1) })}
        >
          ▲ UP
        </button>
        <div
          className="hxf-lever-track"
          ref={collTrackRef}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setCollectiveFromY(e.clientY);
          }}
          onPointerMove={(e) => { if (e.buttons) setCollectiveFromY(e.clientY); }}
        >
          <div className="hxf-lever-fill" style={{ height: `${collective * 100}%`, background: '#4ade80' }} />
          {hoverDetent !== undefined && (
            <span className="hxf-detent" style={{ bottom: `calc(${hoverDetent * 100}% - 1px)` }} title="Hover Detent" />
          )}
          <div className="hxf-lever-knob" style={{ bottom: `calc(${collective * 100}% - 6px)`, borderColor: locked ? '#64748b' : '#4ade80' }} />
          {locked && <div className="hxf-lock" style={{ bottom: `calc(${collective * 100}% - 13px)` }} />}
        </div>
        <button
          type="button"
          className="hxf-btn-step"
          data-testid="btn-pull-down"
          title="Pull Down (Descend / Sink)"
          onClick={() => onControl({ collective: Math.max(0, collective - 0.1) })}
        >
          ▼ DN
        </button>
        <div className="hxf-lever-val" style={{ color: '#4ade80' }}>{Math.round(collective * 100)}%</div>
      </div>

      {/* ── BAR 2: ACCELERATION (THROTTLE) ── */}
      <div className="hxf-lever-col" data-testid="hxf-lever-THR">
        <div className="hxf-lever-title">ACCEL</div>
        <button
          type="button"
          className="hxf-btn-step"
          data-testid="btn-accel-up"
          title="Accelerate (Forward Throttle)"
          onClick={() => onControl({ throttle: Math.min(1, throttle + 0.1) })}
        >
          ▲ ACC
        </button>
        <div
          className="hxf-lever-track"
          ref={thrTrackRef}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setThrottleFromY(e.clientY);
          }}
          onPointerMove={(e) => { if (e.buttons) setThrottleFromY(e.clientY); }}
        >
          <div className="hxf-lever-fill" style={{ height: `${throttle * 100}%`, background: '#fbbf24' }} />
          <div className="hxf-lever-knob" style={{ bottom: `calc(${throttle * 100}% - 6px)`, borderColor: '#fbbf24' }} />
        </div>
        <button
          type="button"
          className="hxf-btn-step"
          data-testid="btn-accel-down"
          title="Decelerate (Reduce Throttle)"
          onClick={() => onControl({ throttle: Math.max(0, throttle - 0.1) })}
        >
          ▼ DEC
        </button>
        <div className="hxf-lever-val" style={{ color: '#fbbf24' }}>{Math.round(throttle * 100)}%</div>
      </div>

      {/* ── 4-WAY DIRECTIONAL ARROW D-PAD ── */}
      <div className="hxf-dpad" data-testid="hxf-dpad">
        <div className="hxf-dpad-row top">
          <button
            type="button"
            className="hxf-dpad-btn front"
            data-testid="hxf-dpad-front"
            title="Move FRONT (Forward flight)"
            onPointerDown={(e) => { pressDir('front'); try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {} }}
            onPointerUp={() => releaseDir('front')}
            onPointerCancel={() => releaseDir('front')}
          >
            ▲ FRONT
          </button>
        </div>
        <div className="hxf-dpad-row mid">
          <button
            type="button"
            className="hxf-dpad-btn left"
            data-testid="hxf-dpad-left"
            title="Move LEFT (Turn & bank left)"
            onPointerDown={(e) => { pressDir('left'); try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {} }}
            onPointerUp={() => releaseDir('left')}
            onPointerCancel={() => releaseDir('left')}
          >
            ◀ LEFT
          </button>
          <button
            type="button"
            className={`hxf-dpad-btn hover${hoverActive ? ' active' : ''}`}
            data-testid="hxf-dpad-hover"
            title="Toggle Hover Assist"
            onClick={() => onSwitch?.('hover')}
          >
            ● HVR
          </button>
          <button
            type="button"
            className="hxf-dpad-btn right"
            data-testid="hxf-dpad-right"
            title="Move RIGHT (Turn & bank right)"
            onPointerDown={(e) => { pressDir('right'); try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {} }}
            onPointerUp={() => releaseDir('right')}
            onPointerCancel={() => releaseDir('right')}
          >
            ▶ RIGHT
          </button>
        </div>
        <div className="hxf-dpad-row bot">
          <button
            type="button"
            className="hxf-dpad-btn back"
            data-testid="hxf-dpad-back"
            title="Move BACK (Flare / Pitch aft)"
            onPointerDown={(e) => { pressDir('back'); try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {} }}
            onPointerUp={() => releaseDir('back')}
            onPointerCancel={() => releaseDir('back')}
          >
            ▼ BACK
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── HUD ───────────────────────── */

/**
 * AH-64E style instrument layout, properly zoned:
 *   top      — feed bar + heading tape + annunciators
 *   centre   — attitude / flight-director with roll scale
 *   left     — airspeed tape + VSI, engine & fuel quadrant
 *   right    — altimeter tape + radar alt, systems & cameras
 *   bottom   — interactive cockpit controls (cyclic · collective · throttle · pedals)
 * External / top-down modes keep the globe clear with a compact dock that
 * carries the SAME controls, so you can fly with mouse alone.
 */
export function HelicopterHud({
  hud, input, mode, hoverAssist, turbulence, latLabel, lonLabel, orbitMode, ctl, onStarter, deck, deckMode,
  fps, airframe, fadeKey,
  onLook, onCapture, onExit, onSwitch, onControl, onStick,
}: HelicopterHudProps) {
  const VNE_KTS = hud.vneKts || VNE_DEFAULT;
  const [clock, setClock] = useState(utcClock());
  const [showControls, setShowControls] = useState(false);
  useEffect(() => { const id = setInterval(() => setClock(utcClock()), 1000); return () => clearInterval(id); }, []);

  const deckRootRef = useRef<HTMLDivElement>(null);
  const avnDarkRef = useRef(false);
  const REF: Record<string, [number, number]> = { diuLeft: [208, 228], diuRight: [208, 228], ddu: [240, 122], stbyAdi: [104, 104] };
  useEffect(() => {
    // The production cockpit uses a fixed glass deck.  It avoids coupling the
    // readable panel layout to the imported model's inconsistent node axes.
    if (mode !== 'cockpit' || deckMode !== 'scene') return;
    let raf = 0;
    const tick = () => {
      const root = deckRootRef.current;
      const D = deck?.current;
      if (root) {
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-deck-id]'))) {
          const id = el.dataset.deckId as string;
          const p = D?.[id];
          const needAvn = el.dataset.needAvn === '1';
          if (!p || !p.vis || (needAvn && avnDarkRef.current)) { el.style.opacity = '0'; continue; }
          const [rw, rh] = REF[id] ?? [200, 200];
          const sc = Math.min(p.w / rw, p.h / rh);
          el.style.opacity = '1';
          el.style.transform = `translate(-50%, -50%) translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) rotate(${p.skew.toFixed(3)}rad)`;
          const inner = el.firstElementChild as HTMLElement | null;
          if (inner) inner.style.transform = `scale(${sc.toFixed(3)})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // deck is a stable ref container; REF is a render-invariant map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deckMode]);

  const avnDark = ctl ? !ctl.avionicsMaster : false;
  useEffect(() => { avnDarkRef.current = avnDark; });
  const heading = hud.headingDeg;
  const pitch = hud.pitchDeg;
  const roll = hud.rollDeg;
  const altFt = hud.altM * 3.28084;
  const ra = hud.aglM * 3.28084;
  const ias = Math.round(hud.iasKts);
  const vs = hud.vsFpm;
  const rpm = Math.round(hud.rotorRpm);
  const torque = Math.round(hud.torquePct);
  const coll = Math.round(hud.collective * 100);
  const tas = Math.round(hud.tasKts);
  const gs = Math.round(hud.gsKts);
  const ng = Math.round(hud.ngPct);
  const ct = (hud.torqueCoeff * 1000).toFixed(1);
  const shp = Math.round(hud.powerShp);
  const windKt = Math.round(Math.hypot(hud.windE, hud.windN) * 1.94384);
  const rates = `${hud.pitchRateDps >= 0 ? '+' : ''}${hud.pitchRateDps.toFixed(0)}/${hud.rollRateDps >= 0 ? '+' : ''}${hud.rollRateDps.toFixed(0)}/${hud.yawRateDps >= 0 ? '+' : ''}${hud.yawRateDps.toFixed(0)}°/s`;
  const thr = Math.round(input.throttle * 100);
  const fuelPct = Math.round((hud.fuelKg / Math.max(1, hud.fuelMaxKg)) * 100);

  const annun: { tag: string; on: boolean; color: string }[] = [
    { tag: 'RLM', on: rpm < 90 && hud.engine, color: C.red },          // rotor low
    { tag: hud.engine ? 'ENG' : 'ENG OUT', on: !hud.engine, color: C.red },
    { tag: `TORQ${torque > 95 ? '!' : ''}`, on: torque > 95, color: C.red },
    { tag: 'VNE', on: hud.iasKts > VNE_KTS - 5, color: C.red },
    { tag: 'FUEL', on: fuelPct < 15, color: fuelPct < 6 ? C.red : C.amber },
    { tag: 'SINK RATE', on: vs < -1500 && hud.aglM * 3.28084 < 120 && hud.aglM > 0.5, color: C.red },
    { tag: 'VRS', on: hud.vrs, color: C.red },
    { tag: 'ETL', on: hud.etlPct > 85 && !hud.onGround, color: C.green },
    { tag: 'TRT', on: hud.ttDriftMps < -0.8 && !hud.onGround && hud.engine && hud.gsKts < 25, color: C.amber },
    { tag: hoverAssist ? 'HVR·ASSIST' : 'HVR', on: !!hoverAssist, color: C.green },
    { tag: turbulence ? 'TURB' : '', on: !!turbulence, color: C.amber },
    ...(ctl ? [
      { tag: ctl.avionicsMaster ? '' : 'AVN OFF', on: !ctl.avionicsMaster, color: C.amber },
      { tag: ctl.generatorOnline ? '' : 'ALT', on: !ctl.generatorOnline && ctl.battery, color: C.amber },
      { tag: ctl.engineState === 'STARTING' ? 'START' : '', on: ctl.engineState === 'STARTING', color: C.cyan },
      { tag: ctl.engineState === 'OFF' ? 'ENGINE OFF' : '', on: ctl.engineState === 'OFF', color: C.red },
    ].filter((a) => a.tag) : []),
  ].filter((a) => a.tag);

  /* ── shared interactive control panel (cockpit bottom + external dock) ── */
  const collVal = ctl?.collective ?? input.collective;
  const thrVal = ctl?.throttle ?? input.throttle;
  const controls = (
    <div className="hxf-controls" data-testid="hxf-controls">
      <CyclicPad pitch={input.pitch} roll={input.roll} onMove={(p, r) => onStick({ pitch: p, roll: r })} />
      <LeverBar
        value={collVal} onChange={(v) => onControl({ collective: v })} label="COL"
        color="rgba(74,222,128,0.5)" accent={C.green}
        detents={ctl ? [{ v: ctl.hoverDetent, t: 'HVR' }, { v: 1, t: 'MAX' }] : undefined}
        locked={ctl?.collectiveLocked}
      />
      <LeverBar value={thrVal} onChange={(v) => onControl({ throttle: v })} label="THR" color="rgba(251,191,36,0.5)" accent={C.amber} />
      <PedalBar value={input.pedal} onChange={(v) => onStick({ pedal: v })} />
    </div>
  );

  const systems = (
    <div className="hxf-systems">
      <div className="hxf-sys-title">SYSTEMS</div>
      <div className="hxf-swatch-row">
        <button data-testid="hxf-sw-engine" className={`hxf-sw ${hud.engine ? 'on' : ''}`} onClick={() => onSwitch('engine')}>
          <Flame size={11} /> ENGINE {hud.engine ? 'RUN' : 'OFF'}
        </button>
        <button data-testid="hxf-sw-hover" className={`hxf-sw ${hoverAssist ? 'on' : ''}`} onClick={() => onSwitch('hover')}>
          <Crosshair size={11} /> HOVER
        </button>
        <button data-testid="hxf-sw-turb" className={`hxf-sw ${turbulence ? 'on' : ''}`} onClick={() => onSwitch('turb')}>
          <Wind size={11} /> TURB
        </button>
        <button data-testid="hxf-sw-trim" className="hxf-sw" onClick={() => onSwitch('trim')}>
          <Zap size={11} /> TRIM
        </button>
        <button data-testid="hxf-sw-sticks" className={`hxf-sw ${showControls ? 'on' : ''}`} onClick={() => setShowControls(c => !c)}>
          <Crosshair size={11} /> STICK {showControls ? 'ON' : 'OFF'}
        </button>
      </div>
      <div className="hxf-sys-title">CAMERAS</div>
      <div className="hxf-swatch-row">
        <button data-testid="hxf-sw-chase" className={`hxf-sw ${mode === 'chase-close' || (mode === 'external' && !orbitMode) ? 'on' : ''}`} onClick={() => onLook('chase-close')}><Video size={11} /> CLOSE</button>
        <button data-testid="hxf-sw-wide" className={`hxf-sw ${mode === 'chase-wide' ? 'on' : ''}`} onClick={() => onLook('chase-wide')}><Scan size={11} /> WIDE</button>
        <button data-testid="hxf-sw-orbit" className={`hxf-sw ${orbitMode ? 'on' : ''}`} onClick={() => onLook('orbit')}><RotateCcw size={11} /> ORB</button>
        <button data-testid="hxf-sw-cpit" className={`hxf-sw ${mode === 'cockpit' ? 'on' : ''}`} onClick={() => onLook('cockpit')}><Rocket size={11} /> CPIT</button>
        <button className={`hxf-sw ${mode === 'topdown' ? 'on' : ''}`} onClick={() => onLook('topdown')}><MapPin size={11} /> TOP</button>
        {ctl && (
          <>
            <div className="hxf-sys-title" style={{ marginTop: 6 }}>TACTICAL · ECL {['CUTOFF', 'IDLE', 'FLIGHT'][ctl.ecl]}</div>
            <div className="hxf-swatch-row" data-testid="hxf-tactical">
              <button data-testid="hxf-ecl" className={`hxf-sw ${ctl.ecl > 0 ? 'on' : ''}`} onClick={() => onSwitch('ecl')}>ECL·{['CUT', 'IDL', 'FLT'][ctl.ecl]}</button>
              <button data-testid="hxf-starter" className={`hxf-sw ${ctl.starterEngaged ? 'on' : ''}`}
                onPointerDown={(e) => { try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ } onStarter?.(true); }}
                onPointerUp={() => onStarter?.(false)}
                onPointerCancel={() => onStarter?.(false)}
              >START</button>
              <button data-testid="hxf-fric" className={`hxf-sw ${ctl.collectiveLocked ? 'on' : ''}`} onClick={() => onSwitch('friction')}>FRIC</button>
              <button data-testid="hxf-batt" className={`hxf-sw ${ctl.battery ? 'on' : ''}`} onClick={() => onSwitch('battery')}>BATT</button>
              <button data-testid="hxf-avn" className={`hxf-sw ${ctl.avionicsMaster ? 'on' : ''}`} onClick={() => onSwitch('master')}>AVN</button>
              <span className={`hxf-sw ${ctl.generatorOnline ? 'on' : ''}`} style={{ cursor: 'default' }}>GEN</span>
            </div>
          </>
        )}
        <button className="hxf-sw" onClick={() => onLook('zoomin')}>+</button>
        <button className="hxf-sw" onClick={() => onLook('zoomout')}>−</button>
        <button className="hxf-sw" onClick={() => onLook('reset')}><RotateCcw size={11} /> RST</button>
        <button className="hxf-sw" onClick={onCapture}><Scan size={11} /> CAP</button>
        <button className="hxf-sw exit" onClick={onExit}><X size={11} /> EXIT</button>
        <button data-testid="hxf-thr-up" className="hxf-sw" onClick={() => onLook('thrup')}><ArrowUp size={11} /> THR</button>
        <button data-testid="hxf-thr-down" className="hxf-sw" onClick={() => onLook('thrdown')}>THR <ArrowDown size={11} /></button>
        <button className="hxf-sw" onClick={() => onLook('collup')}><ArrowUp size={11} /> COL</button>
        <button className="hxf-sw" onClick={() => onLook('colldown')}>COL <ArrowDown size={11} /></button>
      </div>
    </div>
  );

  const avnOff = ctl ? !ctl.avionicsMaster : false;
  const engineGauges = (
    <div className="hxf-engine">
      {avnOff && <div className="hxf-dark" data-testid="hxf-avn-dark">AVIONICS OFF — STANDBY ONLY</div>}
      <div className="hxf-sys-title">ENGINE · T700-701D</div>
      <div className="hxf-eng-row"><span>TRQ</span><b style={{ color: torque > 95 ? C.red : C.white }}>{torque}%</b><i className="hxf-bar"><u style={{ width: `${Math.min(100, torque)}%`, background: torque > 95 ? C.red : C.cyan }} /></i></div>
      <div className="hxf-eng-row"><span>Nf</span><b style={{ color: rpm < 90 ? C.red : C.white }}>{rpm}%</b><i className="hxf-bar"><u style={{ width: `${Math.min(100, rpm)}%`, background: rpm < 90 ? C.red : C.green }} /></i></div>
      <div className="hxf-eng-row"><span>Ng</span><b style={{ color: ng < 60 ? C.red : C.white }}>{ng}%</b><i className="hxf-bar"><u style={{ width: `${Math.min(100, ng)}%`, background: ng < 60 ? C.red : C.green }} /></i></div>
      <div className="hxf-eng-row"><span>CT</span><b>{ct}×</b><i className="hxf-bar"><u style={{ width: `${Math.min(100, hud.torqueCoeff * 12000)}%`, background: C.amber }} /></i></div>
      <div className="hxf-eng-row"><span>SHP</span><b>{shp.toLocaleString()}</b><i className="hxf-bar"><u style={{ width: `${Math.min(100, shp / 38)}%`, background: C.cyan }} /></i></div>
      <div className="hxf-eng-row"><span>COL</span><b>{coll}%</b><i className="hxf-bar"><u style={{ width: `${coll}%`, background: C.green }} /></i></div>
      <div className="hxf-eng-row"><span>THR</span><b>{thr}%</b><i className="hxf-bar"><u style={{ width: `${thr}%`, background: C.amber }} /></i></div>
      <div className="hxf-eng-row"><span>FUEL</span><b style={{ color: fuelPct < 15 ? C.red : C.white }}>{fuelPct}%</b><i className="hxf-bar"><u style={{ width: `${fuelPct}%`, background: fuelPct < 15 ? C.red : C.cyan }} /></i></div>
    </div>
  );

  /* ── attitude ladder for the DIU ── */
  const pitchLines: number[] = [];
  for (let d = Math.floor((pitch - 30) / 5) * 5; d <= pitch + 30; d += 5) {
    if (Math.abs(d) <= 90 && d % 5 === 0) pitchLines.push(d);
  }

  /* ── EXTERNAL / TOP-DOWN: compact dock, globe stays clear ── */
  if (mode !== 'cockpit') {
    return (
      <div className="hxdock">
        {!!fadeKey && <div key={`d${fadeKey}`} className="hxf-dockflash" />}
        <div className="hxdock-inner">
          <div className="hxdock-telem">
            <span className="hxdock-chip hxdock-title"><Rocket size={11} /> {airframe ?? 'AH-64E'} · {mode === 'topdown' ? 'TACTICAL' : mode === 'chase-wide' ? 'WIDE CHASE' : 'CLOSE CHASE'}</span>
            {!!fps && <span className="hxdock-chip" data-testid="hxf-fps"><i>FPS</i><b style={{ color: fps < 30 ? '#fbbf24' : '#4ade80' }}>{fps}</b></span>}
            <span className="hxdock-chip"><i>HDG</i><b>{Math.round(heading)}°</b></span>
            <span className="hxdock-chip"><i>IAS</i><b style={{ color: ias > VNE_KTS - 5 ? C.red : undefined }}>{ias}kt</b></span>
            <span className="hxdock-chip"><i>GS</i><b>{gs}kt</b></span>
            <span className="hxdock-chip"><i>ALT</i><b>{Math.round(altFt).toLocaleString()}ft</b></span>
            <span className="hxdock-chip"><i>RA</i><b>{Math.round(ra).toLocaleString()}</b></span>
            <span className="hxdock-chip"><i>V/S</i><b style={{ color: vs < -1500 ? C.red : C.dim }}>{vs > 0 ? `+${Math.round(vs)}` : Math.round(vs)}</b></span>
            <span className="hxdock-chip"><i>Nf</i><b style={{ color: rpm < 90 ? C.red : C.green }}>{rpm}%</b></span>
            {annun.filter((a) => a.on).map((a) => (
              <span key={a.tag} className="hxdock-chip hxdock-warn" style={{ color: a.color }}>{a.tag}</span>
            ))}
          </div>
          <div className="hxdock-flight-row">
            <DualLeverFlightPod
              collective={collVal}
              throttle={thrVal}
              locked={ctl?.collectiveLocked}
              hoverDetent={ctl?.hoverDetent}
              onControl={onControl}
              onStick={onStick}
              onSwitch={onSwitch}
              hoverActive={hoverAssist}
            />
            {systems}
          </div>
          {showControls && controls}
          <div className="hxdock-hint">
            ↑ FRONT · ↓ BACK · ← LEFT · → RIGHT · W/S collective · A/D accel · Q/E pedals · C cockpit · V cycle view · Space hover · Esc exit
          </div>
        </div>
        <style>{css}</style>
      </div>
    );
  }

  /* ── COCKPIT: full instrument HUD ── */
  return (
    <div className="hxhud hxf">
      <div className="hxf-scan" />
      <div className="hxf-vignette" />
      {!!fadeKey && <div key={fadeKey} className="hxf-modeflash" data-testid="hxf-flash" />}

      <div className="hxf-topbar">
        <span className="hxf-feed"><Video size={11} /> {airframe ?? 'AH-64E APACHE'} · IHSS</span>
        <span className="hxf-rec" />
        <span className="hxf-clock">{clock}</span>
        <span className="hxf-modes">
          {hud.onGround ? <span className="hxf-tag ground">ON GROUND</span> : null}
          <span className="hxf-tag">{mode.toUpperCase()}</span>
        </span>
      </div>

      {/* ── collimated flight HUD reticle (Apache IHADSS symbology centered on windshield) ── */}
      <div className="hxf-ihadss" data-testid="hxf-ihadss">
        <div className="hxf-reticle-cross" />
        <div className="hxf-reticle-ring" />
        <div className="hxf-hud-fpm" style={{ transform: `translate(${(hud.sideslipDeg || 0) * 3}px, ${(pitch - vs / 120) * 2.5}px)` }}>
          <span className="hxf-fpm-o" /><span className="hxf-fpm-l" /><span className="hxf-fpm-r" /><span className="hxf-fpm-u" />
        </div>
        <div className="hxf-hud-horizon" style={{ transform: `translateY(${pitch * 3.5}px) rotate(${roll}deg)` }}>
          <div className="hxf-hz-l" /><div className="hxf-hz-gap" /><div className="hxf-hz-r" />
        </div>
      </div>

      {/* ── console-pinned deck (grounded to bottom glareshield; see cockpitAnchors + rAF loop) ── */}
      <div className="hxf-glassfx" />
      <div className="hxf-deck" ref={deckRootRef} data-testid="hxf-deck" data-deck-mode={deckMode ?? 'dom'}>
        <div className="hxf-diu" data-deck-id="diuLeft" data-need-avn="1" data-testid="deck-diuLeft">
          <div className="hxf-diu-in">
            <div className="hxf-diu-cap">DIU 1 · ATT</div>
            <div className="hxf-att hxf-att-di">
              <div className="hxf-att-sky" /><div className="hxf-att-ground" />
              {pitchLines.filter((deg) => deg % 10 === 0).map((deg) => (
                <div key={deg} className="hxf-pl" style={{ top: `calc(50% + ${(deg - pitch) * 2.4}px)` }}>
                  <span className="hxf-pl-num">{deg === 0 ? '' : Math.abs(deg)}</span>
                  <span className={`hxf-pl-bar ${deg === 0 ? 'hz' : ''}`} />
                  <span className="hxf-pl-num">{deg === 0 ? '' : Math.abs(deg)}</span>
                </div>
              ))}
              <div className="hxf-fpm" style={{ top: `calc(50% + ${(pitch - vs / 100) * 2.4}px)` }}><i /><u /><i /></div>
              <div className="hxf-att-symbol"><b /><b className="l" /><b className="r" /></div>
              <div className="hxf-roll-arc">
                {[-40, -30, -20, -10, 0, 10, 20, 30, 40].map((d) => (
                  <span key={d} className={`hxf-rk ${d === 0 ? 'maj' : ''}`} style={{ transform: `rotate(${d}deg)` }} />
                ))}
                <span className="hxf-r-pointer" style={{ transform: `rotate(${roll}deg)` }} />
              </div>
            </div>
            <div className="hxf-di-rate">{rates}</div>
          </div>
        </div>
        <div className="hxf-diu" data-deck-id="diuRight" data-need-avn="1" data-testid="deck-diuRight">
          <div className="hxf-diu-in">
            <div className="hxf-diu-cap">DIU 2 · HSI</div>
            <div className="hxf-rose-wrap">
              <div className="hxf-rose-lubber" />
              <div className="hxf-rose-ring" />
              <div className="hxf-rose" style={{ transform: `rotate(${-heading}deg)` }}>
                {Array.from({ length: 36 }, (_, i) => i * 10).map((d) => (
                  <span key={d} className={`hxf-rk ${d % 90 === 0 ? 'maj' : d % 30 === 0 ? 'med' : ''}`} style={{ transform: `rotate(${d}deg)` }}>
                    {d % 90 === 0 && <em style={{ transform: `translateX(-50%) rotate(${-d + heading}deg)` }}>{d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : 'W'}</em>}
                  </span>
                ))}
              </div>
              <div className="hxf-rose-plane" />
              <div className="hxf-rose-trk" style={{ transform: `rotate(${heading - (heading - hud.sideslipDeg)}deg)` }} />
            </div>
            <div className="hxf-hdg-digital">{String(Math.round(heading)).padStart(3, '0')}° {compass(heading)}</div>
            <div className="hxf-slip">β{hud.sideslipDeg >= 0 ? '+' : ''}{hud.sideslipDeg.toFixed(0)}</div>
          </div>
        </div>
        <div className="hxf-ddu" data-deck-id="ddu" data-need-avn="1" data-testid="deck-ddu">
          <div className="hxf-ddu-in">
            <div className="hxf-diu-cap">DDU · ENGINE / AIR DATA</div>
            <div className="hxf-ddu-grid">
              <span><i>IAS</i><b style={{ color: ias > VNE_KTS - 5 ? C.red : C.white }}>{ias}</b>kt</span>
              <span><i>TAS</i><b>{tas}</b>kt</span>
              <span><i>GS</i><b>{gs}</b>kt</span>
              <span><i>V/S</i><b style={{ color: vs < -1500 ? C.red : undefined }}>{vs > 0 ? `+${Math.round(vs)}` : Math.round(vs)}</b></span>
              <span><i>ALT</i><b>{Math.round(altFt).toLocaleString()}</b>ft</span>
              <span data-testid="hxf-ra"><i>RA</i><b>{Math.round(ra).toLocaleString()}</b></span>
              <span><i>TRQ</i><b style={{ color: torque > 95 ? C.red : undefined }}>{torque}%</b></span>
              <span><i>Nf</i><b style={{ color: rpm < 90 ? C.red : undefined }}>{rpm}%</b></span>
              <span><i>Ng</i><b>{ng}%</b></span>
              <span><i>CT</i><b>{ct}‰</b></span>
              <span><i>SHP</i><b>{shp.toLocaleString()}</b></span>
              <span><i>WIND</i><b>{windKt}kt/{String(Math.round(hud.windFromDeg)).padStart(3, '0')}</b></span>
            </div>
          </div>
        </div>
        <div className="hxf-stby" data-deck-id="stbyAdi" data-testid="deck-stby">
          <div className="hxf-stby-pod">
            <div className="hxf-stby-in">
              <div className="hxf-stby-bezel-ring" />
              <div className="hxf-stby-face" style={{ transform: `rotate(${-roll}deg)` }}>
                <div className="hxf-stby-sky" style={{ top: `calc(50% + ${pitch * 1.6}px - 55%)` }} />
                <div className="hxf-stby-gnd" style={{ top: `calc(50% + ${pitch * 1.6}px)` }} />
                <div className="hxf-stby-hz" />
                <div className="hxf-stby-pitch-lines">
                  <span className="p10-up" />
                  <span className="p10-dn" />
                </div>
              </div>
              <div className="hxf-stby-wing" />
              <div className="hxf-stby-cage" />
            </div>
          </div>
        </div>
      </div>

      <div className="hxf-annun">
        {annun.map((a) => (
          <span key={a.tag} className="hxf-annun-chip" style={{ color: a.on ? '#0b1420' : 'rgba(148,163,184,0.35)', background: a.on ? a.color : 'transparent', borderColor: a.on ? a.color : 'rgba(148,163,184,0.2)' }}>{a.tag}</span>
        ))}
      </div>

      {engineGauges}
      {systems}
      <div className="hxf-strip" data-testid="hxf-strip">
        <span><i>SPD</i>{ias}kt</span>
        <span><i>ALT</i>{Math.round(altFt).toLocaleString()}ft</span>
        <span><i>HDG</i>{String(Math.round(heading)).padStart(3, '0')}°</span>
        <span><i>POS</i>{latLabel ?? hud.lat.toFixed(3)}, {lonLabel ?? hud.lon.toFixed(3)}</span>
      </div>
      <div className="hxf-cockpit-quadrant" data-testid="hxf-cockpit-controls">
        <div className="hxf-quad-title">FLIGHT CONTROLS</div>
        <DualLeverFlightPod
          collective={collVal}
          throttle={thrVal}
          locked={ctl?.collectiveLocked}
          hoverDetent={ctl?.hoverDetent}
          onControl={onControl}
          onStick={onStick}
          onSwitch={onSwitch}
          hoverActive={hoverAssist}
        />
      </div>
      <div className="hxf-bottom">{controls}</div>

      <style>{css}</style>
    </div>
  );
}

/* ═══════════════════════════ styles ═══════════════════════════ */
const css = `
.hxf {
  position: absolute; top: 60px; bottom: 38px; left: 0; right: 0; z-index: 240;
  pointer-events: none; font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: var(--c, #7dd3fc); overflow: hidden;
  --g: #4ade80; --c: #7dd3fc; --a: #fbbf24; --w: #eef7f0; --d: #94a3b8; --r: #ef4444;
}
.hxf button { pointer-events: auto; font-family: inherit; }
.hxf-scan { position: absolute; inset: 0; z-index: 0; opacity: .35; pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgba(74,222,128,.04) 0 1px, transparent 1px 4px); }
.hxf-vignette { position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: radial-gradient(ellipse at 50% 42%, transparent 52%, rgba(0,0,0,.55) 100%); }

.hxf-topbar { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); display: flex;
  align-items: center; gap: 12px; font-size: 10px; letter-spacing: .06em;
  background: rgba(8,20,30,.55); border: 1px solid rgba(125,211,252,.2); padding: 3px 12px; border-radius: 4px; }
.hxf-feed { display: flex; gap: 5px; align-items: center; color: var(--g); font-weight: 700; }
.hxf-rec { width: 6px; height: 6px; border-radius: 50%; background: var(--r); animation: hxfRec 1.2s infinite; }
@keyframes hxfRec { 0%,100%{opacity:1} 50%{opacity:.25} }
.hxf-clock { color: var(--a); }
.hxf-modes { display: flex; gap: 5px; }
.hxf-tag { border: 1px solid rgba(251,191,36,.35); color: var(--a); padding: 0 4px; border-radius: 2px; }
.hxf-tag.ground { border-color: rgba(148,163,184,.4); color: var(--d); }

/* heading tape */
.hxf-hdg { position: absolute; top: 34px; left: 50%; transform: translateX(-50%);
  width: min(440px, 62vw); height: 24px; overflow: hidden;
  border-top: 1px solid rgba(125,211,252,.35); border-bottom: 1px solid rgba(125,211,252,.35);
  background: rgba(8,20,30,.35); }
.hxf-hdg-track { position: absolute; inset: 0; }
.hxf-h-tick { position: absolute; top: 0; height: 100%; transform: translateX(-50%); }
.hxf-h-mark { display: block; width: 1px; height: 5px; background: rgba(125,211,252,.5); margin: 1px auto 0; }
.hxf-h-tick.major .hxf-h-mark { height: 9px; background: var(--a); }
.hxf-h-label { position: absolute; top: 11px; left: 50%; transform: translateX(-50%); font-size: 8.5px; color: var(--a); }
.hxf-h-pointer { position: absolute; top: -3px; left: 50%; transform: translateX(-50%); width: 0; height: 0;
  border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 7px solid var(--c); }
.hxf-h-digital { position: absolute; top: 26px; left: 50%; transform: translateX(-50%); font-size: 10px; color: var(--c);
  background: rgba(8,20,30,.6); padding: 0 6px; border-radius: 2px; white-space: nowrap; }

/* annunciators */
.hxf-annun { position: absolute; top: 58px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 5px; max-width: 70vw; flex-wrap: wrap; justify-content: center; }
.hxf-annun-chip { font-size: 8.5px; letter-spacing: .08em; padding: 1px 6px; border: 1px solid; border-radius: 2px; }

/* attitude */
.hxf-att-wrap { position: absolute; top: 46%; left: 50%; transform: translate(-50%, -50%); }
.hxf-att { position: relative; width: 250px; height: 200px; overflow: hidden;
  border: 1px solid rgba(74,222,128,.18); border-radius: 6px; background: rgba(2,10,16,.25); }
.hxf-att-sky { position: absolute; inset: -60% 0 50% 0; background: linear-gradient(#0a2c46, #10476b); }
.hxf-att-ground { position: absolute; inset: 50% 0 -60% 0; background: linear-gradient(#231a0d, #3c2c14); }
.hxf-pl { position: absolute; left: 0; right: 0; height: 0; display: flex; align-items: center; gap: 5px; transform: translateY(-50%); }
.hxf-pl-bar { flex: 1; height: 1px; background: rgba(200,230,255,.4); max-width: 74px; margin: 0 auto; }
.hxf-pl-bar.hz { height: 2px; background: var(--a); box-shadow: 0 0 6px rgba(251,191,36,.4); }
.hxf-pl-num { width: 22px; text-align: center; font-size: 8.5px; color: rgba(230,245,255,.8); }
.hxf-att-symbol { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 90px; height: 16px; }
.hxf-att-symbol b { position: absolute; top: 0; width: 26px; height: 3px; background: var(--g); box-shadow: 0 0 5px rgba(74,222,128,.7); }
.hxf-att-symbol b:first-child { left: 50%; transform: translateX(-50%); width: 8px; height: 8px; top: -3px; border-radius: 50%; background: transparent; border: 2px solid var(--g); }
.hxf-att-symbol b.l { left: 0; } .hxf-att-symbol b.r { right: 0; }
.hxf-fpm { position: absolute; left: 50%; transform: translate(-50%,-50%); display: flex; align-items: center; gap: 2px; opacity: .85; }
.hxf-fpm i { width: 0; height: 0; border: 5px solid transparent; border-top-color: var(--g); }
.hxf-fpm u { width: 8px; height: 2px; background: var(--g); }
.hxf-roll-arc { position: absolute; top: 0; left: 50%; width: 0; height: 0; }
.hxf-rk { position: absolute; left: -0.5px; top: 4px; width: 1px; height: 7px; background: rgba(200,230,255,.55); transform-origin: 0.5px 78px; }
.hxf-rk.maj { height: 10px; background: var(--w); }
.hxf-r-pointer { position: absolute; left: -5px; top: 12px; width: 0; height: 0; transform-origin: 5px 70px;
  border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 8px solid var(--w); }
.hxf-att-read { text-align: center; font-size: 9px; color: var(--d); margin-top: 3px; letter-spacing: .08em; }

/* side tapes */
.hxf-tape { position: absolute; top: 50%; transform: translateY(-54%); width: 86px; display: flex; flex-direction: column; align-items: center; }
.hxf-tape.l { left: 14px; } .hxf-tape.r { right: 14px; }
.hxf-tape-head { font-size: 20px; font-weight: 800; color: var(--w); text-shadow: 0 0 8px rgba(125,211,252,.35);
  background: rgba(8,20,30,.6); border: 1px solid rgba(125,211,252,.25); border-radius: 4px; padding: 0 7px; margin-bottom: 3px; }
.hxf-tape-head em { font-size: 9px; color: var(--c); font-style: normal; margin-left: 2px; }
.hxf-tape-body { position: relative; width: 100%; height: 210px; overflow: hidden;
  background: rgba(8,20,30,.3); border: 1px solid rgba(125,211,252,.18); border-radius: 4px; }
.hxf-t-tick { position: absolute; left: 0; right: 0; height: 0; display: flex; align-items: center; transform: translateY(-50%); }
.hxf-tape.r .hxf-t-tick { flex-direction: row-reverse; }
.hxf-t-mark { width: 6px; height: 1px; background: rgba(125,211,252,.5); }
.hxf-t-tick.maj .hxf-t-mark { width: 13px; background: var(--a); }
.hxf-t-tick.vne .hxf-t-mark, .hxf-t-tick.vne .hxf-t-num { background: rgba(239,68,68,.15); color: var(--r); }
.hxf-t-num { font-size: 9px; color: var(--a); width: 32px; text-align: center; }
.hxf-tape-foot { font-size: 8.5px; color: var(--d); margin-top: 3px; letter-spacing: .1em; }

.hxf-vsi { position: absolute; left: 18px; top: calc(50% + 148px); width: 78px; display: flex; flex-direction: column; gap: 2px; }
.hxf-vs-track { position: relative; height: 52px; background: rgba(8,20,30,.35); border: 1px solid rgba(125,211,252,.18); border-radius: 4px; overflow: hidden; }
.hxf-vs-bar { position: absolute; left: 25%; right: 25%; }
.hxf-vs-mid { position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: rgba(251,191,36,.5); }
.hxf-ra { position: absolute; right: 18px; top: calc(50% + 148px); font-size: 11px; color: var(--a);
  background: rgba(8,20,30,.4); border: 1px solid rgba(251,191,36,.25); padding: 2px 8px; border-radius: 4px; }
.hxf-ra b { color: var(--w); }

/* engine quadrant */
.hxf-engine { position: absolute; left: 14px; bottom: 156px; width: 186px; padding: 7px 9px;
  background: rgba(8,20,30,.55); border: 1px solid rgba(125,211,252,.2); border-radius: 6px; font-size: 9px; }
.hxf-sys-title { font-size: 8px; letter-spacing: .14em; color: var(--d); margin: 1px 0 5px; }
.hxf-eng-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: var(--d); }
.hxf-eng-row span { width: 30px; } .hxf-eng-row b { width: 40px; text-align: right; color: var(--w); }
.hxf-bar { flex: 1; height: 3px; background: rgba(125,211,252,.12); border-radius: 2px; overflow: hidden; }
.hxf-bar u { display: block; height: 100%; }

/* systems / cameras */
.hxf-systems { position: absolute; right: 14px; bottom: 156px; width: 216px; padding: 7px 9px;
  background: rgba(8,20,30,.55); border: 1px solid rgba(125,211,252,.2); border-radius: 6px; }
.hxf-swatch-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; }
.hxf-sw { display: inline-flex; align-items: center; gap: 3px; font-size: 8.5px; padding: 3px 6px; cursor: pointer;
  border: 1px solid rgba(125,211,252,.28); background: rgba(125,211,252,.07); color: var(--c); border-radius: 4px; }
.hxf-sw:hover { background: rgba(125,211,252,.18); }
.hxf-sw.on { background: rgba(74,222,128,.22); border-color: rgba(74,222,128,.5); color: var(--g); }
.hxf-sw.exit { border-color: rgba(239,68,68,.45); color: #fca5a5; }
.hxf-sw.exit:hover { background: rgba(239,68,68,.18); }

/* bottom data strip + control deck */
.hxf-strip { position: absolute; bottom: 128px; left: 50%; transform: translateX(-50%); display: flex; gap: 14px;
  font-size: 10px; color: var(--c); background: rgba(8,20,30,.45); border: 1px solid rgba(125,211,252,.15);
  padding: 2px 12px; border-radius: 3px; white-space: nowrap; }
.hxf-strip i { font-style: normal; color: var(--d); margin-right: 4px; font-size: 8.5px; }
.hxf-bottom { position: absolute; bottom: 44px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 10px; align-items: flex-end; background: rgba(8,20,30,.6);
  border: 1px solid rgba(125,211,252,.22); border-radius: 8px; padding: 8px 12px; pointer-events: auto; }

/* controls */
.hxf-controls { display: flex; gap: 10px; align-items: flex-end; }
.hxf-cyclic { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.hxf-cyclic-pad { position: relative; width: 88px; height: 88px; border-radius: 8px; cursor: grab; touch-action: none;
  background: radial-gradient(circle at 50% 50%, rgba(125,211,252,.10), rgba(8,20,30,.4)); border: 1px solid rgba(125,211,252,.3); }
.hxf-cyclic-h, .hxf-cyclic-v { position: absolute; background: rgba(125,211,252,.25); }
.hxf-cyclic-h { left: 8px; right: 8px; top: 50%; height: 1px; }
.hxf-cyclic-v { top: 8px; bottom: 8px; left: 50%; width: 1px; }
.hxf-cyclic-knob { position: absolute; width: 18px; height: 18px; border-radius: 50%; transform: translate(-50%, -50%);
  background: #0e2233; border: 2px solid var(--g); box-shadow: 0 0 8px rgba(74,222,128,.5); pointer-events: none; }
.hxf-lever { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.hxf-lever-track { position: relative; width: 26px; height: 88px; border-radius: 6px; cursor: ns-resize; touch-action: none;
  background: rgba(8,20,30,.5); border: 1px solid rgba(125,211,252,.3); overflow: hidden; }
.hxf-lever-fill { position: absolute; bottom: 0; left: 0; right: 0; opacity: .45; }
.hxf-lever-knob { position: absolute; left: 1px; right: 1px; height: 12px; border-radius: 3px; border: 2px solid; background: #0e2233; pointer-events: none; }
.hxf-detent { position: absolute; left: 0; right: 0; height: 2px; background: rgba(148,163,184,.45); pointer-events: none; }
.hxf-lever.locked .hxf-lever-track { border-color: rgba(100,116,139,.6); }
.hxf-lock { position: absolute; left: 50%; transform: translateX(-50%); width: 12px; height: 9px; border-radius: 2px; background: #64748b; pointer-events: none; box-shadow: inset 0 2px 3px rgba(0,0,0,.5); }
.hxf-dark { font-size: 9px; color: #64748b; letter-spacing: .1em; margin-bottom: 5px; border-bottom: 1px dashed rgba(100,116,139,.4); padding-bottom: 4px; }
.hxf-modeflash { position: absolute; inset: 0; z-index: 5; pointer-events: none; background: #020609;
  animation: hxfFade .32s ease-out forwards; }
@keyframes hxfFade { 0% { opacity: 1; } 100% { opacity: 0; } }
.hxf-pedals { display: flex; flex-direction: column; align-items: center; gap: 3px; justify-content: flex-end; height: 88px; }
.hxf-pedal-track { position: relative; width: 96px; height: 22px; border-radius: 5px; cursor: ew-resize; touch-action: none;
  background: rgba(8,20,30,.5); border: 1px solid rgba(125,211,252,.3); align-self: center; margin-top: 33px; }
.hxf-pedal-center { position: absolute; left: 50%; top: 3px; bottom: 3px; width: 1px; background: rgba(251,191,36,.5); }
.hxf-pedal-knob { position: absolute; top: 2px; bottom: 2px; width: 14px; border-radius: 3px; background: #0e2233; border: 2px solid var(--c); pointer-events: none; }
.hxf-lever-label { font-size: 8px; letter-spacing: .12em; color: var(--d); }
.hxf-lever-val { font-size: 9px; color: var(--a); }

/* ─── projected console deck (grounded to bottom glareshield) ─── */
.hxf-glassfx { position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background:
    linear-gradient(115deg, transparent 30%, rgba(180,220,255,0.045) 42%, transparent 55%),
    radial-gradient(ellipse 130% 90% at 50% -12%, rgba(2,8,14,0.3) 0%, transparent 42%); }
.hxf-deck { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.hxf-deck[data-deck-mode="dom"]::before { content: ''; position: absolute; left: 50%; bottom: 0;
  width: min(860px, 94vw); height: 245px; transform: translateX(-50%);
  clip-path: polygon(3% 100%, 8% 22%, 28% 9%, 41% 9%, 44% 0%, 56% 0%, 59% 9%, 72% 9%, 92% 22%, 97% 100%);
  background: linear-gradient(180deg, rgba(8,18,26,.80), rgba(4,11,16,.96) 45%, rgba(2,6,10,.99));
  border-top: 1px solid rgba(125,211,252,.28); box-shadow: inset 0 16px 35px rgba(0,0,0,.65); pointer-events: auto; }
.hxf-diu, .hxf-ddu, .hxf-stby { position: absolute; left: 0; top: 0; opacity: 0;
  transition: opacity .3s ease; pointer-events: auto; }
.hxf-deck[data-deck-mode="dom"] .hxf-diu, .hxf-deck[data-deck-mode="dom"] .hxf-ddu,
.hxf-deck[data-deck-mode="dom"] .hxf-stby { opacity: 1 !important; transition: none; }
.hxf-deck[data-deck-mode="dom"] .hxf-diu[data-deck-id="diuLeft"] { left: 50%; bottom: 12px; top: auto; transform: translate(-155%, 0) scale(0.85) !important; transform-origin: bottom center; }
.hxf-deck[data-deck-mode="dom"] .hxf-diu[data-deck-id="diuRight"] { left: 50%; bottom: 12px; top: auto; transform: translate(55%, 0) scale(0.85) !important; transform-origin: bottom center; }
.hxf-deck[data-deck-mode="dom"] .hxf-ddu[data-deck-id="ddu"] { left: 50%; bottom: 12px; top: auto; transform: translate(-50%, 0) scale(0.85) !important; transform-origin: bottom center; }
.hxf-deck[data-deck-mode="dom"] .hxf-stby[data-deck-id="stbyAdi"] { left: 50%; bottom: 134px; top: auto; transform: translate(-50%, 0) scale(0.78) !important; transform-origin: bottom center; }

/* ─── Collimated IHADSS HUD ─── */
.hxf-ihadss { position: absolute; left: 50%; top: 40%; width: 220px; height: 180px; transform: translate(-50%, -50%); pointer-events: none; z-index: 10; }
.hxf-reticle-cross { position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; transform: translate(-50%, -50%); }
.hxf-reticle-cross::before, .hxf-reticle-cross::after { content: ''; position: absolute; background: #00ff66; box-shadow: 0 0 6px rgba(0,255,102,0.8); }
.hxf-reticle-cross::before { left: 50%; top: 0; bottom: 0; width: 1.5px; transform: translateX(-50%); }
.hxf-reticle-cross::after { top: 50%; left: 0; right: 0; height: 1.5px; transform: translateY(-50%); }
.hxf-reticle-ring { position: absolute; left: 50%; top: 50%; width: 38px; height: 38px; border: 1.5px dashed rgba(0,255,102,0.7); border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 8px rgba(0,255,102,0.4); }
.hxf-hud-fpm { position: absolute; left: 50%; top: 50%; width: 20px; height: 20px; transform-origin: center; transition: transform 0.05s ease-out; }
.hxf-fpm-o { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; border: 1.5px solid #00ff66; border-radius: 50%; transform: translate(-50%, -50%); }
.hxf-fpm-l { position: absolute; right: 50%; top: 50%; width: 8px; height: 1.5px; background: #00ff66; transform: translate(-5px, -50%); }
.hxf-fpm-r { position: absolute; left: 50%; top: 50%; width: 8px; height: 1.5px; background: #00ff66; transform: translate(5px, -50%); }
.hxf-fpm-u { position: absolute; left: 50%; bottom: 50%; width: 1.5px; height: 6px; background: #00ff66; transform: translate(-50%, -5px); }
.hxf-hud-horizon { position: absolute; left: 50%; top: 50%; width: 180px; height: 2px; transform-origin: center; transition: transform 0.05s ease-out; display: flex; justify-content: space-between; align-items: center; }
.hxf-hz-l, .hxf-hz-r { width: 65px; height: 1.5px; background: #00ff66; box-shadow: 0 0 6px rgba(0,255,102,0.6); }
.hxf-hz-gap { width: 40px; }
.hxf-diu-in { width: 208px; height: 228px; box-sizing: border-box; transform-origin: 50% 50%;
  background: rgba(3,10,16,0.94); border: 2px solid rgba(90,110,130,0.55); border-radius: 7px;
  box-shadow: inset 0 0 22px rgba(0,0,0,0.85), 0 2px 8px rgba(0,0,0,0.6);
  display: flex; flex-direction: column; align-items: center; padding: 3px 4px; }
.hxf-ddu-in { width: 240px; height: 122px; box-sizing: border-box; transform-origin: 50% 50%;
  background: rgba(10,7,3,0.94); border: 2px solid rgba(140,110,60,0.55); border-radius: 7px;
  box-shadow: inset 0 0 22px rgba(0,0,0,0.85); display: flex; flex-direction: column; padding: 3px 6px; }
.hxf-stby-pod { position: relative; padding: 3px; border-radius: 50%;
  background: radial-gradient(circle, #1e293b 0%, #0f172a 70%, #020617 100%);
  border: 1px solid rgba(125,211,252,0.25);
  box-shadow: 0 4px 16px rgba(0,0,0,0.85), inset 0 1px 2px rgba(255,255,255,0.1); }
.hxf-stby-in { width: 108px; height: 108px; border-radius: 50%; overflow: hidden; position: relative;
  background: #0b1118; border: 3px solid #334155; box-shadow: inset 0 0 14px rgba(0,0,0,0.9); transform-origin: 50% 50%; }
.hxf-stby-bezel-ring { position: absolute; inset: 0; border-radius: 50%; border: 1px dashed rgba(148,163,184,0.3); pointer-events: none; }
.hxf-stby-pitch-lines { position: absolute; inset: 0; pointer-events: none; }
.hxf-stby-pitch-lines .p10-up { position: absolute; left: 35%; right: 35%; top: calc(50% - 16px); height: 1.5px; background: rgba(255,255,255,0.7); }
.hxf-stby-pitch-lines .p10-dn { position: absolute; left: 35%; right: 35%; top: calc(50% + 16px); height: 1.5px; background: rgba(255,255,255,0.7); }
.hxf-stby-cage { position: absolute; right: 8px; bottom: 8px; width: 10px; height: 10px; border-radius: 50%; background: #475569; border: 1px solid #94a3b8; box-shadow: 0 1px 3px rgba(0,0,0,0.8); }
.hxf-diu-cap { font-size: 7px; letter-spacing: .14em; color: #64748b; align-self: flex-start; }
.hxf-att-di { width: 196px; height: 176px; border: none; background: transparent; overflow: hidden; position: relative; border-radius: 4px; }
.hxf-di-rate { font-size: 8px; color: var(--d); letter-spacing: .08em; }

/* DIU 2 HSI compass rose */
.hxf-rose-wrap { position: relative; width: 160px; height: 160px; margin: 4px auto 0 auto; display: flex; align-items: center; justify-content: center; }
.hxf-rose-ring { position: absolute; inset: 6px; border: 1px solid rgba(125,211,252,0.22); border-radius: 50%; pointer-events: none; }
.hxf-rose-lubber { position: absolute; top: 0px; left: 50%; width: 0; height: 0; transform: translateX(-50%);
  border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 8px solid var(--a); z-index: 3; }
.hxf-rose { position: absolute; inset: 0; border-radius: 50%; }
.hxf-rose .hxf-rk { position: absolute; left: 50%; top: 6px; width: 1.5px; height: 9px; margin-left: -0.75px;
  background: rgba(160,200,230,.65); transform-origin: 0.75px 74px; }
.hxf-rose .hxf-rk.maj { height: 14px; width: 2px; margin-left: -1px; background: var(--a); }
.hxf-rose .hxf-rk.med { height: 11px; background: rgba(251,191,36,.7); }
.hxf-rose .hxf-rk em { position: absolute; top: 16px; left: 50%; font-style: normal; font-size: 11px; font-weight: 700; color: var(--a); transform-origin: center center; }
.hxf-rose-plane { position: absolute; top: 50%; left: 50%; width: 0; height: 0; transform: translate(-50%, -50%);
  border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 12px solid var(--g); z-index: 2; }
.hxf-rose-trk { position: absolute; inset: 0; }
.hxf-hdg-digital { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); font-size: 10.5px; font-weight: 700; color: var(--c);
  background: rgba(8,20,30,.88); border: 1px solid rgba(125,211,252,0.35); padding: 1px 7px; border-radius: 3px; z-index: 4; }
.hxf-slip { position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); font-size: 8px; color: var(--d); }
.hxf-ddu-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1px 8px; font-size: 9.5px; color: var(--d); margin-top: 2px; }
.hxf-ddu-grid span { display: flex; gap: 4px; align-items: baseline; white-space: nowrap; }
.hxf-ddu-grid i { font-style: normal; color: #64748b; font-size: 8px; width: 26px; }
.hxf-ddu-grid b { color: #ffd9a0; font-weight: 700; }
.hxf-stby-face { position: absolute; inset: 0; }
.hxf-stby-sky { position: absolute; left: -10%; width: 120%; height: 55%; background: linear-gradient(#1d4e79, #2a6a9c); }
.hxf-stby-gnd { position: absolute; left: -10%; width: 120%; height: 55%; background: linear-gradient(#7a5a20, #5c4416); }
.hxf-stby-hz { position: absolute; left: 12%; right: 12%; top: 50%; height: 2px; background: #fff; }
.hxf-stby-wing { position: absolute; left: 50%; top: 50%; width: 40px; height: 2px; background: var(--a); transform: translate(-50%, -50%); box-shadow: 0 0 4px rgba(251,191,36,.6); }

/* ─── external / top-down dock ─── */
.hxf-dockflash { position: fixed; inset: 0; z-index: 250; pointer-events: none; background: #020609;
  animation: hxfFade .32s ease-out forwards; }
.hxdock { position: absolute; left: 50%; bottom: 48px; transform: translateX(-50%); z-index: 245;
  pointer-events: none; font-family: 'JetBrains Mono', ui-monospace, monospace;
  --g: #4ade80; --c: #7dd3fc; --a: #fbbf24; --w: #eef7f0; --d: #94a3b8; --r: #ef4444; color: var(--c); }
.hxdock-inner { pointer-events: none; display: flex; flex-direction: column; gap: 7px; align-items: center;
  background: rgba(8,20,30,.75); border: 1px solid rgba(125,211,252,.25); border-radius: 10px;
  padding: 8px 12px; backdrop-filter: blur(6px); box-shadow: 0 8px 24px rgba(0,0,0,.5); max-width: 94vw; }
.hxdock-telem { display: flex; flex-wrap: nowrap; gap: 7px; justify-content: center; align-items: center; font-size: 9.5px; pointer-events: none; max-width: 100%; overflow-x: auto; }
.hxdock-hint { pointer-events: none; }
.hxdock-inner .hxf-controls, .hxdock-inner .hxf-systems { pointer-events: auto; }
.hxdock-chip { display: inline-flex; gap: 4px; align-items: baseline; letter-spacing: .04em; }
.hxdock-chip i { font-style: normal; font-size: 8.5px; color: #94a3b8; }
.hxdock-chip b { color: #e2f3ff; font-weight: 700; }
.hxdock-title { color: #4ade80; font-weight: 700; letter-spacing: .1em; align-items: center; }
.hxdock-warn { border: 1px solid currentColor; border-radius: 3px; padding: 0 5px; font-weight: 700; }
.hxdock .hxf-systems, .hxdock .hxf-engine { position: static; width: auto; border: none; background: transparent; padding: 0; }
.hxdock-hint { font-size: 8px; color: #94a3b8; letter-spacing: .05em; opacity: .85; text-align: center; white-space: nowrap; }
.hxdock .hxf-sw { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.hxdock .hxf-sys-title { display: none; }

/* ── Dual Lever Flight Pod & Directional Arrows ── */
/* ── Dual Lever Flight Pod & Directional Arrows ── */
.hxf-dual-pod {
  display: flex; gap: 6px; align-items: center; pointer-events: auto;
  background: rgba(8, 20, 30, 0.7); border: 1px solid rgba(125, 211, 252, 0.3);
  border-radius: 6px; padding: 2px 5px; flex-shrink: 0;
}
.hxf-lever-col {
  display: flex; flex-direction: column; align-items: center; gap: 1px;
}
.hxf-lever-title {
  font-size: 7px; letter-spacing: 0.08em; color: var(--d, #94a3b8); font-weight: 700;
  text-transform: uppercase;
}
.hxf-btn-step {
  font-size: 7px; padding: 0 3px; background: rgba(125, 211, 252, 0.1);
  border: 1px solid rgba(125, 211, 252, 0.3); color: var(--c, #7dd3fc);
  border-radius: 2px; cursor: pointer; user-select: none; line-height: 1.1;
}
.hxf-btn-step:hover { background: rgba(125, 211, 252, 0.25); color: #fff; }
.hxf-btn-step:active { background: rgba(74, 222, 128, 0.3); }
.hxf-dual-pod .hxf-lever-track {
  position: relative; width: 20px; height: 38px; border-radius: 3px; cursor: ns-resize;
  background: rgba(8, 20, 30, 0.7); border: 1px solid rgba(125, 211, 252, 0.35); overflow: hidden;
}
.hxf-dual-pod .hxf-lever-fill {
  position: absolute; bottom: 0; left: 0; right: 0; opacity: 0.55;
}
.hxf-dual-pod .hxf-lever-knob {
  position: absolute; left: 1px; right: 1px; height: 8px; border-radius: 2px; border: 1.5px solid;
  background: #0e2233; pointer-events: none;
}
.hxf-dual-pod .hxf-lever-val {
  font-size: 8px; font-weight: 700;
}

/* D-Pad 4-Way Directional Grid */
.hxf-dpad {
  display: flex; flex-direction: column; align-items: center; gap: 2px; margin-left: 1px;
}
.hxf-dpad-row {
  display: flex; gap: 2px; justify-content: center; align-items: center;
}
.hxf-dpad-btn {
  font-size: 7.5px; font-weight: 700; padding: 2px 4px; letter-spacing: 0.04em;
  background: rgba(125, 211, 252, 0.10); border: 1px solid rgba(125, 211, 252, 0.35);
  color: var(--c, #7dd3fc); border-radius: 3px; cursor: pointer; user-select: none;
  touch-action: none; transition: all 0.1s ease; line-height: 1.1; white-space: nowrap;
}
.hxf-dpad-btn:hover {
  background: rgba(125, 211, 252, 0.25); border-color: rgba(125, 211, 252, 0.6); color: #fff;
}
.hxf-dpad-btn:active, .hxf-dpad-btn.active {
  background: rgba(74, 222, 128, 0.35); border-color: #4ade80; color: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.5);
}
.hxf-dpad-btn.front { width: 76px; text-align: center; }
.hxf-dpad-btn.back { width: 76px; text-align: center; }
.hxf-dpad-btn.left, .hxf-dpad-btn.right { width: 44px; text-align: center; }
.hxf-dpad-btn.hover { width: 34px; text-align: center; font-size: 7px; }

/* Cockpit Flight Controls Mount */
.hxf-cockpit-quadrant {
  position: absolute; left: 16px; bottom: 44px; z-index: 260; pointer-events: auto;
  background: rgba(8, 20, 30, 0.82); border: 1px solid rgba(125, 211, 252, 0.35);
  border-radius: 8px; padding: 5px 7px; backdrop-filter: blur(8px);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.7);
}
.hxf-quad-title {
  font-size: 8px; letter-spacing: 0.12em; color: var(--d, #94a3b8); margin-bottom: 3px;
  text-transform: uppercase; text-align: center;
}
.hxdock-flight-row {
  display: flex; flex-direction: row; gap: 10px; align-items: center; justify-content: center;
  flex-wrap: nowrap; pointer-events: auto; width: 100%;
}
`;
