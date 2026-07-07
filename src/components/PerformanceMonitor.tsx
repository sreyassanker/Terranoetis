import { useEffect, useRef, useState } from 'react';
import type * as Cesium from 'cesium';

interface PerformanceMonitorProps {
  viewer: Cesium.Viewer | null;
  visible: boolean;
  onToggle: () => void;
}

interface Stats {
  fps: number;
  frameTime: number;
  entityCount: number;
  primitiveCount: number;
  memoryMB: number;
  jsHeapUsed: string;
}

/**
 * Performance Monitor — real-time FPS, entity count, memory, and render timing.
 * Toggle with Ctrl+Shift+P or the button in the toolbar.
 */
export default function PerformanceMonitor({ viewer, visible, onToggle }: PerformanceMonitorProps) {
  const [stats, setStats] = useState<Stats>({ fps: 0, frameTime: 0, entityCount: 0, primitiveCount: 0, memoryMB: 0, jsHeapUsed: '—' });
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameRef = useRef(0);
  const rafRef = useRef<number>(0);
  const updateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(rafRef.current);
      if (updateRef.current) clearInterval(updateRef.current);
      return;
    }

    // Define tick inside useEffect to avoid ref assignment during render
    tickRef.current = () => {
      const now = performance.now();
      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      frameTimesRef.current.push(dt);
      // Keep last 60 frame times for averaging
      if (frameTimesRef.current.length > 60) frameTimesRef.current.shift();
      rafRef.current = requestAnimationFrame(() => tickRef.current());
    };

    lastFrameRef.current = performance.now();
    frameTimesRef.current = [];
    rafRef.current = requestAnimationFrame(() => tickRef.current());

    updateRef.current = setInterval(() => {
      const frames = frameTimesRef.current;
      const avgDt = frames.length > 0 ? frames.reduce((a, b) => a + b, 0) / frames.length : 16;
      const fps = Math.round(1000 / avgDt);
      const frameTime = Math.round(avgDt * 10) / 10;

      let entityCount = 0;
      let primitiveCount = 0;
      if (viewer && !viewer.isDestroyed()) {
        entityCount = viewer.entities.values.length;
        primitiveCount = viewer.scene.primitives.length;
      }

      let memoryMB = 0;
      let jsHeapUsed = '—';
      // @ts-expect-error performance.memory is Chrome-only
      if (performance.memory) {
        // @ts-expect-error performance.memory is Chrome-only
        memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
        // @ts-expect-error performance.memory is Chrome-only
        jsHeapUsed = `${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB`;
      }

      setStats({ fps, frameTime, entityCount, primitiveCount, memoryMB, jsHeapUsed });
    }, 500);

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (updateRef.current) clearInterval(updateRef.current);
    };
  }, [visible, viewer]);

  // Global keyboard shortcut: Ctrl+Shift+P
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggle]);

  if (!visible) return null;

  const fpsColor = stats.fps >= 55 ? '#22c55e' : stats.fps >= 30 ? '#f59e0b' : '#ef4444';
  const entityColor = stats.entityCount > 200 ? '#f59e0b' : stats.entityCount > 500 ? '#ef4444' : '#22c55e';

  return (
    <div style={{
      position: 'fixed',
      bottom: 12,
      left: 12,
      zIndex: 9999,
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(12px)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 11,
      fontFamily: 'monospace',
      color: '#e2e8f0',
      lineHeight: 1.6,
      minWidth: 180,
      pointerEvents: 'auto',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.5)' }}>Performance</span>
        <button onClick={onToggle} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
        }}>✕</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1px 10px' }}>
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>FPS</span>
        <span style={{ color: fpsColor, fontWeight: 600 }}>{stats.fps}</span>

        <span style={{ color: 'rgba(255,255,255,0.5)' }}>Frame</span>
        <span>{stats.frameTime}ms</span>

        <span style={{ color: 'rgba(255,255,255,0.5)' }}>Entities</span>
        <span style={{ color: entityColor, fontWeight: 600 }}>{stats.entityCount}</span>

        <span style={{ color: 'rgba(255,255,255,0.5)' }}>Primitives</span>
        <span>{stats.primitiveCount}</span>

        <span style={{ color: 'rgba(255,255,255,0.5)' }}>JS Heap</span>
        <span>{stats.jsHeapUsed}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
        Ctrl+Shift+P to toggle
      </div>
    </div>
  );
}
