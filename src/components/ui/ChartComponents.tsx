import React, { useRef, useEffect, useState, useCallback } from 'react';

const TIME_RANGES = ['5d', '1m', '6m', '1y', '5y'] as const;
type TimeRange = (typeof TIME_RANGES)[number];

export const DetailLineChart: React.FC<{
  data: number[];
  color: string;
  width?: number;
  height?: number;
  showArea?: boolean;
  showGrid?: boolean;
  labels?: string[];
  range?: TimeRange;
  onRangeChange?: (r: TimeRange) => void;
}> = ({ data, color, width = 340, height = 120, showArea = true, showGrid = true, labels, range, onRangeChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: number; label: string } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    const pad = { top: 12, right: 12, bottom: 28, left: 50 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const valRange = max - min || 1;
    ctx.clearRect(0, 0, width, height);

    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (i / 4) * chartH;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
        const val = max - (i / 4) * valRange;
        ctx.fillStyle = '#64748b'; ctx.font = '9px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(val < 10 ? 2 : 0), pad.left - 4, y);
      }
    }

    if (showArea) {
      ctx.beginPath(); ctx.moveTo(pad.left, pad.top + chartH);
      for (let i = 0; i < data.length; i++) {
        const x = pad.left + (i / (data.length - 1)) * chartW;
        const y = pad.top + (1 - (data[i] - min) / valRange) * chartH;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(pad.left + chartW, pad.top + chartH); ctx.closePath();
      const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
      gradient.addColorStop(0, color + '30'); gradient.addColorStop(1, color + '05');
      ctx.fillStyle = gradient; ctx.fill();
    }

    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = pad.left + (i / (data.length - 1)) * chartW;
      const y = pad.top + (1 - (data[i] - min) / valRange) * chartH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();

    if (data.length > 0) {
      const lastX = pad.left + chartW;
      const lastY = pad.top + (1 - (data[data.length - 1] - min) / valRange) * chartH;
      ctx.beginPath(); ctx.arc(lastX, lastY, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.beginPath(); ctx.arc(lastX, lastY, 5, 0, Math.PI * 2); ctx.strokeStyle = color + '60'; ctx.lineWidth = 1; ctx.stroke();
    }

    if (labels && labels.length > 0) {
      ctx.fillStyle = '#64748b'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
      const step = Math.max(1, Math.floor(labels.length / 5));
      for (let i = 0; i < labels.length; i += step) {
        ctx.fillText(labels[i]!, pad.left + (i / (labels.length - 1)) * chartW, height - 4);
      }
    }
  }, [data, color, width, height, showArea, showGrid, labels]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const pad_left = 50;
    const chartW = width - pad_left - 12;
    if (mx < pad_left || mx > pad_left + chartW) { setTooltip(null); return; }
    const dataIdx = Math.round(((mx - pad_left) / chartW) * (data.length - 1));
    const idx = Math.max(0, Math.min(data.length - 1, dataIdx));
    const val = data[idx]!;
    const label = labels?.[idx] || '';
    const x = pad_left + (idx / (data.length - 1)) * chartW;
    const pad_top = 12;
    const chartH = height - pad_top - 28;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const vRange = max - min || 1;
    const y = pad_top + (1 - (val - min) / vRange) * chartH;
    setTooltip({ x, y, value: val, label });
  }, [data, width, height, labels]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ width, height, display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && (
        <div style={{
          position: 'absolute', left: tooltip.x + 12, top: tooltip.y - 20,
          background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 4, padding: '3px 8px', pointerEvents: 'none',
          zIndex: 10, whiteSpace: 'nowrap', fontSize: 10,
        }}>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontFamily: 'monospace' }}>
            {tooltip.value.toFixed(2)}
          </div>
          {tooltip.label && <div style={{ color: '#64748b', fontSize: 8 }}>{tooltip.label}</div>}
        </div>
      )}
      {onRangeChange && (
        <div style={{ display: 'flex', gap: 2, marginTop: 6, justifyContent: 'center' }}>
          {TIME_RANGES.map(r => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              style={{
                padding: '2px 8px', borderRadius: 4, border: '1px solid',
                borderColor: range === r ? '#818cf8' : 'rgba(255,255,255,0.1)',
                background: range === r ? 'rgba(129,140,248,0.15)' : 'transparent',
                color: range === r ? '#818cf8' : '#64748b',
                fontSize: 9, cursor: 'pointer', fontWeight: range === r ? 600 : 400,
              }}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const CorrelationHeatmap: React.FC<{
  data: Array<{ x: string; y: string; value: number }>;
  labels: string[];
  size?: number;
}> = ({ data, labels, size = 280 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || labels.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cellSize = (size - 60) / labels.length;
    canvas.width = size * dpr; canvas.height = size * dpr;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, size, size);
    const offsetX = 55, offsetY = 10;
    for (const cell of data) {
      const xi = labels.indexOf(cell.x); const yi = labels.indexOf(cell.y);
      if (xi < 0 || yi < 0) continue;
      const x = offsetX + xi * cellSize; const y = offsetY + yi * cellSize;
      const v = cell.value;
      let r: number, g: number, b: number;
      if (v >= 0) { r = Math.round(30 * (1 - v)); g = Math.round(100 + 155 * v); b = Math.round(60 * (1 - v)); }
      else { const av = Math.abs(v); r = Math.round(100 + 155 * av); g = Math.round(40 * (1 - av)); b = Math.round(60 * (1 - av)); }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
      if (cellSize > 20) {
        ctx.fillStyle = v > 0.5 || v < -0.5 ? '#fff' : '#94a3b8';
        ctx.font = `${Math.min(10, cellSize * 0.3)}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(v.toFixed(1), x + cellSize / 2, y + cellSize / 2);
      }
    }
    ctx.fillStyle = '#94a3b8'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i < labels.length; i++) {
      ctx.fillText(labels[i], offsetX - 4, offsetY + i * cellSize + cellSize / 2);
    }
    ctx.textAlign = 'left';
    for (let i = 0; i < labels.length; i++) {
      ctx.save(); ctx.translate(offsetX + i * cellSize + cellSize / 2, offsetY + labels.length * cellSize + 4);
      ctx.rotate(-Math.PI / 4); ctx.fillText(labels[i], 0, 0); ctx.restore();
    }
  }, [data, labels, size]);
  return <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />;
};

export const Sparkline: React.FC<{ data: number[]; color: string; width?: number; height?: number }> = ({
  data, color, width = 60, height = 20,
}) => {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data); const max = Math.max(...data); const vRange = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / vRange) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

export const StatRow: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
    <span style={{ fontSize: 10, color: '#64748b' }}>{label}</span>
    <span style={{ fontSize: 10, color: color || '#e2e8f0', fontFamily: 'monospace', fontWeight: 500 }}>{value}</span>
  </div>
);
