import { useState } from 'react';
import { Rocket, MapPin, HelpCircle, LocateFixed } from 'lucide-react';
import Panel from '@/components/ui/Panel';

export interface HeliSpawn {
  lat: number;
  lon: number;
  altM: number;
  headingDeg: number;
  label: string;
  coldStart?: boolean;   // sit on the pad, engine dark — run the checklist
  airframe?: 'AH64E' | 'HELIDRIVE_X';
}

const HELI_SPAWN_CITIES: { label: string; lat: number; lon: number }[] = [
  { label: 'New Delhi', lat: 28.61, lon: 77.21 },
  { label: 'Mumbai', lat: 19.07, lon: 72.87 },
  { label: 'Bengaluru', lat: 12.97, lon: 77.59 },
  { label: 'New York', lat: 40.71, lon: -74.01 },
  { label: 'London', lat: 51.51, lon: -0.13 },
  { label: 'Tokyo', lat: 35.67, lon: 139.65 },
  { label: 'Sydney', lat: -33.87, lon: 151.21 },
];

interface HelicopterPanelProps {
  onLaunch: (spawn: HeliSpawn) => void;
  onClose: () => void;
}

export function HelicopterPanel({ onLaunch, onClose }: HelicopterPanelProps) {
  const [mode, setMode] = useState<'current' | 'city'>('current');
  const [city, setCity] = useState(HELI_SPAWN_CITIES[0].label);
  const [altM, setAltM] = useState(500);
  const [coldStart, setColdStart] = useState(false);
  const [airframe, setAirframe] = useState<'AH64E' | 'HELIDRIVE_X'>('AH64E');

  const selected = HELI_SPAWN_CITIES.find(c => c.label === city)!;

  const launch = () => {
    if (mode === 'city') {
      onLaunch({ lat: selected.lat, lon: selected.lon, altM, headingDeg: 90, label: city, coldStart, airframe });
    } else {
      onLaunch({ lat: 0, lon: 0, altM, headingDeg: 90, label: 'Current view', coldStart, airframe });
    }
  };

  return (
    <div
      style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 600, width: 380,
      }}
    >
      <Panel
        title="HELICOPTER FLIGHT SIMULATOR"
        icon={<Rocket size={14} />}
        accentColor="#22c55e"
        iconColor="#4ade80"
        titleColor="#86efac"
        onClose={onClose}
      >
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
            Board the AH-64E Apache over the live globe. Keep it airborne with the collective,
            fly with cyclic, steer with pedals. <HelpCircle size={11} style={{ display: 'inline' }} />
          </div>

          {/* spawn mode */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setMode('current')}
              style={{
                flex: 1, padding: '7px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                background: mode === 'current' ? 'rgba(34,197,94,0.16)' : 'transparent',
                border: `1px solid ${mode === 'current' ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.15)'}`,
                color: mode === 'current' ? '#4ade80' : '#94a3b8',
              }}
            >
              <LocateFixed size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> CURRENT VIEW
            </button>
            <button
              onClick={() => setMode('city')}
              style={{
                flex: 1, padding: '7px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                background: mode === 'city' ? 'rgba(34,197,94,0.16)' : 'transparent',
                border: `1px solid ${mode === 'city' ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.15)'}`,
                color: mode === 'city' ? '#4ade80' : '#94a3b8',
              }}
            >
              <MapPin size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> CITY
            </button>
          </div>

          {mode === 'city' && (
            <>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>SPAWN OVER</div>
              <select
                data-testid="heli-city"
                value={city}
                onChange={e => setCity(e.target.value)}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 12,
                  background: 'rgba(0,0,0,0.35)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                {HELI_SPAWN_CITIES.map(c => (
                  <option key={c.label} value={c.label}>{c.label} ({c.lat.toFixed(2)}, {c.lon.toFixed(2)})</option>
                ))}
              </select>
            </>
          )}

          {/* airframe */}
          <div style={{ display: 'flex', gap: 6 }}>
            {([['AH64E', 'AH-64E APACHE', 'the honest attack helicopter — Vne 150 kt'],
               ['HELIDRIVE_X', 'HELIDRIVE-X COMPOUND', 'experimental: coaxial + pusher + wing · Vne 250 kt']] as const).map(([id, name, hint]) => (
              <button
                key={id} data-testid={`heli-air-${id}`} title={hint}
                onClick={() => setAirframe(id)}
                style={{
                  flex: 1, padding: '7px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                  background: airframe === id ? 'rgba(94,200,255,0.14)' : 'transparent',
                  border: `1px solid ${airframe === id ? 'rgba(94,200,255,0.55)' : 'rgba(255,255,255,0.15)'}`,
                  color: airframe === id ? '#5ec8ff' : '#94a3b8',
                }}
              >{name}</button>
            ))}
          </div>

          {/* cold & dark */}
          <button
            data-testid="heli-cold"
            onClick={() => setColdStart(v => !v)}
            style={{
              padding: '7px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer', textAlign: 'left',
              background: coldStart ? 'rgba(251,191,36,0.14)' : 'transparent',
              border: `1px solid ${coldStart ? 'rgba(251,191,36,0.55)' : 'rgba(255,255,255,0.15)'}`,
              color: coldStart ? '#fbbf24' : '#94a3b8',
            }}
          >
            {coldStart ? '☑ COLD & DARK' : '☐ COLD & DARK'} — start on the pad: AVN · ECL · STARTER · FLIGHT
          </button>

          {/* altitude */}
          <div style={{ opacity: coldStart ? 0.45 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#64748b' }}>SPAWN ALTITUDE (MSL)</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0, 100, 500, 1500].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAltM(v)}
                    style={{
                      padding: '2px 5px', fontSize: 9, borderRadius: 3, cursor: 'pointer',
                      background: altM === v ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${altM === v ? '#4ade80' : 'rgba(255,255,255,0.12)'}`,
                      color: altM === v ? '#86efac' : '#94a3b8',
                    }}
                  >
                    {v === 0 ? '0m Ground' : `${v}m`}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                data-testid="heli-alt-slider"
                type="range" min={0} max={3000} step={25} value={altM}
                onChange={e => setAltM(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#22c55e' }}
              />
              <span style={{ fontSize: 11, color: '#4ade80', minWidth: 68, textAlign: 'right', fontWeight: 700 }}>
                {altM === 0 ? '0m (Ground)' : `${altM} m`}
              </span>
            </div>
          </div>

          {/* controls reference */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10,
            fontSize: 9.5, color: '#94a3b8', lineHeight: 1.9, letterSpacing: '.02em',
          }}>
            <div><span style={{ color: '#4ade80' }}>W / S · PgUp/PgDn</span> — collective (climb / descend)</div>
            <div><span style={{ color: '#4ade80' }}>A / D</span> — throttle (accelerate / decelerate)</div>
            <div><span style={{ color: '#4ade80' }}>↑ ↓ ← →</span> — cyclic (fly fwd / aft / slide left / right)</div>
            <div><span style={{ color: '#4ade80' }}>Q / E · , .</span> — anti-torque pedals (yaw)</div>
            <div><span style={{ color: '#4ade80' }}>HUD controls</span> — drag cyclic · COL · THR · PEDALS with the mouse</div>
            <div><span style={{ color: '#4ade80' }}>Space</span> hover assist · <span style={{ color: '#4ade80' }}>Z</span> cyclic trim · <span style={{ color: '#4ade80' }}>X</span> turbulence</div>
            <div><span style={{ color: '#4ade80' }}>C / T / V</span> — cockpit / tactical / cycle cameras · <span style={{ color: '#4ade80' }}>O</span> chase⇄orbit · <span style={{ color: '#4ade80' }}>Shift</span> engine</div>
            <div><span style={{ color: '#4ade80' }}>G</span> ECL · <span style={{ color: '#4ade80' }}>H</span> starter (hold) · <span style={{ color: '#4ade80' }}>F</span> collective friction · <span style={{ color: '#4ade80' }}>B</span> batt · <span style={{ color: '#4ade80' }}>M</span> avionics</div>
            <div><span style={{ color: '#4ade80' }}>R</span> — reset to spawn · <span style={{ color: '#4ade80' }}>Esc</span> — exit</div>
          </div>

          <button
            onClick={launch}
            style={{
              marginTop: 4, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
              background: 'linear-gradient(135deg, #16a34a, #15803d)', border: 'none',
              color: '#fff', fontWeight: 700, fontSize: 12, letterSpacing: '.06em',
              boxShadow: '0 6px 18px rgba(22,163,74,0.35)',
            }}
          >
            <Rocket size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} /> LAUNCH FLIGHT
          </button>
        </div>
      </Panel>
    </div>
  );
}