import React from 'react';
import {
  Rocket,
  Zap,
  Compass,
  Camera,
  Volume2,
  VolumeX,
  Sun,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Lightbulb,
  CloudRain,
} from 'lucide-react';

export interface TeslaRoadsterCockpitViewProps {
  speedKmh: number;
  headingDeg: number;
  pitchDeg: number;
  copvPressurePsi: number;
  flightAltitudeM: number;
  isFlying: boolean;
  isLudicrous: boolean;
  isAudioMuted: boolean;
  targaOpen: boolean;
  steerAngleDeg: number;
  throttlePct: number;
  brakePct: number;
  headlightsOn?: boolean;
  odometerKm?: number;
  isRaining?: boolean;
  onTogglePerspective: () => void;
  onToggleFly: (active: boolean) => void;
  onToggleLudicrous: () => void;
  onToggleSound: () => void;
  onToggleTarga: () => void;
  onToggleHeadlights?: () => void;
  onToggleRain?: () => void;
  onResetCamera: () => void;
  onManualThrottle?: (fwd: number) => void;
  onManualSteer?: (turn: number) => void;
}

export function TeslaRoadsterCockpitView({
  speedKmh,
  headingDeg,
  pitchDeg: _pitchDeg,
  copvPressurePsi,
  flightAltitudeM: _flightAltitudeM,
  isFlying,
  isLudicrous,
  isAudioMuted,
  targaOpen,
  steerAngleDeg,
  throttlePct,
  brakePct,
  headlightsOn = false,
  odometerKm = 12480.0,
  isRaining = false,
  onTogglePerspective,
  onToggleFly,
  onToggleLudicrous,
  onToggleSound,
  onToggleTarga,
  onToggleHeadlights,
  onToggleRain,
  onResetCamera: _onResetCamera,
  onManualThrottle,
  onManualSteer,
}: TeslaRoadsterCockpitViewProps) {
  // Compass direction
  const cardinalDirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const cardinalIdx = Math.round(((headingDeg % 360) + 360) % 360 / 45) % 8;
  const compassLabel = cardinalDirs[cardinalIdx];

  // Power output in kW: acceleration draws power (+kW in cyan/green), braking regenerates (-kW in amber)
  const motorPowerKw = brakePct > 5
    ? -Math.round(brakePct * 1.5)
    : throttlePct > 0
    ? Math.round(throttlePct * (isLudicrous ? 9.5 : 5.8) + (speedKmh / 400) * 120)
    : 0;

  // Active gear
  const gear = speedKmh === 0 && throttlePct === 0 ? 'P' : throttlePct < 0 ? 'R' : 'D';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 550,
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* ══════════════════════════════════════════════════════════════════════
          1. PERIMETER WINDSHIELD FRAMING & A-PILLARS
          ══════════════════════════════════════════════════════════════════════ */}
      {/* Top Header Canopy Frame */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 38,
          background: 'linear-gradient(180deg, rgba(8, 10, 15, 0.96) 0%, rgba(15, 20, 28, 0.82) 65%, transparent 100%)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        }}
      />

      {/* Left A-Pillar (Driver Side) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 82,
          background: 'linear-gradient(90deg, rgba(8, 10, 15, 0.98) 0%, rgba(18, 22, 30, 0.88) 60%, transparent 100%)',
          clipPath: 'polygon(0 0, 72px 0, 42px 100%, 0 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Right A-Pillar (Passenger Side) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: 82,
          background: 'linear-gradient(270deg, rgba(8, 10, 15, 0.98) 0%, rgba(18, 22, 30, 0.88) 60%, transparent 100%)',
          clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 40px 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* ══════════════════════════════════════════════════════════════════════
          2. SLIM LOW-PROFILE HYPERCAR STATUS RIBBON
          Docked at bottom-center (height 38px) leaving steering yoke 100% visible!
          ══════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 780,
          maxWidth: 'calc(100vw - 320px)',
          height: 38,
          background: 'rgba(8, 12, 20, 0.94)',
          borderRadius: 8,
          border: '1.5px solid rgba(255, 255, 255, 0.16)',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.88), inset 0 1px 0 rgba(255, 255, 255, 0.18)',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          pointerEvents: 'auto',
          backdropFilter: 'blur(20px)',
          zIndex: 50,
        }}
      >
        {/* Left: Tesla Badge, Speedometer & Odometer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C7.5 2 3.5 3.5 1 5.5L3 8C5 6.5 8.5 5.5 12 5.5C15.5 5.5 19 6.5 21 8L23 5.5C20.5 3.5 16.5 2 12 2Z" fill="#ef4444" />
            <path d="M12 7V22H14V9.5C16.5 9.8 19 10.8 20.5 12.2L22 10C20 8.2 16.5 7.2 12 7Z" fill="#ef4444" />
            <path d="M12 9.5V22H10V9.5C7.5 9.8 5 10.8 3.5 12.2L2 10C4 8.2 7.5 7.2 12 7V9.5Z" fill="#ef4444" />
          </svg>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span
              style={{
                fontSize: 20,
                fontWeight: 900,
                fontFamily: 'monospace',
                color: isFlying ? '#38bdf8' : isLudicrous ? '#fb923c' : '#ffffff',
                lineHeight: 1,
              }}
            >
              {speedKmh}
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8' }}>KM/H</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 12 }}>|</span>
          <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: '#cbd5e1' }}>
            {odometerKm.toFixed(1)} <span style={{ fontSize: 8, color: '#64748b' }}>KM</span>
          </span>
        </div>

        {/* Center: Gears, Drive Mode, Battery & Compass */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* PRND */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(0,0,0,0.4)', padding: '2px 5px', borderRadius: 4 }}>
            {(['P', 'R', 'N', 'D'] as const).map((g) => (
              <span
                key={g}
                style={{
                  fontFamily: 'monospace',
                  fontWeight: 900,
                  fontSize: 10,
                  padding: '1px 3px',
                  borderRadius: 2,
                  color: gear === g ? (g === 'R' ? '#f43f5e' : '#38bdf8') : '#64748b',
                  background: gear === g ? (g === 'R' ? 'rgba(244, 63, 94, 0.25)' : 'rgba(56, 189, 248, 0.25)') : 'transparent',
                }}
              >
                {g}
              </span>
            ))}
          </div>

          {/* Mode Pill */}
          <span
            style={{
              background: isFlying ? 'rgba(56, 189, 248, 0.2)' : isLudicrous ? 'rgba(249, 115, 22, 0.2)' : 'rgba(239, 68, 68, 0.15)',
              color: isFlying ? '#38bdf8' : isLudicrous ? '#fb923c' : '#f87171',
              border: `1px solid ${isFlying ? '#38bdf8' : isLudicrous ? '#fb923c' : 'rgba(239, 68, 68, 0.3)'}`,
              padding: '1px 5px',
              borderRadius: 3,
              fontWeight: 800,
              fontSize: 8,
              letterSpacing: '0.04em',
            }}
          >
            {isFlying ? 'HOVER' : isLudicrous ? 'LUDICROUS+' : 'AWD'}
          </span>

          {/* Battery */}
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#34d399', fontWeight: 700 }}>
            98% · 980KM
          </span>

          {/* Compass */}
          <span style={{ color: '#38bdf8', fontFamily: 'monospace', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Compass size={10} />
            {compassLabel} {Math.round(((headingDeg % 360) + 360) % 360)}°
          </span>
        </div>

        {/* Right: Quick Controls & Exit Cockpit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {/* Headlights Toggle */}
          <button
            onClick={() => onToggleHeadlights?.()}
            title="Toggle Headlights [L]"
            style={{
              background: headlightsOn ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${headlightsOn ? '#38bdf8' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 5,
              padding: '3px 6px',
              color: headlightsOn ? '#38bdf8' : '#94a3b8',
              fontSize: 8.5,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Lightbulb size={10} /> {headlightsOn ? 'ON' : 'OFF'}
          </button>

          {/* Targa Roof Toggle */}
          <button
            onClick={() => onToggleTarga()}
            title="Toggle Targa Convertible Roof [T]"
            style={{
              background: targaOpen ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${targaOpen ? '#f59e0b' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 5,
              padding: '3px 6px',
              color: targaOpen ? '#fbbf24' : '#94a3b8',
              fontSize: 8.5,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Sun size={10} /> {targaOpen ? 'TARGA' : 'COUPE'}
          </button>

          {/* Boost Toggle */}
          <button
            onClick={() => onToggleLudicrous()}
            title="Ludicrous+ Boost [Shift]"
            style={{
              background: isLudicrous ? 'rgba(249, 115, 22, 0.25)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${isLudicrous ? '#fb923c' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 5,
              padding: '3px 6px',
              color: isLudicrous ? '#fb923c' : '#94a3b8',
              fontSize: 8.5,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Zap size={10} /> BOOST
          </button>

          {/* Audio Toggle */}
          <button
            onClick={() => onToggleSound()}
            title="Sound Mute [U]"
            style={{
              background: !isAudioMuted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${!isAudioMuted ? '#10b981' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 5,
              padding: '3px 6px',
              color: !isAudioMuted ? '#10b981' : '#94a3b8',
              fontSize: 8.5,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {!isAudioMuted ? <Volume2 size={10} /> : <VolumeX size={10} />}
          </button>

          {/* Exit Cockpit */}
          <button
            onClick={() => onTogglePerspective()}
            title="Switch to Exterior 3rd-Person Chase View [C/V]"
            style={{
              background: 'rgba(239, 68, 68, 0.25)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 5,
              padding: '3px 7px',
              color: '#f87171',
              fontSize: 8.5,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <Camera size={10} /> EXIT
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          3. INTERACTIVE STEERING CONTROLS (Bottom Left)
          ══════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: 14,
          display: 'flex',
          gap: 6,
          pointerEvents: 'auto',
          zIndex: 20,
        }}
      >
        <button
          onMouseDown={(e) => { e.preventDefault(); onManualSteer?.(-1); }}
          onMouseUp={(e) => { e.preventDefault(); onManualSteer?.(0); }}
          onTouchStart={(e) => { e.preventDefault(); onManualSteer?.(-1); }}
          onTouchEnd={(e) => { e.preventDefault(); onManualSteer?.(0); }}
          title="Turn Wheels Left [A / Left Arrow]"
          style={{
            background: steerAngleDeg < -5 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(15, 23, 42, 0.85)',
            border: `1.5px solid ${steerAngleDeg < -5 ? '#ef4444' : 'rgba(255, 255, 255, 0.2)'}`,
            color: '#fff',
            borderRadius: 8,
            padding: '7px 12px',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ArrowLeft size={12} /> STEER LEFT
        </button>

        <button
          onMouseDown={(e) => { e.preventDefault(); onManualSteer?.(1); }}
          onMouseUp={(e) => { e.preventDefault(); onManualSteer?.(0); }}
          onTouchStart={(e) => { e.preventDefault(); onManualSteer?.(1); }}
          onTouchEnd={(e) => { e.preventDefault(); onManualSteer?.(0); }}
          title="Turn Wheels Right [D / Right Arrow]"
          style={{
            background: steerAngleDeg > 5 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(15, 23, 42, 0.85)',
            border: `1.5px solid ${steerAngleDeg > 5 ? '#ef4444' : 'rgba(255, 255, 255, 0.2)'}`,
            color: '#fff',
            borderRadius: 8,
            padding: '7px 12px',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          STEER RIGHT <ArrowRight size={12} />
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          4. INTERACTIVE PEDAL BUTTONS (Bottom Right)
          ══════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          right: 14,
          display: 'flex',
          gap: 6,
          pointerEvents: 'auto',
          zIndex: 20,
        }}
      >
        <button
          onMouseDown={(e) => { e.preventDefault(); onManualThrottle?.(-1); }}
          onMouseUp={(e) => { e.preventDefault(); onManualThrottle?.(0); }}
          onTouchStart={(e) => { e.preventDefault(); onManualThrottle?.(-1); }}
          onTouchEnd={(e) => { e.preventDefault(); onManualThrottle?.(0); }}
          title="Brembo Regenerative Brakes & Reverse [S / Down Arrow]"
          style={{
            background: brakePct > 10 ? 'rgba(239, 68, 68, 0.45)' : 'rgba(15, 23, 42, 0.85)',
            border: `1.5px solid ${brakePct > 10 ? '#ef4444' : 'rgba(239, 68, 68, 0.3)'}`,
            borderRadius: 8,
            padding: '7px 12px',
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: brakePct > 10 ? '#fca5a5' : '#f87171' }}>
            <ArrowDown size={11} style={{ display: 'inline', marginRight: 2 }} />
            BRAKE {brakePct > 0 ? `${Math.round(brakePct)}%` : ''}
          </span>
        </button>

        <button
          onMouseDown={(e) => { e.preventDefault(); onManualThrottle?.(1); }}
          onMouseUp={(e) => { e.preventDefault(); onManualThrottle?.(0); }}
          onTouchStart={(e) => { e.preventDefault(); onManualThrottle?.(1); }}
          onTouchEnd={(e) => { e.preventDefault(); onManualThrottle?.(0); }}
          title="Tri-Motor Throttle [W / Up Arrow]"
          style={{
            background: throttlePct > 10 ? 'rgba(16, 185, 129, 0.45)' : 'rgba(15, 23, 42, 0.85)',
            border: `1.5px solid ${throttlePct > 10 ? '#10b981' : 'rgba(16, 185, 129, 0.3)'}`,
            borderRadius: 8,
            padding: '7px 12px',
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: throttlePct > 10 ? '#6ee7b7' : '#34d399' }}>
            <ArrowUp size={11} style={{ display: 'inline', marginRight: 2 }} />
            THROTTLE {throttlePct > 0 ? `${Math.round(throttlePct)}%` : ''}
          </span>
        </button>
      </div>
    </div>
  );
}
