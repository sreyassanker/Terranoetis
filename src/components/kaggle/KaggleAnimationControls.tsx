/**
 * KaggleAnimationControls — play/pause + timeline scrubber for snapshot
 * animation of simulation overlays.
 */

import { useRef, useEffect } from 'react';
import { Pause, Play } from 'lucide-react';

interface KaggleAnimationControlsProps {
  frames: number;
  frame: number;
  onFrameChange: (frame: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  /** Seconds-per-frame (or arbitrary unit); shown as elapsed time. */
  times: number[];
  /** Optional custom label formatter for the timeline (default: t=Xs). */
  formatTime?: (time: number) => string;
  fps?: number;
}

export default function KaggleAnimationControls({
  frames,
  frame,
  onFrameChange,
  playing,
  onTogglePlay,
  times,
  formatTime,
  fps = 4,
}: KaggleAnimationControlsProps) {
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);

  useEffect(() => {
    if (!playing) return;
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = now - lastRef.current;
      const frameMs = 1000 / fps;
      const step = Math.max(1, Math.round(elapsed / frameMs));
      lastRef.current = now;
      onFrameChange((frame + step) % frames);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, fps, frame, frames, onFrameChange]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  if (frames <= 1) return null;

  const fmt = formatTime || ((t: number) => `t=${Math.round(t)}s`);
  const curTime = times[Math.min(frame, times.length - 1)] ?? 0;

  return (
    <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={onTogglePlay}
          style={{
            background: 'rgba(251,191,36,0.25)',
            border: '1px solid rgba(251,191,36,0.5)',
            color: '#fde68a',
            borderRadius: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            flexShrink: 0,
          }}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames - 1)}
          step={1}
          value={frame}
          onChange={e => onFrameChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: '#fbbf24' }}
        />
        <span style={{ fontSize: 9, opacity: 0.85, minWidth: 62, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(curTime)} · {frame + 1}/{frames}
        </span>
      </div>
    </div>
  );
}
