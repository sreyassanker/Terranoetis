import { useState, useCallback, useRef, useEffect } from 'react';
import { Plus, Minus, Target } from 'lucide-react';
import * as Cesium from 'cesium';

interface CameraControlsProps {
  viewer: Cesium.Viewer | null;
}

const ZOOM_STEP_RATIO = 0.35;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 25000000;
const ANIMATION_DURATION = 0.6;
const HOLD_INTERVAL_MS = 80;

function formatHeight(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 100000 ? 0 : 1)} km`;
  return `${Math.round(meters)} m`;
}

const LOG_MIN = Math.log10(MIN_HEIGHT);
const LOG_MAX = Math.log10(MAX_HEIGHT);
const LOG_RANGE = LOG_MAX - LOG_MIN;

export function CameraControls({ viewer }: CameraControlsProps) {
  const [height, setHeight] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewer) return;
    const update = () => {
      if (!isDragging) {
        const h = viewer.camera.positionCartographic.height;
        setHeight(h);
      }
    };
    update();
    return viewer.scene.postRender.addEventListener(update);
  }, [viewer, isDragging]);

  const stopHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const flyToHeight = useCallback((targetHeight: number) => {
    if (!viewer) return;
    const cam = viewer.camera;
    const h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, targetHeight));
    const direction = cam.direction;
    const newPos = Cesium.Cartesian3.add(
      cam.position,
      Cesium.Cartesian3.multiplyByScalar(
        direction,
        h - cam.positionCartographic.height,
        new Cesium.Cartesian3(),
      ),
      new Cesium.Cartesian3(),
    );
    const newCarto = Cesium.Cartographic.fromCartesian(newPos);
    newCarto.height = h;
    Cesium.Cartographic.toCartesian(newCarto, Cesium.Ellipsoid.WGS84, newPos);
    cam.flyTo({
      destination: newPos,
      orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll },
      duration: 0.3,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
    });
  }, [viewer]);

  const handleTrackMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientY - rect.top) / rect.height;
    const clamped = Math.max(0, Math.min(1, ratio));
    const targetHeight = 10 ** (LOG_MIN + clamped * LOG_RANGE);
    flyToHeight(targetHeight);
  }, [flyToHeight]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = (e.clientY - rect.top) / rect.height;
      const clamped = Math.max(0, Math.min(1, ratio));
      const targetHeight = 10 ** (LOG_MIN + clamped * LOG_RANGE);
      flyToHeight(targetHeight);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, flyToHeight]);

  const startZoomIn = useCallback(() => {
    if (!viewer) return;
    const doZoom = () => {
      const cam = viewer.camera;
      const h = cam.positionCartographic.height;
      const dist = h * ZOOM_STEP_RATIO;
      const direction = cam.direction;
      const newPos = Cesium.Cartesian3.add(
        cam.position,
        Cesium.Cartesian3.multiplyByScalar(direction, dist, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      const newCarto = Cesium.Cartographic.fromCartesian(newPos);
      if (newCarto.height < MIN_HEIGHT) {
        newCarto.height = MIN_HEIGHT;
        Cesium.Cartographic.toCartesian(newCarto, Cesium.Ellipsoid.WGS84, newPos);
      }
      cam.flyTo({
        destination: newPos,
        orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll },
        duration: ANIMATION_DURATION,
        easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
      });
    };
    doZoom();
    holdTimerRef.current = setInterval(doZoom, HOLD_INTERVAL_MS * 5);
  }, [viewer]);

  const startZoomOut = useCallback(() => {
    if (!viewer) return;
    const doZoom = () => {
      const cam = viewer.camera;
      const h = cam.positionCartographic.height;
      const dist = h * ZOOM_STEP_RATIO;
      const direction = cam.direction;
      const newPos = Cesium.Cartesian3.add(
        cam.position,
        Cesium.Cartesian3.multiplyByScalar(direction, -dist, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      const newCarto = Cesium.Cartographic.fromCartesian(newPos);
      if (newCarto.height > MAX_HEIGHT) {
        newCarto.height = MAX_HEIGHT;
        Cesium.Cartographic.toCartesian(newCarto, Cesium.Ellipsoid.WGS84, newPos);
      }
      cam.flyTo({
        destination: newPos,
        orientation: { heading: cam.heading, pitch: cam.pitch, roll: cam.roll },
        duration: ANIMATION_DURATION,
        easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
      });
    };
    doZoom();
    holdTimerRef.current = setInterval(doZoom, HOLD_INTERVAL_MS * 5);
  }, [viewer]);

  const resetView = useCallback(() => {
    if (!viewer) return;
    const cam = viewer.camera;
    const center = cam.pickEllipsoid(
      new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2),
      viewer.scene.globe.ellipsoid,
    );
    const dest = center
      ? Cesium.Cartesian3.fromDegrees(
          Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(center).longitude),
          Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(center).latitude),
          25000000,
        )
      : Cesium.Cartesian3.fromDegrees(0, 20, 25000000);
    cam.flyTo({
      destination: dest,
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
      duration: 2.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, [viewer]);

  if (!viewer) return null;

  const heightPct = Math.max(0, Math.min(100, ((Math.log10(height) - 2) / (Math.log10(MAX_HEIGHT) - 2)) * 100));

  const btnBase: React.CSSProperties = {
    width: 36,
    height: 32,
    border: 'none',
    background: 'transparent',
    color: '#e2e8f0',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    transition: 'all 0.15s',
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: 106,
      right: 16,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 3,
      zIndex: 90,
      userSelect: 'none',
    } as React.CSSProperties}>
      <div style={{
        background: 'rgba(15,23,42,0.75)',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        border: '1px solid rgba(148,163,184,0.12)',
        borderRadius: 12,
        padding: '4px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
      }}>
        <button
          onMouseDown={startZoomIn}
          onMouseUp={stopHold}
          onMouseLeave={e => { stopHold(); e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#e2e8f0'; }}
          onTouchStart={startZoomIn}
          onTouchEnd={stopHold}
          aria-label="Zoom in"
          style={btnBase}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.12)'; e.currentTarget.style.color = '#60a5fa'; }}
        >
          <Plus size={16} strokeWidth={2.5} />
        </button>

        <div
          ref={trackRef}
          onMouseDown={handleTrackMouseDown}
          style={{
            width: 2,
            height: 72,
            background: 'rgba(148,163,184,0.15)',
            borderRadius: 1,
            position: 'relative',
            margin: '2px 0',
            cursor: isDragging ? 'grabbing' : 'grab',
          }}>
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: `${100 - heightPct}%`,
            background: 'linear-gradient(to top, rgba(59,130,246,0.6), rgba(59,130,246,0.15))',
            borderRadius: 1,
            transition: isDragging ? 'none' : 'height 0.15s',
          }} />
          <div style={{
            position: 'absolute',
            bottom: `${100 - heightPct}%`,
            left: -3,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#60a5fa',
            border: '2px solid rgba(15,23,42,0.8)',
            transition: isDragging ? 'none' : 'bottom 0.15s',
          }} />
        </div>

        <button
          onMouseDown={startZoomOut}
          onMouseUp={stopHold}
          onMouseLeave={e => { stopHold(); e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#e2e8f0'; }}
          onTouchStart={startZoomOut}
          onTouchEnd={stopHold}
          aria-label="Zoom out"
          style={btnBase}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.12)'; e.currentTarget.style.color = '#60a5fa'; }}
        >
          <Minus size={16} strokeWidth={2.5} />
        </button>
      </div>

      <div style={{
        background: 'rgba(15,23,42,0.75)',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        border: '1px solid rgba(148,163,184,0.12)',
        borderRadius: 8,
        padding: '3px 8px',
        fontSize: 9,
        color: '#94a3b8',
        fontFamily: 'monospace',
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
      }}>
        {formatHeight(height)}
      </div>

      <button
        onClick={resetView}
        aria-label="Reset view"
        title="Reset to default view"
        style={{
          width: 36,
          height: 30,
          border: '1px solid rgba(148,163,184,0.12)',
          background: 'rgba(15,23,42,0.75)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          color: '#94a3b8',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          transition: 'all 0.15s',
        } as React.CSSProperties}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)'; e.currentTarget.style.color = '#60a5fa'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)'; e.currentTarget.style.color = '#94a3b8'; }}
      >
        <Target size={13} />
      </button>
    </div>
  );
}
