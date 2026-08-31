import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';
import { Rocket, Play, Pause, SkipBack, RotateCcw, ExternalLink, Loader2 } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import {
  fetchRecentLaunches, buildAscentPath, renderAscent, seekAscent,
  type LaunchInfo, type ReplayState,
} from '@/rendering/launchReplay';

interface LaunchReplayPanelProps {
  open: boolean;
  onClose: () => void;
  viewer: Cesium.Viewer | null;
  zIndex?: number;
}

const colors = ['#fb923c', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#facc15'];

export const LaunchReplayPanel: React.FC<LaunchReplayPanelProps> = ({ open, onClose, viewer, zIndex = 9995 }) => {
  const [launches, setLaunches] = useState<LaunchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LaunchInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [state, setState] = useState<ReplayState | null>(null);
  const [colorIdx, setColorIdx] = useState(0);
  const entitiesRef = useRef<{ trail: Cesium.Entity; vehicle: Cesium.Entity } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError(null);
    fetchRecentLaunches(20)
      .then(list => {
        if (!list.length) setError('No launches reachable — Launch Library 2 API unreachable.');
        setLaunches(list);
        if (list.length) setSelected(list[0]);
      })
      .catch(() => setError('Failed to reach Launch Library 2 API.'))
      .finally(() => setLoading(false));
  }, [open]);

  // Cleanup on close / unmount
  useEffect(() => {
    if (!open) { stopReplay(); }
    return () => { stopReplay(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clearEntities = useCallback(() => {
    if (entitiesRef.current && viewer) {
      viewer.entities.remove(entitiesRef.current.trail);
      viewer.entities.remove(entitiesRef.current.vehicle);
    }
    entitiesRef.current = null;
  }, [viewer]);

  const stopReplay = useCallback(() => {
    setPlaying(false);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    clearEntities();
  }, [clearEntities]);

  const seek = useCallback((val: number, _viewer0: Cesium.Viewer) => {
    setT(val);
    if (entitiesRef.current && selected) {
      const path = buildAscentPath(selected);
      setState(seekAscent(path, val, entitiesRef.current.vehicle));
    }
  }, [selected]);

  const startReplay = useCallback(() => {
    if (!viewer || !selected) return;
    clearEntities();
    const path = buildAscentPath(selected);
    const ents = renderAscent(viewer, path, Cesium.Color.fromCssColorString(colors[colorIdx % colors.length]));
    entitiesRef.current = ents;
    setState(seekAscent(path, 0, ents.vehicle));
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(selected.padLon, selected.padLat, 80000),
      duration: 1.0,
    });
    setT(0);
    setPlaying(true);
  }, [viewer, selected, colorIdx, clearEntities]);

  // Animation loop
  useEffect(() => {
    if (!playing || !viewer || !entitiesRef.current || !selected) return;
    const path = buildAscentPath(selected);
    const loop = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setT(prev => {
        const next = prev + dt / 9; // 9-second full ascent
        if (next >= 1) { setPlaying(false); return 1; }
        if (entitiesRef.current) setState(seekAscent(path, next, entitiesRef.current.vehicle));
        return next;
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; lastTsRef.current = 0; };
  }, [playing, viewer, selected]);

  return (
    <div style={{ position: 'fixed', top: 60, right: 10, bottom: 56, zIndex, width: 400, maxWidth: 'calc(100vw - 32px)', display: open ? 'block' : 'none' }}>
      <Panel title="LAUNCH REPLAY" icon={<Rocket size={16} />} accentColor="#fb923c" iconColor="#fdba74" titleColor="#fed7aa" onClose={onClose} style={{ height: '100%', animation: 'slideInRight 0.25s ease' }}>
        <div style={{ padding: '10px 12px', overflowY: 'auto', height: 'calc(100% - 40px)' }}>
          {error && (
            <div style={{ fontSize: 10, color: '#f87171', padding: '8px 10px', borderRadius: 6, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', marginBottom: 8 }}>{error}</div>
          )}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 11, padding: 8 }}>
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading launches…
            </div>
          )}
          {launches.length > 0 && (
            <select value={selected?.id ?? ''} onChange={e => {
              const l = launches.find(x => x.id === e.target.value);
              if (l) { stopReplay(); setSelected(l); setT(0); setState(null); }
            }}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(251,146,60,0.3)', color: '#e2e8f0', fontSize: 11, outline: 'none', marginBottom: 8 }}>
              {launches.map(l => <option key={l.id} value={l.id}>{l.name} — {l.net.slice(0, 10)}</option>)}
            </select>
          )}

          {selected && (
            <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.2)', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fed7aa' }}>{selected.name}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{selected.net}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.3)', color: '#67e8f9' }}>{selected.rocket || 'Rocket'}</span>
                <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)', color: '#c4b5fd' }}>{selected.orbit}</span>
                <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: '#6ee7b7' }}>{selected.status}</span>
              </div>
              <div style={{ fontSize: 9, color: '#64748b', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <RotateCcw size={9} /> Ascent path is a <b>reconstructed estimate</b> from real pad coordinates to the parking-orbit altitude.
              </div>
            </div>
          )}

          {/* Controls */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button onClick={startReplay} disabled={!selected}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', borderRadius: 6, border: 'none', cursor: selected ? 'pointer' : 'not-allowed', background: selected ? 'linear-gradient(135deg, #fb923c40, #ea580c20)' : 'rgba(255,255,255,0.05)', color: selected ? '#fed7aa' : '#64748b', fontSize: 11, fontWeight: 600 }}>
              {playing ? <Pause size={13} /> : <Play size={13} />} {playing ? 'Playing' : 'Launch Replay'}
            </button>
            <button onClick={stopReplay}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.03)', color: '#94a3b8', fontSize: 11 }}>
              <RotateCcw size={13} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {colors.map((c, i) => (
                <button key={c} onClick={() => setColorIdx(i)} title={`Trail color ${i + 1}`}
                  style={{ width: 14, height: 14, borderRadius: '50%', border: colorIdx === i ? '2px solid white' : '1px solid rgba(255,255,255,0.2)', background: c, cursor: 'pointer' }} />
              ))}
            </div>
          </div>

          {/* Scrubber */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SkipBack size={12} color="#64748b" onClick={() => viewer && seek(0, viewer)} style={{ cursor: 'pointer' }} />
              <input type="range" min={0} max={1} step={0.001} value={t}
                onChange={e => viewer && seek(Number(e.target.value), viewer)}
                style={{ flex: 1, accentColor: '#fb923c' }} />
            </div>
            {state && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginTop: 6 }}>
                <div style={{ padding: '5px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: '#64748b' }}>ALTITUDE</div>
                  <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0' }}>{state.altKm.toFixed(0)} km</div>
                </div>
                <div style={{ padding: '5px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: '#64748b' }}>SPEED</div>
                  <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0' }}>{state.speedKms.toFixed(1)} km/s</div>
                </div>
                <div style={{ padding: '5px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: '#64748b' }}>T+</div>
                  <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0' }}>{Math.round(t * 540)}s</div>
                </div>
              </div>
            )}
          </div>

          {selected?.image && (
            <img src={selected.image} alt="" style={{ width: '100%', borderRadius: 8, marginTop: 4, border: '1px solid rgba(255,255,255,0.08)' }} />
          )}
          {selected && (
            <a href={`https://ll.thespacedevs.com`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#64748b', marginTop: 8, textDecoration: 'none' }}>
              <ExternalLink size={9} /> Data: Launch Library 2
            </a>
          )}
        </div>
      </Panel>
    </div>
  );
};
