import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Radio as RadioIcon, Play, Pause, Volume2, MapPin, Loader2 } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { authHeaders } from '@/context/AuthContext';

interface RadioTunerPanelProps {
  open: boolean;
  onClose: () => void;
  /** Reads the currently-loaded radio station entities (from the layer store). */
  getStations?: () => Array<{ lat: number; lon: number; name: string; url?: string; tags?: string; codec?: string; bitrate?: number; stationuuid?: string; favicon?: string }>;
  /** Fly the camera to a lat/lon. */
  flyTo?: (lat: number, lon: number, alt?: number) => void;
  /** Draw/clear the looping radio wave on the globe for the selected station. */
  onWave?: (station: { lat: number; lon: number } | null, color: string) => void;
  zIndex?: number;
}

interface Station {
  lat: number; lon: number; name: string; url?: string; tags?: string;
  codec?: string; bitrate?: number; stationuuid?: string; favicon?: string;
}

const TUNER_COLORS = ['#7c3aed', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fb923c', '#facc15'];

export const RadioTunerPanel: React.FC<RadioTunerPanelProps> = ({ open, onClose, getStations, flyTo, onWave, zIndex = 9996 }) => {
  const [stations, setStations] = useState<Station[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [customColor, setCustomColor] = useState<string>(TUNER_COLORS[0]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadStations = useCallback(async () => {
    setLoading(true); setErr(null);
    // Prefer already-loaded layer entities (fast path), else fetch fresh.
    let list = getStations?.() ?? [];
    if (!list.length) {
      try {
        const resp = await fetch('/api/data/radio_stations', { cache: 'no-store', headers: authHeaders() });
        if (resp.ok) {
          const data = await resp.json();
          const items = Array.isArray(data) ? data : (data.items ?? []);
          list = items.map((s: Record<string, unknown>) => ({
            lat: Number(s.lat ?? s.geo_lat ?? 0),
            lon: Number(s.lon ?? s.geo_long ?? 0),
            name: String(s.name ?? 'Unknown Station').replace(/^\s+/, ''),
            url: String(s.url ?? s.urlResolved ?? ''),
            tags: String(s.tags ?? ''),
            codec: String(s.codec ?? ''),
            bitrate: Number(s.bitrate ?? 0),
            stationuuid: String(s.stationuuid ?? ''),
            favicon: String(s.favicon ?? ''),
          })).filter((s: { lat: number; lon: number }) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
        }
      } catch { /* fall through */ }
    }
    if (!list.length) setErr('No radio stations reachable.');
    setStations(list);
    setLoading(false);
  }, [getStations]);

  // Defer the load out of the synchronous effect body so the setState calls
  // inside loadStations don't cascade a render synchronously on mount.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { void loadStations(); }, 0);
    return () => window.clearTimeout(t);
  }, [open, loadStations]);

  const current = stations[idx] ?? null;

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setPlaying(false);
  }, []);

  const playStation = useCallback((st: Station | null) => {
    if (!st?.url) return;
    stopAudio();
    const audio = new Audio(st.url);
    audioRef.current = audio;
    audio.play().then(() => setPlaying(true)).catch(() => { setErr('Stream unreachable (CORS/geo).'); setPlaying(false); });
  }, [stopAudio]);

  const select = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(stations.length - 1, i));
    setIdx(clamped);
    const st = stations[clamped];
    if (st && flyTo) flyTo(st.lat, st.lon, 350000);
  }, [stations, flyTo]);

  useEffect(() => { if (current && flyTo) flyTo(current.lat, current.lon, 350000); }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: arrows scrub the tuner
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); select(idx + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); select(idx - 1); }
      if (e.key === ' ') { e.preventDefault(); if (playing) stopAudio(); else playStation(current); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, idx, current, playing, select, stopAudio, playStation]);

  const accent = customColor;

  // Drive the globe wave: emit the selected station + current color; clear on
  // close or when there is no station. Deps are primitives so it only fires on
  // an actual station/color/open change.
  useEffect(() => {
    if (!onWave) return;
    const st = stations[idx];
    if (open && st) onWave({ lat: st.lat, lon: st.lon }, accent);
    else onWave(null, accent);
  }, [open, idx, accent, stations, onWave]);

  return (
    <div style={{ position: 'fixed', top: 60, right: 10, bottom: 56, zIndex, width: 380, maxWidth: 'calc(100vw - 32px)', display: open ? 'block' : 'none' }}>
      <Panel title="WORLD RADIO" icon={<RadioIcon size={16} />} accentColor="#22d3ee" iconColor="#67e8f9" titleColor="#a5f3fc" onClose={() => { stopAudio(); onClose(); }} style={{ height: '100%', animation: 'slideInRight 0.25s ease' }}>
        <div style={{ padding: '10px 12px', overflowY: 'auto', height: 'calc(100% - 40px)' }}>
          {err && <div style={{ fontSize: 10, color: '#f87171', padding: '6px 8px', borderRadius: 6, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', marginBottom: 8 }}>{err}</div>}
          {loading && <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 11, padding: 8 }}><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading stations…</div>}

          {/* Analog tuner */}
          {stations.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}><MapPin size={9} /> {stations.length} geolocated stations</div>
              {/* Dial + color palette (palette sits to the right of the dial) */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0, position: 'relative', height: 34, borderRadius: 8, background: 'rgba(0,0,0,0.4)', border: `1px solid ${accent}40`, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: accent, left: `${(idx / Math.max(stations.length - 1, 1)) * 100}%`, transition: 'left 0.1s linear', boxShadow: `0 0 6px ${accent}` }} />
                  <div style={{ position: 'absolute', top: 0, left: 8, right: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%', pointerEvents: 'none' }}>
                    {stations.slice(0, 7).map((s, i) => (
                      <span key={i} style={{ fontSize: 6, color: '#475569', width: 1 }}>·</span>
                    ))}
                  </div>
                </div>
                {/* Color picker — choose any color for the tuner accent */}
                <label title="Pick color" aria-label="Pick tuner color" style={{ position: 'relative', width: 26, height: 26, borderRadius: '50%', background: accent, border: '1px solid rgba(255,255,255,0.35)', boxShadow: `0 0 8px ${accent}66`, overflow: 'hidden', flexShrink: 0, cursor: 'pointer', display: 'inline-flex' }}>
                  <input type="color" value={accent} onChange={e => setCustomColor(e.target.value)} aria-label="Pick tuner accent color" style={{ position: 'absolute', inset: -8, width: 'calc(100% + 16px)', height: 'calc(100% + 16px)', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }} />
                </label>
              </div>
              <input type="range" min={0} max={Math.max(stations.length - 1, 0)} step={1} value={idx}
                onChange={e => select(Number(e.target.value))}
                style={{ width: '100%', accentColor: accent, marginTop: 2, cursor: 'pointer' }} />
            </div>
          )}

          {/* Now playing */}
          {current && (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: `${accent}0d`, border: `1px solid ${accent}30`, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: `${accent}1a`, border: `1px solid ${accent}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                  {current.favicon ? <img src={current.favicon} alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <RadioIcon size={15} color={accent} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.name || 'Unknown station'}</div>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: accent }}>{current.lat.toFixed(2)}°, {current.lon.toFixed(2)}°</span>
                    {current.codec && <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{current.codec}</span>}
                    {current.bitrate !== undefined && current.bitrate > 0 && <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{current.bitrate} kbps</span>}
                  </div>
                </div>
                <button onClick={() => playing ? stopAudio() : playStation(current)}
                  style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${accent}, ${accent}88)`, color: '#0b1220', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
              </div>
            </div>
          )}

          {/* Station list (scrollable scrubber) */}
          {stations.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {stations.map((s, i) => {
                const isActive = i === idx;
                return (
                  <button key={s.stationuuid || i} onClick={() => select(i)}
                    onDoubleClick={() => playStation(s)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                      background: isActive ? `${accent}14` : 'rgba(255,255,255,0.02)', border: `1px solid ${isActive ? `${accent}45` : 'transparent'}`,
                    }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: isActive ? accent : '#475569', width: 28, flexShrink: 0 }}>{String(i + 1).padStart(3, '0')}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: isActive ? '#e2e8f0' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || 'Unknown'}</div>
                      <div style={{ fontSize: 8, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.tags || '—'}</div>
                    </div>
                    <Volume2 size={10} color={isActive ? accent : '#334155'} style={{ flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 8, color: '#475569', marginTop: 10 }}>Data: Radio Browser · Tuner scrubs & flies to each real station · Space = play/pause, ←/→ = tune, double-click = play</div>
        </div>
      </Panel>
    </div>
  );
};
