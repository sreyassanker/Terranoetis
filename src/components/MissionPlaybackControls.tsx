import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, SkipBack, Clock, Maximize2, Minimize2 } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface TimelinePlaybackProps {
  currentTime: number;
  startTime: number;
  endTime: number;
  isPlaying: boolean;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onReset: () => void;
  onSeek: (progress01: number) => void;
  onSeekToTime: (ms: number) => void;
  onSpeedChange: (speed: number) => void;
  onClose?: () => void;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8, 16];

export default function MissionPlaybackControls({
  currentTime, startTime, endTime, isPlaying, speed,
  onPlay, onPause, onStop, onReset, onSeek, onSeekToTime, onSpeedChange, onClose,
}: TimelinePlaybackProps) {
  const [enlarged, setEnlarged] = useState(false);
  const [seekTimeInput, setSeekTimeInput] = useState('');
  const initRef = useRef(false);

  const duration = endTime - startTime;
  const progress = duration > 0 ? (currentTime - startTime) / duration : 0;
  const hasRange = duration > 0;

  useEffect(() => {
    if (!initRef.current && hasRange) {
      setSeekTimeInput(new Date(startTime).toISOString().slice(0, 16));
      initRef.current = true;
    }
  }, [hasRange, startTime]);

  const formatTime = (ms: number) => {
    if (!ms || ms <= 0) return '00:00:00';
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  const formatDate = (ms: number) => {
    return new Date(ms).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
  };

  const progressPct = Math.round(progress * 1000);

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 1000 }}>
      <Panel title="MISSION PLAYBACK" icon={<Clock size={13} />} accentColor="#6366f1" onClose={onClose}
        style={{ width: enlarged ? 580 : undefined }}
        headerExtra={
          <button onClick={() => setEnlarged(!enlarged)} title={enlarged ? 'Shrink' : 'Enlarge'}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: '#94a3b8' }}>
            {enlarged ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
        }>

        {/* Playback Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          {/* Reset */}
          <button onClick={onReset} title="Reset to start" style={transportBtnStyle}>
            <SkipBack size={12} />
          </button>

          {/* Play/Pause */}
          {!isPlaying ? (
            <button onClick={onPlay} disabled={!hasRange} title="Play" style={{
              ...transportBtnStyle,
              background: hasRange ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)',
              borderColor: hasRange ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.05)',
              color: hasRange ? '#22c55e' : '#475569',
            }}>
              <Play size={12} />
            </button>
          ) : (
            <button onClick={onPause} title="Pause" style={{
              ...transportBtnStyle,
              background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.4)',
              color: '#f59e0b',
            }}>
              <Pause size={12} />
            </button>
          )}

          {/* Stop */}
          <button onClick={onStop} disabled={!hasRange} title="Stop" style={transportBtnStyle}>
            <Square size={12} />
          </button>

          {/* Speed selector */}
          <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
            {SPEED_OPTIONS.map(s => (
              <button key={s} onClick={() => onSpeedChange(s)}
                style={{
                  ...speedBtnStyle,
                  background: speed === s ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.03)',
                  color: speed === s ? '#a5b4fc' : '#64748b',
                  borderColor: speed === s ? 'rgba(99,102,241,0.5)' : 'transparent',
                }}>
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Progress Bar */}
        <div>
          <input type="range" min={0} max={1000} value={progressPct}
            onChange={e => onSeek(Number(e.target.value) / 1000)}
            disabled={!hasRange}
            style={{ width: '100%', height: 4, cursor: 'pointer', accentColor: '#6366f1', opacity: hasRange ? 1 : 0.3 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748b', marginTop: 2 }}>
            <span>{formatDate(startTime)} {formatTime(currentTime)}</span>
            <span style={{ color: '#94a3b8' }}>{formatDate(endTime)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', fontSize: 10, color: '#a5b4fc', marginTop: 1 }}>
            {new Date(currentTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' })} IST
          </div>
        </div>

        {/* Timestamp seek */}
        {hasRange && (
          <div style={{ marginTop: 6, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="datetime-local" value={seekTimeInput} onChange={e => setSeekTimeInput(e.target.value)}
              style={{ flex: 1, padding: '3px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, outline: 'none' }} />
            <button onClick={() => { const t = new Date(seekTimeInput).getTime(); if (!isNaN(t)) onSeekToTime(t); }}
              style={{ padding: '3px 8px', background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 4, color: '#a5b4fc', fontSize: 9, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Seek
            </button>
          </div>
        )}
    </Panel>
    </div>
  );
}

const transportBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '5px 8px',
  cursor: 'pointer',
  color: '#94a3b8',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const speedBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid transparent',
  borderRadius: 3,
  padding: '2px 5px',
  cursor: 'pointer',
  fontSize: 9,
  fontFamily: 'monospace',
  fontWeight: 600,
};
