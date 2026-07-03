import React, { useCallback } from 'react';

interface TimelineControlsProps {
  playing: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  duration: number;
  speed: number;
  onSpeedChange: (speed: number) => void;
  label?: string;
  stepCount: number;
  currentStep: number;
  onStepJump: (step: number) => void;
  isFloodScenario?: boolean;
  maxDepth?: number;
  /** Current progress 0→1 for depth display */
  currentProgress?: number;
}

const SPEEDS = [0.5, 1, 2, 5, 10];

export default function TimelineControls({
  playing, onTogglePlay, currentTime, duration, speed, onSpeedChange, label, stepCount, currentStep, onStepJump,
  isFloodScenario = false, maxDepth = 0, currentProgress = 0,
}: TimelineControlsProps) {
  const formatTime = useCallback((s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }, []);

  return (
    <div style={{
      width: '100%', flexShrink: 0,
      background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 10px',
      display: 'flex', flexDirection: 'column', gap: 5,
      borderTop: '1px solid rgba(100,116,139,0.2)',
      fontFamily: 'system-ui, sans-serif', fontSize: 12, color: '#e2e8f0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => onStepJump(Math.max(0, currentStep - 1))} style={btnStyle} title="Previous step">⏮</button>
        <button onClick={onTogglePlay} style={{ ...btnStyle, fontSize: 14, width: 30, height: 30 }} title={playing ? 'Pause' : 'Play'}>
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={() => onStepJump(Math.min(stepCount - 1, currentStep + 1))} style={btnStyle} title="Next step">⏭</button>
        <div style={{ flex: 1 }}>
          <input
            type="range" min={0} max={stepCount - 1} value={currentStep}
            onChange={e => onStepJump(parseInt(e.target.value))}
            style={{ width: '100%', accentColor: '#3b82f6' }}
          />
        </div>
        <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 55, textAlign: 'right', fontSize: 10 }}>
          {formatTime(currentTime)}/{formatTime(duration)}
        </span>
      </div>
      {label && (
        <div style={{ color: '#94a3b8', fontSize: 10, textAlign: 'center', minHeight: 14, lineHeight: '14px' }}>
          {label}
        </div>
      )}

      {/* Flood Depth Legend */}
      {isFloodScenario && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 9, color: '#94a3b8', minWidth: 30 }}>Depth</span>
          <div style={{ flex: 1, height: 8, borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
            <div style={{ width: '100%', height: '100%', background: 'linear-gradient(to right, hsl(190,80%,70%), hsl(200,85%,50%), hsl(220,90%,30%))' }} />
            <div style={{ position: 'absolute', top: 0, left: `${currentProgress * 100}%`, width: 2, height: '100%', background: '#fff', boxShadow: '0 0 4px rgba(255,255,255,0.8)' }} />
          </div>
          <span style={{ fontSize: 9, color: '#94a3b8', minWidth: 50, textAlign: 'right' }}>{(maxDepth * currentProgress).toFixed(1)}m / {maxDepth.toFixed(1)}m</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
        {SPEEDS.map(s => (
          <button key={s} onClick={() => onSpeedChange(s)}
            style={{ ...btnStyle, background: speed === s ? '#3b82f6' : 'transparent', fontSize: 10, padding: '1px 6px' }}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(100,116,139,0.3)', borderRadius: 5,
  color: '#e2e8f0', cursor: 'pointer', padding: '3px 6px', fontSize: 12,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
