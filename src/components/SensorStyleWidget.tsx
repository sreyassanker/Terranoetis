import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Lock } from 'lucide-react';
import { SENSOR_STYLES, type SensorStyleId } from '@/rendering/sensorStyles';

interface Props {
  activeStyle: SensorStyleId;
  onSelect: (id: SensorStyleId) => void;
}

const STORAGE_KEY = 'terranoetis.sensorWidget.v2';

interface SavedState { x: number; y: number; locked: boolean }

function loadState(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<SavedState>;
      if (typeof s.x === 'number' && typeof s.y === 'number') {
        return { x: s.x, y: s.y, locked: s.locked === true };
      }
    }
  } catch { /* ignore */ }
  return { x: window.innerWidth - 64, y: 12, locked: false };
}

const STYLE_HUE: Record<string, number> = { normal: 180, crt: 0, nvg: 120, flir: 30, noir: 0, snow: 200 };

export default function SensorStyleWidget({ activeStyle, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const s = loadState();
    return { x: s.x, y: s.y };
  });
  const [locked, setLocked] = useState<boolean>(() => loadState().locked);
  const [lockFlash, setLockFlash] = useState(false);
  const lockFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: pos.x, y: pos.y, locked }));
    } catch { /* ignore */ }
  }, [pos, locked]);

  useEffect(() => () => {
    if (lockFlashTimerRef.current) clearTimeout(lockFlashTimerRef.current);
  }, []);

  const onHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [locked, pos]);

  const onHandlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = e.clientX - d.dx;
    const ny = e.clientY - d.dy;
    const maxX = Math.max(40, window.innerWidth - 40);
    const maxY = Math.max(40, window.innerHeight - 40);
    const clampedX = Math.min(maxX, Math.max(0, nx));
    const clampedY = Math.min(maxY, Math.max(0, ny));
    d.moved = Math.abs(nx - pos.x) + Math.abs(ny - pos.y) > 3 || d.moved;
    setPos({ x: clampedX, y: clampedY });
  }, [pos]);

  const onHandlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }, []);

  return (
    <div
      className="sensor-widget"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={e => {
        if (dragRef.current?.moved) e.stopPropagation();
      }}
    >
      <div
        className="sensor-widget-handle"
        title={locked ? 'Widget locked — right-click to unlock' : 'Drag to move · right-click to lock'}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onClick={() => {
          if (dragRef.current?.moved) return;
          setOpen(o => !o);
        }}
        onContextMenu={e => {
          e.preventDefault();
          e.stopPropagation();
          setLocked(l => !l);
          setLockFlash(true);
          if (lockFlashTimerRef.current) clearTimeout(lockFlashTimerRef.current);
          lockFlashTimerRef.current = setTimeout(() => setLockFlash(false), 2000);
        }}
        style={{ cursor: locked ? 'default' : 'grab' }}
      >
        <Sparkles size={16} />
        {lockFlash && <Lock size={11} className="sensor-widget-lock" />}
      </div>

      {open && (
        <div className="sensor-widget-panel">
          {SENSOR_STYLES.map(s => {
            const isActive = activeStyle === s.id;
            const hue = STYLE_HUE[s.id] ?? 200;
            const sat = s.id === 'noir' ? 0 : 60;
            return (
              <button
                key={s.id}
                className={`sensor-widget-item ${isActive ? 'active' : ''}`}
                title={`${s.label} — ${s.hint}`}
                onClick={() => onSelect(s.id)}
                style={{
                  color: isActive ? `hsl(${hue}, ${sat}%, 88%)` : '#cbd5e1',
                  background: isActive ? `hsl(${hue}, ${sat}%, 18%)` : 'rgba(255, 255, 255, 0.04)',
                  border: isActive ? `1px solid hsl(${hue}, ${sat}%, 55%)` : '1px solid rgba(148, 163, 184, 0.15)',
                  boxShadow: isActive ? `0 0 10px hsla(${hue}, ${sat}%, 50%, 0.4)` : 'none',
                }}
              >
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: isActive ? `hsl(${hue}, ${sat}%, 65%)` : '#64748b',
                  boxShadow: isActive ? `0 0 6px hsl(${hue}, ${sat}%, 65%)` : 'none',
                  flexShrink: 0,
                }} />
                <span className="sensor-widget-item-label">{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
