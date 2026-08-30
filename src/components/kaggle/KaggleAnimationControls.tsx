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
  const accumRef = useRef<number>(0);
  const frameRef = useRef<number>(frame);

  // Keep the RAF loop's frame cursor in sync with external scrubbing, but
  // avoid mutating the ref during render (react-hooks/refs).
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  useEffect(() => {
    if (!playing) return;
    const frameMs = 1000 / fps;
    lastRef.current = performance.now();
    accumRef.current = 0;
    const tick = (now: number) => {
      const elapsed = now - lastRef.current;
      lastRef.current = now;
      accumRef.current += elapsed;
      // Advance at a FRACTIONAL frame rate so the shader's kaggleAtlasLerp can
      // blend between floor(frame) and ceil(frame). Advancing by whole frames
      // makes t = frame - floor(frame) always 0 → the interpolation never runs
      // and the animation jumps frame-to-frame. We advance 1 frame per frameMs
      // but pass the fractional position (frame += elapsed/frameMs) so the GPU
      // lerps continuously.
      const delta = elapsed / frameMs;
      frameRef.current = (frameRef.current + delta) % frames;
      onFrameChange(frameRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, fps, frames, onFrameChange]);

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
          {fmt(curTime)} · {Math.floor(frame) + 1}/{frames}
        </span>
      </div>
    </div>
  );
}
