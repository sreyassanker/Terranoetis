import { useEffect, useState } from 'react';
import { Rocket, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, RotateCcw, Compass, Scan, X, Crosshair, Locate, Video } from 'lucide-react';

export interface IssTravelHud {
  lat: number;
  lon: number;
  altKm: number;
  az: number;   // look azimuth (deg, 0 = N)
  el: number;   // look elevation (deg, -90 = nadir .. 0 = horizon)
}

type LookAction = 'left' | 'right' | 'up' | 'down' | 'back' | 'nadir' | 'horizon' | 'zoomin' | 'zoomout' | 'default';

interface IssTravelViewProps {
  hud: IssTravelHud | null;
  onLook: (action: LookAction) => void;
  onCapture: () => void;
  onExit: () => void;
}

const PX_PER_DEG_PITCH = 3.4;   // horizon line travel per elevation degree
const PX_PER_DEG_HEADING = 2.6; // heading tape scale

function compass(az: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(az / 45) % 8];
}

function utcClock(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

export function IssTravelView({ hud, onLook, onCapture, onExit }: IssTravelViewProps) {
  const [clock, setClock] = useState(utcClock());
  useEffect(() => {
    const id = setInterval(() => setClock(utcClock()), 1000);
    return () => clearInterval(id);
  }, []);

  const az = hud?.az ?? 0;
  const el = hud?.el ?? 0;
  const azLabel = `${az}° ${compass(az)}`;
  const elLabel = el < 0 ? `DOWN ${Math.abs(el)}°` : `UP ${el}°`;
  const viewing = el < -85 ? 'NADIR' : el > -15 ? 'HORIZON' : 'EARTH';

  // horizon line vertical offset (center = horizon, looking down moves it up)
  const horizonOffset = -el * PX_PER_DEG_PITCH;
  const pitchLabel = `${(el >= 0 ? '+' : '')}${el}°`;

  // heading tape ticks
  const ticks: { d: number; label: string | null }[] = [];
  const start = Math.floor((az - 90) / 30) * 30;
  for (let d = start; d <= az + 90; d += 30) {
    const norm = ((d % 360) + 360) % 360;
    const label =
      norm === 0 ? 'N' : norm === 90 ? 'E' : norm === 180 ? 'S' : norm === 270 ? 'W' : null;
    ticks.push({ d, label });
  }

  return (
    <div className="iss-hud">
      {/* scanline + vignette atmosphere */}
      <div className="iss-hud-scan" />
      <div className="iss-hud-vignette" />

      {/* corner brackets */}
      <div className="iss-hud-corner tl" />
      <div className="iss-hud-corner tr" />
      <div className="iss-hud-corner bl" />
      <div className="iss-hud-corner br" />

      {/* top-center: feed title + heading tape */}
      <div className="iss-hud-top">
        <div className="iss-hud-feed">
          <Video size={12} className="iss-hud-rec" />
          <span className="iss-hud-rec-dot" /> ORBITAL TELEMETRY FEED
          <span className="iss-hud-utc">{clock}</span>
        </div>
        <div className="iss-hud-heading">
          <div className="iss-hud-heading-strip">
            {ticks.map((t) => (
              <div
                key={t.d}
                className={`iss-hud-tick ${t.label ? 'major' : ''}`}
                style={{ left: `calc(50% + ${(t.d - az) * PX_PER_DEG_HEADING}px)` }}
              >
                <span className="iss-hud-tick-mark" />
                {t.label && <span className="iss-hud-tick-label">{t.label}</span>}
              </div>
            ))}
          </div>
          <div className="iss-hud-heading-pointer" />
        </div>
      </div>

      {/* center reticle + moving horizon */}
      <div className="iss-hud-reticle">
        <div className="iss-hud-reticle-h" />
        <div className="iss-hud-reticle-v" />
        <div className="iss-hud-reticle-box" />
        <div className="iss-hud-reticle-dot" />
      </div>
      <div className="iss-hud-horizon" style={{ transform: `translate(-50%, calc(-50% + ${horizonOffset}px))` }}>
        <span className="iss-hud-horizon-line" />
        <span className="iss-hud-horizon-tag">{pitchLabel}</span>
      </div>

      {/* top-left: satellite identity */}
      <div className="iss-hud-tl">
        <div className="iss-hud-sat">
          <Rocket size={13} /> ISS (ZARYA)
        </div>
        <div className="iss-hud-row"><span>LIVE</span><span className="iss-hud-live"><i /> TRACKING</span></div>
        <div className="iss-hud-row"><span>MODE</span><span>ORBITAL TRAVEL</span></div>
        <div className="iss-hud-row"><span>UTC</span><span>{clock}</span></div>
      </div>

      {/* bottom-left: pointing / sub-point */}
      <div className="iss-hud-bl">
        <div className="iss-hud-stat">
          <label>SUB-POINT LAT</label><b>{hud ? `${hud.lat.toFixed(3)}°` : '—'}</b>
        </div>
        <div className="iss-hud-stat">
          <label>SUB-POINT LON</label><b>{hud ? `${hud.lon.toFixed(3)}°` : '—'}</b>
        </div>
        <div className="iss-hud-stat">
          <label>ALTITUDE</label><b>{hud ? `${hud.altKm.toFixed(0)} km` : '—'}</b>
        </div>
        <div className="iss-hud-stat">
          <label>LOOK AZ</label><b>{azLabel}</b>
        </div>
        <div className="iss-hud-stat">
          <label>LOOK EL</label><b>{elLabel}</b>
        </div>
        <div className="iss-hud-stat">
          <label>VIEW</label><b>{viewing}</b>
        </div>
      </div>

      {/* control deck (bottom-right) */}
      <div className="iss-hud-deck">
        <div className="iss-hud-dpad">
          <div />
          <button className="iss-hud-btn" onClick={() => onLook('up')} aria-label="Tilt up"><ArrowUp size={15} /></button>
          <div />
          <button className="iss-hud-btn" onClick={() => onLook('left')} aria-label="Look left"><ArrowLeft size={15} /></button>
          <button className="iss-hud-btn iss-hud-center" onClick={() => onLook('nadir')} aria-label="Nadir"><Crosshair size={15} /></button>
          <button className="iss-hud-btn" onClick={() => onLook('right')} aria-label="Look right"><ArrowRight size={15} /></button>
          <div />
          <button className="iss-hud-btn" onClick={() => onLook('down')} aria-label="Tilt down"><ArrowDown size={15} /></button>
          <div />
        </div>
        <div className="iss-hud-actions">
          <button className="iss-hud-pill" onClick={() => onLook('back')}><RotateCcw size={12} /> Back</button>
          <button className="iss-hud-pill" onClick={() => onLook('horizon')}><Compass size={12} /> Horizon</button>
          <button className="iss-hud-pill" onClick={() => onLook('default')}><Locate size={12} /> Default</button>
          <button className="iss-hud-pill" onClick={() => onLook('zoomin')}>＋</button>
          <button className="iss-hud-pill" onClick={() => onLook('zoomout')}>－</button>
          <button className="iss-hud-pill" onClick={onCapture}><Scan size={12} /> CAP</button>
          <button className="iss-hud-pill iss-hud-exit" onClick={onExit}><X size={12} /> EXIT</button>
        </div>
      </div>
    </div>
  );
}
