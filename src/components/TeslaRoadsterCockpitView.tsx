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
  onTogglePerspective: () => void;
  onToggleFly: (active: boolean) => void;
  onToggleLudicrous: () => void;
  onToggleSound: () => void;
  onToggleTarga: () => void;
  onToggleHeadlights?: () => void;
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
  onTogglePerspective,
  onToggleFly,
  onToggleLudicrous,
  onToggleSound,
  onToggleTarga,
  onToggleHeadlights,
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
          2. CENTRAL DIGITAL REARVIEW MIRROR (Top Center Header)
          ══════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 290,
          height: 74,
          background: 'radial-gradient(ellipse at center, rgba(16, 24, 38, 0.92) 0%, rgba(8, 12, 18, 0.98) 100%)',
          borderRadius: '8px 8px 18px 18px',
          border: '1.5px solid rgba(255, 255, 255, 0.18)',
          boxShadow: '0 12px 36px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.25)',
          padding: '6px 12px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          pointerEvents: 'auto',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.04em' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
            TESLA VISION REAR
          </span>
          <span style={{ color: '#38bdf8', fontFamily: 'monospace', fontWeight: 700 }}>
            <Compass size={10} style={{ display: 'inline', marginRight: 2 }} />
            {compassLabel} {Math.round(((headingDeg % 360) + 360) % 360)}°
          </span>
        </div>

        {/* Rear Horizon Grid */}
        <div
          style={{
            height: 34,
            borderRadius: 4,
            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'rgba(56, 189, 248, 0.35)' }} />
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="none">
            <line x1="25" y1="34" x2="110" y2="17" stroke="rgba(56, 189, 248, 0.3)" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="265" y1="34" x2="180" y2="17" stroke="rgba(56, 189, 248, 0.3)" strokeWidth="1" strokeDasharray="3 3" />
          </svg>
          <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '0.06em' }}>
            CLEAR · RADAR ACTIVE
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7.5, color: '#64748b' }}>
          <span>WIDE ANGLE HDR</span>
          <span>AUTODIM ON</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          3. ALL-IN-ONE HYPERCAR INSTRUMENT CLUSTER & ODOMETER PANEL
          Unifies Speedometer, Speed Score, Odometer, Gear, Battery, Motor Power,
          SpaceX Thrusters, and Cockpit Controls into ONE cohesive dashboard display!
          ══════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          bottom: 18,
          right: 36,
          width: 590,
          background: 'linear-gradient(180deg, rgba(14, 20, 32, 0.94) 0%, rgba(6, 10, 16, 0.98) 100%)',
          borderRadius: 16,
          border: '1.5px solid rgba(255, 255, 255, 0.16)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.92), inset 0 1px 0 rgba(255, 255, 255, 0.22)',
          padding: '12px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          pointerEvents: 'auto',
          backdropFilter: 'blur(24px)',
          zIndex: 50,
        }}
      >
        {/* Panel Header: Brand, Mode Badge, Gear, Autopilot & Temp */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 6 }}>
          {/* Brand & Mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C7.5 2 3.5 3.5 1 5.5L3 8C5 6.5 8.5 5.5 12 5.5C15.5 5.5 19 6.5 21 8L23 5.5C20.5 3.5 16.5 2 12 2Z" fill="#ef4444" />
              <path d="M12 7V22H14V9.5C16.5 9.8 19 10.8 20.5 12.2L22 10C20 8.2 16.5 7.2 12 7Z" fill="#ef4444" />
              <path d="M12 9.5V22H10V9.5C7.5 9.8 5 10.8 3.5 12.2L2 10C4 8.2 7.5 7.2 12 7V9.5Z" fill="#ef4444" />
            </svg>
            <span style={{ fontWeight: 900, color: '#ffffff', letterSpacing: '0.08em', fontSize: 11 }}>TESLA ROADSTER</span>
            <span
              style={{
                background: isFlying
                  ? 'rgba(56, 189, 248, 0.25)'
                  : isLudicrous
                  ? 'rgba(249, 115, 22, 0.25)'
                  : 'rgba(239, 68, 68, 0.2)',
                color: isFlying ? '#38bdf8' : isLudicrous ? '#fb923c' : '#f87171',
                border: `1px solid ${isFlying ? '#38bdf8' : isLudicrous ? '#fb923c' : 'rgba(239, 68, 68, 0.4)'}`,
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 800,
                fontSize: 9,
                letterSpacing: '0.04em',
              }}
            >
              {isFlying ? 'SPACEX HOVER' : isLudicrous ? 'LUDICROUS+' : 'TRI-MOTOR AWD'}
            </span>
          </div>

          {/* Center: Gear Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }}>
            {(['P', 'R', 'N', 'D'] as const).map((g) => (
              <span
                key={g}
                style={{
                  fontFamily: 'monospace',
                  fontWeight: 900,
                  fontSize: 11,
                  padding: '1px 4px',
                  borderRadius: 3,
                  color: gear === g ? (g === 'R' ? '#f43f5e' : '#38bdf8') : '#64748b',
                  background: gear === g ? (g === 'R' ? 'rgba(244, 63, 94, 0.25)' : 'rgba(56, 189, 248, 0.25)') : 'transparent',
                  textShadow: gear === g ? '0 0 8px currentColor' : 'none',
                }}
              >
                {g}
              </span>
            ))}
          </div>

          {/* Right: Autopilot, Temp & Compass */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 9, color: '#94a3b8' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#38bdf8', fontWeight: 700 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 6px #38bdf8' }} />
              FSD V13.2 ACTIVE
            </span>
            <span style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>21.5°C</span>
            <span style={{ color: '#38bdf8', fontFamily: 'monospace', fontWeight: 700 }}>
              {compassLabel} {Math.round(((headingDeg % 360) + 360) % 360)}°
            </span>
          </div>
        </div>

        {/* Panel Main Grid: 3 Cohesive Sections */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr 1.25fr', gap: 14, alignItems: 'center' }}>
          {/* Section 1: Speed & Digital Odometer */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, background: 'rgba(0,0,0,0.4)', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                <span
                  style={{
                    fontSize: 36,
                    fontWeight: 900,
                    fontFamily: 'monospace',
                    color: isFlying ? '#38bdf8' : isLudicrous ? '#fb923c' : '#ffffff',
                    textShadow: isFlying
                      ? '0 0 16px rgba(56, 189, 248, 0.8)'
                      : isLudicrous
                      ? '0 0 16px rgba(249, 115, 22, 0.8)'
                      : '0 0 12px rgba(255, 255, 255, 0.4)',
                    lineHeight: 1,
                  }}
                >
                  {speedKmh}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>KM/H</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.04em' }}>ODOMETER</span>
                <span style={{ fontSize: 14, fontWeight: 900, fontFamily: 'monospace', color: '#cbd5e1' }}>
                  {odometerKm.toFixed(1)} <span style={{ fontSize: 8.5, color: '#64748b' }}>KM</span>
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Vehicle Silhouette & Tire Pressures */}
          <div
            style={{
              height: 98,
              background: 'radial-gradient(ellipse at center, rgba(30, 41, 59, 0.4) 0%, rgba(10, 15, 25, 0.6) 100%)',
              borderRadius: 10,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {/* Headlights beam indicator */}
            {headlightsOn && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  width: 60,
                  height: 24,
                  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(56, 189, 248, 0.15) 60%, transparent 100%)',
                  clipPath: 'polygon(25% 100%, 75% 100%, 100% 0%, 0% 0%)',
                  filter: 'blur(2px)',
                }}
              />
            )}

            {/* Glowing Red Roadster Vector */}
            <svg width="48" height="84" viewBox="0 0 100 180" fill="none">
              {/* Tires */}
              <rect x="8" y="32" width="12" height="28" rx="4" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.5" />
              <rect x="80" y="32" width="12" height="28" rx="4" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.5" />
              <rect x="8" y="120" width="12" height="30" rx="4" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.5" />
              <rect x="80" y="120" width="12" height="30" rx="4" fill="#1e293b" stroke="#38bdf8" strokeWidth="1.5" />

              {/* Car Body Shell in Tesla Multi-Coat Ultra Red */}
              <path
                d="M24 35 C24 16, 36 6, 50 6 C64 6, 76 16, 76 35 L78 68 C80 82, 80 110, 78 140 C76 158, 68 174, 50 174 C32 174, 24 158, 22 140 C20 110, 20 82, 22 68 Z"
                fill="url(#carPaintGrad2)"
                stroke="#ef4444"
                strokeWidth="2"
              />

              {/* Glass Cockpit Canopy */}
              <path
                d="M28 50 C32 44, 42 42, 50 42 C58 42, 68 44, 72 50 L73 78 C70 82, 62 84, 50 84 C38 84, 30 82, 27 78 Z"
                fill={targaOpen ? 'rgba(15, 23, 42, 0.95)' : 'rgba(56, 189, 248, 0.35)'}
                stroke={targaOpen ? '#f59e0b' : '#38bdf8'}
                strokeWidth="1.5"
              />

              {/* Headlights */}
              <line x1="28" y1="18" x2="38" y2="12" stroke={headlightsOn ? '#ffffff' : '#64748b'} strokeWidth="2.5" strokeLinecap="round" />
              <line x1="72" y1="18" x2="62" y2="12" stroke={headlightsOn ? '#ffffff' : '#64748b'} strokeWidth="2.5" strokeLinecap="round" />

              {/* Taillights */}
              <path
                d="M26 166 C35 170, 65 170, 74 166"
                stroke={brakePct > 5 ? '#ff0000' : '#ef4444'}
                strokeWidth={brakePct > 5 ? 4 : 2.5}
                strokeLinecap="round"
              />

              <defs>
                <linearGradient id="carPaintGrad2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#dc2626" />
                  <stop offset="50%" stopColor="#991b1b" />
                  <stop offset="100%" stopColor="#7f1d1d" />
                </linearGradient>
              </defs>
            </svg>

            {/* Tire pressures */}
            <span style={{ position: 'absolute', top: 12, left: 6, fontSize: 7, fontFamily: 'monospace', color: '#94a3b8', fontWeight: 700 }}>42 PSI</span>
            <span style={{ position: 'absolute', top: 12, right: 6, fontSize: 7, fontFamily: 'monospace', color: '#94a3b8', fontWeight: 700 }}>42 PSI</span>
            <span style={{ position: 'absolute', bottom: 12, left: 6, fontSize: 7, fontFamily: 'monospace', color: '#94a3b8', fontWeight: 700 }}>44 PSI</span>
            <span style={{ position: 'absolute', bottom: 12, right: 6, fontSize: 7, fontFamily: 'monospace', color: '#94a3b8', fontWeight: 700 }}>44 PSI</span>
          </div>

          {/* Section 3: Battery, Power & SpaceX COPV Thrust */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(0,0,0,0.4)', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
            {/* Battery & Range */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#94a3b8', fontWeight: 700 }}>
                <span>BATTERY PACK</span>
                <span style={{ color: '#34d399', fontFamily: 'monospace' }}>98% · 980 KM</span>
              </div>
              <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div style={{ width: '98%', height: '100%', background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
              </div>
            </div>

            {/* Motor Power Output */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#94a3b8', fontWeight: 700 }}>
                <span>MOTOR POWER</span>
                <span style={{ color: motorPowerKw < 0 ? '#fbbf24' : motorPowerKw > 0 ? '#34d399' : '#64748b', fontFamily: 'monospace' }}>
                  {motorPowerKw > 0 ? `+${motorPowerKw}` : motorPowerKw} kW
                </span>
              </div>
              <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, Math.abs(motorPowerKw) / 8))}%`,
                    height: '100%',
                    background: motorPowerKw < 0 ? '#fbbf24' : 'linear-gradient(90deg, #10b981, #34d399)',
                  }}
                />
              </div>
            </div>

            {/* SpaceX Thrusters COPV Pressure */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#94a3b8', fontWeight: 700 }}>
                <span>COPV THRUST</span>
                <span style={{ color: copvPressurePsi > 3000 ? '#38bdf8' : '#f87171', fontFamily: 'monospace' }}>{copvPressurePsi} PSI</span>
              </div>
              <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(copvPressurePsi / 10000) * 100}%`,
                    height: '100%',
                    background: copvPressurePsi > 3000 ? 'linear-gradient(90deg, #0284c7, #38bdf8)' : '#f87171',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Panel Footer: Quick Action Control Dock */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Headlights Toggle */}
            <button
              onClick={() => onToggleHeadlights?.()}
              style={{
                background: headlightsOn ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${headlightsOn ? '#38bdf8' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 6,
                padding: '4px 8px',
                color: headlightsOn ? '#38bdf8' : '#94a3b8',
                fontSize: 8.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Lightbulb size={11} />
              {headlightsOn ? 'LIGHTS ON' : 'LIGHTS OFF'}
            </button>

            {/* Targa Roof Toggle */}
            <button
              onClick={() => onToggleTarga()}
              style={{
                background: targaOpen ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${targaOpen ? '#f59e0b' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 6,
                padding: '4px 8px',
                color: targaOpen ? '#fbbf24' : '#94a3b8',
                fontSize: 8.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Sun size={11} />
              {targaOpen ? 'TARGA OPEN' : 'COUPE'}
            </button>

            {/* Boost Toggle */}
            <button
              onClick={() => onToggleLudicrous()}
              style={{
                background: isLudicrous ? 'rgba(249, 115, 22, 0.25)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${isLudicrous ? '#fb923c' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 6,
                padding: '4px 8px',
                color: isLudicrous ? '#fb923c' : '#94a3b8',
                fontSize: 8.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Zap size={11} />
              BOOST
            </button>

            {/* Fly Toggle */}
            <button
              onClick={() => onToggleFly(!isFlying)}
              style={{
                background: isFlying ? 'rgba(14, 165, 233, 0.25)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${isFlying ? '#38bdf8' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 6,
                padding: '4px 8px',
                color: isFlying ? '#38bdf8' : '#94a3b8',
                fontSize: 8.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Rocket size={11} />
              {isFlying ? 'FLYING' : 'THRUST'}
            </button>

            {/* Audio Toggle */}
            <button
              onClick={() => onToggleSound()}
              style={{
                background: !isAudioMuted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${!isAudioMuted ? '#10b981' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 6,
                padding: '4px 8px',
                color: !isAudioMuted ? '#10b981' : '#94a3b8',
                fontSize: 8.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {!isAudioMuted ? <Volume2 size={11} /> : <VolumeX size={11} />}
              {!isAudioMuted ? 'SOUND ON' : 'MUTED'}
            </button>
          </div>

          {/* Exit Cockpit Button */}
          <button
            onClick={() => onTogglePerspective()}
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 6,
              padding: '4px 10px',
              color: '#f87171',
              fontSize: 8.5,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Camera size={11} />
            EXIT COCKPIT
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          5. LEFT & RIGHT AERODYNAMIC DIGITAL SIDE MIRRORS
          ══════════════════════════════════════════════════════════════════════ */}
      {/* Left Side Mirror Display */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 24,
          width: 140,
          background: 'rgba(15, 23, 42, 0.92)',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.75)',
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          backdropFilter: 'blur(12px)',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 8.5, color: '#94a3b8' }}>
          <span style={{ fontWeight: 700, color: '#e2e8f0' }}>LEFT CAM</span>
          <span style={{ color: '#10b981', fontWeight: 600 }}>BLIND SPOT OK</span>
        </div>
        <div
          style={{
            height: 42,
            borderRadius: 4,
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'rgba(56, 189, 248, 0.3)' }} />
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="none">
            <line x1="68" y1="21" x2="30" y2="42" stroke="rgba(56, 189, 248, 0.25)" strokeWidth="1" strokeDasharray="2 2" />
          </svg>
          <span style={{ fontSize: 8, color: '#94a3b8', fontFamily: 'monospace' }}>REAR-LEFT ROAD</span>
        </div>
        <div style={{ fontSize: 7, color: '#64748b', textAlign: 'right' }}>AERO OPTICAL</div>
      </div>

      {/* Right Side Mirror Display */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 24,
          width: 140,
          background: 'rgba(15, 23, 42, 0.92)',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.75)',
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          backdropFilter: 'blur(12px)',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 8.5, color: '#94a3b8' }}>
          <span style={{ color: '#10b981', fontWeight: 600 }}>BLIND SPOT OK</span>
          <span style={{ fontWeight: 700, color: '#e2e8f0' }}>RIGHT CAM</span>
        </div>
        <div
          style={{
            height: 42,
            borderRadius: 4,
            background: 'linear-gradient(225deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'rgba(56, 189, 248, 0.3)' }} />
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="none">
            <line x1="72" y1="21" x2="110" y2="42" stroke="rgba(56, 189, 248, 0.25)" strokeWidth="1" strokeDasharray="2 2" />
          </svg>
          <span style={{ fontSize: 8, color: '#94a3b8', fontFamily: 'monospace' }}>REAR-RIGHT ROAD</span>
        </div>
        <div style={{ fontSize: 7, color: '#64748b', textAlign: 'left' }}>AERO OPTICAL</div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          6. INTERACTIVE STEERING CONTROLS (Bottom Left)
          ══════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 18,
          display: 'flex',
          gap: 8,
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
          7. INTERACTIVE PEDAL BUTTONS (Bottom Right)
          ══════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          right: 18,
          display: 'flex',
          gap: 8,
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

      {/* ══════════════════════════════════════════════════════════════════════
          8. COCKPIT FLOATING ACTION QUICK-BAR (Upper Right)
          ══════════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          background: 'rgba(15, 23, 42, 0.88)',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          pointerEvents: 'auto',
        }}
      >
        {/* Toggle Fly / Thrusters */}
        <button
          onClick={() => onToggleFly(!isFlying)}
          title="SpaceX Cold-Gas Thrusters (Hold Space to Fly)"
          style={{
            background: isFlying ? 'linear-gradient(135deg, #0284c7, #38bdf8)' : 'rgba(14, 165, 233, 0.15)',
            border: `1px solid ${isFlying ? '#38bdf8' : 'rgba(14, 165, 233, 0.4)'}`,
            borderRadius: 6,
            padding: '4px 8px',
            color: isFlying ? '#fff' : '#38bdf8',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Rocket size={11} /> Fly
        </button>

        {/* Ludicrous+ Boost */}
        <button
          onClick={onToggleLudicrous}
          title="Ludicrous+ Boost (Shift)"
          style={{
            background: isLudicrous ? 'linear-gradient(135deg, #ea580c, #f97316)' : 'rgba(249, 115, 22, 0.15)',
            border: `1px solid ${isLudicrous ? '#fb923c' : 'rgba(249, 115, 22, 0.4)'}`,
            borderRadius: 6,
            padding: '4px 8px',
            color: isLudicrous ? '#fff' : '#fb923c',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Zap size={11} /> Boost
        </button>

        {/* Headlights Toggle */}
        <button
          onClick={onToggleHeadlights}
          title="Toggle Functional Headlights & Beam Projectors [L]"
          style={{
            background: headlightsOn ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.08)',
            border: `1px solid ${headlightsOn ? '#38bdf8' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 6,
            padding: '4px 7px',
            color: headlightsOn ? '#38bdf8' : '#94a3b8',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <Lightbulb size={11} /> {headlightsOn ? 'Lights On' : 'Lights Off'}
        </button>

        {/* Targa Roof Toggle */}
        <button
          onClick={onToggleTarga}
          title="Toggle Removable Glass Roof Convertible Targa [T]"
          style={{
            background: targaOpen ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255,255,255,0.08)',
            border: `1px solid ${targaOpen ? '#f59e0b' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 6,
            padding: '4px 7px',
            color: targaOpen ? '#fbbf24' : '#e2e8f0',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <Sun size={11} /> {targaOpen ? 'Targa Open' : 'Coupe'}
        </button>

        {/* Audio Sound */}
        <button
          onClick={onToggleSound}
          title="Sound Mute [U]"
          style={{
            background: !isAudioMuted ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.08)',
            border: `1px solid ${!isAudioMuted ? '#38bdf8' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 6,
            padding: '4px 6px',
            color: !isAudioMuted ? '#38bdf8' : '#94a3b8',
            fontSize: 10,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {!isAudioMuted ? <Volume2 size={11} /> : <VolumeX size={11} />}
        </button>

        {/* Chase / Cockpit Switch */}
        <button
          onClick={onTogglePerspective}
          title="Switch to Exterior 3rd-Person Chase View [C/V]"
          style={{
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 6,
            padding: '4px 8px',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Camera size={11} /> Exit Cockpit
        </button>
      </div>
    </div>
  );
}
