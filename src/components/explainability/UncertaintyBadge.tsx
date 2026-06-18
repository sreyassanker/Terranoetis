import React from 'react';

interface Props {
  confidence: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  format?: 'bar' | 'badge' | 'full';
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'var(--success)';
  if (confidence >= 0.5) return 'var(--warning)';
  return 'var(--danger)';
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return 'Very High';
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.6) return 'Moderate';
  if (confidence >= 0.4) return 'Low';
  return 'Very Low';
}

export default function UncertaintyBadge({ confidence, showLabel = true, size = 'sm', format = 'badge' }: Props) {
  const color = confidenceColor(confidence);
  const label = confidenceLabel(confidence);

  if (format === 'badge') {
    const height = size === 'sm' ? 16 : size === 'md' ? 20 : 24;
    const fontSize = size === 'sm' ? 9 : size === 'md' ? 10 : 11;

    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: `1px ${size === 'sm' ? 5 : 7}px`,
        borderRadius: 4, fontSize,
        fontWeight: 600,
        background: `${color}18`,
        color,
        border: `1px solid ${color}30`,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: color, display: 'inline-block',
        }} />
        {showLabel && label}
        <span>{(confidence * 100).toFixed(0)}%</span>
      </span>
    );
  }

  if (format === 'bar') {
    const height = size === 'sm' ? 4 : size === 'md' ? 6 : 8;
    const width = size === 'sm' ? 40 : size === 'md' ? 60 : 80;

    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width, height, borderRadius: 3,
          background: 'rgba(255,255,255,0.08)',
          position: 'relative', overflow: 'hidden',
        }}>
          <span style={{
            position: 'absolute', left: 0, top: 0,
            width: `${confidence * 100}%`, height: '100%',
            background: color, borderRadius: 3,
            transition: 'width 0.3s ease',
          }} />
        </span>
        {showLabel && (
          <span style={{ fontSize: size === 'sm' ? 9 : 10, color: 'var(--text-dim)' }}>
            {(confidence * 100).toFixed(0)}%
          </span>
        )}
      </span>
    );
  }

  // Full format
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <span style={{
        flex: 1, height: 8, borderRadius: 4,
        background: 'rgba(255,255,255,0.06)',
        position: 'relative', overflow: 'hidden',
      }}>
        <span style={{
          position: 'absolute', left: 0, top: 0,
          width: `${confidence * 100}%`, height: '100%',
          background: `linear-gradient(90deg, ${color}, ${color}88)`,
          borderRadius: 4,
          transition: 'width 0.3s ease',
        }} />
      </span>
      <span style={{
        fontSize: 10, fontWeight: 600, color, minWidth: 50, textAlign: 'right',
      }}>
        {(confidence * 100).toFixed(0)}%
      </span>
      {showLabel && (
        <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 60 }}>
          {label}
        </span>
      )}
    </div>
  );
}
